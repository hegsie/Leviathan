/**
 * Settings Store
 * Persisted user preferences and application settings
 */

import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'system';
export type FontSize = 'small' | 'medium' | 'large';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type GraphColorScheme = 'default' | 'pastel' | 'vibrant' | 'monochrome' | 'high-contrast';

export interface SettingsState {
  // Appearance
  theme: Theme;
  fontSize: FontSize;
  fontFamily: string;
  density: Density;

  // Git defaults
  defaultBranchName: string;
  defaultRemoteName: string;

  // Graph settings
  showAvatars: boolean;
  showCommitSize: boolean;
  graphRowHeight: number;
  graphColorScheme: GraphColorScheme;

  // Diff settings
  diffContextLines: number;
  wordWrap: boolean;
  showWhitespace: boolean;

  // Behavior
  autoFetchInterval: number; // 0 = disabled, in minutes
  fetchOnFocus: boolean; // Fetch when window regains focus
  confirmBeforeDiscard: boolean;
  openLastRepository: boolean;
  autoStashOnCheckout: boolean; // Automatically stash/pop when switching branches

  // Branch settings
  staleBranchDays: number; // Days without commits before a branch is considered stale (0 = disabled)

  // Network settings
  networkOperationTimeout: number; // Seconds before network operations time out (0 = disabled)

  // System tray & notifications
  minimizeToTray: boolean;
  showNativeNotifications: boolean;

  // Actions
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
  setFontFamily: (family: string) => void;
  setDensity: (density: Density) => void;
  setGraphColorScheme: (scheme: GraphColorScheme) => void;
  setDefaultBranchName: (name: string) => void;
  setDefaultRemoteName: (name: string) => void;
  setShowAvatars: (show: boolean) => void;
  setShowCommitSize: (show: boolean) => void;
  setGraphRowHeight: (height: number) => void;
  setDiffContextLines: (lines: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setShowWhitespace: (show: boolean) => void;
  setAutoFetchInterval: (minutes: number) => void;
  setFetchOnFocus: (enabled: boolean) => void;
  setConfirmBeforeDiscard: (confirm: boolean) => void;
  setOpenLastRepository: (open: boolean) => void;
  setAutoStashOnCheckout: (enabled: boolean) => void;
  setStaleBranchDays: (days: number) => void;
  setNetworkOperationTimeout: (timeout: number) => void;
  setMinimizeToTray: (enabled: boolean) => void;
  setShowNativeNotifications: (enabled: boolean) => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  theme: 'dark' as Theme,
  fontSize: 'medium' as FontSize,
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  density: 'comfortable' as Density,
  defaultBranchName: 'main',
  defaultRemoteName: 'origin',
  showAvatars: true,
  showCommitSize: true,
  graphRowHeight: 40,
  graphColorScheme: 'default' as GraphColorScheme,
  diffContextLines: 3,
  wordWrap: true,
  showWhitespace: false,
  autoFetchInterval: 0,
  fetchOnFocus: false,
  confirmBeforeDiscard: true,
  openLastRepository: true,
  autoStashOnCheckout: false,
  staleBranchDays: 90,
  networkOperationTimeout: 300,
  minimizeToTray: false,
  showNativeNotifications: true,
};

export const settingsStore = createStore<SettingsState>()(
  persist(
    (set) => ({
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

      setDensity: (density) => {
        set({ density });
        applyDensity(density);
      },

      setGraphColorScheme: (graphColorScheme) => {
        set({ graphColorScheme });
        applyGraphColorScheme(graphColorScheme);
      },

      setDefaultBranchName: (defaultBranchName) => set({ defaultBranchName }),

      setDefaultRemoteName: (defaultRemoteName) => set({ defaultRemoteName }),

      setShowAvatars: (showAvatars) => set({ showAvatars }),

      setShowCommitSize: (showCommitSize) => set({ showCommitSize }),

      setGraphRowHeight: (graphRowHeight) => set({ graphRowHeight }),

      setDiffContextLines: (diffContextLines) => set({ diffContextLines }),

      setWordWrap: (wordWrap) => set({ wordWrap }),

      setShowWhitespace: (showWhitespace) => set({ showWhitespace }),

      setAutoFetchInterval: (autoFetchInterval) => set({ autoFetchInterval }),

      setFetchOnFocus: (fetchOnFocus) => set({ fetchOnFocus }),

      setConfirmBeforeDiscard: (confirmBeforeDiscard) => set({ confirmBeforeDiscard }),

      setOpenLastRepository: (openLastRepository) => set({ openLastRepository }),

      setAutoStashOnCheckout: (autoStashOnCheckout) => set({ autoStashOnCheckout }),

      setStaleBranchDays: (staleBranchDays) => set({ staleBranchDays }),

      setNetworkOperationTimeout: (networkOperationTimeout) => set({ networkOperationTimeout }),

      setMinimizeToTray: (minimizeToTray) => set({ minimizeToTray }),

      setShowNativeNotifications: (showNativeNotifications) => set({ showNativeNotifications }),

      resetToDefaults: () => {
        set(defaultSettings);
        applyTheme(defaultSettings.theme);
        applyFontSize(defaultSettings.fontSize);
        applyDensity(defaultSettings.density);
        applyGraphColorScheme(defaultSettings.graphColorScheme);
      },
    }),
    {
      name: 'leviathan-settings',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme);
          applyFontSize(state.fontSize);
          applyDensity(state.density);
          applyGraphColorScheme(state.graphColorScheme);
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

/**
 * Apply density settings to document
 */
function applyDensity(density: Density): void {
  const root = document.documentElement;
  const settings = {
    compact: {
      rowHeight: '28px',
      spacing: '4px',
      padding: '4px 8px',
      graphRowHeight: '28',
    },
    comfortable: {
      rowHeight: '36px',
      spacing: '8px',
      padding: '8px 12px',
      graphRowHeight: '36',
    },
    spacious: {
      rowHeight: '44px',
      spacing: '12px',
      padding: '12px 16px',
      graphRowHeight: '44',
    },
  };
  const s = settings[density];
  root.style.setProperty('--density-row-height', s.rowHeight);
  root.style.setProperty('--density-spacing', s.spacing);
  root.style.setProperty('--density-padding', s.padding);
  root.style.setProperty('--density-graph-row-height', s.graphRowHeight);
  root.setAttribute('data-density', density);
}

/**
 * Graph color scheme presets
 */
const graphColorSchemes: Record<GraphColorScheme, string[]> = {
  default: [
    '#4fc3f7', '#81c784', '#ef5350', '#ffb74d',
    '#ce93d8', '#4dd0e1', '#ff8a65', '#aed581',
  ],
  pastel: [
    '#b3e5fc', '#c8e6c9', '#ffcdd2', '#ffe0b2',
    '#e1bee7', '#b2ebf2', '#ffccbc', '#dcedc8',
  ],
  vibrant: [
    '#00bcd4', '#4caf50', '#f44336', '#ff9800',
    '#9c27b0', '#00acc1', '#ff5722', '#8bc34a',
  ],
  monochrome: [
    '#90caf9', '#a5d6a7', '#ef9a9a', '#ffe082',
    '#ce93d8', '#80deea', '#ffab91', '#c5e1a5',
  ],
  'high-contrast': [
    '#00e5ff', '#00e676', '#ff1744', '#ffea00',
    '#d500f9', '#18ffff', '#ff3d00', '#76ff03',
  ],
};

/**
 * Apply graph color scheme to CSS variables
 */
function applyGraphColorScheme(scheme: GraphColorScheme): void {
  const root = document.documentElement;
  const colors = graphColorSchemes[scheme];
  colors.forEach((color, i) => {
    root.style.setProperty(`--color-branch-${i + 1}`, color);
  });
  root.setAttribute('data-graph-scheme', scheme);
}

/**
 * Get available graph color schemes for UI
 */
export function getGraphColorSchemes(): { id: GraphColorScheme; name: string; colors: string[] }[] {
  return [
    { id: 'default', name: 'Default', colors: graphColorSchemes.default },
    { id: 'pastel', name: 'Pastel', colors: graphColorSchemes.pastel },
    { id: 'vibrant', name: 'Vibrant', colors: graphColorSchemes.vibrant },
    { id: 'monochrome', name: 'Monochrome', colors: graphColorSchemes.monochrome },
    { id: 'high-contrast', name: 'High Contrast', colors: graphColorSchemes['high-contrast'] },
  ];
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
