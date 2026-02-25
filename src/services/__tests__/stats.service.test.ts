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
  getRepoStats,
  getContributorStats,
  getRepoStatistics,
  type RepoStats,
  type ContributorStats,
  type RepoStatistics,
} from '../git.service.ts';

describe('git.service - Repository statistics', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getRepoStats', () => {
    it('invokes get_repo_stats command', async () => {
      const mockStats: RepoStats = {
        totalCommits: 150,
        totalBranches: 5,
        totalTags: 3,
        totalContributors: 4,
        firstCommitDate: 1609459200,
        latestCommitDate: 1704067200,
        contributors: [
          {
            name: 'Alice',
            email: 'alice@example.com',
            commitCount: 80,
            firstCommit: 1609459200,
            latestCommit: 1704067200,
            linesAdded: 5000,
            linesDeleted: 2000,
          },
          {
            name: 'Bob',
            email: 'bob@example.com',
            commitCount: 70,
            firstCommit: 1609459200,
            latestCommit: 1701475200,
            linesAdded: 3000,
            linesDeleted: 1500,
          },
        ],
        activityByMonth: [
          { year: 2023, month: 1, commitCount: 20 },
          { year: 2023, month: 2, commitCount: 15 },
        ],
        activityByDayOfWeek: [
          { day: 'Monday', dayIndex: 1, commitCount: 30 },
          { day: 'Tuesday', dayIndex: 2, commitCount: 25 },
        ],
        activityByHour: [
          { hour: 9, commitCount: 15 },
          { hour: 10, commitCount: 20 },
        ],
        filesCount: 50,
        totalLinesAdded: 8000,
        totalLinesDeleted: 3500,
      };
      mockInvoke = () => Promise.resolve(mockStats);

      const result = await getRepoStats('/test/repo');
      expect(lastInvokedCommand).to.equal('get_repo_stats');
      expect(result.success).to.be.true;
      expect(result.data?.totalCommits).to.equal(150);
      expect(result.data?.totalContributors).to.equal(4);
    });

    it('supports max commits parameter', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 100,
          totalBranches: 1,
          totalTags: 0,
          totalContributors: 1,
          firstCommitDate: null,
          latestCommitDate: null,
          contributors: [],
          activityByMonth: [],
          activityByDayOfWeek: [],
          activityByHour: [],
          filesCount: 0,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
        });

      await getRepoStats('/test/repo', 100);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxCommits).to.equal(100);
    });

    it('handles empty repository', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 0,
          totalBranches: 0,
          totalTags: 0,
          totalContributors: 0,
          firstCommitDate: null,
          latestCommitDate: null,
          contributors: [],
          activityByMonth: [],
          activityByDayOfWeek: [],
          activityByHour: [],
          filesCount: 0,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
        });

      const result = await getRepoStats('/test/repo');
      expect(result.data?.totalCommits).to.equal(0);
      expect(result.data?.contributors).to.deep.equal([]);
    });

    it('returns sorted contributors by commit count', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 10,
          totalBranches: 1,
          totalTags: 0,
          totalContributors: 2,
          firstCommitDate: 1609459200,
          latestCommitDate: 1704067200,
          contributors: [
            { name: 'Alice', email: 'alice@example.com', commitCount: 7, firstCommit: 1609459200, latestCommit: 1704067200, linesAdded: 0, linesDeleted: 0 },
            { name: 'Bob', email: 'bob@example.com', commitCount: 3, firstCommit: 1609459200, latestCommit: 1704067200, linesAdded: 0, linesDeleted: 0 },
          ],
          activityByMonth: [],
          activityByDayOfWeek: [],
          activityByHour: [],
          filesCount: 0,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
        });

      const result = await getRepoStats('/test/repo');
      const contributors = result.data?.contributors ?? [];
      expect(contributors[0].commitCount).to.be.greaterThanOrEqual(contributors[1].commitCount);
    });

    it('has 7 day-of-week entries', async () => {
      const dowEntries = Array.from({ length: 7 }, (_, i) => ({
        day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i],
        dayIndex: i,
        commitCount: Math.floor(Math.random() * 20),
      }));
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 50,
          totalBranches: 1,
          totalTags: 0,
          totalContributors: 1,
          firstCommitDate: null,
          latestCommitDate: null,
          contributors: [],
          activityByMonth: [],
          activityByDayOfWeek: dowEntries,
          activityByHour: [],
          filesCount: 0,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
        });

      const result = await getRepoStats('/test/repo');
      expect(result.data?.activityByDayOfWeek.length).to.equal(7);
    });

    it('has 24 hour entries', async () => {
      const hourEntries = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        commitCount: Math.floor(Math.random() * 10),
      }));
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 50,
          totalBranches: 1,
          totalTags: 0,
          totalContributors: 1,
          firstCommitDate: null,
          latestCommitDate: null,
          contributors: [],
          activityByMonth: [],
          activityByDayOfWeek: [],
          activityByHour: hourEntries,
          filesCount: 0,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
        });

      const result = await getRepoStats('/test/repo');
      expect(result.data?.activityByHour.length).to.equal(24);
    });
  });

  describe('getContributorStats', () => {
    it('invokes get_contributor_stats command', async () => {
      const mockContributors: ContributorStats[] = [
        {
          name: 'Alice',
          email: 'alice@example.com',
          commitCount: 50,
          firstCommit: 1609459200,
          latestCommit: 1704067200,
          linesAdded: 3000,
          linesDeleted: 1000,
        },
      ];
      mockInvoke = () => Promise.resolve(mockContributors);

      const result = await getContributorStats('/test/repo');
      expect(lastInvokedCommand).to.equal('get_contributor_stats');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
      expect(result.data?.[0].linesAdded).to.equal(3000);
    });

    it('supports max commits parameter', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getContributorStats('/test/repo', 500);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxCommits).to.equal(500);
    });
  });

  describe('getRepoStatistics', () => {
    it('invokes get_repo_statistics command with default options', async () => {
      const mockStats: RepoStatistics = {
        totalCommits: 200,
        totalBranches: 10,
        totalTags: 5,
        totalContributors: 8,
        totalFiles: 150,
        repoSizeBytes: 2500000,
        firstCommitDate: 1577836800,
        lastCommitDate: 1704067200,
        repoAgeDays: 1461,
        activityByMonth: null,
        activityByWeekday: null,
        activityByHour: null,
        topContributors: null,
        fileTypes: null,
        totalLinesAdded: 50000,
        totalLinesDeleted: 15000,
      };
      mockInvoke = () => Promise.resolve(mockStats);

      const result = await getRepoStatistics('/test/repo');
      expect(lastInvokedCommand).to.equal('get_repo_statistics');
      expect(result.success).to.be.true;
      expect(result.data?.totalCommits).to.equal(200);
      expect(result.data?.repoSizeBytes).to.equal(2500000);
      expect(result.data?.repoAgeDays).to.equal(1461);
    });

    it('passes include flags correctly', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 100,
          totalBranches: 5,
          totalTags: 2,
          totalContributors: 3,
          totalFiles: 50,
          repoSizeBytes: 1000000,
          firstCommitDate: null,
          lastCommitDate: null,
          repoAgeDays: 0,
          activityByMonth: [{ year: 2024, month: 1, commits: 10, authors: 2 }],
          activityByWeekday: [{ day: 'Monday', commits: 5 }],
          activityByHour: [{ hour: 10, commits: 3 }],
          topContributors: [
            { name: 'Alice', email: 'alice@example.com', commits: 50, linesAdded: 2000, linesDeleted: 500, firstCommit: 1577836800, lastCommit: 1704067200 },
          ],
          fileTypes: [{ extension: '.ts', fileCount: 30, totalLines: 5000 }],
          totalLinesAdded: 10000,
          totalLinesDeleted: 3000,
        });

      await getRepoStatistics('/test/repo', {
        includeActivity: true,
        includeContributors: true,
        includeFileTypes: true,
      });

      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeActivity).to.be.true;
      expect(args.includeContributors).to.be.true;
      expect(args.includeFileTypes).to.be.true;
    });

    it('passes date filters correctly', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 50,
          totalBranches: 2,
          totalTags: 1,
          totalContributors: 2,
          totalFiles: 25,
          repoSizeBytes: 500000,
          firstCommitDate: 1609459200,
          lastCommitDate: 1640995200,
          repoAgeDays: 365,
          activityByMonth: null,
          activityByWeekday: null,
          activityByHour: null,
          topContributors: null,
          fileTypes: null,
          totalLinesAdded: 5000,
          totalLinesDeleted: 1000,
        });

      await getRepoStatistics('/test/repo', {
        since: '2021-01-01',
        until: '2021-12-31',
      });

      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.since).to.equal('2021-01-01');
      expect(args.until).to.equal('2021-12-31');
    });

    it('returns activity breakdown when included', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 75,
          totalBranches: 3,
          totalTags: 2,
          totalContributors: 4,
          totalFiles: 40,
          repoSizeBytes: 800000,
          firstCommitDate: 1577836800,
          lastCommitDate: 1704067200,
          repoAgeDays: 1461,
          activityByMonth: [
            { year: 2023, month: 1, commits: 15, authors: 2 },
            { year: 2023, month: 2, commits: 20, authors: 3 },
          ],
          activityByWeekday: [
            { day: 'Sunday', commits: 5 },
            { day: 'Monday', commits: 15 },
            { day: 'Tuesday', commits: 12 },
            { day: 'Wednesday', commits: 10 },
            { day: 'Thursday', commits: 18 },
            { day: 'Friday', commits: 10 },
            { day: 'Saturday', commits: 5 },
          ],
          activityByHour: Array.from({ length: 24 }, (_, i) => ({ hour: i, commits: i })),
          topContributors: null,
          fileTypes: null,
          totalLinesAdded: 8000,
          totalLinesDeleted: 2000,
        });

      const result = await getRepoStatistics('/test/repo', { includeActivity: true });
      expect(result.data?.activityByMonth).to.not.be.null;
      expect(result.data?.activityByMonth?.length).to.equal(2);
      expect(result.data?.activityByMonth?.[0].authors).to.equal(2);
      expect(result.data?.activityByWeekday?.length).to.equal(7);
      expect(result.data?.activityByHour?.length).to.equal(24);
    });

    it('returns file type breakdown when included', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 100,
          totalBranches: 5,
          totalTags: 3,
          totalContributors: 5,
          totalFiles: 120,
          repoSizeBytes: 1500000,
          firstCommitDate: 1577836800,
          lastCommitDate: 1704067200,
          repoAgeDays: 1461,
          activityByMonth: null,
          activityByWeekday: null,
          activityByHour: null,
          topContributors: null,
          fileTypes: [
            { extension: '.ts', fileCount: 50, totalLines: 10000 },
            { extension: '.rs', fileCount: 30, totalLines: 8000 },
            { extension: '.json', fileCount: 20, totalLines: 500 },
          ],
          totalLinesAdded: 15000,
          totalLinesDeleted: 4000,
        });

      const result = await getRepoStatistics('/test/repo', { includeFileTypes: true });
      expect(result.data?.fileTypes).to.not.be.null;
      expect(result.data?.fileTypes?.length).to.equal(3);
      expect(result.data?.fileTypes?.[0].extension).to.equal('.ts');
      expect(result.data?.fileTypes?.[0].fileCount).to.equal(50);
    });

    it('returns contributor stats when included', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 150,
          totalBranches: 8,
          totalTags: 4,
          totalContributors: 3,
          totalFiles: 80,
          repoSizeBytes: 2000000,
          firstCommitDate: 1577836800,
          lastCommitDate: 1704067200,
          repoAgeDays: 1461,
          activityByMonth: null,
          activityByWeekday: null,
          activityByHour: null,
          topContributors: [
            { name: 'Alice', email: 'alice@example.com', commits: 80, linesAdded: 5000, linesDeleted: 1500, firstCommit: 1577836800, lastCommit: 1704067200 },
            { name: 'Bob', email: 'bob@example.com', commits: 50, linesAdded: 3000, linesDeleted: 1000, firstCommit: 1609459200, lastCommit: 1704067200 },
            { name: 'Charlie', email: 'charlie@example.com', commits: 20, linesAdded: 1000, linesDeleted: 200, firstCommit: 1640995200, lastCommit: 1704067200 },
          ],
          fileTypes: null,
          totalLinesAdded: 9000,
          totalLinesDeleted: 2700,
        });

      const result = await getRepoStatistics('/test/repo', { includeContributors: true });
      expect(result.data?.topContributors).to.not.be.null;
      expect(result.data?.topContributors?.length).to.equal(3);
      expect(result.data?.topContributors?.[0].commits).to.equal(80);
      expect(result.data?.topContributors?.[0].name).to.equal('Alice');
    });

    it('defaults include options to false', async () => {
      mockInvoke = () =>
        Promise.resolve({
          totalCommits: 10,
          totalBranches: 1,
          totalTags: 0,
          totalContributors: 1,
          totalFiles: 5,
          repoSizeBytes: 10000,
          firstCommitDate: null,
          lastCommitDate: null,
          repoAgeDays: 0,
          activityByMonth: null,
          activityByWeekday: null,
          activityByHour: null,
          topContributors: null,
          fileTypes: null,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
        });

      await getRepoStatistics('/test/repo');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeActivity).to.be.false;
      expect(args.includeContributors).to.be.false;
      expect(args.includeFileTypes).to.be.false;
    });
  });
});
