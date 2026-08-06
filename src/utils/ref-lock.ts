/**
 * The working-tree lock for ref operations, shared across every surface.
 *
 * Two disjoint locks used to guard the same commands: app-shell held
 * `refOperationsInFlight` for the graph ref menu, the commit context menu and
 * the command palette, while `lv-branch-list`, `lv-tag-list` and
 * `lv-stash-list` each held their own component-local `operationInProgress`.
 * Nothing passed a busy signal between them — `<lv-left-panel>` is rendered
 * with no props at all — so a hard reset started from the graph and a
 * double-clicked sidebar checkout ran concurrently against the same working
 * tree. There is no per-repo lock in the backend (every command opens its own
 * git2 handle), and the backend's own state guards only refuse when the repo
 * is mid-merge/rebase — two operations on a Clean repo are not caught. The
 * auto-stash checkout is the worst case: it saves, applies and drops by
 * position, so a concurrent reset lands on the just-applied tree with the
 * stash entry already gone.
 *
 * This is the same hoist `maintenance-confirms.ts` already did for gc/prune,
 * and it is keyed by repository path for the same reason: separate repos have
 * separate working trees and nothing to serialize against each other.
 */
const refOpsInFlight = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** Claim the ref-operation slot for a repo. False when one is already running. */
export function tryAcquireRefOp(repoPath: string): boolean {
  if (refOpsInFlight.has(repoPath)) return false;
  refOpsInFlight.add(repoPath);
  notify();
  return true;
}

/** Release the slot. Safe to call for a repo that never held one. */
export function releaseRefOp(repoPath: string): void {
  if (refOpsInFlight.delete(repoPath)) notify();
}

/** True while a ref operation is running against `repoPath`. */
export function isRefOpRunning(repoPath: string | undefined): boolean {
  return repoPath !== undefined && refOpsInFlight.has(repoPath);
}

/**
 * Re-render on every claim and release.
 *
 * Components bind `?disabled` to `isRefOpRunning`, which is plain module state
 * Lit cannot observe. Returns the unsubscribe function for
 * `disconnectedCallback`.
 */
export function subscribeRefOps(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test seam: drop all claims and listeners. */
export function resetRefOpLocks(): void {
  refOpsInFlight.clear();
  listeners.clear();
}
