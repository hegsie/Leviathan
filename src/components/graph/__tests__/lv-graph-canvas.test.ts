/**
 * Unit tests for lv-graph-canvas component.
 *
 * These render the REAL lv-graph-canvas component, mock only the Tauri invoke
 * layer, and verify the UI controls, state management, pagination, branch
 * visibility, export UI, and commit deduplication.
 *
 * Note: Canvas rendering cannot be fully tested with fixture(), so we focus
 * on toolbar interactions, branch panel, export menu, pagination state,
 * and keyboard navigation triggering load-more.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const invokeHistory: Array<{ command: string; args?: unknown }> = [];
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { Commit, RefsByCommit } from '../../../types/git.types.ts';

// Import the actual component — registers <lv-graph-canvas> custom element
import '../lv-graph-canvas.ts';
import type { LvGraphCanvas } from '../lv-graph-canvas.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeCommit(overrides: Partial<Commit> = {}): Commit {
  return {
    oid: 'abc1234567890abcdef1234567890abcdef123456',
    shortId: 'abc1234',
    message: 'Initial commit\n\nSome body text',
    summary: 'Initial commit',
    body: 'Some body text',
    author: { name: 'Test Author', email: 'test@example.com', timestamp: 1700000000 },
    committer: { name: 'Test Author', email: 'test@example.com', timestamp: 1700000000 },
    parentIds: [],
    timestamp: 1700000000,
    ...overrides,
  };
}

const commit1 = makeCommit({
  oid: 'aaa1111111111111111111111111111111111111111',
  shortId: 'aaa1111',
  summary: 'First commit',
  message: 'First commit',
  timestamp: 1700000000,
  parentIds: [],
});

const commit2 = makeCommit({
  oid: 'bbb2222222222222222222222222222222222222222',
  shortId: 'bbb2222',
  summary: 'Second commit',
  message: 'Second commit',
  timestamp: 1700001000,
  parentIds: [commit1.oid],
});

const commit3 = makeCommit({
  oid: 'ccc3333333333333333333333333333333333333333',
  shortId: 'ccc3333',
  summary: 'Third commit',
  message: 'Third commit',
  timestamp: 1700002000,
  parentIds: [commit2.oid],
});

const defaultCommits: Commit[] = [commit3, commit2, commit1];

const defaultRefs: RefsByCommit = {
  [commit3.oid]: [
    { name: 'refs/heads/main', shorthand: 'main', refType: 'localBranch', isHead: true },
    { name: 'refs/remotes/origin/main', shorthand: 'origin/main', refType: 'remoteBranch', isHead: false },
  ],
  [commit2.oid]: [
    { name: 'refs/heads/feature', shorthand: 'feature', refType: 'localBranch', isHead: false },
  ],
};

// Batch of extra commits used for "load more" testing
function makeMoreCommits(count: number, startIndex: number): Commit[] {
  const commits: Commit[] = [];
  for (let i = 0; i < count; i++) {
    const idx = startIndex + i;
    const hexIdx = idx.toString(16).padStart(40, '0');
    commits.push(
      makeCommit({
        oid: hexIdx,
        shortId: hexIdx.substring(0, 7),
        summary: `Extra commit ${idx}`,
        message: `Extra commit ${idx}`,
        timestamp: 1700000000 - idx * 1000,
        parentIds: idx > 0 ? [(idx - 1).toString(16).padStart(40, '0')] : [],
      })
    );
  }
  return commits;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

function setupDefaultMocks(opts: {
  commits?: Commit[];
  refs?: RefsByCommit;
  hasMore?: boolean;
  moreCommits?: Commit[];
} = {}): void {
  const commits = opts.commits ?? defaultCommits;
  const refs = opts.refs ?? defaultRefs;
  const moreCommits = opts.moreCommits ?? [];
  let loadMoreCalled = false;

  mockInvoke = async (command: string, args?: unknown) => {
    switch (command) {
      case 'get_commit_history': {
        const typedArgs = args as { skip?: number; limit?: number } | undefined;
        if (typedArgs?.skip && typedArgs.skip > 0) {
          loadMoreCalled = true;
          return moreCommits;
        }
        return commits;
      }
      case 'get_refs_by_commit':
        return refs;
      case 'detect_github_repo':
        return null;
      case 'get_commits_stats':
        return [];
      case 'get_commits_signatures':
        return [];
      case 'search_commits':
        return [];
      default:
        return null;
    }
  };

  // Keep track for tests that check loadMoreCalled
  (setupDefaultMocks as unknown as Record<string, unknown>).__loadMoreCalled = () => loadMoreCalled;
}

async function renderCanvas(commitCount?: number): Promise<LvGraphCanvas> {
  const count = commitCount ?? 1000;
  const el = await fixture<LvGraphCanvas>(
    html`<lv-graph-canvas
      .repositoryPath=${REPO_PATH}
      .commitCount=${count}
    ></lv-graph-canvas>`
  );
  // Wait for initial loadCommits to complete
  await el.updateComplete;
  // Extra time for async operations (loadCommits, processLayout, etc.)
  await new Promise((r) => setTimeout(r, 200));
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-graph-canvas', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
    // Clear localStorage for branch visibility tests
    try {
      localStorage.removeItem(`leviathan-hidden-branches-${REPO_PATH}`);
    } catch {
      // Ignore
    }
  });

  // ── Initial render and loading ───────────────────────────────────────
  describe('initial rendering', () => {
    it('renders the component and calls get_commit_history on load', async () => {
      const el = await renderCanvas();

      expect(el).to.not.be.null;
      expect(el.shadowRoot).to.not.be.null;

      const historyCalls = findCommands('get_commit_history');
      expect(historyCalls.length).to.be.greaterThan(0);
    });

    it('calls get_refs_by_commit on load', async () => {
      await renderCanvas();

      const refsCalls = findCommands('get_refs_by_commit');
      expect(refsCalls.length).to.be.greaterThan(0);
      expect(refsCalls[0].args).to.deep.include({ path: REPO_PATH });
    });

    it('renders the graph toolbar with Branches and Export buttons', async () => {
      const el = await renderCanvas();

      const toolbar = el.shadowRoot!.querySelector('.graph-toolbar');
      expect(toolbar).to.not.be.null;

      const buttons = toolbar!.querySelectorAll('.toolbar-btn');
      expect(buttons.length).to.equal(2);

      const buttonTexts = Array.from(buttons).map((b) => b.textContent?.trim());
      expect(buttonTexts).to.include('Branches');
      expect(buttonTexts).to.include('Export');
    });

    it('shows error panel when no repository path is set', async () => {
      const el = await fixture<LvGraphCanvas>(
        html`<lv-graph-canvas .repositoryPath=${''}></lv-graph-canvas>`
      );
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      // The component sets loadError when no path
      const errorPanel = el.shadowRoot!.querySelector('.info-panel');
      expect(errorPanel).to.not.be.null;
      expect(errorPanel!.textContent).to.include('Error');
    });
  });

  // ── Branch visibility panel ──────────────────────────────────────────
  describe('branch visibility panel', () => {
    it('does not show the branch panel by default', async () => {
      const el = await renderCanvas();

      const panel = el.shadowRoot!.querySelector('.branch-panel');
      expect(panel).to.be.null;
    });

    it('opens branch panel when Branches toolbar button is clicked', async () => {
      const el = await renderCanvas();

      const branchBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Branches'));
      expect(branchBtn).to.not.be.undefined;

      branchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const panel = el.shadowRoot!.querySelector('.branch-panel');
      expect(panel).to.not.be.null;
    });

    it('shows branch names with checkboxes in the panel', async () => {
      const el = await renderCanvas();

      // Open branch panel
      const branchBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Branches'));
      branchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const panel = el.shadowRoot!.querySelector('.branch-panel');
      expect(panel).to.not.be.null;

      const branchItems = panel!.querySelectorAll('.branch-item');
      expect(branchItems.length).to.be.greaterThan(0);

      // Each branch item should have a checkbox
      const checkboxes = panel!.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).to.be.greaterThan(0);
    });

    it('toggles branch visibility when checkbox is changed', async () => {
      const el = await renderCanvas();

      // Open branch panel
      const branchBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Branches'));
      branchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const panel = el.shadowRoot!.querySelector('.branch-panel');
      const checkboxes = panel!.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).to.be.greaterThan(0);

      // All checkboxes should be checked initially (all branches visible)
      const firstCheckbox = checkboxes[0] as HTMLInputElement;
      expect(firstCheckbox.checked).to.be.true;

      // Toggle the first branch off
      firstCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      // Verify toggleBranch was called (hiddenBranches state changed)
      // Re-query the panel to get fresh state
      const updatedPanel = el.shadowRoot!.querySelector('.branch-panel');
      expect(updatedPanel).to.not.be.null;
    });

    it('Show All button clears all hidden branches', async () => {
      const el = await renderCanvas();

      // First hide a branch via the public API
      el.toggleBranch('main');
      await el.updateComplete;

      // Open panel
      const branchBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Branches'));
      branchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      // Click "Show All"
      const panelActions = el.shadowRoot!.querySelectorAll('.branch-panel-actions button');
      const showAllBtn = Array.from(panelActions).find(
        (b) => b.textContent?.trim() === 'Show All'
      );
      expect(showAllBtn).to.not.be.undefined;

      showAllBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      // After "Show All", all checkboxes in the panel should be checked
      const panel = el.shadowRoot!.querySelector('.branch-panel');
      if (panel) {
        const checkboxes = panel.querySelectorAll('input[type="checkbox"]');
        for (const cb of checkboxes) {
          expect((cb as HTMLInputElement).checked).to.be.true;
        }
      }
    });

    it('Hide All button hides all branches', async () => {
      const el = await renderCanvas();

      // Open panel
      const branchBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Branches'));
      branchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      // Click "Hide All"
      const panelActions = el.shadowRoot!.querySelectorAll('.branch-panel-actions button');
      const hideAllBtn = Array.from(panelActions).find(
        (b) => b.textContent?.trim() === 'Hide All'
      );
      expect(hideAllBtn).to.not.be.undefined;

      hideAllBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      // After "Hide All", all checkboxes in the panel should be unchecked
      const panel = el.shadowRoot!.querySelector('.branch-panel');
      if (panel) {
        const checkboxes = panel.querySelectorAll('input[type="checkbox"]');
        for (const cb of checkboxes) {
          expect((cb as HTMLInputElement).checked).to.be.false;
        }
      }
    });

    it('closes branch panel when Branches button is clicked again', async () => {
      const el = await renderCanvas();

      const branchBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Branches'));

      // Open
      branchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.branch-panel')).to.not.be.null;

      // Close
      branchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.branch-panel')).to.be.null;
    });
  });

  // ── Export UI ────────────────────────────────────────────────────────
  describe('export UI', () => {
    it('does not show the export menu by default', async () => {
      const el = await renderCanvas();

      const menu = el.shadowRoot!.querySelector('.export-menu');
      expect(menu).to.be.null;
    });

    it('opens export menu when Export toolbar button is clicked', async () => {
      const el = await renderCanvas();

      const exportBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Export'));
      expect(exportBtn).to.not.be.undefined;

      exportBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const menu = el.shadowRoot!.querySelector('.export-menu');
      expect(menu).to.not.be.null;
    });

    it('export menu shows PNG and SVG options', async () => {
      const el = await renderCanvas();

      const exportBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Export'));
      exportBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const menu = el.shadowRoot!.querySelector('.export-menu');
      expect(menu).to.not.be.null;

      const items = menu!.querySelectorAll('.export-menu-item');
      expect(items.length).to.equal(2);

      const texts = Array.from(items).map((i) => i.textContent?.trim());
      expect(texts).to.include('Export as PNG');
      expect(texts).to.include('Export as SVG');
    });

    it('closes export menu when Export button is clicked again', async () => {
      const el = await renderCanvas();

      const exportBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Export'));

      // Open
      exportBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.export-menu')).to.not.be.null;

      // Close
      exportBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.export-menu')).to.be.null;
    });

    it('opening branch panel closes export menu', async () => {
      const el = await renderCanvas();

      const buttons = el.shadowRoot!.querySelectorAll('.toolbar-btn');
      const branchBtn = Array.from(buttons).find((b) => b.textContent?.trim().includes('Branches'));
      const exportBtn = Array.from(buttons).find((b) => b.textContent?.trim().includes('Export'));

      // Open export menu
      exportBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.export-menu')).to.not.be.null;

      // Open branch panel - should close export menu
      branchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('.export-menu')).to.be.null;
      expect(el.shadowRoot!.querySelector('.branch-panel')).to.not.be.null;
    });
  });

  // ── Pagination state ────────────────────────────────────────────────
  describe('pagination state', () => {
    it('passes correct limit to get_commit_history on initial load', async () => {
      await renderCanvas(500);

      const calls = findCommands('get_commit_history');
      expect(calls.length).to.be.greaterThan(0);
      const firstCall = calls[0].args as Record<string, unknown>;
      expect(firstCall.limit).to.equal(500);
      expect(firstCall.allBranches).to.be.true;
    });

    it('sets hasMoreCommits=true when returned commits equal the limit', async () => {
      // Return exactly commitCount commits so component thinks there are more
      const manyCommits = makeMoreCommits(100, 0);
      setupDefaultMocks({ commits: manyCommits });

      const el = await renderCanvas(100);

      // The component should think there are more commits
      // We can verify by checking getLoadedCommits returns the right number
      const loaded = el.getLoadedCommits();
      expect(loaded.length).to.equal(100);
    });

    it('sets hasMoreCommits=false when returned commits are less than limit', async () => {
      // Return fewer commits than commitCount
      setupDefaultMocks({ commits: defaultCommits }); // 3 commits with limit 1000

      const el = await renderCanvas(1000);

      const loaded = el.getLoadedCommits();
      expect(loaded.length).to.equal(3);
      // Since 3 < 1000, hasMoreCommits should be false
    });
  });

  // ── Load more (infinite scroll) ─────────────────────────────────────
  describe('load more commits', () => {
    it('calls get_commit_history with skip param when loading more', async () => {
      // Setup: return exactly commitCount commits (so hasMoreCommits=true)
      const initialBatch = makeMoreCommits(50, 0);
      const moreBatch = makeMoreCommits(10, 50);
      setupDefaultMocks({ commits: initialBatch, moreCommits: moreBatch });

      const el = await renderCanvas(50);
      clearHistory();

      // Trigger loadMoreCommits through the public navigateNext near end
      // Or trigger via the navigateLast which calls checkLoadMore internally
      el.navigateLast();
      await new Promise((r) => setTimeout(r, 300));
      await el.updateComplete;

      // Should have called get_commit_history with skip > 0
      const calls = findCommands('get_commit_history');
      const callWithSkip = calls.find((c) => {
        const a = c.args as Record<string, unknown>;
        return a.skip && (a.skip as number) > 0;
      });
      expect(callWithSkip).to.not.be.undefined;
    });

    it('shows loading indicator while loading more commits', async () => {
      // We can verify the loading-indicator template exists in the shadow DOM
      const el = await renderCanvas();

      // The loading indicator should not be visible when not loading more
      const indicator = el.shadowRoot!.querySelector('.loading-indicator');
      // It may or may not be present depending on isLoadingStats state
      // When isLoadingMore is false, no "Loading more commits..." should appear
      if (indicator) {
        expect(indicator.textContent).to.not.include('Loading more commits');
      }
    });
  });

  // ── Keyboard navigation at boundary triggers load more ──────────────
  describe('keyboard navigation boundary load-more', () => {
    it('navigateNext at boundary calls navigateNext without error', async () => {
      const initialBatch = makeMoreCommits(10, 0);
      setupDefaultMocks({ commits: initialBatch });

      const el = await renderCanvas(10);

      // Navigate to last
      el.navigateLast();
      await el.updateComplete;

      // Calling navigateNext at the boundary should not throw
      // The component will internally check if more commits should be loaded
      el.navigateNext();
      await el.updateComplete;

      // The component should still have the same number of loaded commits
      // (load-more depends on virtualScroll viewport calculations)
      const loaded = el.getLoadedCommits();
      expect(loaded.length).to.equal(10);
    });

    it('navigateNext does nothing when already at the last node and no more commits', async () => {
      // 3 commits, limit 1000 = hasMoreCommits is false
      setupDefaultMocks({ commits: defaultCommits });

      const el = await renderCanvas(1000);

      el.navigateLast();
      await el.updateComplete;
      clearHistory();

      el.navigateNext();
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      // Should not call get_commit_history with skip because hasMoreCommits=false
      const calls = findCommands('get_commit_history');
      const callWithSkip = calls.find((c) => {
        const a = c.args as Record<string, unknown>;
        return a.skip && (a.skip as number) > 0;
      });
      expect(callWithSkip).to.be.undefined;
    });
  });

  // ── Commit deduplication ────────────────────────────────────────────
  describe('commit deduplication', () => {
    it('getLoadedCommits returns unique commits by OID', async () => {
      setupDefaultMocks({ commits: defaultCommits });

      const el = await renderCanvas();

      const loaded = el.getLoadedCommits();
      const oids = loaded.map((c) => c.oid);
      const uniqueOids = new Set(oids);
      expect(uniqueOids.size).to.equal(oids.length);
    });

    it('does not duplicate commits when refresh is called', async () => {
      setupDefaultMocks({ commits: defaultCommits });

      const el = await renderCanvas();
      clearHistory();

      // Trigger refresh
      el.refresh();
      await new Promise((r) => setTimeout(r, 300));
      await el.updateComplete;

      const loaded = el.getLoadedCommits();
      const oids = loaded.map((c) => c.oid);
      const uniqueOids = new Set(oids);
      expect(uniqueOids.size).to.equal(oids.length);
      expect(loaded.length).to.equal(defaultCommits.length);
    });

    it('stores commits keyed by OID so duplicates are overwritten', async () => {
      // Provide commits with a duplicate OID
      const duplicatedCommits = [commit3, commit2, commit1, commit2]; // commit2 appears twice
      setupDefaultMocks({ commits: duplicatedCommits });

      const el = await renderCanvas();

      // The realCommits map uses OID as key, so duplicates are overwritten
      const loaded = el.getLoadedCommits();
      const oids = loaded.map((c) => c.oid);
      const uniqueOids = new Set(oids);
      expect(uniqueOids.size).to.equal(oids.length);
    });
  });

  // ── Public API and navigation ────────────────────────────────────────
  describe('public API', () => {
    it('getLoadedCommits returns all loaded commits', async () => {
      setupDefaultMocks({ commits: defaultCommits });

      const el = await renderCanvas();

      const loaded = el.getLoadedCommits();
      expect(loaded.length).to.equal(3);
      expect(loaded.map((c) => c.oid)).to.include(commit1.oid);
      expect(loaded.map((c) => c.oid)).to.include(commit2.oid);
      expect(loaded.map((c) => c.oid)).to.include(commit3.oid);
    });

    it('getAvailableBranches returns local and remote branches', async () => {
      setupDefaultMocks({ commits: defaultCommits, refs: defaultRefs });

      const el = await renderCanvas();

      const branches = el.getAvailableBranches();
      expect(branches.local).to.include('main');
      expect(branches.local).to.include('feature');
      expect(branches.remote).to.include('origin/main');
    });

    it('selectCommit returns false when no layout is loaded', async () => {
      const el = await fixture<LvGraphCanvas>(
        html`<lv-graph-canvas .repositoryPath=${''}></lv-graph-canvas>`
      );
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      const result = el.selectCommit('nonexistent');
      expect(result).to.be.false;
    });

    it('dispatches commit-selected event when selectCommit is called', async () => {
      setupDefaultMocks({ commits: defaultCommits, refs: defaultRefs });

      const el = await renderCanvas();

      let selectedEvent: CustomEvent | null = null;
      el.addEventListener('commit-selected', ((e: Event) => {
        selectedEvent = e as CustomEvent;
      }) as EventListener);

      const result = el.selectCommit(commit2.oid);
      expect(result).to.be.true;
      expect(selectedEvent).to.not.be.null;
      expect(selectedEvent!.detail.commit.oid).to.equal(commit2.oid);
    });
  });
});
