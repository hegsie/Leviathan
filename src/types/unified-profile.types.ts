/**
 * Unified profile types - combines git identity with integration accounts
 *
 * A unified profile is the top-level entity containing:
 * - Git identity (name, email, signing key)
 * - Multiple integration accounts (GitHub, GitLab, Azure DevOps)
 * - URL patterns for auto-detection
 * - Repository assignments
 *
 * This replaces the separate GitProfile and IntegrationAccount systems.
 */

// Re-export common types and constants from integration accounts
export type { IntegrationType, IntegrationConfig, CachedUser } from './integration-accounts.types';
export { ACCOUNT_COLORS } from './integration-accounts.types';
import type { IntegrationType, IntegrationConfig, CachedUser } from './integration-accounts.types';

/**
 * Current version of the unified profiles config format
 */
export const UNIFIED_PROFILES_CONFIG_VERSION = 2;

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
 * Integration account linked to a unified profile
 *
 * Unlike standalone IntegrationAccount, this doesn't have its own URL patterns -
 * it inherits the profile's patterns for auto-detection.
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
 * Unified profile containing git identity and integration accounts
 *
 * A profile represents a complete "context" (e.g., "Work", "Personal") that includes
 * both the git identity and all associated platform accounts.
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

  // Linked Integration Accounts
  /** Integration accounts associated with this profile */
  integrationAccounts: ProfileIntegrationAccount[];
}

/**
 * Configuration for storing unified profiles
 */
export interface UnifiedProfilesConfig {
  /** Version number for migration support */
  version: number;
  /** All saved profiles */
  profiles: UnifiedProfile[];
  /** Repository to profile assignments (repo path -> profile id) */
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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create an empty unified profile
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
    integrationAccounts: [],
  };
}

/**
 * Create an empty GitHub account for a profile
 */
export function createEmptyGitHubProfileAccount(): Omit<ProfileIntegrationAccount, 'id'> {
  return {
    name: '',
    integrationType: 'github',
    config: { type: 'github' },
    color: null,
    cachedUser: null,
    isDefaultForType: false,
  };
}

/**
 * Create an empty GitLab account for a profile
 */
export function createEmptyGitLabProfileAccount(
  instanceUrl: string = 'https://gitlab.com'
): Omit<ProfileIntegrationAccount, 'id'> {
  return {
    name: '',
    integrationType: 'gitlab',
    config: { type: 'gitlab', instanceUrl },
    color: null,
    cachedUser: null,
    isDefaultForType: false,
  };
}

/**
 * Create an empty Azure DevOps account for a profile
 */
export function createEmptyAzureDevOpsProfileAccount(
  organization: string = ''
): Omit<ProfileIntegrationAccount, 'id'> {
  return {
    name: '',
    integrationType: 'azure-devops',
    config: { type: 'azure-devops', organization },
    color: null,
    cachedUser: null,
    isDefaultForType: false,
  };
}

/**
 * Generate a UUID for profile/account IDs
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get accounts of a specific type from a profile
 */
export function getAccountsByType(
  profile: UnifiedProfile,
  integrationType: IntegrationType
): ProfileIntegrationAccount[] {
  return profile.integrationAccounts.filter((a) => a.integrationType === integrationType);
}

/**
 * Get the default account for a specific type from a profile
 */
export function getDefaultAccountForType(
  profile: UnifiedProfile,
  integrationType: IntegrationType
): ProfileIntegrationAccount | undefined {
  const accounts = getAccountsByType(profile, integrationType);
  return accounts.find((a) => a.isDefaultForType) || accounts[0];
}

/**
 * Get account count by type for a profile
 */
export function getAccountCountByType(profile: UnifiedProfile): Record<IntegrationType, number> {
  const counts: Record<IntegrationType, number> = {
    github: 0,
    gitlab: 0,
    'azure-devops': 0,
  };

  for (const account of profile.integrationAccounts) {
    counts[account.integrationType]++;
  }

  return counts;
}

/**
 * Get total account count for a profile
 */
export function getAccountCount(profile: UnifiedProfile): number {
  return profile.integrationAccounts.length;
}

/**
 * Get display label for an account (name + context info)
 */
export function getAccountDisplayLabel(account: ProfileIntegrationAccount): string {
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

/**
 * Integration type display names
 */
export const INTEGRATION_TYPE_NAMES: Record<IntegrationType, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  'azure-devops': 'Azure DevOps',
};
