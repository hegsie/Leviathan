/**
 * The working-tree lock is shared across every surface.
 *
 * app-shell and the three sidebar lists used to hold two disjoint locks over
 * the same commands, so a hard reset started from the graph and a checkout
 * started from the sidebar ran concurrently against the same working tree.
 * The backend takes no per-repo lock, and its own state guards only refuse
 * when the repo is mid-merge/rebase — two operations on a Clean repo are not
 * caught.
 */
import { expect } from '@open-wc/testing';
import {
  tryAcquireRefOp,
  releaseRefOp,
  isRefOpRunning,
  subscribeRefOps,
  resetRefOpLocks,
} from '../ref-lock.ts';

describe('the shared ref-operation lock', () => {
  beforeEach(() => {
    resetRefOpLocks();
  });

  afterEach(() => {
    resetRefOpLocks();
  });

  it('refuses a second claim on the same repo', () => {
    expect(tryAcquireRefOp('/repo/one')).to.equal(true);
    expect(tryAcquireRefOp('/repo/one'), 'a second surface must be refused').to.equal(false);
  });

  it('lets a different repo claim independently', () => {
    expect(tryAcquireRefOp('/repo/one')).to.equal(true);
    expect(
      tryAcquireRefOp('/repo/two'),
      'separate repos have separate working trees',
    ).to.equal(true);
  });

  it('releases only the repo it was given', () => {
    tryAcquireRefOp('/repo/one');
    tryAcquireRefOp('/repo/two');

    releaseRefOp('/repo/two');

    expect(isRefOpRunning('/repo/one'), 'the other repo stays locked').to.equal(true);
    expect(isRefOpRunning('/repo/two')).to.equal(false);
  });

  it('allows a fresh claim after release', () => {
    tryAcquireRefOp('/repo/one');
    releaseRefOp('/repo/one');
    expect(tryAcquireRefOp('/repo/one'), 'a stuck lock would freeze the repo').to.equal(true);
  });

  it('reports an undefined path as unlocked', () => {
    expect(isRefOpRunning(undefined)).to.equal(false);
  });

  it('notifies subscribers on claim and release, so ?disabled re-renders', () => {
    let calls = 0;
    const unsubscribe = subscribeRefOps(() => {
      calls++;
    });

    tryAcquireRefOp('/repo/one');
    expect(calls, 'claim notifies').to.equal(1);

    tryAcquireRefOp('/repo/one');
    expect(calls, 'a refused claim changes nothing').to.equal(1);

    releaseRefOp('/repo/one');
    expect(calls, 'release notifies').to.equal(2);

    releaseRefOp('/repo/one');
    expect(calls, 'releasing an unheld lock changes nothing').to.equal(2);

    unsubscribe();
    tryAcquireRefOp('/repo/one');
    expect(calls, 'unsubscribed listeners stop firing').to.equal(2);
  });
});
