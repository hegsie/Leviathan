import { expect } from '@open-wc/testing';
import {
  PROFILE_COLORS,
  UNIFIED_PROFILES_CONFIG_VERSION,
  INTEGRATION_TYPE_NAMES,
  createEmptyUnifiedProfile,
  createEmptyGitHubAccount,
  createEmptyGitLabAccount,
  createEmptyAzureDevOpsAccount,
  createEmptyBitbucketAccount,
  createEmptyIntegrationAccount,
  generateId,
  filterAccountsByType,
  getDefaultGlobalAccount,
  getProfilePreferredAccount,
  getGlobalAccountCountByType,
  getAccountDisplayLabel,
  // Deprecated v2 functions (for migration)
  getAccountsByType,
  getDefaultAccountForType,
  getAccountCountByType,
  getAccountCount,
} from '../unified-profile.types.ts';
import type {
  UnifiedProfile,
  IntegrationAccount,
  IntegrationType,
  // Deprecated types for v2 migration tests
  UnifiedProfileV2,
  ProfileIntegrationAccount,
} from '../unified-profile.types.ts';

describe('unified-profile.types', () => {
  // Helper to create mock v3 profile
  function createMockProfile(
    defaultAccounts: Partial<Record<IntegrationType, string>> = {}
  ): UnifiedProfile {
    return {
      id: 'test-profile',
      name: 'Test Profile',
      gitName: 'Test User',
      gitEmail: 'test@example.com',
      signingKey: null,
      urlPatterns: [],
      isDefault: false,
      color: PROFILE_COLORS[0],
      defaultAccounts,
    };
  }

  // Helper to create mock v3 global account
  function createMockAccount(
    id: string,
    type: IntegrationType,
    options: {
      name?: string;
      isDefault?: boolean;
      instanceUrl?: string;
      organization?: string;
      workspace?: string;
    } = {}
  ): IntegrationAccount {
    let config;
    switch (type) {
      case 'github':
        config = { type: 'github' as const };
        break;
      case 'gitlab':
        config = { type: 'gitlab' as const, instanceUrl: options.instanceUrl ?? 'https://gitlab.com' };
        break;
      case 'azure-devops':
        config = { type: 'azure-devops' as const, organization: options.organization ?? '' };
        break;
      case 'bitbucket':
        config = { type: 'bitbucket' as const, workspace: options.workspace ?? '' };
        break;
    }

    return {
      id,
      name: options.name ?? `Account ${id}`,
      integrationType: type,
      config,
      color: null,
      cachedUser: null,
      urlPatterns: [],
      isDefault: options.isDefault ?? false,
    };
  }

  describe('constants', () => {
    describe('PROFILE_COLORS', () => {
      it('has 8 colors defined', () => {
        expect(PROFILE_COLORS).to.have.lengthOf(8);
      });

      it('all colors are valid hex codes', () => {
        const hexRegex = /^#[0-9a-f]{6}$/i;
        PROFILE_COLORS.forEach((color) => {
          expect(color).to.match(hexRegex);
        });
      });
    });

    describe('UNIFIED_PROFILES_CONFIG_VERSION', () => {
      it('is version 3', () => {
        expect(UNIFIED_PROFILES_CONFIG_VERSION).to.equal(3);
      });
    });

    describe('INTEGRATION_TYPE_NAMES', () => {
      it('has display names for all types', () => {
        expect(INTEGRATION_TYPE_NAMES.github).to.equal('GitHub');
        expect(INTEGRATION_TYPE_NAMES.gitlab).to.equal('GitLab');
        expect(INTEGRATION_TYPE_NAMES['azure-devops']).to.equal('Azure DevOps');
        expect(INTEGRATION_TYPE_NAMES.bitbucket).to.equal('Bitbucket');
      });
    });
  });

  describe('createEmptyUnifiedProfile', () => {
    it('returns profile without id', () => {
      const profile = createEmptyUnifiedProfile();

      expect(profile).to.not.have.property('id');
    });

    it('has empty name fields', () => {
      const profile = createEmptyUnifiedProfile();

      expect(profile.name).to.equal('');
      expect(profile.gitName).to.equal('');
      expect(profile.gitEmail).to.equal('');
    });

    it('has null signing key', () => {
      const profile = createEmptyUnifiedProfile();

      expect(profile.signingKey).to.be.null;
    });

    it('has empty url patterns', () => {
      const profile = createEmptyUnifiedProfile();

      expect(profile.urlPatterns).to.deep.equal([]);
    });

    it('is not default', () => {
      const profile = createEmptyUnifiedProfile();

      expect(profile.isDefault).to.be.false;
    });

    it('uses first profile color', () => {
      const profile = createEmptyUnifiedProfile();

      expect(profile.color).to.equal(PROFILE_COLORS[0]);
    });

    it('has empty defaultAccounts (v3)', () => {
      const profile = createEmptyUnifiedProfile();

      expect(profile.defaultAccounts).to.deep.equal({});
    });
  });

  describe('createEmptyGitHubAccount', () => {
    it('returns account without id', () => {
      const account = createEmptyGitHubAccount();

      expect(account).to.not.have.property('id');
    });

    it('has github integration type', () => {
      const account = createEmptyGitHubAccount();

      expect(account.integrationType).to.equal('github');
    });

    it('has github config type', () => {
      const account = createEmptyGitHubAccount();

      expect(account.config.type).to.equal('github');
    });

    it('has null color and cached user', () => {
      const account = createEmptyGitHubAccount();

      expect(account.color).to.be.null;
      expect(account.cachedUser).to.be.null;
    });

    it('is not default', () => {
      const account = createEmptyGitHubAccount();

      expect(account.isDefault).to.be.false;
    });

    it('has empty urlPatterns', () => {
      const account = createEmptyGitHubAccount();

      expect(account.urlPatterns).to.deep.equal([]);
    });
  });

  describe('createEmptyGitLabAccount', () => {
    it('has gitlab integration type', () => {
      const account = createEmptyGitLabAccount();

      expect(account.integrationType).to.equal('gitlab');
    });

    it('uses default instance URL', () => {
      const account = createEmptyGitLabAccount();

      expect(account.config.type).to.equal('gitlab');
      if (account.config.type === 'gitlab') {
        expect(account.config.instanceUrl).to.equal('https://gitlab.com');
      }
    });

    it('accepts custom instance URL', () => {
      const account = createEmptyGitLabAccount('https://gitlab.company.com');

      expect(account.config.type).to.equal('gitlab');
      if (account.config.type === 'gitlab') {
        expect(account.config.instanceUrl).to.equal('https://gitlab.company.com');
      }
    });
  });

  describe('createEmptyAzureDevOpsAccount', () => {
    it('has azure-devops integration type', () => {
      const account = createEmptyAzureDevOpsAccount();

      expect(account.integrationType).to.equal('azure-devops');
    });

    it('has empty organization by default', () => {
      const account = createEmptyAzureDevOpsAccount();

      expect(account.config.type).to.equal('azure-devops');
      if (account.config.type === 'azure-devops') {
        expect(account.config.organization).to.equal('');
      }
    });

    it('accepts custom organization', () => {
      const account = createEmptyAzureDevOpsAccount('my-org');

      expect(account.config.type).to.equal('azure-devops');
      if (account.config.type === 'azure-devops') {
        expect(account.config.organization).to.equal('my-org');
      }
    });
  });

  describe('createEmptyBitbucketAccount', () => {
    it('has bitbucket integration type', () => {
      const account = createEmptyBitbucketAccount();

      expect(account.integrationType).to.equal('bitbucket');
    });

    it('has empty workspace by default', () => {
      const account = createEmptyBitbucketAccount();

      expect(account.config.type).to.equal('bitbucket');
      if (account.config.type === 'bitbucket') {
        expect(account.config.workspace).to.equal('');
      }
    });

    it('accepts custom workspace', () => {
      const account = createEmptyBitbucketAccount('my-workspace');

      expect(account.config.type).to.equal('bitbucket');
      if (account.config.type === 'bitbucket') {
        expect(account.config.workspace).to.equal('my-workspace');
      }
    });
  });

  describe('createEmptyIntegrationAccount', () => {
    it('creates GitHub account', () => {
      const account = createEmptyIntegrationAccount('github');

      expect(account.integrationType).to.equal('github');
      expect(account.config.type).to.equal('github');
    });

    it('creates GitLab account with custom URL', () => {
      const account = createEmptyIntegrationAccount('gitlab', 'https://gitlab.company.com');

      expect(account.integrationType).to.equal('gitlab');
      if (account.config.type === 'gitlab') {
        expect(account.config.instanceUrl).to.equal('https://gitlab.company.com');
      }
    });

    it('creates Azure DevOps account with organization', () => {
      const account = createEmptyIntegrationAccount('azure-devops', 'my-org');

      expect(account.integrationType).to.equal('azure-devops');
      if (account.config.type === 'azure-devops') {
        expect(account.config.organization).to.equal('my-org');
      }
    });

    it('creates Bitbucket account with workspace', () => {
      const account = createEmptyIntegrationAccount('bitbucket', 'my-workspace');

      expect(account.integrationType).to.equal('bitbucket');
      if (account.config.type === 'bitbucket') {
        expect(account.config.workspace).to.equal('my-workspace');
      }
    });
  });

  describe('generateId', () => {
    it('returns a string', () => {
      const id = generateId();

      expect(typeof id).to.equal('string');
    });

    it('returns UUID format', () => {
      const id = generateId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(id).to.match(uuidRegex);
    });

    it('returns unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).to.not.equal(id2);
    });
  });

  describe('filterAccountsByType (v3 global accounts)', () => {
    it('returns accounts of specified type', () => {
      const github1 = createMockAccount('g1', 'github');
      const github2 = createMockAccount('g2', 'github');
      const gitlab = createMockAccount('gl1', 'gitlab');
      const accounts = [github1, github2, gitlab];

      const githubAccounts = filterAccountsByType(accounts, 'github');

      expect(githubAccounts).to.have.lengthOf(2);
      expect(githubAccounts.every((a) => a.integrationType === 'github')).to.be.true;
    });

    it('returns empty array when no accounts of type', () => {
      const github = createMockAccount('g1', 'github');
      const accounts = [github];

      const gitlabAccounts = filterAccountsByType(accounts, 'gitlab');

      expect(gitlabAccounts).to.deep.equal([]);
    });

    it('returns empty array for empty accounts list', () => {
      expect(filterAccountsByType([], 'github')).to.deep.equal([]);
    });
  });

  describe('getDefaultGlobalAccount (v3)', () => {
    it('returns default account for type', () => {
      const github1 = createMockAccount('g1', 'github', { isDefault: false });
      const github2 = createMockAccount('g2', 'github', { isDefault: true });
      const accounts = [github1, github2];

      const defaultAccount = getDefaultGlobalAccount(accounts, 'github');

      expect(defaultAccount?.id).to.equal('g2');
    });

    it('falls back to first account when no default', () => {
      const github1 = createMockAccount('g1', 'github');
      const github2 = createMockAccount('g2', 'github');
      const accounts = [github1, github2];

      const defaultAccount = getDefaultGlobalAccount(accounts, 'github');

      expect(defaultAccount?.id).to.equal('g1');
    });

    it('returns undefined when no accounts of type', () => {
      const gitlab = createMockAccount('gl1', 'gitlab');
      const accounts = [gitlab];

      expect(getDefaultGlobalAccount(accounts, 'github')).to.be.undefined;
    });
  });

  describe('getProfilePreferredAccount (v3)', () => {
    it('returns profile preferred account', () => {
      const github1 = createMockAccount('g1', 'github', { isDefault: true });
      const github2 = createMockAccount('g2', 'github', { isDefault: false });
      const accounts = [github1, github2];
      const profile = createMockProfile({ github: 'g2' }); // Profile prefers g2

      const preferred = getProfilePreferredAccount(profile, accounts, 'github');

      expect(preferred?.id).to.equal('g2');
    });

    it('falls back to global default when no preference', () => {
      const github1 = createMockAccount('g1', 'github', { isDefault: true });
      const accounts = [github1];
      const profile = createMockProfile({}); // No preferences

      const preferred = getProfilePreferredAccount(profile, accounts, 'github');

      expect(preferred?.id).to.equal('g1');
    });

    it('returns undefined when no accounts of type', () => {
      const gitlab = createMockAccount('gl1', 'gitlab');
      const accounts = [gitlab];
      const profile = createMockProfile({});

      expect(getProfilePreferredAccount(profile, accounts, 'github')).to.be.undefined;
    });

    it('falls back to global default when preferred account not found', () => {
      const github1 = createMockAccount('g1', 'github', { isDefault: true });
      const accounts = [github1];
      const profile = createMockProfile({ github: 'non-existent' }); // Invalid preference

      const preferred = getProfilePreferredAccount(profile, accounts, 'github');

      expect(preferred?.id).to.equal('g1');
    });
  });

  describe('getGlobalAccountCountByType (v3)', () => {
    it('counts accounts by type', () => {
      const accounts = [
        createMockAccount('g1', 'github'),
        createMockAccount('g2', 'github'),
        createMockAccount('gl1', 'gitlab'),
        createMockAccount('az1', 'azure-devops'),
        createMockAccount('bb1', 'bitbucket'),
      ];

      const counts = getGlobalAccountCountByType(accounts);

      expect(counts.github).to.equal(2);
      expect(counts.gitlab).to.equal(1);
      expect(counts['azure-devops']).to.equal(1);
      expect(counts.bitbucket).to.equal(1);
    });

    it('returns zeros for empty accounts', () => {
      const counts = getGlobalAccountCountByType([]);

      expect(counts.github).to.equal(0);
      expect(counts.gitlab).to.equal(0);
      expect(counts['azure-devops']).to.equal(0);
      expect(counts.bitbucket).to.equal(0);
    });
  });

  describe('getAccountDisplayLabel', () => {
    it('returns name for GitHub account', () => {
      const account = createMockAccount('g1', 'github', { name: 'Work GitHub' });

      expect(getAccountDisplayLabel(account)).to.equal('Work GitHub');
    });

    it('includes hostname for non-gitlab.com GitLab', () => {
      const account = createMockAccount('gl1', 'gitlab', {
        name: 'Company GitLab',
        instanceUrl: 'https://gitlab.company.com',
      });

      expect(getAccountDisplayLabel(account)).to.equal('Company GitLab (gitlab.company.com)');
    });

    it('excludes hostname for gitlab.com', () => {
      const account = createMockAccount('gl1', 'gitlab', {
        name: 'GitLab',
        instanceUrl: 'https://gitlab.com',
      });

      expect(getAccountDisplayLabel(account)).to.equal('GitLab');
    });

    it('includes organization for Azure DevOps', () => {
      const account = createMockAccount('az1', 'azure-devops', {
        name: 'Azure Account',
        organization: 'my-org',
      });

      expect(getAccountDisplayLabel(account)).to.equal('Azure Account (my-org)');
    });

    it('handles invalid GitLab URL gracefully', () => {
      const account: IntegrationAccount = {
        id: 'gl1',
        name: 'GitLab',
        integrationType: 'gitlab',
        config: { type: 'gitlab', instanceUrl: 'not-a-url' },
        color: null,
        cachedUser: null,
        urlPatterns: [],
        isDefault: false,
      };

      // Should not throw, just return the name
      expect(getAccountDisplayLabel(account)).to.equal('GitLab');
    });
  });

  // ============================================================================
  // Deprecated v2 functions (kept for migration support)
  // ============================================================================

  describe('Deprecated v2 functions (for migration)', () => {
    // Helper to create mock v2 profile
    function createMockV2Profile(accounts: ProfileIntegrationAccount[] = []): UnifiedProfileV2 {
      return {
        id: 'test-profile',
        name: 'Test Profile',
        gitName: 'Test User',
        gitEmail: 'test@example.com',
        signingKey: null,
        urlPatterns: [],
        isDefault: false,
        color: PROFILE_COLORS[0],
        integrationAccounts: accounts,
      };
    }

    function createMockV2Account(
      id: string,
      type: 'github' | 'gitlab' | 'azure-devops',
      options: {
        name?: string;
        isDefault?: boolean;
        instanceUrl?: string;
        organization?: string;
      } = {}
    ): ProfileIntegrationAccount {
      const config =
        type === 'github'
          ? { type: 'github' as const }
          : type === 'gitlab'
            ? { type: 'gitlab' as const, instanceUrl: options.instanceUrl ?? 'https://gitlab.com' }
            : { type: 'azure-devops' as const, organization: options.organization ?? '' };

      return {
        id,
        name: options.name ?? `Account ${id}`,
        integrationType: type,
        config,
        color: null,
        cachedUser: null,
        isDefaultForType: options.isDefault ?? false,
      };
    }

    describe('getAccountsByType (deprecated)', () => {
      it('returns accounts of specified type from v2 profile', () => {
        const github1 = createMockV2Account('g1', 'github');
        const github2 = createMockV2Account('g2', 'github');
        const gitlab = createMockV2Account('gl1', 'gitlab');
        const profile = createMockV2Profile([github1, github2, gitlab]);

        const githubAccounts = getAccountsByType(profile, 'github');

        expect(githubAccounts).to.have.lengthOf(2);
        expect(githubAccounts.every((a) => a.integrationType === 'github')).to.be.true;
      });
    });

    describe('getDefaultAccountForType (deprecated)', () => {
      it('returns default account for type from v2 profile', () => {
        const github1 = createMockV2Account('g1', 'github', { isDefault: false });
        const github2 = createMockV2Account('g2', 'github', { isDefault: true });
        const profile = createMockV2Profile([github1, github2]);

        const defaultAccount = getDefaultAccountForType(profile, 'github');

        expect(defaultAccount?.id).to.equal('g2');
      });

      it('falls back to first account when no default', () => {
        const github1 = createMockV2Account('g1', 'github');
        const github2 = createMockV2Account('g2', 'github');
        const profile = createMockV2Profile([github1, github2]);

        const defaultAccount = getDefaultAccountForType(profile, 'github');

        expect(defaultAccount?.id).to.equal('g1');
      });
    });

    describe('getAccountCountByType (deprecated)', () => {
      it('counts accounts by type from v2 profile', () => {
        const accounts = [
          createMockV2Account('g1', 'github'),
          createMockV2Account('g2', 'github'),
          createMockV2Account('gl1', 'gitlab'),
          createMockV2Account('az1', 'azure-devops'),
        ];
        const profile = createMockV2Profile(accounts);

        const counts = getAccountCountByType(profile);

        expect(counts.github).to.equal(2);
        expect(counts.gitlab).to.equal(1);
        expect(counts['azure-devops']).to.equal(1);
      });
    });

    describe('getAccountCount (deprecated)', () => {
      it('returns total account count from v2 profile', () => {
        const accounts = [
          createMockV2Account('g1', 'github'),
          createMockV2Account('gl1', 'gitlab'),
          createMockV2Account('az1', 'azure-devops'),
        ];
        const profile = createMockV2Profile(accounts);

        expect(getAccountCount(profile)).to.equal(3);
      });

      it('returns 0 for empty v2 profile', () => {
        const profile = createMockV2Profile([]);

        expect(getAccountCount(profile)).to.equal(0);
      });
    });
  });
});
