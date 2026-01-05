/**
 * Unified Profile Store (v3)
 * Manages unified profiles (git identity) and global integration accounts
 *
 * Architecture (v3):
 * - Profiles contain git identity + default account preferences
 * - Accounts are GLOBAL - available to all profiles, not owned by profiles
 * - Repository assignments map repos to profiles (for git identity)
 */

import { createStore } from 'zustand/vanilla';
import type {
  UnifiedProfile,
  UnifiedProfilesConfig,
  IntegrationAccount,
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

  // Global Accounts (v3)
  accounts: IntegrationAccount[];

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

  // Actions - Global Accounts (v3)
  setAccounts: (accounts: IntegrationAccount[]) => void;
  addAccount: (account: IntegrationAccount) => void;
  updateAccount: (account: IntegrationAccount) => void;
  removeAccount: (accountId: string) => void;

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
  accounts: [] as IntegrationAccount[],
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
      accounts: config.accounts ?? [],
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
        : { version: 3, profiles, accounts: state.accounts, repositoryAssignments: {} };
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

  // Global Accounts (v3)
  setAccounts: (accounts) =>
    set((state) => ({
      accounts,
      config: state.config ? { ...state.config, accounts } : null,
      error: null,
    })),

  addAccount: (account) =>
    set((state) => {
      let accounts = state.accounts;

      // If this account is default for its type, unset others
      if (account.isDefault) {
        accounts = accounts.map((a) =>
          a.integrationType === account.integrationType ? { ...a, isDefault: false } : a
        );
      }

      accounts = [...accounts, account];
      const config = state.config ? { ...state.config, accounts } : null;
      return { accounts, config, error: null };
    }),

  updateAccount: (account) =>
    set((state) => {
      let accounts = state.accounts.map((a) => (a.id === account.id ? account : a));

      // If this account is default for its type, unset others
      if (account.isDefault) {
        accounts = accounts.map((a) =>
          a.id !== account.id && a.integrationType === account.integrationType
            ? { ...a, isDefault: false }
            : a
        );
      }

      const config = state.config ? { ...state.config, accounts } : null;
      return { accounts, config, error: null };
    }),

  removeAccount: (accountId) =>
    set((state) => {
      const accounts = state.accounts.filter((a) => a.id !== accountId);

      // Also remove from any profile's defaultAccounts
      const profiles = state.profiles.map((p) => {
        const defaultAccounts = { ...p.defaultAccounts };
        for (const [type, id] of Object.entries(defaultAccounts)) {
          if (id === accountId) {
            delete defaultAccounts[type as IntegrationType];
          }
        }
        return { ...p, defaultAccounts };
      });

      const config = state.config ? { ...state.config, accounts, profiles } : null;
      return { accounts, profiles, config, error: null };
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
 * Get a global account by ID
 */
export function getAccountById(accountId: string): IntegrationAccount | undefined {
  return unifiedProfileStore.getState().accounts.find((a) => a.id === accountId);
}

/**
 * Get all accounts of a specific type (global)
 */
export function getAccountsByType(integrationType: IntegrationType): IntegrationAccount[] {
  return unifiedProfileStore.getState().accounts.filter((a) => a.integrationType === integrationType);
}

/**
 * Get the default global account for a type
 */
export function getDefaultGlobalAccount(integrationType: IntegrationType): IntegrationAccount | undefined {
  const accounts = getAccountsByType(integrationType);
  return accounts.find((a) => a.isDefault) || accounts[0];
}

/**
 * Get the profile's preferred account for a specific type
 * Falls back to global default if profile has no preference
 */
export function getProfilePreferredAccount(
  profileId: string,
  integrationType: IntegrationType
): IntegrationAccount | undefined {
  const { profiles, accounts } = unifiedProfileStore.getState();
  const profile = profiles.find((p) => p.id === profileId);

  if (profile) {
    const preferredId = profile.defaultAccounts[integrationType];
    if (preferredId) {
      const preferred = accounts.find((a) => a.id === preferredId);
      if (preferred) return preferred;
    }
  }

  // Fall back to global default
  return getDefaultGlobalAccount(integrationType);
}

/**
 * Get accounts for the active profile's preferred account for a type
 * Falls back to global default
 */
export function getActiveProfilePreferredAccount(
  integrationType: IntegrationType
): IntegrationAccount | undefined {
  const { activeProfile } = unifiedProfileStore.getState();
  if (!activeProfile) return getDefaultGlobalAccount(integrationType);
  return getProfilePreferredAccount(activeProfile.id, integrationType);
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

/**
 * Get account count by type (global)
 */
export function getAccountCountByType(): Record<IntegrationType, number> {
  const { accounts } = unifiedProfileStore.getState();
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
