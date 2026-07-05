/**
 * Tauri API wrapper for IPC communication
 * Provides type-safe command invocation and event listening
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CommandResult } from '../types/api.types.ts';
import { logGitCommand, shouldLogToOutput } from './output-log.service.ts';

/**
 * Invoke a Tauri command with type safety
 */
export async function invokeCommand<T, A = unknown>(
  command: string,
  args?: A
): Promise<CommandResult<T>> {
  // Repo git commands carry the repository path so the output panel can scope
  // entries per repository in multi-repo sessions. Most commands pass it as
  // `path`, but a few (stage_hunk/unstage_hunk) pass it as `repoPath` — check
  // both so their entries are scoped to the right repo and survive a scoped Clear.
  const argsRecord = args as Record<string, unknown> | undefined;
  const repoPath =
    typeof argsRecord?.path === 'string'
      ? (argsRecord.path as string)
      : typeof argsRecord?.repoPath === 'string'
        ? (argsRecord.repoPath as string)
        : undefined;

  try {
    const data = await invoke<T>(command, args as Record<string, unknown>);
    // Args are intentionally never logged — they can carry credentials
    if (shouldLogToOutput(command)) {
      logGitCommand(command, '', true, repoPath);
    }
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

    if (shouldLogToOutput(command)) {
      logGitCommand(command, message, false, repoPath);
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
