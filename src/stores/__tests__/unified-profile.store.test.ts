import { expect } from '@open-wc/testing';
import {
  unifiedProfileStore,
  getUnifiedProfileById,
  getDefaultUnifiedProfile,
  hasUnifiedProfiles,
  getAccountById,
  getAccountsByType,
  getDefaultGlobalAccount,
  getProfilePreferredAccount,
  getActiveProfilePreferredAccount,
  getRepositoryProfileAssignment,
  getRepositoryProfile,
  getAccountCountByType,
} from '../unified-profile.store.ts';
import type {
  UnifiedProfile,
  IntegrationAccount,
  UnifiedProfilesConfig,
  IntegrationType,
} from '../../types/unified-profile.types.ts';

describe('unified-profile.store', () => {
  // Mock factories for v3 structure
  function createMockAccount(
    id: string,
    type: IntegrationType = 'github',
    isDefault = false
  ): IntegrationAccount {
    const config = type === 'github'
      ? { type: 'github' as const }
      : type === 'gitlab'
        ? { type: 'gitlab' as const, instanceUrl: 'https://gitlab.com' }
        : type === 'azure-devops'
          ? { type: 'azure-devops' as const, organization: 'test-org' }
          : { type: 'bitbucket' as const, workspace: 'test-workspace' };

    return {
      id,
      name: `Account ${id}`,
      integrationType: type,
      config,
      color: null,
      cachedUser: null,
      urlPatterns: [],
      isDefault,
    };
  }

  function createMockProfile(
    id: string,
    name: string,
    options: {
      isDefault?: boolean;
      defaultAccounts?: Partial<Record<IntegrationType, string>>;
      urlPatterns?: string[];
    } = {}
  ): UnifiedProfile {
    return {
      id,
      name,
      gitName: `${name} User`,
      gitEmail: `${name.toLowerCase()}@example.com`,
      signingKey: null,
      urlPatterns: options.urlPatterns ?? [],
      isDefault: options.isDefault ?? false,
      color: '#3b82f6',
      defaultAccounts: options.defaultAccounts ?? {},
    };
  }

  function createMockConfig(
    profiles: UnifiedProfile[] = [],
    accounts: IntegrationAccount[] = []
  ): UnifiedProfilesConfig {
    return {
      version: 3,
      profiles,
      accounts,
      repositoryAssignments: {},
    };
  }

  beforeEach(() => {
    // Reset store before each test
    unifiedProfileStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts with null config', () => {
      expect(unifiedProfileStore.getState().config).to.be.null;
    });

    it('starts with empty profiles', () => {
      expect(unifiedProfileStore.getState().profiles).to.deep.equal([]);
    });

    it('starts with empty accounts', () => {
      expect(unifiedProfileStore.getState().accounts).to.deep.equal([]);
    });

    it('starts with no active profile', () => {
      expect(unifiedProfileStore.getState().activeProfile).to.be.null;
    });

    it('starts with no loading state', () => {
      expect(unifiedProfileStore.getState().isLoading).to.be.false;
    });

    it('starts with no error', () => {
      expect(unifiedProfileStore.getState().error).to.be.null;
    });

    it('starts with needsMigration false', () => {
      expect(unifiedProfileStore.getState().needsMigration).to.be.false;
    });

    it('starts with isMigrating false', () => {
      expect(unifiedProfileStore.getState().isMigrating).to.be.false;
    });
  });

  describe('setConfig', () => {
    it('sets config and extracts profiles and accounts', () => {
      const profiles = [createMockProfile('p1', 'Work')];
      const accounts = [createMockAccount('a1', 'github')];
      const config = createMockConfig(profiles, accounts);

      unifiedProfileStore.getState().setConfig(config);

      const state = unifiedProfileStore.getState();
      expect(state.config).to.deep.equal(config);
      expect(state.profiles).to.deep.equal(profiles);
      expect(state.accounts).to.deep.equal(accounts);
    });

    it('clears any existing error', () => {
      unifiedProfileStore.getState().setError('Some error');
      unifiedProfileStore.getState().setConfig(createMockConfig());

      expect(unifiedProfileStore.getState().error).to.be.null;
    });
  });

  describe('setProfiles', () => {
    it('sets profiles directly', () => {
      const profiles = [createMockProfile('p1', 'Work'), createMockProfile('p2', 'Personal')];

      unifiedProfileStore.getState().setProfiles(profiles);

      expect(unifiedProfileStore.getState().profiles).to.deep.equal(profiles);
    });

    it('clears any existing error', () => {
      unifiedProfileStore.getState().setError('Some error');
      unifiedProfileStore.getState().setProfiles([]);

      expect(unifiedProfileStore.getState().error).to.be.null;
    });
  });

  describe('setActiveProfile', () => {
    it('sets active profile', () => {
      const profile = createMockProfile('p1', 'Work');

      unifiedProfileStore.getState().setActiveProfile(profile);

      expect(unifiedProfileStore.getState().activeProfile).to.deep.equal(profile);
    });

    it('can clear active profile', () => {
      unifiedProfileStore.getState().setActiveProfile(createMockProfile('p1', 'Work'));
      unifiedProfileStore.getState().setActiveProfile(null);

      expect(unifiedProfileStore.getState().activeProfile).to.be.null;
    });
  });

  describe('setCurrentRepositoryPath', () => {
    it('sets current repository path', () => {
      unifiedProfileStore.getState().setCurrentRepositoryPath('/path/to/repo');

      expect(unifiedProfileStore.getState().currentRepositoryPath).to.equal('/path/to/repo');
    });

    it('can clear repository path', () => {
      unifiedProfileStore.getState().setCurrentRepositoryPath('/path/to/repo');
      unifiedProfileStore.getState().setCurrentRepositoryPath(null);

      expect(unifiedProfileStore.getState().currentRepositoryPath).to.be.null;
    });
  });

  describe('addProfile', () => {
    it('adds profile to empty list', () => {
      const profile = createMockProfile('p1', 'Work');

      unifiedProfileStore.getState().addProfile(profile);

      expect(unifiedProfileStore.getState().profiles).to.have.lengthOf(1);
      expect(unifiedProfileStore.getState().profiles[0]).to.deep.equal(profile);
    });

    it('adds profile to existing list', () => {
      unifiedProfileStore.getState().setProfiles([createMockProfile('p1', 'Work')]);
      unifiedProfileStore.getState().addProfile(createMockProfile('p2', 'Personal'));

      expect(unifiedProfileStore.getState().profiles).to.have.lengthOf(2);
    });

    it('creates config if none exists', () => {
      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().addProfile(profile);

      const config = unifiedProfileStore.getState().config;
      expect(config).to.not.be.null;
      expect(config?.version).to.equal(3);
      expect(config?.profiles).to.have.lengthOf(1);
    });

    it('updates existing config', () => {
      const initialConfig = createMockConfig([createMockProfile('p1', 'Work')]);
      initialConfig.repositoryAssignments = { '/repo': 'p1' };
      unifiedProfileStore.getState().setConfig(initialConfig);

      unifiedProfileStore.getState().addProfile(createMockProfile('p2', 'Personal'));

      const config = unifiedProfileStore.getState().config;
      expect(config?.profiles).to.have.lengthOf(2);
      expect(config?.repositoryAssignments).to.deep.equal({ '/repo': 'p1' });
    });
  });

  describe('updateProfile', () => {
    it('updates existing profile', () => {
      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().setProfiles([profile]);

      const updated = { ...profile, name: 'Work Updated' };
      unifiedProfileStore.getState().updateProfile(updated);

      expect(unifiedProfileStore.getState().profiles[0].name).to.equal('Work Updated');
    });

    it('updates active profile if it matches', () => {
      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      const updated = { ...profile, name: 'Work Updated' };
      unifiedProfileStore.getState().updateProfile(updated);

      expect(unifiedProfileStore.getState().activeProfile?.name).to.equal('Work Updated');
    });

    it('does not update active profile if different', () => {
      const profile1 = createMockProfile('p1', 'Work');
      const profile2 = createMockProfile('p2', 'Personal');
      unifiedProfileStore.getState().setProfiles([profile1, profile2]);
      unifiedProfileStore.getState().setActiveProfile(profile1);

      const updated = { ...profile2, name: 'Personal Updated' };
      unifiedProfileStore.getState().updateProfile(updated);

      expect(unifiedProfileStore.getState().activeProfile?.name).to.equal('Work');
    });

    it('updates config profiles', () => {
      const config = createMockConfig([createMockProfile('p1', 'Work')]);
      unifiedProfileStore.getState().setConfig(config);

      unifiedProfileStore.getState().updateProfile({ ...config.profiles[0], name: 'Updated' });

      expect(unifiedProfileStore.getState().config?.profiles[0].name).to.equal('Updated');
    });
  });

  describe('removeProfile', () => {
    it('removes profile from list', () => {
      const profile1 = createMockProfile('p1', 'Work');
      const profile2 = createMockProfile('p2', 'Personal');
      unifiedProfileStore.getState().setProfiles([profile1, profile2]);

      unifiedProfileStore.getState().removeProfile('p1');

      expect(unifiedProfileStore.getState().profiles).to.have.lengthOf(1);
      expect(unifiedProfileStore.getState().profiles[0].id).to.equal('p2');
    });

    it('clears active profile if removed', () => {
      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      unifiedProfileStore.getState().removeProfile('p1');

      expect(unifiedProfileStore.getState().activeProfile).to.be.null;
    });

    it('removes repository assignments for deleted profile', () => {
      const profile = createMockProfile('p1', 'Work');
      const config = createMockConfig([profile]);
      config.repositoryAssignments = { '/repo1': 'p1', '/repo2': 'other' };
      unifiedProfileStore.getState().setConfig(config);

      unifiedProfileStore.getState().removeProfile('p1');

      expect(unifiedProfileStore.getState().config?.repositoryAssignments).to.deep.equal({
        '/repo2': 'other',
      });
    });
  });

  // Global accounts tests (v3)
  describe('setAccounts', () => {
    it('sets global accounts', () => {
      const accounts = [createMockAccount('a1', 'github'), createMockAccount('a2', 'gitlab')];

      unifiedProfileStore.getState().setAccounts(accounts);

      expect(unifiedProfileStore.getState().accounts).to.deep.equal(accounts);
    });

    it('updates config with accounts', () => {
      const config = createMockConfig([createMockProfile('p1', 'Work')]);
      unifiedProfileStore.getState().setConfig(config);

      const accounts = [createMockAccount('a1', 'github')];
      unifiedProfileStore.getState().setAccounts(accounts);

      expect(unifiedProfileStore.getState().config?.accounts).to.deep.equal(accounts);
    });
  });

  describe('addAccount', () => {
    it('adds account to global list', () => {
      const account = createMockAccount('a1', 'github');

      unifiedProfileStore.getState().addAccount(account);

      expect(unifiedProfileStore.getState().accounts).to.have.lengthOf(1);
      expect(unifiedProfileStore.getState().accounts[0]).to.deep.equal(account);
    });

    it('unsets other defaults when adding default account of same type', () => {
      const existing = createMockAccount('a1', 'github', true);
      unifiedProfileStore.getState().setAccounts([existing]);

      const newAccount = createMockAccount('a2', 'github', true);
      unifiedProfileStore.getState().addAccount(newAccount);

      const accounts = unifiedProfileStore.getState().accounts;
      expect(accounts[0].isDefault).to.be.false;
      expect(accounts[1].isDefault).to.be.true;
    });

    it('does not affect defaults of different type', () => {
      const existing = createMockAccount('a1', 'github', true);
      unifiedProfileStore.getState().setAccounts([existing]);

      const newAccount = createMockAccount('a2', 'gitlab', true);
      unifiedProfileStore.getState().addAccount(newAccount);

      const accounts = unifiedProfileStore.getState().accounts;
      expect(accounts[0].isDefault).to.be.true; // GitHub still default
      expect(accounts[1].isDefault).to.be.true; // GitLab is default
    });
  });

  describe('updateAccount', () => {
    it('updates existing account', () => {
      const account = createMockAccount('a1', 'github');
      unifiedProfileStore.getState().setAccounts([account]);

      const updated = { ...account, name: 'Updated Account' };
      unifiedProfileStore.getState().updateAccount(updated);

      expect(unifiedProfileStore.getState().accounts[0].name).to.equal('Updated Account');
    });

    it('handles setting new default', () => {
      const account1 = createMockAccount('a1', 'github', true);
      const account2 = createMockAccount('a2', 'github', false);
      unifiedProfileStore.getState().setAccounts([account1, account2]);

      const updated = { ...account2, isDefault: true };
      unifiedProfileStore.getState().updateAccount(updated);

      const accounts = unifiedProfileStore.getState().accounts;
      expect(accounts[0].isDefault).to.be.false;
      expect(accounts[1].isDefault).to.be.true;
    });
  });

  describe('removeAccount', () => {
    it('removes account from global list', () => {
      const account1 = createMockAccount('a1', 'github');
      const account2 = createMockAccount('a2', 'gitlab');
      unifiedProfileStore.getState().setAccounts([account1, account2]);

      unifiedProfileStore.getState().removeAccount('a1');

      const accounts = unifiedProfileStore.getState().accounts;
      expect(accounts).to.have.lengthOf(1);
      expect(accounts[0].id).to.equal('a2');
    });

    it('removes account from profile defaultAccounts', () => {
      const account = createMockAccount('a1', 'github');
      const profile = createMockProfile('p1', 'Work', { defaultAccounts: { github: 'a1' } });
      const config = createMockConfig([profile], [account]);
      unifiedProfileStore.getState().setConfig(config);

      unifiedProfileStore.getState().removeAccount('a1');

      const profiles = unifiedProfileStore.getState().profiles;
      expect(profiles[0].defaultAccounts.github).to.be.undefined;
    });
  });

  describe('setLoading', () => {
    it('sets loading state', () => {
      unifiedProfileStore.getState().setLoading(true);
      expect(unifiedProfileStore.getState().isLoading).to.be.true;

      unifiedProfileStore.getState().setLoading(false);
      expect(unifiedProfileStore.getState().isLoading).to.be.false;
    });
  });

  describe('setError', () => {
    it('sets error and clears loading', () => {
      unifiedProfileStore.getState().setLoading(true);
      unifiedProfileStore.getState().setError('Something went wrong');

      expect(unifiedProfileStore.getState().error).to.equal('Something went wrong');
      expect(unifiedProfileStore.getState().isLoading).to.be.false;
    });

    it('can clear error', () => {
      unifiedProfileStore.getState().setError('Error');
      unifiedProfileStore.getState().setError(null);

      expect(unifiedProfileStore.getState().error).to.be.null;
    });
  });

  describe('setNeedsMigration', () => {
    it('sets migration needed state', () => {
      unifiedProfileStore.getState().setNeedsMigration(true);
      expect(unifiedProfileStore.getState().needsMigration).to.be.true;

      unifiedProfileStore.getState().setNeedsMigration(false);
      expect(unifiedProfileStore.getState().needsMigration).to.be.false;
    });
  });

  describe('setMigrating', () => {
    it('sets migrating state', () => {
      unifiedProfileStore.getState().setMigrating(true);
      expect(unifiedProfileStore.getState().isMigrating).to.be.true;

      unifiedProfileStore.getState().setMigrating(false);
      expect(unifiedProfileStore.getState().isMigrating).to.be.false;
    });
  });

  describe('setAccountConnectionStatus', () => {
    it('sets connection status for account', () => {
      unifiedProfileStore.getState().setAccountConnectionStatus('a1', 'connected');

      const status = unifiedProfileStore.getState().accountConnectionStatus['a1'];
      expect(status?.status).to.equal('connected');
      expect(status?.lastChecked).to.be.a('number');
    });

    it('does not update lastChecked when checking', () => {
      unifiedProfileStore.getState().setAccountConnectionStatus('a1', 'connected');
      const firstChecked = unifiedProfileStore.getState().accountConnectionStatus['a1']?.lastChecked;

      unifiedProfileStore.getState().setAccountConnectionStatus('a1', 'checking');

      const status = unifiedProfileStore.getState().accountConnectionStatus['a1'];
      expect(status?.status).to.equal('checking');
      expect(status?.lastChecked).to.equal(firstChecked);
    });
  });

  describe('reset', () => {
    it('resets store to initial state', () => {
      // Set various state
      unifiedProfileStore.getState().setProfiles([createMockProfile('p1', 'Work')]);
      unifiedProfileStore.getState().setAccounts([createMockAccount('a1', 'github')]);
      unifiedProfileStore.getState().setActiveProfile(createMockProfile('p1', 'Work'));
      unifiedProfileStore.getState().setLoading(true);
      unifiedProfileStore.getState().setError('Error');
      unifiedProfileStore.getState().setNeedsMigration(true);

      unifiedProfileStore.getState().reset();

      const state = unifiedProfileStore.getState();
      expect(state.config).to.be.null;
      expect(state.profiles).to.deep.equal([]);
      expect(state.accounts).to.deep.equal([]);
      expect(state.activeProfile).to.be.null;
      expect(state.isLoading).to.be.false;
      expect(state.error).to.be.null;
      expect(state.needsMigration).to.be.false;
    });
  });

  // Selector function tests
  describe('getUnifiedProfileById', () => {
    it('returns profile by ID', () => {
      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().setProfiles([profile]);

      const found = getUnifiedProfileById('p1');
      expect(found).to.deep.equal(profile);
    });

    it('returns undefined for unknown ID', () => {
      unifiedProfileStore.getState().setProfiles([createMockProfile('p1', 'Work')]);

      expect(getUnifiedProfileById('unknown')).to.be.undefined;
    });
  });

  describe('getDefaultUnifiedProfile', () => {
    it('returns default profile', () => {
      const profiles = [
        createMockProfile('p1', 'Work', { isDefault: false }),
        createMockProfile('p2', 'Personal', { isDefault: true }),
      ];
      unifiedProfileStore.getState().setProfiles(profiles);

      const defaultProfile = getDefaultUnifiedProfile();
      expect(defaultProfile?.id).to.equal('p2');
    });

    it('returns undefined when no default', () => {
      unifiedProfileStore.getState().setProfiles([createMockProfile('p1', 'Work')]);

      expect(getDefaultUnifiedProfile()).to.be.undefined;
    });
  });

  describe('hasUnifiedProfiles', () => {
    it('returns false when no profiles', () => {
      expect(hasUnifiedProfiles()).to.be.false;
    });

    it('returns true when profiles exist', () => {
      unifiedProfileStore.getState().setProfiles([createMockProfile('p1', 'Work')]);

      expect(hasUnifiedProfiles()).to.be.true;
    });
  });

  describe('getAccountById', () => {
    it('returns account by ID', () => {
      const account = createMockAccount('a1', 'github');
      unifiedProfileStore.getState().setAccounts([account]);

      const found = getAccountById('a1');
      expect(found).to.deep.equal(account);
    });

    it('returns undefined for unknown ID', () => {
      unifiedProfileStore.getState().setAccounts([createMockAccount('a1', 'github')]);

      expect(getAccountById('unknown')).to.be.undefined;
    });
  });

  describe('getAccountsByType', () => {
    it('returns accounts of specified type', () => {
      const github1 = createMockAccount('g1', 'github');
      const github2 = createMockAccount('g2', 'github');
      const gitlab = createMockAccount('gl1', 'gitlab');
      unifiedProfileStore.getState().setAccounts([github1, github2, gitlab]);

      const githubAccounts = getAccountsByType('github');
      expect(githubAccounts).to.have.lengthOf(2);
      expect(githubAccounts.every((a) => a.integrationType === 'github')).to.be.true;
    });

    it('returns empty array when no accounts of type', () => {
      unifiedProfileStore.getState().setAccounts([createMockAccount('a1', 'github')]);

      expect(getAccountsByType('gitlab')).to.deep.equal([]);
    });
  });

  describe('getDefaultGlobalAccount', () => {
    it('returns default account for type', () => {
      const github1 = createMockAccount('g1', 'github', false);
      const github2 = createMockAccount('g2', 'github', true);
      unifiedProfileStore.getState().setAccounts([github1, github2]);

      const defaultAccount = getDefaultGlobalAccount('github');
      expect(defaultAccount?.id).to.equal('g2');
    });

    it('falls back to first account if no default', () => {
      const github1 = createMockAccount('g1', 'github', false);
      const github2 = createMockAccount('g2', 'github', false);
      unifiedProfileStore.getState().setAccounts([github1, github2]);

      const defaultAccount = getDefaultGlobalAccount('github');
      expect(defaultAccount?.id).to.equal('g1');
    });

    it('returns undefined when no accounts of type', () => {
      unifiedProfileStore.getState().setAccounts([]);

      expect(getDefaultGlobalAccount('github')).to.be.undefined;
    });
  });

  describe('getProfilePreferredAccount', () => {
    it('returns profile preferred account', () => {
      const github1 = createMockAccount('g1', 'github');
      const github2 = createMockAccount('g2', 'github', true);
      unifiedProfileStore.getState().setAccounts([github1, github2]);

      const profile = createMockProfile('p1', 'Work', { defaultAccounts: { github: 'g1' } });
      unifiedProfileStore.getState().setProfiles([profile]);

      const preferred = getProfilePreferredAccount('p1', 'github');
      expect(preferred?.id).to.equal('g1');
    });

    it('falls back to global default when no profile preference', () => {
      const github1 = createMockAccount('g1', 'github', false);
      const github2 = createMockAccount('g2', 'github', true);
      unifiedProfileStore.getState().setAccounts([github1, github2]);

      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().setProfiles([profile]);

      const preferred = getProfilePreferredAccount('p1', 'github');
      expect(preferred?.id).to.equal('g2');
    });
  });

  describe('getActiveProfilePreferredAccount', () => {
    it('returns preferred account for active profile', () => {
      const github = createMockAccount('g1', 'github');
      unifiedProfileStore.getState().setAccounts([github]);

      const profile = createMockProfile('p1', 'Work', { defaultAccounts: { github: 'g1' } });
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      const preferred = getActiveProfilePreferredAccount('github');
      expect(preferred?.id).to.equal('g1');
    });

    it('falls back to global default when no active profile', () => {
      const github = createMockAccount('g1', 'github', true);
      unifiedProfileStore.getState().setAccounts([github]);

      const preferred = getActiveProfilePreferredAccount('github');
      expect(preferred?.id).to.equal('g1');
    });
  });

  describe('getRepositoryProfileAssignment', () => {
    it('returns assignment for repository', () => {
      const config = createMockConfig([createMockProfile('p1', 'Work')]);
      config.repositoryAssignments = { '/path/to/repo': 'p1' };
      unifiedProfileStore.getState().setConfig(config);

      expect(getRepositoryProfileAssignment('/path/to/repo')).to.equal('p1');
    });

    it('returns undefined for unassigned repository', () => {
      const config = createMockConfig([]);
      unifiedProfileStore.getState().setConfig(config);

      expect(getRepositoryProfileAssignment('/unknown')).to.be.undefined;
    });
  });

  describe('getRepositoryProfile', () => {
    it('returns profile for assigned repository', () => {
      const profile = createMockProfile('p1', 'Work');
      const config = createMockConfig([profile]);
      config.repositoryAssignments = { '/path/to/repo': 'p1' };
      unifiedProfileStore.getState().setConfig(config);

      const result = getRepositoryProfile('/path/to/repo');
      expect(result?.id).to.equal('p1');
    });

    it('returns undefined for unassigned repository', () => {
      const config = createMockConfig([createMockProfile('p1', 'Work')]);
      unifiedProfileStore.getState().setConfig(config);

      expect(getRepositoryProfile('/unknown')).to.be.undefined;
    });
  });

  describe('getAccountCountByType', () => {
    it('returns count of accounts by type', () => {
      const accounts = [
        createMockAccount('g1', 'github'),
        createMockAccount('g2', 'github'),
        createMockAccount('gl1', 'gitlab'),
      ];
      unifiedProfileStore.getState().setAccounts(accounts);

      const counts = getAccountCountByType();
      expect(counts.github).to.equal(2);
      expect(counts.gitlab).to.equal(1);
      expect(counts['azure-devops']).to.equal(0);
      expect(counts.bitbucket).to.equal(0);
    });

    it('returns all zeros when no accounts', () => {
      const counts = getAccountCountByType();
      expect(counts.github).to.equal(0);
      expect(counts.gitlab).to.equal(0);
      expect(counts['azure-devops']).to.equal(0);
      expect(counts.bitbucket).to.equal(0);
    });
  });
});
