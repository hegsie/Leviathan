/**
 * The one wording for "the rebase stopped, and here is how to carry on".
 *
 * Two surfaces report a paused rebase: the interactive-rebase dialog when the
 * initial execute stops at an `edit`/`break`, and the conflict-resolution
 * dialog when `git rebase --continue` advances and stops again. They have now
 * drifted apart three times, and the drift is not cosmetic — the banner shows
 * only "Resolve Conflicts", "Abort" and (for bisect) "Manage Bisect". There is
 * no control named "Continue", so any message telling the user to "choose
 * Continue Rebase" without first naming Resolve Conflicts leaves Abort as the
 * most obvious button — and Abort discards the rebase this message exists to
 * protect.
 */
export const REBASE_PAUSED_MESSAGE =
  'Rebase paused — amend the commit, then click "Resolve Conflicts" ' +
  'in the banner and choose Continue Rebase';

/**
 * The one wording for "and it dropped N of your commits", shared by every
 * surface that finishes a rebase.
 *
 * A commit whose patch is already on the target is dropped by the rebase —
 * `git rebase` prints "warning: skipped previously applied commit <sha>" for
 * each. There is no stderr here, and without naming them the user sees the
 * same green success a clean rebase gets while their local commits are gone
 * from the branch. `pull --rebase` already reports this ("Rebased N commit(s),
 * skipped M already applied upstream"); the suffix is worded to match — the
 * noun included, because pull's sentence names `commit(s)` earlier and this
 * one has nothing else to say WHAT was skipped.
 */
export function skippedCommitsSuffix(skipped?: number | null): string {
  return skipped ? `, skipped ${skipped} commit(s) already applied upstream` : '';
}

/**
 * The one wording for "the rebase finished" across the four surfaces that
 * start one (branch context menu, the two drag-drop arms, and the graph's ref
 * menu).
 */
export function rebasedOntoMessage(
  target: string,
  skipped?: number | null
): string {
  return `Rebased onto ${target}${skippedCommitsSuffix(skipped)}`;
}
