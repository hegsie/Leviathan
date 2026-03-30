/**
 * Credential Service
 *
 * Provides secure credential storage using the OS system keyring
 * (macOS Keychain, Windows Credential Manager, Linux Secret Service).
 * Accessed via Tauri backend commands that use the `keyring` crate.
 */

import { invokeCommand } from './tauri-api.ts';
import { loggers } from '../utils/logger.ts';

const log = loggers.credential;

// Credential keys (used for legacy single-account storage)
export const CredentialKeys = {
  GITHUB_TOKEN: 'github_token',
  GITLAB_TOKEN: 'gitlab_token',
  BITBUCKET_USERNAME: 'bitbucket_username',
  BITBUCKET_PASSWORD: 'bitbucket_password',
  AZURE_DEVOPS_TOKEN: 'azure_devops_token',
} as const;

export type CredentialKey = (typeof CredentialKeys)[keyof typeof CredentialKeys];

// =============================================================================
// Core keyring operations (via Tauri backend)
// =============================================================================

async function keyringStore(key: string, value: string): Promise<void> {
  const result = await invokeCommand<void>('store_keyring_token', { key, value });
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to store credential');
  }
  log.debug(`Stored credential: ${key}`);
}

async function keyringGet(key: string): Promise<string | null> {
  const result = await invokeCommand<string | null>('get_keyring_token', { key });
  if (result.success && result.data) {
    log.debug(`Retrieved credential: ${key}`);
    return result.data;
  }
  return null;
}

async function keyringDelete(key: string): Promise<void> {
  const result = await invokeCommand<void>('delete_keyring_token', { key });
  if (result.success) {
    log.debug(`Deleted credential: ${key}`);
  } else {
    log.debug(`Credential not found for deletion: ${key}`);
  }
}

// =============================================================================
// Legacy single-credential functions (now backed by keyring)
// =============================================================================

/**
 * Store a credential
 */
export async function storeCredential(
  key: CredentialKey,
  value: string
): Promise<void> {
  return keyringStore(key, value);
}

/**
 * Retrieve a credential
 */
export async function getCredential(
  key: CredentialKey
): Promise<string | null> {
  return keyringGet(key);
}

/**
 * Delete a credential
 */
export async function deleteCredential(key: CredentialKey): Promise<void> {
  return keyringDelete(key);
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
 * Account-based credential management
 * Use these for the new multi-account system
 */
export const AccountCredentials = {
  /**
   * Get a token for a specific account
   */
  async getToken(integrationType: IntegrationType, accountId: string): Promise<string | null> {
    const key = getAccountCredentialKey(integrationType, accountId);
    return keyringGet(key);
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
    return keyringStore(key, token);
  },

  /**
   * Delete a token for a specific account
   */
  async deleteToken(integrationType: IntegrationType, accountId: string): Promise<void> {
    const key = getAccountCredentialKey(integrationType, accountId);
    return keyringDelete(key);
  },

  /**
   * Check if a token exists for a specific account
   */
  async hasToken(integrationType: IntegrationType, accountId: string): Promise<boolean> {
    const key = getAccountCredentialKey(integrationType, accountId);
    const value = await keyringGet(key);
    return value !== null && value.length > 0;
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
  await keyringStore(key, accessToken);

  // Store the full OAuth data separately for refresh handling
  await keyringStore(oauthKey, JSON.stringify(tokenData));

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

  const data = await keyringGet(oauthKey);
  if (!data) {
    // Fall back to just the access token if no OAuth data exists
    const accessToken = await keyringGet(key);
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

// ========================================================================
// GitHub App Installation
// ========================================================================

export interface GitHubAppConfig {
  appId: number;
  installationId: number;
}

export interface AppInstallation {
  id: number;
  account: { login: string; id: number; type: string; avatarUrl: string | null };
  appId: number;
  targetType: string;
}

export async function configureGitHubApp(
  appId: number,
  privateKeyPem: string,
  installationId: number,
): Promise<unknown> {
  const result = await invokeCommand<unknown>('configure_github_app', { appId, privateKeyPem, installationId });
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to configure GitHub App');
  }
  return result.data;
}

export async function getGitHubAppConfig(): Promise<GitHubAppConfig | null> {
  const result = await invokeCommand<GitHubAppConfig | null>('get_github_app_config');
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to get GitHub App config');
  }
  return result.data ?? null;
}

export async function removeGitHubAppConfig(): Promise<void> {
  const result = await invokeCommand<void>('remove_github_app_config');
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to remove GitHub App config');
  }
}

export async function listGitHubAppInstallations(
  appId: number,
  privateKeyPem: string,
): Promise<AppInstallation[]> {
  const result = await invokeCommand<AppInstallation[]>('list_github_app_installations', { appId, privateKeyPem });
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to list GitHub App installations');
  }
  return result.data ?? [];
}

// ========================================================================
// Git Credential Manager Detection
// ========================================================================

export interface CredentialManagerStatus {
  gcmAvailable: boolean;
  gcmVersion: string | null;
  configuredHelper: string | null;
  usingLeviathanFallback: boolean;
}

export async function detectCredentialManager(
  repoPath: string,
): Promise<CredentialManagerStatus> {
  const result = await invokeCommand<CredentialManagerStatus>('detect_credential_manager', { path: repoPath });
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to detect credential manager');
  }
  return result.data!;
}
