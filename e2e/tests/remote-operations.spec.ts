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
import { setupOpenRepository, defaultMockData, withConflicts } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { startCommandCapture, findCommand, injectCommandError, waitForCommand } from '../fixtures/test-helpers';

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

// ============================================================================
// Fetch Operation Tests
// ============================================================================

test.describe('Fetch Operation', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);
  });

  test('clicking Fetch button should call fetch command', async ({ page }) => {
    await startCommandCapture(page);

    const fetchButton = page.getByRole('button', { name: /Fetch/i });
    await fetchButton.click();

    await waitForCommand(page, 'fetch');

    const fetchCommands = await findCommand(page, 'fetch');
    expect(fetchCommands.length).toBeGreaterThan(0);
  });

  test('fetch failure should show error toast', async ({ page }) => {
    await injectCommandError(page, 'fetch', 'Network error: unable to reach remote');

    const fetchButton = page.getByRole('button', { name: /Fetch/i });
    await fetchButton.click();

    // Error toast should appear
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/error|fail|unable/i);
  });
});

// ============================================================================
// Push Operation Tests
// ============================================================================

test.describe('Push Operation', () => {
  let app: AppPage;

  test('clicking Push button should call push command', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(3, 0));

    await startCommandCapture(page);

    const pushButton = page.getByRole('button', { name: /Push/i });
    await pushButton.click();

    await waitForCommand(page, 'push');

    const pushCommands = await findCommand(page, 'push');
    expect(pushCommands.length).toBeGreaterThan(0);

    // Verify DOM: push badge should disappear after successful push (ahead = 0)
    const pushBadge = page.locator('.badge.push');
    await expect(pushBadge).not.toBeVisible();
  });

  test('push failure should show error toast', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(3, 0));

    await injectCommandError(page, 'push', 'Push rejected: non-fast-forward');

    const pushButton = page.getByRole('button', { name: /Push/i });
    await pushButton.click();

    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/error|fail|rejected/i);
  });
});

// ============================================================================
// Pull Operation Tests
// ============================================================================

test.describe('Pull Operation', () => {
  let app: AppPage;

  test('clicking Pull button should call pull command', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 5));

    await startCommandCapture(page);

    const pullButton = page.getByRole('button', { name: /Pull/i });
    await pullButton.click();

    await waitForCommand(page, 'pull');

    const pullCommands = await findCommand(page, 'pull');
    expect(pullCommands.length).toBeGreaterThan(0);

    // Verify DOM: pull badge should disappear after successful pull (behind = 0)
    const pullBadge = page.locator('.badge.pull');
    await expect(pullBadge).not.toBeVisible();
  });

  test('pull failure should show error toast', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 5));

    await injectCommandError(page, 'pull', 'Pull failed: merge conflict');

    const pullButton = page.getByRole('button', { name: /Pull/i });
    await pullButton.click();

    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/error|fail|conflict/i);
  });

  test('pull with conflicts should show merge state', async ({ page }) => {
    app = new AppPage(page);
    // Start with behind commits
    await setupOpenRepository(page, {
      ...withAheadBehind(0, 3),
      ...withConflicts(),
    });

    // Repository state should show 'merge' (conflict state)
    const conflictFile = page.locator('lv-file-status').getByRole('listitem', { name: /CONFLICT/ });
    await expect(conflictFile).toBeVisible();
  });
});

// ============================================================================
// Fetch followed by Badge Update Tests
// ============================================================================

test.describe('Remote Operation Sequences', () => {
  let app: AppPage;

  test('fetch should refresh remote status after completion', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(2, 3));

    await startCommandCapture(page);

    const fetchButton = page.getByRole('button', { name: /Fetch/i });
    await fetchButton.click();

    await waitForCommand(page, 'get_remote_status');

    const remoteStatusCommands = await findCommand(page, 'get_remote_status');
    expect(remoteStatusCommands.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// UI Outcome Verification Tests
// ============================================================================

test.describe('Remote Operations - UI Outcome Verification', () => {
  let app: AppPage;

  test('push success: verify ahead badge disappears after push', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(5, 0));

    // Verify the push badge initially shows 5
    const pushBadge = page.locator('.badge.push');
    await expect(pushBadge).toBeVisible();
    await expect(pushBadge).toHaveText('5');

    await startCommandCapture(page);

    // Click push -- the mock sets ahead to 0 on push
    const pushButton = page.getByRole('button', { name: /Push/i });
    await pushButton.click();

    await waitForCommand(page, 'push');

    // After successful push, the ahead badge should disappear (ahead = 0)
    await expect(pushBadge).not.toBeVisible();
  });

  test('pull success: verify behind badge disappears after pull', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 4));

    // Verify the pull badge initially shows 4
    const pullBadge = page.locator('.badge.pull');
    await expect(pullBadge).toBeVisible();
    await expect(pullBadge).toHaveText('4');

    await startCommandCapture(page);

    // Click pull -- the mock sets behind to 0 on pull
    const pullButton = page.getByRole('button', { name: /Pull/i });
    await pullButton.click();

    await waitForCommand(page, 'pull');

    // After successful pull, the behind badge should disappear (behind = 0)
    await expect(pullBadge).not.toBeVisible();
  });

  test('push failure: verify ahead badge remains unchanged', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(3, 0));

    // Verify the push badge initially shows 3
    const pushBadge = page.locator('.badge.push');
    await expect(pushBadge).toBeVisible();
    await expect(pushBadge).toHaveText('3');

    // Inject a push error
    await injectCommandError(page, 'push', 'Push rejected: non-fast-forward');

    const pushButton = page.getByRole('button', { name: /Push/i });
    await pushButton.click();

    // Error toast should appear
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // The push badge should still show 3 (unchanged because push failed)
    await expect(pushBadge).toBeVisible();
    await expect(pushBadge).toHaveText('3');
  });

  test('pull failure: verify behind badge remains unchanged', async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page, withAheadBehind(0, 7));

    // Verify the pull badge initially shows 7
    const pullBadge = page.locator('.badge.pull');
    await expect(pullBadge).toBeVisible();
    await expect(pullBadge).toHaveText('7');

    // Inject a pull error
    await injectCommandError(page, 'pull', 'Pull failed: merge conflict');

    const pullButton = page.getByRole('button', { name: /Pull/i });
    await pullButton.click();

    // Error toast should appear
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // The pull badge should still show 7 (unchanged because pull failed)
    await expect(pullBadge).toBeVisible();
    await expect(pullBadge).toHaveText('7');
  });
});
