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
  tryAcquireRefOpOrWarn,
  tryAcquirePush,
  releasePush,
  isPushRunning,
  pushTagKey,
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

  it('reports the refusal when claimed via the OrWarn variant', () => {
    // The sidebar components hold this lock through their own claimOperation
    // helpers and returned silently, so a gesture with no disabled binding —
    // a double-clicked branch row — looked like a hung app for the whole
    // duration of the other operation.
    expect(tryAcquireRefOpOrWarn('/repo/one')).to.equal(true);
    expect(tryAcquireRefOpOrWarn('/repo/one'), 'second claim refused').to.equal(false);
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

describe('the shared push slot', () => {
  beforeEach(() => {
    resetRefOpLocks();
  });

  afterEach(() => {
    resetRefOpLocks();
  });

  // app-shell holds this across the "this replaces <branch> on the remote"
  // confirm precisely so a plain push cannot race the force push the user is
  // authorising. It only works if every push surface can see the same slot.
  it('makes push and force push on one repo mutually exclusive', () => {
    expect(tryAcquirePush('/repo/one')).to.be.true;
    expect(tryAcquirePush('/repo/one'), 'a second push must be refused').to.be.false;
    expect(isPushRunning('/repo/one')).to.be.true;

    releasePush('/repo/one');
    expect(isPushRunning('/repo/one')).to.be.false;
    expect(tryAcquirePush('/repo/one')).to.be.true;
  });

  it('does not let one repo block another', () => {
    expect(tryAcquirePush('/repo/one')).to.be.true;
    expect(tryAcquirePush('/repo/two'), 'separate repos push independently').to.be.true;
  });

  // Force Push Tag held a key private to app-shell, which neither the sidebar's
  // Push nor the graph ref menu's Push Tag could see — so a click on either
  // pushed the tag out from under the force push sitting on its confirm.
  it('makes push tag and force push tag on the SAME tag mutually exclusive', () => {
    const key = pushTagKey('/repo/one', 'v1.0.0');
    expect(tryAcquirePush(key)).to.be.true;
    expect(tryAcquirePush(pushTagKey('/repo/one', 'v1.0.0'))).to.be.false;

    releasePush(key);
    expect(tryAcquirePush(key)).to.be.true;
  });

  it('keeps different tags, and tags vs branches, independent', () => {
    expect(tryAcquirePush(pushTagKey('/repo/one', 'v1.0.0'))).to.be.true;
    expect(
      tryAcquirePush(pushTagKey('/repo/one', 'v2.0.0')),
      'pushing a different tag is unrelated'
    ).to.be.true;
    expect(
      tryAcquirePush('/repo/one'),
      'a branch push is not blocked by a tag push'
    ).to.be.true;
  });

  it('notifies subscribers so bound controls re-render', () => {
    let calls = 0;
    const unsubscribe = subscribeRefOps(() => {
      calls++;
    });
    tryAcquirePush('/repo/one');
    expect(calls, 'a claim notifies').to.equal(1);
    releasePush('/repo/one');
    expect(calls, 'and so does the release').to.equal(2);
    unsubscribe();
  });
});
