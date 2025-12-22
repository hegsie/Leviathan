import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Repository, Branch, Remote, Tag, Stash, StatusEntry } from '../types/git.types.ts';

export interface RecentRepository {
  path: string;
  name: string;
  lastOpened: number;
}

export interface OpenRepository {
  repository: Repository;
  branches: Branch[];
  currentBranch: Branch | null;
  remotes: Remote[];
  tags: Tag[];
  stashes: Stash[];
  status: StatusEntry[];
  stagedFiles: StatusEntry[];
  unstagedFiles: StatusEntry[];
}

export interface RepositoryState {
  // Open repositories (tabs)
  openRepositories: OpenRepository[];
  activeIndex: number;

  // Loading state
  isLoading: boolean;
  error: string | null;

  // Recent repositories (persisted)
  recentRepositories: RecentRepository[];

  // Actions - Repository management
  addRepository: (repo: Repository) => void;
  removeRepository: (path: string) => void;
  setActiveIndex: (index: number) => void;
  setActiveByPath: (path: string) => void;

  // Actions - Update active repo data
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setBranches: (branches: Branch[]) => void;
  setCurrentBranch: (branch: Branch | null) => void;
  setRemotes: (remotes: Remote[]) => void;
  setTags: (tags: Tag[]) => void;
  setStashes: (stashes: Stash[]) => void;
  setStatus: (status: StatusEntry[]) => void;

  // Actions - Recent repositories
  addRecentRepository: (path: string, name: string) => void;
  removeRecentRepository: (path: string) => void;
  clearRecentRepositories: () => void;

  // Getters
  getActiveRepository: () => OpenRepository | null;
  reset: () => void;
}

const MAX_RECENT = 10;

const initialState = {
  openRepositories: [] as OpenRepository[],
  activeIndex: -1,
  isLoading: false,
  error: null,
  recentRepositories: [] as RecentRepository[],
};

const createEmptyRepoData = (repo: Repository): OpenRepository => ({
  repository: repo,
  branches: [],
  currentBranch: null,
  remotes: [],
  tags: [],
  stashes: [],
  status: [],
  stagedFiles: [],
  unstagedFiles: [],
});

export const useRepositoryStore = create<RepositoryState>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Repository management
      addRepository: (repo) => {
        set((state) => {
          const existingIndex = state.openRepositories.findIndex(
            (r) => r.repository.path === repo.path
          );

          if (existingIndex >= 0) {
            return { activeIndex: existingIndex };
          }

          const newRepos = [...state.openRepositories, createEmptyRepoData(repo)];
          return {
            openRepositories: newRepos,
            activeIndex: newRepos.length - 1,
            error: null,
          };
        });

        // Add to recent
        const name = repo.name || repo.path.split('/').pop() || repo.path;
        get().addRecentRepository(repo.path, name);
      },

      removeRepository: (path) => {
        set((state) => {
          const index = state.openRepositories.findIndex(
            (r) => r.repository.path === path
          );
          if (index < 0) return state;

          const newRepos = state.openRepositories.filter(
            (r) => r.repository.path !== path
          );
          let newActiveIndex = state.activeIndex;

          if (newRepos.length === 0) {
            newActiveIndex = -1;
          } else if (state.activeIndex >= index) {
            newActiveIndex = Math.max(0, state.activeIndex - 1);
          }

          return {
            openRepositories: newRepos,
            activeIndex: newActiveIndex,
          };
        });
      },

      setActiveIndex: (index) => {
        set((state) => {
          if (index < 0 || index >= state.openRepositories.length) {
            return state;
          }
          return { activeIndex: index };
        });
      },

      setActiveByPath: (path) => {
        set((state) => {
          const index = state.openRepositories.findIndex(
            (r) => r.repository.path === path
          );
          if (index < 0) return state;
          return { activeIndex: index };
        });
      },

      // Loading/error state
      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      // Update active repo data
      setBranches: (branches) => {
        set((state) => {
          if (state.activeIndex < 0) return state;
          const newRepos = [...state.openRepositories];
          newRepos[state.activeIndex] = {
            ...newRepos[state.activeIndex],
            branches,
          };
          return { openRepositories: newRepos };
        });
      },

      setCurrentBranch: (currentBranch) => {
        set((state) => {
          if (state.activeIndex < 0) return state;
          const newRepos = [...state.openRepositories];
          newRepos[state.activeIndex] = {
            ...newRepos[state.activeIndex],
            currentBranch,
          };
          return { openRepositories: newRepos };
        });
      },

      setRemotes: (remotes) => {
        set((state) => {
          if (state.activeIndex < 0) return state;
          const newRepos = [...state.openRepositories];
          newRepos[state.activeIndex] = {
            ...newRepos[state.activeIndex],
            remotes,
          };
          return { openRepositories: newRepos };
        });
      },

      setTags: (tags) => {
        set((state) => {
          if (state.activeIndex < 0) return state;
          const newRepos = [...state.openRepositories];
          newRepos[state.activeIndex] = {
            ...newRepos[state.activeIndex],
            tags,
          };
          return { openRepositories: newRepos };
        });
      },

      setStashes: (stashes) => {
        set((state) => {
          if (state.activeIndex < 0) return state;
          const newRepos = [...state.openRepositories];
          newRepos[state.activeIndex] = {
            ...newRepos[state.activeIndex],
            stashes,
          };
          return { openRepositories: newRepos };
        });
      },

      setStatus: (status) => {
        set((state) => {
          if (state.activeIndex < 0) return state;
          const newRepos = [...state.openRepositories];
          newRepos[state.activeIndex] = {
            ...newRepos[state.activeIndex],
            status,
            stagedFiles: status.filter((s) => s.isStaged),
            unstagedFiles: status.filter((s) => !s.isStaged),
          };
          return { openRepositories: newRepos };
        });
      },

      // Recent repositories
      addRecentRepository: (path, name) => {
        set((state) => {
          const filtered = state.recentRepositories.filter((r) => r.path !== path);
          const newRecent: RecentRepository = {
            path,
            name,
            lastOpened: Date.now(),
          };
          return {
            recentRepositories: [newRecent, ...filtered].slice(0, MAX_RECENT),
          };
        });
      },

      removeRecentRepository: (path) => {
        set((state) => ({
          recentRepositories: state.recentRepositories.filter((r) => r.path !== path),
        }));
      },

      clearRecentRepositories: () => {
        set({ recentRepositories: [] });
      },

      // Getters
      getActiveRepository: () => {
        const state = get();
        if (state.activeIndex < 0 || state.activeIndex >= state.openRepositories.length) {
          return null;
        }
        return state.openRepositories[state.activeIndex];
      },

      reset: () => set(initialState),
    }),
    {
      name: 'leviathan-repositories',
      partialize: (state) => ({
        recentRepositories: state.recentRepositories,
      }),
    }
  )
);
