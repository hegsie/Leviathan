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
  filterCommits,
  getBranchDiffCommits,
  getFileLog,
  type CommitFilter,
  type FilteredCommit,
} from '../git.service.ts';

describe('git.service - Advanced search operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('filterCommits', () => {
    it('invokes filter_commits command with filter object', async () => {
      const mockResults: FilteredCommit[] = [
        {
          oid: 'abc123def456abc123def456abc123def456abc123',
          shortOid: 'abc123d',
          message: 'feat: add feature',
          authorName: 'John Doe',
          authorEmail: 'john@example.com',
          authorDate: 1700000000,
          committerName: 'John Doe',
          committerDate: 1700000000,
          parentCount: 1,
          isMerge: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const filter: CommitFilter = { author: 'John' };
      const result = await filterCommits('/test/repo', filter);
      expect(lastInvokedCommand).to.equal('filter_commits');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect((args.filter as CommitFilter).author).to.equal('John');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
      expect(result.data?.[0].authorName).to.equal('John Doe');
    });

    it('passes all filter fields', async () => {
      mockInvoke = () => Promise.resolve([]);

      const filter: CommitFilter = {
        author: 'Jane',
        committer: 'Jane',
        message: 'fix',
        afterDate: '2023-01-01',
        beforeDate: '2024-01-01',
        path: 'src/main.ts',
        branch: 'develop',
        minParents: 0,
        maxParents: 1,
        noMerges: true,
        firstParent: true,
      };

      await filterCommits('/test/repo', filter, 50);
      const args = lastInvokedArgs as Record<string, unknown>;
      const sentFilter = args.filter as CommitFilter;
      expect(sentFilter.author).to.equal('Jane');
      expect(sentFilter.committer).to.equal('Jane');
      expect(sentFilter.message).to.equal('fix');
      expect(sentFilter.afterDate).to.equal('2023-01-01');
      expect(sentFilter.beforeDate).to.equal('2024-01-01');
      expect(sentFilter.path).to.equal('src/main.ts');
      expect(sentFilter.branch).to.equal('develop');
      expect(sentFilter.minParents).to.equal(0);
      expect(sentFilter.maxParents).to.equal(1);
      expect(sentFilter.noMerges).to.be.true;
      expect(sentFilter.firstParent).to.be.true;
      expect(args.maxCount).to.equal(50);
    });

    it('passes maxCount parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await filterCommits('/test/repo', {}, 200);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxCount).to.equal(200);
    });

    it('returns empty array when no matches', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await filterCommits('/test/repo', { author: 'nonexistent' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles merge commits with isMerge flag', async () => {
      const mockResults: FilteredCommit[] = [
        {
          oid: 'merge123',
          shortOid: 'merge12',
          message: 'Merge branch feature',
          authorName: 'John',
          authorEmail: 'john@example.com',
          authorDate: 1700000000,
          committerName: 'John',
          committerDate: 1700000000,
          parentCount: 2,
          isMerge: true,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await filterCommits('/test/repo', {});
      expect(result.success).to.be.true;
      expect(result.data?.[0].isMerge).to.be.true;
      expect(result.data?.[0].parentCount).to.equal(2);
    });

    it('handles errors', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'git log failed' });

      const result = await filterCommits('/test/repo', {});
      expect(result.success).to.be.false;
    });
  });

  describe('getBranchDiffCommits', () => {
    it('invokes get_branch_diff_commits command', async () => {
      const mockResults: FilteredCommit[] = [
        {
          oid: 'feature123',
          shortOid: 'feat123',
          message: 'Add feature',
          authorName: 'Dev',
          authorEmail: 'dev@example.com',
          authorDate: 1700000000,
          committerName: 'Dev',
          committerDate: 1700000000,
          parentCount: 1,
          isMerge: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await getBranchDiffCommits('/test/repo', 'main', 'feature');
      expect(lastInvokedCommand).to.equal('get_branch_diff_commits');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.baseBranch).to.equal('main');
      expect(args.compareBranch).to.equal('feature');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('passes maxCount parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getBranchDiffCommits('/test/repo', 'main', 'feature', 100);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxCount).to.equal(100);
    });

    it('returns empty array when branches are identical', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getBranchDiffCommits('/test/repo', 'main', 'main');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles errors', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'branch not found' });

      const result = await getBranchDiffCommits('/test/repo', 'main', 'nonexistent');
      expect(result.success).to.be.false;
    });
  });

  describe('getFileLog', () => {
    it('invokes get_file_log command', async () => {
      const mockResults: FilteredCommit[] = [
        {
          oid: 'file123',
          shortOid: 'file12',
          message: 'Update file',
          authorName: 'Dev',
          authorEmail: 'dev@example.com',
          authorDate: 1700000000,
          committerName: 'Dev',
          committerDate: 1700000000,
          parentCount: 1,
          isMerge: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await getFileLog('/test/repo', 'src/main.ts');
      expect(lastInvokedCommand).to.equal('get_file_log');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.filePath).to.equal('src/main.ts');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('passes follow parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getFileLog('/test/repo', 'src/main.ts', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.follow).to.be.true;
    });

    it('passes follow=false', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getFileLog('/test/repo', 'src/main.ts', false);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.follow).to.be.false;
    });

    it('passes maxResults parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getFileLog('/test/repo', 'src/main.ts', true, 50);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxResults).to.equal(50);
    });

    it('returns empty array for nonexistent file', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getFileLog('/test/repo', 'nonexistent.txt');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles errors', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'git log failed' });

      const result = await getFileLog('/test/repo', 'file.ts');
      expect(result.success).to.be.false;
    });
  });
});
