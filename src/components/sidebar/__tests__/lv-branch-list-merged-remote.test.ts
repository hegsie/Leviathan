/**
 * Regression tests for verified branch correctness bugs in lv-branch-list:
 *
 *  - Finding 13: "Delete Merged Branches" must use the backend's real merged
 *    detection (`get_cleanup_candidates` category==='merged'), not an
 *    ahead-of-UPSTREAM===0 heuristic that both over- and under-selects.
 *  - Finding 14: "Create branch from here" on a REMOTE branch must pass the
 *    full remote-tracking name ("origin/feature") as the start point, not the
 *    stripped shorthand ("feature").
 *  - Finding 16: drag-drop merge/rebase onto a REMOTE target must check out the
 *    full "origin/topic" reference, not the stripped shorthand ("topic").
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
import type { LvBranchList } from '../lv-branch-list.ts';
import '../lv-branch-list.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

interface MockBranch {
  name: string;
  shorthand: string;
  isHead?: boolean;
  isRemote?: boolean;
  upstream?: string | null;
  targetOid?: string;
  aheadBehind?: { ahead: number; behind: number } | null;
  isStale?: boolean;
}

function makeBranch(b: MockBranch) {
  return {
    isHead: false,
    isRemote: false,
    upstream: null,
    targetOid: 'abc123',
    aheadBehind: null,
    isStale: false,
    ...b,
  };
}

async function createComponent(
  branches: ReturnType<typeof makeBranch>[],
  cleanupCandidates: Array<{ name: string; shorthand: string; category: string }> = [],
  failCleanup = false,
): Promise<LvBranchList> {
  mockInvoke = (command: string) => {
    if (command === 'get_branches') return Promise.resolve(branches);
    if (command === 'get_remotes') return Promise.resolve([]);
    if (command === 'get_hidden_branches') return Promise.resolve([]);
    if (command === 'get_branch_sort_mode') return Promise.resolve('name');
    if (command === 'get_cleanup_candidates') {
      return failCleanup
        ? Promise.reject(new Error('candidate scan failed'))
        : Promise.resolve(cleanupCandidates);
    }
    if (command === 'plugin:dialog|message') return Promise.resolve('Ok');
    return Promise.resolve(null);
  };
  const el = await fixture<LvBranchList>(
    html`<lv-branch-list .repositoryPath=${REPO_PATH}></lv-branch-list>`
  );
  await el.updateComplete;
  // connectedCallback -> loadBranches is async; wait a microtask turn for it.
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

function fakeDragEvent(altKey = false): DragEvent {
  return { preventDefault() {}, altKey } as unknown as DragEvent;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-branch-list merged detection (Finding 13)', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
  });

  it('uses backend merged detection, not the ahead-of-upstream heuristic', async () => {
    // "merged-no-upstream": merged into HEAD but has no upstream (aheadBehind
    //   null) — the OLD heuristic would MISS it.
    // "pushed-unmerged": ahead-of-upstream 0 (fully pushed) but NOT merged —
    //   the OLD heuristic would WRONGLY include it.
    const el = await createComponent(
      [
        makeBranch({ name: 'main', shorthand: 'main', isHead: true }),
        makeBranch({ name: 'merged-no-upstream', shorthand: 'merged-no-upstream', aheadBehind: null }),
        makeBranch({
          name: 'pushed-unmerged',
          shorthand: 'pushed-unmerged',
          upstream: 'origin/pushed-unmerged',
          aheadBehind: { ahead: 0, behind: 0 },
        }),
      ],
      // Backend truth: only merged-no-upstream is merged into HEAD.
      [{ name: 'merged-no-upstream', shorthand: 'merged-no-upstream', category: 'merged' }],
    );

    // Assert the user-visible surface rather than a private helper: the
    // Clean up badge is driven by the backend's candidate list, so a branch
    // that is merely fully pushed must not be counted, and one that is merged
    // without an upstream must be.
    const candidates = (el as unknown as { cleanupCandidateNames: Set<string> })
      .cleanupCandidateNames;
    expect([...candidates].sort()).to.deep.equal(['merged-no-upstream']);

    const badge = el.shadowRoot!.querySelector('.cleanup-btn .badge');
    expect(badge, 'Clean up button rendered').to.not.be.null;
    expect(badge!.textContent!.trim()).to.equal('1');
  });

  // A failed candidate scan is NOT the same as "no candidates". Collapsing
  // both to an empty set made the Clean up button vanish from the sidebar with
  // no error, telling the user there is nothing to clean up when we simply
  // could not find out.
  it('keeps the Clean up button reachable when the candidate scan fails', async () => {
    const el = await createComponent(
      [
        makeBranch({ name: 'main', shorthand: 'main', isHead: true }),
        makeBranch({ name: 'feature', shorthand: 'feature' }),
      ],
      [],
      true,
    );

    const btn = el.shadowRoot!.querySelector('.cleanup-btn');
    expect(btn, 'Clean up button still rendered after a failed scan').to.not.be.null;
    expect(btn!.getAttribute('title')).to.contain('Could not check');
    // No count is known, so no badge may claim one.
    expect(el.shadowRoot!.querySelector('.cleanup-btn .badge')).to.be.null;
  });

  it('hides the Clean up button when the scan succeeds with no candidates', async () => {
    const el = await createComponent([
      makeBranch({ name: 'main', shorthand: 'main', isHead: true }),
    ]);

    expect(el.shadowRoot!.querySelector('.cleanup-btn')).to.be.null;
  });
});

describe('lv-branch-list create-branch-from remote (Finding 14)', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
  });

  it('passes the full remote name as the start point for a remote branch', async () => {
    const el = await createComponent([
      makeBranch({ name: 'main', shorthand: 'main', isHead: true }),
    ]);

    const remoteBranch = makeBranch({
      name: 'origin/feature',
      shorthand: 'feature',
      isRemote: true,
    });

    // The list no longer mounts its own dialog — it asks the host to open the
    // single instance, carrying the start point.
    let openedWith: string | undefined;
    el.addEventListener('create-branch', (e) => {
      openedWith = (e as CustomEvent<{ startPoint?: string }>).detail?.startPoint;
    });

    (el as unknown as { contextMenu: unknown }).contextMenu = {
      visible: true,
      x: 0,
      y: 0,
      branch: remoteBranch,
    };
    (el as unknown as { handleCreateBranchFrom: () => void }).handleCreateBranchFrom();

    expect(openedWith).to.equal('origin/feature');
  });

  it('passes the (full) local branch name for a local branch', async () => {
    const el = await createComponent([
      makeBranch({ name: 'main', shorthand: 'main', isHead: true }),
    ]);

    const localBranch = makeBranch({ name: 'feature/x', shorthand: 'feature/x' });

    let openedWith: string | undefined;
    el.addEventListener('create-branch', (e) => {
      openedWith = (e as CustomEvent<{ startPoint?: string }>).detail?.startPoint;
    });

    (el as unknown as { contextMenu: unknown }).contextMenu = {
      visible: true,
      x: 0,
      y: 0,
      branch: localBranch,
    };
    (el as unknown as { handleCreateBranchFrom: () => void }).handleCreateBranchFrom();

    expect(openedWith).to.equal('feature/x');
  });
});

describe('lv-branch-list drop onto remote target (Finding 16)', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
  });

  it('checks out the full remote name (origin/topic), not the shorthand', async () => {
    const el = await createComponent([
      makeBranch({ name: 'main', shorthand: 'main', isHead: true }),
    ]);

    mockInvoke = (command: string) => {
      if (command === 'checkout_with_autostash') {
        return Promise.resolve({
          success: true,
          stashed: false,
          stashApplied: false,
          stashConflict: false,
          message: 'ok',
        });
      }
      if (command === 'plugin:dialog|message') return Promise.resolve('Ok');
      if (command === 'merge') return Promise.resolve(null);
      return Promise.resolve(null);
    };
    invokeCalls.length = 0;

    const source = makeBranch({ name: 'feature/source', shorthand: 'feature/source' });
    const remoteTarget = makeBranch({ name: 'origin/topic', shorthand: 'topic', isRemote: true });
    (el as unknown as { draggingBranch: unknown }).draggingBranch = source;

    await (el as unknown as { handleDrop: (e: DragEvent, b: unknown) => Promise<void> }).handleDrop(
      fakeDragEvent(false),
      remoteTarget
    );

    const checkoutCall = invokeCalls.find((c) => c.command === 'checkout_with_autostash');
    expect(checkoutCall, 'checkout_with_autostash was called').to.not.be.undefined;
    expect((checkoutCall!.args as { refName: string }).refName).to.equal('origin/topic');
  });
});
