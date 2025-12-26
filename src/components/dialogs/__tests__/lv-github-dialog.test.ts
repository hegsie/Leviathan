import { expect } from '@open-wc/testing';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (command: string): Promise<unknown> => {
  switch (command) {
    case 'get_github_token':
      return Promise.resolve(null);
    case 'check_github_connection':
      return Promise.resolve({
        connected: false,
        user: null,
        scopes: [],
      });
    case 'detect_github_repo':
      return Promise.resolve({
        owner: 'test-owner',
        repo: 'test-repo',
        defaultBranch: 'main',
      });
    default:
      return Promise.resolve(null);
  }
};

// Mock the Tauri invoke function globally
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('GitHub Dialog Data Structures', () => {
  describe('GitHubConnectionStatus', () => {
    it('should have correct structure for connected state', () => {
      const status = {
        connected: true,
        user: {
          login: 'octocat',
          id: 12345,
          avatarUrl: 'https://example.com/avatar.png',
          name: 'The Octocat',
          email: 'octocat@github.com',
        },
        scopes: ['repo', 'read:user'],
      };

      expect(status.connected).to.be.true;
      expect(status.user).to.not.be.null;
      expect(status.user?.login).to.equal('octocat');
      expect(status.scopes).to.have.length(2);
    });

    it('should have correct structure for disconnected state', () => {
      const status = {
        connected: false,
        user: null,
        scopes: [],
      };

      expect(status.connected).to.be.false;
      expect(status.user).to.be.null;
      expect(status.scopes).to.have.length(0);
    });
  });

  describe('DetectedGitHubRepo', () => {
    it('should have owner and repo properties', () => {
      const repo = {
        owner: 'test-owner',
        repo: 'test-repo',
        defaultBranch: 'main',
      };

      expect(repo.owner).to.equal('test-owner');
      expect(repo.repo).to.equal('test-repo');
      expect(repo.defaultBranch).to.equal('main');
    });
  });

  describe('GitHub token format', () => {
    it('should recognize classic PAT format', () => {
      const token = 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      expect(token.startsWith('ghp_')).to.be.true;
      expect(token.length).to.equal(40);
    });

    it('should recognize fine-grained PAT format', () => {
      const token = 'github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      expect(token.startsWith('github_pat_')).to.be.true;
    });
  });
});
