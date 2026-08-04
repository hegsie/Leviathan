/**
 * Repository Health Dialog — destructive action gating.
 *
 * `run_gc` and `run_prune` are reachable from BOTH this dialog and the command
 * palette. They remove unreachable objects irreversibly, so both surfaces must
 * gate them behind the same confirmation — a gate on only one surface just
 * moves the unguarded route rather than closing it.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const invokeHistory: Array<{ command: string; args?: unknown }> = [];
/** plugin-dialog's confirm() resolves true only for the OK button label. */
let confirmResult = true;

let mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;
  if (
    command === 'plugin:dialog|message' ||
    command === 'plugin:dialog|confirm' ||
    command === 'plugin:dialog|ask'
  ) {
    return confirmResult ? 'Ok' : 'Cancel';
  }
  if (command === 'get_repository_health') {
    return { objectCount: 10, packCount: 1, looseObjectCount: 9, repositorySize: 1024, hasReflog: true };
  }
  return null;
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import '../lv-repository-health-dialog.ts';
import type { LvRepositoryHealthDialog } from '../lv-repository-health-dialog.ts';

const REPO_PATH = '/test/repo';

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

async function render(): Promise<LvRepositoryHealthDialog> {
  const el = await fixture<LvRepositoryHealthDialog>(html`
    <lv-repository-health-dialog .repositoryPath=${REPO_PATH} ?open=${true}></lv-repository-health-dialog>
  `);
  await el.updateComplete;
  return el;
}

interface Internal {
  runGc: (aggressive: boolean) => Promise<void>;
  runPrune: () => Promise<void>;
}

function internalOf(el: LvRepositoryHealthDialog): Internal {
  return el as unknown as Internal;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-repository-health-dialog destructive actions', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    confirmResult = true;
  });

  it('does not run GC when the confirm is declined', async () => {
    confirmResult = false;
    const el = await render();
    invokeHistory.length = 0;

    await internalOf(el).runGc(false);

    expect(findCommands('run_gc')).to.have.length(0);
  });

  it('runs GC once confirmed', async () => {
    const el = await render();
    invokeHistory.length = 0;

    await internalOf(el).runGc(false);

    expect(findCommands('run_gc')).to.have.length(1);
  });

  it('does not run prune when the confirm is declined', async () => {
    confirmResult = false;
    const el = await render();
    invokeHistory.length = 0;

    await internalOf(el).runPrune();

    expect(findCommands('run_prune')).to.have.length(0);
  });

  it('runs prune once confirmed', async () => {
    const el = await render();
    invokeHistory.length = 0;

    await internalOf(el).runPrune();

    expect(findCommands('run_prune')).to.have.length(1);
  });
});

describe('lv-repository-health-dialog deferred close', () => {
  // Closing this dialog DESTROYS the element, so the host refuses while gc is
  // in flight. Refusing alone left it open and pinned to a repo whose tab was
  // gone — and its own guard (!pinnedRepoPath || runningAction) then allowed a
  // SECOND gc against that repo once the first finished.
  it('closes immediately when idle', async () => {
    const el = await render();
    let closed = 0;
    el.addEventListener('close', () => { closed++; });

    el.closeWhenIdle();

    expect(closed).to.equal(1);
  });

  it('defers the close until the running action lands, and blocks new ones', async () => {
    let resolveGc!: (v: unknown) => void;
    mockInvoke = async (command: string) => {
      if (command === 'run_gc') return new Promise((r) => { resolveGc = r; });
      if (command === 'plugin:dialog|message') return 'Ok';
      return null;
    };

    const el = await render();
    let closed = 0;
    el.addEventListener('close', () => { closed++; });

    const gc = internalOf(el).runGc(true);
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    expect(el.isRunning, 'gc in flight').to.be.true;

    el.closeWhenIdle();
    await el.updateComplete;
    expect(closed, 'not closed while gc runs').to.equal(0);

    // A second action must be refused while the close is pending.
    invokeHistory.length = 0;
    await internalOf(el).runPrune();
    expect(findCommands('run_prune'), 'no new action once closing').to.have.length(0);

    resolveGc(null);
    await gc;
    await el.updateComplete;

    expect(closed, 'closed once the gc landed').to.equal(1);
  });
});
