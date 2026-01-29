import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;
const invokeHistory: Array<{ command: string; args: unknown }> = [];

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import {
  getBranches,
  createBranch,
  createOrphanBranch,
  deleteBranch,
  renameBranch,
  checkout,
  getBranchDiffCommits,
  setUpstreamBranch,
  unsetUpstreamBranch,
  getBranchTrackingInfo,
} from '../git.service.ts';

describe('git.service - Branch operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('getBranches', () => {
    it('invokes get_branches command with path', async () => {
      const mockBranches = [
        {
          name: 'refs/heads/main',
          shorthand: 'main',
          isHead: true,
          isRemote: false,
          upstream: null,
          targetOid: 'abc123',
          isStale: false,
        },
        {
          name: 'refs/heads/feature',
          shorthand: 'feature',
          isHead: false,
          isRemote: false,
          upstream: null,
          targetOid: 'def456',
          isStale: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockBranches);

      const result = await getBranches('/test/repo');
      expect(lastInvokedCommand).to.equal('get_branches');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns branches with tracking information', async () => {
      const mockBranches = [
        {
          name: 'refs/heads/main',
          shorthand: 'main',
          isHead: true,
          isRemote: false,
          upstream: 'refs/remotes/origin/main',
          targetOid: 'abc123',
          aheadBehind: { ahead: 2, behind: 1 },
          isStale: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockBranches);

      const result = await getBranches('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.[0].upstream).to.equal('refs/remotes/origin/main');
      expect(result.data?.[0].aheadBehind?.ahead).to.equal(2);
      expect(result.data?.[0].aheadBehind?.behind).to.equal(1);
    });

    it('returns local and remote branches', async () => {
      const mockBranches = [
        {
          name: 'refs/heads/main',
          shorthand: 'main',
          isHead: true,
          isRemote: false,
          upstream: null,
          targetOid: 'abc123',
          isStale: false,
        },
        {
          name: 'refs/remotes/origin/main',
          shorthand: 'origin/main',
          isHead: false,
          isRemote: true,
          upstream: null,
          targetOid: 'abc123',
          isStale: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockBranches);

      const result = await getBranches('/test/repo');
      expect(result.success).to.be.true;
      const localBranches = result.data?.filter((b) => !b.isRemote);
      const remoteBranches = result.data?.filter((b) => b.isRemote);
      expect(localBranches?.length).to.equal(1);
      expect(remoteBranches?.length).to.equal(1);
    });

    it('handles stale branches', async () => {
      const mockBranches = [
        {
          name: 'refs/heads/old-feature',
          shorthand: 'old-feature',
          isHead: false,
          isRemote: false,
          upstream: null,
          targetOid: 'xyz789',
          lastCommitTimestamp: Date.now() / 1000 - 100 * 24 * 60 * 60, // 100 days ago
          isStale: true,
        },
      ];
      mockInvoke = () => Promise.resolve(mockBranches);

      const result = await getBranches('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.[0].isStale).to.be.true;
    });

    it('handles repository not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPOSITORY_NOT_FOUND', message: 'Repository not found' });

      const result = await getBranches('/invalid/repo');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REPOSITORY_NOT_FOUND');
    });
  });

  describe('createBranch', () => {
    it('invokes create_branch with name only', async () => {
      const mockBranch = {
        name: 'refs/heads/new-feature',
        shorthand: 'new-feature',
        isHead: false,
        isRemote: false,
        upstream: null,
        targetOid: 'abc123',
        isStale: false,
      };
      mockInvoke = () => Promise.resolve(mockBranch);

      const result = await createBranch('/test/repo', { name: 'new-feature' });
      expect(lastInvokedCommand).to.equal('create_branch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('new-feature');
      expect(result.success).to.be.true;
    });

    it('invokes create_branch with startPoint', async () => {
      const mockBranch = {
        name: 'refs/heads/feature-from-commit',
        shorthand: 'feature-from-commit',
        isHead: false,
        isRemote: false,
        upstream: null,
        targetOid: 'def456',
        isStale: false,
      };
      mockInvoke = () => Promise.resolve(mockBranch);

      const result = await createBranch('/test/repo', {
        name: 'feature-from-commit',
        startPoint: 'def456',
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('feature-from-commit');
      expect(args.startPoint).to.equal('def456');
      expect(result.success).to.be.true;
    });

    it('invokes create_branch with checkout option', async () => {
      const mockBranch = {
        name: 'refs/heads/new-branch',
        shorthand: 'new-branch',
        isHead: true,
        isRemote: false,
        upstream: null,
        targetOid: 'abc123',
        isStale: false,
      };
      mockInvoke = () => Promise.resolve(mockBranch);

      const result = await createBranch('/test/repo', {
        name: 'new-branch',
        checkout: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.checkout).to.be.true;
      expect(result.data?.isHead).to.be.true;
    });

    it('creates branch from another branch', async () => {
      const mockBranch = {
        name: 'refs/heads/feature-from-develop',
        shorthand: 'feature-from-develop',
        isHead: false,
        isRemote: false,
        upstream: null,
        targetOid: 'xyz789',
        isStale: false,
      };
      mockInvoke = () => Promise.resolve(mockBranch);

      await createBranch('/test/repo', {
        name: 'feature-from-develop',
        startPoint: 'develop',
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.startPoint).to.equal('develop');
    });

    it('handles branch already exists error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_EXISTS', message: 'Branch already exists' });

      const result = await createBranch('/test/repo', { name: 'existing-branch' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_EXISTS');
    });

    it('handles invalid branch name error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_BRANCH_NAME', message: 'Invalid branch name' });

      const result = await createBranch('/test/repo', { name: '..invalid' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('INVALID_BRANCH_NAME');
    });
  });

  describe('deleteBranch', () => {
    it('invokes delete_branch with name', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await deleteBranch('/test/repo', 'old-branch');
      expect(lastInvokedCommand).to.equal('delete_branch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('old-branch');
      expect(result.success).to.be.true;
    });

    it('invokes delete_branch without force by default', async () => {
      mockInvoke = () => Promise.resolve(null);

      await deleteBranch('/test/repo', 'branch-to-delete');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.undefined;
    });

    it('invokes delete_branch with force option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await deleteBranch('/test/repo', 'unmerged-branch', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('handles cannot delete current branch error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'CANNOT_DELETE_CURRENT', message: 'Cannot delete current branch' });

      const result = await deleteBranch('/test/repo', 'main');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CANNOT_DELETE_CURRENT');
    });

    it('handles unmerged branch error without force', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_NOT_MERGED', message: 'Branch not fully merged' });

      const result = await deleteBranch('/test/repo', 'unmerged-feature');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_NOT_MERGED');
    });

    it('handles branch not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });

      const result = await deleteBranch('/test/repo', 'nonexistent');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_NOT_FOUND');
    });
  });

  describe('renameBranch', () => {
    it('invokes rename_branch with old and new names', async () => {
      const mockBranch = {
        name: 'refs/heads/new-name',
        shorthand: 'new-name',
        isHead: false,
        isRemote: false,
        upstream: null,
        targetOid: 'abc123',
        isStale: false,
      };
      mockInvoke = () => Promise.resolve(mockBranch);

      const result = await renameBranch('/test/repo', {
        oldName: 'old-name',
        newName: 'new-name',
      });
      expect(lastInvokedCommand).to.equal('rename_branch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.oldName).to.equal('old-name');
      expect(args.newName).to.equal('new-name');
      expect(result.success).to.be.true;
    });

    it('returns renamed branch', async () => {
      const mockBranch = {
        name: 'refs/heads/feature-v2',
        shorthand: 'feature-v2',
        isHead: true,
        isRemote: false,
        upstream: null,
        targetOid: 'def456',
        isStale: false,
      };
      mockInvoke = () => Promise.resolve(mockBranch);

      const result = await renameBranch('/test/repo', {
        oldName: 'feature-v1',
        newName: 'feature-v2',
      });
      expect(result.data?.shorthand).to.equal('feature-v2');
    });

    it('handles target name already exists error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_EXISTS', message: 'Branch already exists' });

      const result = await renameBranch('/test/repo', {
        oldName: 'feature',
        newName: 'main',
      });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_EXISTS');
    });

    it('handles source branch not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });

      const result = await renameBranch('/test/repo', {
        oldName: 'nonexistent',
        newName: 'new-name',
      });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_NOT_FOUND');
    });

    it('passes updateTracking parameter when provided', async () => {
      const mockBranch = {
        name: 'refs/heads/new-name',
        shorthand: 'new-name',
        isHead: false,
        isRemote: false,
        upstream: 'refs/remotes/origin/main',
        targetOid: 'abc123',
        isStale: false,
      };
      mockInvoke = () => Promise.resolve(mockBranch);

      const result = await renameBranch('/test/repo', {
        oldName: 'old-name',
        newName: 'new-name',
        updateTracking: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.updateTracking).to.be.true;
      expect(result.success).to.be.true;
    });

    it('passes updateTracking false to skip tracking update', async () => {
      const mockBranch = {
        name: 'refs/heads/new-name',
        shorthand: 'new-name',
        isHead: false,
        isRemote: false,
        upstream: null,
        targetOid: 'abc123',
        isStale: false,
      };
      mockInvoke = () => Promise.resolve(mockBranch);

      const result = await renameBranch('/test/repo', {
        oldName: 'old-name',
        newName: 'new-name',
        updateTracking: false,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.updateTracking).to.be.false;
      expect(result.success).to.be.true;
    });
  });

  describe('checkout', () => {
    it('invokes checkout with ref', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await checkout('/test/repo', { ref: 'feature-branch' });
      expect(lastInvokedCommand).to.equal('checkout');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.ref).to.equal('feature-branch');
      expect(result.success).to.be.true;
    });

    it('invokes checkout without force by default', async () => {
      mockInvoke = () => Promise.resolve(null);

      await checkout('/test/repo', { ref: 'main' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.undefined;
    });

    it('invokes checkout with force option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await checkout('/test/repo', { ref: 'main', force: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('can checkout a commit', async () => {
      mockInvoke = () => Promise.resolve(null);

      await checkout('/test/repo', { ref: 'abc123def456' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.ref).to.equal('abc123def456');
    });

    it('can checkout a tag', async () => {
      mockInvoke = () => Promise.resolve(null);

      await checkout('/test/repo', { ref: 'v1.0.0' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.ref).to.equal('v1.0.0');
    });

    it('handles local changes conflict error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'LOCAL_CHANGES_CONFLICT', message: 'Local changes would be overwritten' });

      const result = await checkout('/test/repo', { ref: 'feature' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('LOCAL_CHANGES_CONFLICT');
    });

    it('handles ref not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REF_NOT_FOUND', message: 'Reference not found' });

      const result = await checkout('/test/repo', { ref: 'nonexistent' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REF_NOT_FOUND');
    });
  });

  describe('getBranchDiffCommits', () => {
    it('invokes get_branch_diff_commits with correct arguments', async () => {
      const mockCommits = [
        {
          oid: 'abc123',
          shortId: 'abc1234',
          message: 'First commit',
          summary: 'First commit',
          body: null,
          author: { name: 'Test User', email: 'test@test.com', timestamp: 1700000000 },
          committer: { name: 'Test User', email: 'test@test.com', timestamp: 1700000000 },
          parentIds: ['def456'],
          timestamp: 1700000000,
        },
      ];
      mockInvoke = () => Promise.resolve(mockCommits);

      const result = await getBranchDiffCommits('/test/repo', 'feature', 'main');
      expect(lastInvokedCommand).to.equal('get_branch_diff_commits');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.branch).to.equal('feature');
      expect(args.baseBranch).to.equal('main');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('returns commits unique to feature branch', async () => {
      const mockCommits = [
        {
          oid: 'commit1',
          shortId: 'commit1',
          message: 'Feature commit 1',
          summary: 'Feature commit 1',
          body: null,
          author: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
          committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
          parentIds: [],
          timestamp: 1700000000,
        },
        {
          oid: 'commit2',
          shortId: 'commit2',
          message: 'Feature commit 2',
          summary: 'Feature commit 2',
          body: null,
          author: { name: 'Test', email: 'test@test.com', timestamp: 1700000100 },
          committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000100 },
          parentIds: ['commit1'],
          timestamp: 1700000100,
        },
      ];
      mockInvoke = () => Promise.resolve(mockCommits);

      const result = await getBranchDiffCommits('/test/repo', 'feature', 'main');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array when branches are identical', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getBranchDiffCommits('/test/repo', 'main', 'main');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles branch not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });

      const result = await getBranchDiffCommits('/test/repo', 'nonexistent', 'main');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_NOT_FOUND');
    });
  });

  describe('setUpstreamBranch', () => {
    it('invokes set_upstream_branch with correct arguments', async () => {
      const mockTrackingInfo = {
        localBranch: 'main',
        upstream: 'refs/remotes/origin/main',
        ahead: 0,
        behind: 0,
        remote: 'origin',
        remoteBranch: 'main',
        isGone: false,
      };
      mockInvoke = () => Promise.resolve(mockTrackingInfo);

      const result = await setUpstreamBranch('/test/repo', 'main', 'origin/main');
      expect(lastInvokedCommand).to.equal('set_upstream_branch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.branch).to.equal('main');
      expect(args.upstream).to.equal('origin/main');
      expect(result.success).to.be.true;
      expect(result.data?.localBranch).to.equal('main');
    });

    it('returns tracking info after setting upstream', async () => {
      const mockTrackingInfo = {
        localBranch: 'feature',
        upstream: 'refs/remotes/origin/feature',
        ahead: 2,
        behind: 1,
        remote: 'origin',
        remoteBranch: 'feature',
        isGone: false,
      };
      mockInvoke = () => Promise.resolve(mockTrackingInfo);

      const result = await setUpstreamBranch('/test/repo', 'feature', 'origin/feature');
      expect(result.success).to.be.true;
      expect(result.data?.ahead).to.equal(2);
      expect(result.data?.behind).to.equal(1);
    });

    it('handles branch not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });

      const result = await setUpstreamBranch('/test/repo', 'nonexistent', 'origin/main');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_NOT_FOUND');
    });

    it('handles upstream ref not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REF_NOT_FOUND', message: 'Reference not found' });

      const result = await setUpstreamBranch('/test/repo', 'main', 'origin/nonexistent');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REF_NOT_FOUND');
    });
  });

  describe('unsetUpstreamBranch', () => {
    it('invokes unset_upstream_branch with correct arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await unsetUpstreamBranch('/test/repo', 'main');
      expect(lastInvokedCommand).to.equal('unset_upstream_branch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.branch).to.equal('main');
      expect(result.success).to.be.true;
    });

    it('handles branch not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });

      const result = await unsetUpstreamBranch('/test/repo', 'nonexistent');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_NOT_FOUND');
    });
  });

  describe('createOrphanBranch', () => {
    it('invokes create_orphan_branch with correct arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await createOrphanBranch('/test/repo', { name: 'gh-pages', checkout: true });
      expect(lastInvokedCommand).to.equal('create_orphan_branch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('gh-pages');
      expect(args.checkout).to.be.true;
      expect(result.success).to.be.true;
    });

    it('invokes create_orphan_branch without checkout', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await createOrphanBranch('/test/repo', { name: 'docs', checkout: false });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('docs');
      expect(args.checkout).to.be.false;
      expect(result.success).to.be.true;
    });

    it('handles error when orphan branch already exists', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Branch already exists' });

      const result = await createOrphanBranch('/test/repo', { name: 'existing', checkout: true });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('OPERATION_FAILED');
    });
  });

  describe('getBranchTrackingInfo', () => {
    it('invokes get_branch_tracking_info with correct arguments', async () => {
      const mockTrackingInfo = {
        localBranch: 'main',
        upstream: 'refs/remotes/origin/main',
        ahead: 0,
        behind: 0,
        remote: 'origin',
        remoteBranch: 'main',
        isGone: false,
      };
      mockInvoke = () => Promise.resolve(mockTrackingInfo);

      const result = await getBranchTrackingInfo('/test/repo', 'main');
      expect(lastInvokedCommand).to.equal('get_branch_tracking_info');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.branch).to.equal('main');
      expect(result.success).to.be.true;
    });

    it('returns tracking info with ahead/behind counts', async () => {
      const mockTrackingInfo = {
        localBranch: 'feature',
        upstream: 'refs/remotes/origin/feature',
        ahead: 5,
        behind: 3,
        remote: 'origin',
        remoteBranch: 'feature',
        isGone: false,
      };
      mockInvoke = () => Promise.resolve(mockTrackingInfo);

      const result = await getBranchTrackingInfo('/test/repo', 'feature');
      expect(result.success).to.be.true;
      expect(result.data?.localBranch).to.equal('feature');
      expect(result.data?.upstream).to.equal('refs/remotes/origin/feature');
      expect(result.data?.ahead).to.equal(5);
      expect(result.data?.behind).to.equal(3);
      expect(result.data?.remote).to.equal('origin');
      expect(result.data?.remoteBranch).to.equal('feature');
    });

    it('returns info for branch with no upstream', async () => {
      const mockTrackingInfo = {
        localBranch: 'local-only',
        upstream: null,
        ahead: 0,
        behind: 0,
        remote: null,
        remoteBranch: null,
        isGone: false,
      };
      mockInvoke = () => Promise.resolve(mockTrackingInfo);

      const result = await getBranchTrackingInfo('/test/repo', 'local-only');
      expect(result.success).to.be.true;
      expect(result.data?.upstream).to.be.null;
      expect(result.data?.remote).to.be.null;
      expect(result.data?.remoteBranch).to.be.null;
      expect(result.data?.isGone).to.be.false;
    });

    it('returns info when upstream is gone', async () => {
      const mockTrackingInfo = {
        localBranch: 'feature',
        upstream: null,
        ahead: 0,
        behind: 0,
        remote: 'origin',
        remoteBranch: 'feature',
        isGone: true,
      };
      mockInvoke = () => Promise.resolve(mockTrackingInfo);

      const result = await getBranchTrackingInfo('/test/repo', 'feature');
      expect(result.success).to.be.true;
      expect(result.data?.isGone).to.be.true;
      expect(result.data?.remote).to.equal('origin');
      expect(result.data?.remoteBranch).to.equal('feature');
    });

    it('handles branch not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });

      const result = await getBranchTrackingInfo('/test/repo', 'nonexistent');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_NOT_FOUND');
    });
  });
});
