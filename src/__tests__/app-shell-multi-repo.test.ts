/**
 * Multi-repo correctness tests for app-shell:
 * - autofetch results from BACKGROUND repos must not drive the toolbar badge
 * - remote-update toasts must name the repo they belong to
 * - watcher events for background repos mark them stale instead of refreshing
 * - closing a repo tears down its watcher and search index
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
const invokeCallArgs: Array<{ command: string; args: Record<string, unknown> }> = [];

let cbId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => {
    invokeCallArgs.push({ command, args: args || {} });
    return Promise.resolve(null);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';
import type { AppShell } from '../app-shell.ts';
import '../app-shell.ts';
import { uiStore, repositoryStore } from '../stores/index.ts';
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
    uiStore.setState({ toasts: [] });
    repositoryStore.getState().reset();
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
