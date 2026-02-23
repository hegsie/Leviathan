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

import { saveGlobalAccount, loadUnifiedProfiles } from '../unified-profile.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import type { IntegrationAccount } from '../../types/unified-profile.types.ts';
import { createEmptyIntegrationAccount, generateId } from '../../types/unified-profile.types.ts';

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
