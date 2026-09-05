/**
 * Real `git` invocations from the backend.
 *
 * A large share of the app's operations shell out to the git CLI — interactive
 * rebase, force push, difftool/mergetool, GPG signing, LFS, maintenance. Those
 * runs have a REAL command line and real stdout/stderr, and
 * `src-tauri/src/utils/command.rs` reports each of them on the
 * `git-command-executed` event. This service carries them into the Output
 * panel's log, where they appear as executed commands (never marked
 * synthesised) alongside the git2 equivalents.
 *
 * Redaction happens in the backend, on the command line and on the captured
 * output, before the event is emitted — see `redact_secrets` there.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logGitCommand } from './output-log.service.ts';

/** Payload of the backend's `git-command-executed` event. */
export interface GitCommandExecutedEvent {
  /** The effective, already-redacted command line (e.g. `git push --force origin main`) */
  command: string;
  /** Combined stderr/stdout of the run, already redacted and truncated */
  output: string;
  success: boolean;
  durationMs: number;
  repoPath?: string | null;
}

/**
 * Record one backend git invocation in the output log.
 *
 * Split out from the listener so the mapping is testable without a Tauri event
 * bridge — the listener below is a one-line adapter onto this.
 */
export function recordGitCommandEvent(payload: GitCommandExecutedEvent): void {
  const { command, output, success, durationMs, repoPath } = payload;
  logGitCommand(command, output ?? '', success, {
    repoPath: repoPath ?? undefined,
    gitCommand: command,
    // This command really ran. Never marked synthesised — that flag is what
    // tells the user the difference between "git did this" and "this is the
    // equivalent of what libgit2 did".
    synthesized: false,
    durationMs,
  });
}

let unlisten: UnlistenFn | undefined;
let starting: Promise<void> | undefined;

/**
 * Start recording backend git invocations into the output log.
 *
 * Idempotent: a second call while a listener is attached (or being attached)
 * is a no-op, so the panel can never show one command twice.
 */
export async function startGitCommandLogging(): Promise<void> {
  if (unlisten || starting) {
    return starting;
  }

  starting = listen<GitCommandExecutedEvent>('git-command-executed', (event) => {
    recordGitCommandEvent(event.payload);
  })
    .then((fn) => {
      unlisten = fn;
    })
    .catch(() => {
      // No Tauri event bridge (unit tests, plain browser). The panel still
      // shows the git2 equivalents recorded by the IPC layer.
    })
    .finally(() => {
      starting = undefined;
    });

  return starting;
}

/** Stop recording backend git invocations. */
export function stopGitCommandLogging(): void {
  unlisten?.();
  unlisten = undefined;
}
