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

class KeyboardService {
  private shortcuts: Map<string, Shortcut> = new Map();
  private enabled = true;
  private listeners: Set<(e: KeyboardEvent) => void> = new Set();

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    document.addEventListener('keydown', this.handleKeyDown);
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
  selectCommit: () => void;
  stageAll: () => void;
  unstageAll: () => void;
  commit: () => void;
  refresh: () => void;
  search: () => void;
  openSettings: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
}): void {
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
}
