/**
 * Tests for lv-gitflow-panel squash-finish conflict handling (Fix 6).
 *
 * A git-flow feature finish can be a squash finish. If it hits a merge conflict,
 * the conflict dialog must be told it is a squash (detail.squash = true) so the
 * completion produces a single-parent squash commit rather than a two-parent
 * merge commit. A non-squash finish must dispatch squash = false.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeCalls: Array<{ command: string; args?: unknown }> = [];

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvGitflowPanel } from '../lv-gitflow-panel.ts';
import '../lv-gitflow-panel.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_gitflow_config') {
    return Promise.resolve({
      initialized: true,
      masterBranch: 'main',
      developBranch: 'develop',
      featurePrefix: 'feature/',
      releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/',
      supportPrefix: 'support/',
      versionTagPrefix: '',
    });
  }
  if (command === 'get_branches') return Promise.resolve([]);
  return Promise.resolve(null);
}

async function createComponent(): Promise<LvGitflowPanel> {
  mockInvoke = defaultMockInvoke;
  const el = await fixture<LvGitflowPanel>(
    html`<lv-gitflow-panel .repositoryPath=${REPO_PATH}></lv-gitflow-panel>`
  );
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 20));
  return el;
}

interface ConflictDetail {
  operationType: string;
  squash: boolean;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-gitflow-panel squash finish conflict (Fix 6)', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
  });

  it('dispatches squash=true when a squash finish hits a merge conflict', async () => {
    const el = await createComponent();

    let detail: ConflictDetail | null = null;
    el.addEventListener('open-conflict-dialog', (e) => {
      detail = (e as CustomEvent<ConflictDetail>).detail;
    });

    mockInvoke = (command: string) => {
      if (command === 'gitflow_finish_feature') {
        return Promise.reject({ code: 'MERGE_CONFLICT', message: 'conflict' });
      }
      return defaultMockInvoke(command);
    };

    await (el as unknown as {
      handleFinishFeature: (item: { name: string; branch: string }, squash?: boolean) => Promise<void>;
    }).handleFinishFeature({ name: 'x', branch: 'feature/x' }, true);

    // The finish itself was invoked with squash=true.
    const finishCall = invokeCalls.find((c) => c.command === 'gitflow_finish_feature');
    expect(finishCall, 'gitflow_finish_feature invoked').to.exist;
    expect((finishCall!.args as Record<string, unknown>).squash).to.equal(true);

    // The conflict dialog was told it is a squash.
    expect(detail, 'open-conflict-dialog dispatched').to.not.be.null;
    expect(detail!.operationType).to.equal('merge');
    expect(detail!.squash).to.be.true;
  });

  it('renders a Squash button on feature items that finishes with squash=true', async () => {
    const el = await createComponent();

    // Populate an active feature item, then reload the active-items list.
    mockInvoke = (command: string) => {
      if (command === 'get_branches') {
        return Promise.resolve([{ name: 'feature/x', isRemote: false }]);
      }
      return defaultMockInvoke(command);
    };
    await (el as unknown as { loadActiveItems: () => Promise<void> }).loadActiveItems();
    await el.updateComplete;

    const squashBtn = el.shadowRoot!.querySelector('.item-squash-btn') as HTMLButtonElement;
    expect(squashBtn, 'squash button rendered on feature item').to.exist;

    // Clicking the squash affordance must invoke the finish with squash=true.
    squashBtn.click();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    const finishCall = invokeCalls.find((c) => c.command === 'gitflow_finish_feature');
    expect(finishCall, 'gitflow_finish_feature invoked from squash button').to.exist;
    expect((finishCall!.args as Record<string, unknown>).squash).to.equal(true);
  });

  it('dispatches squash=false for a normal (non-squash) finish conflict', async () => {
    const el = await createComponent();

    let detail: ConflictDetail | null = null;
    el.addEventListener('open-conflict-dialog', (e) => {
      detail = (e as CustomEvent<ConflictDetail>).detail;
    });

    mockInvoke = (command: string) => {
      if (command === 'gitflow_finish_feature') {
        return Promise.reject({ code: 'MERGE_CONFLICT', message: 'conflict' });
      }
      return defaultMockInvoke(command);
    };

    // Default UI path: handleFinishFeature(item) with no squash arg.
    await (el as unknown as {
      handleFinishFeature: (item: { name: string; branch: string }) => Promise<void>;
    }).handleFinishFeature({ name: 'y', branch: 'feature/y' });

    expect(detail, 'open-conflict-dialog dispatched').to.not.be.null;
    expect(detail!.operationType).to.equal('merge');
    expect(detail!.squash).to.be.false;
  });
});
