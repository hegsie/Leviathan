/**
 * Maintenance takes the exclusive working-tree lock — except when it is
 * read-only.
 *
 * `git prune` runs with no --expire, so it must serialize against anything
 * writing objects. `git fsck --full` writes nothing and can run for minutes;
 * routing it through the same claim froze every destructive control, including
 * the operation banner's Abort, with no progress indicator to explain why.
 */
import { expect } from '@open-wc/testing';
import {
  tryAcquireMaintenance,
  tryAcquireMaintenanceReadOnly,
  releaseMaintenance,
  isMaintenanceBlocked,
  resetMaintenanceLocks,
} from '../maintenance-confirms.ts';
import { isRefOpRunning, tryAcquireRefOp, resetRefOpLocks } from '../ref-lock.ts';

describe('the maintenance lock and the working-tree lock', () => {
  beforeEach(() => {
    resetMaintenanceLocks();
    resetRefOpLocks();
  });

  afterEach(() => {
    resetMaintenanceLocks();
    resetRefOpLocks();
  });

  it('gc/prune take the working-tree lock, so a concurrent write is refused', () => {
    expect(tryAcquireMaintenance('/repo/one')).to.equal(true);
    expect(
      isRefOpRunning('/repo/one'),
      'prune deletes unreachable objects a concurrent stash has just written',
    ).to.equal(true);

    releaseMaintenance('/repo/one');
    expect(isRefOpRunning('/repo/one'), 'released with the slot').to.equal(false);
  });

  it('a working-tree operation blocks gc/prune', () => {
    tryAcquireRefOp('/repo/one');
    expect(tryAcquireMaintenance('/repo/one')).to.equal(false);
    expect(
      isMaintenanceBlocked('/repo/one'),
      'the pre-confirm check must agree with the claim, or the user reads a ' +
        'destructive warning for a run that was always going to be refused',
    ).to.equal(true);
  });

  it('fsck claims the slot WITHOUT freezing the working tree', () => {
    expect(tryAcquireMaintenanceReadOnly('/repo/one')).to.equal(true);
    expect(
      isRefOpRunning('/repo/one'),
      'a read-only check must not grey out Abort for minutes',
    ).to.equal(false);
    // It still excludes other maintenance.
    expect(tryAcquireMaintenance('/repo/one')).to.equal(false);

    releaseMaintenance('/repo/one');
    expect(tryAcquireMaintenance('/repo/one'), 'slot freed').to.equal(true);
  });

  it('releasing a read-only claim does not free someone else\'s working-tree lock', () => {
    tryAcquireRefOp('/repo/one');
    // fsck cannot claim while maintenance is free but a ref op runs? It can —
    // fsck only excludes other maintenance.
    expect(tryAcquireMaintenanceReadOnly('/repo/one')).to.equal(true);

    releaseMaintenance('/repo/one');

    expect(
      isRefOpRunning('/repo/one'),
      'the ref op it never claimed must still be held',
    ).to.equal(true);
  });
});
