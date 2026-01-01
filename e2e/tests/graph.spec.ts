import { test, expect } from '@playwright/test';
import { setupOpenRepository, defaultMockData } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { GraphPanelPage } from '../pages/panels.page';

test.describe('Commit Graph', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page);
  });

  test('should display graph canvas', async () => {
    await expect(graph.canvas).toBeVisible();
  });

  test('graph should be the main content area', async () => {
    await app.waitForReady();
    await expect(graph.canvas).toBeVisible();
  });
});

test.describe('Graph with Multiple Commits', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    // Setup with multiple commits
    await setupOpenRepository(page, {
      commits: [
        {
          oid: 'commit1',
          shortId: 'commit1',
          message: 'First commit',
          summary: 'First commit',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          parentIds: [],
          timestamp: Date.now() / 1000,
        },
        {
          oid: 'commit2',
          shortId: 'commit2',
          message: 'Second commit',
          summary: 'Second commit',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 3600 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 3600 },
          parentIds: ['commit1'],
          timestamp: Date.now() / 1000 - 3600,
        },
        {
          oid: 'commit3',
          shortId: 'commit3',
          message: 'Third commit',
          summary: 'Third commit',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 7200 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 7200 },
          parentIds: ['commit2'],
          timestamp: Date.now() / 1000 - 7200,
        },
      ],
    });
  });

  test('should display graph with commits', async () => {
    await expect(graph.canvas).toBeVisible();
  });

  test('should support keyboard navigation down', async () => {
    await graph.navigateDown();
    // Navigation should work without errors
    await expect(graph.canvas).toBeVisible();
  });

  test('should support keyboard navigation up', async () => {
    await graph.navigateDown();
    await graph.navigateUp();
    await expect(graph.canvas).toBeVisible();
  });

  test('should support Home key to go to first commit', async () => {
    await graph.navigateToFirst();
    await expect(graph.canvas).toBeVisible();
  });

  test('should support End key to go to last commit', async () => {
    await graph.navigateToLast();
    await expect(graph.canvas).toBeVisible();
  });
});

test.describe('Diff Overlay', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page);
  });

  test('diff overlay should not be visible by default', async () => {
    const isVisible = await graph.isDiffVisible();
    expect(isVisible).toBe(false);
  });
});

test.describe('Blame Overlay', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page);
  });

  test('blame overlay should not be visible by default', async () => {
    const isVisible = await graph.isBlameVisible();
    expect(isVisible).toBe(false);
  });
});

test.describe('Graph Scrolling', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    // Setup with many commits to test scrolling
    const commits = Array.from({ length: 50 }, (_, i) => ({
      oid: `commit${i}`,
      shortId: `commit${i}`.slice(0, 7),
      message: `Commit ${i}`,
      summary: `Commit ${i}`,
      body: null,
      author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - i * 3600 },
      committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - i * 3600 },
      parentIds: i > 0 ? [`commit${i - 1}`] : [],
      timestamp: Date.now() / 1000 - i * 3600,
    }));

    await setupOpenRepository(page, { commits });
  });

  test('should handle large commit history', async () => {
    await expect(graph.canvas).toBeVisible();
  });

  test('should navigate through commits with arrow keys', async () => {
    // Navigate down multiple times
    for (let i = 0; i < 5; i++) {
      await graph.navigateDown();
    }
    await expect(graph.canvas).toBeVisible();
  });
});

test.describe('Empty Repository Graph', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    // Setup with no commits
    await setupOpenRepository(page, {
      commits: [],
      branches: [],
    });
  });

  test('should handle empty commit history', async () => {
    // Should still render the canvas area
    await expect(graph.canvas).toBeVisible();
  });
});
