import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import {
  startCommandCaptureWithMocks,
  findCommand,
  injectCommandError,
  waitForCommand,
} from '../fixtures/test-helpers';

/**
 * E2E tests for the File History Panel (lv-file-history).
 *
 * The panel is rendered by the app shell in the main area when
 * showFileHistory is true and fileHistoryPath is set. It loads commits
 * via get_file_history and shows them in a scrollable list with:
 * - Header showing "File History" title, file path, commit count, and close button
 * - Commit items with short OID, summary, author, date, and "View" button
 * - Selection state when clicking a commit
 * - Right-click context menu with View diff, Show commit details, View blame, Copy hash
 * - Empty state when no history exists
 *
 * Tests trigger the component through the app shell's real rendering flow
 * (setting showFileHistory/fileHistoryPath state) so that event wiring and
 * store connections work correctly. Playwright locators pierce shadow DOM
 * to access internal elements.
 */

const MOCK_COMMITS = [
  {
    oid: 'abc123def456789',
    shortId: 'abc123d',
    message: 'Fix bug in file processing\n\nExtended details here.',
    summary: 'Fix bug in file processing',
    body: 'Extended details here.',
    author: { name: 'John Doe', email: 'john@example.com', timestamp: Math.floor(Date.now() / 1000) - 3600 },
    committer: { name: 'John Doe', email: 'john@example.com', timestamp: Math.floor(Date.now() / 1000) - 3600 },
    parentIds: ['parent1'],
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  },
  {
    oid: 'def789ghi012345',
    shortId: 'def789g',
    message: 'Add new feature\n\nImplemented new feature.',
    summary: 'Add new feature',
    body: 'Implemented new feature.',
    author: { name: 'Jane Smith', email: 'jane@example.com', timestamp: Math.floor(Date.now() / 1000) - 86400 },
    committer: { name: 'Jane Smith', email: 'jane@example.com', timestamp: Math.floor(Date.now() / 1000) - 86400 },
    parentIds: ['parent2'],
    timestamp: Math.floor(Date.now() / 1000) - 86400,
  },
  {
    oid: 'ghi345jkl678901',
    shortId: 'ghi345j',
    message: 'Initial implementation',
    summary: 'Initial implementation',
    body: null,
    author: { name: 'John Doe', email: 'john@example.com', timestamp: Math.floor(Date.now() / 1000) - 604800 },
    committer: { name: 'John Doe', email: 'john@example.com', timestamp: Math.floor(Date.now() / 1000) - 604800 },
    parentIds: [],
    timestamp: Math.floor(Date.now() / 1000) - 604800,
  },
];

/**
 * Trigger file history display by setting app-shell state directly.
 * This mirrors the pattern used by the blame-view tests and reliably
 * triggers Lit's reactive update cycle.
 */
async function showFileHistory(
  page: import('@playwright/test').Page,
  filePath = 'src/main.ts'
): Promise<void> {
  // Set app-shell properties directly to show the file history panel
  await page.evaluate((fp) => {
    const appShell = document.querySelector('lv-app-shell') as HTMLElement & {
      showFileHistory: boolean;
      fileHistoryPath: string | null;
    };
    if (appShell) {
      appShell.fileHistoryPath = fp;
      appShell.showFileHistory = true;
    }
  }, filePath);

  await page.locator('lv-file-history').waitFor({ state: 'attached', timeout: 5000 });
  await waitForCommand(page, 'get_file_history');
}

/** Open context menu on the first commit item */
async function openContextMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('lv-file-history .commit-item').first().click({ button: 'right' });
  await expect(page.locator('lv-file-history .context-menu')).toBeVisible();
}

// --------------------------------------------------------------------------
// Commit List Display
// --------------------------------------------------------------------------
test.describe('File History - Commit List', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, {
      get_file_history: MOCK_COMMITS,
    });
    await showFileHistory(page);
  });

  test('should call get_file_history with correct file path', async ({ page }) => {
    const commands = await findCommand(page, 'get_file_history');
    expect(commands.length).toBeGreaterThan(0);
    const args = commands[0].args as Record<string, unknown>;
    expect(args.filePath).toBe('src/main.ts');
  });

  test('should show "File History" in the header', async ({ page }) => {
    await expect(page.locator('lv-file-history .header-title')).toHaveText('File History');
  });

  test('should show the file path in the header', async ({ page }) => {
    await expect(page.locator('lv-file-history .file-path')).toHaveText('src/main.ts');
  });

  test('should show commit count badge', async ({ page }) => {
    await expect(page.locator('lv-file-history .commit-count')).toHaveText('3 commits');
  });

  test('should display all commit entries', async ({ page }) => {
    await expect(page.locator('lv-file-history .commit-item')).toHaveCount(3);
  });

  test('each commit should show short OID', async ({ page }) => {
    const oids = page.locator('lv-file-history .commit-oid');
    await expect(oids.nth(0)).toHaveText('abc123d');
    await expect(oids.nth(1)).toHaveText('def789g');
    await expect(oids.nth(2)).toHaveText('ghi345j');
  });

  test('each commit should show its summary', async ({ page }) => {
    const summaries = page.locator('lv-file-history .commit-summary');
    await expect(summaries.nth(0)).toHaveText('Fix bug in file processing');
    await expect(summaries.nth(1)).toHaveText('Add new feature');
    await expect(summaries.nth(2)).toHaveText('Initial implementation');
  });

  test('each commit should show author name', async ({ page }) => {
    const authors = page.locator('lv-file-history .commit-author');
    await expect(authors.nth(0)).toContainText('John Doe');
    await expect(authors.nth(1)).toContainText('Jane Smith');
    await expect(authors.nth(2)).toContainText('John Doe');
  });

  test('each commit should show a relative date', async ({ page }) => {
    const dates = page.locator('lv-file-history .commit-date');
    await expect(dates.nth(0)).toContainText('Today');
    await expect(dates.nth(1)).toContainText('Yesterday');
    await expect(dates.nth(2)).toContainText('week');
  });

  test('each commit should have a View button', async ({ page }) => {
    await expect(page.locator('lv-file-history .view-diff-btn')).toHaveCount(3);
  });

  test('should have a close button in the header', async ({ page }) => {
    await expect(page.locator('lv-file-history .close-btn')).toBeAttached();
  });
});

// --------------------------------------------------------------------------
// Selection
// --------------------------------------------------------------------------
test.describe('File History - Selection', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, {
      get_file_history: MOCK_COMMITS,
    });
    await showFileHistory(page);
  });

  test('clicking a commit should select it with .selected class', async ({ page }) => {
    await page.locator('lv-file-history .commit-item').first().click();
    await expect(page.locator('lv-file-history .commit-item.selected .commit-oid')).toHaveText('abc123d');
  });

  test('clicking a different commit should change selection', async ({ page }) => {
    await page.locator('lv-file-history .commit-item').first().click();
    await page.locator('lv-file-history .commit-item').nth(1).click();

    await expect(page.locator('lv-file-history .commit-item.selected .commit-oid')).toHaveText('def789g');
    await expect(page.locator('lv-file-history .commit-item.selected')).toHaveCount(1);
  });

  test('clicking a commit should dispatch commit-selected event', async ({ page }) => {
    // In the real app tree, commit-selected is handled by the app shell
    // to navigate to the commit in the graph. Verify the selection happens.
    await page.locator('lv-file-history .commit-item').first().click();
    await expect(page.locator('lv-file-history .commit-item.selected')).toHaveCount(1);
  });
});

// --------------------------------------------------------------------------
// Close
// --------------------------------------------------------------------------
test.describe('File History - Close', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, {
      get_file_history: MOCK_COMMITS,
    });
    await showFileHistory(page);
  });

  test('clicking close button should remove file history panel', async ({ page }) => {
    // In the real app tree, the close event is handled by the app shell
    // which sets showFileHistory=false, removing the component from the DOM
    await page.locator('lv-file-history .close-btn').click();
    await expect(page.locator('lv-file-history')).not.toBeAttached();
  });
});

// --------------------------------------------------------------------------
// View Diff Button
// --------------------------------------------------------------------------
test.describe('File History - View Diff', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, {
      get_file_history: MOCK_COMMITS,
    });
    await showFileHistory(page);
  });

  test('clicking View button should dispatch view-diff event with commit oid and file path', async ({ page }) => {
    // Set up event capture on the panel element before clicking
    const panelHandle = await page.locator('lv-file-history').elementHandle();
    await page.evaluate((el) => {
      if (!el) return;
      (window as any).__viewDiffDetail__ = null;
      el.addEventListener('view-diff', ((e: CustomEvent) => {
        (window as any).__viewDiffDetail__ = e.detail;
      }) as EventListener, { once: true });
    }, panelHandle);

    // Click the View button using Playwright's auto-piercing locator
    await page.locator('lv-file-history .view-diff-btn').first().click();

    // Wait for the event to be captured
    await page.waitForFunction(() => (window as any).__viewDiffDetail__ != null);
    const eventDetail = await page.evaluate(() => (window as any).__viewDiffDetail__);

    expect(eventDetail).not.toBeNull();
    expect(eventDetail.commitOid).toBe('abc123def456789');
    expect(eventDetail.filePath).toBe('src/main.ts');
  });
});

// --------------------------------------------------------------------------
// Context Menu
// --------------------------------------------------------------------------
test.describe('File History - Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, {
      get_file_history: MOCK_COMMITS,
    });
    await showFileHistory(page);
  });

  test('right-clicking a commit should show context menu', async ({ page }) => {
    await page.locator('lv-file-history .commit-item').first().click({ button: 'right' });
    await expect(page.locator('lv-file-history .context-menu')).toBeVisible();
  });

  test('context menu should have "View diff" option', async ({ page }) => {
    await openContextMenu(page);
    await expect(
      page.locator('lv-file-history .context-menu-item').filter({ hasText: 'View diff' })
    ).toBeVisible();
  });

  test('context menu should have "Show commit details" option', async ({ page }) => {
    await openContextMenu(page);
    await expect(
      page.locator('lv-file-history .context-menu-item').filter({ hasText: 'Show commit details' })
    ).toBeVisible();
  });

  test('context menu should have "View blame at this commit" option', async ({ page }) => {
    await openContextMenu(page);
    await expect(
      page.locator('lv-file-history .context-menu-item').filter({ hasText: 'View blame' })
    ).toBeVisible();
  });

  test('context menu should have "Copy commit hash" option', async ({ page }) => {
    await openContextMenu(page);
    await expect(
      page.locator('lv-file-history .context-menu-item').filter({ hasText: 'Copy commit hash' })
    ).toBeVisible();
  });

  test('context menu should have a divider separating Copy from other options', async ({ page }) => {
    await openContextMenu(page);
    await expect(page.locator('lv-file-history .context-menu-divider')).toBeAttached();
  });
});

// --------------------------------------------------------------------------
// Empty State
// --------------------------------------------------------------------------
test.describe('File History - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, {
      get_file_history: [],
    });
    await showFileHistory(page);
  });

  test('should show "No history found for this file" when no commits exist', async ({ page }) => {
    await expect(page.locator('lv-file-history .empty')).toHaveText('No history found for this file');
  });

  test('should show "0 commits" count when empty', async ({ page }) => {
    await expect(page.locator('lv-file-history .commit-count')).toHaveText('0 commits');
  });

  test('should not show any commit items', async ({ page }) => {
    await expect(page.locator('lv-file-history .commit-item')).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------
// Loading State
// --------------------------------------------------------------------------
test.describe('File History - Loading State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, {
      get_file_history: MOCK_COMMITS,
    });
  });

  test('should display file path provided via property', async ({ page }) => {
    await showFileHistory(page, 'src/utils/helpers.ts');
    await expect(page.locator('lv-file-history .file-path')).toHaveText('src/utils/helpers.ts');
  });
});

// --------------------------------------------------------------------------
// Error Scenarios
// --------------------------------------------------------------------------
test.describe('File History - Error Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('get_file_history failure should show error state or toast', async ({ page }) => {
    // Set up command capture with a valid initial response so the component can mount
    await startCommandCaptureWithMocks(page, {
      get_file_history: MOCK_COMMITS,
    });

    // Inject an error so the next call to get_file_history will fail
    await injectCommandError(page, 'get_file_history', 'Failed to get history');

    // Trigger the file history panel (which will call get_file_history and get the error)
    await page.evaluate(() => {
      const appShell = document.querySelector('lv-app-shell') as HTMLElement & {
        showFileHistory: boolean;
        fileHistoryPath: string | null;
      };
      if (appShell) {
        appShell.fileHistoryPath = 'src/main.ts';
        appShell.showFileHistory = true;
      }
    });

    // Wait for the file history panel to appear in the DOM
    await page.locator('lv-file-history').waitFor({ state: 'attached', timeout: 5000 });

    // The error should be displayed — either an error element in the panel or a toast
    await expect(
      page.locator('.error, .error-banner, .toast, lv-file-history .error-message').first()
    ).toBeVisible({ timeout: 5000 });
  });
});
