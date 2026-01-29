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

import { getCommitGraph } from '../git.service.ts';
import type { CommitGraphData } from '../../types/graph.types.ts';

describe('git.service - Commit graph visualization', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getCommitGraph', () => {
    it('invokes get_commit_graph command with path', async () => {
      const mockGraph: CommitGraphData = {
        nodes: [],
        totalCommits: 0,
        maxLane: 0,
      };
      mockInvoke = () => Promise.resolve(mockGraph);

      const result = await getCommitGraph({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('get_commit_graph');
      expect(result.success).to.be.true;
      expect(result.data?.totalCommits).to.equal(0);
    });

    it('passes maxCount parameter', async () => {
      mockInvoke = () =>
        Promise.resolve({
          nodes: [],
          totalCommits: 0,
          maxLane: 0,
        });

      await getCommitGraph({ path: '/test/repo', maxCount: 50 });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxCount).to.equal(50);
    });

    it('passes branch parameter', async () => {
      mockInvoke = () =>
        Promise.resolve({
          nodes: [],
          totalCommits: 0,
          maxLane: 0,
        });

      await getCommitGraph({ path: '/test/repo', branch: 'feature' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.branch).to.equal('feature');
    });

    it('passes skip parameter', async () => {
      mockInvoke = () =>
        Promise.resolve({
          nodes: [],
          totalCommits: 0,
          maxLane: 0,
        });

      await getCommitGraph({ path: '/test/repo', skip: 10 });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.skip).to.equal(10);
    });

    it('returns graph with nodes', async () => {
      const mockGraph: CommitGraphData = {
        nodes: [
          {
            oid: 'abc1234567890abcdef1234567890abcdef123456',
            shortOid: 'abc1234',
            message: 'Initial commit',
            authorName: 'Test User',
            authorEmail: 'test@example.com',
            authorDate: 1700000000,
            parents: [],
            children: ['def4567890abcdef1234567890abcdef12345678'],
            lane: 0,
            isMerge: false,
            isFork: false,
            refs: [
              {
                name: 'main',
                refType: 'branch',
                isCurrent: true,
              },
            ],
            edges: [],
          },
        ],
        totalCommits: 1,
        maxLane: 0,
      };
      mockInvoke = () => Promise.resolve(mockGraph);

      const result = await getCommitGraph({ path: '/test/repo' });
      expect(result.success).to.be.true;
      expect(result.data?.totalCommits).to.equal(1);
      expect(result.data?.maxLane).to.equal(0);
      expect(result.data?.nodes.length).to.equal(1);

      const node = result.data!.nodes[0];
      expect(node.oid).to.equal('abc1234567890abcdef1234567890abcdef123456');
      expect(node.shortOid).to.equal('abc1234');
      expect(node.message).to.equal('Initial commit');
      expect(node.authorName).to.equal('Test User');
      expect(node.authorEmail).to.equal('test@example.com');
      expect(node.lane).to.equal(0);
      expect(node.isMerge).to.be.false;
      expect(node.isFork).to.be.false;
      expect(node.refs.length).to.equal(1);
      expect(node.refs[0].name).to.equal('main');
      expect(node.refs[0].refType).to.equal('branch');
      expect(node.refs[0].isCurrent).to.be.true;
    });

    it('returns graph with edges', async () => {
      const mockGraph: CommitGraphData = {
        nodes: [
          {
            oid: 'def456',
            shortOid: 'def4567',
            message: 'Second commit',
            authorName: 'Test User',
            authorEmail: 'test@example.com',
            authorDate: 1700000100,
            parents: ['abc123'],
            children: [],
            lane: 0,
            isMerge: false,
            isFork: false,
            refs: [],
            edges: [
              {
                fromOid: 'def456',
                toOid: 'abc123',
                fromLane: 0,
                toLane: 0,
                edgeType: 'normal',
              },
            ],
          },
        ],
        totalCommits: 1,
        maxLane: 0,
      };
      mockInvoke = () => Promise.resolve(mockGraph);

      const result = await getCommitGraph({ path: '/test/repo' });
      expect(result.success).to.be.true;
      const edges = result.data!.nodes[0].edges;
      expect(edges.length).to.equal(1);
      expect(edges[0].fromOid).to.equal('def456');
      expect(edges[0].toOid).to.equal('abc123');
      expect(edges[0].fromLane).to.equal(0);
      expect(edges[0].toLane).to.equal(0);
      expect(edges[0].edgeType).to.equal('normal');
    });

    it('returns graph with merge edges', async () => {
      const mockGraph: CommitGraphData = {
        nodes: [
          {
            oid: 'merge123',
            shortOid: 'merge12',
            message: 'Merge branch feature',
            authorName: 'Test User',
            authorEmail: 'test@example.com',
            authorDate: 1700000200,
            parents: ['parent1', 'parent2'],
            children: [],
            lane: 0,
            isMerge: true,
            isFork: false,
            refs: [],
            edges: [
              {
                fromOid: 'merge123',
                toOid: 'parent1',
                fromLane: 0,
                toLane: 0,
                edgeType: 'normal',
              },
              {
                fromOid: 'merge123',
                toOid: 'parent2',
                fromLane: 0,
                toLane: 1,
                edgeType: 'merge',
              },
            ],
          },
        ],
        totalCommits: 1,
        maxLane: 1,
      };
      mockInvoke = () => Promise.resolve(mockGraph);

      const result = await getCommitGraph({ path: '/test/repo' });
      expect(result.success).to.be.true;
      expect(result.data!.nodes[0].isMerge).to.be.true;
      expect(result.data!.nodes[0].edges.length).to.equal(2);
      expect(result.data!.nodes[0].edges[1].edgeType).to.equal('merge');
      expect(result.data!.maxLane).to.equal(1);
    });

    it('handles error response', async () => {
      mockInvoke = () => Promise.reject({ code: 'GIT_ERROR', message: 'Repository not found' });

      const result = await getCommitGraph({ path: '/nonexistent' });
      expect(result.success).to.be.false;
      expect(result.error).to.not.be.undefined;
    });

    it('passes all parameters together', async () => {
      mockInvoke = () =>
        Promise.resolve({
          nodes: [],
          totalCommits: 0,
          maxLane: 0,
        });

      await getCommitGraph({
        path: '/test/repo',
        maxCount: 100,
        branch: 'develop',
        skip: 5,
      });

      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.maxCount).to.equal(100);
      expect(args.branch).to.equal('develop');
      expect(args.skip).to.equal(5);
    });
  });
});
