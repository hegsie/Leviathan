/**
 * Multi-repo correctness tests for app-shell:
 * - autofetch results from BACKGROUND repos must not drive the toolbar badge
 * - remote-update toasts must name the repo they belong to
 * - watcher events for background repos mark them stale instead of refreshing
 * - closing a repo tears down its watcher and search index
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
const invokeCallArgs: Array<{ command: string; args: Record<string, unknown> }> = [];
// Per-command mock responses; commands without a handler resolve to null
const mockResponses: Record<string, (args: Record<string, unknown>) => unknown> = {};

let cbId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => {
    invokeCallArgs.push({ command, args: args || {} });
    const handler = mockResponses[command];
    return Promise.resolve(handler ? handler(args || {}) : null);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, waitUntil } from '@open-wc/testing';
import type { AppShell } from '../app-shell.ts';
import '../app-shell.ts';
import { uiStore, repositoryStore, settingsStore } from '../stores/index.ts';
import { searchIndexService } from '../services/search-index.service.ts';
import type { Repository } from '../types/git.types.ts';

function createAppShell(): AppShell {
  return document.createElement('lv-app-shell') as AppShell;
}

function mockRepo(path: string, name: string): Repository {
  return {
    path,
    name,
    isValid: true,
    isBare: false,
    headRef: 'main',
    state: 'clean',
    isShallow: false,
    isPartialClone: false,
    cloneFilter: null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('app-shell multi-repo behavior', () => {
  beforeEach(() => {
    invokeCallArgs.length = 0;
    for (const key of Object.keys(mockResponses)) {
      delete mockResponses[key];
    }
    uiStore.setState({ toasts: [] });
    repositoryStore.getState().reset();
    searchIndexService.invalidate();
  });

  describe('autofetch badge scoping', () => {
    it('updates the badge when the ACTIVE repo fetched', () => {
      const el = createAppShell();
      (el as any).activeRepository = { repository: mockRepo('/repo/active', 'active') };

      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/active',
        success: true,
        ahead: 1,
        behind: 2,
      });

      expect((el as any).remoteStatus).to.deep.equal({ ahead: 1, behind: 2 });
    });

    it('ignores results from BACKGROUND repos', () => {
      const el = createAppShell();
      (el as any).activeRepository = { repository: mockRepo('/repo/active', 'active') };
      (el as any).remoteStatus = { ahead: 0, behind: 0 };

      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/background',
        success: true,
        ahead: 9,
        behind: 9,
      });

      expect((el as any).remoteStatus).to.deep.equal({ ahead: 0, behind: 0 });
    });

    it('ignores failed fetches', () => {
      const el = createAppShell();
      (el as any).activeRepository = { repository: mockRepo('/repo/active', 'active') };
      (el as any).remoteStatus = { ahead: 0, behind: 0 };

      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/active',
        success: false,
        ahead: 5,
        behind: 5,
      });

      expect((el as any).remoteStatus).to.deep.equal({ ahead: 0, behind: 0 });
    });
  });

  describe('remote-updates toast', () => {
    it('names the repo the commits arrived in', () => {
      const el = createAppShell();

      (el as any).handleRemoteUpdatesAvailable({
        repoPath: '/home/user/projects/api-server',
        behind: 3,
        ahead: 0,
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].message).to.contain('api-server');
      expect(toasts[0].message).to.contain('3 new commits');
    });

    it('uses singular wording for one commit', () => {
      const el = createAppShell();

      (el as any).handleRemoteUpdatesAvailable({
        repoPath: '/home/user/projects/api-server',
        behind: 1,
        ahead: 0,
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts[0].message).to.contain('1 new commit available');
    });
  });

  describe('auto-fetch lifecycle across open repos', () => {
    it('starts auto-fetch for newly opened repos when an interval is set', async () => {
      settingsStore.setState({ autoFetchInterval: 5 });
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        await new Promise((r) => setTimeout(r, 0));

        const startCall = invokeCallArgs.find((c) => c.command === 'start_auto_fetch');
        expect(startCall).to.not.be.undefined;
        expect(startCall!.args.path).to.equal('/repo/one');
      } finally {
        el.remove();
        settingsStore.setState({ autoFetchInterval: 0 });
      }
    });

    it('does not start auto-fetch when the interval is disabled', async () => {
      settingsStore.setState({ autoFetchInterval: 0 });
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        await new Promise((r) => setTimeout(r, 0));

        expect(invokeCallArgs.find((c) => c.command === 'start_auto_fetch')).to.be.undefined;
      } finally {
        el.remove();
      }
    });

    it('does not restart auto-fetch timers on unrelated settings changes', async () => {
      // Regression: every settings write (theme, tray, ...) restarted every
      // repo's fetch timer, indefinitely deferring the first fetch for users
      // who tweak settings often.
      settingsStore.setState({ autoFetchInterval: 5 });
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        await new Promise((r) => setTimeout(r, 0));
        invokeCallArgs.length = 0;

        settingsStore.setState({ minimizeToTray: true });
        await new Promise((r) => setTimeout(r, 0));
        expect(invokeCallArgs.find((c) => c.command === 'start_auto_fetch')).to.be.undefined;

        // An ACTUAL interval change does restart
        settingsStore.setState({ autoFetchInterval: 10 });
        await new Promise((r) => setTimeout(r, 0));
        const startCall = invokeCallArgs.find((c) => c.command === 'start_auto_fetch');
        expect(startCall).to.not.be.undefined;
        expect(startCall!.args.intervalMinutes).to.equal(10);
      } finally {
        el.remove();
        settingsStore.setState({ autoFetchInterval: 0, minimizeToTray: false });
      }
    });

    it('stops auto-fetch when a repo tab is closed', async () => {
      settingsStore.setState({ autoFetchInterval: 5 });
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
        await new Promise((r) => setTimeout(r, 0));
        invokeCallArgs.length = 0;

        repositoryStore.getState().removeRepository('/repo/one');
        await new Promise((r) => setTimeout(r, 0));

        const stopCall = invokeCallArgs.find((c) => c.command === 'stop_auto_fetch');
        expect(stopCall).to.not.be.undefined;
        expect(stopCall!.args.path).to.equal('/repo/one');
      } finally {
        el.remove();
        settingsStore.setState({ autoFetchInterval: 0 });
      }
    });
  });

  describe('background autofetch results update tab badge data', () => {
    it("writes a background repo's ahead/behind into the store", () => {
      const el = createAppShell();
      repositoryStore.getState().addRepository(mockRepo('/repo/bg', 'bg'));
      repositoryStore.getState().updateRepoData('/repo/bg', {
        currentBranch: {
          name: 'main',
          shorthand: 'main',
          isHead: true,
          isRemote: false,
          upstream: 'origin/main',
          targetOid: 'abc',
          isStale: false,
        },
      });
      (el as any).activeRepository = { repository: mockRepo('/repo/active', 'active') };

      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/bg',
        success: true,
        ahead: 3,
        behind: 7,
      });

      const bg = repositoryStore.getState().openRepositories[0];
      expect(bg.currentBranch?.aheadBehind).to.deep.equal({ ahead: 3, behind: 7 });
      // The toolbar badge still only follows the ACTIVE repo
      expect((el as any).remoteStatus).to.be.null;
    });
  });

  describe('badge hydration throttling', () => {
    it('caps concurrent hydrations instead of firing one per repo at once', async () => {
      let releaseStatuses!: () => void;
      const statusGate = new Promise<void>((resolve) => {
        releaseStatuses = resolve;
      });
      mockResponses['get_status'] = () => statusGate.then(() => []);
      mockResponses['get_branches'] = () => statusGate.then(() => []);

      const el = createAppShell();
      document.body.appendChild(el);
      try {
        for (let i = 0; i < 5; i++) {
          repositoryStore
            .getState()
            .addRepository(mockRepo(`/repo/${i}`, `r${i}`), { activate: false });
        }
        await new Promise((r) => setTimeout(r, 10));

        // Only 2 hydrations (one get_status each) may be in flight at once
        const inFlight = invokeCallArgs.filter((c) => c.command === 'get_status').length;
        expect(inFlight).to.equal(2);

        releaseStatuses();
        await waitUntil(
          () => invokeCallArgs.filter((c) => c.command === 'get_status').length === 5,
          'expected the queue to drain all five hydrations'
        );
      } finally {
        el.remove();
      }
    });
  });

  describe('batch tab open (workspace-style)', () => {
    it('runs activation work only for the repo activated at the end', async () => {
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        searchIndexService.invalidate();
        // Open three repos the way workspace-open now does
        for (const p of ['/ws/one', '/ws/two', '/ws/three']) {
          repositoryStore.getState().addRepository(mockRepo(p, p), { activate: false });
        }
        repositoryStore.getState().setActiveByPath('/ws/three');
        await new Promise((r) => setTimeout(r, 10));

        const buildPaths = invokeCallArgs
          .filter((c) => c.command === 'build_search_index')
          .map((c) => c.args.path);
        expect(buildPaths).to.deep.equal(['/ws/three']);
      } finally {
        el.remove();
      }
    });
  });

  describe('tab close teardown extras', () => {
    it('cancels an in-flight embedding build for the closed repo', async () => {
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
        await new Promise((r) => setTimeout(r, 0));
        invokeCallArgs.length = 0;

        repositoryStore.getState().removeRepository('/repo/one');
        await new Promise((r) => setTimeout(r, 0));

        const cancelCall = invokeCallArgs.find((c) => c.command === 'cancel_embedding_build');
        expect(cancelCall).to.not.be.undefined;
        expect(cancelCall!.args.path).to.equal('/repo/one');
      } finally {
        el.remove();
      }
    });
  });

  describe('active repo badge liveness', () => {
    it('schedules a badge refresh for the ACTIVE repo when the right panel is hidden', () => {
      const el = createAppShell();
      (el as any).activeRepository = { repository: mockRepo('/repo/active', 'active') };
      (el as any).watchedRepoPaths = new Set(['/repo/active']);
      (el as any).rightPanelVisible = false;

      (el as any).handleWatcherEvent({
        repoPath: '/repo/active',
        eventType: 'workdir-changed',
        paths: [],
      });

      expect((el as any).badgeHydrationTimers.has('/repo/active')).to.be.true;
      // Cleanup the pending timer
      clearTimeout((el as any).badgeHydrationTimers.get('/repo/active'));
    });

    it('skips the badge refresh while the right panel is mounted (it already mirrors status)', () => {
      const el = createAppShell();
      (el as any).activeRepository = { repository: mockRepo('/repo/active', 'active') };
      (el as any).watchedRepoPaths = new Set(['/repo/active']);
      (el as any).rightPanelVisible = true;

      (el as any).handleWatcherEvent({
        repoPath: '/repo/active',
        eventType: 'workdir-changed',
        paths: [],
      });

      expect((el as any).badgeHydrationTimers.has('/repo/active')).to.be.false;
    });
  });

  describe('footer ahead/behind badge on tab switch', () => {
    it("resets to the newly active repo's last-known counts", async () => {
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/a', 'a'));
        repositoryStore.getState().addRepository(mockRepo('/repo/b', 'b'));
        repositoryStore.getState().updateRepoData('/repo/a', {
          currentBranch: {
            name: 'main',
            shorthand: 'main',
            isHead: true,
            isRemote: false,
            upstream: 'origin/main',
            targetOid: 'abc',
            isStale: false,
            aheadBehind: { ahead: 0, behind: 3 },
          },
        });
        // Simulate a badge left over from the previously active repo
        (el as any).remoteStatus = { ahead: 9, behind: 9 };

        repositoryStore.getState().setActiveIndex(0);
        await new Promise((r) => setTimeout(r, 0));
        expect((el as any).remoteStatus).to.deep.equal({ ahead: 0, behind: 3 });

        // Switching to a repo with no known counts clears the badge instead
        // of showing the previous repo's numbers
        repositoryStore.getState().setActiveIndex(1);
        await new Promise((r) => setTimeout(r, 0));
        expect((el as any).remoteStatus).to.be.null;
      } finally {
        el.remove();
      }
    });
  });

  describe('tab badge hydration', () => {
    it('loads status and branches into the store for newly opened repos', async () => {
      mockResponses['get_status'] = () => [
        { path: 'a.txt', status: 'modified', isStaged: false, isConflicted: false },
      ];
      mockResponses['get_branches'] = () => [
        {
          name: 'main',
          shorthand: 'main',
          isHead: true,
          isRemote: false,
          upstream: 'origin/main',
          targetOid: 'abc',
          isStale: false,
        },
      ];

      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        await waitUntil(
          () => repositoryStore.getState().openRepositories[0]?.status.length > 0,
          'expected status to be hydrated into the store'
        );

        const repo = repositoryStore.getState().openRepositories[0];
        expect(repo.status.length).to.equal(1);
        expect(repo.unstagedFiles.length).to.equal(1);
        expect(repo.currentBranch?.name).to.equal('main');
      } finally {
        el.remove();
      }
    });
  });

  describe('watcher lifecycle across open repos', () => {
    it('starts a watcher for every opened repo, not just the active one', async () => {
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
        await new Promise((r) => setTimeout(r, 0));

        const watched = invokeCallArgs
          .filter((c) => c.command === 'start_watching')
          .map((c) => c.args.path);
        expect(watched).to.include('/repo/one');
        expect(watched).to.include('/repo/two');
      } finally {
        el.remove();
      }
    });

    it('closing a repo stops its watcher and drops its search index', async () => {
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
        await new Promise((r) => setTimeout(r, 0));
        invokeCallArgs.length = 0;

        repositoryStore.getState().removeRepository('/repo/one');
        await new Promise((r) => setTimeout(r, 0));

        const stopCall = invokeCallArgs.find((c) => c.command === 'stop_watching');
        expect(stopCall).to.not.be.undefined;
        expect(stopCall!.args.path).to.equal('/repo/one');

        const dropCall = invokeCallArgs.find((c) => c.command === 'drop_search_index');
        expect(dropCall).to.not.be.undefined;
        expect(dropCall!.args.path).to.equal('/repo/one');
      } finally {
        el.remove();
      }
    });
  });

  describe('startup restore', () => {
    it('opens every persisted repo but builds indexes only for the active one', async () => {
      mockResponses['open_repository'] = (args) => mockRepo(args.path as string, 'restored');
      repositoryStore.setState({
        persistedOpenRepos: [
          { path: '/repo/one', name: 'one' },
          { path: '/repo/two', name: 'two' },
          { path: '/repo/three', name: 'three' },
        ],
      });

      const el = createAppShell();
      document.body.appendChild(el);
      try {
        await waitUntil(
          () => repositoryStore.getState().openRepositories.length === 3,
          'expected all three persisted repos to be restored'
        );
        // Allow post-restore async work (remotes, index kick-off) to settle
        await new Promise((r) => setTimeout(r, 50));

        const openedPaths = invokeCallArgs
          .filter((c) => c.command === 'open_repository')
          .map((c) => c.args.path);
        expect(openedPaths).to.have.members(['/repo/one', '/repo/two', '/repo/three']);

        // Index builds are lazy: only the ACTIVE repo (last restored) gets
        // one at startup — a search-index walk plus an embedding pass per
        // background repo made startup CPU-bound with many tabs.
        const buildPaths = invokeCallArgs
          .filter((c) => c.command === 'build_search_index')
          .map((c) => c.args.path);
        expect(buildPaths).to.deep.equal(['/repo/three']);
      } finally {
        el.remove();
      }
    });

    it('restores the tab that was active last session', async () => {
      mockResponses['open_repository'] = (args) => mockRepo(args.path as string, 'restored');
      repositoryStore.setState({
        persistedOpenRepos: [
          { path: '/repo/one', name: 'one' },
          { path: '/repo/two', name: 'two' },
          { path: '/repo/three', name: 'three' },
        ],
        persistedActivePath: '/repo/two',
      });

      const el = createAppShell();
      document.body.appendChild(el);
      try {
        await waitUntil(
          () => repositoryStore.getState().openRepositories.length === 3,
          'expected all three persisted repos to be restored'
        );
        await new Promise((r) => setTimeout(r, 50));

        expect(repositoryStore.getState().activeIndex).to.equal(1);
      } finally {
        el.remove();
      }
    });

    it('reports and prunes repos that fail to restore', async () => {
      mockResponses['open_repository'] = (args) => {
        if (args.path === '/repo/gone') {
          throw new Error('repository not found');
        }
        return mockRepo(args.path as string, 'restored');
      };
      repositoryStore.setState({
        persistedOpenRepos: [
          { path: '/repo/one', name: 'one' },
          { path: '/repo/gone', name: 'gone' },
        ],
      });

      const el = createAppShell();
      document.body.appendChild(el);
      try {
        await waitUntil(
          () => repositoryStore.getState().openRepositories.length === 1,
          'expected the healthy repo to be restored'
        );
        await waitUntil(
          () => uiStore.getState().toasts.length > 0,
          'expected a toast for the failed restore'
        );

        const toasts = uiStore.getState().toasts;
        expect(toasts[0].message).to.contain('gone');
        expect(toasts[0].type).to.equal('error');
        // Pruned: the failure is not silently retried on every launch
        const persisted = repositoryStore.getState().persistedOpenRepos.map((r) => r.path);
        expect(persisted).to.deep.equal(['/repo/one']);
      } finally {
        el.remove();
      }
    });

    it('builds a repo index lazily when its tab is first activated', async () => {
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
        await new Promise((r) => setTimeout(r, 0));
        // Simulate repos restored without indexes (the startup path skips
        // background repos' builds)
        searchIndexService.invalidate();
        invokeCallArgs.length = 0;

        repositoryStore.getState().setActiveIndex(0);
        await new Promise((r) => setTimeout(r, 0));

        const buildPaths = invokeCallArgs
          .filter((c) => c.command === 'build_search_index')
          .map((c) => c.args.path);
        expect(buildPaths).to.deep.equal(['/repo/one']);
      } finally {
        el.remove();
      }
    });
  });

  describe('tab cycling shortcuts', () => {
    it('cycles forward and wraps at the end', () => {
      const el = createAppShell();
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
      repositoryStore.getState().addRepository(mockRepo('/repo/three', 'three'));
      // active is 2 (last added)

      (el as any).cycleRepositoryTab(1);
      expect(repositoryStore.getState().activeIndex).to.equal(0);
      (el as any).cycleRepositoryTab(1);
      expect(repositoryStore.getState().activeIndex).to.equal(1);
    });

    it('cycles backward and wraps at the start', () => {
      const el = createAppShell();
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
      repositoryStore.getState().setActiveIndex(0);

      (el as any).cycleRepositoryTab(-1);
      expect(repositoryStore.getState().activeIndex).to.equal(1);
    });

    it('is a no-op with fewer than two repos', () => {
      const el = createAppShell();
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));

      (el as any).cycleRepositoryTab(1);
      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });
  });

  describe('background repo staleness', () => {
    it('marks a background repo stale on watcher events instead of refreshing it', () => {
      const el = createAppShell();
      (el as any).activeRepository = { repository: mockRepo('/repo/active', 'active') };
      (el as any).watchedRepoPaths = new Set(['/repo/active', '/repo/background']);

      let refreshed = 0;
      (el as any).handleRefresh = () => {
        refreshed++;
        return Promise.resolve();
      };

      (el as any).handleWatcherEvent({
        repoPath: '/repo/background',
        eventType: 'refs-changed',
        paths: [],
      });

      expect(refreshed).to.equal(0);
      expect((el as any).staleRepoPaths.has('/repo/background')).to.be.true;
    });

    it('debounce-refreshes when the ACTIVE repo has ref changes', async () => {
      const el = createAppShell();
      (el as any).activeRepository = { repository: mockRepo('/repo/active', 'active') };

      let refreshed = 0;
      (el as any).handleRefresh = () => {
        refreshed++;
        return Promise.resolve();
      };

      (el as any).handleWatcherEvent({
        repoPath: '/repo/active',
        eventType: 'refs-changed',
        paths: [],
      });

      // refs-changed refresh is debounced by 200ms
      await new Promise((r) => setTimeout(r, 250));
      expect(refreshed).to.equal(1);
    });

    it('refreshes a stale repo when its tab becomes active', async () => {
      const el = createAppShell();
      document.body.appendChild(el);
      try {
        let refreshed = 0;
        (el as any).handleRefresh = () => {
          refreshed++;
          return Promise.resolve();
        };

        repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
        repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
        await new Promise((r) => setTimeout(r, 0));

        // Repo one changes while it's a background tab
        (el as any).handleWatcherEvent({
          repoPath: '/repo/one',
          eventType: 'refs-changed',
          paths: [],
        });
        expect(refreshed).to.equal(0);

        // Activating repo one triggers exactly one refresh and clears staleness
        repositoryStore.getState().setActiveIndex(0);
        await new Promise((r) => setTimeout(r, 0));
        expect(refreshed).to.equal(1);
        expect((el as any).staleRepoPaths.has('/repo/one')).to.be.false;

        // Switching back and forth again without new events does NOT re-refresh
        repositoryStore.getState().setActiveIndex(1);
        repositoryStore.getState().setActiveIndex(0);
        await new Promise((r) => setTimeout(r, 0));
        expect(refreshed).to.equal(1);
      } finally {
        el.remove();
      }
    });
  });
});
