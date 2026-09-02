/**
 * Shared copy and remote follow-up for deleting a tag.
 *
 * Deleting a tag is reachable from BOTH the sidebar tag list and the graph's
 * ref context menu, and neither could do anything about the remote copy: the
 * fetch refspec `refs/tags/*:refs/tags/*` copies a pushed tag straight back,
 * so a local-only delete silently undid itself on the next fetch while the
 * confirm promised it "cannot be undone". Keeping the wording and the
 * follow-up here means the two surfaces cannot drift apart again.
 */

import * as gitService from '../services/git.service.ts';
import { showConfirm } from '../services/dialog.service.ts';
import { showToast } from '../services/notification.service.ts';
import { pushTagKey, tryAcquirePush, releasePush, warnRepositoryBusy } from './ref-lock.ts';

/** The local-delete confirm. Honest about what it does and does not remove. */
export function confirmDeleteTag(tagName: string): Promise<boolean> {
  return showConfirm(
    'Delete Tag',
    `Are you sure you want to delete tag "${tagName}"?\n\n` +
      'This removes it from this repository only and cannot be undone. If the ' +
      'tag was pushed, it stays on the remote and the next fetch restores it.',
    'warning'
  );
}

/**
 * Offer to delete the tag on the remote after a successful local delete.
 *
 * Silent no-op when the repo has no remote: there is nothing to ask about, and
 * the local delete already reported.
 *
 * A FAILED remote lookup is NOT the same as "no remotes" and must not be
 * collapsed into one: the local delete already toasted success, so silently
 * skipping the follow-up tells the user the tag is gone while the remote copy
 * survives and the tag fetch refspec restores it on the next fetch — exactly
 * the failure this follow-up exists to prevent. Warn instead.
 */
export async function offerRemoteTagDelete(repoPath: string, tagName: string): Promise<void> {
  const remotesResult = await gitService.getRemotes(repoPath);
  if (!remotesResult.success) {
    showToast(
      `Deleted tag ${tagName} locally, but the remote list could not be read — it may still exist on the remote`,
      'warning'
    );
    return;
  }
  const remotes = remotesResult.data ?? [];
  if (remotes.length === 0) return;
  // The remote push_tag targets by default, named so the confirm can say it.
  //
  // A failed resolve is NOT a dead end here: `resolve_push_remote` answers from
  // config and falls back to the literal "origin", so a stale
  // `remote.pushDefault`, or two remotes with no `origin` among them and no
  // push/upstream config, makes `get_push_remote` fail on a repo that plainly
  // has remotes. `remotes` was just read successfully, so fall back to the same
  // local pick this used before — dropping the follow-up would leave the user
  // with no surface at all for deleting the remote tag, and the next fetch
  // would restore it.
  const remoteResult = await gitService.getPushRemote(repoPath);
  const remote =
    remoteResult.success && remoteResult.data
      ? remoteResult.data
      : (remotes.find((r) => r.name === 'origin') ?? remotes[0]).name;

  // The SHARED tag-push key: this pushes a refspec for the same ref Push Tag
  // and Force Push Tag push, and it is held across the confirm so neither can
  // move the remote tag out from under the deletion being authorised.
  const tagKey = pushTagKey(repoPath, tagName);
  if (!tryAcquirePush(tagKey)) {
    warnRepositoryBusy();
    return;
  }

  try {
    const confirmed = await showConfirm(
      'Delete Tag on Remote',
      `Also delete tag "${tagName}" on "${remote}"?\n\n` +
        'Leaving it there means the next fetch copies it back into this repository.',
      'warning'
    );
    if (!confirmed) return;

    const result = await gitService.deleteRemoteTag({ path: repoPath, name: tagName, remote });
    if (result.success) {
      showToast(`Deleted tag ${tagName} on ${remote}`, 'success');
    } else if (!gitService.isNetworkGateRefusal(result.error)) {
      showToast(
        `Failed to delete tag ${tagName} on ${remote}: ${result.error?.message ?? 'Unknown error'}`,
        'error'
      );
    }
  } finally {
    releasePush(tagKey);
  }
}
