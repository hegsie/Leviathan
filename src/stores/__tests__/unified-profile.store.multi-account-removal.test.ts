/**
 * Unified Profile Store - Multi-Account Removal Tests
 *
 * Tests the store's removeAccount action and related helpers,
 * including account isolation, default account behavior, and
 * profile defaultAccounts cleanup on removal.
 */

import { expect } from '@open-wc/testing';

// Mock Tauri API with a no-op invoke (store does not call Tauri directly)
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
};

import {
  unifiedProfileStore,
  getAccountsByType,
  getDefaultGlobalAccount,
} from '../unified-profile.store.ts';
import type {
  IntegrationAccount,
  IntegrationType,
  UnifiedProfile,
  UnifiedProfilesConfig,
} from '../../types/unified-profile.types.ts';
import { createEmptyIntegrationAccount } from '../../types/unified-profile.types.ts';

// Helper: create a full IntegrationAccount with an id from a partial template
function makeAccount(
  id: string,
  integrationType: IntegrationType,
  overrides: Partial<IntegrationAccount> = {}
): IntegrationAccount {
  const base = createEmptyIntegrationAccount(integrationType);
  return {
    ...base,
    id,
    name: overrides.name ?? `Account ${id}`,
    isDefault: overrides.isDefault ?? false,
    ...overrides,
  } as IntegrationAccount;
}

// Helper: create a UnifiedProfile
function makeProfile(
  id: string,
  name: string,
  options: {
    isDefault?: boolean;
    defaultAccounts?: Partial<Record<IntegrationType, string>>;
  } = {}
): UnifiedProfile {
  return {
    id,
    name,
    gitName: `${name} User`,
    gitEmail: `${name.toLowerCase().replace(/\s/g, '')}@example.com`,
    signingKey: null,
    urlPatterns: [],
    isDefault: options.isDefault ?? false,
    color: '#3b82f6',
    defaultAccounts: options.defaultAccounts ?? {},
  };
}

// Helper: create a config and set it on the store
function setStoreConfig(
  profiles: UnifiedProfile[],
  accounts: IntegrationAccount[]
): void {
  const config: UnifiedProfilesConfig = {
    version: 3,
    profiles,
    accounts,
    repositoryAssignments: {},
  };
  unifiedProfileStore.getState().setConfig(config);
}

describe('unified-profile.store - Multi-Account Removal', () => {
  beforeEach(() => {
    unifiedProfileStore.getState().reset();
  });

  describe('removeAccount - basic removal', () => {
    it('removes one of two same-type accounts: remaining account is still there', () => {
      const accountA = makeAccount('gh-1', 'github', { name: 'GitHub Work' });
      const accountB = makeAccount('gh-2', 'github', { name: 'GitHub Personal' });
      unifiedProfileStore.getState().setAccounts([accountA, accountB]);

      unifiedProfileStore.getState().removeAccount('gh-1');

      const accounts = unifiedProfileStore.getState().accounts;
      expect(accounts).to.have.lengthOf(1);
      expect(accounts[0].id).to.equal('gh-2');
      expect(accounts[0].name).to.equal('GitHub Personal');
    });

    it('removes the correct account and leaves others untouched', () => {
      const ghAccount = makeAccount('gh-1', 'github');
      const glAccount = makeAccount('gl-1', 'gitlab');
      const adoAccount = makeAccount('ado-1', 'azure-devops');
      unifiedProfileStore.getState().setAccounts([ghAccount, glAccount, adoAccount]);

      unifiedProfileStore.getState().removeAccount('gl-1');

      const accounts = unifiedProfileStore.getState().accounts;
      expect(accounts).to.have.lengthOf(2);
      expect(accounts.map((a) => a.id)).to.deep.equal(['gh-1', 'ado-1']);
    });
  });

  describe('removeAccount - default account behavior', () => {
    it('removes default account: remaining account does NOT auto-promote to default', () => {
      const defaultAccount = makeAccount('gh-default', 'github', {
        name: 'Default',
        isDefault: true,
      });
      const otherAccount = makeAccount('gh-other', 'github', {
        name: 'Other',
        isDefault: false,
      });
      unifiedProfileStore.getState().setAccounts([defaultAccount, otherAccount]);

      unifiedProfileStore.getState().removeAccount('gh-default');

      const accounts = unifiedProfileStore.getState().accounts;
      expect(accounts).to.have.lengthOf(1);
      expect(accounts[0].id).to.equal('gh-other');
      // The remaining account should NOT have been auto-promoted to default
      expect(accounts[0].isDefault).to.be.false;
    });

    it('removes non-default account: keeps default unchanged', () => {
      const defaultAccount = makeAccount('gh-default', 'github', {
        name: 'Default',
        isDefault: true,
      });
      const nonDefaultAccount = makeAccount('gh-other', 'github', {
        name: 'Other',
        isDefault: false,
      });
      unifiedProfileStore.getState().setAccounts([defaultAccount, nonDefaultAccount]);

      unifiedProfileStore.getState().removeAccount('gh-other');

      const accounts = unifiedProfileStore.getState().accounts;
      expect(accounts).to.have.lengthOf(1);
      expect(accounts[0].id).to.equal('gh-default');
      expect(accounts[0].isDefault).to.be.true;
    });
  });

  describe('getDefaultGlobalAccount - fallback behavior', () => {
    it('returns remaining account when default is removed and one exists', () => {
      const defaultAccount = makeAccount('gh-default', 'github', { isDefault: true });
      const remainingAccount = makeAccount('gh-remain', 'github', { isDefault: false });
      unifiedProfileStore.getState().setAccounts([defaultAccount, remainingAccount]);

      // Remove the default
      unifiedProfileStore.getState().removeAccount('gh-default');

      // getDefaultGlobalAccount should fall back to the remaining account (first in list)
      const fallbackAccount = getDefaultGlobalAccount('github');
      expect(fallbackAccount).to.not.be.undefined;
      expect(fallbackAccount!.id).to.equal('gh-remain');
    });

    it('returns undefined when all accounts of a type are removed', () => {
      const account = makeAccount('gh-1', 'github');
      unifiedProfileStore.getState().setAccounts([account]);

      unifiedProfileStore.getState().removeAccount('gh-1');

      const fallbackAccount = getDefaultGlobalAccount('github');
      expect(fallbackAccount).to.be.undefined;
    });
  });

  describe('removeAccount - profile defaultAccounts cleanup', () => {
    it('clears profile defaultAccounts entry when referenced account is removed', () => {
      const account = makeAccount('gh-1', 'github');
      const profile = makeProfile('p1', 'Work', {
        defaultAccounts: { github: 'gh-1' },
      });
      setStoreConfig([profile], [account]);

      unifiedProfileStore.getState().removeAccount('gh-1');

      const profiles = unifiedProfileStore.getState().profiles;
      expect(profiles).to.have.lengthOf(1);
      expect(profiles[0].defaultAccounts.github).to.be.undefined;
    });

    it('does not clear profile defaultAccounts for other integration types', () => {
      const ghAccount = makeAccount('gh-1', 'github');
      const glAccount = makeAccount('gl-1', 'gitlab');
      const profile = makeProfile('p1', 'Work', {
        defaultAccounts: { github: 'gh-1', gitlab: 'gl-1' },
      });
      setStoreConfig([profile], [ghAccount, glAccount]);

      // Remove only the GitHub account
      unifiedProfileStore.getState().removeAccount('gh-1');

      const profiles = unifiedProfileStore.getState().profiles;
      expect(profiles[0].defaultAccounts.github).to.be.undefined;
      expect(profiles[0].defaultAccounts.gitlab).to.equal('gl-1');
    });

    it('clears defaultAccounts across multiple profiles when account is removed', () => {
      const account = makeAccount('gh-1', 'github');
      const profile1 = makeProfile('p1', 'Work', {
        defaultAccounts: { github: 'gh-1' },
      });
      const profile2 = makeProfile('p2', 'Personal', {
        defaultAccounts: { github: 'gh-1' },
      });
      setStoreConfig([profile1, profile2], [account]);

      unifiedProfileStore.getState().removeAccount('gh-1');

      const profiles = unifiedProfileStore.getState().profiles;
      expect(profiles[0].defaultAccounts.github).to.be.undefined;
      expect(profiles[1].defaultAccounts.github).to.be.undefined;
    });

    it('does not affect profiles that do not reference the removed account', () => {
      const ghAccount1 = makeAccount('gh-1', 'github');
      const ghAccount2 = makeAccount('gh-2', 'github');
      const profile1 = makeProfile('p1', 'Work', {
        defaultAccounts: { github: 'gh-1' },
      });
      const profile2 = makeProfile('p2', 'Personal', {
        defaultAccounts: { github: 'gh-2' },
      });
      setStoreConfig([profile1, profile2], [ghAccount1, ghAccount2]);

      unifiedProfileStore.getState().removeAccount('gh-1');

      const profiles = unifiedProfileStore.getState().profiles;
      expect(profiles[0].defaultAccounts.github).to.be.undefined;
      expect(profiles[1].defaultAccounts.github).to.equal('gh-2');
    });
  });

  describe('getAccountsByType - after removal', () => {
    it('returns empty array when last account of a type is removed', () => {
      const ghAccount = makeAccount('gh-1', 'github');
      const glAccount = makeAccount('gl-1', 'gitlab');
      unifiedProfileStore.getState().setAccounts([ghAccount, glAccount]);

      unifiedProfileStore.getState().removeAccount('gh-1');

      const githubAccounts = getAccountsByType('github');
      expect(githubAccounts).to.deep.equal([]);

      // GitLab should still be there
      const gitlabAccounts = getAccountsByType('gitlab');
      expect(gitlabAccounts).to.have.lengthOf(1);
    });

    it('returns remaining accounts after partial removal', () => {
      const ghAccount1 = makeAccount('gh-1', 'github', { name: 'Work' });
      const ghAccount2 = makeAccount('gh-2', 'github', { name: 'Personal' });
      const ghAccount3 = makeAccount('gh-3', 'github', { name: 'OSS' });
      unifiedProfileStore.getState().setAccounts([ghAccount1, ghAccount2, ghAccount3]);

      unifiedProfileStore.getState().removeAccount('gh-2');

      const githubAccounts = getAccountsByType('github');
      expect(githubAccounts).to.have.lengthOf(2);
      expect(githubAccounts.map((a) => a.id)).to.deep.equal(['gh-1', 'gh-3']);
    });
  });
});
