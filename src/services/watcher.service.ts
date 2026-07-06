/**
 * File Watcher Service
 * Watches for file system changes across all open repositories and emits
 * events tagged with the repository they came from.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand } from './tauri-api.ts';

export interface FileChangeEvent {
  repoPath: string;
  eventType: 'workdir-changed' | 'index-changed' | 'refs-changed' | 'config-changed';
  paths: string[];
}

export type FileChangeHandler = (event: FileChangeEvent) => void;

let unlisten: UnlistenFn | null = null;
// In-flight listener registration. Concurrent startWatching calls (e.g. the
// startup restore watching N repos at once) must share ONE registration —
// checking `unlisten` alone is not atomic across the await and used to leak
// N-1 duplicate listeners that each dispatched every event again.
let listenerSetup: Promise<void> | null = null;
const handlers: Set<FileChangeHandler> = new Set();

/**
 * Start watching a repository for file changes. Other repositories already
 * being watched are unaffected.
 */
export async function startWatching(path: string): Promise<void> {
  // Set up the (single) event listener if not already done
  if (!listenerSetup) {
    listenerSetup = listen<FileChangeEvent>('file-change', (event) => {
      // Notify all registered handlers
      for (const handler of handlers) {
        try {
          handler(event.payload);
        } catch (err) {
          console.error('Error in file change handler:', err);
        }
      }
    }).then(
      (fn) => {
        unlisten = fn;
      },
      (err) => {
        // Don't cache a failed registration — the next call retries
        listenerSetup = null;
        throw err;
      }
    );
  }
  await listenerSetup;

  // Start watching on the backend
  const result = await invokeCommand<void>('start_watching', { path });
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to start watching');
  }
}

/**
 * Stop watching a repository. With no path, stop watching all repositories.
 */
export async function stopWatching(path?: string): Promise<void> {
  const result = await invokeCommand<void>('stop_watching', { path: path ?? null });
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to stop watching');
  }
}

/**
 * Register a handler for file change events
 * Returns an unsubscribe function
 */
export function onFileChange(handler: FileChangeHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/**
 * Clean up the watcher (call on app shutdown)
 */
export async function cleanup(): Promise<void> {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  listenerSetup = null;
  handlers.clear();
  await stopWatching();
}
