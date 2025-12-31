/**
 * Unified Profile Service
 * Provides operations for managing unified profiles (git identity + integration accounts)
 */

import { invokeCommand } from './tauri-api.ts';
import { unifiedProfileStore } from '../stores/unified-profile.store.ts';
import type {
  UnifiedProfile,
  UnifiedProfilesConfig,
  ProfileIntegrationAccount,
  CurrentGitIdentity,
  MigrationPreview,
  UnifiedMigrationResult,
  IntegrationType,
  CachedUser,
} from '../types/unified-profile.types.ts';

// =============================================================================
// Profile CRUD Operations
// =============================================================================

/**
 * Get the unified profiles configuration
 */
export async function getUnifiedProfilesConfig(): Promise<UnifiedProfilesConfig> {
  const result = await invokeCommand<UnifiedProfilesConfig>('get_unified_profiles_config', {});
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to get unified profiles config');
  }
  return result.data!;
}

/**
 * Get all unified profiles
 */
export async function getUnifiedProfiles(): Promise<UnifiedProfile[]> {
  const result = await invokeCommand<UnifiedProfile[]>('get_unified_profiles', {});
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to get unified profiles');
  }
  return result.data!;
}

/**
 * Get a single unified profile by ID
 */
export async function getUnifiedProfile(profileId: string): Promise<UnifiedProfile | null> {
  const result = await invokeCommand<UnifiedProfile | null>('get_unified_profile', {
    profileId,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to get unified profile');
  }
  return result.data!;
}

/**
 * Save a unified profile (create or update)
 */
export async function saveUnifiedProfile(profile: UnifiedProfile): Promise<UnifiedProfile> {
  const result = await invokeCommand<UnifiedProfile>('save_unified_profile', { profile });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to save unified profile');
  }

  // Update store
  const existingProfile = unifiedProfileStore.getState().profiles.find((p) => p.id === profile.id);
  if (existingProfile) {
    unifiedProfileStore.getState().updateProfile(result.data!);
  } else {
    unifiedProfileStore.getState().addProfile(result.data!);
  }

  return result.data!;
}

/**
 * Delete a unified profile
 */
export async function deleteUnifiedProfile(profileId: string): Promise<void> {
  const result = await invokeCommand<void>('delete_unified_profile', { profileId });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete unified profile');
  }

  // Update store
  unifiedProfileStore.getState().removeProfile(profileId);
}

/**
 * Set a profile as the default
 */
export async function setDefaultUnifiedProfile(profileId: string): Promise<void> {
  const result = await invokeCommand<void>('set_default_unified_profile', { profileId });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to set default profile');
  }

  // Update store - mark the profile as default and unmark others
  const { profiles, updateProfile } = unifiedProfileStore.getState();
  for (const profile of profiles) {
    if (profile.isDefault !== (profile.id === profileId)) {
      updateProfile({ ...profile, isDefault: profile.id === profileId });
    }
  }
}

// =============================================================================
// Account Within Profile Operations
// =============================================================================

/**
 * Add an integration account to a profile
 */
export async function addAccountToProfile(
  profileId: string,
  account: ProfileIntegrationAccount
): Promise<ProfileIntegrationAccount> {
  const result = await invokeCommand<ProfileIntegrationAccount>('add_account_to_profile', {
    profileId,
    account,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to add account to profile');
  }

  // Update store
  unifiedProfileStore.getState().addAccountToProfile(profileId, result.data!);

  return result.data!;
}

/**
 * Update an integration account within a profile
 */
export async function updateAccountInProfile(
  profileId: string,
  account: ProfileIntegrationAccount
): Promise<ProfileIntegrationAccount> {
  const result = await invokeCommand<ProfileIntegrationAccount>('update_account_in_profile', {
    profileId,
    account,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update account in profile');
  }

  // Update store
  unifiedProfileStore.getState().updateAccountInProfile(profileId, result.data!);

  return result.data!;
}

/**
 * Remove an integration account from a profile
 */
export async function removeAccountFromProfile(
  profileId: string,
  accountId: string
): Promise<void> {
  const result = await invokeCommand<void>('remove_account_from_profile', {
    profileId,
    accountId,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to remove account from profile');
  }

  // Update store
  unifiedProfileStore.getState().removeAccountFromProfile(profileId, accountId);
}

/**
 * Set an account as the default for its type within a profile
 */
export async function setDefaultAccountInProfile(
  profileId: string,
  accountId: string
): Promise<void> {
  const result = await invokeCommand<void>('set_default_account_in_profile', {
    profileId,
    accountId,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to set default account');
  }

  // Refresh profile in store
  await loadUnifiedProfiles();
}

/**
 * Update cached user info for an account within a profile
 */
export async function updateProfileAccountCachedUser(
  profileId: string,
  accountId: string,
  user: CachedUser
): Promise<void> {
  const result = await invokeCommand<void>('update_profile_account_cached_user', {
    profileId,
    accountId,
    user,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update cached user');
  }

  // Refresh profile in store
  await loadUnifiedProfiles();
}

// =============================================================================
// Profile Detection and Assignment
// =============================================================================

/**
 * Detect which profile should be used for a repository based on URL patterns
 */
export async function detectUnifiedProfileForRepository(
  path: string
): Promise<UnifiedProfile | null> {
  const result = await invokeCommand<UnifiedProfile | null>(
    'detect_unified_profile_for_repository',
    { path }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to detect profile');
  }
  return result.data!;
}

/**
 * Get the assigned profile for a repository
 */
export async function getAssignedUnifiedProfile(path: string): Promise<UnifiedProfile | null> {
  const result = await invokeCommand<UnifiedProfile | null>('get_assigned_unified_profile', {
    path,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to get assigned profile');
  }
  return result.data!;
}

/**
 * Manually assign a profile to a repository
 */
export async function assignUnifiedProfileToRepository(
  path: string,
  profileId: string
): Promise<void> {
  const result = await invokeCommand<void>('assign_unified_profile_to_repository', {
    path,
    profileId,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to assign profile');
  }
}

/**
 * Remove profile assignment from a repository
 */
export async function unassignUnifiedProfileFromRepository(path: string): Promise<void> {
  const result = await invokeCommand<void>('unassign_unified_profile_from_repository', { path });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to unassign profile');
  }
}

/**
 * Apply a profile to a repository (set git config)
 */
export async function applyUnifiedProfile(path: string, profileId: string): Promise<void> {
  const result = await invokeCommand<void>('apply_unified_profile', { path, profileId });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to apply profile');
  }

  // Update active profile in store
  const profile = unifiedProfileStore.getState().profiles.find((p) => p.id === profileId);
  if (profile) {
    unifiedProfileStore.getState().setActiveProfile(profile);
  }
}

/**
 * Get the current git identity for a repository
 */
export async function getCurrentGitIdentity(path: string): Promise<CurrentGitIdentity> {
  const result = await invokeCommand<CurrentGitIdentity>('get_current_git_identity', { path });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to get current identity');
  }
  return result.data!;
}

// =============================================================================
// Repository Account Helpers
// =============================================================================

/**
 * Get an account for a repository by integration type (from the assigned/detected profile)
 */
export async function getRepositoryAccount(
  path: string,
  integrationType: IntegrationType
): Promise<ProfileIntegrationAccount | null> {
  const result = await invokeCommand<ProfileIntegrationAccount | null>('get_repository_account', {
    path,
    integrationType,
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to get repository account');
  }
  return result.data!;
}

/**
 * Get an account from any profile by account ID
 */
export async function getAccountFromAnyProfile(
  accountId: string
): Promise<{ profileId: string; account: ProfileIntegrationAccount } | null> {
  const result = await invokeCommand<[string, ProfileIntegrationAccount] | null>(
    'get_account_from_any_profile',
    { accountId }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to get account');
  }
  if (!result.data) return null;
  return { profileId: result.data[0], account: result.data[1] };
}

// =============================================================================
// Migration Operations
// =============================================================================

/**
 * Check if migration to unified profiles is needed
 */
export async function needsUnifiedProfilesMigration(): Promise<boolean> {
  const result = await invokeCommand<boolean>('needs_unified_profiles_migration', {});
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to check migration status');
  }
  return result.data!;
}

/**
 * Preview migration - shows how accounts would be matched to profiles
 */
export async function previewUnifiedProfilesMigration(): Promise<MigrationPreview> {
  const result = await invokeCommand<MigrationPreview>('preview_unified_profiles_migration', {});
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to preview migration');
  }
  return result.data!;
}

/**
 * Execute migration with custom account-to-profile assignments
 */
export async function executeUnifiedProfilesMigration(
  accountAssignments: Record<string, string> // account_id -> profile_id
): Promise<UnifiedMigrationResult> {
  const result = await invokeCommand<UnifiedMigrationResult>(
    'execute_unified_profiles_migration',
    { accountAssignments }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to execute migration');
  }

  // Reload profiles after migration
  await loadUnifiedProfiles();

  return result.data!;
}

// =============================================================================
// Store Loading Functions
// =============================================================================

/**
 * Load unified profiles and update the store
 */
export async function loadUnifiedProfiles(): Promise<void> {
  const store = unifiedProfileStore.getState();
  store.setLoading(true);

  try {
    const config = await getUnifiedProfilesConfig();
    store.setConfig(config);
    store.setLoading(false);
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load profiles');
  }
}

/**
 * Load the profile for a specific repository and set it as active
 */
export async function loadUnifiedProfileForRepository(path: string): Promise<void> {
  const store = unifiedProfileStore.getState();
  store.setCurrentRepositoryPath(path);

  try {
    const profile = await getAssignedUnifiedProfile(path);
    store.setActiveProfile(profile);
  } catch (error) {
    console.error('Failed to load profile for repository:', error);
    store.setActiveProfile(null);
  }
}

/**
 * Check if migration is needed and update store
 */
export async function checkMigrationNeeded(): Promise<boolean> {
  try {
    const needs = await needsUnifiedProfilesMigration();
    unifiedProfileStore.getState().setNeedsMigration(needs);
    return needs;
  } catch (error) {
    console.error('Failed to check migration status:', error);
    return false;
  }
}

/**
 * Initialize unified profiles - load config and check migration
 */
export async function initializeUnifiedProfiles(): Promise<void> {
  const store = unifiedProfileStore.getState();
  store.setLoading(true);

  try {
    // Check if migration is needed first
    const needsMigration = await checkMigrationNeeded();

    if (!needsMigration) {
      // Load existing unified profiles
      await loadUnifiedProfiles();
    }

    store.setLoading(false);
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to initialize profiles');
  }
}
