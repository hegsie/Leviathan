import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { RightPanelPage } from '../pages/panels.page';
import { injectCommandMock, injectCommandError } from '../fixtures/test-helpers';

/** Mock statistics data returned by get_repo_statistics */
const mockStatistics = {
  totalCommits: 256,
  totalBranches: 8,
  totalTags: 5,
  totalContributors: 6,
  totalFiles: 120,
  repoSizeBytes: 4_200_000,
  firstCommitDate: 1609459200,
  lastCommitDate: 1704067200,
  repoAgeDays: 1096,
  activityByMonth: [
    { year: 2023, month: 10, commits: 30, authors: 3 },
    { year: 2023, month: 11, commits: 45, authors: 4 },
    { year: 2023, month: 12, commits: 18, authors: 2 },
  ],
  activityByWeekday: [
    { day: 'Sunday', commits: 10 },
    { day: 'Monday', commits: 55 },
    { day: 'Tuesday', commits: 50 },
    { day: 'Wednesday', commits: 48 },
    { day: 'Thursday', commits: 42 },
    { day: 'Friday', commits: 35 },
    { day: 'Saturday', commits: 16 },
  ],
  activityByHour: Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    commits: i >= 9 && i <= 17 ? 15 + i : 3,
  })),
  topContributors: [
    { name: 'Alice', email: 'alice@test.com', commits: 100, linesAdded: 8000, linesDeleted: 2000, firstCommit: 1609459200, lastCommit: 1704067200 },
    { name: 'Bob', email: 'bob@test.com', commits: 80, linesAdded: 5000, linesDeleted: 1500, firstCommit: 1622505600, lastCommit: 1700000000 },
    { name: 'Charlie', email: 'charlie@test.com', commits: 40, linesAdded: 2000, linesDeleted: 800, firstCommit: 1640995200, lastCommit: 1690000000 },
  ],
  fileTypes: [
    { extension: '.ts', fileCount: 50, totalLines: 12000 },
    { extension: '.rs', fileCount: 30, totalLines: 8000 },
    { extension: '.json', fileCount: 15, totalLines: 1000 },
    { extension: '.md', fileCount: 10, totalLines: 500 },
    { extension: '.css', fileCount: 15, totalLines: 2500 },
  ],
  totalLinesAdded: 15000,
  totalLinesDeleted: 4300,
};

test.describe('Analytics Panel', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page);
    await injectCommandMock(page, { get_repo_statistics: mockStatistics });
  });

  test('should show Analytics tab in right panel', async () => {
    await expect(rightPanel.analyticsTab).toBeVisible();
  });

  test('should switch to analytics panel when tab is clicked', async () => {
    await rightPanel.switchToAnalytics();
    await expect(rightPanel.analyticsPanel).toBeVisible();
  });

  test('should display overview cards with summary statistics', async ({ page }) => {
    await rightPanel.switchToAnalytics();

    // Wait for statistics to load
    await page.locator('lv-analytics-panel .stat-card').first().waitFor({ state: 'visible', timeout: 5000 });

    const cards = page.locator('lv-analytics-panel .stat-card');
    await expect(cards).toHaveCount(9);

    // Verify commits count is displayed
    const values = page.locator('lv-analytics-panel .stat-value');
    await expect(values.first()).toHaveText('256');
  });

  test('should display commit activity timeline chart', async ({ page }) => {
    await rightPanel.switchToAnalytics();

    // Wait for the chart to render
    const activityBars = page.locator('lv-analytics-panel .section:has-text("Commit Activity") .chart-bar');
    await activityBars.first().waitFor({ state: 'visible', timeout: 5000 });

    // Should have 3 bars (one per month)
    await expect(activityBars).toHaveCount(3);
  });

  test('should display activity patterns section', async ({ page }) => {
    await rightPanel.switchToAnalytics();

    const patternsSection = page.locator('lv-analytics-panel .section:has-text("Activity Patterns")');
    await expect(patternsSection).toBeVisible({ timeout: 5000 });

    // Should show weekday sub-chart
    await expect(patternsSection.locator('.chart-sub-title:has-text("Day of Week")')).toBeVisible();
    // Should show hour sub-chart
    await expect(patternsSection.locator('.chart-sub-title:has-text("Hour")')).toBeVisible();
  });

  test('should display top contributors', async ({ page }) => {
    await rightPanel.switchToAnalytics();

    const contribSection = page.locator('lv-analytics-panel .section:has-text("Top Contributors")');
    await expect(contribSection).toBeVisible({ timeout: 5000 });

    const rows = contribSection.locator('.contributor-row');
    await expect(rows).toHaveCount(3);

    // First contributor should be Alice (most commits)
    await expect(contribSection.locator('.contributor-name').first()).toHaveText('Alice');
  });

  test('should display file type distribution', async ({ page }) => {
    await rightPanel.switchToAnalytics();

    const fileSection = page.locator('lv-analytics-panel .section:has-text("File Types")');
    await expect(fileSection).toBeVisible({ timeout: 5000 });

    // Should have donut chart
    await expect(fileSection.locator('.donut-container svg')).toBeVisible();

    // Should list file types
    const fileRows = fileSection.locator('.file-type-row');
    await expect(fileRows).toHaveCount(5);
  });

  test('should show error state when command fails', async ({ page }) => {
    await injectCommandError(page, 'get_repo_statistics', 'Statistics unavailable');
    await rightPanel.switchToAnalytics();

    // Force a reload by navigating away and back
    await rightPanel.switchToChanges();
    await injectCommandError(page, 'get_repo_statistics', 'Statistics unavailable');

    // Inject error before switching, then switch
    await page.evaluate(() => {
      // Reset the analytics panel to force a reload
      const panel = document.querySelector('lv-analytics-panel');
      if (panel) {
        (panel as HTMLElement & { repositoryPath: string | null }).repositoryPath = null;
      }
    });
    await page.evaluate(() => {
      const panel = document.querySelector('lv-analytics-panel');
      if (panel) {
        (panel as HTMLElement & { repositoryPath: string | null }).repositoryPath = '/tmp/test-repo';
      }
    });

    await rightPanel.switchToAnalytics();

    const errorEl = page.locator('lv-analytics-panel .error');
    await expect(errorEl).toBeVisible({ timeout: 5000 });
    await expect(errorEl).toContainText('Statistics unavailable');
  });

  test('should show retry button on error', async ({ page }) => {
    await injectCommandError(page, 'get_repo_statistics', 'Temporary failure');

    // Reset the panel to force a fresh load with error
    await page.evaluate(() => {
      const panel = document.querySelector('lv-analytics-panel');
      if (panel) {
        (panel as HTMLElement & { repositoryPath: string | null }).repositoryPath = null;
      }
    });
    await page.evaluate(() => {
      const panel = document.querySelector('lv-analytics-panel');
      if (panel) {
        (panel as HTMLElement & { repositoryPath: string | null }).repositoryPath = '/tmp/test-repo';
      }
    });

    await rightPanel.switchToAnalytics();

    const retryBtn = page.locator('lv-analytics-panel .retry-btn');
    await expect(retryBtn).toBeVisible({ timeout: 5000 });
  });
});
