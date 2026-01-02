/**
 * Credential Service
 *
 * Provides secure credential storage using Tauri Stronghold plugin.
 * All credentials are stored encrypted in a local vault file.
 */

import { Client, Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir } from '@tauri-apps/api/path';
import { loggers } from '../utils/logger.ts';

const log = loggers.credential;

const VAULT_PASSWORD = 'leviathan-secure-vault-2024';
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
      const vaultPath = `${dataDir}credentials.hold`;

      log.debug('Initializing vault at:', vaultPath);

      strongholdInstance = await Stronghold.load(vaultPath, VAULT_PASSWORD);

      // Try to load existing client or create new one
      try {
        clientInstance = await strongholdInstance.loadClient(CLIENT_NAME);
        log.debug('Loaded existing client');
      } catch {
        // Client doesn't exist, create it
        clientInstance = await strongholdInstance.createClient(CLIENT_NAME);
        log.debug(' Created new client');
      }
    } catch (error) {
      log.error(' Failed to initialize:', error);
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
