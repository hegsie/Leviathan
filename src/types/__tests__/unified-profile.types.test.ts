import { expect } from '@open-wc/testing';
import {
  PROFILE_COLORS,
  UNIFIED_PROFILES_CONFIG_VERSION,
  INTEGRATION_TYPE_NAMES,
  createEmptyUnifiedProfile,
  createEmptyGitHubProfileAccount,
  createEmptyGitLabProfileAccount,
  createEmptyAzureDevOpsProfileAccount,
  generateId,
  getAccountsByType,
  getDefaultAccountForType,
  getAccountCountByType,
  getAccountCount,
  getAccountDisplayLabel,
} from '../unified-profile.types.ts';
import type { UnifiedProfile, ProfileIntegrationAccount } from '../unified-profile.types.ts';

describe('unified-profile.types', () => {
  // Helper to create mock profile with accounts
  function createMockProfile(accounts: ProfileIntegrationAccount[] = []): UnifiedProfile {
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

  function createMockAccount(
    id: string,
    type: 'github' | 'gitlab' | 'azure-devops',
    options: {
      name?: string;
      isDefault?: boolean;
      instanceUrl?: string;
      organization?: string;
    } = {}
  ): ProfileIntegrationAccount {
    const config: Record<string, unknown> = { type };
    if (type === 'gitlab' && options.instanceUrl) {
      config.instanceUrl = options.instanceUrl;
    }
    if (type === 'azure-devops' && options.organization) {
      config.organization = options.organization;
    }

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
      it('is version 2', () => {
        expect(UNIFIED_PROFILES_CONFIG_VERSION).to.equal(2);
      });
    });

    describe('INTEGRATION_TYPE_NAMES', () => {
      it('has display names for all types', () => {
        expect(INTEGRATION_TYPE_NAMES.github).to.equal('GitHub');
        expect(INTEGRATION_TYPE_NAMES.gitlab).to.equal('GitLab');
        expect(INTEGRATION_TYPE_NAMES['azure-devops']).to.equal('Azure DevOps');
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

    it('has empty integration accounts', () => {
      const profile = createEmptyUnifiedProfile();

      expect(profile.integrationAccounts).to.deep.equal([]);
    });
  });

  describe('createEmptyGitHubProfileAccount', () => {
    it('returns account without id', () => {
      const account = createEmptyGitHubProfileAccount();

      expect(account).to.not.have.property('id');
    });

    it('has github integration type', () => {
      const account = createEmptyGitHubProfileAccount();

      expect(account.integrationType).to.equal('github');
    });

    it('has github config type', () => {
      const account = createEmptyGitHubProfileAccount();

      expect(account.config.type).to.equal('github');
    });

    it('has null color and cached user', () => {
      const account = createEmptyGitHubProfileAccount();

      expect(account.color).to.be.null;
      expect(account.cachedUser).to.be.null;
    });

    it('is not default for type', () => {
      const account = createEmptyGitHubProfileAccount();

      expect(account.isDefaultForType).to.be.false;
    });
  });

  describe('createEmptyGitLabProfileAccount', () => {
    it('has gitlab integration type', () => {
      const account = createEmptyGitLabProfileAccount();

      expect(account.integrationType).to.equal('gitlab');
    });

    it('uses default instance URL', () => {
      const account = createEmptyGitLabProfileAccount();

      expect(account.config.instanceUrl).to.equal('https://gitlab.com');
    });

    it('accepts custom instance URL', () => {
      const account = createEmptyGitLabProfileAccount('https://gitlab.company.com');

      expect(account.config.instanceUrl).to.equal('https://gitlab.company.com');
    });
  });

  describe('createEmptyAzureDevOpsProfileAccount', () => {
    it('has azure-devops integration type', () => {
      const account = createEmptyAzureDevOpsProfileAccount();

      expect(account.integrationType).to.equal('azure-devops');
    });

    it('has empty organization by default', () => {
      const account = createEmptyAzureDevOpsProfileAccount();

      expect(account.config.organization).to.equal('');
    });

    it('accepts custom organization', () => {
      const account = createEmptyAzureDevOpsProfileAccount('my-org');

      expect(account.config.organization).to.equal('my-org');
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

  describe('getAccountsByType', () => {
    it('returns accounts of specified type', () => {
      const github1 = createMockAccount('g1', 'github');
      const github2 = createMockAccount('g2', 'github');
      const gitlab = createMockAccount('gl1', 'gitlab');
      const profile = createMockProfile([github1, github2, gitlab]);

      const githubAccounts = getAccountsByType(profile, 'github');

      expect(githubAccounts).to.have.lengthOf(2);
      expect(githubAccounts.every((a) => a.integrationType === 'github')).to.be.true;
    });

    it('returns empty array when no accounts of type', () => {
      const github = createMockAccount('g1', 'github');
      const profile = createMockProfile([github]);

      const gitlabAccounts = getAccountsByType(profile, 'gitlab');

      expect(gitlabAccounts).to.deep.equal([]);
    });

    it('returns empty array for profile with no accounts', () => {
      const profile = createMockProfile([]);

      expect(getAccountsByType(profile, 'github')).to.deep.equal([]);
    });
  });

  describe('getDefaultAccountForType', () => {
    it('returns default account for type', () => {
      const github1 = createMockAccount('g1', 'github', { isDefault: false });
      const github2 = createMockAccount('g2', 'github', { isDefault: true });
      const profile = createMockProfile([github1, github2]);

      const defaultAccount = getDefaultAccountForType(profile, 'github');

      expect(defaultAccount?.id).to.equal('g2');
    });

    it('falls back to first account when no default', () => {
      const github1 = createMockAccount('g1', 'github');
      const github2 = createMockAccount('g2', 'github');
      const profile = createMockProfile([github1, github2]);

      const defaultAccount = getDefaultAccountForType(profile, 'github');

      expect(defaultAccount?.id).to.equal('g1');
    });

    it('returns undefined when no accounts of type', () => {
      const gitlab = createMockAccount('gl1', 'gitlab');
      const profile = createMockProfile([gitlab]);

      expect(getDefaultAccountForType(profile, 'github')).to.be.undefined;
    });
  });

  describe('getAccountCountByType', () => {
    it('counts accounts by type', () => {
      const accounts = [
        createMockAccount('g1', 'github'),
        createMockAccount('g2', 'github'),
        createMockAccount('gl1', 'gitlab'),
        createMockAccount('az1', 'azure-devops'),
      ];
      const profile = createMockProfile(accounts);

      const counts = getAccountCountByType(profile);

      expect(counts.github).to.equal(2);
      expect(counts.gitlab).to.equal(1);
      expect(counts['azure-devops']).to.equal(1);
    });

    it('returns zeros for empty profile', () => {
      const profile = createMockProfile([]);

      const counts = getAccountCountByType(profile);

      expect(counts.github).to.equal(0);
      expect(counts.gitlab).to.equal(0);
      expect(counts['azure-devops']).to.equal(0);
    });
  });

  describe('getAccountCount', () => {
    it('returns total account count', () => {
      const accounts = [
        createMockAccount('g1', 'github'),
        createMockAccount('gl1', 'gitlab'),
        createMockAccount('az1', 'azure-devops'),
      ];
      const profile = createMockProfile(accounts);

      expect(getAccountCount(profile)).to.equal(3);
    });

    it('returns 0 for empty profile', () => {
      const profile = createMockProfile([]);

      expect(getAccountCount(profile)).to.equal(0);
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
      const account: ProfileIntegrationAccount = {
        id: 'gl1',
        name: 'GitLab',
        integrationType: 'gitlab',
        config: { type: 'gitlab', instanceUrl: 'not-a-url' },
        color: null,
        cachedUser: null,
        isDefaultForType: false,
      };

      // Should not throw, just return the name
      expect(getAccountDisplayLabel(account)).to.equal('GitLab');
    });
  });
});
