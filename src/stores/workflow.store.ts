/**
 * Workflow Store
 * Thin backward-compatible wrapper that delegates to unifiedProfileStore.
 *
 * All profile management now lives in unified-profile.store.ts.
 * This module preserves the legacy API so existing imports continue to work.
 */

import { createStore } from 'zustand/vanilla';
import type { GitProfile } from '../types/workflow.types.ts';
import { unifiedProfileStore } from './unified-profile.store.ts';
import type { UnifiedProfile } from '../types/unified-profile.types.ts';

// ---------------------------------------------------------------------------
// Adapter helpers – convert between GitProfile ↔ UnifiedProfile
// ---------------------------------------------------------------------------

function toGitProfile(p: UnifiedProfile): GitProfile {
  return {
    id: p.id,
    name: p.name,
    gitName: p.gitName,
    gitEmail: p.gitEmail,
    signingKey: p.signingKey,
    urlPatterns: p.urlPatterns,
    isDefault: p.isDefault,
    color: p.color,
  };
}

function toUnifiedProfile(p: GitProfile): UnifiedProfile {
  // Preserve existing unified-only fields (e.g. defaultAccounts) when updating
  const existing = unifiedProfileStore.getState().profiles.find((up) => up.id === p.id);
  return {
    id: p.id,
    name: p.name,
    gitName: p.gitName,
    gitEmail: p.gitEmail,
    signingKey: p.signingKey,
    urlPatterns: p.urlPatterns,
    isDefault: p.isDefault,
    color: p.color ?? '#3b82f6',
    defaultAccounts: existing?.defaultAccounts ?? {},
  };
}

// ---------------------------------------------------------------------------
// Public interface (unchanged)
// ---------------------------------------------------------------------------

export interface WorkflowState {
  // Profiles
  profiles: GitProfile[];
  activeProfile: GitProfile | null;
  currentRepositoryPath: string | null;
  isLoadingProfiles: boolean;
  profileError: string | null;

  // Actions
  setProfiles: (profiles: GitProfile[]) => void;
  setActiveProfile: (profile: GitProfile | null) => void;
  setCurrentRepositoryPath: (path: string | null) => void;
  setLoadingProfiles: (loading: boolean) => void;
  setProfileError: (error: string | null) => void;
  addProfile: (profile: GitProfile) => void;
  updateProfile: (profile: GitProfile) => void;
  removeProfile: (profileId: string) => void;
  reset: () => void;
}

const initialState = {
  profiles: [] as GitProfile[],
  activeProfile: null as GitProfile | null,
  currentRepositoryPath: null as string | null,
  isLoadingProfiles: false,
  profileError: null as string | null,
};

export const workflowStore = createStore<WorkflowState>()((set) => ({
  ...initialState,

  setProfiles: (profiles) => {
    // Only sync to unified store if it hasn't been independently initialized
    // to avoid overwriting richer unified profile data during startup race
    const unifiedState = unifiedProfileStore.getState();
    if (unifiedState.profiles.length === 0) {
      unifiedState.setProfiles(profiles.map(toUnifiedProfile));
    }
    set({ profiles, profileError: null });
  },

  setActiveProfile: (activeProfile) => {
    unifiedProfileStore.getState().setActiveProfile(
      activeProfile ? toUnifiedProfile(activeProfile) : null,
    );
    set({ activeProfile });
  },

  setCurrentRepositoryPath: (currentRepositoryPath) => {
    unifiedProfileStore.getState().setCurrentRepositoryPath(currentRepositoryPath);
    set({ currentRepositoryPath });
  },

  setLoadingProfiles: (isLoadingProfiles) => {
    unifiedProfileStore.getState().setLoading(isLoadingProfiles);
    set({ isLoadingProfiles });
  },

  setProfileError: (profileError) => {
    unifiedProfileStore.getState().setError(profileError);
    set({ profileError, isLoadingProfiles: false });
  },

  addProfile: (profile) => {
    unifiedProfileStore.getState().addProfile(toUnifiedProfile(profile));
    set((state) => ({
      profiles: [...state.profiles, profile],
      profileError: null,
    }));
  },

  updateProfile: (profile) => {
    unifiedProfileStore.getState().updateProfile(toUnifiedProfile(profile));
    set((state) => ({
      profiles: state.profiles.map((p) => (p.id === profile.id ? profile : p)),
      activeProfile: state.activeProfile?.id === profile.id ? profile : state.activeProfile,
      profileError: null,
    }));
  },

  removeProfile: (profileId) => {
    unifiedProfileStore.getState().removeProfile(profileId);
    set((state) => ({
      profiles: state.profiles.filter((p) => p.id !== profileId),
      activeProfile: state.activeProfile?.id === profileId ? null : state.activeProfile,
      profileError: null,
    }));
  },

  reset: () => {
    unifiedProfileStore.getState().setProfiles([]);
    unifiedProfileStore.getState().setActiveProfile(null);
    unifiedProfileStore.getState().setCurrentRepositoryPath(null);
    set(initialState);
  },
}));

/**
 * Get a profile by ID
 */
export function getProfileById(id: string): GitProfile | undefined {
  const up = unifiedProfileStore.getState().profiles.find((p) => p.id === id);
  return up ? toGitProfile(up) : undefined;
}

/**
 * Get the default profile
 */
export function getDefaultProfile(): GitProfile | undefined {
  const up = unifiedProfileStore.getState().profiles.find((p) => p.isDefault);
  return up ? toGitProfile(up) : undefined;
}

/**
 * Check if any profiles exist
 */
export function hasProfiles(): boolean {
  return unifiedProfileStore.getState().profiles.length > 0;
}
