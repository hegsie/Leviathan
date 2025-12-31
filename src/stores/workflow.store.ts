/**
 * Workflow Store
 * Manages git identity profiles and workflow state
 */

import { createStore } from 'zustand/vanilla';
import type { GitProfile } from '../types/workflow.types.ts';

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

  setProfiles: (profiles) => set({ profiles, profileError: null }),

  setActiveProfile: (activeProfile) => set({ activeProfile }),

  setCurrentRepositoryPath: (currentRepositoryPath) => set({ currentRepositoryPath }),

  setLoadingProfiles: (isLoadingProfiles) => set({ isLoadingProfiles }),

  setProfileError: (profileError) => set({ profileError, isLoadingProfiles: false }),

  addProfile: (profile) =>
    set((state) => ({
      profiles: [...state.profiles, profile],
      profileError: null,
    })),

  updateProfile: (profile) =>
    set((state) => ({
      profiles: state.profiles.map((p) => (p.id === profile.id ? profile : p)),
      activeProfile: state.activeProfile?.id === profile.id ? profile : state.activeProfile,
      profileError: null,
    })),

  removeProfile: (profileId) =>
    set((state) => ({
      profiles: state.profiles.filter((p) => p.id !== profileId),
      activeProfile: state.activeProfile?.id === profileId ? null : state.activeProfile,
      profileError: null,
    })),

  reset: () => set(initialState),
}));

/**
 * Get a profile by ID
 */
export function getProfileById(id: string): GitProfile | undefined {
  return workflowStore.getState().profiles.find((p) => p.id === id);
}

/**
 * Get the default profile
 */
export function getDefaultProfile(): GitProfile | undefined {
  return workflowStore.getState().profiles.find((p) => p.isDefault);
}

/**
 * Check if any profiles exist
 */
export function hasProfiles(): boolean {
  return workflowStore.getState().profiles.length > 0;
}
