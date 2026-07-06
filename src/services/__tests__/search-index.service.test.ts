import { expect } from '@open-wc/testing';

// Track mock calls
const invokeCallArgs: Array<{ command: string; args: Record<string, unknown> }> = [];

// When set, build_search_index waits on this before resolving — lets tests
// interleave a drop() with an in-flight build
let pendingBuildGate: Promise<void> | null = null;
let pendingRefreshGate: Promise<void> | null = null;

// Mock Tauri API before importing any modules that use it
const mockInvoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  invokeCallArgs.push({ command, args: args || {} });

  switch (command) {
    case 'build_search_index':
      if (pendingBuildGate) await pendingBuildGate;
      return Promise.resolve(500);
    case 'refresh_search_index':
      if (pendingRefreshGate) await pendingRefreshGate;
      return Promise.resolve(502);
    case 'search_index':
      return Promise.resolve([
        {
          oid: 'abc1234567890',
          shortOid: 'abc1234',
          summary: 'Test commit',
          messageLower: 'test commit',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          authorDate: 1700000000,
          parentCount: 1,
        },
      ]);
    default:
      return Promise.resolve(null);
  }
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import after mock is set up - need to get a fresh instance
// Since the module exports a singleton, we test through the singleton
import { searchIndexService } from '../search-index.service.ts';

describe('SearchIndexService', () => {
  beforeEach(() => {
    invokeCallArgs.length = 0;
    pendingBuildGate = null;
    pendingRefreshGate = null;
    searchIndexService.invalidate();
  });

  describe('buildIndex', () => {
    it('should call build_search_index command', async () => {
      await searchIndexService.buildIndex('/path/to/repo');

      const buildCall = invokeCallArgs.find((c) => c.command === 'build_search_index');
      expect(buildCall).to.not.be.undefined;
      expect(buildCall!.args.path).to.equal('/path/to/repo');
    });

    it('should build indexes for multiple repos concurrently without dropping any', async () => {
      // Regression: a global "building" flag used to silently skip every
      // build after the first when several repos were restored at startup.
      await Promise.all([
        searchIndexService.buildIndex('/repo/one'),
        searchIndexService.buildIndex('/repo/two'),
        searchIndexService.buildIndex('/repo/three'),
      ]);

      const buildPaths = invokeCallArgs
        .filter((c) => c.command === 'build_search_index')
        .map((c) => c.args.path);
      expect(buildPaths).to.have.members(['/repo/one', '/repo/two', '/repo/three']);
      expect(searchIndexService.isReady('/repo/one')).to.be.true;
      expect(searchIndexService.isReady('/repo/two')).to.be.true;
      expect(searchIndexService.isReady('/repo/three')).to.be.true;
    });

    it('should deduplicate concurrent builds for the SAME repo', async () => {
      await Promise.all([
        searchIndexService.buildIndex('/repo/one'),
        searchIndexService.buildIndex('/repo/one'),
      ]);

      const buildCalls = invokeCallArgs.filter((c) => c.command === 'build_search_index');
      expect(buildCalls.length).to.equal(1);
    });

    it('should set index as ready after building', async () => {
      expect(searchIndexService.isReady()).to.be.false;
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady()).to.be.true;
    });

    it('should track the repo path', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady('/path/to/repo')).to.be.true;
      expect(searchIndexService.isReady('/other/repo')).to.be.false;
    });
  });

  describe('search', () => {
    it('should return null when index not ready', async () => {
      const result = await searchIndexService.search('/path/to/repo', { query: 'test' });
      expect(result).to.be.null;
    });

    it('should search via search_index command when ready', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      invokeCallArgs.length = 0;

      const result = await searchIndexService.search('/path/to/repo', { query: 'test' });
      expect(result).to.not.be.null;
      expect(result!.length).to.equal(1);
      expect(result![0].oid).to.equal('abc1234567890');

      const searchCall = invokeCallArgs.find((c) => c.command === 'search_index');
      expect(searchCall).to.not.be.undefined;
    });

    it('should pass the repo path to the backend so results come from the right repo', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      invokeCallArgs.length = 0;

      await searchIndexService.search('/path/to/repo', { query: 'test' });

      const searchCall = invokeCallArgs.find((c) => c.command === 'search_index');
      expect(searchCall!.args.path).to.equal('/path/to/repo');
    });

    it('should return null for a repo whose index is not built, even when another repo is ready', async () => {
      // Regression: with a single global index, searching repo B used to
      // return repo A's commits.
      await searchIndexService.buildIndex('/repo/one');

      const result = await searchIndexService.search('/repo/two', { query: 'test' });
      expect(result).to.be.null;
    });

    it('should cache search results', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      invokeCallArgs.length = 0;

      // First search
      await searchIndexService.search('/path/to/repo', { query: 'test' });
      const firstCallCount = invokeCallArgs.filter((c) => c.command === 'search_index').length;
      expect(firstCallCount).to.equal(1);

      // Second search with same params should hit cache
      await searchIndexService.search('/path/to/repo', { query: 'test' });
      const secondCallCount = invokeCallArgs.filter((c) => c.command === 'search_index').length;
      expect(secondCallCount).to.equal(1); // Should not increase
    });
  });

  describe('invalidate', () => {
    it('should reset index ready state', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady()).to.be.true;

      searchIndexService.invalidate();
      expect(searchIndexService.isReady()).to.be.false;
    });

    it('should clear cache on invalidate', async () => {
      await searchIndexService.buildIndex('/path/to/repo');

      // Fill cache
      await searchIndexService.search('/path/to/repo', { query: 'test' });

      searchIndexService.invalidate();

      // After invalidate, search should return null (not from cache)
      const result = await searchIndexService.search('/path/to/repo', { query: 'test' });
      expect(result).to.be.null;
    });
  });

  describe('invalidate with a path', () => {
    it('should only invalidate the given repo', async () => {
      await searchIndexService.buildIndex('/repo/one');
      await searchIndexService.buildIndex('/repo/two');

      searchIndexService.invalidate('/repo/one');

      expect(searchIndexService.isReady('/repo/one')).to.be.false;
      expect(searchIndexService.isReady('/repo/two')).to.be.true;
    });
  });

  describe('drop', () => {
    it('a build finishing AFTER its repo was dropped must not resurrect readiness', async () => {
      // Regression: open repo -> slow build starts -> user closes the tab
      // (drop) -> build completes. Without an epoch guard the completed
      // build re-marked the closed repo ready and leaked the backend index.
      let releaseBuild!: () => void;
      pendingBuildGate = new Promise((resolve) => {
        releaseBuild = resolve;
      });

      const building = searchIndexService.buildIndex('/repo/one');
      await searchIndexService.drop('/repo/one');
      invokeCallArgs.length = 0;

      releaseBuild();
      await building;

      expect(searchIndexService.isReady('/repo/one')).to.be.false;
      // The backend index inserted by the late build is freed again
      const dropCall = invokeCallArgs.find((c) => c.command === 'drop_search_index');
      expect(dropCall).to.not.be.undefined;
      expect(dropCall!.args.path).to.equal('/repo/one');
    });

    it('reopening a repo during an in-flight pre-drop build starts a fresh build', async () => {
      // Regression: buildIndex deduped purely on "a build is in flight", so
      // close-then-reopen during a slow build left the reopened tab with no
      // index at all (the old build self-dropped, nothing rebuilt).
      let releaseBuilds!: () => void;
      pendingBuildGate = new Promise((resolve) => {
        releaseBuilds = resolve;
      });

      const preDropBuild = searchIndexService.buildIndex('/repo/one');
      await searchIndexService.drop('/repo/one'); // tab closed mid-build
      const reopenBuild = searchIndexService.buildIndex('/repo/one'); // tab reopened

      releaseBuilds();
      await Promise.all([preDropBuild, reopenBuild]);

      const buildCalls = invokeCallArgs.filter((c) => c.command === 'build_search_index');
      expect(buildCalls.length).to.equal(2);
      // The reopened tab ends up READY (the post-drop build won)
      expect(searchIndexService.isReady('/repo/one')).to.be.true;
    });

    it('a LATE pre-drop build must not delete the index a reopen build created', async () => {
      // Regression: pre-drop build (epoch 0) resolves AFTER the reopen build
      // (epoch 1) already inserted a fresh index — its compensating drop
      // used to delete that fresh index while isReady stayed true.
      let releaseOldBuild!: () => void;
      pendingBuildGate = new Promise((resolve) => {
        releaseOldBuild = resolve;
      });
      const oldBuild = searchIndexService.buildIndex('/repo/one'); // epoch 0, slow
      await searchIndexService.drop('/repo/one'); // tab closed
      pendingBuildGate = null;
      await searchIndexService.buildIndex('/repo/one'); // reopen build, completes first
      expect(searchIndexService.isReady('/repo/one')).to.be.true;
      invokeCallArgs.length = 0;

      releaseOldBuild();
      await oldBuild;

      expect(invokeCallArgs.find((c) => c.command === 'drop_search_index')).to.be.undefined;
      expect(searchIndexService.isReady('/repo/one')).to.be.true;
    });

    it("a LATE pre-drop refresh must not delete the reopened repo's index", async () => {
      await searchIndexService.buildIndex('/repo/one');
      let releaseRefresh!: () => void;
      pendingRefreshGate = new Promise((resolve) => {
        releaseRefresh = resolve;
      });
      const staleRefresh = searchIndexService.refresh('/repo/one'); // slow
      await searchIndexService.drop('/repo/one'); // tab closed
      await searchIndexService.buildIndex('/repo/one'); // reopened + rebuilt
      expect(searchIndexService.isReady('/repo/one')).to.be.true;
      invokeCallArgs.length = 0;

      releaseRefresh();
      await staleRefresh;

      expect(invokeCallArgs.find((c) => c.command === 'drop_search_index')).to.be.undefined;
      expect(searchIndexService.isReady('/repo/one')).to.be.true;
    });

    it('a refresh finishing AFTER its repo was dropped frees the resurrected backend index', async () => {
      // Regression: handleRefresh fires refresh_search_index; if the tab is
      // closed while it runs, the backend refresh re-inserts an index for a
      // closed repo (or falls back to a full rebuild) — leaking it.
      await searchIndexService.buildIndex('/repo/one');
      let releaseRefresh!: () => void;
      pendingRefreshGate = new Promise((resolve) => {
        releaseRefresh = resolve;
      });

      const refreshing = searchIndexService.refresh('/repo/one');
      await searchIndexService.drop('/repo/one');
      invokeCallArgs.length = 0;

      releaseRefresh();
      await refreshing;

      const dropCall = invokeCallArgs.find((c) => c.command === 'drop_search_index');
      expect(dropCall).to.not.be.undefined;
      expect(dropCall!.args.path).to.equal('/repo/one');
      expect(searchIndexService.isReady('/repo/one')).to.be.false;
    });

    it('should call drop_search_index and clear readiness for that repo only', async () => {
      await searchIndexService.buildIndex('/repo/one');
      await searchIndexService.buildIndex('/repo/two');
      invokeCallArgs.length = 0;

      await searchIndexService.drop('/repo/one');

      const dropCall = invokeCallArgs.find((c) => c.command === 'drop_search_index');
      expect(dropCall).to.not.be.undefined;
      expect(dropCall!.args.path).to.equal('/repo/one');
      expect(searchIndexService.isReady('/repo/one')).to.be.false;
      expect(searchIndexService.isReady('/repo/two')).to.be.true;
    });
  });

  describe('isReady', () => {
    it('should return false initially', () => {
      expect(searchIndexService.isReady()).to.be.false;
    });

    it('should return false for wrong repo path', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady('/other/repo')).to.be.false;
    });

    it('should return true for correct repo path', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady('/path/to/repo')).to.be.true;
    });
  });
});
