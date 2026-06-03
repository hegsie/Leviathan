/**
 * Integration account types for managing multiple identities across services
 *
 * Supports GitHub, GitLab, and Azure DevOps with URL-based auto-selection
 * and per-repository account assignments.
 */

/**
 * Integration service type
 */
export type IntegrationType = 'github' | 'gitlab' | 'azure-devops' | 'bitbucket' | 'oidc';

/**
 * Explicit navigation context attached to an `open-<provider>` event so a
 * provider/OIDC connect dialog knows HOW it was opened — and therefore whether
 * to show a Back arrow and where Back returns to.
 *
 * When present, the dialog was opened from the Profiles & Accounts manager's
 * "Connect a new account" flow: it should show a Back arrow, a breadcrumb, and
 * — if `attach` is set — attach the just-connected account to `profileId` on
 * return. When the context is `null` (command palette, dashboard, toolbar),
 * the dialog is standalone: no Back arrow, no surprise attach.
 */
export interface IntegrationOpenContext {
  /** The origin the Back arrow returns to. Currently only the profile manager. */
  returnTo: 'profile-manager';
  /** Provider being connected (drives attach-after-connect for that type). */
  integrationType: IntegrationType;
  /**
   * Id of the profile being edited when the connect flow started. Empty string
   * for an unsaved (create-mode) profile. Used to target attach-after-connect.
   */
  profileId: string;
  /** Display name of the target profile, for the "Adding to <name>" breadcrumb. */
  profileName: string;
  /**
   * When true, attach the just-connected account to the target profile on
   * return. False for a plain "manage accounts" connect with no attach intent.
   */
  attach: boolean;
}

/**
 * Integration-specific configuration
 */
export type IntegrationConfig =
  | { type: 'github' }
  | { type: 'gitlab'; instanceUrl: string }
  | { type: 'azure-devops'; organization: string }
  | { type: 'bitbucket'; workspace: string }
  | { type: 'oidc'; issuerUrl: string; clientId: string };

/**
 * Cached user information for quick display without API calls
 */
export interface CachedUser {
  /** Username or login */
  username: string;
  /** Display name (may be different from username) */
  displayName: string | null;
  /** Avatar URL for display */
  avatarUrl: string | null;
  /** Email address */
  email: string | null;
}

/**
 * Integration account for connecting to external services
 */
export interface IntegrationAccount {
  /** Unique identifier (UUID) */
  id: string;
  /** Display name (e.g., "Work GitHub", "Personal GitLab") */
  name: string;
  /** Integration type */
  integrationType: IntegrationType;
  /** URL patterns for auto-detection (e.g., "github.com/mycompany/*") */
  urlPatterns: string[];
  /** Whether this is the default account for this integration type */
  isDefault: boolean;
  /** Optional color for UI display */
  color: string | null;
  /** Integration-specific configuration */
  config: IntegrationConfig;
  /** Cached user info (updated on connection check) */
  cachedUser: CachedUser | null;
}

/**
 * Configuration for storing integration accounts
 */
export interface IntegrationAccountsConfig {
  /** All saved accounts */
  accounts: IntegrationAccount[];
  /** Repository to account assignments (repo path -> account id) */
  repositoryAssignments: Record<string, string>;
}

/**
 * Result of migrating legacy tokens
 */
export interface MigrationResult {
  /** Number of accounts migrated */
  migratedCount: number;
  /** Account IDs that were created */
  createdAccounts: string[];
  /** Any errors that occurred */
  errors: string[];
}

/**
 * Account colors for UI display
 */
export const ACCOUNT_COLORS = [
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
 * Integration type display names
 */
export const INTEGRATION_TYPE_NAMES: Record<IntegrationType, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  'azure-devops': 'Azure DevOps',
  bitbucket: 'Bitbucket',
  oidc: 'Enterprise SSO (OIDC)',
};

/**
 * Create an empty GitHub account
 */
export function createEmptyGitHubAccount(): Omit<IntegrationAccount, 'id'> {
  return {
    name: '',
    integrationType: 'github',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'github' },
    cachedUser: null,
  };
}

/**
 * Create an empty GitLab account
 */
export function createEmptyGitLabAccount(
  instanceUrl: string = 'https://gitlab.com'
): Omit<IntegrationAccount, 'id'> {
  return {
    name: '',
    integrationType: 'gitlab',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'gitlab', instanceUrl },
    cachedUser: null,
  };
}

/**
 * Create an empty Azure DevOps account
 */
export function createEmptyAzureDevOpsAccount(
  organization: string = ''
): Omit<IntegrationAccount, 'id'> {
  return {
    name: '',
    integrationType: 'azure-devops',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'azure-devops', organization },
    cachedUser: null,
  };
}

/**
 * Create an empty Bitbucket account
 */
export function createEmptyBitbucketAccount(
  workspace: string = ''
): Omit<IntegrationAccount, 'id'> {
  return {
    name: '',
    integrationType: 'bitbucket',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'bitbucket', workspace },
    cachedUser: null,
  };
}

/**
 * Create an empty OIDC (Enterprise SSO) account
 */
export function createEmptyOidcAccount(
  issuerUrl: string = '',
  clientId: string = ''
): Omit<IntegrationAccount, 'id'> {
  return {
    name: '',
    integrationType: 'oidc',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'oidc', issuerUrl, clientId },
    cachedUser: null,
  };
}

/**
 * Get the instance URL from an account's config (for GitLab)
 */
export function getInstanceUrl(account: IntegrationAccount): string | null {
  if (account.config.type === 'gitlab') {
    return account.config.instanceUrl;
  }
  return null;
}

/**
 * Get the organization from an account's config (for Azure DevOps)
 */
export function getOrganization(account: IntegrationAccount): string | null {
  if (account.config.type === 'azure-devops') {
    return account.config.organization;
  }
  return null;
}

/**
 * Get display label for an account (name + context info)
 */
export function getAccountDisplayLabel(account: Pick<IntegrationAccount, 'name' | 'config'>): string {
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
 * Generate a UUID v4 for account IDs
 */
export function generateAccountId(): string {
  return crypto.randomUUID();
}

/**
 * Create a new GitHub account with a generated ID
 */
export function createGitHubAccount(name: string = ''): IntegrationAccount {
  return {
    id: generateAccountId(),
    name,
    integrationType: 'github',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'github' },
    cachedUser: null,
  };
}

/**
 * Create a new GitLab account with a generated ID
 */
export function createGitLabAccount(
  name: string = '',
  instanceUrl: string = 'https://gitlab.com'
): IntegrationAccount {
  return {
    id: generateAccountId(),
    name,
    integrationType: 'gitlab',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'gitlab', instanceUrl },
    cachedUser: null,
  };
}

/**
 * Create a new Azure DevOps account with a generated ID
 */
export function createAzureDevOpsAccount(
  name: string = '',
  organization: string = ''
): IntegrationAccount {
  return {
    id: generateAccountId(),
    name,
    integrationType: 'azure-devops',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'azure-devops', organization },
    cachedUser: null,
  };
}

/**
 * Create a new Bitbucket account with a generated ID
 */
export function createBitbucketAccount(
  name: string = '',
  workspace: string = ''
): IntegrationAccount {
  return {
    id: generateAccountId(),
    name,
    integrationType: 'bitbucket',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'bitbucket', workspace },
    cachedUser: null,
  };
}

/**
 * Create a new OIDC (Enterprise SSO) account with a generated ID
 */
export function createOidcAccount(
  name: string = '',
  issuerUrl: string = '',
  clientId: string = ''
): IntegrationAccount {
  return {
    id: generateAccountId(),
    name,
    integrationType: 'oidc',
    urlPatterns: [],
    isDefault: false,
    color: null,
    config: { type: 'oidc', issuerUrl, clientId },
    cachedUser: null,
  };
}

/**
 * Type guard for GitLab config
 */
export function isGitLabConfig(
  config: IntegrationConfig
): config is { type: 'gitlab'; instanceUrl: string } {
  return config.type === 'gitlab';
}

/**
 * Type guard for Azure DevOps config
 */
export function isAzureDevOpsConfig(
  config: IntegrationConfig
): config is { type: 'azure-devops'; organization: string } {
  return config.type === 'azure-devops';
}

/**
 * Type guard for Bitbucket config
 */
export function isBitbucketConfig(
  config: IntegrationConfig
): config is { type: 'bitbucket'; workspace: string } {
  return config.type === 'bitbucket';
}

/**
 * Safely get instance URL from account config
 */
export function safeGetInstanceUrl(account: IntegrationAccount): string | null {
  return isGitLabConfig(account.config) ? account.config.instanceUrl : null;
}

/**
 * Safely set instance URL in account config (mutates the account)
 */
export function safeSetInstanceUrl(account: IntegrationAccount, instanceUrl: string): void {
  if (isGitLabConfig(account.config)) {
    account.config.instanceUrl = instanceUrl;
  }
}

/**
 * Safely get organization from account config
 */
export function safeGetOrganization(account: IntegrationAccount): string | null {
  return isAzureDevOpsConfig(account.config) ? account.config.organization : null;
}

/**
 * Safely set organization in account config (mutates the account)
 */
export function safeSetOrganization(account: IntegrationAccount, organization: string): void {
  if (isAzureDevOpsConfig(account.config)) {
    account.config.organization = organization;
  }
}

/**
 * Safely get workspace from account config
 */
export function safeGetWorkspace(account: IntegrationAccount): string | null {
  return isBitbucketConfig(account.config) ? account.config.workspace : null;
}

/**
 * Safely set workspace in account config (mutates the account)
 */
export function safeSetWorkspace(account: IntegrationAccount, workspace: string): void {
  if (isBitbucketConfig(account.config)) {
    account.config.workspace = workspace;
  }
}
