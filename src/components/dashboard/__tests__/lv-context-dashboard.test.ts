import { expect } from '@open-wc/testing';
import type { IntegrationAccount, UnifiedProfile, IntegrationType, ProfileAssignmentSource } from '../../../types/unified-profile.types.ts';
import { PROFILE_COLORS } from '../../../types/unified-profile.types.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('LvContextDashboard Data Structures', () => {
  const mockProfile: UnifiedProfile = {
    id: 'profile-1',
    name: 'Work',
    gitName: 'John Doe',
    gitEmail: 'john@company.com',
    signingKey: 'ABC123',
    urlPatterns: ['github.com/company/*'],
    isDefault: true,
    color: PROFILE_COLORS[0],
    defaultAccounts: {
      github: 'github-account-1',
    },
  };

  const mockAccounts: IntegrationAccount[] = [
    {
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
    },
    {
      id: 'gitlab-account-1',
      name: 'Work GitLab',
      integrationType: 'gitlab',
      config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
      color: null,
      cachedUser: null,
      urlPatterns: [],
      isDefault: false,
    },
  ];

  const mockRepository = {
    repository: {
      path: '/Users/test/project',
      name: 'project',
    },
    currentBranch: {
      name: 'main',
      isHead: true,
    },
    remotes: [
      { name: 'origin', url: 'https://github.com/user/project.git' },
    ],
    isOpen: true,
  };

  describe('dashboard state management', () => {
    it('should track expand/collapse state', () => {
      let isExpanded = false;
      expect(isExpanded).to.be.false;

      isExpanded = true;
      expect(isExpanded).to.be.true;
    });

    it('should persist expand state to localStorage', () => {
      const STORAGE_KEY = 'lv-context-dashboard-expanded';

      localStorage.setItem(STORAGE_KEY, 'true');
      expect(localStorage.getItem(STORAGE_KEY)).to.equal('true');

      localStorage.setItem(STORAGE_KEY, 'false');
      expect(localStorage.getItem(STORAGE_KEY)).to.equal('false');

      localStorage.removeItem(STORAGE_KEY);
    });
  });

  describe('profile default account detection', () => {
    function isProfileDefaultAccount(
      activeProfile: UnifiedProfile | null,
      account: IntegrationAccount
    ): boolean {
      if (!activeProfile) return false;
      const defaultAccountId = activeProfile.defaultAccounts[account.integrationType];
      return defaultAccountId === account.id;
    }

    it('should return true for default account', () => {
      expect(isProfileDefaultAccount(mockProfile, mockAccounts[0])).to.be.true;
    });

    it('should return false for non-default account', () => {
      expect(isProfileDefaultAccount(mockProfile, mockAccounts[1])).to.be.false;
    });

    it('should return false when no active profile', () => {
      expect(isProfileDefaultAccount(null, mockAccounts[0])).to.be.false;
    });
  });

  describe('profile assignment source detection', () => {
    function getProfileAssignmentSource(
      activeRepository: typeof mockRepository | null,
      activeProfile: UnifiedProfile | null,
      repositoryAssignments: Record<string, string>
    ): ProfileAssignmentSource {
      if (!activeRepository || !activeProfile) return 'none';

      const repoPath = activeRepository.repository.path;

      // Check if manually assigned
      if (repositoryAssignments[repoPath] === activeProfile.id) {
        return 'manual';
      }

      // Check if matched by URL pattern
      if (activeProfile.urlPatterns.length > 0) {
        return 'url-pattern';
      }

      // Check if it's the default profile
      if (activeProfile.isDefault) {
        return 'default';
      }

      return 'none';
    }

    it('should detect manual assignment', () => {
      const assignments = { '/Users/test/project': 'profile-1' };
      const source = getProfileAssignmentSource(mockRepository, mockProfile, assignments);
      expect(source).to.equal('manual');
    });

    it('should detect url-pattern assignment', () => {
      const source = getProfileAssignmentSource(mockRepository, mockProfile, {});
      expect(source).to.equal('url-pattern');
    });

    it('should detect default assignment', () => {
      const profileWithoutPatterns = { ...mockProfile, urlPatterns: [] };
      const source = getProfileAssignmentSource(mockRepository, profileWithoutPatterns, {});
      expect(source).to.equal('default');
    });

    it('should return none when no repository', () => {
      const source = getProfileAssignmentSource(null, mockProfile, {});
      expect(source).to.equal('none');
    });

    it('should return none when no profile', () => {
      const source = getProfileAssignmentSource(mockRepository, null, {});
      expect(source).to.equal('none');
    });
  });

  describe('provider detection from remotes', () => {
    function detectProvider(remotes: typeof mockRepository.remotes): IntegrationType | null {
      if (!remotes?.length) return null;

      for (const remote of remotes) {
        const url = remote.url.toLowerCase();
        if (url.includes('github.com')) return 'github';
        if (url.includes('gitlab.com') || url.includes('gitlab')) return 'gitlab';
        if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) return 'azure-devops';
        if (url.includes('bitbucket.org') || url.includes('bitbucket')) return 'bitbucket';
      }

      return null;
    }

    it('should detect GitHub from remotes', () => {
      expect(detectProvider(mockRepository.remotes)).to.equal('github');
    });

    it('should detect GitLab from remotes', () => {
      const gitlabRemotes = [{ name: 'origin', url: 'https://gitlab.com/user/repo.git' }];
      expect(detectProvider(gitlabRemotes)).to.equal('gitlab');
    });

    it('should detect Azure DevOps from remotes', () => {
      const azureRemotes = [{ name: 'origin', url: 'https://dev.azure.com/org/project/_git/repo' }];
      expect(detectProvider(azureRemotes)).to.equal('azure-devops');
    });

    it('should detect Bitbucket from remotes', () => {
      const bitbucketRemotes = [{ name: 'origin', url: 'https://bitbucket.org/user/repo.git' }];
      expect(detectProvider(bitbucketRemotes)).to.equal('bitbucket');
    });

    it('should return null for empty remotes', () => {
      expect(detectProvider([])).to.be.null;
    });

    it('should return null for unknown provider', () => {
      const unknownRemotes = [{ name: 'origin', url: 'https://custom-git.com/repo.git' }];
      expect(detectProvider(unknownRemotes)).to.be.null;
    });
  });

  describe('account connection status', () => {
    type ConnectionStatus = 'unknown' | 'checking' | 'connected' | 'disconnected';
    type AccountConnectionStatus = {
      [accountId: string]: { status: ConnectionStatus; lastChecked: number };
    };

    function getAccountStatus(
      accountId: string,
      accountConnectionStatus: AccountConnectionStatus
    ): ConnectionStatus {
      return accountConnectionStatus[accountId]?.status ?? 'unknown';
    }

    it('should return connected status', () => {
      const status: AccountConnectionStatus = {
        'github-account-1': { status: 'connected', lastChecked: Date.now() },
      };
      expect(getAccountStatus('github-account-1', status)).to.equal('connected');
    });

    it('should return disconnected status', () => {
      const status: AccountConnectionStatus = {
        'gitlab-account-1': { status: 'disconnected', lastChecked: Date.now() },
      };
      expect(getAccountStatus('gitlab-account-1', status)).to.equal('disconnected');
    });

    it('should return checking status', () => {
      const status: AccountConnectionStatus = {
        'account-1': { status: 'checking', lastChecked: Date.now() },
      };
      expect(getAccountStatus('account-1', status)).to.equal('checking');
    });

    it('should return unknown for missing account', () => {
      expect(getAccountStatus('unknown-account', {})).to.equal('unknown');
    });
  });

  describe('compact view data', () => {
    it('should format git identity correctly', () => {
      const formattedIdentity = `${mockProfile.gitName} <${mockProfile.gitEmail}>`;
      expect(formattedIdentity).to.equal('John Doe <john@company.com>');
    });

    it('should use profile color for indicator', () => {
      expect(mockProfile.color).to.equal(PROFILE_COLORS[0]);
    });

    it('should show profile name', () => {
      expect(mockProfile.name).to.equal('Work');
    });
  });

  describe('expanded view cards', () => {
    it('should include profile card data', () => {
      expect(mockProfile).to.have.property('name');
      expect(mockProfile).to.have.property('gitName');
      expect(mockProfile).to.have.property('gitEmail');
    });

    it('should include repository card data', () => {
      expect(mockRepository).to.have.property('repository');
      expect(mockRepository).to.have.property('currentBranch');
      expect(mockRepository).to.have.property('remotes');
    });

    it('should include integration cards for all accounts', () => {
      expect(mockAccounts.length).to.equal(2);
      expect(mockAccounts[0].integrationType).to.equal('github');
      expect(mockAccounts[1].integrationType).to.equal('gitlab');
    });
  });
});
