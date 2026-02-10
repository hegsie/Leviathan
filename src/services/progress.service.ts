/**
 * Progress Service
 * Manages ongoing operations and their progress state
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

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
}

export type OperationType = ProgressOperation['type'];

interface ProgressEvent {
  operationId: string;
  message?: string;
  progress?: number;
  completed?: boolean;
  error?: string;
}

type ProgressListener = (operations: ProgressOperation[]) => void;

class ProgressService {
  private operations: Map<string, ProgressOperation> = new Map();
  private listeners: Set<ProgressListener> = new Set();
  private unlistenFns: UnlistenFn[] = [];
  private operationCounter = 0;
  private cancelledOperations: Set<string> = new Set();

  constructor() {
    // Note: setupListeners is async but we don't await it here.
    // This is intentional - the service is usable immediately for local operations,
    // and backend events will be captured once the listeners are ready.
    // In practice, the listeners initialize within milliseconds.
    this.setupListeners();
  }

  private async setupListeners(): Promise<void> {
    // Listen for progress events from Rust backend
    const unlistenProgress = await listen<ProgressEvent>('operation-progress', (event) => {
      const { operationId, message, progress, completed, error } = event.payload;

      if (completed || error) {
        this.removeOperation(operationId);
      } else {
        const existing = this.operations.get(operationId);
        if (existing) {
          existing.message = message ?? existing.message;
          existing.progress = progress;
          this.notifyListeners();
        }
      }
    });

    // Listen for remote operation completion events
    const unlistenRemote = await listen<{
      operation: string;
      remote: string;
      success: boolean;
      message: string;
    }>('remote-operation-completed', (event) => {
      // Find and remove the operation
      for (const [id, op] of this.operations.entries()) {
        if (op.type === event.payload.operation) {
          this.removeOperation(id);
          break;
        }
      }
    });

    this.unlistenFns.push(unlistenProgress, unlistenRemote);
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
    invoke('cancel_operation', { operationId: id }).catch(() => {});
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
