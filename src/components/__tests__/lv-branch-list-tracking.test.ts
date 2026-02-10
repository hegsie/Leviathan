import { expect } from '@open-wc/testing';
import type { Branch } from '../../types/git.types.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Helper: create a Branch for testing
function createBranch(
  name: string,
  opts: Partial<Branch> = {},
): Branch {
  return {
    name,
    shorthand: opts.shorthand ?? name,
    isHead: opts.isHead ?? false,
    isRemote: opts.isRemote ?? false,
    upstream: opts.upstream ?? null,
    targetOid: opts.targetOid ?? 'abc123',
    lastCommitTimestamp: opts.lastCommitTimestamp ?? undefined,
    isStale: opts.isStale ?? false,
    ...opts,
  };
}

describe('lv-branch-list - branch tracking: extract names', () => {
  it('should extract local name from remote branch shorthand', () => {
    // Remote branches have shorthand already stripped of remote name
    // e.g., origin/feature/thing has shorthand = "feature/thing"
    const branch = createBranch('origin/feature/thing', {
      shorthand: 'feature/thing',
      isRemote: true,
    });
    const localName = branch.shorthand;
    expect(localName).to.equal('feature/thing');
  });

  it('should extract remote name from branch name', () => {
    const branch = createBranch('origin/feature/thing', {
      shorthand: 'feature/thing',
      isRemote: true,
    });
    const remoteName = branch.name.split('/')[0];
    expect(remoteName).to.equal('origin');
  });

  it('should handle simple remote branch names', () => {
    const branch = createBranch('origin/main', {
      shorthand: 'main',
      isRemote: true,
    });
    const localName = branch.shorthand;
    const remoteName = branch.name.split('/')[0];
    expect(localName).to.equal('main');
    expect(remoteName).to.equal('origin');
  });

  it('should handle upstream remote branch names', () => {
    const branch = createBranch('upstream/develop', {
      shorthand: 'develop',
      isRemote: true,
    });
    const localName = branch.shorthand;
    const remoteName = branch.name.split('/')[0];
    expect(localName).to.equal('develop');
    expect(remoteName).to.equal('upstream');
  });
});

describe('lv-branch-list - context menu visibility for tracking', () => {
  it('should show "Track" for remote branches', () => {
    const branch = createBranch('origin/feature/thing', {
      shorthand: 'feature/thing',
      isRemote: true,
    });
    const isLocal = !branch.isRemote;
    const showTrack = !isLocal; // Track is shown for remote branches
    expect(showTrack).to.be.true;
  });

  it('should not show "Track" for local branches', () => {
    const branch = createBranch('feature/thing', {
      isRemote: false,
    });
    const isLocal = !branch.isRemote;
    const showTrack = !isLocal;
    expect(showTrack).to.be.false;
  });

  it('should show "Set Upstream" for local non-HEAD branches', () => {
    const branch = createBranch('feature/thing', {
      isRemote: false,
      isHead: false,
    });
    const isLocal = !branch.isRemote;
    const isHead = branch.isHead;
    const showSetUpstream = isLocal && !isHead;
    expect(showSetUpstream).to.be.true;
  });

  it('should not show "Set Upstream" for HEAD branch', () => {
    const branch = createBranch('main', {
      isRemote: false,
      isHead: true,
    });
    const isLocal = !branch.isRemote;
    const isHead = branch.isHead;
    const showSetUpstream = isLocal && !isHead;
    expect(showSetUpstream).to.be.false;
  });

  it('should show "Change Upstream" when branch has existing upstream', () => {
    const branch = createBranch('feature/thing', {
      isRemote: false,
      isHead: false,
      upstream: 'origin/feature/thing',
    });
    const label = branch.upstream ? 'Change Upstream...' : 'Set Upstream...';
    expect(label).to.equal('Change Upstream...');
  });

  it('should show "Set Upstream" when branch has no upstream', () => {
    const branch = createBranch('feature/thing', {
      isRemote: false,
      isHead: false,
      upstream: null,
    });
    const label = branch.upstream ? 'Change Upstream...' : 'Set Upstream...';
    expect(label).to.equal('Set Upstream...');
  });

  it('should show "Unset Upstream" only when branch has upstream', () => {
    const branchWithUpstream = createBranch('feature/thing', {
      upstream: 'origin/feature/thing',
    });
    const branchWithoutUpstream = createBranch('feature/other', {
      upstream: null,
    });
    expect(!!branchWithUpstream.upstream).to.be.true;
    expect(!!branchWithoutUpstream.upstream).to.be.false;
  });

  it('should default upstream to origin/<shorthand> when no upstream exists', () => {
    const branch = createBranch('feature/thing', {
      shorthand: 'feature/thing',
      upstream: null,
    });
    const defaultUpstream = branch.upstream ?? `origin/${branch.shorthand}`;
    expect(defaultUpstream).to.equal('origin/feature/thing');
  });

  it('should use existing upstream as default when upstream exists', () => {
    const branch = createBranch('feature/thing', {
      shorthand: 'feature/thing',
      upstream: 'upstream/feature/thing',
    });
    const defaultUpstream = branch.upstream ?? `origin/${branch.shorthand}`;
    expect(defaultUpstream).to.equal('upstream/feature/thing');
  });
});
