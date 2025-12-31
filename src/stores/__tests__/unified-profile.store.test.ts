import { expect } from '@open-wc/testing';
import {
  unifiedProfileStore,
  getUnifiedProfileById,
  getDefaultUnifiedProfile,
  hasUnifiedProfiles,
  getAccountFromAnyProfile,
  getActiveProfileAccountsByType,
  getActiveProfileDefaultAccount,
  getRepositoryProfileAssignment,
  getRepositoryProfile,
} from '../unified-profile.store.ts';
import type {
  UnifiedProfile,
  ProfileIntegrationAccount,
  UnifiedProfilesConfig,
} from '../../types/unified-profile.types.ts';

describe('unified-profile.store', () => {
  // Mock factories
  function createMockAccount(
    id: string,
    type: 'github' | 'gitlab' | 'azure-devops' = 'github',
    isDefault = false
  ): ProfileIntegrationAccount {
    return {
      id,
      name: `Account ${id}`,
      integrationType: type,
      config: { type },
      color: null,
      cachedUser: null,
      isDefaultForType: isDefault,
    };
  }

  function createMockProfile(
    id: string,
    name: string,
    options: {
      isDefault?: boolean;
      accounts?: ProfileIntegrationAccount[];
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
      integrationAccounts: options.accounts ?? [],
    };
  }

  function createMockConfig(profiles: UnifiedProfile[] = []): UnifiedProfilesConfig {
    return {
      version: 2,
      profiles,
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
    it('sets config and extracts profiles', () => {
      const profiles = [createMockProfile('p1', 'Work')];
      const config = createMockConfig(profiles);

      unifiedProfileStore.getState().setConfig(config);

      const state = unifiedProfileStore.getState();
      expect(state.config).to.deep.equal(config);
      expect(state.profiles).to.deep.equal(profiles);
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
      expect(config?.version).to.equal(2);
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

  describe('addAccountToProfile', () => {
    it('adds account to profile', () => {
      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().setProfiles([profile]);

      const account = createMockAccount('a1', 'github');
      unifiedProfileStore.getState().addAccountToProfile('p1', account);

      const updatedProfile = unifiedProfileStore.getState().profiles[0];
      expect(updatedProfile.integrationAccounts).to.have.lengthOf(1);
      expect(updatedProfile.integrationAccounts[0].id).to.equal('a1');
    });

    it('unsets other defaults when adding default account', () => {
      const existingAccount = createMockAccount('a1', 'github', true);
      const profile = createMockProfile('p1', 'Work', { accounts: [existingAccount] });
      unifiedProfileStore.getState().setProfiles([profile]);

      const newAccount = createMockAccount('a2', 'github', true);
      unifiedProfileStore.getState().addAccountToProfile('p1', newAccount);

      const accounts = unifiedProfileStore.getState().profiles[0].integrationAccounts;
      expect(accounts[0].isDefaultForType).to.be.false;
      expect(accounts[1].isDefaultForType).to.be.true;
    });

    it('does not affect accounts of different type', () => {
      const existingAccount = createMockAccount('a1', 'github', true);
      const profile = createMockProfile('p1', 'Work', { accounts: [existingAccount] });
      unifiedProfileStore.getState().setProfiles([profile]);

      const newAccount = createMockAccount('a2', 'gitlab', true);
      unifiedProfileStore.getState().addAccountToProfile('p1', newAccount);

      const accounts = unifiedProfileStore.getState().profiles[0].integrationAccounts;
      expect(accounts[0].isDefaultForType).to.be.true; // GitHub still default
      expect(accounts[1].isDefaultForType).to.be.true; // GitLab is default
    });

    it('updates active profile if it matches', () => {
      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      unifiedProfileStore.getState().addAccountToProfile('p1', createMockAccount('a1'));

      expect(unifiedProfileStore.getState().activeProfile?.integrationAccounts).to.have.lengthOf(1);
    });
  });

  describe('updateAccountInProfile', () => {
    it('updates existing account', () => {
      const account = createMockAccount('a1', 'github');
      const profile = createMockProfile('p1', 'Work', { accounts: [account] });
      unifiedProfileStore.getState().setProfiles([profile]);

      const updated = { ...account, name: 'Updated Account' };
      unifiedProfileStore.getState().updateAccountInProfile('p1', updated);

      const accounts = unifiedProfileStore.getState().profiles[0].integrationAccounts;
      expect(accounts[0].name).to.equal('Updated Account');
    });

    it('handles setting new default', () => {
      const account1 = createMockAccount('a1', 'github', true);
      const account2 = createMockAccount('a2', 'github', false);
      const profile = createMockProfile('p1', 'Work', { accounts: [account1, account2] });
      unifiedProfileStore.getState().setProfiles([profile]);

      const updated = { ...account2, isDefaultForType: true };
      unifiedProfileStore.getState().updateAccountInProfile('p1', updated);

      const accounts = unifiedProfileStore.getState().profiles[0].integrationAccounts;
      expect(accounts[0].isDefaultForType).to.be.false;
      expect(accounts[1].isDefaultForType).to.be.true;
    });
  });

  describe('removeAccountFromProfile', () => {
    it('removes account from profile', () => {
      const account1 = createMockAccount('a1', 'github');
      const account2 = createMockAccount('a2', 'gitlab');
      const profile = createMockProfile('p1', 'Work', { accounts: [account1, account2] });
      unifiedProfileStore.getState().setProfiles([profile]);

      unifiedProfileStore.getState().removeAccountFromProfile('p1', 'a1');

      const accounts = unifiedProfileStore.getState().profiles[0].integrationAccounts;
      expect(accounts).to.have.lengthOf(1);
      expect(accounts[0].id).to.equal('a2');
    });

    it('updates active profile if it matches', () => {
      const account = createMockAccount('a1', 'github');
      const profile = createMockProfile('p1', 'Work', { accounts: [account] });
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      unifiedProfileStore.getState().removeAccountFromProfile('p1', 'a1');

      expect(unifiedProfileStore.getState().activeProfile?.integrationAccounts).to.have.lengthOf(0);
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

  describe('reset', () => {
    it('resets store to initial state', () => {
      // Set various state
      unifiedProfileStore.getState().setProfiles([createMockProfile('p1', 'Work')]);
      unifiedProfileStore.getState().setActiveProfile(createMockProfile('p1', 'Work'));
      unifiedProfileStore.getState().setLoading(true);
      unifiedProfileStore.getState().setError('Error');
      unifiedProfileStore.getState().setNeedsMigration(true);

      unifiedProfileStore.getState().reset();

      const state = unifiedProfileStore.getState();
      expect(state.config).to.be.null;
      expect(state.profiles).to.deep.equal([]);
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

  describe('getAccountFromAnyProfile', () => {
    it('finds account across profiles', () => {
      const account = createMockAccount('a1', 'github');
      const profile1 = createMockProfile('p1', 'Work', { accounts: [] });
      const profile2 = createMockProfile('p2', 'Personal', { accounts: [account] });
      unifiedProfileStore.getState().setProfiles([profile1, profile2]);

      const result = getAccountFromAnyProfile('a1');
      expect(result?.profile.id).to.equal('p2');
      expect(result?.account.id).to.equal('a1');
    });

    it('returns undefined for unknown account', () => {
      unifiedProfileStore.getState().setProfiles([createMockProfile('p1', 'Work')]);

      expect(getAccountFromAnyProfile('unknown')).to.be.undefined;
    });
  });

  describe('getActiveProfileAccountsByType', () => {
    it('returns accounts of specified type from active profile', () => {
      const github1 = createMockAccount('g1', 'github');
      const github2 = createMockAccount('g2', 'github');
      const gitlab = createMockAccount('gl1', 'gitlab');
      const profile = createMockProfile('p1', 'Work', { accounts: [github1, github2, gitlab] });
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      const githubAccounts = getActiveProfileAccountsByType('github');
      expect(githubAccounts).to.have.lengthOf(2);
      expect(githubAccounts.every((a) => a.integrationType === 'github')).to.be.true;
    });

    it('returns empty array when no active profile', () => {
      expect(getActiveProfileAccountsByType('github')).to.deep.equal([]);
    });
  });

  describe('getActiveProfileDefaultAccount', () => {
    it('returns default account for type', () => {
      const github1 = createMockAccount('g1', 'github', false);
      const github2 = createMockAccount('g2', 'github', true);
      const profile = createMockProfile('p1', 'Work', { accounts: [github1, github2] });
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      const defaultAccount = getActiveProfileDefaultAccount('github');
      expect(defaultAccount?.id).to.equal('g2');
    });

    it('falls back to first account if no default', () => {
      const github1 = createMockAccount('g1', 'github', false);
      const github2 = createMockAccount('g2', 'github', false);
      const profile = createMockProfile('p1', 'Work', { accounts: [github1, github2] });
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      const defaultAccount = getActiveProfileDefaultAccount('github');
      expect(defaultAccount?.id).to.equal('g1');
    });

    it('returns undefined when no accounts of type', () => {
      const profile = createMockProfile('p1', 'Work');
      unifiedProfileStore.getState().setProfiles([profile]);
      unifiedProfileStore.getState().setActiveProfile(profile);

      expect(getActiveProfileDefaultAccount('github')).to.be.undefined;
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
});
