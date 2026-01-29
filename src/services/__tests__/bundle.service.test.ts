import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    return mockInvoke(command, args);
  },
};

import {
  bundleCreate,
  bundleVerify,
  bundleListHeads,
  bundleUnbundle,
  type BundleRef,
  type BundleCreateResult,
  type BundleVerifyResult,
} from '../git.service.ts';

describe('git.service - Bundle operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('bundleCreate', () => {
    it('invokes bundle_create with all refs', async () => {
      const mockResult: BundleCreateResult = {
        bundlePath: '/tmp/test.bundle',
        refsCount: 3,
        objectsCount: 15,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await bundleCreate('/test/repo', '/tmp/test.bundle', [], true);
      expect(lastInvokedCommand).to.equal('bundle_create');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.bundlePath).to.equal('/tmp/test.bundle');
      expect(args.refs).to.deep.equal([]);
      expect(args.all).to.be.true;
      expect(result.success).to.be.true;
      expect(result.data?.bundlePath).to.equal('/tmp/test.bundle');
    });

    it('invokes bundle_create with specific refs', async () => {
      const mockResult: BundleCreateResult = {
        bundlePath: '/tmp/feature.bundle',
        refsCount: 1,
        objectsCount: 5,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await bundleCreate(
        '/test/repo',
        '/tmp/feature.bundle',
        ['refs/heads/feature'],
        false
      );
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.refs).to.deep.equal(['refs/heads/feature']);
      expect(args.all).to.be.false;
      expect(result.success).to.be.true;
    });

    it('supports revision ranges', async () => {
      const mockResult: BundleCreateResult = {
        bundlePath: '/tmp/range.bundle',
        refsCount: 1,
        objectsCount: 3,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await bundleCreate('/test/repo', '/tmp/range.bundle', ['v1.0..HEAD'], false);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.refs).to.deep.equal(['v1.0..HEAD']);
    });

    it('handles error when no refs provided', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: "Either refs must be provided or 'all' must be true",
        });

      const result = await bundleCreate('/test/repo', '/tmp/empty.bundle', [], false);
      expect(result.success).to.be.false;
    });
  });

  describe('bundleVerify', () => {
    it('invokes bundle_verify command', async () => {
      const mockResult: BundleVerifyResult = {
        isValid: true,
        refs: [{ name: 'refs/heads/main', oid: 'abc123def456' }],
        requires: [],
        message: null,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await bundleVerify('/test/repo', '/tmp/test.bundle');
      expect(lastInvokedCommand).to.equal('bundle_verify');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.bundlePath).to.equal('/tmp/test.bundle');
      expect(result.success).to.be.true;
      expect(result.data?.isValid).to.be.true;
    });

    it('returns prerequisites when bundle has dependencies', async () => {
      const mockResult: BundleVerifyResult = {
        isValid: true,
        refs: [{ name: 'refs/heads/feature', oid: 'def789' }],
        requires: ['abc123'],
        message: null,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await bundleVerify('/test/repo', '/tmp/incremental.bundle');
      expect(result.data?.requires).to.deep.equal(['abc123']);
    });

    it('returns invalid with message when verification fails', async () => {
      const mockResult: BundleVerifyResult = {
        isValid: false,
        refs: [],
        requires: ['missing123'],
        message: 'Repository does not have the required prerequisite commits',
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await bundleVerify('/test/repo', '/tmp/incomplete.bundle');
      expect(result.data?.isValid).to.be.false;
      expect(result.data?.message).to.not.be.null;
    });

    it('handles nonexistent bundle file', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Bundle file not found',
        });

      const result = await bundleVerify('/test/repo', '/nonexistent/bundle.bundle');
      expect(result.success).to.be.false;
    });
  });

  describe('bundleListHeads', () => {
    it('invokes bundle_list_heads command', async () => {
      const mockRefs: BundleRef[] = [
        { name: 'refs/heads/main', oid: 'abc123' },
        { name: 'refs/heads/feature', oid: 'def456' },
        { name: 'refs/tags/v1.0', oid: 'ghi789' },
      ];
      mockInvoke = () => Promise.resolve(mockRefs);

      const result = await bundleListHeads('/tmp/test.bundle');
      expect(lastInvokedCommand).to.equal('bundle_list_heads');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.bundlePath).to.equal('/tmp/test.bundle');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
    });

    it('returns empty array for bundle with no refs', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await bundleListHeads('/tmp/empty.bundle');
      expect(result.data).to.deep.equal([]);
    });

    it('handles nonexistent bundle file', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Bundle file not found',
        });

      const result = await bundleListHeads('/nonexistent/bundle.bundle');
      expect(result.success).to.be.false;
    });
  });

  describe('bundleUnbundle', () => {
    it('invokes bundle_unbundle command', async () => {
      const mockRefs: BundleRef[] = [
        { name: 'refs/heads/main', oid: 'abc123' },
        { name: 'refs/heads/feature', oid: 'def456' },
      ];
      mockInvoke = () => Promise.resolve(mockRefs);

      const result = await bundleUnbundle('/test/repo', '/tmp/test.bundle');
      expect(lastInvokedCommand).to.equal('bundle_unbundle');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.bundlePath).to.equal('/tmp/test.bundle');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns fetched refs from bundle', async () => {
      const mockRefs: BundleRef[] = [{ name: 'refs/heads/transferred', oid: 'xyz789' }];
      mockInvoke = () => Promise.resolve(mockRefs);

      const result = await bundleUnbundle('/test/repo', '/tmp/single.bundle');
      expect(result.data?.[0].name).to.equal('refs/heads/transferred');
      expect(result.data?.[0].oid).to.equal('xyz789');
    });

    it('handles verification failure during unbundle', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message:
            'Bundle verification failed. The repository may be missing prerequisite commits.',
        });

      const result = await bundleUnbundle('/test/repo', '/tmp/incomplete.bundle');
      expect(result.success).to.be.false;
    });

    it('handles nonexistent repository', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'REPO_NOT_FOUND',
          message: 'Repository not found',
        });

      const result = await bundleUnbundle('/nonexistent/repo', '/tmp/test.bundle');
      expect(result.success).to.be.false;
    });

    it('handles nonexistent bundle file', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Bundle file not found',
        });

      const result = await bundleUnbundle('/test/repo', '/nonexistent/bundle.bundle');
      expect(result.success).to.be.false;
    });
  });
});
