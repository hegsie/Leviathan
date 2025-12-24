/**
 * Keyboard Shortcuts Service
 * Global keyboard shortcut handling for the application
 */

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  action: () => void;
  description: string;
  category: string;
}

export interface ShortcutRegistration {
  id: string;
  shortcut: Shortcut;
}

export interface KeyboardSettings {
  vimMode: boolean;
  customBindings: Record<string, string>;
}

const STORAGE_KEY = 'leviathan-keyboard-settings';

class KeyboardService {
  private shortcuts: Map<string, Shortcut> = new Map();
  private enabled = true;
  private listeners: Set<(e: KeyboardEvent) => void> = new Set();
  private vimMode = false;
  private vimPendingKey: string | null = null;
  private vimActions: {
    navigateUp?: () => void;
    navigateDown?: () => void;
    navigateFirst?: () => void;
    navigateLast?: () => void;
  } = {};

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    document.addEventListener('keydown', this.handleKeyDown);
    this.loadSettings();
  }

  private loadSettings(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const settings: KeyboardSettings = JSON.parse(stored);
        this.vimMode = settings.vimMode ?? false;
      }
    } catch {
      // Ignore parse errors
    }
  }

  private saveSettings(): void {
    try {
      const settings: KeyboardSettings = {
        vimMode: this.vimMode,
        customBindings: {},
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Generate a unique key for a shortcut combo
   */
  private getShortcutKey(e: KeyboardEvent | Shortcut): string {
    const ctrl = 'ctrlKey' in e ? e.ctrlKey : e.ctrl;
    const shift = 'shiftKey' in e ? e.shiftKey : e.shift;
    const alt = 'altKey' in e ? e.altKey : e.alt;
    const meta = 'metaKey' in e ? e.metaKey : e.meta;
    const key = e.key.toLowerCase();

    const parts: string[] = [];
    if (ctrl || meta) parts.push('mod');
    if (shift) parts.push('shift');
    if (alt) parts.push('alt');
    parts.push(key);

    return parts.join('+');
  }

  /**
   * Register a keyboard shortcut
   */
  register(id: string, shortcut: Shortcut): void {
    const key = this.getShortcutKey(shortcut);
    this.shortcuts.set(key, { ...shortcut });
  }

  /**
   * Unregister a keyboard shortcut
   */
  unregister(id: string): void {
    // Find and remove by iterating (we store by key combo, not id)
    for (const [key, shortcut] of this.shortcuts.entries()) {
      if (shortcut.description === id) {
        this.shortcuts.delete(key);
        break;
      }
    }
  }

  /**
   * Handle vim-style navigation
   */
  private handleVimKey(e: KeyboardEvent): boolean {
    if (!this.vimMode) return false;

    // Don't process if modifier keys are pressed (except shift for G)
    if (e.ctrlKey || e.metaKey || e.altKey) return false;

    const key = e.key.toLowerCase();

    // Handle pending 'g' for 'gg' command
    if (this.vimPendingKey === 'g') {
      this.vimPendingKey = null;
      if (key === 'g' && this.vimActions.navigateFirst) {
        e.preventDefault();
        this.vimActions.navigateFirst();
        return true;
      }
      // Not a valid sequence, don't consume
      return false;
    }

    // j - down
    if (key === 'j' && this.vimActions.navigateDown) {
      e.preventDefault();
      this.vimActions.navigateDown();
      return true;
    }

    // k - up
    if (key === 'k' && this.vimActions.navigateUp) {
      e.preventDefault();
      this.vimActions.navigateUp();
      return true;
    }

    // G (shift+g) - go to end
    if (e.key === 'G' && e.shiftKey && this.vimActions.navigateLast) {
      e.preventDefault();
      this.vimActions.navigateLast();
      return true;
    }

    // g - start of 'gg' command
    if (key === 'g' && !e.shiftKey) {
      this.vimPendingKey = 'g';
      // Set timeout to clear pending key
      setTimeout(() => {
        this.vimPendingKey = null;
      }, 500);
      return true;
    }

    return false;
  }

  /**
   * Handle keydown events
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // Don't handle shortcuts when typing in inputs
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // Allow some shortcuts even in inputs
      if (!e.ctrlKey && !e.metaKey) return;
    }

    // Try vim navigation first
    if (this.handleVimKey(e)) {
      return;
    }

    const key = this.getShortcutKey(e);
    const shortcut = this.shortcuts.get(key);

    if (shortcut) {
      e.preventDefault();
      e.stopPropagation();
      shortcut.action();
    }

    // Notify listeners
    for (const listener of this.listeners) {
      listener(e);
    }
  }

  /**
   * Set vim mode navigation actions
   */
  setVimActions(actions: {
    navigateUp?: () => void;
    navigateDown?: () => void;
    navigateFirst?: () => void;
    navigateLast?: () => void;
  }): void {
    this.vimActions = actions;
  }

  /**
   * Enable/disable vim mode
   */
  setVimMode(enabled: boolean): void {
    this.vimMode = enabled;
    this.saveSettings();
  }

  /**
   * Check if vim mode is enabled
   */
  isVimMode(): boolean {
    return this.vimMode;
  }

  /**
   * Add a raw keyboard listener
   */
  addListener(listener: (e: KeyboardEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Enable/disable keyboard shortcuts
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get all registered shortcuts
   */
  getAllShortcuts(): Shortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Get shortcuts by category
   */
  getShortcutsByCategory(): Map<string, Shortcut[]> {
    const byCategory = new Map<string, Shortcut[]>();
    for (const shortcut of this.shortcuts.values()) {
      const existing = byCategory.get(shortcut.category) || [];
      existing.push(shortcut);
      byCategory.set(shortcut.category, existing);
    }
    return byCategory;
  }

  /**
   * Format a shortcut for display
   */
  formatShortcut(shortcut: Shortcut): string {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const parts: string[] = [];

    if (shortcut.ctrl || shortcut.meta) {
      parts.push(isMac ? '⌘' : 'Ctrl');
    }
    if (shortcut.shift) parts.push(isMac ? '⇧' : 'Shift');
    if (shortcut.alt) parts.push(isMac ? '⌥' : 'Alt');

    // Format special keys
    let keyDisplay = shortcut.key;
    switch (shortcut.key.toLowerCase()) {
      case 'arrowup': keyDisplay = '↑'; break;
      case 'arrowdown': keyDisplay = '↓'; break;
      case 'arrowleft': keyDisplay = '←'; break;
      case 'arrowright': keyDisplay = '→'; break;
      case 'enter': keyDisplay = '↵'; break;
      case 'escape': keyDisplay = 'Esc'; break;
      case ' ': keyDisplay = 'Space'; break;
      default: keyDisplay = shortcut.key.toUpperCase();
    }
    parts.push(keyDisplay);

    return parts.join(isMac ? '' : '+');
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    this.shortcuts.clear();
    this.listeners.clear();
  }
}

// Singleton instance
export const keyboardService = new KeyboardService();

// Default shortcuts
export function registerDefaultShortcuts(actions: {
  navigateUp: () => void;
  navigateDown: () => void;
  navigateFirst?: () => void;
  navigateLast?: () => void;
  selectCommit: () => void;
  stageAll: () => void;
  unstageAll: () => void;
  commit: () => void;
  refresh: () => void;
  search: () => void;
  openSettings: () => void;
  openShortcuts?: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  openCommandPalette?: () => void;
  openReflog?: () => void;
  fetch?: () => void;
  pull?: () => void;
  push?: () => void;
  createBranch?: () => void;
  createStash?: () => void;
  closeDiff?: () => void;
}): void {
  // Set vim actions
  keyboardService.setVimActions({
    navigateUp: actions.navigateUp,
    navigateDown: actions.navigateDown,
    navigateFirst: actions.navigateFirst,
    navigateLast: actions.navigateLast,
  });

  // Navigation
  keyboardService.register('nav-up', {
    key: 'ArrowUp',
    action: actions.navigateUp,
    description: 'Previous commit',
    category: 'Navigation',
  });

  keyboardService.register('nav-down', {
    key: 'ArrowDown',
    action: actions.navigateDown,
    description: 'Next commit',
    category: 'Navigation',
  });

  keyboardService.register('select', {
    key: 'Enter',
    action: actions.selectCommit,
    description: 'Select commit',
    category: 'Navigation',
  });

  if (actions.navigateFirst) {
    keyboardService.register('nav-first', {
      key: 'Home',
      action: actions.navigateFirst,
      description: 'First commit',
      category: 'Navigation',
    });
  }

  if (actions.navigateLast) {
    keyboardService.register('nav-last', {
      key: 'End',
      action: actions.navigateLast,
      description: 'Last commit',
      category: 'Navigation',
    });
  }

  // Staging
  keyboardService.register('stage-all', {
    key: 's',
    action: actions.stageAll,
    description: 'Stage all changes',
    category: 'Staging',
  });

  keyboardService.register('unstage-all', {
    key: 'u',
    action: actions.unstageAll,
    description: 'Unstage all changes',
    category: 'Staging',
  });

  // Commit
  keyboardService.register('commit', {
    key: 'Enter',
    ctrl: true,
    action: actions.commit,
    description: 'Commit staged changes',
    category: 'Commit',
  });

  // General
  keyboardService.register('refresh', {
    key: 'r',
    ctrl: true,
    action: actions.refresh,
    description: 'Refresh repository',
    category: 'General',
  });

  keyboardService.register('search', {
    key: 'f',
    ctrl: true,
    action: actions.search,
    description: 'Search commits',
    category: 'General',
  });

  keyboardService.register('settings', {
    key: ',',
    ctrl: true,
    action: actions.openSettings,
    description: 'Open settings',
    category: 'General',
  });

  if (actions.openShortcuts) {
    keyboardService.register('shortcuts', {
      key: '?',
      shift: true,
      action: actions.openShortcuts,
      description: 'Show keyboard shortcuts',
      category: 'General',
    });
  }

  if (actions.openCommandPalette) {
    keyboardService.register('command-palette', {
      key: 'p',
      ctrl: true,
      action: actions.openCommandPalette,
      description: 'Open command palette',
      category: 'General',
    });
  }

  if (actions.openReflog) {
    keyboardService.register('reflog', {
      key: 'z',
      ctrl: true,
      action: actions.openReflog,
      description: 'Open undo history',
      category: 'General',
    });
  }

  // Git operations
  if (actions.fetch) {
    keyboardService.register('fetch', {
      key: 'f',
      ctrl: true,
      shift: true,
      action: actions.fetch,
      description: 'Fetch from remote',
      category: 'Git',
    });
  }

  if (actions.pull) {
    keyboardService.register('pull', {
      key: 'p',
      ctrl: true,
      shift: true,
      action: actions.pull,
      description: 'Pull from remote',
      category: 'Git',
    });
  }

  if (actions.push) {
    keyboardService.register('push', {
      key: 'u',
      ctrl: true,
      shift: true,
      action: actions.push,
      description: 'Push to remote',
      category: 'Git',
    });
  }

  if (actions.createBranch) {
    keyboardService.register('new-branch', {
      key: 'n',
      ctrl: true,
      shift: true,
      action: actions.createBranch,
      description: 'Create new branch',
      category: 'Git',
    });
  }

  if (actions.createStash) {
    keyboardService.register('stash', {
      key: 's',
      ctrl: true,
      shift: true,
      action: actions.createStash,
      description: 'Create stash',
      category: 'Git',
    });
  }

  // Panels
  keyboardService.register('toggle-left', {
    key: 'b',
    ctrl: true,
    action: actions.toggleLeftPanel,
    description: 'Toggle left panel',
    category: 'View',
  });

  keyboardService.register('toggle-right', {
    key: 'j',
    ctrl: true,
    action: actions.toggleRightPanel,
    description: 'Toggle right panel',
    category: 'View',
  });

  if (actions.closeDiff) {
    keyboardService.register('close-diff', {
      key: 'Escape',
      action: actions.closeDiff,
      description: 'Close diff/panel',
      category: 'View',
    });
  }
}
