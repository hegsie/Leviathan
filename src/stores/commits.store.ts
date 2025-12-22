import { create } from 'zustand';
import type { Commit } from '../types/git.types.ts';
import type { GraphLayout, GraphSelection } from '../types/graph.types.ts';

export interface CommitsState {
  // Commits
  commits: Commit[];
  commitMap: Map<string, Commit>;
  isLoading: boolean;
  hasMore: boolean;

  // Graph layout
  graphLayout: GraphLayout | null;

  // Selection
  selection: GraphSelection;

  // Actions
  setCommits: (commits: Commit[]) => void;
  appendCommits: (commits: Commit[]) => void;
  setLoading: (loading: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setGraphLayout: (layout: GraphLayout | null) => void;
  selectCommit: (oid: string | null) => void;
  hoverCommit: (oid: string | null) => void;
  setRangeSelection: (start: string | null, end: string | null) => void;
  getCommit: (oid: string) => Commit | undefined;
  reset: () => void;
}

const initialSelection: GraphSelection = {
  selectedOid: null,
  hoveredOid: null,
  rangeStart: null,
  rangeEnd: null,
};

const initialState = {
  commits: [],
  commitMap: new Map<string, Commit>(),
  isLoading: false,
  hasMore: true,
  graphLayout: null,
  selection: initialSelection,
};

export const useCommitsStore = create<CommitsState>((set, get) => ({
  ...initialState,

  setCommits: (commits) => {
    const commitMap = new Map(commits.map((c) => [c.oid, c]));
    set({ commits, commitMap, hasMore: true });
  },

  appendCommits: (newCommits) =>
    set((state) => {
      const commits = [...state.commits, ...newCommits];
      const commitMap = new Map(commits.map((c) => [c.oid, c]));
      return { commits, commitMap };
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setHasMore: (hasMore) => set({ hasMore }),

  setGraphLayout: (graphLayout) => set({ graphLayout }),

  selectCommit: (oid) =>
    set((state) => ({
      selection: { ...state.selection, selectedOid: oid },
    })),

  hoverCommit: (oid) =>
    set((state) => ({
      selection: { ...state.selection, hoveredOid: oid },
    })),

  setRangeSelection: (start, end) =>
    set((state) => ({
      selection: { ...state.selection, rangeStart: start, rangeEnd: end },
    })),

  getCommit: (oid) => get().commitMap.get(oid),

  reset: () => set(initialState),
}));
