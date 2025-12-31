import { expect } from '@open-wc/testing';
import type { UnifiedProfile, ProfileIntegrationAccount } from '../../../types/unified-profile.types.ts';
import { PROFILE_COLORS } from '../../../types/unified-profile.types.ts';

// Mock Tauri API before importing any modules that use it
const mockProfiles: UnifiedProfile[] = [];
const mockConfig = {
  version: 2,
  profiles: mockProfiles,
  repositoryAssignments: {},
};

const mockInvoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  switch (command) {
    case 'get_unified_profiles_config':
      return Promise.resolve({ success: true, data: mockConfig });
    case 'get_unified_profiles':
      return Promise.resolve({ success: true, data: mockProfiles });
    case 'save_unified_profile':
      return Promise.resolve({ success: true, data: args?.profile });
    case 'delete_unified_profile':
      return Promise.resolve({ success: true, data: null });
    case 'add_account_to_profile':
      return Promise.resolve({ success: true, data: args?.account });
    case 'update_account_in_profile':
      return Promise.resolve({ success: true, data: args?.account });
    case 'remove_account_from_profile':
      return Promise.resolve({ success: true, data: null });
    default:
      return Promise.resolve({ success: true, data: null });
  }
};

// Mock the Tauri invoke function globally
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('Profile Manager Dialog Data Structures', () => {
  describe('UnifiedProfile', () => {
    it('should have correct structure for a complete profile', () => {
      const profile: UnifiedProfile = {
        id: 'test-profile-id',
        name: 'Work',
        gitName: 'John Doe',
        gitEmail: 'john@company.com',
        signingKey: 'ABC123',
        urlPatterns: ['github.com/company/*', 'gitlab.company.com/*'],
        isDefault: true,
        color: '#3b82f6',
        integrationAccounts: [],
      };

      expect(profile.id).to.equal('test-profile-id');
      expect(profile.name).to.equal('Work');
      expect(profile.gitName).to.equal('John Doe');
      expect(profile.gitEmail).to.equal('john@company.com');
      expect(profile.signingKey).to.equal('ABC123');
      expect(profile.urlPatterns).to.have.lengthOf(2);
      expect(profile.isDefault).to.be.true;
      expect(profile.color).to.equal('#3b82f6');
      expect(profile.integrationAccounts).to.deep.equal([]);
    });

    it('should allow null signing key', () => {
      const profile: UnifiedProfile = {
        id: 'test',
        name: 'Personal',
        gitName: 'Jane',
        gitEmail: 'jane@example.com',
        signingKey: null,
        urlPatterns: [],
        isDefault: false,
        color: PROFILE_COLORS[0],
        integrationAccounts: [],
      };

      expect(profile.signingKey).to.be.null;
    });

    it('should support multiple integration accounts', () => {
      const accounts: ProfileIntegrationAccount[] = [
        {
          id: 'github-1',
          name: 'Work GitHub',
          integrationType: 'github',
          config: { type: 'github' },
          color: null,
          cachedUser: null,
          isDefaultForType: true,
        },
        {
          id: 'gitlab-1',
          name: 'Company GitLab',
          integrationType: 'gitlab',
          config: { type: 'gitlab', instanceUrl: 'https://gitlab.company.com' },
          color: null,
          cachedUser: null,
          isDefaultForType: true,
        },
      ];

      const profile: UnifiedProfile = {
        id: 'test',
        name: 'Work',
        gitName: 'User',
        gitEmail: 'user@company.com',
        signingKey: null,
        urlPatterns: [],
        isDefault: true,
        color: PROFILE_COLORS[0],
        integrationAccounts: accounts,
      };

      expect(profile.integrationAccounts).to.have.lengthOf(2);
      expect(profile.integrationAccounts[0].integrationType).to.equal('github');
      expect(profile.integrationAccounts[1].integrationType).to.equal('gitlab');
    });
  });

  describe('ProfileIntegrationAccount', () => {
    it('should have correct structure for GitHub account', () => {
      const account: ProfileIntegrationAccount = {
        id: 'github-account-1',
        name: 'Personal GitHub',
        integrationType: 'github',
        config: { type: 'github' },
        color: '#10b981',
        cachedUser: {
          username: 'octocat',
          displayName: 'The Octocat',
          avatarUrl: 'https://github.com/octocat.png',
          email: null,
        },
        isDefaultForType: true,
      };

      expect(account.id).to.equal('github-account-1');
      expect(account.integrationType).to.equal('github');
      expect(account.config.type).to.equal('github');
      expect(account.cachedUser?.username).to.equal('octocat');
      expect(account.isDefaultForType).to.be.true;
    });

    it('should have correct structure for GitLab account', () => {
      const account: ProfileIntegrationAccount = {
        id: 'gitlab-account-1',
        name: 'Self-hosted GitLab',
        integrationType: 'gitlab',
        config: {
          type: 'gitlab',
          instanceUrl: 'https://gitlab.internal.company.com',
        },
        color: null,
        cachedUser: null,
        isDefaultForType: false,
      };

      expect(account.integrationType).to.equal('gitlab');
      if (account.config.type === 'gitlab') {
        expect(account.config.instanceUrl).to.equal('https://gitlab.internal.company.com');
      }
    });

    it('should have correct structure for Azure DevOps account', () => {
      const account: ProfileIntegrationAccount = {
        id: 'azure-account-1',
        name: 'Company Azure',
        integrationType: 'azure-devops',
        config: {
          type: 'azure-devops',
          organization: 'mycompany',
        },
        color: null,
        cachedUser: null,
        isDefaultForType: true,
      };

      expect(account.integrationType).to.equal('azure-devops');
      if (account.config.type === 'azure-devops') {
        expect(account.config.organization).to.equal('mycompany');
      }
    });

    it('should allow null color to inherit from profile', () => {
      const account: ProfileIntegrationAccount = {
        id: 'test',
        name: 'Test',
        integrationType: 'github',
        config: { type: 'github' },
        color: null,
        cachedUser: null,
        isDefaultForType: false,
      };

      expect(account.color).to.be.null;
    });
  });

  describe('Profile validation rules', () => {
    it('profile name should be required', () => {
      const profile: Partial<UnifiedProfile> = {
        name: '',
        gitName: 'User',
        gitEmail: 'user@example.com',
      };

      const isValid = Boolean(profile.name?.trim());
      expect(isValid).to.be.false;
    });

    it('git name should be required', () => {
      const profile: Partial<UnifiedProfile> = {
        name: 'Work',
        gitName: '',
        gitEmail: 'user@example.com',
      };

      const isValid = Boolean(profile.gitName?.trim());
      expect(isValid).to.be.false;
    });

    it('git email should be required', () => {
      const profile: Partial<UnifiedProfile> = {
        name: 'Work',
        gitName: 'User',
        gitEmail: '',
      };

      const isValid = Boolean(profile.gitEmail?.trim());
      expect(isValid).to.be.false;
    });

    it('valid profile should pass validation', () => {
      const profile: Partial<UnifiedProfile> = {
        name: 'Work',
        gitName: 'User',
        gitEmail: 'user@example.com',
      };

      const isValid =
        Boolean(profile.name?.trim()) &&
        Boolean(profile.gitName?.trim()) &&
        Boolean(profile.gitEmail?.trim());
      expect(isValid).to.be.true;
    });
  });

  describe('Account validation rules', () => {
    it('account name should be required', () => {
      const account: Partial<ProfileIntegrationAccount> = {
        name: '',
        integrationType: 'github',
      };

      const isValid = Boolean(account.name?.trim());
      expect(isValid).to.be.false;
    });

    it('valid account should pass validation', () => {
      const account: Partial<ProfileIntegrationAccount> = {
        name: 'Work GitHub',
        integrationType: 'github',
        config: { type: 'github' },
      };

      const isValid = Boolean(account.name?.trim()) && Boolean(account.integrationType);
      expect(isValid).to.be.true;
    });
  });

  describe('Default account management', () => {
    it('only one account per type should be default', () => {
      const accounts: ProfileIntegrationAccount[] = [
        {
          id: '1',
          name: 'GitHub 1',
          integrationType: 'github',
          config: { type: 'github' },
          color: null,
          cachedUser: null,
          isDefaultForType: true,
        },
        {
          id: '2',
          name: 'GitHub 2',
          integrationType: 'github',
          config: { type: 'github' },
          color: null,
          cachedUser: null,
          isDefaultForType: false,
        },
        {
          id: '3',
          name: 'GitLab 1',
          integrationType: 'gitlab',
          config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
          color: null,
          cachedUser: null,
          isDefaultForType: true,
        },
      ];

      // When setting account 2 as default, account 1 should be unset
      const setNewDefault = (accountId: string) => {
        const account = accounts.find((a) => a.id === accountId);
        if (!account) return accounts;

        return accounts.map((a) => {
          if (a.id === accountId) {
            return { ...a, isDefaultForType: true };
          }
          if (a.integrationType === account.integrationType) {
            return { ...a, isDefaultForType: false };
          }
          return a;
        });
      };

      const updated = setNewDefault('2');

      const githubDefaults = updated.filter(
        (a) => a.integrationType === 'github' && a.isDefaultForType
      );
      expect(githubDefaults).to.have.lengthOf(1);
      expect(githubDefaults[0].id).to.equal('2');

      // GitLab default should be unchanged
      const gitlabDefaults = updated.filter(
        (a) => a.integrationType === 'gitlab' && a.isDefaultForType
      );
      expect(gitlabDefaults).to.have.lengthOf(1);
    });
  });

  describe('URL pattern format', () => {
    it('should support simple patterns', () => {
      const patterns = ['github.com/company/repo'];

      expect(patterns).to.include('github.com/company/repo');
    });

    it('should support wildcard patterns', () => {
      const patterns = ['github.com/company/*', '*.company.com/*'];

      expect(patterns[0]).to.include('*');
      expect(patterns[1]).to.include('*');
    });

    it('should be parsed from newline-separated input', () => {
      const input = 'github.com/company/*\ngitlab.company.com/*\n\nbitbucket.org/team/*';

      const patterns = input
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p);

      expect(patterns).to.have.lengthOf(3);
      expect(patterns).to.deep.equal([
        'github.com/company/*',
        'gitlab.company.com/*',
        'bitbucket.org/team/*',
      ]);
    });
  });

  describe('Color constants', () => {
    it('should have valid profile colors', () => {
      expect(PROFILE_COLORS).to.have.lengthOf(8);
      PROFILE_COLORS.forEach((color) => {
        expect(color).to.match(/^#[0-9a-f]{6}$/i);
      });
    });

    it('default color should be first in array', () => {
      expect(PROFILE_COLORS[0]).to.equal('#3b82f6'); // blue
    });
  });
});
