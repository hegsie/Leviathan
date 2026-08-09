import { showToast } from '../services/notification.service.ts';

/**
 * The contract every repo-scoped dialog implements.
 *
 * `pinnedRepositoryPathIfOpen` is the repo the dialog captured when it opened
 * (its live `repositoryPath` prop rebinds on Ctrl+Tab, so operations must use
 * the pinned one). `operationInFlight` is the dialog's OWN in-flight guard —
 * the same flag its `dismiss()` / `handleModalClose()` consults to refuse a
 * user-initiated close mid-operation.
 */
export interface RepoScopedDialogElement extends Element {
  readonly pinnedRepositoryPathIfOpen?: string | null;
  readonly operationInFlight?: boolean;
  close?: () => void;
  /**
   * Optional: dismiss now if idle, else as soon as the running work lands.
   * Dialogs whose element is DESTROYED on close (rather than hidden) implement
   * this so the sweep does not orphan a running operation.
   */
  closeWhenIdle?: () => void;
}

export interface RepoScopedDialogSweepEntry {
  /** Said when the dialog really was dismissed: `… — clean cancelled`. */
  dismissed: string;
  /** Names the running work: `… — the clean is still running …`. */
  running: string;
  /**
   * Clears the host `@state()` flag gating this dialog's render block, when
   * the dialog is driven by one instead of by its own `close()`.
   */
  clearFlag?: () => void;
}

/**
 * Every repo-scoped dialog element under `root`, DISCOVERED FROM THE DOM.
 *
 * Deliberately not a hand-written list of tag names: every previous sweep here
 * was one, and every one of them went stale the next time a dialog was added —
 * which is exactly how eight destructive dialogs ended up announcing
 * cancellations that never happened. A dialog that exposes the contract is
 * swept the moment it is rendered, whether or not anyone remembered it.
 */
export function collectRepoScopedDialogs(root: ParentNode): RepoScopedDialogElement[] {
  return Array.from(root.querySelectorAll('*')).filter(
    (el): el is RepoScopedDialogElement => 'pinnedRepositoryPathIfOpen' in el
  );
}

/**
 * Dismiss every open dialog pinned to a repository whose tab has been closed.
 *
 * The invariant: **never announce a dismissal that did not happen.** A dialog
 * with work in flight is left alone (closing it would hide a running
 * destructive operation behind a "cancelled" toast while it goes on deleting)
 * and the toast says so instead.
 */
export function sweepRepoScopedDialogs(options: {
  root: ParentNode;
  /** Is this path still in the tab bar? */
  isRepoOpen: (path: string) => boolean;
  /** False when the LAST tab just closed — the host unmounts every dialog. */
  hostHasRepositories: boolean;
  entries: Record<string, RepoScopedDialogSweepEntry>;
}): void {
  const { root, isRepoOpen, hostHasRepositories, entries } = options;

  for (const el of collectRepoScopedDialogs(root)) {
    const pinned = el.pinnedRepositoryPathIfOpen ?? null;
    if (!pinned || isRepoOpen(pinned)) continue;

    const entry = entries[el.tagName.toLowerCase()] ?? {
      dismissed: 'the dialog was closed',
      running: 'operation',
    };

    if (el.operationInFlight) {
      // The dialog refuses its own dismissal while this is set, so forcing it
      // shut here would bypass that guard — the operation would keep running
      // with no surface behind a toast claiming it was cancelled. Hand the
      // close over where the dialog supports deferring it, and either way say
      // what is actually true.
      el.closeWhenIdle?.();
      if (!hostHasRepositories) {
        // Last tab: the host's own render gate unmounts every repo-scoped
        // dialog on the next render regardless, so promising a later dismissal
        // would describe something that just did not happen. The work itself
        // runs to completion.
        entry.clearFlag?.();
        showToast(
          `The repository tab was closed — the ${entry.running} will finish in the background`,
          'warning'
        );
      } else if (el.closeWhenIdle) {
        showToast(
          `The repository tab was closed — the ${entry.running} is still running; the dialog will close when it finishes`,
          'warning'
        );
      } else {
        showToast(
          `The repository tab was closed — the ${entry.running} is still running against the closed repository and cannot be stopped`,
          'warning'
        );
      }
      // The flag stays set: clearing it unmounts the dialog and orphans the
      // operation, which is the whole failure this guard exists to stop.
      continue;
    }

    (el.close ?? el.closeWhenIdle)?.call(el);
    entry.clearFlag?.();
    showToast(`The repository tab was closed — ${entry.dismissed}`, 'warning');
  }
}
