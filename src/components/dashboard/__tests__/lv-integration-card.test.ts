import { expect } from '@open-wc/testing';
import type { IntegrationAccount, IntegrationType } from '../../../types/unified-profile.types.ts';
import { INTEGRATION_TYPE_NAMES } from '../../../types/unified-profile.types.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('LvIntegrationCard Data Structures', () => {
  const mockGitHubAccount: IntegrationAccount = {
    id: 'github-account-1',
    name: 'Personal GitHub',
    integrationType: 'github',
    config: { type: 'github' },
    color: '#10b981',
    cachedUser: {
      username: 'octocat',
      displayName: 'The Octocat',
      avatarUrl: 'https://github.com/octocat.png',
      email: 'octocat@github.com',
    },
    urlPatterns: [],
    isDefault: true,
  };

  const mockGitLabAccount: IntegrationAccount = {
    id: 'gitlab-account-1',
    name: 'Work GitLab',
    integrationType: 'gitlab',
    config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
    color: null,
    cachedUser: null,
    urlPatterns: [],
    isDefault: false,
  };

  describe('IntegrationAccount type', () => {
    it('should have required id field', () => {
      expect(mockGitHubAccount.id).to.equal('github-account-1');
    });

    it('should have required name field', () => {
      expect(mockGitHubAccount.name).to.equal('Personal GitHub');
    });

    it('should have integrationType field', () => {
      expect(mockGitHubAccount.integrationType).to.equal('github');
      expect(mockGitLabAccount.integrationType).to.equal('gitlab');
    });

    it('should have config with type', () => {
      expect(mockGitHubAccount.config).to.have.property('type', 'github');
      expect(mockGitLabAccount.config).to.have.property('type', 'gitlab');
    });

    it('should support optional cachedUser', () => {
      expect(mockGitHubAccount.cachedUser).to.not.be.null;
      expect(mockGitHubAccount.cachedUser?.username).to.equal('octocat');
      expect(mockGitLabAccount.cachedUser).to.be.null;
    });

    it('should have urlPatterns array', () => {
      expect(mockGitHubAccount.urlPatterns).to.be.an('array');
    });

    it('should have isDefault flag', () => {
      expect(mockGitHubAccount.isDefault).to.be.true;
      expect(mockGitLabAccount.isDefault).to.be.false;
    });
  });

  describe('IntegrationType', () => {
    const integrationTypes: IntegrationType[] = ['github', 'gitlab', 'azure-devops', 'bitbucket'];

    it('should support github type', () => {
      expect(integrationTypes).to.include('github');
    });

    it('should support gitlab type', () => {
      expect(integrationTypes).to.include('gitlab');
    });

    it('should support azure-devops type', () => {
      expect(integrationTypes).to.include('azure-devops');
    });

    it('should support bitbucket type', () => {
      expect(integrationTypes).to.include('bitbucket');
    });
  });

  describe('INTEGRATION_TYPE_NAMES', () => {
    it('should have display name for github', () => {
      expect(INTEGRATION_TYPE_NAMES.github).to.equal('GitHub');
    });

    it('should have display name for gitlab', () => {
      expect(INTEGRATION_TYPE_NAMES.gitlab).to.equal('GitLab');
    });

    it('should have display name for azure-devops', () => {
      expect(INTEGRATION_TYPE_NAMES['azure-devops']).to.equal('Azure DevOps');
    });

    it('should have display name for bitbucket', () => {
      expect(INTEGRATION_TYPE_NAMES.bitbucket).to.equal('Bitbucket');
    });
  });

  describe('connection status', () => {
    type ConnectionStatus = 'unknown' | 'checking' | 'connected' | 'disconnected';

    it('should support connected status', () => {
      const status: ConnectionStatus = 'connected';
      expect(status).to.equal('connected');
    });

    it('should support disconnected status', () => {
      const status: ConnectionStatus = 'disconnected';
      expect(status).to.equal('disconnected');
    });

    it('should support checking status', () => {
      const status: ConnectionStatus = 'checking';
      expect(status).to.equal('checking');
    });

    it('should support unknown status', () => {
      const status: ConnectionStatus = 'unknown';
      expect(status).to.equal('unknown');
    });
  });

  describe('cachedUser structure', () => {
    it('should have username', () => {
      expect(mockGitHubAccount.cachedUser?.username).to.equal('octocat');
    });

    it('should have displayName', () => {
      expect(mockGitHubAccount.cachedUser?.displayName).to.equal('The Octocat');
    });

    it('should have avatarUrl', () => {
      expect(mockGitHubAccount.cachedUser?.avatarUrl).to.include('octocat.png');
    });

    it('should have email', () => {
      expect(mockGitHubAccount.cachedUser?.email).to.equal('octocat@github.com');
    });
  });

  describe('GitLab config', () => {
    it('should have instanceUrl for gitlab accounts', () => {
      const config = mockGitLabAccount.config as { type: 'gitlab'; instanceUrl?: string };
      expect(config.instanceUrl).to.equal('https://gitlab.com');
    });
  });

  describe('Azure DevOps config', () => {
    it('should support organization field', () => {
      const azureAccount: IntegrationAccount = {
        ...mockGitHubAccount,
        integrationType: 'azure-devops',
        config: { type: 'azure-devops', organization: 'myorg' },
      };
      const config = azureAccount.config as { type: 'azure-devops'; organization?: string };
      expect(config.organization).to.equal('myorg');
    });
  });

  describe('Bitbucket config', () => {
    it('should support workspace field', () => {
      const bitbucketAccount: IntegrationAccount = {
        ...mockGitHubAccount,
        integrationType: 'bitbucket',
        config: { type: 'bitbucket', workspace: 'myworkspace' },
      };
      const config = bitbucketAccount.config as { type: 'bitbucket'; workspace?: string };
      expect(config.workspace).to.equal('myworkspace');
    });
  });
});
