/**
 * Credential Service
 *
 * Provides secure credential storage using Tauri Stronghold plugin.
 * All credentials are stored encrypted in a local vault file.
 */

import { Client, Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir } from '@tauri-apps/api/path';

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

      console.log('[CredentialService] Initializing vault at:', vaultPath);

      strongholdInstance = await Stronghold.load(vaultPath, VAULT_PASSWORD);

      // Try to load existing client or create new one
      try {
        clientInstance = await strongholdInstance.loadClient(CLIENT_NAME);
        console.log('[CredentialService] Loaded existing client');
      } catch {
        // Client doesn't exist, create it
        clientInstance = await strongholdInstance.createClient(CLIENT_NAME);
        console.log('[CredentialService] Created new client');
      }
    } catch (error) {
      console.error('[CredentialService] Failed to initialize:', error);
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

    console.log(`[CredentialService] Stored credential: ${key}`);
  } catch (error) {
    console.error(`[CredentialService] Failed to store ${key}:`, error);
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
      console.log(`[CredentialService] No credential found for: ${key}`);
      return null;
    }

    // Convert byte array back to string
    const decoder = new TextDecoder();
    const value = decoder.decode(new Uint8Array(data));

    console.log(`[CredentialService] Retrieved credential: ${key}`);
    return value;
  } catch (error) {
    // If key doesn't exist, return null instead of throwing
    console.log(`[CredentialService] Credential not found: ${key}`);
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

    console.log(`[CredentialService] Deleted credential: ${key}`);
  } catch (error) {
    // Ignore if key doesn't exist
    console.log(`[CredentialService] Credential not found for deletion: ${key}`);
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
