/**
 * File Watcher Service
 * Watches for file system changes in the repository and emits events
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface FileChangeEvent {
  eventType: 'workdir-changed' | 'index-changed' | 'refs-changed' | 'config-changed';
  paths: string[];
}

export type FileChangeHandler = (event: FileChangeEvent) => void;

let unlisten: UnlistenFn | null = null;
const handlers: Set<FileChangeHandler> = new Set();

/**
 * Start watching a repository for file changes
 */
export async function startWatching(path: string): Promise<void> {
  // Set up event listener if not already done
  if (!unlisten) {
    unlisten = await listen<FileChangeEvent>('file-change', (event) => {
      // Notify all registered handlers
      for (const handler of handlers) {
        try {
          handler(event.payload);
        } catch (err) {
          console.error('Error in file change handler:', err);
        }
      }
    });
  }

  // Start watching on the backend
  await invoke('start_watching', { path });
}

/**
 * Stop watching the current repository
 */
export async function stopWatching(): Promise<void> {
  await invoke('stop_watching');
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
  handlers.clear();
  await stopWatching();
}
