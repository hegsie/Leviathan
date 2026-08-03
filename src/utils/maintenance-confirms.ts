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
