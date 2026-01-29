/**
 * Credential Service
 *
 * Provides secure credential storage using Tauri Stronghold plugin.
 * All credentials are stored encrypted in a local vault file.
 */

import { Client, Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { loggers } from '../utils/logger.ts';

const log = loggers.credential;

// Machine-specific vault password - fetched from backend
let cachedVaultPassword: string | null = null;

/**
 * Get the machine-specific vault password
 * This password is derived from machine-specific information (hostname, username)
 * to ensure each installation has a unique vault password
 */
async function getVaultPassword(): Promise<string> {
  if (cachedVaultPassword) {
    return cachedVaultPassword;
  }

  try {
    cachedVaultPassword = await invoke<string>('get_machine_vault_password');
    if (!cachedVaultPassword) {
      throw new Error('Backend returned empty vault password');
    }
    return cachedVaultPassword;
  } catch (error) {
    log.error('Failed to get machine vault password:', error);
    throw new Error(
      'Failed to initialize secure vault. Cannot proceed without machine-specific encryption key.'
    );
  }
}

const CLIENT_NAME = 'leviathan-credentials';

// Credential keys
export const CredentialKeys = {
  GITHUB_TOKEN: 'github_token',
  GITLAB_TOKEN: 'gitlab_token',
  BITBUCKET_USERNAME: 'bitbucket_username',
  BITBUCKET_PASSWORD: 'bitbucket_password',
  AZURE_DEVOPS_TOKEN: 'azure_devops_token',
} as const;

export type CredentialKey = (typeof CredentialKeys)[keyof typeof CredentialKeys];

let strongholdInstance: Stronghold | null = null;
let clientInstance: Client | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Migrate old vault file to new location if needed
 * Old path: ~/Library/Application Support/io.github.hegsie.leviathancredentials.hold (missing /)
 * New path: ~/Library/Application Support/io.github.hegsie.leviathan/credentials.hold
 */
async function migrateOldVaultIfNeeded(dataDir: string, newVaultPath: string): Promise<void> {
  try {
    // Use Tauri command to check and migrate vault
    await invoke('migrate_vault_if_needed', {
      dataDir,
      newVaultPath,
    });
  } catch (error) {
    log.warn('Failed to migrate old vault (may not exist):', error);
    // Continue - we'll create a new vault
  }
}

// Legacy hardcoded password used before machine-specific derivation was added.
// Kept as a fallback so existing vaults created with the old password can still be opened.
const LEGACY_VAULT_PASSWORD = 'leviathan-secure-vault-2024';

/**
 * Initialize the Stronghold vault
 */
async function ensureInitialized(): Promise<Client> {
  if (clientInstance) {
    return clientInstance;
  }

  if (initPromise) {
    await initPromise;
    if (clientInstance) {
      return clientInstance;
    }
  }

  initPromise = (async () => {
    try {
      const dataDir = await appDataDir();
      const vaultPath = `${dataDir}/credentials.hold`;

      // Migrate old vault if it exists at the wrong path
      await migrateOldVaultIfNeeded(dataDir, vaultPath);

      log.debug('Initializing vault at:', vaultPath);

      // Try machine-specific password first, fall back to legacy password
      // so existing vaults created before the security fix still work.
      const vaultPassword = await getVaultPassword();

      try {
        strongholdInstance = await Stronghold.load(vaultPath, vaultPassword);
      } catch {
        log.warn(
          'Failed to open vault with machine-specific password, trying legacy password'
        );
        strongholdInstance = await Stronghold.load(vaultPath, LEGACY_VAULT_PASSWORD);
      }

      // Try to load existing client or create new one
      try {
        clientInstance = await strongholdInstance.loadClient(CLIENT_NAME);
        log.debug('Loaded existing client');
      } catch {
        // Client doesn't exist, create it
        clientInstance = await strongholdInstance.createClient(CLIENT_NAME);
        log.debug('Created new client');
      }
    } catch (error) {
      log.error('Failed to initialize:', error);
      throw error;
    }
  })();

  await initPromise;

  if (!clientInstance) {
    throw new Error('Failed to initialize credential store');
  }

  return clientInstance;
}

/**
 * Store a credential
 */
export async function storeCredential(
  key: CredentialKey,
  value: string
): Promise<void> {
  try {
    const client = await ensureInitialized();
    const store = client.getStore();

    // Convert string to byte array
    const encoder = new TextEncoder();
    const data = Array.from(encoder.encode(value));

    await store.insert(key, data);
    await strongholdInstance?.save();

    log.debug(` Stored credential: ${key}`);
  } catch (error) {
    log.error(` Failed to store ${key}:`, error);
    throw error;
  }
}

/**
 * Retrieve a credential
 */
export async function getCredential(
  key: CredentialKey
): Promise<string | null> {
  try {
    const client = await ensureInitialized();
    const store = client.getStore();

    const data = await store.get(key);

    if (!data || data.length === 0) {
      log.debug(` No credential found for: ${key}`);
      return null;
    }

    // Convert byte array back to string
    const decoder = new TextDecoder();
    const value = decoder.decode(new Uint8Array(data));

    log.debug(` Retrieved credential: ${key}`);
    return value;
  } catch {
    // If key doesn't exist, return null instead of throwing
    log.debug(` Credential not found: ${key}`);
    return null;
  }
}

/**
 * Delete a credential
 */
export async function deleteCredential(key: CredentialKey): Promise<void> {
  try {
    const client = await ensureInitialized();
    const store = client.getStore();

    await store.remove(key);
    await strongholdInstance?.save();

    log.debug(` Deleted credential: ${key}`);
  } catch {
    // Ignore if key doesn't exist
    log.debug(` Credential not found for deletion: ${key}`);
  }
}

/**
 * Check if a credential exists
 */
export async function hasCredential(key: CredentialKey): Promise<boolean> {
  const value = await getCredential(key);
  return value !== null && value.length > 0;
}

// Convenience functions for specific integrations

export const GitHubCredentials = {
  async getToken(): Promise<string | null> {
    return getCredential(CredentialKeys.GITHUB_TOKEN);
  },
  async setToken(token: string): Promise<void> {
    return storeCredential(CredentialKeys.GITHUB_TOKEN, token);
  },
  async deleteToken(): Promise<void> {
    return deleteCredential(CredentialKeys.GITHUB_TOKEN);
  },
  async hasToken(): Promise<boolean> {
    return hasCredential(CredentialKeys.GITHUB_TOKEN);
  },
};

export const GitLabCredentials = {
  async getToken(): Promise<string | null> {
    return getCredential(CredentialKeys.GITLAB_TOKEN);
  },
  async setToken(token: string): Promise<void> {
    return storeCredential(CredentialKeys.GITLAB_TOKEN, token);
  },
  async deleteToken(): Promise<void> {
    return deleteCredential(CredentialKeys.GITLAB_TOKEN);
  },
  async hasToken(): Promise<boolean> {
    return hasCredential(CredentialKeys.GITLAB_TOKEN);
  },
};

export const BitbucketCredentials = {
  async getCredentials(): Promise<{ username: string; password: string } | null> {
    const username = await getCredential(CredentialKeys.BITBUCKET_USERNAME);
    const password = await getCredential(CredentialKeys.BITBUCKET_PASSWORD);
    if (username && password) {
      return { username, password };
    }
    return null;
  },
  async setCredentials(username: string, password: string): Promise<void> {
    await storeCredential(CredentialKeys.BITBUCKET_USERNAME, username);
    await storeCredential(CredentialKeys.BITBUCKET_PASSWORD, password);
  },
  async deleteCredentials(): Promise<void> {
    await deleteCredential(CredentialKeys.BITBUCKET_USERNAME);
    await deleteCredential(CredentialKeys.BITBUCKET_PASSWORD);
  },
  async hasCredentials(): Promise<boolean> {
    return (
      (await hasCredential(CredentialKeys.BITBUCKET_USERNAME)) &&
      (await hasCredential(CredentialKeys.BITBUCKET_PASSWORD))
    );
  },
};

export const AzureDevOpsCredentials = {
  async getToken(): Promise<string | null> {
    return getCredential(CredentialKeys.AZURE_DEVOPS_TOKEN);
  },
  async setToken(token: string): Promise<void> {
    return storeCredential(CredentialKeys.AZURE_DEVOPS_TOKEN, token);
  },
  async deleteToken(): Promise<void> {
    return deleteCredential(CredentialKeys.AZURE_DEVOPS_TOKEN);
  },
  async hasToken(): Promise<boolean> {
    return hasCredential(CredentialKeys.AZURE_DEVOPS_TOKEN);
  },
};

// =============================================================================
// Multi-Account Credential Support
// =============================================================================

import type { IntegrationType } from '../types/integration-accounts.types.ts';

/**
 * Generate a namespaced credential key for an account
 */
export function getAccountCredentialKey(
  integrationType: IntegrationType,
  accountId: string
): string {
  return `${integrationType}_token_${accountId}`;
}

/**
 * Store a credential for a specific account (using dynamic key)
 */
async function storeAccountCredentialInternal(key: string, value: string): Promise<void> {
  try {
    const client = await ensureInitialized();
    const store = client.getStore();

    const encoder = new TextEncoder();
    const data = Array.from(encoder.encode(value));

    await store.insert(key, data);
    await strongholdInstance?.save();

    log.debug(` Stored account credential: ${key}`);
  } catch (error) {
    log.error(` Failed to store account credential ${key}:`, error);
    throw error;
  }
}

/**
 * Get a credential for a specific account (using dynamic key)
 */
async function getAccountCredentialInternal(key: string): Promise<string | null> {
  try {
    const client = await ensureInitialized();
    const store = client.getStore();

    const data = await store.get(key);

    if (!data || data.length === 0) {
      log.debug(` No account credential found for: ${key}`);
      return null;
    }

    const decoder = new TextDecoder();
    const value = decoder.decode(new Uint8Array(data));

    log.debug(` Retrieved account credential: ${key}`);
    return value;
  } catch {
    log.debug(` Account credential not found: ${key}`);
    return null;
  }
}

/**
 * Delete a credential for a specific account (using dynamic key)
 */
async function deleteAccountCredentialInternal(key: string): Promise<void> {
  try {
    const client = await ensureInitialized();
    const store = client.getStore();

    await store.remove(key);
    await strongholdInstance?.save();

    log.debug(` Deleted account credential: ${key}`);
  } catch {
    log.debug(` Account credential not found for deletion: ${key}`);
  }
}

/**
 * Check if a credential exists for a specific account (using dynamic key)
 */
async function hasAccountCredentialInternal(key: string): Promise<boolean> {
  const value = await getAccountCredentialInternal(key);
  return value !== null && value.length > 0;
}

/**
 * Account-based credential management
 * Use these for the new multi-account system
 */
export const AccountCredentials = {
  /**
   * Get a token for a specific account
   */
  async getToken(integrationType: IntegrationType, accountId: string): Promise<string | null> {
    const key = getAccountCredentialKey(integrationType, accountId);
    return getAccountCredentialInternal(key);
  },

  /**
   * Store a token for a specific account
   */
  async setToken(
    integrationType: IntegrationType,
    accountId: string,
    token: string
  ): Promise<void> {
    const key = getAccountCredentialKey(integrationType, accountId);
    return storeAccountCredentialInternal(key, token);
  },

  /**
   * Delete a token for a specific account
   */
  async deleteToken(integrationType: IntegrationType, accountId: string): Promise<void> {
    const key = getAccountCredentialKey(integrationType, accountId);
    return deleteAccountCredentialInternal(key);
  },

  /**
   * Check if a token exists for a specific account
   */
  async hasToken(integrationType: IntegrationType, accountId: string): Promise<boolean> {
    const key = getAccountCredentialKey(integrationType, accountId);
    return hasAccountCredentialInternal(key);
  },

  /**
   * Migrate a legacy token to an account
   * Copies the legacy token to the new namespaced key
   */
  async migrateLegacyToken(
    integrationType: IntegrationType,
    accountId: string
  ): Promise<boolean> {
    // Map integration type to legacy credential key
    let legacyKey: CredentialKey;
    switch (integrationType) {
      case 'github':
        legacyKey = CredentialKeys.GITHUB_TOKEN;
        break;
      case 'gitlab':
        legacyKey = CredentialKeys.GITLAB_TOKEN;
        break;
      case 'azure-devops':
        legacyKey = CredentialKeys.AZURE_DEVOPS_TOKEN;
        break;
      default:
        return false;
    }

    const legacyToken = await getCredential(legacyKey);
    if (!legacyToken) {
      return false;
    }

    // Store the token with the new namespaced key
    await this.setToken(integrationType, accountId, legacyToken);
    log.debug(` Migrated legacy ${integrationType} token to account ${accountId}`);
    return true;
  },
};

// =============================================================================
// Convenience Exports for Account Tokens
// =============================================================================

/**
 * Get a token for a specific integration account
 */
export async function getAccountToken(
  integrationType: IntegrationType,
  accountId: string
): Promise<string | null> {
  return AccountCredentials.getToken(integrationType, accountId);
}

/**
 * Store a token for a specific integration account
 */
export async function storeAccountToken(
  integrationType: IntegrationType,
  accountId: string,
  token: string
): Promise<void> {
  return AccountCredentials.setToken(integrationType, accountId, token);
}

/**
 * Delete a token for a specific integration account
 */
export async function deleteAccountToken(
  integrationType: IntegrationType,
  accountId: string
): Promise<void> {
  return AccountCredentials.deleteToken(integrationType, accountId);
}

/**
 * Check if a token exists for a specific integration account
 */
export async function hasAccountToken(
  integrationType: IntegrationType,
  accountId: string
): Promise<boolean> {
  return AccountCredentials.hasToken(integrationType, accountId);
}

// =============================================================================
// OAuth Token Support
// =============================================================================

interface OAuthTokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Store an OAuth token for a specific integration account.
 * Stores access token, refresh token, and calculates expiry time.
 */
export async function storeAccountOAuthToken(
  integrationType: IntegrationType,
  accountId: string,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number
): Promise<void> {
  // Calculate expiry timestamp if expiresIn is provided
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

  // Store as JSON with all OAuth data
  const tokenData: OAuthTokenData = {
    accessToken,
    refreshToken,
    expiresAt,
  };

  const key = getAccountCredentialKey(integrationType, accountId);
  const oauthKey = `${key}_oauth`;

  // Store the access token as the main credential (for backward compatibility)
  await storeAccountCredentialInternal(key, accessToken);

  // Store the full OAuth data separately for refresh handling
  await storeAccountCredentialInternal(oauthKey, JSON.stringify(tokenData));

  log.debug(` Stored OAuth token for ${integrationType} account ${accountId}`);
}

/**
 * Get the full OAuth token data for an account (including refresh token and expiry)
 */
export async function getAccountOAuthToken(
  integrationType: IntegrationType,
  accountId: string
): Promise<OAuthTokenData | null> {
  const key = getAccountCredentialKey(integrationType, accountId);
  const oauthKey = `${key}_oauth`;

  const data = await getAccountCredentialInternal(oauthKey);
  if (!data) {
    // Fall back to just the access token if no OAuth data exists
    const accessToken = await getAccountCredentialInternal(key);
    if (accessToken) {
      return { accessToken };
    }
    return null;
  }

  try {
    return JSON.parse(data) as OAuthTokenData;
  } catch {
    log.warn(` Failed to parse OAuth token data for ${integrationType} account ${accountId}`);
    return null;
  }
}

/**
 * Check if an OAuth token needs refresh (within 5 minutes of expiry)
 */
export async function isOAuthTokenExpiring(
  integrationType: IntegrationType,
  accountId: string
): Promise<boolean> {
  const tokenData = await getAccountOAuthToken(integrationType, accountId);
  if (!tokenData?.expiresAt) {
    return false; // No expiry data, assume token is valid
  }

  // Check if token expires within 5 minutes
  const fiveMinutes = 5 * 60 * 1000;
  return Date.now() > tokenData.expiresAt - fiveMinutes;
}
