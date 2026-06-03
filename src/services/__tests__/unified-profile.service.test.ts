/**
 * Unified Profile Service Tests
 *
 * Tests the saveGlobalAccount service function including Tauri command
 * invocation, store updates for new and existing accounts, return values,
 * and error handling.
 */

import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeHistory: Array<{ command: string; args: unknown }> = [];

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import {
  saveGlobalAccount,
  saveUnifiedProfile,
  loadUnifiedProfiles,
  updateGlobalAccountCachedUser,
} from '../unified-profile.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import type { IntegrationAccount, UnifiedProfile } from '../../types/unified-profile.types.ts';
import {
  createEmptyIntegrationAccount,
  generateId,
  PROFILE_COLORS,
} from '../../types/unified-profile.types.ts';

// Helper: create a full UnifiedProfile with the given id
function makeTestProfile(id: string, overrides: Partial<UnifiedProfile> = {}): UnifiedProfile {
  return {
    id,
    name: overrides.name ?? `Profile ${id}`,
    gitName: overrides.gitName ?? 'Test User',
    gitEmail: overrides.gitEmail ?? 'test@example.com',
    signingKey: overrides.signingKey ?? null,
    urlPatterns: overrides.urlPatterns ?? [],
    isDefault: overrides.isDefault ?? false,
    color: overrides.color ?? PROFILE_COLORS[0],
    defaultAccounts: overrides.defaultAccounts ?? {},
  };
}

// Helper: create a full IntegrationAccount with the given id
function makeTestAccount(
  id: string,
  overrides: Partial<IntegrationAccount> = {}
): IntegrationAccount {
  const base = createEmptyIntegrationAccount('github');
  return {
    ...base,
    id,
    name: overrides.name ?? `Test Account ${id}`,
    ...overrides,
  } as IntegrationAccount;
}

describe('unified-profile.service - saveGlobalAccount', () => {
  beforeEach(() => {
    // Reset store state
    unifiedProfileStore.getState().reset();

    // Reset invoke tracking
    invokeHistory.length = 0;

    // Default mock: save_global_account returns the account passed to it
    mockInvoke = async (command: string, args?: unknown) => {
      const params = args as Record<string, unknown> | undefined;

      if (command === 'save_global_account') {
        return params?.account;
      }

      if (command === 'get_unified_profiles_config') {
        return {
          version: 3,
          profiles: [],
          accounts: unifiedProfileStore.getState().accounts,
          repositoryAssignments: {},
        };
      }

      return null;
    };
  });

  it('invokes the save_global_account Tauri command', async () => {
    const account = makeTestAccount(generateId(), { name: 'New Account' });

    await saveGlobalAccount(account);

    const saveCall = invokeHistory.find((h) => h.command === 'save_global_account');
    expect(saveCall).to.not.be.undefined;
    expect(saveCall!.command).to.equal('save_global_account');
  });

  it('passes the account data to the Tauri command', async () => {
    const account = makeTestAccount('acc-pass-test', { name: 'My Account' });

    await saveGlobalAccount(account);

    const saveCall = invokeHistory.find((h) => h.command === 'save_global_account');
    const passedArgs = saveCall?.args as Record<string, unknown>;
    expect(passedArgs.account).to.deep.equal(account);
  });

  it('adds new account to store after save', async () => {
    const accountId = generateId();
    const account = makeTestAccount(accountId, { name: 'Brand New' });

    // Store starts empty
    expect(unifiedProfileStore.getState().accounts).to.have.lengthOf(0);

    await saveGlobalAccount(account);

    const storeAccounts = unifiedProfileStore.getState().accounts;
    expect(storeAccounts).to.have.lengthOf(1);
    expect(storeAccounts[0].id).to.equal(accountId);
    expect(storeAccounts[0].name).to.equal('Brand New');
  });

  it('updates existing account in store after save', async () => {
    const accountId = 'existing-acc';
    const existingAccount = makeTestAccount(accountId, { name: 'Original Name' });

    // Pre-populate the store with the existing account
    unifiedProfileStore.getState().setAccounts([existingAccount]);
    expect(unifiedProfileStore.getState().accounts[0].name).to.equal('Original Name');

    // Save an updated version
    const updatedAccount = makeTestAccount(accountId, { name: 'Updated Name' });
    await saveGlobalAccount(updatedAccount);

    const storeAccounts = unifiedProfileStore.getState().accounts;
    expect(storeAccounts).to.have.lengthOf(1);
    expect(storeAccounts[0].id).to.equal(accountId);
    expect(storeAccounts[0].name).to.equal('Updated Name');
  });

  it('returns the saved account data', async () => {
    const account = makeTestAccount(generateId(), { name: 'Return Test' });

    const result = await saveGlobalAccount(account);

    expect(result).to.not.be.undefined;
    expect(result.id).to.equal(account.id);
    expect(result.name).to.equal('Return Test');
  });

  it('returns the account data as received from the Tauri backend', async () => {
    const accountId = generateId();
    const account = makeTestAccount(accountId, { name: 'Frontend Name' });

    // Mock the backend returning a slightly different response (e.g., with server-set fields)
    mockInvoke = async (command: string) => {
      if (command === 'save_global_account') {
        return {
          ...account,
          name: 'Backend Confirmed Name',
        };
      }
      return null;
    };

    const result = await saveGlobalAccount(account);

    expect(result.name).to.equal('Backend Confirmed Name');
  });

  it('throws when Tauri invoke fails and store remains unchanged', async () => {
    const existingAccount = makeTestAccount('safe-acc', { name: 'Safe Account' });
    unifiedProfileStore.getState().setAccounts([existingAccount]);

    // Mock: Tauri command throws
    mockInvoke = async (command: string) => {
      if (command === 'save_global_account') {
        throw new Error('Backend failure');
      }
      return null;
    };

    const accountToSave = makeTestAccount(generateId(), { name: 'Should Not Save' });

    let errorThrown = false;
    try {
      await saveGlobalAccount(accountToSave);
    } catch (error) {
      errorThrown = true;
      expect((error as Error).message).to.include('Backend failure');
    }

    expect(errorThrown).to.be.true;

    // Store should remain unchanged
    const storeAccounts = unifiedProfileStore.getState().accounts;
    expect(storeAccounts).to.have.lengthOf(1);
    expect(storeAccounts[0].id).to.equal('safe-acc');
    expect(storeAccounts[0].name).to.equal('Safe Account');
  });

  it('does not add duplicate when updating existing account', async () => {
    const accountId = 'no-dup-acc';
    const existingAccount = makeTestAccount(accountId, { name: 'Existing' });
    unifiedProfileStore.getState().setAccounts([existingAccount]);

    const updatedAccount = makeTestAccount(accountId, { name: 'Updated' });
    await saveGlobalAccount(updatedAccount);

    const storeAccounts = unifiedProfileStore.getState().accounts;
    expect(storeAccounts).to.have.lengthOf(1);
  });

  it('clears isDefault on other same-type accounts when saving a new default', async () => {
    // Two existing GitHub accounts: A is currently default.
    const accA = makeTestAccount('gh-a', { name: 'A', integrationType: 'github', isDefault: true });
    const accB = makeTestAccount('gh-b', { name: 'B', integrationType: 'github', isDefault: false });
    // A GitLab account that is also default — must NOT be touched (different type).
    const accGl = makeTestAccount('gl-a', {
      name: 'GL',
      integrationType: 'gitlab',
      isDefault: true,
      config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
    });
    unifiedProfileStore.getState().setAccounts([accA, accB, accGl]);

    // Save B as the new default.
    await saveGlobalAccount({ ...accB, isDefault: true });

    const accounts = unifiedProfileStore.getState().accounts;
    const a = accounts.find((x) => x.id === 'gh-a')!;
    const b = accounts.find((x) => x.id === 'gh-b')!;
    const gl = accounts.find((x) => x.id === 'gl-a')!;

    // The backend clears other defaults; the store mirror should too — immediately.
    expect(b.isDefault).to.be.true;
    expect(a.isDefault).to.be.false;
    // Different integration type is untouched.
    expect(gl.isDefault).to.be.true;
  });

  it('does not clear other defaults when the saved account is not default', async () => {
    const accA = makeTestAccount('gh-a', { name: 'A', integrationType: 'github', isDefault: true });
    const accB = makeTestAccount('gh-b', { name: 'B', integrationType: 'github', isDefault: false });
    unifiedProfileStore.getState().setAccounts([accA, accB]);

    await saveGlobalAccount({ ...accB, name: 'B renamed' });

    const accounts = unifiedProfileStore.getState().accounts;
    expect(accounts.find((x) => x.id === 'gh-a')!.isDefault).to.be.true;
  });
});

describe('unified-profile.service - saveUnifiedProfile default-badge sync', () => {
  beforeEach(() => {
    unifiedProfileStore.getState().reset();
    invokeHistory.length = 0;
    mockInvoke = async (command: string, args?: unknown) => {
      const params = args as Record<string, unknown> | undefined;
      if (command === 'save_unified_profile') {
        return params?.profile;
      }
      return null;
    };
  });

  it('clears isDefault on other profiles when saving a new default profile', async () => {
    const pA = makeTestProfile('p-a', { name: 'A', isDefault: true });
    const pB = makeTestProfile('p-b', { name: 'B', isDefault: false });
    unifiedProfileStore.getState().setConfig({
      version: 3,
      profiles: [pA, pB],
      accounts: [],
      repositoryAssignments: {},
    });

    await saveUnifiedProfile({ ...pB, isDefault: true });

    const profiles = unifiedProfileStore.getState().profiles;
    expect(profiles.find((p) => p.id === 'p-b')!.isDefault).to.be.true;
    expect(profiles.find((p) => p.id === 'p-a')!.isDefault).to.be.false;
  });

  it('does not clear other defaults when the saved profile is not default', async () => {
    const pA = makeTestProfile('p-a', { name: 'A', isDefault: true });
    const pB = makeTestProfile('p-b', { name: 'B', isDefault: false });
    unifiedProfileStore.getState().setConfig({
      version: 3,
      profiles: [pA, pB],
      accounts: [],
      repositoryAssignments: {},
    });

    await saveUnifiedProfile({ ...pB, name: 'B renamed' });

    const profiles = unifiedProfileStore.getState().profiles;
    expect(profiles.find((p) => p.id === 'p-a')!.isDefault).to.be.true;
  });
});

describe('unified-profile.service - loadUnifiedProfiles', () => {
  beforeEach(() => {
    unifiedProfileStore.getState().reset();
    invokeHistory.length = 0;
  });

  it('loads config and sets it on the store', async () => {
    const mockConfig = {
      version: 3,
      profiles: [],
      accounts: [makeTestAccount('loaded-acc', { name: 'Loaded Account' })],
      repositoryAssignments: {},
    };

    mockInvoke = async (command: string) => {
      if (command === 'get_unified_profiles_config') {
        return mockConfig;
      }
      return null;
    };

    await loadUnifiedProfiles();

    const state = unifiedProfileStore.getState();
    expect(state.config).to.not.be.null;
    expect(state.accounts).to.have.lengthOf(1);
    expect(state.accounts[0].name).to.equal('Loaded Account');
    expect(state.isLoading).to.be.false;
  });

  it('sets error state when loading fails', async () => {
    mockInvoke = async (command: string) => {
      if (command === 'get_unified_profiles_config') {
        throw new Error('Network error');
      }
      return null;
    };

    await loadUnifiedProfiles();

    const state = unifiedProfileStore.getState();
    expect(state.error).to.not.be.null;
    expect(state.isLoading).to.be.false;
  });
});

// V7: updateGlobalAccountCachedUser must update only the single account in the
// store and must NOT trigger a full config reload (which would be O(N) when
// looping over every account in refreshAll/validateAll).
describe('unified-profile.service - updateGlobalAccountCachedUser (V7)', () => {
  beforeEach(() => {
    unifiedProfileStore.getState().reset();
    invokeHistory.length = 0;

    mockInvoke = async (command: string, args?: unknown) => {
      const params = args as Record<string, unknown> | undefined;
      if (command === 'update_global_account_cached_user') {
        return null;
      }
      if (command === 'get_unified_profiles_config') {
        return {
          version: 3,
          profiles: [],
          accounts: unifiedProfileStore.getState().accounts,
          repositoryAssignments: {},
        };
      }
      void params;
      return null;
    };
  });

  it('updates only the single account in the store without a full config reload', async () => {
    const account = makeTestAccount('acc-cached', { name: 'Cached Acc' });
    unifiedProfileStore.getState().setAccounts([account]);

    const cachedUser = {
      username: 'octocat',
      displayName: 'The Octocat',
      avatarUrl: 'https://example.com/a.png',
      email: 'octo@example.com',
    };

    await updateGlobalAccountCachedUser('acc-cached', cachedUser);

    // The single account's cachedUser is updated in the store.
    const stored = unifiedProfileStore.getState().accounts.find((a) => a.id === 'acc-cached');
    expect(stored?.cachedUser?.username).to.equal('octocat');

    // It must NOT have re-fetched the entire config.
    const configReloads = invokeHistory.filter(
      (h) => h.command === 'get_unified_profiles_config'
    );
    expect(configReloads).to.have.lengthOf(0);

    // The backend cached-user command was invoked exactly once.
    const updateCalls = invokeHistory.filter(
      (h) => h.command === 'update_global_account_cached_user'
    );
    expect(updateCalls).to.have.lengthOf(1);
  });

  it('is a no-op on the store when the account is not present', async () => {
    unifiedProfileStore.getState().setAccounts([]);

    await updateGlobalAccountCachedUser('missing', {
      username: 'x',
      displayName: null,
      avatarUrl: null,
      email: null,
    });

    expect(unifiedProfileStore.getState().accounts).to.have.lengthOf(0);
    const configReloads = invokeHistory.filter(
      (h) => h.command === 'get_unified_profiles_config'
    );
    expect(configReloads).to.have.lengthOf(0);
  });
});
