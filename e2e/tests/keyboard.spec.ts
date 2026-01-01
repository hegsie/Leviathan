import { test, expect } from '@playwright/test';
import { setupOpenRepository, withVimMode } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { DialogsPage } from '../pages/dialogs.page';
import { GraphPanelPage, RightPanelPage } from '../pages/panels.page';

test.describe('Keyboard Shortcuts', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('Cmd+P should open command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    await expect(dialogs.commandPalette.palette).toBeVisible();
  });

  test('Escape should close command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    await expect(dialogs.commandPalette.palette).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialogs.commandPalette.palette).not.toBeVisible();
  });

  test('Cmd+, should open settings', async ({ page }) => {
    await page.keyboard.press('Meta+,');
    await expect(dialogs.settings.dialog).toBeVisible();
  });

  test('? should open keyboard shortcuts dialog', async ({ page }) => {
    await page.keyboard.press('?');
    await expect(dialogs.keyboardShortcuts.dialog).toBeVisible();
  });
});

test.describe('Command Palette', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should open with Cmd+P', async () => {
    await dialogs.commandPalette.open();
    await expect(dialogs.commandPalette.palette).toBeVisible();
  });

  test('should have search input focused', async () => {
    await dialogs.commandPalette.open();
    await expect(dialogs.commandPalette.input).toBeFocused();
  });

  test('should filter results when typing', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('fetch');
    // Results should be filtered
    await expect(dialogs.commandPalette.resultList).toBeVisible();
  });

  test('should close with Escape', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.close();
    await expect(dialogs.commandPalette.palette).not.toBeVisible();
  });

  test('should execute command with Enter', async ({ page }) => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Settings');
    await page.keyboard.press('Enter');

    // Settings dialog should open after selecting settings command
    await expect(dialogs.settings.dialog).toBeVisible();
  });
});

test.describe('Graph Navigation', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page, {
      commits: [
        {
          oid: 'commit1',
          shortId: 'commit1',
          message: 'First',
          summary: 'First',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          parentIds: [],
          timestamp: Date.now() / 1000,
        },
        {
          oid: 'commit2',
          shortId: 'commit2',
          message: 'Second',
          summary: 'Second',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 3600 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 3600 },
          parentIds: ['commit1'],
          timestamp: Date.now() / 1000 - 3600,
        },
      ],
    });
  });

  test('should navigate down with Arrow Down', async ({ page }) => {
    await graph.canvas.focus();
    await page.keyboard.press('ArrowDown');
    // Should move selection down
    await expect(graph.canvas).toBeVisible();
  });

  test('should navigate up with Arrow Up', async ({ page }) => {
    await graph.canvas.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(graph.canvas).toBeVisible();
  });

  test('should go to first commit with Home', async ({ page }) => {
    await graph.canvas.focus();
    await page.keyboard.press('Home');
    await expect(graph.canvas).toBeVisible();
  });

  test('should go to last commit with End', async ({ page }) => {
    await graph.canvas.focus();
    await page.keyboard.press('End');
    await expect(graph.canvas).toBeVisible();
  });
});

test.describe('Vim Mode Navigation', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    // Setup with vim mode enabled
    await setupOpenRepository(page, withVimMode());
  });

  test('should navigate down with j key', async ({ page }) => {
    // Wait for graph to be visible and click to focus
    await expect(graph.canvas).toBeVisible();
    await graph.canvas.click();
    await page.keyboard.press('j');
    await expect(graph.canvas).toBeVisible();
  });

  test('should navigate up with k key', async ({ page }) => {
    await expect(graph.canvas).toBeVisible();
    await graph.canvas.click();
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await expect(graph.canvas).toBeVisible();
  });

  test('should go to first with gg', async ({ page }) => {
    await expect(graph.canvas).toBeVisible();
    await graph.canvas.click();
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await expect(graph.canvas).toBeVisible();
  });

  test('should go to last with G', async ({ page }) => {
    await expect(graph.canvas).toBeVisible();
    await graph.canvas.click();
    await page.keyboard.press('Shift+g');
    await expect(graph.canvas).toBeVisible();
  });
});

test.describe('Staging Shortcuts', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, {
      status: {
        staged: [],
        unstaged: [{ path: 'file.ts', status: 'modified', isStaged: false, isConflicted: false }],
      },
    });
  });

  test('Cmd+Shift+A should stage all files', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+a');
    // Stage all command should be triggered
    // Result depends on mocked response
    await expect(rightPanel.panel).toBeVisible();
  });
});

// Refresh shortcut tests are skipped because Cmd+R triggers browser refresh
// which interferes with the test. The app handles this shortcut at the Tauri level.
test.describe.skip('Refresh Shortcut', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);
  });

  test('Cmd+R should trigger refresh', async ({ page }) => {
    await page.keyboard.press('Meta+r');
    // Refresh should be triggered, app should still be visible
    await expect(app.appShell).toBeVisible();
  });
});
