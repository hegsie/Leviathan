/**
 * Unified Profile Store
 * Manages unified profiles that combine git identity with integration accounts
 */

import { createStore } from 'zustand/vanilla';
import type {
  UnifiedProfile,
  UnifiedProfilesConfig,
  ProfileIntegrationAccount,
  IntegrationType,
} from '../types/unified-profile.types.ts';

export type ConnectionStatus = 'unknown' | 'checking' | 'connected' | 'disconnected';

export interface AccountConnectionStatus {
  status: ConnectionStatus;
  lastChecked: number | null; // timestamp
}

export interface UnifiedProfileState {
  // Config
  config: UnifiedProfilesConfig | null;

  // Profiles
  profiles: UnifiedProfile[];
  activeProfile: UnifiedProfile | null;
  currentRepositoryPath: string | null;

  // Connection status for accounts (accountId -> status)
  accountConnectionStatus: Record<string, AccountConnectionStatus>;

  // Loading state
  isLoading: boolean;
  error: string | null;

  // Migration state
  needsMigration: boolean;
  isMigrating: boolean;

  // Actions - Config
  setConfig: (config: UnifiedProfilesConfig) => void;

  // Actions - Profiles
  setProfiles: (profiles: UnifiedProfile[]) => void;
  setActiveProfile: (profile: UnifiedProfile | null) => void;
  setCurrentRepositoryPath: (path: string | null) => void;
  addProfile: (profile: UnifiedProfile) => void;
  updateProfile: (profile: UnifiedProfile) => void;
  removeProfile: (profileId: string) => void;

  // Actions - Accounts within profiles
  addAccountToProfile: (profileId: string, account: ProfileIntegrationAccount) => void;
  updateAccountInProfile: (profileId: string, account: ProfileIntegrationAccount) => void;
  removeAccountFromProfile: (profileId: string, accountId: string) => void;

  // Actions - Loading state
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Actions - Migration
  setNeedsMigration: (needs: boolean) => void;
  setMigrating: (migrating: boolean) => void;

  // Actions - Connection status
  setAccountConnectionStatus: (accountId: string, status: ConnectionStatus) => void;

  // Actions - Reset
  reset: () => void;
}

const initialState = {
  config: null as UnifiedProfilesConfig | null,
  profiles: [] as UnifiedProfile[],
  activeProfile: null as UnifiedProfile | null,
  currentRepositoryPath: null as string | null,
  accountConnectionStatus: {} as Record<string, AccountConnectionStatus>,
  isLoading: false,
  error: null as string | null,
  needsMigration: false,
  isMigrating: false,
};

export const unifiedProfileStore = createStore<UnifiedProfileState>()((set) => ({
  ...initialState,

  // Config
  setConfig: (config) =>
    set({
      config,
      profiles: config.profiles,
      error: null,
    }),

  // Profiles
  setProfiles: (profiles) => set({ profiles, error: null }),

  setActiveProfile: (activeProfile) => set({ activeProfile }),

  setCurrentRepositoryPath: (currentRepositoryPath) => set({ currentRepositoryPath }),

  addProfile: (profile) =>
    set((state) => {
      const profiles = [...state.profiles, profile];
      const config = state.config
        ? { ...state.config, profiles }
        : { version: 2, profiles, repositoryAssignments: {} };
      return { profiles, config, error: null };
    }),

  updateProfile: (profile) =>
    set((state) => {
      const profiles = state.profiles.map((p) => (p.id === profile.id ? profile : p));
      const config = state.config ? { ...state.config, profiles } : null;
      const activeProfile = state.activeProfile?.id === profile.id ? profile : state.activeProfile;
      return { profiles, config, activeProfile, error: null };
    }),

  removeProfile: (profileId) =>
    set((state) => {
      const profiles = state.profiles.filter((p) => p.id !== profileId);
      const config = state.config
        ? {
            ...state.config,
            profiles,
            repositoryAssignments: Object.fromEntries(
              Object.entries(state.config.repositoryAssignments).filter(
                ([, id]) => id !== profileId
              )
            ),
          }
        : null;
      const activeProfile = state.activeProfile?.id === profileId ? null : state.activeProfile;
      return { profiles, config, activeProfile, error: null };
    }),

  // Accounts within profiles
  addAccountToProfile: (profileId, account) =>
    set((state) => {
      const profiles = state.profiles.map((p) => {
        if (p.id !== profileId) return p;

        // If this account is default for type, unset others
        let accounts = p.integrationAccounts;
        if (account.isDefaultForType) {
          accounts = accounts.map((a) =>
            a.integrationType === account.integrationType ? { ...a, isDefaultForType: false } : a
          );
        }

        return {
          ...p,
          integrationAccounts: [...accounts, account],
        };
      });

      const config = state.config ? { ...state.config, profiles } : null;
      const activeProfile =
        state.activeProfile?.id === profileId
          ? profiles.find((p) => p.id === profileId) || state.activeProfile
          : state.activeProfile;

      return { profiles, config, activeProfile, error: null };
    }),

  updateAccountInProfile: (profileId, account) =>
    set((state) => {
      const profiles = state.profiles.map((p) => {
        if (p.id !== profileId) return p;

        let accounts = p.integrationAccounts.map((a) => (a.id === account.id ? account : a));

        // If this account is default for type, unset others
        if (account.isDefaultForType) {
          accounts = accounts.map((a) =>
            a.id !== account.id && a.integrationType === account.integrationType
              ? { ...a, isDefaultForType: false }
              : a
          );
        }

        return { ...p, integrationAccounts: accounts };
      });

      const config = state.config ? { ...state.config, profiles } : null;
      const activeProfile =
        state.activeProfile?.id === profileId
          ? profiles.find((p) => p.id === profileId) || state.activeProfile
          : state.activeProfile;

      return { profiles, config, activeProfile, error: null };
    }),

  removeAccountFromProfile: (profileId, accountId) =>
    set((state) => {
      const profiles = state.profiles.map((p) => {
        if (p.id !== profileId) return p;
        return {
          ...p,
          integrationAccounts: p.integrationAccounts.filter((a) => a.id !== accountId),
        };
      });

      const config = state.config ? { ...state.config, profiles } : null;
      const activeProfile =
        state.activeProfile?.id === profileId
          ? profiles.find((p) => p.id === profileId) || state.activeProfile
          : state.activeProfile;

      return { profiles, config, activeProfile, error: null };
    }),

  // Loading state
  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  // Migration
  setNeedsMigration: (needsMigration) => set({ needsMigration }),

  setMigrating: (isMigrating) => set({ isMigrating }),

  // Connection status
  setAccountConnectionStatus: (accountId, status) =>
    set((state) => ({
      accountConnectionStatus: {
        ...state.accountConnectionStatus,
        [accountId]: {
          status,
          lastChecked: status === 'checking' ? state.accountConnectionStatus[accountId]?.lastChecked ?? null : Date.now(),
        },
      },
    })),

  // Reset
  reset: () => set(initialState),
}));

// =============================================================================
// Selector Functions
// =============================================================================

/**
 * Get a profile by ID
 */
export function getUnifiedProfileById(id: string): UnifiedProfile | undefined {
  return unifiedProfileStore.getState().profiles.find((p) => p.id === id);
}

/**
 * Get the default profile
 */
export function getDefaultUnifiedProfile(): UnifiedProfile | undefined {
  return unifiedProfileStore.getState().profiles.find((p) => p.isDefault);
}

/**
 * Check if any profiles exist
 */
export function hasUnifiedProfiles(): boolean {
  return unifiedProfileStore.getState().profiles.length > 0;
}

/**
 * Get an account from any profile by account ID
 */
export function getAccountFromAnyProfile(
  accountId: string
): { profile: UnifiedProfile; account: ProfileIntegrationAccount } | undefined {
  const { profiles } = unifiedProfileStore.getState();
  for (const profile of profiles) {
    const account = profile.integrationAccounts.find((a) => a.id === accountId);
    if (account) {
      return { profile, account };
    }
  }
  return undefined;
}

/**
 * Get accounts of a specific type from the active profile
 */
export function getActiveProfileAccountsByType(
  integrationType: IntegrationType
): ProfileIntegrationAccount[] {
  const { activeProfile } = unifiedProfileStore.getState();
  if (!activeProfile) return [];
  return activeProfile.integrationAccounts.filter((a) => a.integrationType === integrationType);
}

/**
 * Get the default account for a type from the active profile
 */
export function getActiveProfileDefaultAccount(
  integrationType: IntegrationType
): ProfileIntegrationAccount | undefined {
  const accounts = getActiveProfileAccountsByType(integrationType);
  return accounts.find((a) => a.isDefaultForType) || accounts[0];
}

/**
 * Get repository assignment
 */
export function getRepositoryProfileAssignment(repoPath: string): string | undefined {
  const { config } = unifiedProfileStore.getState();
  return config?.repositoryAssignments[repoPath];
}

/**
 * Get the profile assigned to a repository
 */
export function getRepositoryProfile(repoPath: string): UnifiedProfile | undefined {
  const profileId = getRepositoryProfileAssignment(repoPath);
  if (!profileId) return undefined;
  return getUnifiedProfileById(profileId);
}
