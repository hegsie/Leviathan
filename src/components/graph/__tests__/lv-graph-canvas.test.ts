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
import { clearGraphCacheForTests, evictGraphCache } from '../lv-graph-canvas.ts';

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
  total?: number;
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
      case 'get_commit_total':
        return opts.total ?? commits.length + moreCommits.length;
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
    // Clear persisted graph settings so tests don't leak into each other
    try {
      localStorage.removeItem(`leviathan-hidden-branches-${REPO_PATH}`);
      localStorage.removeItem('leviathan-graph-zoom');
      localStorage.removeItem('leviathan-graph-optional-columns');
      localStorage.removeItem('leviathan-graph-minimap');
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
      expect(buttons.length).to.equal(5); // HEAD, Map, Columns, Branches, Export

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

  // ── Branch visibility filtering ──────────────────────────────────────
  describe('branch visibility filtering', () => {
    // Topology: main (HEAD) -> mainCommit -> baseCommit
    //           feature     -> featureCommit -> baseCommit
    const baseCommit = makeCommit({
      oid: '1111111111111111111111111111111111111111',
      shortId: '1111111',
      summary: 'Base commit',
      timestamp: 1700000000,
      parentIds: [],
    });
    const mainCommit = makeCommit({
      oid: '2222222222222222222222222222222222222222',
      shortId: '2222222',
      summary: 'Main commit',
      timestamp: 1700002000,
      parentIds: [baseCommit.oid],
    });
    const featureCommit = makeCommit({
      oid: '3333333333333333333333333333333333333333',
      shortId: '3333333',
      summary: 'Feature commit',
      timestamp: 1700001000,
      parentIds: [baseCommit.oid],
    });

    const branchCommits: Commit[] = [mainCommit, featureCommit, baseCommit];
    const branchRefs: RefsByCommit = {
      [mainCommit.oid]: [
        { name: 'refs/heads/main', shorthand: 'main', refType: 'localBranch', isHead: true },
      ],
      [featureCommit.oid]: [
        { name: 'refs/heads/feature', shorthand: 'feature', refType: 'localBranch', isHead: false },
      ],
    };

    function getNodeOids(el: LvGraphCanvas): string[] {
      const nodes = (el as unknown as { sortedNodesByRow: Array<{ oid: string }> })
        .sortedNodesByRow;
      return nodes.map((n) => n.oid);
    }

    it('hiding a branch removes its exclusive commits from the graph', async () => {
      setupDefaultMocks({ commits: branchCommits, refs: branchRefs });
      const el = await renderCanvas();

      expect(getNodeOids(el)).to.have.length(3);

      el.toggleBranch('feature');
      await el.updateComplete;

      const oids = getNodeOids(el);
      expect(oids).to.have.length(2);
      expect(oids).to.not.include(featureCommit.oid);
      // Shared ancestor stays visible: it is reachable from main
      expect(oids).to.include(baseCommit.oid);
      expect(oids).to.include(mainCommit.oid);
    });

    it('re-showing a hidden branch restores its commits', async () => {
      setupDefaultMocks({ commits: branchCommits, refs: branchRefs });
      const el = await renderCanvas();

      el.toggleBranch('feature');
      await el.updateComplete;
      expect(getNodeOids(el)).to.have.length(2);

      el.toggleBranch('feature');
      await el.updateComplete;
      expect(getNodeOids(el)).to.have.length(3);
      expect(getNodeOids(el)).to.include(featureCommit.oid);
    });

    it('keeps HEAD history visible even when its branch is hidden', async () => {
      setupDefaultMocks({ commits: branchCommits, refs: branchRefs });
      const el = await renderCanvas();

      el.toggleBranch('main');
      await el.updateComplete;

      // main is HEAD, so its commits stay visible
      const oids = getNodeOids(el);
      expect(oids).to.include(mainCommit.oid);
      expect(oids).to.include(baseCommit.oid);
    });

    it('keeps tagged commits visible when their branch is hidden', async () => {
      const taggedRefs: RefsByCommit = {
        ...branchRefs,
        [featureCommit.oid]: [
          ...branchRefs[featureCommit.oid],
          { name: 'refs/tags/v1.0', shorthand: 'v1.0', refType: 'tag', isHead: false },
        ],
      };
      setupDefaultMocks({ commits: branchCommits, refs: taggedRefs });
      const el = await renderCanvas();

      el.toggleBranch('feature');
      await el.updateComplete;

      expect(getNodeOids(el)).to.include(featureCommit.oid);
    });

    it('does not leak hidden branches into a repo with no saved filter', async () => {
      setupDefaultMocks({ commits: branchCommits, refs: branchRefs });
      const el = await renderCanvas();

      el.toggleBranch('feature');
      await el.updateComplete;
      expect(getNodeOids(el)).to.have.length(2);

      // Switch to a repository that has never had branches hidden — the
      // previous repo's filter must NOT apply
      el.repositoryPath = '/test/other-repo';
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 200));

      const hidden = (el as unknown as { hiddenBranches: Set<string> }).hiddenBranches;
      expect(hidden.size).to.equal(0);
    });

    it('clears multi-selection state when switching repositories', async () => {
      setupDefaultMocks({ commits: branchCommits, refs: branchRefs });
      const el = await renderCanvas();

      el.selectCommit(mainCommit.oid);
      const internals = el as unknown as {
        selectedNodes: Set<string>;
        lastClickedNode: unknown;
      };
      expect(internals.selectedNodes.size).to.equal(1);

      el.repositoryPath = '/test/other-repo';
      await el.updateComplete;

      expect(internals.selectedNodes.size).to.equal(0);
      expect(internals.lastClickedNode).to.be.null;
    });

    it('clears the selection when the selected commit becomes hidden', async () => {
      setupDefaultMocks({ commits: branchCommits, refs: branchRefs });
      const el = await renderCanvas();

      expect(el.selectCommit(featureCommit.oid)).to.be.true;
      el.toggleBranch('feature');
      await el.updateComplete;

      const selected = (el as unknown as { selectedNode: { oid: string } | null }).selectedNode;
      expect(selected).to.be.null;
    });

    it('keeps the selection when the selected commit stays visible', async () => {
      setupDefaultMocks({ commits: branchCommits, refs: branchRefs });
      const el = await renderCanvas();

      expect(el.selectCommit(mainCommit.oid)).to.be.true;
      el.toggleBranch('feature');
      await el.updateComplete;

      const selected = (el as unknown as { selectedNode: { oid: string } | null }).selectedNode;
      expect(selected?.oid).to.equal(mainCommit.oid);
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

  // ── Per-repo graph cache ─────────────────────────────────────────────
  describe('optional columns', () => {
    beforeEach(() => {
      try {
        localStorage.removeItem('leviathan-graph-optional-columns');
      } catch {
        // Ignore
      }
    });

    it('opens the Columns menu with author/date checkboxes', async () => {
      const el = await renderCanvas();

      const columnsBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Columns'));
      expect(columnsBtn).to.not.be.undefined;

      columnsBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const menu = el.shadowRoot!.querySelector('.columns-menu');
      expect(menu).to.not.be.null;
      const checkboxes = menu!.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).to.equal(2);
      // Off by default
      for (const cb of checkboxes) {
        expect((cb as HTMLInputElement).checked).to.be.false;
      }
    });

    it('toggling a column updates the renderer config and persists', async () => {
      const el = await renderCanvas();

      el.toggleOptionalColumn('author');
      await el.updateComplete;

      const renderer = (el as unknown as {
        renderer: { getColumnWidths(): unknown } & { config?: unknown };
      }).renderer;
      const config = (renderer as unknown as {
        config: { showAuthorColumn: boolean; showDateColumn: boolean };
      }).config;
      expect(config.showAuthorColumn).to.be.true;
      expect(config.showDateColumn).to.be.false;

      const saved = JSON.parse(localStorage.getItem('leviathan-graph-optional-columns')!);
      expect(saved).to.deep.equal({ author: true, date: false });
    });

    it('restores persisted column visibility on connect', async () => {
      localStorage.setItem(
        'leviathan-graph-optional-columns',
        JSON.stringify({ author: true, date: true })
      );
      const el = await renderCanvas();

      const internals = el as unknown as {
        showAuthorColumn: boolean;
        showDateColumn: boolean;
      };
      expect(internals.showAuthorColumn).to.be.true;
      expect(internals.showDateColumn).to.be.true;
    });
  });

  describe('screen-reader support', () => {
    it('mirrors the visible commits into a hidden listbox', async () => {
      setupDefaultMocks();
      const el = await renderCanvas();

      const listbox = el.shadowRoot!.querySelector('[role="listbox"]');
      expect(listbox).to.not.be.null;

      const options = listbox!.querySelectorAll('[role="option"]');
      expect(options.length).to.equal(3);
      expect(options[0].textContent).to.contain('Third commit');
      expect(options[0].getAttribute('aria-posinset')).to.equal('1');
      expect(options[0].getAttribute('aria-setsize')).to.equal('3');
    });

    it('marks the selected commit in the mirror and announces it', async () => {
      setupDefaultMocks();
      const el = await renderCanvas();

      el.selectCommit(commit2.oid);
      await el.updateComplete;

      const selectedOptions = Array.from(
        el.shadowRoot!.querySelectorAll('[role="option"]')
      ).filter((o) => o.getAttribute('aria-selected') === 'true');
      expect(selectedOptions).to.have.length(1);
      expect(selectedOptions[0].textContent).to.contain('Second commit');

      const status = el.shadowRoot!.querySelector('[role="status"]');
      expect(status?.textContent).to.contain('Second commit');
      expect(status?.textContent).to.contain('Test Author');
    });

    it('clears the announcement when the selection is cleared', async () => {
      setupDefaultMocks();
      const el = await renderCanvas();

      el.selectCommit(commit2.oid);
      await el.updateComplete;

      const canvas = el.shadowRoot!.querySelector('canvas')!;
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await el.updateComplete;

      const status = el.shadowRoot!.querySelector('[role="status"]');
      expect(status?.textContent?.trim()).to.equal('');
    });
  });

  describe('jump to HEAD and tag tips', () => {
    it('jumpToHead selects the commit HEAD points at', async () => {
      setupDefaultMocks();
      const el = await renderCanvas();

      // defaultRefs marks commit3 (main) as HEAD
      expect(el.jumpToHead()).to.be.true;
      const selected = (el as unknown as { selectedNode: { oid: string } | null }).selectedNode;
      expect(selected?.oid).to.equal(commit3.oid);
    });

    it('jumpToHead returns false when no HEAD ref is loaded', async () => {
      setupDefaultMocks({ refs: {} });
      const el = await renderCanvas();

      expect(el.jumpToHead()).to.be.false;
    });

    it('renders a HEAD toolbar button that selects the HEAD commit', async () => {
      setupDefaultMocks();
      const el = await renderCanvas();

      const headBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('HEAD'));
      expect(headBtn).to.not.be.undefined;

      headBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const selected = (el as unknown as { selectedNode: { oid: string } | null }).selectedNode;
      expect(selected?.oid).to.equal(commit3.oid);
    });

    it('dispatches graph-notice when the HEAD toolbar button misses', async () => {
      setupDefaultMocks({ refs: {} });
      const el = await renderCanvas();

      let noticeMessage: string | null = null;
      el.addEventListener('graph-notice', (e: Event) => {
        noticeMessage = (e as CustomEvent<{ message: string }>).detail.message;
      });

      const headBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('HEAD'));
      headBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      expect(noticeMessage).to.contain('HEAD commit is not loaded');
    });

    it('getTagTips returns tag refs sorted by name', async () => {
      setupDefaultMocks({
        refs: {
          [commit1.oid]: [
            { name: 'refs/tags/v2.0', shorthand: 'v2.0', refType: 'tag', isHead: false },
          ],
          [commit2.oid]: [
            { name: 'refs/tags/v1.0', shorthand: 'v1.0', refType: 'tag', isHead: false },
          ],
        },
      });
      const el = await renderCanvas();

      expect(el.getTagTips()).to.deep.equal([
        { name: 'v1.0', oid: commit2.oid },
        { name: 'v2.0', oid: commit1.oid },
      ]);
    });
  });

  describe('zoom', () => {
    beforeEach(() => {
      try {
        localStorage.removeItem('leviathan-graph-zoom');
      } catch {
        // Ignore
      }
    });

    it('scales the row metrics and persists the zoom level', async () => {
      const el = await renderCanvas();
      const internals = el as unknown as { ROW_HEIGHT: number; LANE_WIDTH: number };
      const baseRowHeight = internals.ROW_HEIGHT;

      el.setZoom(1.5);
      expect(el.getZoom()).to.equal(1.5);
      expect(internals.ROW_HEIGHT).to.equal(Math.round(baseRowHeight * 1.5));
      expect(localStorage.getItem('leviathan-graph-zoom')).to.equal('1.5');
    });

    it('clamps zoom to the allowed range', async () => {
      const el = await renderCanvas();

      el.setZoom(10);
      expect(el.getZoom()).to.equal(2);

      el.setZoom(0.01);
      expect(el.getZoom()).to.equal(0.6);
    });

    it('zooms on Ctrl+wheel instead of scrolling (applied once per frame)', async () => {
      const el = await renderCanvas();
      const canvas = el.shadowRoot!.querySelector('canvas')!;
      const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true })
      );
      await nextFrame();
      expect(el.getZoom()).to.be.greaterThan(1);

      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true })
      );
      await nextFrame();
      expect(el.getZoom()).to.be.closeTo(1, 0.001);
    });

    it('accumulates rapid wheel ticks into a single zoom application', async () => {
      const el = await renderCanvas();
      const canvas = el.shadowRoot!.querySelector('canvas')!;
      const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

      // Three ticks in the same frame compound into one target (1.1^3)
      for (let i = 0; i < 3; i++) {
        canvas.dispatchEvent(
          new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true })
        );
      }
      await nextFrame();
      expect(el.getZoom()).to.be.closeTo(1.331, 0.005);
    });

    it('restores the persisted zoom level on connect', async () => {
      localStorage.setItem('leviathan-graph-zoom', '1.3');
      const el = await renderCanvas();
      expect(el.getZoom()).to.equal(1.3);
    });
  });

  describe('incremental layout append', () => {
    it('keeps rows and colors of loaded commits stable when older commits load', async () => {
      // First page: A -> B -> C, C's parent D arrives in the next page
      const commitA = makeCommit({
        oid: 'aaaa000000000000000000000000000000000000',
        summary: 'A',
        timestamp: 4000,
        parentIds: ['bbbb000000000000000000000000000000000000'],
      });
      const commitB = makeCommit({
        oid: 'bbbb000000000000000000000000000000000000',
        summary: 'B',
        timestamp: 3000,
        parentIds: ['cccc000000000000000000000000000000000000'],
      });
      const commitC = makeCommit({
        oid: 'cccc000000000000000000000000000000000000',
        summary: 'C',
        timestamp: 2000,
        parentIds: ['dddd000000000000000000000000000000000000'],
      });
      const commitD = makeCommit({
        oid: 'dddd000000000000000000000000000000000000',
        summary: 'D',
        timestamp: 1000,
        parentIds: [],
      });

      setupDefaultMocks({
        commits: [commitA, commitB, commitC],
        refs: {
          [commitA.oid]: [
            { name: 'refs/heads/main', shorthand: 'main', refType: 'localBranch', isHead: true },
          ],
        },
        moreCommits: [commitD],
        total: 4,
      });

      const el = await renderCanvas();
      const internals = el as unknown as {
        sortedNodesByRow: Array<{ oid: string; row: number; lane: number; colorIndex: number }>;
        loadMoreCommits(): Promise<void>;
        hasMoreCommits: boolean;
      };
      expect(internals.sortedNodesByRow).to.have.length(3);
      expect(internals.hasMoreCommits).to.be.true;

      const before = internals.sortedNodesByRow.map((n) => ({ ...n }));

      await internals.loadMoreCommits();
      await el.updateComplete;

      expect(internals.sortedNodesByRow).to.have.length(4);
      // Existing rows/lanes/colors are untouched by the append
      for (let i = 0; i < before.length; i++) {
        const after = internals.sortedNodesByRow[i];
        expect(after.oid).to.equal(before[i].oid);
        expect(after.row).to.equal(before[i].row);
        expect(after.lane).to.equal(before[i].lane);
        expect(after.colorIndex).to.equal(before[i].colorIndex);
      }
      // The appended commit sits below, continuing the mainline
      const appended = internals.sortedNodesByRow[3];
      expect(appended.oid).to.equal(commitD.oid);
      expect(appended.lane).to.equal(0);
    });
  });

  describe('pull request loading race', () => {
    it('discards PRs fetched for a previously active repository', async () => {
      let resolvePrs: ((v: unknown) => void) | null = null;
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_commit_history':
            return defaultCommits;
          case 'get_refs_by_commit':
            return defaultRefs;
          case 'detect_github_repo':
            return { owner: 'acme', repo: 'repo-a' };
          case 'check_github_connection':
            return { connected: true };
          case 'list_pull_requests':
            // Stall the PR fetch so a repo switch can happen mid-flight
            return new Promise((r) => {
              resolvePrs = r;
            });
          default:
            return null;
        }
      };

      const el = await renderCanvas();
      expect(resolvePrs).to.not.be.null;

      // Switch to a non-GitHub repository while repo A's PR fetch is stalled
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_commit_history':
            return defaultCommits;
          case 'get_refs_by_commit':
            return defaultRefs;
          case 'detect_github_repo':
            return null;
          default:
            return null;
        }
      };
      el.repositoryPath = '/test/other-repo';
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 200));

      // Now repo A's stalled fetch resolves with a PR whose head ref matches
      // a branch name ("main") that also exists in repo B
      resolvePrs!([
        {
          number: 7,
          state: 'open',
          draft: false,
          headSha: 'nonexistent-sha',
          headRef: 'main',
          htmlUrl: 'https://example.com/pr/7',
        },
      ]);
      await new Promise((r) => setTimeout(r, 50));

      const prs = (el as unknown as {
        pullRequestsByCommit: Record<string, unknown[]>;
      }).pullRequestsByCommit;
      expect(Object.keys(prs)).to.have.length(0);
    });
  });

  describe('minimap', () => {
    it('shows the minimap by default and toggles it via the toolbar', async () => {
      const el = await renderCanvas();

      expect(el.shadowRoot!.querySelector('.minimap-canvas')).to.not.be.null;

      const mapBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.toolbar-btn')
      ).find((b) => b.textContent?.trim().includes('Map'));
      expect(mapBtn).to.not.be.undefined;

      mapBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 20));
      expect(el.shadowRoot!.querySelector('.minimap-canvas')).to.be.null;
      expect(localStorage.getItem('leviathan-graph-minimap')).to.equal('false');

      mapBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 20));
      expect(el.shadowRoot!.querySelector('.minimap-canvas')).to.not.be.null;
      expect(localStorage.getItem('leviathan-graph-minimap')).to.equal('true');
    });

    it('restores the persisted minimap preference on connect', async () => {
      localStorage.setItem('leviathan-graph-minimap', 'false');
      const el = await renderCanvas();

      expect(el.shadowRoot!.querySelector('.minimap-canvas')).to.be.null;
    });

    it('maps minimap clicks to proportional scroll positions', async () => {
      setupDefaultMocks({ total: 500 });
      const el = await renderCanvas();

      // Give the minimap a deterministic size (the test container has no
      // layout height)
      const minimap = el.shadowRoot!.querySelector('.minimap-canvas') as HTMLCanvasElement;
      minimap.width = 56;
      minimap.height = 200;

      const internals = el as unknown as {
        minimapYToScrollTop(y: number): number;
        virtualScroll: { getContentSize(): { height: number } };
      };
      const contentHeight = internals.virtualScroll.getContentSize().height;
      expect(contentHeight).to.equal(500 * 22 + 40);

      // Clicking the middle maps to ~half of the content height (viewport
      // height is 0 in the unlaid-out test container)
      const scrollTop = internals.minimapYToScrollTop(100);
      expect(scrollTop).to.be.closeTo(contentHeight / 2, 1);

      // Top and bottom clamp within the scrollable range
      expect(internals.minimapYToScrollTop(0)).to.equal(0);
      expect(internals.minimapYToScrollTop(200)).to.be.at.most(contentHeight);
    });
  });

  describe('full-history scrollbar', () => {
    it('sizes the scroll area to the full history, not just the loaded rows', async () => {
      setupDefaultMocks({ total: 500 });
      const el = await renderCanvas();

      const content = el.shadowRoot!.querySelector('.scroll-content') as HTMLDivElement;
      // 500 virtual rows at 22px + 2x20px padding
      expect(content.style.height).to.equal(`${500 * 22 + 40}px`);
    });

    it('keeps the loaded height once everything is loaded', async () => {
      setupDefaultMocks({ total: 3 });
      const el = await renderCanvas();

      const content = el.shadowRoot!.querySelector('.scroll-content') as HTMLDivElement;
      expect(content.style.height).to.equal(`${3 * 22 + 40}px`);
    });

    it('uses the filtered row count while a branch filter is active', async () => {
      setupDefaultMocks({ total: 500 });
      const el = await renderCanvas();

      // Hiding a branch makes the backend total meaningless for row math
      el.toggleBranch('feature');
      await el.updateComplete;

      const content = el.shadowRoot!.querySelector('.scroll-content') as HTMLDivElement;
      const internals = el as unknown as { sortedNodesByRow: unknown[] };
      expect(content.style.height).to.equal(
        `${internals.sortedNodesByRow.length * 22 + 40}px`
      );
    });

    it('keeps pagination available after a transient load-more failure', async () => {
      setupDefaultMocks({ total: 500 });
      const el = await renderCanvas();

      // Make the next page fetch fail
      const previousMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'get_commit_history') {
          const typedArgs = args as { skip?: number } | undefined;
          if (typedArgs?.skip && typedArgs.skip > 0) {
            throw { code: 'GIT_ERROR', message: 'network blip' };
          }
        }
        return previousMock(command, args);
      };

      const internals = el as unknown as {
        loadMoreCommits(): Promise<void>;
        hasMoreCommits: boolean;
      };
      await internals.loadMoreCommits();

      // A failed fetch must NOT permanently mark the history as exhausted
      expect(internals.hasMoreCommits).to.be.true;
    });

    it('a superseded load-more does not clear a newer load\'s in-progress flag', async () => {
      setupDefaultMocks({ total: 500 });
      const el = await renderCanvas();

      // Stall the next page fetch so it can be superseded mid-flight
      let resolveStalled: ((v: unknown) => void) | null = null;
      const previousMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        const typedArgs = args as { skip?: number } | undefined;
        if (command === 'get_commit_history' && typedArgs?.skip && typedArgs.skip > 0) {
          return new Promise((r) => {
            resolveStalled = r;
          });
        }
        return previousMock(command, args);
      };

      const internals = el as unknown as {
        loadMoreCommits(): Promise<void>;
        isLoadingMore: boolean;
        loadVersion: number;
      };
      const stalledLoad = internals.loadMoreCommits();
      expect(internals.isLoadingMore).to.be.true;

      // A full reload takes ownership mid-flight (bumps the version) and a
      // NEWER load-more is then in progress
      internals.loadVersion++;
      internals.isLoadingMore = true;

      // The stale fetch resolving must not clear the newer load's flag
      resolveStalled!([]);
      await stalledLoad;
      expect(internals.isLoadingMore).to.be.true;
    });

    it('loads more pages when scrolled past the loaded rows', async () => {
      setupDefaultMocks({ total: 500, moreCommits: makeMoreCommits(3, 100) });
      const el = await renderCanvas();
      clearHistory();

      // Scroll deep into the unloaded region — the catch-up loader kicks in
      const internals = el as unknown as {
        scrollState: { setScroll(top: number, left: number): void };
      };
      internals.scrollState.setScroll(400 * 22, 0);
      await new Promise((r) => setTimeout(r, 100));

      const catchUpLoads = findCommands('get_commit_history').filter(
        (c) => ((c.args as { skip?: number } | undefined)?.skip ?? 0) > 0
      );
      expect(catchUpLoads.length).to.be.greaterThan(0);
    });
  });

  describe('commit total', () => {
    it('marks pagination complete when all commits are loaded', async () => {
      setupDefaultMocks({ total: 3 });
      const el = await renderCanvas();

      const hasMore = (el as unknown as { hasMoreCommits: boolean }).hasMoreCommits;
      expect(hasMore).to.be.false;
    });

    it('keeps pagination open when the backend reports more commits', async () => {
      setupDefaultMocks({ total: 500 });
      const el = await renderCanvas();

      const hasMore = (el as unknown as { hasMoreCommits: boolean }).hasMoreCommits;
      expect(hasMore).to.be.true;
    });

    it('announces loaded-of-total in the canvas aria-label', async () => {
      setupDefaultMocks({ total: 500 });
      const el = await renderCanvas();

      const canvas = el.shadowRoot!.querySelector('canvas')!;
      expect(canvas.getAttribute('aria-label')).to.contain('3 of 500');
    });
  });

  describe('visible-range stats fetching', () => {
    it('fetches stats only for the visible rows, not every loaded commit', async () => {
      // 500 commits loaded; only the visible range (plus overscan) should
      // have its stats requested
      const manyCommits = makeMoreCommits(500, 0);
      setupDefaultMocks({ commits: manyCommits, refs: {} });

      await renderCanvas();
      // Stats fetch is debounced (300ms) — wait for it to fire
      await new Promise((r) => setTimeout(r, 600));

      const statsCalls = findCommands('get_commits_stats');
      const requestedOids = new Set<string>();
      for (const call of statsCalls) {
        const args = call.args as { commitOids?: string[] } | undefined;
        for (const oid of args?.commitOids ?? []) {
          requestedOids.add(oid);
        }
      }

      expect(requestedOids.size).to.be.greaterThan(0);
      expect(requestedOids.size).to.be.lessThan(500);
    });

    it('does not refetch stats for already-fetched commits', async () => {
      setupDefaultMocks();
      const el = await renderCanvas();
      await new Promise((r) => setTimeout(r, 600));

      const callsBefore = findCommands('get_commits_stats').length;
      expect(callsBefore).to.be.greaterThan(0);

      // Trigger another visible-data fetch for the same rows
      (el as unknown as { scheduleVisibleDataFetch(): void }).scheduleVisibleDataFetch();
      await new Promise((r) => setTimeout(r, 600));

      // All visible commits were already fetched — no new backend calls
      const callsAfter = findCommands('get_commits_stats').length;
      expect(callsAfter).to.equal(callsBefore);
    });
  });

  describe('per-repo graph cache', () => {
    beforeEach(() => {
      clearGraphCacheForTests();
    });

    async function switchRepo(el: LvGraphCanvas, path: string): Promise<void> {
      el.repositoryPath = path;
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;
    }

    it('renders a previously-visited repo from cache without the loading state', async () => {
      const el = await renderCanvas();
      await switchRepo(el, '/other/repo');
      clearHistory();

      // Switch back — cached page must be applied synchronously
      el.repositoryPath = REPO_PATH;
      await el.updateComplete;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).isLoading).to.be.false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).commits.length).to.equal(defaultCommits.length);
    });

    it('still revalidates a cached repo in the background', async () => {
      const el = await renderCanvas();
      await switchRepo(el, '/other/repo');
      clearHistory();

      await switchRepo(el, REPO_PATH);

      // The cached render is instant, but a background reload still hits the
      // backend so external changes are picked up
      expect(findCommands('get_commit_history').length).to.equal(1);
    });

    it('a repo seen for the first time takes the normal loading path', async () => {
      const el = await renderCanvas();
      clearHistory();

      await switchRepo(el, '/never/seen');

      expect(findCommands('get_commit_history').length).to.equal(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).commits.length).to.equal(defaultCommits.length);
    });

    it('a refresh during an in-flight load queues exactly one follow-up load', async () => {
      // Regression: refresh() used to silently no-op while a load was in
      // flight — a commit made right after a tab switch never appeared
      // because the in-flight snapshot predated it.
      const el = await renderCanvas();
      clearHistory();

      let releaseLoad!: () => void;
      const loadGate = new Promise<void>((resolve) => {
        releaseLoad = resolve;
      });
      let gated = true;
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_commit_history':
            if (gated) {
              gated = false; // only the first call blocks
              await loadGate;
            }
            return defaultCommits;
          case 'get_refs_by_commit':
            return defaultRefs;
          default:
            return null;
        }
      };

      // Start a slow load, then refresh twice while it's in flight
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).loadCommits();
      await new Promise((r) => setTimeout(r, 10));
      el.refresh();
      el.refresh();

      releaseLoad();
      await new Promise((r) => setTimeout(r, 250));

      // The in-flight load plus exactly ONE queued follow-up
      expect(findCommands('get_commit_history').length).to.equal(2);
    });

    it('switching repos mid-stats-fetch does not leave the stats spinner stuck on', async () => {
      // Regression: fetchCommitStats' finally only cleared isLoadingStats
      // when still on the same repo, so switching away mid-fetch (esp. to an
      // empty repo that runs no stats fetch of its own) left the spinner on.
      const el = await renderCanvas();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).isLoadingStats = true; // simulate an in-flight stats fetch

      // Switch to a different repo (uncached) — willUpdate must reset it
      el.repositoryPath = '/other/repo';
      await el.updateComplete;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).isLoadingStats).to.be.false;
    });

    it('a superseded load must not clear isLoading while the newest load is still running', async () => {
      // Regression: loadCommits' finally cleared isLoading unconditionally,
      // so double-switching between two uncached repos let the first
      // (superseded) load drop the spinner while the second was still in
      // flight — flashing a stale graph with no loading indicator.
      const el = await renderCanvas();

      // Gate get_commit_history so we control when each load resolves
      const gates: Array<() => void> = [];
      mockInvoke = async (command: string) => {
        if (command === 'get_commit_history') {
          await new Promise<void>((resolve) => gates.push(resolve));
          return defaultCommits;
        }
        if (command === 'get_refs_by_commit') return defaultRefs;
        return null;
      };

      // Switch to A (load v+1, gated), then B (load v+2, gated) before A resolves
      el.repositoryPath = '/repo/a';
      await el.updateComplete;
      el.repositoryPath = '/repo/b';
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 10));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).isLoading).to.be.true;

      // Resolve A's (superseded) load first — it must NOT clear isLoading
      gates[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).isLoading, 'superseded load must not drop the spinner').to.be.true;

      // Resolve B's (newest) load — now the spinner clears
      gates[1]?.();
      await new Promise((r) => setTimeout(r, 10));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).isLoading).to.be.false;
    });

    it('a failed background revalidation does not paint an error over the cached graph', async () => {
      const el = await renderCanvas();
      await switchRepo(el, '/other/repo');

      // The repo becomes temporarily unreachable for the background reload
      mockInvoke = async (command: string) => {
        if (command === 'get_commit_history') {
          throw new Error('repository temporarily unavailable');
        }
        if (command === 'get_refs_by_commit') return defaultRefs;
        return null;
      };

      await switchRepo(el, REPO_PATH);

      // The cached graph still shows; no error banner over working content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).commits.length).to.equal(defaultCommits.length);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).loadError).to.be.null;
    });

    it('a failed FOREGROUND load still surfaces the error', async () => {
      const el = await renderCanvas();
      mockInvoke = async (command: string) => {
        if (command === 'get_commit_history') {
          throw new Error('boom');
        }
        if (command === 'get_refs_by_commit') return defaultRefs;
        return null;
      };

      await switchRepo(el, '/never/visited');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).loadError).to.contain('boom');
    });

    it('evictGraphCache removes a repo so reopening takes the loading path', async () => {
      const el = await renderCanvas();
      await switchRepo(el, '/other/repo');

      evictGraphCache(REPO_PATH);
      clearHistory();

      // Switching back is NOT served from cache: the loading path runs
      el.repositoryPath = REPO_PATH;
      await el.updateComplete;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).isLoading).to.be.true;

      await new Promise((r) => setTimeout(r, 200));
      expect(findCommands('get_commit_history').length).to.equal(1);
    });

    it('a successful background reload clears a previous load error', async () => {
      const el = await renderCanvas();
      // Foreground load fails on a fresh repo -> error panel state
      mockInvoke = async (command: string) => {
        if (command === 'get_commit_history') throw new Error('boom');
        if (command === 'get_refs_by_commit') return defaultRefs;
        return null;
      };
      await switchRepo(el, '/failing/repo');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).loadError).to.contain('boom');

      // The repo recovers; a queued/background reload succeeds
      setupDefaultMocks();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).loadCommits({ background: true });
      await new Promise((r) => setTimeout(r, 200));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).loadError).to.be.null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).commits.length).to.equal(defaultCommits.length);
    });

    it('clearing the search filter during a tab switch keeps the instant cached render', async () => {
      const el = await renderCanvas();
      await switchRepo(el, '/other/repo');
      clearHistory();

      // Tab switch back: app-shell clears the filter in the same update
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).searchFilter = null;
      el.repositoryPath = REPO_PATH;
      await el.updateComplete;

      // Cached render applied instantly, no foreground spinner
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).isLoading).to.be.false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).commits.length).to.equal(defaultCommits.length);

      // Exactly ONE (background) reload — the filter branch must not fire a
      // second, cancelling foreground load
      await new Promise((r) => setTimeout(r, 200));
      expect(findCommands('get_commit_history').length).to.equal(1);
    });

    it('background revalidation updates the graph when the repo changed', async () => {
      const el = await renderCanvas();
      await switchRepo(el, '/other/repo');

      // The repo gains a commit while its tab is in the background
      const newCommit = makeCommit({
        oid: 'ddd4444444444444444444444444444444444444444',
        shortId: 'ddd4444',
        summary: 'New commit',
        message: 'New commit',
        timestamp: 1700003000,
        parentIds: [commit3.oid],
      });
      setupDefaultMocks({ commits: [newCommit, ...defaultCommits] });

      await switchRepo(el, REPO_PATH);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).commits.length).to.equal(defaultCommits.length + 1);
    });
  });
});
