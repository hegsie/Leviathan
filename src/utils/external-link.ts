/**
 * Utility for opening external URLs in the default browser
 * Uses Tauri's shell plugin which works in the desktop app context
 */

import { open } from '@tauri-apps/plugin-shell';

/**
 * Open a URL in the system's default browser
 * @param url The URL to open
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await open(url);
  } catch (error) {
    console.error('Failed to open external URL:', error);
    // Fallback for development/browser context
    window.open(url, '_blank');
  }
}

/**
 * Click handler for anchor elements that should open externally
 * Use with @click=${handleExternalLink}
 */
export function handleExternalLink(event: Event): void {
  event.preventDefault();
  const anchor = event.currentTarget as HTMLAnchorElement;
  const url = anchor.href;
  if (url) {
    openExternalUrl(url);
  }
}
