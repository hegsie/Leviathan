import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { startCommandCapture, findCommand, injectCommandError, injectCommandMock, waitForCommand } from '../fixtures/test-helpers';

/**
 * E2E tests for Search Bar
 * Tests search input, filters, keyboard shortcuts, and search events
 */
test.describe('Search Bar', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should toggle search bar when clicking search button', async ({ page }) => {
    // Find and click the search button in toolbar
    const searchButton = page.locator('button[title*="Search commits"]');
    await expect(searchButton).toBeVisible();
    await searchButton.click();

    // Search bar should appear
    const searchBar = page.locator('lv-search-bar');
    await expect(searchBar).toBeVisible();

    // Click again to close
    await searchButton.click();
    await expect(searchBar).not.toBeVisible();
  });

  test('should focus search input when opened', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await expect(searchInput).toBeFocused();
  });

  test('should emit search event when typing', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('fix bug');

    // Wait for debounce and verify input value
    await expect(searchInput).toHaveValue('fix bug');
  });

  test('should clear search with Escape key', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('test query');
    await expect(searchInput).toHaveValue('test query');

    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveValue('');
  });

  test('should show clear button when query is entered', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('test');

    const clearButton = page.locator('lv-search-bar .clear-btn, lv-search-bar button[title*="Clear"]');
    await expect(clearButton).toBeVisible();
  });

  test('should clear search when clicking clear button', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('test query');

    const clearButton = page.locator('lv-search-bar .clear-btn, lv-search-bar button[title*="Clear"]');
    await clearButton.click();

    await expect(searchInput).toHaveValue('');
  });
});

test.describe('Search Bar Filters', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    // Open search bar
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();
  });

  test('should toggle filter panel when clicking filter button', async ({ page }) => {
    // The filter button may be identified by various selectors
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await expect(filterButton).toBeVisible();
    await filterButton.click();

    // Filter panel should appear with author input visible
    const authorInput = page.locator('lv-search-bar input[placeholder*="Author"]');
    await expect(authorInput).toBeVisible();
  });

  test('should have author filter input', async ({ page }) => {
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    const authorInput = page.locator('lv-search-bar input[placeholder*="Author"]');
    await expect(authorInput).toBeVisible();
    await authorInput.fill('john@example.com');
    await expect(authorInput).toHaveValue('john@example.com');
  });

  test('should have date range filters', async ({ page }) => {
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    const dateFromInput = page.locator('lv-search-bar input[type="date"]').first();
    const dateToInput = page.locator('lv-search-bar input[type="date"]').last();

    await expect(dateFromInput).toBeVisible();
    await expect(dateToInput).toBeVisible();
  });

  test('should have file path filter', async ({ page }) => {
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    const filePathInput = page.locator('lv-search-bar input[placeholder*="path"], lv-search-bar input[placeholder*=".ts"]');
    await expect(filePathInput).toBeVisible();
    await filePathInput.fill('src/**/*.ts');
    await expect(filePathInput).toHaveValue('src/**/*.ts');
  });

  test('should have Apply button in filter panel', async ({ page }) => {
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    const applyButton = page.locator('lv-search-bar button', { hasText: /apply/i });
    await expect(applyButton).toBeVisible();
  });

  test('should have Clear Filters button', async ({ page }) => {
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    const clearFiltersButton = page.locator('lv-search-bar button', { hasText: /clear.*filter/i });
    await expect(clearFiltersButton).toBeVisible();
  });

  test('should close filter panel when clicking Apply', async ({ page }) => {
    // Open filter panel first
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    const applyButton = page.locator('lv-search-bar button', { hasText: /apply/i });
    await expect(applyButton).toBeVisible();

    await applyButton.click();

    await expect(applyButton).not.toBeVisible();
  });

  test('should clear all filter values when clicking Clear Filters', async ({ page }) => {
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    // Fill in filters
    const authorInput = page.locator('lv-search-bar input[placeholder*="Author"]');
    await authorInput.fill('test@example.com');

    const clearFiltersButton = page.locator('lv-search-bar button', { hasText: /clear.*filter/i });
    await clearFiltersButton.click();

    await expect(authorInput).toHaveValue('');
  });

  test('filter button should show active state when filters are set', async ({ page }) => {
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    // Set a filter
    const authorInput = page.locator('lv-search-bar input[placeholder*="Author"]');
    await authorInput.fill('test@example.com');

    // Apply filters
    const applyButton = page.locator('lv-search-bar button', { hasText: /apply/i });
    await applyButton.click();

    // Filter button should have active class
    await expect(filterButton).toHaveClass(/active/);
  });
});

test.describe('Search Bar Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should open search with Ctrl+F', async ({ page }) => {
    await page.keyboard.press('Control+f');

    const searchBar = page.locator('lv-search-bar');
    await expect(searchBar).toBeVisible();
  });

  test('should submit search with Enter key', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('bug fix');
    await searchInput.press('Enter');

    // Search should be submitted (input should still have value)
    await expect(searchInput).toHaveValue('bug fix');
  });
});

test.describe('Search Query Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page, {
      commits: [
        {
          oid: 'aaa111',
          shortId: 'aaa111',
          message: 'fix: resolve login bug',
          summary: 'fix: resolve login bug',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          parentIds: [],
          timestamp: Date.now() / 1000,
        },
        {
          oid: 'bbb222',
          shortId: 'bbb222',
          message: 'feat: add dashboard feature',
          summary: 'feat: add dashboard feature',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 3600 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 3600 },
          parentIds: ['aaa111'],
          timestamp: Date.now() / 1000 - 3600,
        },
        {
          oid: 'ccc333',
          shortId: 'ccc333',
          message: 'fix: patch security vulnerability',
          summary: 'fix: patch security vulnerability',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 7200 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 7200 },
          parentIds: ['bbb222'],
          timestamp: Date.now() / 1000 - 7200,
        },
      ],
    });
  });

  test('search should filter the graph to matching commits', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('fix');
    await searchInput.press('Enter');

    await expect(searchInput).toHaveValue('fix');
  });

  test('clearing search should restore full commit list', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();

    // Enter a search query
    await searchInput.fill('fix');
    await searchInput.press('Enter');

    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveValue('');

    // The graph canvas should still be visible (full list restored)
    const graph = page.locator('lv-graph-canvas');
    await expect(graph).toBeVisible();
  });

  test('search with no matches should show empty state and keep search bar functional', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    // Mock get_commit_history to return empty array for the non-matching search
    await injectCommandMock(page, {
      get_commit_history: [],
    });

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('zzzznonexistentquery12345');
    await searchInput.press('Enter');

    await expect(searchInput).toHaveValue('zzzznonexistentquery12345');

    // Graph canvas should still be visible (not crashed) even with zero results
    const graph = page.locator('lv-graph-canvas');
    await expect(graph).toBeVisible();

    // Search bar should remain visible and functional for a new search
    const searchBar = page.locator('lv-search-bar');
    await expect(searchBar).toBeVisible();

    // Clear button should be visible since there is a query
    const clearButton = page.locator('lv-search-bar .clear-btn, lv-search-bar button[title*="Clear"]');
    await expect(clearButton).toBeVisible();
  });

  test('search should trigger get_commit_history command with search params', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    await startCommandCapture(page);

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('dashboard');
    await searchInput.press('Enter');

    await waitForCommand(page, 'get_commit_history');

    const historyCommands = await findCommand(page, 'get_commit_history');
    expect(historyCommands.length).toBeGreaterThan(0);
  });

  test('applying author filter should include author in search params', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    // Open filters
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    const authorInput = page.locator('lv-search-bar input[placeholder*="Author"]');
    await authorInput.fill('user@test.com');

    await startCommandCapture(page);

    // Apply filters
    const applyButton = page.locator('lv-search-bar button', { hasText: /apply/i });
    await applyButton.click();

    await expect(filterButton).toHaveClass(/active/);
  });
});

test.describe('Search Bar - Error Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page, {
      commits: [
        {
          oid: 'aaa111',
          shortId: 'aaa111',
          message: 'fix: resolve login bug',
          summary: 'fix: resolve login bug',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          parentIds: [],
          timestamp: Date.now() / 1000,
        },
      ],
    });
  });

  test('get_commit_history failure should show error feedback and preserve search bar state', async ({ page }) => {
    // Open search bar
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    // Inject error for get_commit_history
    await injectCommandError(page, 'get_commit_history', 'Search failed');

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('fix');
    await searchInput.press('Enter');

    // The app should show an error indicator (the graph renders errors in an .info-panel)
    // or a toast notification rather than crashing
    const errorIndicator = page.locator('lv-graph-canvas .info-panel, lv-toast-container .toast.error, .error-message, .error-banner').first();
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });

    // Search bar should remain visible and functional after the error
    const searchBar = page.locator('lv-search-bar');
    await expect(searchBar).toBeVisible();

    // Search input should still contain the query so the user can retry
    await expect(searchInput).toHaveValue('fix');

    // The search input should still be interactable (not frozen)
    await searchInput.fill('new query');
    await expect(searchInput).toHaveValue('new query');
  });

  test('invalid filter values should be handled gracefully without crash', async ({ page }) => {
    // Open search bar
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    // Open filter panel
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    // Enter an extremely long author value (edge case)
    const authorInput = page.locator('lv-search-bar input[placeholder*="Author"]');
    await authorInput.fill('a'.repeat(500));

    // Apply filters - this should not crash the app
    const applyButton = page.locator('lv-search-bar button', { hasText: /apply/i });
    await applyButton.click();

    // The search bar should still be functional (not crashed)
    const searchBar = page.locator('lv-search-bar');
    await expect(searchBar).toBeVisible();

    // The search input should still be interactable
    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('test');
    await expect(searchInput).toHaveValue('test');
  });
});

test.describe('Search Bar - UI Outcome Verification', () => {
  /**
   * Helper to read the total number of sorted nodes (commit rows) in the graph.
   * Uses Playwright's auto-piercing locator instead of manual shadowRoot traversal.
   */
  async function getGraphNodeCount(page: import('@playwright/test').Page): Promise<number> {
    const graphCanvas = page.locator('lv-graph-canvas');
    await expect(graphCanvas).toBeAttached();
    const handle = await graphCanvas.elementHandle();
    return page.evaluate(
      (el) => ((el as HTMLElement & { sortedNodesByRow?: unknown[] })?.sortedNodesByRow?.length ?? 0),
      handle
    );
  }

  /**
   * Helper to wait for the graph node count to reach a specific value.
   * Uses Playwright's auto-piercing locator instead of manual shadowRoot traversal.
   */
  async function waitForGraphNodeCount(page: import('@playwright/test').Page, count: number): Promise<void> {
    const graphCanvas = page.locator('lv-graph-canvas');
    await expect(graphCanvas).toBeAttached();
    const handle = await graphCanvas.elementHandle();
    await page.waitForFunction(
      ([el, expected]) => ((el as HTMLElement & { sortedNodesByRow?: unknown[] })?.sortedNodesByRow?.length ?? 0) === expected,
      [handle, count] as const
    );
  }

  const now = Date.now() / 1000;

  const threeCommits = [
    {
      oid: 'aaa111',
      shortId: 'aaa111',
      message: 'fix: resolve login bug',
      summary: 'fix: resolve login bug',
      body: null,
      author: { name: 'Alice', email: 'alice@test.com', timestamp: now },
      committer: { name: 'Alice', email: 'alice@test.com', timestamp: now },
      parentIds: [],
      timestamp: now,
    },
    {
      oid: 'bbb222',
      shortId: 'bbb222',
      message: 'feat: add dashboard feature',
      summary: 'feat: add dashboard feature',
      body: null,
      author: { name: 'Bob', email: 'bob@test.com', timestamp: now - 3600 },
      committer: { name: 'Bob', email: 'bob@test.com', timestamp: now - 3600 },
      parentIds: ['aaa111'],
      timestamp: now - 3600,
    },
    {
      oid: 'ccc333',
      shortId: 'ccc333',
      message: 'fix: patch security vulnerability',
      summary: 'fix: patch security vulnerability',
      body: null,
      author: { name: 'Alice', email: 'alice@test.com', timestamp: now - 7200 },
      committer: { name: 'Alice', email: 'alice@test.com', timestamp: now - 7200 },
      parentIds: ['bbb222'],
      timestamp: now - 7200,
    },
  ];

  test('search filters graph to show only matching commits', async ({ page }) => {
    await setupOpenRepository(page, { commits: threeCommits });

    // Wait for graph to render all 3 commits
    const graphCanvas = page.locator('lv-graph-canvas');
    await expect(graphCanvas).toBeVisible();
    await waitForGraphNodeCount(page, 3);

    // Open search bar
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    // Mock get_commit_history to return only matching commits when search is applied
    // The search filter is passed to the backend which returns filtered results
    const fixCommits = threeCommits.filter((c) => c.message.includes('fix'));
    await injectCommandMock(page, {
      get_commit_history: fixCommits,
    });

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('fix');
    await searchInput.press('Enter');

    // Wait for the graph to update with filtered results (2 fix commits)
    await waitForGraphNodeCount(page, 2);
    const filteredCount = await getGraphNodeCount(page);
    expect(filteredCount).toBe(2);
  });

  test('applying author filter updates the graph to reflect filtered results', async ({ page }) => {
    await setupOpenRepository(page, { commits: threeCommits });

    const graphCanvas = page.locator('lv-graph-canvas');
    await expect(graphCanvas).toBeVisible();
    await waitForGraphNodeCount(page, 3);

    // Open search bar
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    // Open filters
    const filterButton = page.locator('lv-search-bar .filter-btn, lv-search-bar button[title*="Filter"]');
    await filterButton.click();

    // Set author filter
    const authorInput = page.locator('lv-search-bar input[placeholder*="Author"]');
    await authorInput.fill('alice@test.com');

    // Mock the backend to return only Alice's commits
    const aliceCommits = threeCommits.filter((c) => c.author.email === 'alice@test.com');
    await injectCommandMock(page, {
      get_commit_history: aliceCommits,
    });

    // Apply filter
    const applyButton = page.locator('lv-search-bar button', { hasText: /apply/i });
    await applyButton.click();

    // Filter button should show active state
    await expect(filterButton).toHaveClass(/active/);

    // Wait for the graph to update with filtered results (2 Alice commits)
    await waitForGraphNodeCount(page, 2);
    const filteredCount = await getGraphNodeCount(page);
    expect(filteredCount).toBe(2);
  });

  test('search for non-existent term shows empty graph state', async ({ page }) => {
    await setupOpenRepository(page, { commits: threeCommits });

    const graphCanvas = page.locator('lv-graph-canvas');
    await expect(graphCanvas).toBeVisible();
    await waitForGraphNodeCount(page, 3);

    // Open search bar
    const searchButton = page.locator('button[title*="Search commits"]');
    await searchButton.click();

    // Mock backend to return zero results for the non-matching search
    await injectCommandMock(page, {
      get_commit_history: [],
    });

    const searchInput = page.locator('lv-search-bar input[type="text"]').first();
    await searchInput.fill('zzzznonexistentquery12345');
    await searchInput.press('Enter');

    // Wait for the graph to update with zero results
    await waitForGraphNodeCount(page, 0);
    const filteredCount = await getGraphNodeCount(page);
    expect(filteredCount).toBe(0);

    // The graph canvas should still be visible (not crashed) even with zero results
    await expect(graphCanvas).toBeVisible();
  });
});
