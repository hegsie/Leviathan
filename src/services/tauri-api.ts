/**
 * Tauri API wrapper for IPC communication
 * Provides type-safe command invocation and event listening
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CommandResult } from '../types/api.types.ts';

/**
 * Invoke a Tauri command with type safety
 */
export async function invokeCommand<T, A = unknown>(
  command: string,
  args?: A
): Promise<CommandResult<T>> {
  try {
    const data = await invoke<T>(command, args as Record<string, unknown>);
    return { success: true, data };
  } catch (error) {
    // Tauri errors from Rust are serialized as objects with code, message, details
    let message: string;
    let code = 'COMMAND_ERROR';

    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'object' && error !== null) {
      // Handle Tauri/Rust error objects
      const errObj = error as { code?: string; message?: string };
      message = errObj.message ?? JSON.stringify(error);
      code = errObj.code ?? 'COMMAND_ERROR';
    } else {
      message = String(error);
    }

    return {
      success: false,
      error: {
        code,
        message,
      },
    };
  }
}

/**
 * Listen to a Tauri event
 */
export async function listenToEvent<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return listen<T>(event, (event) => {
    handler(event.payload);
  });
}

/**
 * Batch invoke multiple commands
 */
export async function invokeCommands<T extends readonly unknown[]>(
  commands: { command: string; args?: Record<string, unknown> }[]
): Promise<CommandResult<T[number]>[]> {
  return Promise.all(
    commands.map(({ command, args }) => invokeCommand(command, args))
  );
}
