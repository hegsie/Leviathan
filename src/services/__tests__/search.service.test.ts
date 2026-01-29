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
  searchInFiles,
  searchInDiff,
  searchInCommits,
  searchInCommitMessages,
  searchCommitsByContent,
  searchCommitsByFile,
  type SearchResult,
  type SearchFileResult,
  type DiffSearchResult,
  type SearchCommit,
} from '../git.service.ts';

describe('git.service - Search operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('searchInFiles', () => {
    it('invokes search_in_files command with required args', async () => {
      const mockResults: SearchFileResult[] = [
        {
          filePath: 'src/main.ts',
          matches: [
            {
              filePath: 'src/main.ts',
              lineNumber: 10,
              lineContent: 'const foo = "hello world";',
              matchStart: 14,
              matchEnd: 19,
            },
          ],
          matchCount: 1,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await searchInFiles('/test/repo', 'hello');
      expect(lastInvokedCommand).to.equal('search_in_files');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.query).to.equal('hello');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
      expect(result.data?.[0].filePath).to.equal('src/main.ts');
    });

    it('passes optional parameters', async () => {
      mockInvoke = () => Promise.resolve([]);

      await searchInFiles('/test/repo', 'pattern', true, true, '*.ts', 50);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.caseSensitive).to.be.true;
      expect(args.regex).to.be.true;
      expect(args.filePattern).to.equal('*.ts');
      expect(args.maxResults).to.equal(50);
    });

    it('returns empty array when no matches', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await searchInFiles('/test/repo', 'nonexistent');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles errors', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'git grep failed' });

      const result = await searchInFiles('/test/repo', 'test');
      expect(result.success).to.be.false;
    });
  });

  describe('searchInDiff', () => {
    it('invokes search_in_diff command', async () => {
      const mockResults: SearchResult[] = [
        {
          filePath: 'src/app.ts',
          lineNumber: 5,
          lineContent: 'added new feature',
          matchStart: 6,
          matchEnd: 9,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await searchInDiff('/test/repo', 'new');
      expect(lastInvokedCommand).to.equal('search_in_diff');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.query).to.equal('new');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('passes staged parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await searchInDiff('/test/repo', 'query', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.staged).to.be.true;
    });

    it('returns empty array for no matches in diff', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await searchInDiff('/test/repo', 'nonexistent');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('searchInCommits', () => {
    it('invokes search_in_commits command', async () => {
      const mockResults: DiffSearchResult[] = [
        {
          commitId: 'abc123def456',
          author: 'John Doe',
          date: 1700000000,
          message: 'Add feature X',
          filePath: 'src/feature.ts',
          lineContent: '',
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await searchInCommits('/test/repo', 'feature');
      expect(lastInvokedCommand).to.equal('search_in_commits');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.query).to.equal('feature');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
      expect(result.data?.[0].commitId).to.equal('abc123def456');
    });

    it('passes maxCommits parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await searchInCommits('/test/repo', 'query', 200);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxCommits).to.equal(200);
    });

    it('returns empty array for no matches', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await searchInCommits('/test/repo', 'nonexistent');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('searchInCommitMessages', () => {
    it('invokes search_in_commit_messages command', async () => {
      const mockResults: DiffSearchResult[] = [
        {
          commitId: 'abc123',
          author: 'Jane Doe',
          date: 1700000000,
          message: 'fix: resolve bug in parser',
          filePath: '',
          lineContent: '',
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await searchInCommitMessages('/test/repo', 'bug');
      expect(lastInvokedCommand).to.equal('search_in_commit_messages');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.query).to.equal('bug');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
      expect(result.data?.[0].message).to.equal('fix: resolve bug in parser');
    });

    it('passes maxCommits parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await searchInCommitMessages('/test/repo', 'fix', 500);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxCommits).to.equal(500);
    });

    it('returns empty array for no matches', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await searchInCommitMessages('/test/repo', 'nonexistent');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'git log failed' });

      const result = await searchInCommitMessages('/test/repo', 'test');
      expect(result.success).to.be.false;
    });
  });

  describe('searchCommitsByContent', () => {
    it('invokes search_commits_by_content command with required args', async () => {
      const mockResults: SearchCommit[] = [
        {
          oid: 'abc123def456abc123def456abc123def456abc123',
          shortOid: 'abc123d',
          message: 'Add feature with special content',
          authorName: 'John Doe',
          authorDate: 1700000000,
          matches: [
            {
              filePath: 'src/feature.ts',
              lineNumber: null,
              lineContent: null,
            },
          ],
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await searchCommitsByContent('/test/repo', 'specialContent');
      expect(lastInvokedCommand).to.equal('search_commits_by_content');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.searchText).to.equal('specialContent');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
      expect(result.data?.[0].oid).to.equal('abc123def456abc123def456abc123def456abc123');
      expect(result.data?.[0].matches.length).to.equal(1);
    });

    it('passes all optional parameters', async () => {
      mockInvoke = () => Promise.resolve([]);

      await searchCommitsByContent('/test/repo', 'pattern.*', true, true, 50);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.searchText).to.equal('pattern.*');
      expect(args.regex).to.be.true;
      expect(args.ignoreCase).to.be.true;
      expect(args.maxCount).to.equal(50);
    });

    it('returns empty array when no matches', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await searchCommitsByContent('/test/repo', 'nonexistent');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'git log failed' });

      const result = await searchCommitsByContent('/test/repo', 'test');
      expect(result.success).to.be.false;
    });
  });

  describe('searchCommitsByFile', () => {
    it('invokes search_commits_by_file command with required args', async () => {
      const mockResults: SearchCommit[] = [
        {
          oid: 'def456abc123def456abc123def456abc123def456',
          shortOid: 'def456a',
          message: 'Update Rust code',
          authorName: 'Jane Doe',
          authorDate: 1700000000,
          matches: [
            {
              filePath: 'src/main.rs',
              lineNumber: null,
              lineContent: null,
            },
            {
              filePath: 'src/lib.rs',
              lineNumber: null,
              lineContent: null,
            },
          ],
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await searchCommitsByFile('/test/repo', '*.rs');
      expect(lastInvokedCommand).to.equal('search_commits_by_file');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.filePattern).to.equal('*.rs');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
      expect(result.data?.[0].matches.length).to.equal(2);
    });

    it('passes maxCount parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await searchCommitsByFile('/test/repo', 'src/*.ts', 100);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.filePattern).to.equal('src/*.ts');
      expect(args.maxCount).to.equal(100);
    });

    it('returns empty array when no files match pattern', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await searchCommitsByFile('/test/repo', '*.nonexistent');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'git log failed' });

      const result = await searchCommitsByFile('/test/repo', '*.rs');
      expect(result.success).to.be.false;
    });
  });
});
