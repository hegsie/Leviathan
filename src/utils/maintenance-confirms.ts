/**
 * Shared confirmations for repository maintenance operations.
 *
 * `git gc` and `git prune` are reachable from BOTH the command palette
 * (app-shell) and the Repository Health dialog. They were previously gated in
 * only one of those places, so the same irreversible operation was guarded on
 * one surface and one click away on the other. Keeping the gate and its copy
 * here means both surfaces cannot drift apart again.
 */

import { showConfirm } from '../services/dialog.service.ts';

/**
 * Confirm a `git gc` run.
 *
 * Deliberately narrower than the prune wording: run_gc passes no `--prune`, so
 * git applies its own grace periods (`gc.pruneExpire`, 2 weeks by default, and
 * `gc.reflogExpireUnreachable`, 30 days). A stash dropped minutes ago survives
 * this, and claiming otherwise would train users to dismiss the warning.
 */
export function confirmGarbageCollection(aggressive: boolean): Promise<boolean> {
  return showConfirm(
    aggressive ? 'Run Garbage Collection (Aggressive)' : 'Run Garbage Collection',
    'This repacks the repository and removes unreachable objects that are past ' +
      "git's grace period (2 weeks by default), along with expired reflog " +
      'entries. Recently dropped stashes and deleted branches are not affected. ' +
      'Continue?',
    'warning'
  );
}

/**
 * Confirm a `git prune` run.
 *
 * Unlike gc, bare `git prune` has no expiry — it removes every unreachable
 * object immediately, including work dropped seconds ago, so the stronger
 * wording here is accurate.
 */
export function confirmPrune(): Promise<boolean> {
  return showConfirm(
    'Prune Unreachable Objects',
    'This permanently deletes unreachable objects with no grace period. Work ' +
      'recoverable only through the reflog — dropped stashes, deleted ' +
      'branches, amended commits — will become unrecoverable. Continue?',
    'warning'
  );
}

/**
 * Condense `git fsck` output for a toast.
 *
 * `git fsck --full` prints one line per dangling/unreachable object, which on a
 * repo with rebased or amended history is dozens of lines. A toast is ~400px
 * wide with no max-height and auto-dismisses, so dumping that raw makes it both
 * unreadable and large enough to cover the view. Lead with the count instead.
 *
 * Shared by the command palette and the Repository Health dialog: they reach
 * the same command, so summarising only one of them left the problem reachable.
 */
export function summariseFsck(message: string | undefined): string {
  const text = (message ?? '').trim();
  if (!text) return 'Repository integrity check completed';

  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= 2 && text.length <= 200) return text;

  return `Repository integrity check completed — ${lines.length} notes reported (${lines[0].trim()}, …)`;
}

/**
 * Which repositories currently have a maintenance command running.
 *
 * `gc`, `prune` and `fsck` each have TWO implementations — the command palette
 * (app-shell) and the Repository Health dialog — and only the dialog tracked
 * whether one was already running. So a palette "Run Garbage Collection"
 * launched a second concurrent gc over the dialog's, defeating the
 * runningAction machinery entirely. For gc-vs-gc git's own pid lock rejects
 * the second with a raw, unhelpful error; for gc-vs-prune there is no such
 * serialization at all and the two race on the objects directory.
 *
 * Keyed by repository path: maintenance on different repos is independent.
 */
const maintenanceInFlight = new Set<string>();

/** Claim the maintenance slot for a repo. False when one is already running. */
export function tryAcquireMaintenance(repoPath: string): boolean {
  if (maintenanceInFlight.has(repoPath)) return false;
  maintenanceInFlight.add(repoPath);
  return true;
}

/** Release the slot. Safe to call for a repo that never held one. */
export function releaseMaintenance(repoPath: string): void {
  maintenanceInFlight.delete(repoPath);
}

/** True while a maintenance command is running against `repoPath`. */
export function isMaintenanceRunning(repoPath: string): boolean {
  return maintenanceInFlight.has(repoPath);
}

/** Test seam: drop all claims. */
export function resetMaintenanceLocks(): void {
  maintenanceInFlight.clear();
}
