import { expect } from '@open-wc/testing';
import {
  integrationAccountsStore,
  getAccountsByType,
  getAccountById,
  getDefaultAccount,
  getActiveAccount,
  getAccountForRepository,
  findBestAccountForRepository,
  hasAccountsForType,
  hasAnyAccounts,
} from '../integration-accounts.store.ts';
import type { IntegrationAccount, IntegrationType } from '../../types/integration-accounts.types.ts';

describe('integration-accounts.store', () => {
  // Mock factories
  function createMockAccount(
    id: string,
    type: IntegrationType,
    options: {
      name?: string;
      isDefault?: boolean;
      urlPatterns?: string[];
    } = {}
  ): IntegrationAccount {
    return {
      id,
      name: options.name ?? `Account ${id}`,
      integrationType: type,
      config: { type },
      color: '#3b82f6',
      cachedUser: null,
      isDefault: options.isDefault ?? false,
      urlPatterns: options.urlPatterns ?? [],
    };
  }

  beforeEach(() => {
    // Reset store before each test
    integrationAccountsStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts with empty accounts', () => {
      expect(integrationAccountsStore.getState().accounts).to.deep.equal([]);
    });

    it('starts with empty active accounts', () => {
      expect(integrationAccountsStore.getState().activeAccounts).to.deep.equal({});
    });

    it('starts with empty repository assignments', () => {
      expect(integrationAccountsStore.getState().repositoryAssignments).to.deep.equal({});
    });

    it('starts with no loading state', () => {
      expect(integrationAccountsStore.getState().isLoading).to.be.false;
    });

    it('starts with no error', () => {
      expect(integrationAccountsStore.getState().error).to.be.null;
    });
  });

  describe('setAccounts', () => {
    it('sets accounts', () => {
      const accounts = [createMockAccount('a1', 'github'), createMockAccount('a2', 'gitlab')];

      integrationAccountsStore.getState().setAccounts(accounts);

      expect(integrationAccountsStore.getState().accounts).to.deep.equal(accounts);
    });

    it('clears any existing error', () => {
      integrationAccountsStore.getState().setError('Some error');
      integrationAccountsStore.getState().setAccounts([]);

      expect(integrationAccountsStore.getState().error).to.be.null;
    });
  });

  describe('setActiveAccount', () => {
    it('sets active account for type', () => {
      const account = createMockAccount('a1', 'github');

      integrationAccountsStore.getState().setActiveAccount('github', account);

      expect(integrationAccountsStore.getState().activeAccounts.github).to.deep.equal(account);
    });

    it('can set multiple types', () => {
      const github = createMockAccount('a1', 'github');
      const gitlab = createMockAccount('a2', 'gitlab');

      integrationAccountsStore.getState().setActiveAccount('github', github);
      integrationAccountsStore.getState().setActiveAccount('gitlab', gitlab);

      expect(integrationAccountsStore.getState().activeAccounts.github).to.deep.equal(github);
      expect(integrationAccountsStore.getState().activeAccounts.gitlab).to.deep.equal(gitlab);
    });

    it('can clear active account', () => {
      const account = createMockAccount('a1', 'github');
      integrationAccountsStore.getState().setActiveAccount('github', account);
      integrationAccountsStore.getState().setActiveAccount('github', null);

      expect(integrationAccountsStore.getState().activeAccounts.github).to.be.null;
    });
  });

  describe('setRepositoryAssignments', () => {
    it('sets repository assignments', () => {
      const assignments = { '/repo1': 'a1', '/repo2': 'a2' };

      integrationAccountsStore.getState().setRepositoryAssignments(assignments);

      expect(integrationAccountsStore.getState().repositoryAssignments).to.deep.equal(assignments);
    });
  });

  describe('addAccount', () => {
    it('adds account to empty list', () => {
      const account = createMockAccount('a1', 'github');

      integrationAccountsStore.getState().addAccount(account);

      expect(integrationAccountsStore.getState().accounts).to.have.lengthOf(1);
    });

    it('adds account to existing list', () => {
      integrationAccountsStore.getState().setAccounts([createMockAccount('a1', 'github')]);
      integrationAccountsStore.getState().addAccount(createMockAccount('a2', 'gitlab'));

      expect(integrationAccountsStore.getState().accounts).to.have.lengthOf(2);
    });

    it('unsets other defaults when adding default account', () => {
      const existing = createMockAccount('a1', 'github', { isDefault: true });
      integrationAccountsStore.getState().setAccounts([existing]);

      const newAccount = createMockAccount('a2', 'github', { isDefault: true });
      integrationAccountsStore.getState().addAccount(newAccount);

      const accounts = integrationAccountsStore.getState().accounts;
      expect(accounts[0].isDefault).to.be.false;
      expect(accounts[1].isDefault).to.be.true;
    });

    it('does not affect defaults of different type', () => {
      const github = createMockAccount('a1', 'github', { isDefault: true });
      integrationAccountsStore.getState().setAccounts([github]);

      const gitlab = createMockAccount('a2', 'gitlab', { isDefault: true });
      integrationAccountsStore.getState().addAccount(gitlab);

      const accounts = integrationAccountsStore.getState().accounts;
      expect(accounts[0].isDefault).to.be.true; // GitHub still default
      expect(accounts[1].isDefault).to.be.true; // GitLab is default too
    });
  });

  describe('updateAccount', () => {
    it('updates existing account', () => {
      const account = createMockAccount('a1', 'github', { name: 'Original' });
      integrationAccountsStore.getState().setAccounts([account]);

      const updated = { ...account, name: 'Updated' };
      integrationAccountsStore.getState().updateAccount(updated);

      expect(integrationAccountsStore.getState().accounts[0].name).to.equal('Updated');
    });

    it('unsets other defaults when setting new default', () => {
      const account1 = createMockAccount('a1', 'github', { isDefault: true });
      const account2 = createMockAccount('a2', 'github', { isDefault: false });
      integrationAccountsStore.getState().setAccounts([account1, account2]);

      integrationAccountsStore.getState().updateAccount({ ...account2, isDefault: true });

      const accounts = integrationAccountsStore.getState().accounts;
      expect(accounts[0].isDefault).to.be.false;
      expect(accounts[1].isDefault).to.be.true;
    });

    it('updates active account if it was the one being updated', () => {
      const account = createMockAccount('a1', 'github');
      integrationAccountsStore.getState().setAccounts([account]);
      integrationAccountsStore.getState().setActiveAccount('github', account);

      const updated = { ...account, name: 'Updated' };
      integrationAccountsStore.getState().updateAccount(updated);

      expect(integrationAccountsStore.getState().activeAccounts.github?.name).to.equal('Updated');
    });
  });

  describe('removeAccount', () => {
    it('removes account from list', () => {
      const account1 = createMockAccount('a1', 'github');
      const account2 = createMockAccount('a2', 'gitlab');
      integrationAccountsStore.getState().setAccounts([account1, account2]);

      integrationAccountsStore.getState().removeAccount('a1');

      expect(integrationAccountsStore.getState().accounts).to.have.lengthOf(1);
      expect(integrationAccountsStore.getState().accounts[0].id).to.equal('a2');
    });

    it('clears active account if it was removed', () => {
      const account = createMockAccount('a1', 'github');
      integrationAccountsStore.getState().setAccounts([account]);
      integrationAccountsStore.getState().setActiveAccount('github', account);

      integrationAccountsStore.getState().removeAccount('a1');

      expect(integrationAccountsStore.getState().activeAccounts.github).to.be.null;
    });

    it('removes repository assignments for deleted account', () => {
      const account = createMockAccount('a1', 'github');
      integrationAccountsStore.getState().setAccounts([account]);
      integrationAccountsStore.getState().setRepositoryAssignments({
        '/repo1': 'a1',
        '/repo2': 'other',
      });

      integrationAccountsStore.getState().removeAccount('a1');

      expect(integrationAccountsStore.getState().repositoryAssignments).to.deep.equal({
        '/repo2': 'other',
      });
    });
  });

  describe('assignAccountToRepository', () => {
    it('assigns account to repository', () => {
      integrationAccountsStore.getState().assignAccountToRepository('/path/to/repo', 'a1');

      expect(integrationAccountsStore.getState().repositoryAssignments['/path/to/repo']).to.equal(
        'a1'
      );
    });

    it('overwrites existing assignment', () => {
      integrationAccountsStore.getState().assignAccountToRepository('/repo', 'a1');
      integrationAccountsStore.getState().assignAccountToRepository('/repo', 'a2');

      expect(integrationAccountsStore.getState().repositoryAssignments['/repo']).to.equal('a2');
    });
  });

  describe('unassignAccountFromRepository', () => {
    it('removes assignment', () => {
      integrationAccountsStore.getState().setRepositoryAssignments({
        '/repo1': 'a1',
        '/repo2': 'a2',
      });

      integrationAccountsStore.getState().unassignAccountFromRepository('/repo1');

      expect(integrationAccountsStore.getState().repositoryAssignments).to.deep.equal({
        '/repo2': 'a2',
      });
    });

    it('handles non-existent assignment gracefully', () => {
      integrationAccountsStore.getState().unassignAccountFromRepository('/unknown');

      expect(integrationAccountsStore.getState().repositoryAssignments).to.deep.equal({});
    });
  });

  describe('setLoading', () => {
    it('sets loading state', () => {
      integrationAccountsStore.getState().setLoading(true);
      expect(integrationAccountsStore.getState().isLoading).to.be.true;

      integrationAccountsStore.getState().setLoading(false);
      expect(integrationAccountsStore.getState().isLoading).to.be.false;
    });
  });

  describe('setError', () => {
    it('sets error and clears loading', () => {
      integrationAccountsStore.getState().setLoading(true);
      integrationAccountsStore.getState().setError('Something went wrong');

      expect(integrationAccountsStore.getState().error).to.equal('Something went wrong');
      expect(integrationAccountsStore.getState().isLoading).to.be.false;
    });
  });

  describe('reset', () => {
    it('resets store to initial state', () => {
      integrationAccountsStore.getState().setAccounts([createMockAccount('a1', 'github')]);
      integrationAccountsStore.getState().setActiveAccount(
        'github',
        createMockAccount('a1', 'github')
      );
      integrationAccountsStore.getState().setRepositoryAssignments({ '/repo': 'a1' });
      integrationAccountsStore.getState().setLoading(true);
      integrationAccountsStore.getState().setError('Error');

      integrationAccountsStore.getState().reset();

      const state = integrationAccountsStore.getState();
      expect(state.accounts).to.deep.equal([]);
      expect(state.activeAccounts).to.deep.equal({});
      expect(state.repositoryAssignments).to.deep.equal({});
      expect(state.isLoading).to.be.false;
      expect(state.error).to.be.null;
    });
  });

  // Selector tests
  describe('getAccountsByType', () => {
    it('returns accounts filtered by type', () => {
      const accounts = [
        createMockAccount('a1', 'github'),
        createMockAccount('a2', 'github'),
        createMockAccount('a3', 'gitlab'),
      ];
      integrationAccountsStore.getState().setAccounts(accounts);

      const githubAccounts = getAccountsByType('github');

      expect(githubAccounts).to.have.lengthOf(2);
      expect(githubAccounts.every((a) => a.integrationType === 'github')).to.be.true;
    });

    it('returns empty array when no accounts of type', () => {
      integrationAccountsStore.getState().setAccounts([createMockAccount('a1', 'github')]);

      expect(getAccountsByType('gitlab')).to.deep.equal([]);
    });
  });

  describe('getAccountById', () => {
    it('returns account by ID', () => {
      const account = createMockAccount('a1', 'github', { name: 'Test' });
      integrationAccountsStore.getState().setAccounts([account]);

      const found = getAccountById('a1');

      expect(found?.name).to.equal('Test');
    });

    it('returns undefined for unknown ID', () => {
      expect(getAccountById('unknown')).to.be.undefined;
    });
  });

  describe('getDefaultAccount', () => {
    it('returns default account for type', () => {
      const accounts = [
        createMockAccount('a1', 'github', { isDefault: false }),
        createMockAccount('a2', 'github', { isDefault: true }),
      ];
      integrationAccountsStore.getState().setAccounts(accounts);

      const defaultAccount = getDefaultAccount('github');

      expect(defaultAccount?.id).to.equal('a2');
    });

    it('returns undefined when no default', () => {
      integrationAccountsStore.getState().setAccounts([createMockAccount('a1', 'github')]);

      expect(getDefaultAccount('github')).to.be.undefined;
    });
  });

  describe('getActiveAccount', () => {
    it('returns active account for type', () => {
      const account = createMockAccount('a1', 'github');
      integrationAccountsStore.getState().setActiveAccount('github', account);

      expect(getActiveAccount('github')).to.deep.equal(account);
    });

    it('returns undefined when no active account set', () => {
      expect(getActiveAccount('github')).to.be.undefined;
    });
  });

  describe('getAccountForRepository', () => {
    it('returns assigned account', () => {
      const account = createMockAccount('a1', 'github');
      integrationAccountsStore.getState().setAccounts([account]);
      integrationAccountsStore.getState().assignAccountToRepository('/repo', 'a1');

      const found = getAccountForRepository('/repo', 'github');

      expect(found?.id).to.equal('a1');
    });

    it('returns undefined when account type does not match', () => {
      const account = createMockAccount('a1', 'gitlab');
      integrationAccountsStore.getState().setAccounts([account]);
      integrationAccountsStore.getState().assignAccountToRepository('/repo', 'a1');

      expect(getAccountForRepository('/repo', 'github')).to.be.undefined;
    });
  });

  describe('findBestAccountForRepository', () => {
    it('prefers explicit assignment', () => {
      const assigned = createMockAccount('a1', 'github', { name: 'Assigned' });
      const defaultAccount = createMockAccount('a2', 'github', { name: 'Default', isDefault: true });
      integrationAccountsStore.getState().setAccounts([assigned, defaultAccount]);
      integrationAccountsStore.getState().assignAccountToRepository('/repo', 'a1');

      const best = findBestAccountForRepository('/repo', 'https://github.com/test/repo', 'github');

      expect(best?.name).to.equal('Assigned');
    });

    it('falls back to URL pattern match', () => {
      const patternMatch = createMockAccount('a1', 'github', {
        name: 'Pattern Match',
        urlPatterns: ['github.com/company/*'],
      });
      const defaultAccount = createMockAccount('a2', 'github', { name: 'Default', isDefault: true });
      integrationAccountsStore.getState().setAccounts([patternMatch, defaultAccount]);

      const best = findBestAccountForRepository(
        '/repo',
        'https://github.com/company/repo',
        'github'
      );

      expect(best?.name).to.equal('Pattern Match');
    });

    it('falls back to default account', () => {
      const defaultAccount = createMockAccount('a1', 'github', { name: 'Default', isDefault: true });
      integrationAccountsStore.getState().setAccounts([defaultAccount]);

      const best = findBestAccountForRepository('/repo', 'https://github.com/test/repo', 'github');

      expect(best?.name).to.equal('Default');
    });

    it('returns undefined when no suitable account', () => {
      integrationAccountsStore.getState().setAccounts([createMockAccount('a1', 'github')]);

      const best = findBestAccountForRepository('/repo', 'https://github.com/test/repo', 'github');

      expect(best).to.be.undefined;
    });
  });

  describe('hasAccountsForType', () => {
    it('returns true when accounts of type exist', () => {
      integrationAccountsStore.getState().setAccounts([createMockAccount('a1', 'github')]);

      expect(hasAccountsForType('github')).to.be.true;
    });

    it('returns false when no accounts of type', () => {
      integrationAccountsStore.getState().setAccounts([createMockAccount('a1', 'gitlab')]);

      expect(hasAccountsForType('github')).to.be.false;
    });
  });

  describe('hasAnyAccounts', () => {
    it('returns false when no accounts', () => {
      expect(hasAnyAccounts()).to.be.false;
    });

    it('returns true when accounts exist', () => {
      integrationAccountsStore.getState().setAccounts([createMockAccount('a1', 'github')]);

      expect(hasAnyAccounts()).to.be.true;
    });
  });

  // URL pattern matching tests (critical functionality)
  describe('URL pattern matching via findBestAccountForRepository', () => {
    function setupAccountWithPatterns(patterns: string[]): void {
      const account = createMockAccount('a1', 'github', { urlPatterns: patterns });
      integrationAccountsStore.getState().setAccounts([account]);
    }

    it('matches simple patterns', () => {
      setupAccountWithPatterns(['github.com/mycompany/repo']);

      const match = findBestAccountForRepository(
        '/repo',
        'https://github.com/mycompany/repo',
        'github'
      );

      expect(match).to.not.be.undefined;
    });

    it('matches wildcard patterns', () => {
      setupAccountWithPatterns(['github.com/mycompany/*']);

      const match = findBestAccountForRepository(
        '/repo',
        'https://github.com/mycompany/any-repo',
        'github'
      );

      expect(match).to.not.be.undefined;
    });

    it('normalizes URLs by removing protocol', () => {
      setupAccountWithPatterns(['github.com/test/*']);

      expect(
        findBestAccountForRepository('/r', 'https://github.com/test/repo', 'github')
      ).to.not.be.undefined;
      expect(
        findBestAccountForRepository('/r', 'http://github.com/test/repo', 'github')
      ).to.not.be.undefined;
    });

    it('handles git@ URLs', () => {
      setupAccountWithPatterns(['github.com/test/*']);

      const match = findBestAccountForRepository(
        '/repo',
        'git@github.com:test/repo',
        'github'
      );

      expect(match).to.not.be.undefined;
    });

    it('removes .git suffix from URLs', () => {
      setupAccountWithPatterns(['github.com/test/repo']);

      const match = findBestAccountForRepository(
        '/repo',
        'https://github.com/test/repo.git',
        'github'
      );

      expect(match).to.not.be.undefined;
    });

    it('is case insensitive', () => {
      setupAccountWithPatterns(['GitHub.com/MyCompany/*']);

      const match = findBestAccountForRepository(
        '/repo',
        'https://github.com/mycompany/repo',
        'github'
      );

      expect(match).to.not.be.undefined;
    });

    it('does not match when pattern does not match', () => {
      setupAccountWithPatterns(['github.com/company-a/*']);

      const match = findBestAccountForRepository(
        '/repo',
        'https://github.com/company-b/repo',
        'github'
      );

      expect(match).to.be.undefined;
    });

    it('matches patterns without wildcards as prefix', () => {
      setupAccountWithPatterns(['github.com/mycompany']);

      // Should match any repo under mycompany
      const match = findBestAccountForRepository(
        '/repo',
        'https://github.com/mycompany/repo',
        'github'
      );

      expect(match).to.not.be.undefined;
    });
  });
});
