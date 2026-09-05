/**
 * Progress Service
 * Manages ongoing operations and their progress state
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand } from './tauri-api.ts';

/**
 * Represents an ongoing operation with progress tracking.
 * Defined here to avoid circular dependency with UI component.
 */
export interface ProgressOperation {
  id: string;
  type: 'fetch' | 'push' | 'pull' | 'clone' | 'checkout' | 'rebase' | 'merge' | 'generic';
  message: string;
  progress?: number; // 0-100, undefined = indeterminate
  cancellable?: boolean;
  /** Objects transferred so far, from the backend's `operation-progress`
   *  event. Undefined until the first event arrives. */
  receivedObjects?: number;
  /** Objects the remote said there are in total. */
  totalObjects?: number;
  /** Bytes transferred so far. */
  receivedBytes?: number;
}

export type OperationType = ProgressOperation['type'];

interface ProgressEvent {
  operationId: string;
  message?: string;
  progress?: number;
  completed?: boolean;
  error?: string;
  receivedObjects?: number;
  totalObjects?: number;
  receivedBytes?: number;
}

type ProgressListener = (operations: ProgressOperation[]) => void;

class ProgressService {
  private operations: Map<string, ProgressOperation> = new Map();
  private listeners: Set<ProgressListener> = new Set();
  private unlistenFns: UnlistenFn[] = [];
  private operationCounter = 0;
  private cancelledOperations: Set<string> = new Set();
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.setupListeners().catch(() => {
      // Listeners may fail in non-Tauri environments (e.g., tests).
      // The service remains usable for local operation tracking.
    });
  }

  /**
   * Wait for the service to be fully initialized (listeners attached).
   * Call this before operations that depend on backend event listeners.
   */
  async ready(): Promise<void> {
    return this.readyPromise;
  }

  private async setupListeners(): Promise<void> {
    // Listen for progress events from Rust backend
    const unlistenProgress = await listen<ProgressEvent>('operation-progress', (event) => {
      const {
        operationId,
        message,
        progress,
        completed,
        error,
        receivedObjects,
        totalObjects,
        receivedBytes,
      } = event.payload;

      if (completed || error) {
        this.removeOperation(operationId);
      } else {
        const existing = this.operations.get(operationId);
        if (existing) {
          existing.message = message ?? existing.message;
          existing.progress = progress;
          // Kept on the row rather than folded into the message so the
          // indicator can format them (and so a later event that carries no
          // counts — there is none today — would not wipe the last ones).
          existing.receivedObjects = receivedObjects ?? existing.receivedObjects;
          existing.totalObjects = totalObjects ?? existing.totalObjects;
          existing.receivedBytes = receivedBytes ?? existing.receivedBytes;
          this.notifyListeners();
        }
      }
    });

    // NOTE: `remote-operation-completed` is deliberately NOT listened to here.
    // Rows are keyed `fetch:<repo>`, and that event carries no
    // progress-operation ID — only an operation NAME ("fetch"/"push"/...) and
    // the repository — so this listener could only guess which row it meant.
    // Removing "the first row whose type matches" removed whichever repo's row
    // happened to be first in insertion order: fetch repo B, Ctrl+Tab, fetch
    // repo A (a different `fetch:<repo>` key, so the two run concurrently),
    // and A finishing tore down B's indicator while B was still fetching.
    // Every fetch/pull/push row is started AND removed by its own caller in
    // app-shell — completeOperation on success, failOperation on failure, on
    // every branch — so nothing here needs to guess.
    this.unlistenFns.push(unlistenProgress);
  }

  /**
   * Start tracking a new operation
   */
  startOperation(
    type: OperationType,
    message: string,
    options?: { cancellable?: boolean; progress?: number }
  ): string {
    const id = `op-${++this.operationCounter}-${Date.now()}`;

    const operation: ProgressOperation = {
      id,
      type,
      message,
      progress: options?.progress,
      cancellable: options?.cancellable ?? false,
    };

    this.operations.set(id, operation);
    this.notifyListeners();

    return id;
  }

  /**
   * Update an operation's progress
   */
  updateProgress(id: string, progress: number, message?: string): void {
    const operation = this.operations.get(id);
    if (operation) {
      operation.progress = progress;
      if (message) {
        operation.message = message;
      }
      this.notifyListeners();
    }
  }

  /**
   * Update an operation's message
   */
  updateMessage(id: string, message: string): void {
    const operation = this.operations.get(id);
    if (operation) {
      operation.message = message;
      this.notifyListeners();
    }
  }

  /**
   * Complete an operation (remove it from tracking)
   */
  completeOperation(id: string): void {
    this.removeOperation(id);
  }

  /**
   * Fail an operation (remove it from tracking)
   */
  failOperation(id: string): void {
    this.removeOperation(id);
  }

  /**
   * Cancel an operation
   */
  cancelOperation(id: string): void {
    this.cancelledOperations.add(id);
    this.removeOperation(id);
    // invokeCommand never throws, so no .catch() needed
    invokeCommand<void>('cancel_operation', { operationId: id });
  }

  /**
   * Check if an operation has been cancelled
   */
  isCancelled(id: string): boolean {
    return this.cancelledOperations.has(id);
  }

  /**
   * Remove an operation
   */
  private removeOperation(id: string): void {
    if (this.operations.has(id)) {
      this.operations.delete(id);
      this.notifyListeners();

      // Clean up cancellation flag after 5 seconds.
      // This delay allows any in-flight async operations to check the cancellation
      // status before the flag is removed. 5 seconds is chosen as a reasonable
      // window for most operations to complete their cancellation check.
      setTimeout(() => {
        this.cancelledOperations.delete(id);
      }, 5000);
    }
  }

  /**
   * Get all current operations
   */
  getOperations(): ProgressOperation[] {
    return Array.from(this.operations.values());
  }

  /**
   * Subscribe to operation changes
   */
  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.getOperations());
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    const operations = this.getOperations();
    for (const listener of this.listeners) {
      listener(operations);
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    for (const unlisten of this.unlistenFns) {
      unlisten();
    }
    this.unlistenFns = [];
    this.operations.clear();
    this.listeners.clear();
  }
}

// Singleton instance
export const progressService = new ProgressService();

/**
 * Helper to wrap an async operation with progress tracking.
 * Provides cancellation checking via the checkCancelled callback.
 */
export async function withProgress<T>(
  type: OperationType,
  message: string,
  operation: (
    updateProgress: (progress: number, message?: string) => void,
    checkCancelled: () => boolean
  ) => Promise<T>,
  options?: { cancellable?: boolean }
): Promise<T> {
  await progressService.ready();
  const id = progressService.startOperation(type, message, options);

  try {
    const result = await operation(
      (progress, msg) => {
        progressService.updateProgress(id, progress, msg);
      },
      () => progressService.isCancelled(id)
    );
    progressService.completeOperation(id);
    return result;
  } catch (error) {
    progressService.failOperation(id);
    throw error;
  }
}
