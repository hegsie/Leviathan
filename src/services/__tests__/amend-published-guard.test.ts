/**
 * Amending a commit that is already on the remote must ask first.
 *
 * Amend rewrites HEAD. When HEAD is already published, that rewrites history
 * the remote — and everyone else — already has: the branch and its upstream
 * diverge, the next push is rejected, and the only way on is a force push that
 * discards whatever anyone based on that commit.
 *
 * No amend surface said so: not the commit panel's Amend checkbox, not the
 * graph's Quick Amend, not the reword-HEAD route. All three go through
 * createCommit, which is where the confirm lives, so none of them can be
 * forgotten.
 */

let cbId = 0;
let published = false;
const invoked: Array<{ command: string; args: unknown }> = [];

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invoked.push({ command, args });
    if (command === 'is_head_published') return Promise.resolve(published);
    if (command === 'create_commit') return Promise.resolve({ shortId: 'abc1234' });
    // showConfirm goes through the dialog plugin, so answering it here keeps
    // the real service in the path rather than stubbing it out.
    // The plugin's confirm() resolves by comparing this result to the OK
    // button label, so a bare boolean would always read as "cancelled".
    if (command.startsWith('plugin:dialog|')) {
      confirmCalls++;
      return Promise.resolve(confirmAnswer ? 'Ok' : 'Cancel');
    }
    return Promise.resolve(null);
  },
  transformCallback: () => cbId++,
};

let confirmAnswer = true;
let confirmCalls = 0;

import { expect } from '@open-wc/testing';
import { createCommit, isNetworkGateRefusal } from '../git.service.ts';

const REPO = '/test/repo';

function ranCreateCommit(): boolean {
  return invoked.some((c) => c.command === 'create_commit');
}

describe('amending a published commit', () => {
  beforeEach(() => {
    invoked.length = 0;
    confirmCalls = 0;
    confirmAnswer = true;
    published = false;
  });

  it('does not ask when the commit is only local', async () => {
    published = false;
    await createCommit(REPO, { message: 'x', amend: true });

    expect(confirmCalls, 'an unpublished amend is routine — do not nag').to.equal(0);
    expect(ranCreateCommit()).to.be.true;
  });

  it('does not ask for an ordinary commit, even on a published branch', async () => {
    published = true;
    await createCommit(REPO, { message: 'x' });

    expect(confirmCalls, 'only amend rewrites history').to.equal(0);
    expect(ranCreateCommit()).to.be.true;
  });

  it('asks before amending a commit that is already pushed', async () => {
    published = true;
    confirmAnswer = true;
    await createCommit(REPO, { message: 'x', amend: true });

    expect(confirmCalls, 'rewriting published history must be confirmed').to.equal(1);
    expect(ranCreateCommit(), 'confirming proceeds').to.be.true;
  });

  // The commit panel assigns result.error.message straight into its red error
  // banner. A declined confirm is the user's own decision, so it must carry the
  // shape isNetworkGateRefusal recognises — otherwise declining the warning
  // reports their own click back to them as a failure.
  it('declines with the refusal shape callers already suppress', async () => {
    published = true;
    confirmAnswer = false;
    const result = await createCommit(REPO, { message: 'x', amend: true });

    expect(result.error?.code).to.equal('CANCELLED');
    expect(
      isNetworkGateRefusal(result.error),
      'a decline must be recognised as a refusal, not reported as an error',
    ).to.be.true;
  });

  it('does not amend when the user declines', async () => {
    published = true;
    confirmAnswer = false;
    const result = await createCommit(REPO, { message: 'x', amend: true });

    expect(confirmCalls).to.equal(1);
    expect(ranCreateCommit(), 'declining must not rewrite anything').to.be.false;
    expect(result.success).to.be.false;
  });
});
