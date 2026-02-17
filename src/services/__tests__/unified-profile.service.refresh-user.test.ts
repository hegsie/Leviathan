/**
 * Unified Profile Service - Refresh Account Cached User Tests
 *
 * Tests refreshAccountCachedUser and validateAllAccountTokens including
 * connection check for each integration type, CachedUser field mapping,
 * store connection status updates, and token validation counts.
 */

import { expect } from '@open-wc/testing';

// Mock Tauri API - must be set up before any imports that use Tauri
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeHistory: Array<{ command: string; args: unknown }> = [];

// Token store for simulating Stronghold
const tokenStore = new Map<string, number[]>();

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import { refreshAccountCachedUser, validateAllAccountTokens } from '../unified-profile.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import { createEmptyIntegrationAccount } from '../../types/unified-profile.types.ts';
import type { IntegrationAccount } from '../../types/unified-profile.types.ts';

// Helper: create a test account with all required fields
function createTestAccount(
  overrides: Partial<IntegrationAccount> & { id: string }
): IntegrationAccount {
  const base = createEmptyIntegrationAccount(overrides.integrationType ?? 'github');
  return {
    ...base,
    name: 'Test Account',
    isDefault: false,
    cachedUser: null,
    ...overrides,
  } as IntegrationAccount;
}

// Helper: encode a string as a number array (simulating Stronghold Uint8Array)
function encodeToken(token: string): number[] {
  return Array.from(new TextEncoder().encode(token));
}

// Helper: store a mock token in the simulated Stronghold
function setMockToken(integrationType: string, accountId: string, token: string): void {
  const key = `${integrationType}_token_${accountId}`;
  tokenStore.set(key, encodeToken(token));
}

// Default mock responses for connection checks
const githubConnectionResponse = {
  connected: true,
  user: {
    login: 'testuser',
    id: 12345,
    name: 'Test User',
    email: 'test@test.com',
    avatarUrl: 'https://avatar.com/test',
  },
  scopes: ['repo'],
};

const gitlabConnectionResponse = {
  connected: true,
  user: {
    username: 'gluser',
    name: 'GL User',
    avatarUrl: null,
    email: 'gl@test.com',
  },
  scopes: [],
};

const adoConnectionResponse = {
  connected: true,
  user: {
    displayName: 'ADO User',
    uniqueName: 'adouser@org.com',
    imageUrl: null,
  },
  organization: 'testorg',
};

const bitbucketConnectionResponse = {
  connected: true,
  user: {
    uuid: '{bb-uuid}',
    username: 'bbuser',
    displayName: 'BB User',
    avatarUrl: null,
  },
};

// Track whether Stronghold has been "initialized" for this test run
let strongholdInitialized = false;

function setupDefaultMockInvoke(): void {
  strongholdInitialized = false;

  mockInvoke = async (command: string, args?: unknown) => {
    const params = args as Record<string, unknown> | undefined;

    // Machine vault password for credential service
    if (command === 'get_machine_vault_password') {
      return 'test-vault-password-12345';
    }

    // Tauri path plugin
    if (command === 'plugin:path|resolve_directory') {
      return '/mock/app/data';
    }

    // Stronghold initialization
    if (command === 'migrate_vault_if_needed') {
      return null;
    }
    if (command === 'plugin:stronghold|initialize') {
      strongholdInitialized = true;
      return null;
    }
    if (command === 'plugin:stronghold|load_client') {
      if (!strongholdInitialized) throw new Error('Not initialized');
      return null;
    }
    if (command === 'plugin:stronghold|create_client') {
      return null;
    }
    if (command === 'plugin:stronghold|save') {
      return null;
    }

    // Stronghold store read - return token from our mock store
    if (command === 'plugin:stronghold|get_store_record') {
      const key = params?.key as string;
      const data = tokenStore.get(key);
      return data ?? null;
    }

    // Connection checks (these are raw invoke results, invokeCommand wraps them)
    if (command === 'check_github_connection') {
      return githubConnectionResponse;
    }
    if (command === 'check_gitlab_connection') {
      return gitlabConnectionResponse;
    }
    if (command === 'check_ado_connection') {
      return adoConnectionResponse;
    }
    if (command === 'check_bitbucket_connection_with_token') {
      return bitbucketConnectionResponse;
    }

    // Update cached user and config reload
    if (command === 'update_global_account_cached_user') {
      return null;
    }
    if (command === 'get_unified_profiles_config') {
      return {
        version: 3,
        profiles: unifiedProfileStore.getState().profiles,
        accounts: unifiedProfileStore.getState().accounts,
        repositoryAssignments: {},
      };
    }

    return null;
  };
}

describe('unified-profile.service - refreshAccountCachedUser', () => {
  beforeEach(() => {
    unifiedProfileStore.getState().reset();
    invokeHistory.length = 0;
    tokenStore.clear();
    setupDefaultMockInvoke();
  });

  it('returns CachedUser with mapped fields for a GitHub account', async () => {
    const account = createTestAccount({
      id: 'gh-acc-1',
      name: 'My GitHub',
      integrationType: 'github',
    });
    unifiedProfileStore.getState().setAccounts([account]);
    setMockToken('github', 'gh-acc-1', 'ghp_testtoken123');

    const result = await refreshAccountCachedUser(account);

    expect(result).to.not.be.null;
    expect(result!.username).to.equal('testuser');
    expect(result!.displayName).to.equal('Test User');
    expect(result!.avatarUrl).to.equal('https://avatar.com/test');
    expect(result!.email).to.equal('test@test.com');
  });

  it('returns CachedUser with mapped fields for a GitLab account', async () => {
    const account = createTestAccount({
      id: 'gl-acc-1',
      name: 'My GitLab',
      integrationType: 'gitlab',
      config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
    });
    unifiedProfileStore.getState().setAccounts([account]);
    setMockToken('gitlab', 'gl-acc-1', 'glpat-testtoken123');

    const result = await refreshAccountCachedUser(account);

    expect(result).to.not.be.null;
    expect(result!.username).to.equal('gluser');
    expect(result!.displayName).to.equal('GL User');
    expect(result!.email).to.equal('gl@test.com');
  });

  it('returns CachedUser with mapped fields for an Azure DevOps account', async () => {
    const account = createTestAccount({
      id: 'ado-acc-1',
      name: 'My ADO',
      integrationType: 'azure-devops',
      config: { type: 'azure-devops', organization: 'testorg' },
    });
    unifiedProfileStore.getState().setAccounts([account]);
    setMockToken('azure-devops', 'ado-acc-1', 'ado-pat-token123');

    const result = await refreshAccountCachedUser(account);

    expect(result).to.not.be.null;
    expect(result!.username).to.equal('adouser');
    expect(result!.displayName).to.equal('ADO User');
    expect(result!.email).to.equal('adouser@org.com');
  });

  it('returns CachedUser with mapped fields for a Bitbucket account', async () => {
    const account = createTestAccount({
      id: 'bb-acc-1',
      name: 'My Bitbucket',
      integrationType: 'bitbucket',
      config: { type: 'bitbucket', workspace: 'myworkspace' },
    });
    unifiedProfileStore.getState().setAccounts([account]);
    setMockToken('bitbucket', 'bb-acc-1', 'bb-app-password123');

    const result = await refreshAccountCachedUser(account);

    expect(result).to.not.be.null;
    expect(result!.username).to.equal('bbuser');
    expect(result!.displayName).to.equal('BB User');
    expect(result!.email).to.be.null;
  });

  it('returns null when connection check fails (connected: false)', async () => {
    const account = createTestAccount({
      id: 'gh-fail-1',
      name: 'Disconnected GitHub',
      integrationType: 'github',
    });
    unifiedProfileStore.getState().setAccounts([account]);
    setMockToken('github', 'gh-fail-1', 'ghp_expiredtoken');

    // Override the GitHub connection response to return disconnected
    const originalMock = mockInvoke;
    mockInvoke = async (command: string, args?: unknown) => {
      if (command === 'check_github_connection') {
        return { connected: false, user: null, scopes: [] };
      }
      return originalMock(command, args);
    };

    const result = await refreshAccountCachedUser(account);
    expect(result).to.be.null;
  });

  it('updates accountConnectionStatus in store to connected', async () => {
    const account = createTestAccount({
      id: 'gh-status-1',
      name: 'Status GitHub',
      integrationType: 'github',
    });
    unifiedProfileStore.getState().setAccounts([account]);
    setMockToken('github', 'gh-status-1', 'ghp_validtoken');

    await refreshAccountCachedUser(account);

    const status = unifiedProfileStore.getState().accountConnectionStatus['gh-status-1'];
    expect(status).to.not.be.undefined;
    expect(status.status).to.equal('connected');
  });

  it('updates accountConnectionStatus in store to disconnected on failure', async () => {
    const account = createTestAccount({
      id: 'gh-disc-1',
      name: 'Disc GitHub',
      integrationType: 'github',
    });
    unifiedProfileStore.getState().setAccounts([account]);
    setMockToken('github', 'gh-disc-1', 'ghp_badtoken');

    const originalMock = mockInvoke;
    mockInvoke = async (command: string, args?: unknown) => {
      if (command === 'check_github_connection') {
        return { connected: false, user: null, scopes: [] };
      }
      return originalMock(command, args);
    };

    await refreshAccountCachedUser(account);

    const status = unifiedProfileStore.getState().accountConnectionStatus['gh-disc-1'];
    expect(status).to.not.be.undefined;
    expect(status.status).to.equal('disconnected');
  });

  it('returns null and sets disconnected when no token exists', async () => {
    const account = createTestAccount({
      id: 'gh-notoken-1',
      name: 'No Token GitHub',
      integrationType: 'github',
    });
    unifiedProfileStore.getState().setAccounts([account]);
    // Do NOT set a token in the mock store

    const result = await refreshAccountCachedUser(account);
    expect(result).to.be.null;

    const status = unifiedProfileStore.getState().accountConnectionStatus['gh-notoken-1'];
    expect(status).to.not.be.undefined;
    expect(status.status).to.equal('disconnected');
  });
});

describe('unified-profile.service - validateAllAccountTokens', () => {
  beforeEach(() => {
    unifiedProfileStore.getState().reset();
    invokeHistory.length = 0;
    tokenStore.clear();
    setupDefaultMockInvoke();
  });

  it('returns correct counts for all valid accounts', async () => {
    const ghAccount = createTestAccount({
      id: 'gh-valid-1',
      name: 'Valid GitHub',
      integrationType: 'github',
    });
    const glAccount = createTestAccount({
      id: 'gl-valid-1',
      name: 'Valid GitLab',
      integrationType: 'gitlab',
      config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
    });
    unifiedProfileStore.getState().setAccounts([ghAccount, glAccount]);

    setMockToken('github', 'gh-valid-1', 'ghp_valid');
    setMockToken('gitlab', 'gl-valid-1', 'glpat-valid');

    const result = await validateAllAccountTokens();

    expect(result.valid).to.equal(2);
    expect(result.invalid).to.equal(0);
    expect(result.invalidAccounts).to.have.lengthOf(0);
  });

  it('returns correct counts when some accounts are invalid', async () => {
    const ghAccount = createTestAccount({
      id: 'gh-mixed-1',
      name: 'Valid GitHub',
      integrationType: 'github',
    });
    const glAccount = createTestAccount({
      id: 'gl-mixed-1',
      name: 'Invalid GitLab',
      integrationType: 'gitlab',
      config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
    });
    unifiedProfileStore.getState().setAccounts([ghAccount, glAccount]);

    // Only set token for GitHub, GitLab has no token -> will be invalid
    setMockToken('github', 'gh-mixed-1', 'ghp_valid');

    const result = await validateAllAccountTokens();

    expect(result.valid).to.equal(1);
    expect(result.invalid).to.equal(1);
  });

  it('returns invalidAccounts list with account names and types', async () => {
    const ghAccount = createTestAccount({
      id: 'gh-inv-1',
      name: 'My GitHub Account',
      integrationType: 'github',
    });
    const glAccount = createTestAccount({
      id: 'gl-inv-1',
      name: 'My GitLab Account',
      integrationType: 'gitlab',
      config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
    });
    unifiedProfileStore.getState().setAccounts([ghAccount, glAccount]);

    // No tokens set -> both invalid

    const result = await validateAllAccountTokens();

    expect(result.invalid).to.equal(2);
    expect(result.invalidAccounts).to.have.lengthOf(2);

    const ghInvalid = result.invalidAccounts.find((a) => a.integrationType === 'github');
    expect(ghInvalid).to.not.be.undefined;
    expect(ghInvalid!.accountName).to.equal('My GitHub Account');
    expect(ghInvalid!.integrationType).to.equal('github');

    const glInvalid = result.invalidAccounts.find((a) => a.integrationType === 'gitlab');
    expect(glInvalid).to.not.be.undefined;
    expect(glInvalid!.accountName).to.equal('My GitLab Account');
    expect(glInvalid!.integrationType).to.equal('gitlab');
  });
});
