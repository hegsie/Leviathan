/**
 * Tauri API wrapper for IPC communication
 * Provides type-safe command invocation and event listening
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CommandResult } from '../types/api.types.ts';
import { logGitCommand, shouldLogToOutput } from './output-log.service.ts';
import { redactSecrets, synthesizeGitCommand } from './git-command-format.ts';

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

  // The equivalent `git` command line for the operations that run through
  // libgit2, so the Output panel shows a git invocation rather than an IPC
  // name. Args are STILL never logged wholesale — they can carry credentials.
  // `synthesizeGitCommand` reads an explicit per-command allowlist of fields
  // (never `token`) and redacts what it renders; anything it does not cover
  // falls back to the command name, exactly as before.
  const gitCommand = shouldLogToOutput(command)
    ? synthesizeGitCommand(command, args)
    : undefined;
  const startedAt = Date.now();

  try {
    const data = await invoke<T>(command, args as Record<string, unknown>);
    if (shouldLogToOutput(command)) {
      logGitCommand(command, '', true, {
        repoPath,
        gitCommand,
        synthesized: gitCommand !== undefined,
        durationMs: Date.now() - startedAt,
      });
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
      // Backend error messages routinely quote a remote URL, which can carry
      // `user:token@host` — scrub before it reaches the panel.
      logGitCommand(command, redactSecrets(message), false, {
        repoPath,
        gitCommand,
        synthesized: gitCommand !== undefined,
        durationMs: Date.now() - startedAt,
      });
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
