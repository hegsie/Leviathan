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
