/**
 * Integration Accounts Service
 * Provides high-level operations for managing integration accounts via Tauri commands
 */

import { invokeCommand } from './tauri-api.ts';
import { integrationAccountsStore } from '../stores/integration-accounts.store.ts';
import { AccountCredentials } from './credential.service.ts';
import type { CommandResult } from '../types/api.types.ts';
import type {
  IntegrationAccount,
  IntegrationAccountsConfig,
  IntegrationType,
  CachedUser,
  MigrationResult,
  IntegrationConfig,
} from '../types/integration-accounts.types.ts';

// =============================================================================
// Account CRUD Operations
// =============================================================================

/**
 * Get all integration accounts
 */
export async function getIntegrationAccounts(): Promise<
  CommandResult<IntegrationAccount[]>
> {
  return invokeCommand<IntegrationAccount[]>('get_integration_accounts');
}

/**
 * Get integration accounts config including repository assignments
 */
export async function getIntegrationAccountsConfig(): Promise<
  CommandResult<IntegrationAccountsConfig>
> {
  return invokeCommand<IntegrationAccountsConfig>(
    'get_integration_accounts_config'
  );
}

/**
 * Get accounts filtered by integration type
 */
export async function getAccountsByType(
  integrationType: IntegrationType
): Promise<CommandResult<IntegrationAccount[]>> {
  return invokeCommand<IntegrationAccount[]>('get_accounts_by_type', {
    integrationType,
  });
}

/**
 * Get a single account by ID
 */
export async function getIntegrationAccount(
  accountId: string
): Promise<CommandResult<IntegrationAccount | null>> {
  return invokeCommand<IntegrationAccount | null>('get_integration_account', {
    accountId,
  });
}

/**
 * Save an integration account (create or update)
 */
export async function saveIntegrationAccount(
  account: IntegrationAccount
): Promise<CommandResult<IntegrationAccount>> {
  const result = await invokeCommand<IntegrationAccount>(
    'save_integration_account',
    { account }
  );

  // Update store on success
  if (result.success && result.data) {
    const store = integrationAccountsStore.getState();
    const existingAccount = store.accounts.find((a) => a.id === result.data!.id);
    if (existingAccount) {
      store.updateAccount(result.data);
    } else {
      store.addAccount(result.data);
    }
  }

  return result;
}

/**
 * Delete an integration account
 */
export async function deleteIntegrationAccount(
  accountId: string
): Promise<CommandResult<void>> {
  const result = await invokeCommand<void>('delete_integration_account', {
    accountId,
  });

  // Update store on success
  if (result.success) {
    integrationAccountsStore.getState().removeAccount(accountId);
  }

  return result;
}

/**
 * Set an account as the default for its integration type
 */
export async function setDefaultAccount(
  accountId: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_default_account', { accountId });
}

// =============================================================================
// Account Detection and Assignment
// =============================================================================

/**
 * Detect which account should be used for a repository based on URL patterns
 */
export async function detectAccountForRepository(
  path: string,
  integrationType: IntegrationType
): Promise<CommandResult<IntegrationAccount | null>> {
  return invokeCommand<IntegrationAccount | null>(
    'detect_account_for_repository',
    { path, integrationType }
  );
}

/**
 * Get the assigned account for a repository
 */
export async function getAssignedAccount(
  path: string,
  integrationType: IntegrationType
): Promise<CommandResult<IntegrationAccount | null>> {
  return invokeCommand<IntegrationAccount | null>('get_assigned_account', {
    path,
    integrationType,
  });
}

/**
 * Manually assign an account to a repository
 */
export async function assignAccountToRepository(
  path: string,
  accountId: string
): Promise<CommandResult<void>> {
  const result = await invokeCommand<void>('assign_account_to_repository', {
    path,
    accountId,
  });

  // Update store on success
  if (result.success) {
    integrationAccountsStore
      .getState()
      .assignAccountToRepository(path, accountId);
  }

  return result;
}

/**
 * Remove account assignment from a repository
 */
export async function unassignAccountFromRepository(
  path: string
): Promise<CommandResult<void>> {
  const result = await invokeCommand<void>('unassign_account_from_repository', {
    path,
  });

  // Update store on success
  if (result.success) {
    integrationAccountsStore.getState().unassignAccountFromRepository(path);
  }

  return result;
}

// =============================================================================
// Account User Cache
// =============================================================================

/**
 * Update the cached user info for an account
 */
export async function updateAccountCachedUser(
  accountId: string,
  user: CachedUser
): Promise<CommandResult<void>> {
  return invokeCommand<void>('update_account_cached_user', { accountId, user });
}

/**
 * Clear the cached user info for an account
 */
export async function clearAccountCachedUser(
  accountId: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('clear_account_cached_user', { accountId });
}

// =============================================================================
// Token Management (via credential service)
// =============================================================================

/**
 * Store a token for an account
 */
export async function storeAccountToken(
  integrationType: IntegrationType,
  accountId: string,
  token: string
): Promise<void> {
  await AccountCredentials.setToken(integrationType, accountId, token);
}

/**
 * Get a token for an account
 */
export async function getAccountToken(
  integrationType: IntegrationType,
  accountId: string
): Promise<string | null> {
  return AccountCredentials.getToken(integrationType, accountId);
}

/**
 * Delete a token for an account
 */
export async function deleteAccountToken(
  integrationType: IntegrationType,
  accountId: string
): Promise<void> {
  await AccountCredentials.deleteToken(integrationType, accountId);
}

/**
 * Check if an account has a token
 */
export async function hasAccountToken(
  integrationType: IntegrationType,
  accountId: string
): Promise<boolean> {
  return AccountCredentials.hasToken(integrationType, accountId);
}

// =============================================================================
// Migration
// =============================================================================

/**
 * Migrate legacy single tokens to the new multi-account system
 */
export async function migrateLegacyTokens(): Promise<
  CommandResult<MigrationResult>
> {
  return invokeCommand<MigrationResult>('migrate_legacy_tokens');
}

/**
 * Create a default account during migration
 */
export async function createMigratedAccount(
  name: string,
  integrationType: IntegrationType,
  config: IntegrationConfig,
  cachedUser: CachedUser | null
): Promise<CommandResult<IntegrationAccount>> {
  const result = await invokeCommand<IntegrationAccount>(
    'create_migrated_account',
    {
      name,
      integrationType,
      config,
      cachedUser,
    }
  );

  // Update store on success
  if (result.success && result.data) {
    integrationAccountsStore.getState().addAccount(result.data);
  }

  return result;
}

// =============================================================================
// Store Initialization
// =============================================================================

/**
 * Load all accounts and repository assignments into the store
 * Also performs one-time migration of legacy tokens to the new account system
 */
export async function loadAccountsIntoStore(): Promise<void> {
  const result = await getIntegrationAccountsConfig();

  if (result.success && result.data) {
    integrationAccountsStore.getState().setAccounts(result.data.accounts);
    integrationAccountsStore
      .getState()
      .setRepositoryAssignments(result.data.repositoryAssignments);

    // Perform legacy token migration if no accounts exist
    if (result.data.accounts.length === 0) {
      await migrateLegacyTokensToAccounts();
    }
  }
}

/**
 * Migrate legacy single tokens to the new multi-account system
 * This runs once when no accounts exist
 */
async function migrateLegacyTokensToAccounts(): Promise<void> {
  const integrationTypes: IntegrationType[] = ['github', 'gitlab', 'azure-devops'];

  for (const type of integrationTypes) {
    try {
      // Check if legacy token exists
      const legacyToken = await getLegacyToken(type);
      if (!legacyToken) continue;

      // Create a new account for the legacy token
      const account = await createMigratedAccount(
        `${getIntegrationDisplayName(type)} (Migrated)`,
        type,
        getDefaultConfig(type),
        null
      );

      if (account.success && account.data) {
        // Migrate the token to the new account
        await AccountCredentials.migrateLegacyToken(type, account.data.id);
        console.log(`[IntegrationAccounts] Migrated legacy ${type} token to account ${account.data.id}`);
      }
    } catch (error) {
      console.warn(`[IntegrationAccounts] Failed to migrate ${type} token:`, error);
    }
  }

  // Reload accounts after migration
  const result = await getIntegrationAccountsConfig();
  if (result.success && result.data) {
    integrationAccountsStore.getState().setAccounts(result.data.accounts);
  }
}

/**
 * Get legacy token for an integration type
 */
async function getLegacyToken(type: IntegrationType): Promise<string | null> {
  const { GitHubCredentials, GitLabCredentials, AzureDevOpsCredentials } = await import('./credential.service.ts');

  switch (type) {
    case 'github':
      return GitHubCredentials.getToken();
    case 'gitlab':
      return GitLabCredentials.getToken();
    case 'azure-devops':
      return AzureDevOpsCredentials.getToken();
    default:
      return null;
  }
}

/**
 * Get display name for an integration type
 */
function getIntegrationDisplayName(type: IntegrationType): string {
  switch (type) {
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'azure-devops':
      return 'Azure DevOps';
    default:
      return type;
  }
}

/**
 * Get default config for an integration type
 */
function getDefaultConfig(type: IntegrationType): IntegrationConfig {
  switch (type) {
    case 'github':
      return { type: 'github' };
    case 'gitlab':
      return { type: 'gitlab', instanceUrl: 'https://gitlab.com' };
    case 'azure-devops':
      return { type: 'azure-devops', organization: '' };
    default:
      return { type: 'github' };
  }
}

/**
 * Initialize accounts for a repository (detect and set active accounts)
 */
export async function initializeAccountsForRepository(
  repoPath: string,
  remoteUrl: string | null
): Promise<void> {
  const store = integrationAccountsStore.getState();

  // Detect accounts for each integration type
  const integrationTypes: IntegrationType[] = [
    'github',
    'gitlab',
    'azure-devops',
  ];

  for (const type of integrationTypes) {
    const result = await detectAccountForRepository(repoPath, type);
    if (result.success && result.data) {
      store.setActiveAccount(type, result.data);
    } else {
      // Try to find best account from store
      const { findBestAccountForRepository } = await import(
        '../stores/integration-accounts.store.ts'
      );
      const bestAccount = findBestAccountForRepository(
        repoPath,
        remoteUrl,
        type
      );
      store.setActiveAccount(type, bestAccount ?? null);
    }
  }
}
