/**
 * Update Service
 * Handles application update checking, downloading, and installation
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand } from './tauri-api.ts';

/**
 * Update check result from backend
 */
export interface UpdateCheckEvent {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
}

/**
 * Update download progress event
 */
export interface UpdateProgressEvent {
  downloaded: number;
  total?: number;
  progressPercent: number;
}

/**
 * Update error event
 */
export interface UpdateErrorEvent {
  message: string;
}

/**
 * Check for updates manually
 */
export async function checkForUpdate(): Promise<UpdateCheckEvent | null> {
  const result = await invokeCommand<UpdateCheckEvent>('check_for_update');
  return result.success ? result.data ?? null : null;
}

/**
 * Download and install the available update
 */
export async function downloadAndInstallUpdate(): Promise<boolean> {
  const result = await invokeCommand<void>('download_and_install_update');
  return result.success;
}

/**
 * Start automatic update checking
 */
export async function startAutoUpdateCheck(
  intervalHours: number = 24
): Promise<boolean> {
  const result = await invokeCommand<void>('start_auto_update_check', {
    intervalHours,
  });
  return result.success;
}

/**
 * Stop automatic update checking
 */
export async function stopAutoUpdateCheck(): Promise<boolean> {
  const result = await invokeCommand<void>('stop_auto_update_check');
  return result.success;
}

/**
 * Check if auto-update is running
 */
export async function isAutoUpdateRunning(): Promise<boolean> {
  const result = await invokeCommand<boolean>('is_auto_update_running');
  return result.success && result.data === true;
}

/**
 * Get current application version
 */
export async function getAppVersion(): Promise<string> {
  const result = await invokeCommand<string>('get_app_version');
  return result.data ?? '0.0.0';
}

/**
 * Subscribe to update available events
 */
export async function onUpdateAvailable(
  handler: (event: UpdateCheckEvent) => void
): Promise<UnlistenFn> {
  return listen<UpdateCheckEvent>('update-available', (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribe to update checked events (when no update available)
 */
export async function onUpdateChecked(
  handler: (event: UpdateCheckEvent) => void
): Promise<UnlistenFn> {
  return listen<UpdateCheckEvent>('update-checked', (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribe to update downloading events
 */
export async function onUpdateDownloading(
  handler: () => void
): Promise<UnlistenFn> {
  return listen<void>('update-downloading', () => {
    handler();
  });
}

/**
 * Subscribe to download progress events
 */
export async function onDownloadProgress(
  handler: (progress: UpdateProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<UpdateProgressEvent>('update-download-progress', (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribe to update ready events
 */
export async function onUpdateReady(handler: () => void): Promise<UnlistenFn> {
  return listen<void>('update-ready', () => {
    handler();
  });
}

/**
 * Subscribe to update error events
 */
export async function onUpdateError(
  handler: (error: UpdateErrorEvent) => void
): Promise<UnlistenFn> {
  return listen<UpdateErrorEvent>('update-error', (event) => {
    handler(event.payload);
  });
}
