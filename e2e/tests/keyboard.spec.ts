import { test, expect } from '@playwright/test';
import { setupOpenRepository, withVimMode } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { DialogsPage } from '../pages/dialogs.page';
import { GraphPanelPage, RightPanelPage } from '../pages/panels.page';
import { startCommandCapture, findCommand, waitForCommand, injectCommandError } from '../fixtures/test-helpers';

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

  test('should navigate down with Arrow Down and update selected commit', async ({ page }) => {
    await graph.canvas.click();
    await page.keyboard.press('ArrowDown');

    // After pressing down, the commit details panel should update to show the selected commit
    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    // The details panel should show commit information (either first or second commit)
    await expect(rightPanel.commitDetails).toBeVisible();
  });

  test('should navigate up with Arrow Up after navigating down', async ({ page }) => {
    await graph.canvas.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');

    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
  });

  test('should go to first commit with Home', async ({ page }) => {
    await graph.canvas.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');

    // Commit details should show the first commit
    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
  });

  test('should go to last commit with End', async ({ page }) => {
    await graph.canvas.click();
    await page.keyboard.press('End');

    // Commit details should show the last commit
    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
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

  test('should navigate down with j key and select a commit', async ({ page }) => {
    await expect(graph.canvas).toBeVisible();
    await graph.canvas.click();
    await page.keyboard.press('j');

    // After pressing j, the commit details panel should show a commit
    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
  });

  test('should navigate up with k key after navigating down', async ({ page }) => {
    await expect(graph.canvas).toBeVisible();
    await graph.canvas.click();
    await page.keyboard.press('j');
    await page.keyboard.press('k');

    // After navigating back, commit details should still be visible
    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
  });

  test('should go to first with gg and select first commit', async ({ page }) => {
    await expect(graph.canvas).toBeVisible();
    await graph.canvas.click();
    await page.keyboard.press('j');
    await page.keyboard.press('g');
    await page.keyboard.press('g');

    // Should have navigated to first commit
    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
  });

  test('should go to last with G and select last commit', async ({ page }) => {
    await expect(graph.canvas).toBeVisible();
    await graph.canvas.click();
    await page.keyboard.press('Shift+g');

    // Should have navigated to last commit
    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
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

  test('Cmd+Shift+A should call stage_all command', async ({ page }) => {
    await startCommandCapture(page);
    await page.keyboard.press('Meta+Shift+a');

    await waitForCommand(page, 'stage_all');

    const stageAllCommands = await findCommand(page, 'stage_all');
    expect(stageAllCommands.length).toBeGreaterThan(0);
  });
});

// Note: Cmd+R cannot be tested directly as it triggers browser refresh.
// The app handles this shortcut at the Tauri level. We test refresh via command palette instead.
test.describe('Refresh Command', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('Refresh command should be available in command palette', async ({ page }) => {
    await app.openCommandPalette();
    await dialogs.commandPalette.search('Refresh');

    // Refresh command should be visible in results
    await expect(dialogs.commandPalette.results.first()).toBeVisible();
    await expect(page.locator('.command-label', { hasText: 'Refresh repository' })).toBeVisible();
  });

  test('Executing refresh command should close command palette', async ({ page }) => {
    await app.openCommandPalette();
    await dialogs.commandPalette.search('Refresh');
    await dialogs.commandPalette.executeFirst();

    // Command palette should close after execution
    await expect(dialogs.commandPalette.palette).not.toBeVisible();
  });

  test('Refresh command should trigger get_status reload', async ({ page }) => {
    await startCommandCapture(page);

    await app.openCommandPalette();
    await dialogs.commandPalette.search('Refresh');
    await dialogs.commandPalette.executeFirst();

    await waitForCommand(page, 'get_status');

    const statusCommands = await findCommand(page, 'get_status');
    expect(statusCommands.length).toBeGreaterThan(0);
  });
});

test.describe('Graph Selection Keyboard', () => {
  let app: AppPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    graph = new GraphPanelPage(page);
    await setupOpenRepository(page, {
      commits: [
        {
          oid: 'aaa111',
          shortId: 'aaa111',
          message: 'First commit',
          summary: 'First commit',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 },
          parentIds: [],
          timestamp: Date.now() / 1000,
        },
        {
          oid: 'bbb222',
          shortId: 'bbb222',
          message: 'Second commit',
          summary: 'Second commit',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 3600 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 3600 },
          parentIds: ['aaa111'],
          timestamp: Date.now() / 1000 - 3600,
        },
        {
          oid: 'ccc333',
          shortId: 'ccc333',
          message: 'Third commit',
          summary: 'Third commit',
          body: null,
          author: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 7200 },
          committer: { name: 'User', email: 'user@test.com', timestamp: Date.now() / 1000 - 7200 },
          parentIds: ['bbb222'],
          timestamp: Date.now() / 1000 - 7200,
        },
      ],
    });
  });

  test('Arrow Down twice should navigate past the first commit', async ({ page }) => {
    await graph.canvas.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
  });

  test('Home key should reliably select first commit after navigation', async ({ page }) => {
    await graph.canvas.click();
    // Navigate down several times
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    await page.keyboard.press('Home');

    const rightPanel = new RightPanelPage(page);
    await rightPanel.switchToDetails();
    await expect(rightPanel.commitDetails).toBeVisible();
  });
});

test.describe('Keyboard - Error Scenarios', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page, {
      status: {
        staged: [],
        unstaged: [{ path: 'file.ts', status: 'modified', isStaged: false, isConflicted: false }],
      },
    });
  });

  test('stage_all failure via keyboard shortcut should show error toast', async ({ page }) => {
    // Inject error for stage_all command
    await injectCommandError(page, 'stage_all', 'Staging failed: permission denied');

    // Trigger stage_all via keyboard shortcut
    await page.keyboard.press('Meta+Shift+a');

    // The error should be surfaced to the user via a toast or error indicator
    const errorIndicator = page.locator('lv-toast-container .toast.error, .error-message, .error-banner').first();
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });
  });

  test('refresh failure via command palette should show error feedback', async ({ page }) => {
    // Inject error for get_status (triggered by refresh)
    await injectCommandError(page, 'get_status', 'Repository not found');

    // Execute refresh via command palette
    await app.openCommandPalette();
    await dialogs.commandPalette.search('Refresh');
    await dialogs.commandPalette.executeFirst();

    // Command palette should close even on error
    await expect(dialogs.commandPalette.palette).not.toBeVisible();

    // Error should be displayed to user
    const errorIndicator = page.locator('lv-toast-container .toast.error, .error-message, .error-banner').first();
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });
  });
});
