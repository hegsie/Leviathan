/**
 * Platform detection utilities
 */

export type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

/**
 * Detect the current platform
 */
export function getPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes('mac')) return 'macos';
  if (userAgent.includes('win')) return 'windows';
  if (userAgent.includes('linux')) return 'linux';

  return 'unknown';
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return getPlatform() === 'macos';
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return getPlatform() === 'windows';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return getPlatform() === 'linux';
}

/**
 * Get the modifier key for the current platform
 * Returns 'meta' for macOS, 'ctrl' for others
 */
export function getModifierKey(): 'meta' | 'ctrl' {
  return isMacOS() ? 'meta' : 'ctrl';
}

/**
 * Get the modifier key display name
 */
export function getModifierKeyDisplay(): string {
  return isMacOS() ? '⌘' : 'Ctrl';
}

/**
 * Format a keyboard shortcut for display
 */
export function formatShortcut(keys: string[]): string {
  const platform = getPlatform();
  const replacements: Record<string, string> = platform === 'macos'
    ? {
        ctrl: '⌃',
        alt: '⌥',
        shift: '⇧',
        meta: '⌘',
        cmd: '⌘',
        enter: '↩',
        backspace: '⌫',
        delete: '⌦',
        escape: '⎋',
        tab: '⇥',
        up: '↑',
        down: '↓',
        left: '←',
        right: '→',
      }
    : {
        meta: 'Win',
        cmd: 'Ctrl',
      };

  return keys
    .map((key) => replacements[key.toLowerCase()] ?? key.toUpperCase())
    .join(platform === 'macos' ? '' : '+');
}

/**
 * Check if an event matches a keyboard shortcut
 */
export function matchesShortcut(
  event: KeyboardEvent,
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
): boolean {
  const { ctrl = false, alt = false, shift = false, meta = false } = modifiers;

  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    event.ctrlKey === ctrl &&
    event.altKey === alt &&
    event.shiftKey === shift &&
    event.metaKey === meta
  );
}
