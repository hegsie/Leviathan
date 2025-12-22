/**
 * Dialog Service
 * Wrapper around Tauri dialog plugin for file/folder selection
 */

import { open, save, message, ask, confirm } from '@tauri-apps/plugin-dialog';

/**
 * Check if running inside Tauri
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

/**
 * Open a file or folder picker dialog
 */
export async function openDialog(options: OpenDialogOptions = {}): Promise<string | string[] | null> {
  if (!isTauri()) {
    console.warn('Dialog API is only available in Tauri. Run with: npm run tauri dev');
    alert('Dialog API is only available when running in Tauri.\n\nRun with: npm run tauri dev');
    return null;
  }

  console.log('Opening dialog with options:', options);
  try {
    const result = await open({
      title: options.title,
      defaultPath: options.defaultPath,
      directory: options.directory ?? false,
      multiple: options.multiple ?? false,
      filters: options.filters,
    });
    console.log('Dialog result:', result);
    return result;
  } catch (error) {
    console.error('Dialog error:', error);
    throw error;
  }
}

/**
 * Open a folder picker dialog specifically for repositories
 */
export async function openRepositoryDialog(): Promise<string | null> {
  const result = await openDialog({
    title: 'Open Repository',
    directory: true,
    multiple: false,
  });

  if (Array.isArray(result)) {
    return result[0] ?? null;
  }
  return result;
}

/**
 * Open a folder picker dialog for clone destination
 */
export async function openCloneDestinationDialog(defaultPath?: string): Promise<string | null> {
  const result = await openDialog({
    title: 'Select Clone Destination',
    directory: true,
    multiple: false,
    defaultPath,
  });

  if (Array.isArray(result)) {
    return result[0] ?? null;
  }
  return result;
}

/**
 * Open a save dialog
 */
export async function saveDialog(options: SaveDialogOptions = {}): Promise<string | null> {
  try {
    const result = await save({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    return result;
  } catch (error) {
    console.error('Save dialog error:', error);
    return null;
  }
}

/**
 * Show a message dialog
 */
export async function showMessage(
  title: string,
  messageText: string,
  kind: 'info' | 'warning' | 'error' = 'info'
): Promise<void> {
  await message(messageText, { title, kind });
}

/**
 * Show a confirmation dialog with Yes/No
 */
export async function showConfirm(
  title: string,
  messageText: string,
  kind: 'info' | 'warning' | 'error' = 'info'
): Promise<boolean> {
  return await confirm(messageText, { title, kind });
}

/**
 * Show an ask dialog with OK/Cancel
 */
export async function showAsk(
  title: string,
  messageText: string,
  kind: 'info' | 'warning' | 'error' = 'info'
): Promise<boolean> {
  return await ask(messageText, { title, kind });
}
