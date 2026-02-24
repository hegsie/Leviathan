/**
 * Dialog Service
 * Wrapper around Tauri dialog plugin for file/folder selection
 */

import { open, save, message, ask, confirm } from '@tauri-apps/plugin-dialog';
import { loggers } from '../utils/logger.ts';

const log = loggers.dialog;

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

  log.debug('Opening dialog with options:', options);
  try {
    const result = await open({
      title: options.title,
      defaultPath: options.defaultPath,
      directory: options.directory ?? false,
      multiple: options.multiple ?? false,
      filters: options.filters,
    });
    log.debug('Dialog result:', result);
    return result;
  } catch (error) {
    log.error('Dialog error:', error);
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
    log.error('Save dialog error:', error);
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

/**
 * Options for the themed prompt dialog
 */
export interface PromptOptions {
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;  // default 'OK'
  cancelLabel?: string;   // default 'Cancel'
}

/**
 * Show a themed prompt dialog (replacement for native prompt())
 * Returns the entered string on confirm, or null on cancel/escape.
 */
let promptDialogInstance: import('../components/dialogs/lv-prompt-dialog.ts').LvPromptDialog | null = null;

type PromptOverride = ((options: PromptOptions) => Promise<string | null>) | null;
let _testPromptOverride: PromptOverride = null;

/** Set an override for showPrompt (for testing). Pass null to clear. */
export function _setTestPromptOverride(fn: PromptOverride): void {
  _testPromptOverride = fn;
}

export async function showPrompt(options: PromptOptions): Promise<string | null> {
  if (_testPromptOverride) return _testPromptOverride(options);
  if (!promptDialogInstance) {
    await import('../components/dialogs/lv-prompt-dialog.ts');
    promptDialogInstance = document.createElement('lv-prompt-dialog') as import('../components/dialogs/lv-prompt-dialog.ts').LvPromptDialog;
    document.body.appendChild(promptDialogInstance);
  }
  return promptDialogInstance.open(options);
}
