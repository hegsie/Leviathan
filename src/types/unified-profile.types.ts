/**
 * Unified profile types - combines git identity with global integration accounts
 *
 * Architecture (v3):
 * - Profiles contain git identity (name, email, signing key) + default account preferences
 * - Integration accounts are GLOBAL - available to all profiles, not owned by profiles
 * - Repository assignments map repos to profiles (for git identity)
 * - Any account can be used regardless of active profile
 */

// Re-export common types and constants from integration accounts
export type { IntegrationType, IntegrationConfig, CachedUser, IntegrationAccount } from './integration-accounts.types';
export {
  ACCOUNT_COLORS,
  createEmptyGitHubAccount,
  createEmptyGitLabAccount,
  createEmptyAzureDevOpsAccount,
  createEmptyBitbucketAccount,
  INTEGRATION_TYPE_NAMES,
} from './integration-accounts.types';
import {
  type IntegrationType,
  type IntegrationConfig,
  type CachedUser,
  type IntegrationAccount,
  createEmptyGitHubAccount,
  createEmptyGitLabAccount,
  createEmptyAzureDevOpsAccount,
  createEmptyBitbucketAccount,
} from './integration-accounts.types';

/**
 * Current version of the unified profiles config format
 * v3: Global accounts (accounts no longer nested in profiles)
 */
export const UNIFIED_PROFILES_CONFIG_VERSION = 3;

/**
 * Profile colors for UI display
 */
export const PROFILE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
] as const;

/**
 * @deprecated Use IntegrationAccount instead. This type is kept for migration from v2.
 * Integration account linked to a unified profile (v2 format)
 */
export interface ProfileIntegrationAccount {
  /** Unique identifier (UUID) */
  id: string;
  /** Display name (e.g., "Work GitHub", "GitHub Enterprise SSO") */
  name: string;
  /** Integration type */
  integrationType: IntegrationType;
  /** Integration-specific configuration */
  config: IntegrationConfig;
  /** Optional color for UI display (inherits from profile if null) */
  color: string | null;
  /** Cached user info (updated on connection check) */
  cachedUser: CachedUser | null;
  /** Whether this is the default account for this integration type within the profile */
  isDefaultForType: boolean;
}

/**
 * Unified profile containing git identity and default account preferences (v3)
 *
 * A profile represents a git identity context (e.g., "Work", "Personal").
 * Accounts are now global - profiles only store preferences for which account
 * to use as default for each integration type.
 */
export interface UnifiedProfile {
  /** Unique identifier */
  id: string;
  /** Display name (e.g., "Work", "Personal", "Open Source") */
  name: string;

  // Git Identity
  /** Git user.name value */
  gitName: string;
  /** Git user.email value */
  gitEmail: string;
  /** Optional GPG signing key ID */
  signingKey: string | null;

  // Profile Settings
  /** URL patterns for auto-detection (e.g., "github.com/mycompany/*") */
  urlPatterns: string[];
  /** Whether this is the default profile */
  isDefault: boolean;
  /** Color for UI display */
  color: string;

  // Default Account Preferences (v3)
  /** Default account ID for each integration type (optional per type) */
  defaultAccounts: Partial<Record<IntegrationType, string>>;
}

/**
 * @deprecated Use UnifiedProfile instead. This type is kept for migration from v2.
 * Unified profile with embedded accounts (v2 format)
 */
export interface UnifiedProfileV2 {
  id: string;
  name: string;
  gitName: string;
  gitEmail: string;
  signingKey: string | null;
  urlPatterns: string[];
  isDefault: boolean;
  color: string;
  integrationAccounts: ProfileIntegrationAccount[];
}

/**
 * Configuration for storing unified profiles and global accounts (v3)
 */
export interface UnifiedProfilesConfig {
  /** Version number for migration support (currently 3) */
  version: number;
  /** All saved profiles */
  profiles: UnifiedProfile[];
  /** Global integration accounts (available to all profiles) */
  accounts: IntegrationAccount[];
  /** Repository to profile assignments (repo path -> profile id) */
  repositoryAssignments: Record<string, string>;
}

/**
 * How a profile was assigned to a repository
 */
export type ProfileAssignmentSource = 'manual' | 'url-pattern' | 'default' | 'none';

/**
 * @deprecated Use UnifiedProfilesConfig instead. This type is kept for migration from v2.
 */
export interface UnifiedProfilesConfigV2 {
  version: number;
  profiles: UnifiedProfileV2[];
  repositoryAssignments: Record<string, string>;
}

/**
 * Current git identity for a repository
 */
export interface CurrentGitIdentity {
  name: string | null;
  email: string | null;
  signingKey: string | null;
}

// =============================================================================
// Migration Types
// =============================================================================

/**
 * An account that couldn't be automatically matched to a profile during migration
 */
export interface UnmatchedAccount {
  accountId: string;
  accountName: string;
  integrationType: IntegrationType;
  suggestedProfileId: string | null;
}

/**
 * Result of migrating to unified profiles
 */
export interface UnifiedMigrationResult {
  success: boolean;
  profilesMigrated: number;
  accountsMigrated: number;
  unmatchedAccounts: UnmatchedAccount[];
  errors: string[];
}

/**
 * Preview of how an account will be matched during migration
 */
export interface MigrationPreviewAccount {
  accountId: string;
  accountName: string;
  integrationType: IntegrationType;
}

/**
 * Preview of a profile with its matched accounts during migration
 */
export interface MigrationPreviewProfile {
  profileId: string;
  profileName: string;
  gitEmail: string;
  matchedAccounts: MigrationPreviewAccount[];
}

/**
 * Complete migration preview
 */
export interface MigrationPreview {
  profiles: MigrationPreviewProfile[];
  unmatchedAccounts: UnmatchedAccount[];
}

/**
 * Information about a migration backup (for rollback)
 */
export interface MigrationBackupInfo {
  hasBackup: boolean;
  backupDate: string | null;
  profilesCount: number | null;
  accountsCount: number | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create an empty unified profile (v3)
 */
export function createEmptyUnifiedProfile(): Omit<UnifiedProfile, 'id'> {
  return {
    name: '',
    gitName: '',
    gitEmail: '',
    signingKey: null,
    urlPatterns: [],
    isDefault: false,
    color: PROFILE_COLORS[0],
    defaultAccounts: {},
  };
}

/**
 * Create an empty integration account of any type (global)
 * This is a generic factory that calls the type-specific factory functions
 */
export function createEmptyIntegrationAccount(
  integrationType: IntegrationType,
  instanceOrOrg?: string
): Omit<IntegrationAccount, 'id'> {
  switch (integrationType) {
    case 'github':
      return createEmptyGitHubAccount();
    case 'gitlab':
      return createEmptyGitLabAccount(instanceOrOrg ?? 'https://gitlab.com');
    case 'azure-devops':
      return createEmptyAzureDevOpsAccount(instanceOrOrg ?? '');
    case 'bitbucket':
      return createEmptyBitbucketAccount(instanceOrOrg ?? '');
    default:
      throw new Error(`Unknown integration type: ${integrationType}`);
  }
}

// Deprecated aliases for backward compatibility during migration
/** @deprecated Use createEmptyGitHubAccount instead */
export const createEmptyGitHubProfileAccount = createEmptyGitHubAccount;
/** @deprecated Use createEmptyGitLabAccount instead */
export const createEmptyGitLabProfileAccount = createEmptyGitLabAccount;
/** @deprecated Use createEmptyAzureDevOpsAccount instead */
export const createEmptyAzureDevOpsProfileAccount = createEmptyAzureDevOpsAccount;
/** @deprecated Use createEmptyBitbucketAccount instead */
export const createEmptyBitbucketProfileAccount = createEmptyBitbucketAccount;

/**
 * Generate a UUID for profile/account IDs
 */
export function generateId(): string {
  return crypto.randomUUID();
}

// =============================================================================
// Global Account Helper Functions (v3)
// =============================================================================

/**
 * Filter global accounts by integration type
 */
export function filterAccountsByType(
  accounts: IntegrationAccount[],
  integrationType: IntegrationType
): IntegrationAccount[] {
  return accounts.filter((a) => a.integrationType === integrationType);
}

/**
 * Get the default global account for a specific type
 */
export function getDefaultGlobalAccount(
  accounts: IntegrationAccount[],
  integrationType: IntegrationType
): IntegrationAccount | undefined {
  const typeAccounts = filterAccountsByType(accounts, integrationType);
  return typeAccounts.find((a) => a.isDefault) || typeAccounts[0];
}

/**
 * Get the profile's preferred account for a specific type
 * Falls back to global default if profile has no preference
 */
export function getProfilePreferredAccount(
  profile: UnifiedProfile,
  accounts: IntegrationAccount[],
  integrationType: IntegrationType
): IntegrationAccount | undefined {
  const preferredId = profile.defaultAccounts[integrationType];
  if (preferredId) {
    const preferred = accounts.find((a) => a.id === preferredId);
    if (preferred) return preferred;
  }
  // Fall back to global default
  return getDefaultGlobalAccount(accounts, integrationType);
}

/**
 * Get account count by type from global accounts
 */
export function getGlobalAccountCountByType(
  accounts: IntegrationAccount[]
): Record<IntegrationType, number> {
  const counts: Record<IntegrationType, number> = {
    github: 0,
    gitlab: 0,
    'azure-devops': 0,
    bitbucket: 0,
  };

  for (const account of accounts) {
    counts[account.integrationType]++;
  }

  return counts;
}

/**
 * Get display label for an account (name + context info)
 */
export function getAccountDisplayLabel(account: IntegrationAccount | ProfileIntegrationAccount): string {
  const parts = [account.name];

  if (account.config.type === 'gitlab' && account.config.instanceUrl) {
    try {
      const url = new URL(account.config.instanceUrl);
      if (url.hostname !== 'gitlab.com') {
        parts.push(`(${url.hostname})`);
      }
    } catch {
      // Invalid URL, ignore
    }
  } else if (account.config.type === 'azure-devops' && account.config.organization) {
    parts.push(`(${account.config.organization})`);
  }

  return parts.join(' ');
}

// =============================================================================
// Deprecated Helper Functions (v2 - for migration only)
// =============================================================================

/**
 * @deprecated Use filterAccountsByType with global accounts instead
 */
export function getAccountsByType(
  profile: UnifiedProfileV2,
  integrationType: IntegrationType
): ProfileIntegrationAccount[] {
  return profile.integrationAccounts.filter((a) => a.integrationType === integrationType);
}

/**
 * @deprecated Use getProfilePreferredAccount instead
 */
export function getDefaultAccountForType(
  profile: UnifiedProfileV2,
  integrationType: IntegrationType
): ProfileIntegrationAccount | undefined {
  const accounts = getAccountsByType(profile, integrationType);
  return accounts.find((a) => a.isDefaultForType) || accounts[0];
}

/**
 * @deprecated Use getGlobalAccountCountByType instead
 */
export function getAccountCountByType(
  profile: UnifiedProfileV2
): Record<IntegrationType, number> {
  const counts: Record<IntegrationType, number> = {
    github: 0,
    gitlab: 0,
    'azure-devops': 0,
    bitbucket: 0,
  };

  for (const account of profile.integrationAccounts) {
    counts[account.integrationType]++;
  }

  return counts;
}

/**
 * @deprecated Accounts are now global, use accounts.length instead
 */
export function getAccountCount(profile: UnifiedProfileV2): number {
  return profile.integrationAccounts.length;
}

