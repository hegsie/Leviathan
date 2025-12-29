import { expect } from '@open-wc/testing';
import { repositoryStore } from '../repository.store.ts';
import type { Repository } from '../../types/git.types.ts';

describe('repository.store', () => {
  // Create mock repository
  function createMockRepo(path: string, name = 'test-repo'): Repository {
    return {
      path,
      name,
      isValid: true,
      isBare: false,
      headRef: 'main',
      state: 'clean',
    };
  }

  beforeEach(() => {
    // Reset store before each test
    repositoryStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts with no open repositories', () => {
      const state = repositoryStore.getState();
      expect(state.openRepositories.length).to.equal(0);
      expect(state.activeIndex).to.equal(-1);
    });

    it('starts with no loading state', () => {
      const state = repositoryStore.getState();
      expect(state.isLoading).to.be.false;
      expect(state.error).to.be.null;
    });
  });

  describe('addRepository', () => {
    it('adds a repository to open repositories', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);

      const state = repositoryStore.getState();
      expect(state.openRepositories.length).to.equal(1);
      expect(state.openRepositories[0].repository.path).to.equal('/test/path');
    });

    it('sets active index to new repository', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);

      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });

    it('does not duplicate existing repository', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);
      repositoryStore.getState().addRepository(repo);

      expect(repositoryStore.getState().openRepositories.length).to.equal(1);
    });

    it('adds repository to recent list', () => {
      const repo = createMockRepo('/test/path', 'my-repo');
      repositoryStore.getState().addRepository(repo);

      const state = repositoryStore.getState();
      expect(state.recentRepositories.length).to.be.greaterThan(0);
      expect(state.recentRepositories[0].path).to.equal('/test/path');
    });
  });

  describe('removeRepository', () => {
    it('removes a repository from open repositories', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);
      repositoryStore.getState().removeRepository('/test/path');

      expect(repositoryStore.getState().openRepositories.length).to.equal(0);
    });

    it('updates active index when removing active repository', () => {
      const repo1 = createMockRepo('/test/path1');
      const repo2 = createMockRepo('/test/path2');
      repositoryStore.getState().addRepository(repo1);
      repositoryStore.getState().addRepository(repo2);

      expect(repositoryStore.getState().activeIndex).to.equal(1);

      repositoryStore.getState().removeRepository('/test/path2');
      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });

    it('sets active index to -1 when removing last repository', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);
      repositoryStore.getState().removeRepository('/test/path');

      expect(repositoryStore.getState().activeIndex).to.equal(-1);
    });
  });

  describe('setActiveIndex', () => {
    it('changes active repository', () => {
      const repo1 = createMockRepo('/test/path1');
      const repo2 = createMockRepo('/test/path2');
      repositoryStore.getState().addRepository(repo1);
      repositoryStore.getState().addRepository(repo2);

      repositoryStore.getState().setActiveIndex(0);
      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });

    it('ignores invalid index', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);

      repositoryStore.getState().setActiveIndex(99);
      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });

    it('ignores negative index', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);

      repositoryStore.getState().setActiveIndex(-1);
      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });
  });

  describe('setActiveByPath', () => {
    it('sets active repository by path', () => {
      const repo1 = createMockRepo('/test/path1');
      const repo2 = createMockRepo('/test/path2');
      repositoryStore.getState().addRepository(repo1);
      repositoryStore.getState().addRepository(repo2);

      repositoryStore.getState().setActiveByPath('/test/path1');
      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });

    it('does nothing for non-existent path', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);

      repositoryStore.getState().setActiveByPath('/non/existent');
      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });
  });

  describe('setLoading and setError', () => {
    it('sets loading state', () => {
      repositoryStore.getState().setLoading(true);
      expect(repositoryStore.getState().isLoading).to.be.true;

      repositoryStore.getState().setLoading(false);
      expect(repositoryStore.getState().isLoading).to.be.false;
    });

    it('sets error and clears loading', () => {
      repositoryStore.getState().setLoading(true);
      repositoryStore.getState().setError('Test error');

      const state = repositoryStore.getState();
      expect(state.error).to.equal('Test error');
      expect(state.isLoading).to.be.false;
    });
  });

  describe('setBranches, setTags, setStashes, setRemotes', () => {
    beforeEach(() => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);
    });

    it('sets branches on active repository', () => {
      repositoryStore.getState().setBranches([{ name: 'main', shorthand: 'main', isHead: true, isRemote: false, targetOid: 'abc123', upstream: null, isStale: false }]);

      const active = repositoryStore.getState().getActiveRepository();
      expect(active?.branches.length).to.equal(1);
      expect(active?.branches[0].name).to.equal('main');
    });

    it('sets tags on active repository', () => {
      repositoryStore.getState().setTags([{ name: 'v1.0.0', targetOid: 'abc123', isAnnotated: false, message: null, tagger: null }]);

      const active = repositoryStore.getState().getActiveRepository();
      expect(active?.tags.length).to.equal(1);
      expect(active?.tags[0].name).to.equal('v1.0.0');
    });

    it('sets stashes on active repository', () => {
      repositoryStore.getState().setStashes([{ index: 0, message: 'WIP', oid: 'abc123' }]);

      const active = repositoryStore.getState().getActiveRepository();
      expect(active?.stashes.length).to.equal(1);
    });

    it('sets remotes on active repository', () => {
      repositoryStore.getState().setRemotes([{ name: 'origin', url: 'https://github.com/test/repo.git', pushUrl: null }]);

      const active = repositoryStore.getState().getActiveRepository();
      expect(active?.remotes.length).to.equal(1);
      expect(active?.remotes[0].name).to.equal('origin');
    });
  });

  describe('setStatus', () => {
    beforeEach(() => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);
    });

    it('sets status and separates staged/unstaged', () => {
      repositoryStore.getState().setStatus([
        { path: 'staged.txt', status: 'modified', isStaged: true, isConflicted: false },
        { path: 'unstaged.txt', status: 'modified', isStaged: false, isConflicted: false },
      ]);

      const active = repositoryStore.getState().getActiveRepository();
      expect(active?.status.length).to.equal(2);
      expect(active?.stagedFiles.length).to.equal(1);
      expect(active?.unstagedFiles.length).to.equal(1);
    });
  });

  describe('recent repositories', () => {
    it('adds to recent repositories', () => {
      repositoryStore.getState().addRecentRepository('/test/path', 'test-repo');

      const recent = repositoryStore.getState().recentRepositories;
      expect(recent.length).to.equal(1);
      expect(recent[0].path).to.equal('/test/path');
      expect(recent[0].name).to.equal('test-repo');
    });

    it('moves existing to front when re-added', () => {
      repositoryStore.getState().addRecentRepository('/test/path1', 'repo1');
      repositoryStore.getState().addRecentRepository('/test/path2', 'repo2');
      repositoryStore.getState().addRecentRepository('/test/path1', 'repo1');

      const recent = repositoryStore.getState().recentRepositories;
      expect(recent[0].path).to.equal('/test/path1');
    });

    it('removes from recent repositories', () => {
      repositoryStore.getState().addRecentRepository('/test/path', 'test-repo');
      repositoryStore.getState().removeRecentRepository('/test/path');

      expect(repositoryStore.getState().recentRepositories.length).to.equal(0);
    });

    it('clears all recent repositories', () => {
      repositoryStore.getState().addRecentRepository('/test/path1', 'repo1');
      repositoryStore.getState().addRecentRepository('/test/path2', 'repo2');
      repositoryStore.getState().clearRecentRepositories();

      expect(repositoryStore.getState().recentRepositories.length).to.equal(0);
    });

    it('limits recent to max 10', () => {
      for (let i = 0; i < 15; i++) {
        repositoryStore.getState().addRecentRepository(`/test/path${i}`, `repo${i}`);
      }

      expect(repositoryStore.getState().recentRepositories.length).to.equal(10);
    });
  });

  describe('getActiveRepository', () => {
    it('returns null when no repositories', () => {
      expect(repositoryStore.getState().getActiveRepository()).to.be.null;
    });

    it('returns active repository', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);

      const active = repositoryStore.getState().getActiveRepository();
      expect(active).to.not.be.null;
      expect(active?.repository.path).to.equal('/test/path');
    });
  });

  describe('reset', () => {
    it('resets store to initial state', () => {
      const repo = createMockRepo('/test/path');
      repositoryStore.getState().addRepository(repo);
      repositoryStore.getState().setLoading(true);
      repositoryStore.getState().setError('test error');

      repositoryStore.getState().reset();

      const state = repositoryStore.getState();
      expect(state.openRepositories.length).to.equal(0);
      expect(state.activeIndex).to.equal(-1);
      expect(state.isLoading).to.be.false;
      expect(state.error).to.be.null;
    });
  });
});
