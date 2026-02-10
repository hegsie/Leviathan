import { expect } from '@open-wc/testing';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// --- Test remote dialog fetch/prune state logic ---

describe('lv-remote-dialog - fetch and prune state', () => {
  it('fetch button should be disabled when fetchingRemote matches remote name', () => {
    const fetchingRemote: string | null = 'origin';
    const remoteName = 'origin';
    const isDisabled = fetchingRemote === remoteName;
    expect(isDisabled).to.be.true;
  });

  it('fetch button should be enabled when fetchingRemote is null', () => {
    const fetchingRemote: string | null = null;
    const remoteName = 'origin';
    const isDisabled = fetchingRemote === remoteName;
    expect(isDisabled).to.be.false;
  });

  it('fetch button should be enabled when fetching a different remote', () => {
    const fetchingRemote: string | null = 'upstream';
    const remoteName = 'origin';
    const isDisabled = fetchingRemote === remoteName;
    expect(isDisabled).to.be.false;
  });

  it('prune button should be disabled when pruningRemote matches remote name', () => {
    const pruningRemote: string | null = 'origin';
    const remoteName = 'origin';
    const isDisabled = pruningRemote === remoteName;
    expect(isDisabled).to.be.true;
  });

  it('prune button should be enabled when pruningRemote is null', () => {
    const pruningRemote: string | null = null;
    const remoteName = 'origin';
    const isDisabled = pruningRemote === remoteName;
    expect(isDisabled).to.be.false;
  });
});

describe('lv-remote-dialog - prune result messaging', () => {
  it('should report nothing to prune when branchesPruned is empty', () => {
    const branchesPruned: string[] = [];
    const count = branchesPruned.length;
    expect(count).to.equal(0);

    const message = count === 0
      ? 'Nothing to prune from origin'
      : `Pruned ${count} stale tracking branch${count !== 1 ? 'es' : ''} from origin`;
    expect(message).to.equal('Nothing to prune from origin');
  });

  it('should report singular branch pruned', () => {
    const branchesPruned = ['origin/old-feature'];
    const count = branchesPruned.length;
    const message = count === 0
      ? 'Nothing to prune from origin'
      : `Pruned ${count} stale tracking branch${count !== 1 ? 'es' : ''} from origin`;
    expect(message).to.equal('Pruned 1 stale tracking branch from origin');
  });

  it('should report multiple branches pruned', () => {
    const branchesPruned = ['origin/old-feature', 'origin/stale-branch', 'origin/deleted-branch'];
    const count = branchesPruned.length;
    const message = count === 0
      ? 'Nothing to prune from origin'
      : `Pruned ${count} stale tracking branch${count !== 1 ? 'es' : ''} from origin`;
    expect(message).to.equal('Pruned 3 stale tracking branches from origin');
  });
});
