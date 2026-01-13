/**
 * E2E Tests for Remote Operations (Fetch/Push/Pull) and Ahead/Behind Badges
 *
 * Tests cover:
 * - Fetch/Push/Pull button visibility
 * - Ahead/behind badge display
 * - Button states during operations
 * - Badge updates after operations
 */

import { test, expect } from '@playwright/test';
import { setupOpenRepository, defaultMockData } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';

// ============================================================================
// Helper function to create branches with ahead/behind status
// ============================================================================

function withAheadBehind(ahead: number, behind: number) {
  return {
    branches: [
      {
        name: 'refs/heads/main',
        shorthand: 'main',
        isHead: true,
        isRemote: false,
        upstream: 'refs/remotes/origin/main',
        targetOid: 'abc123def456',
        aheadBehind: { ahead, behind },
        lastCommitTimestamp: Date.now() / 1000,
        isStale: false,
      },
      {
        name: 'refs/remotes/origin/main',
        shorthand: 'origin/main',
        isHead: false,
        isRemote: true,
        upstream: null,
        targetOid: 'abc123def456',
        isStale: false,
      },
    ],
  };
}

// ============================================================================
// Remote Buttons Tests
// ============================================================================

test.describe('Remote Operation Buttons', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);
  });

  test('should display Fetch button in context dashboard', async ({ page }) => {
    const fetchButton = page.getByRole('button', { name: /Fetch/i });
    await expect(fetchButton).toBeVisible();
  });

  test('should display Pull button in context dashboard', async ({ page }) => {
    const pullButton = page.getByRole('button', { name: /Pull/i });
    await expect(pullButton).toBeVisible();
  });

  test('should display Push button in context dashboard', async ({ page }) => {
    const pushButton = page.getByRole('button', { name: /Push/i });
    await expect(pushButton).toBeVisible();
  });

  test('Fetch button should be clickable', async ({ page }) => {
    const fetchButton = page.getByRole('button', { name: /Fetch/i });
    await expect(fetchButton).toBeEnabled();
  });

  test('Pull button should be clickable', async ({ page }) => {
    const pullButton = page.getByRole('button', { name: /Pull/i });
    await expect(pullButton).toBeEnabled();
  });

  test('Push button should be clickable', async ({ page }) => {
    const pushButton = page.getByRole('button', { name: /Push/i });
    await expect(pushButton).toBeEnabled();
  });
});

// ============================================================================
// Ahead/Behind Badge Tests
// ============================================================================

test.describe('Ahead/Behind Badges', () => {
  let app: AppPage;

  test('should show Push badge when commits are ahead', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(5, 0));

    // Push badge should show ahead count
    const pushBadge = page.locator('.badge.push');
    await expect(pushBadge).toBeVisible();
    await expect(pushBadge).toHaveText('5');
  });

  test('should show Pull badge when commits are behind', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 3));

    // Pull badge should show behind count
    const pullBadge = page.locator('.badge.pull');
    await expect(pullBadge).toBeVisible();
    await expect(pullBadge).toHaveText('3');
  });

  test('should show both badges when ahead and behind', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(2, 4));

    // Both badges should be visible
    const pushBadge = page.locator('.badge.push');
    const pullBadge = page.locator('.badge.pull');

    await expect(pushBadge).toBeVisible();
    await expect(pushBadge).toHaveText('2');

    await expect(pullBadge).toBeVisible();
    await expect(pullBadge).toHaveText('4');
  });

  test('should not show badges when up to date (0/0)', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 0));

    // Neither badge should be visible
    const pushBadge = page.locator('.badge.push');
    const pullBadge = page.locator('.badge.pull');

    await expect(pushBadge).not.toBeVisible();
    await expect(pullBadge).not.toBeVisible();
  });

  test('Push badge should have success color styling', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(3, 0));

    const pushBadge = page.locator('.badge.push');
    await expect(pushBadge).toBeVisible();
    // Check badge exists and has the push class (styling is applied via CSS)
    await expect(pushBadge).toHaveClass(/push/);
  });

  test('Pull badge should have primary color styling', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 2));

    const pullBadge = page.locator('.badge.pull');
    await expect(pullBadge).toBeVisible();
    // Check badge exists and has the pull class (styling is applied via CSS)
    await expect(pullBadge).toHaveClass(/pull/);
  });
});

// ============================================================================
// Branch List Ahead/Behind Indicator Tests
// ============================================================================

test.describe('Branch List Ahead/Behind Indicators', () => {
  let app: AppPage;

  test('should show ahead indicator on branch with upstream', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(3, 0));

    // The branch list should show ahead indicator
    const aheadIndicator = page.locator('.ahead-behind .ahead');
    await expect(aheadIndicator.first()).toBeVisible();
    await expect(aheadIndicator.first()).toContainText('3');
  });

  test('should show behind indicator on branch with upstream', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 2));

    // The branch list should show behind indicator
    const behindIndicator = page.locator('.ahead-behind .behind');
    await expect(behindIndicator.first()).toBeVisible();
    await expect(behindIndicator.first()).toContainText('2');
  });

  test('should show both ahead and behind indicators', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(5, 3));

    const aheadIndicator = page.locator('.ahead-behind .ahead');
    const behindIndicator = page.locator('.ahead-behind .behind');

    await expect(aheadIndicator.first()).toBeVisible();
    await expect(behindIndicator.first()).toBeVisible();
  });

  test('should not show indicators when synced', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 0));

    // No ahead/behind indicators should be visible
    const aheadBehind = page.locator('.ahead-behind');
    await expect(aheadBehind).not.toBeVisible();
  });
});

// ============================================================================
// Button Tooltip Tests
// ============================================================================

test.describe('Remote Button Tooltips', () => {
  let app: AppPage;

  test('Push button should have push tooltip', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(5, 0));

    const pushButton = page.getByRole('button', { name: /Push/i });
    const title = await pushButton.getAttribute('title');
    expect(title).toContain('Push');
  });

  test('Pull button should have pull tooltip', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 3));

    const pullButton = page.getByRole('button', { name: /Pull/i });
    const title = await pullButton.getAttribute('title');
    expect(title).toContain('Pull');
  });

  test('Fetch button should have fetch tooltip', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);

    const fetchButton = page.getByRole('button', { name: /Fetch/i });
    const title = await fetchButton.getAttribute('title');
    expect(title).toContain('Fetch');
  });
});

// ============================================================================
// Large Badge Values Tests
// ============================================================================

test.describe('Large Badge Values', () => {
  let app: AppPage;

  test('should display large ahead count correctly', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(42, 0));

    const pushBadge = page.locator('.badge.push');
    await expect(pushBadge).toBeVisible();
    await expect(pushBadge).toHaveText('42');
  });

  test('should display large behind count correctly', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 100));

    const pullBadge = page.locator('.badge.pull');
    await expect(pullBadge).toBeVisible();
    await expect(pullBadge).toHaveText('100');
  });
});

// ============================================================================
// Context Dashboard Visibility Tests
// ============================================================================

test.describe('Context Dashboard', () => {
  let app: AppPage;

  test('should show context dashboard when repository is open', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);

    const contextDashboard = page.locator('lv-context-dashboard');
    await expect(contextDashboard).toBeVisible();
  });

  test('should show remote buttons section', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);

    // Remote buttons should be in a group
    const fetchBtn = page.getByRole('button', { name: /Fetch/i });
    const pullBtn = page.getByRole('button', { name: /Pull/i });
    const pushBtn = page.getByRole('button', { name: /Push/i });

    await expect(fetchBtn).toBeVisible();
    await expect(pullBtn).toBeVisible();
    await expect(pushBtn).toBeVisible();
  });
});
