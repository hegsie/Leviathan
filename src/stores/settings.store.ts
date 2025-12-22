/**
 * Settings Store
 * Persisted user preferences and application settings
 */

import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'system';
export type FontSize = 'small' | 'medium' | 'large';

export interface SettingsState {
  // Appearance
  theme: Theme;
  fontSize: FontSize;
  fontFamily: string;

  // Git defaults
  defaultBranchName: string;
  defaultRemoteName: string;

  // Graph settings
  showAvatars: boolean;
  showCommitSize: boolean;
  graphRowHeight: number;

  // Diff settings
  diffContextLines: number;
  wordWrap: boolean;
  showWhitespace: boolean;

  // Behavior
  autoFetchInterval: number; // 0 = disabled, in minutes
  confirmBeforeDiscard: boolean;
  openLastRepository: boolean;

  // Recent repositories
  recentRepositories: string[];
  maxRecentRepositories: number;

  // Actions
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
  setFontFamily: (family: string) => void;
  setDefaultBranchName: (name: string) => void;
  setDefaultRemoteName: (name: string) => void;
  setShowAvatars: (show: boolean) => void;
  setShowCommitSize: (show: boolean) => void;
  setGraphRowHeight: (height: number) => void;
  setDiffContextLines: (lines: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setShowWhitespace: (show: boolean) => void;
  setAutoFetchInterval: (minutes: number) => void;
  setConfirmBeforeDiscard: (confirm: boolean) => void;
  setOpenLastRepository: (open: boolean) => void;
  addRecentRepository: (path: string) => void;
  removeRecentRepository: (path: string) => void;
  clearRecentRepositories: () => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  theme: 'dark' as Theme,
  fontSize: 'medium' as FontSize,
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  defaultBranchName: 'main',
  defaultRemoteName: 'origin',
  showAvatars: true,
  showCommitSize: true,
  graphRowHeight: 40,
  diffContextLines: 3,
  wordWrap: true,
  showWhitespace: false,
  autoFetchInterval: 0,
  confirmBeforeDiscard: true,
  openLastRepository: true,
  recentRepositories: [] as string[],
  maxRecentRepositories: 10,
};

export const settingsStore = createStore<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      setFontSize: (fontSize) => {
        set({ fontSize });
        applyFontSize(fontSize);
      },

      setFontFamily: (fontFamily) => set({ fontFamily }),

      setDefaultBranchName: (defaultBranchName) => set({ defaultBranchName }),

      setDefaultRemoteName: (defaultRemoteName) => set({ defaultRemoteName }),

      setShowAvatars: (showAvatars) => set({ showAvatars }),

      setShowCommitSize: (showCommitSize) => set({ showCommitSize }),

      setGraphRowHeight: (graphRowHeight) => set({ graphRowHeight }),

      setDiffContextLines: (diffContextLines) => set({ diffContextLines }),

      setWordWrap: (wordWrap) => set({ wordWrap }),

      setShowWhitespace: (showWhitespace) => set({ showWhitespace }),

      setAutoFetchInterval: (autoFetchInterval) => set({ autoFetchInterval }),

      setConfirmBeforeDiscard: (confirmBeforeDiscard) => set({ confirmBeforeDiscard }),

      setOpenLastRepository: (openLastRepository) => set({ openLastRepository }),

      addRecentRepository: (path) => {
        const { recentRepositories, maxRecentRepositories } = get();
        const filtered = recentRepositories.filter((p) => p !== path);
        const updated = [path, ...filtered].slice(0, maxRecentRepositories);
        set({ recentRepositories: updated });
      },

      removeRecentRepository: (path) => {
        set((state) => ({
          recentRepositories: state.recentRepositories.filter((p) => p !== path),
        }));
      },

      clearRecentRepositories: () => set({ recentRepositories: [] }),

      resetToDefaults: () => {
        set(defaultSettings);
        applyTheme(defaultSettings.theme);
        applyFontSize(defaultSettings.fontSize);
      },
    }),
    {
      name: 'leviathan-settings',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme);
          applyFontSize(state.fontSize);
        }
      },
    }
  )
);

/**
 * Apply theme to document
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

/**
 * Apply font size to document
 */
function applyFontSize(size: FontSize): void {
  const root = document.documentElement;
  const sizes = {
    small: '12px',
    medium: '14px',
    large: '16px',
  };
  root.style.setProperty('--base-font-size', sizes[size]);
}

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = settingsStore.getState();
    if (theme === 'system') {
      applyTheme('system');
    }
  });
}
