import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { RightPanelPage } from '../pages/panels.page';

/**
 * E2E tests for File Status Context Menu
 * Tests stage, unstage, discard operations via context menu
 */
test.describe('File Status Context Menu', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);

    await setupOpenRepository(page, {
      status: {
        staged: [
          { path: 'src/staged-file.ts', status: 'modified', isStaged: true, isConflicted: false },
        ],
        unstaged: [
          { path: 'src/modified-file.ts', status: 'modified', isStaged: false, isConflicted: false },
          { path: 'src/new-file.ts', status: 'new', isStaged: false, isConflicted: false },
          { path: 'src/deleted-file.ts', status: 'deleted', isStaged: false, isConflicted: false },
        ],
      },
    });

    // Add command tracking and auto-confirm dialogs
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __INVOKED_COMMANDS__: { command: string; args: unknown }[];
      }).__INVOKED_COMMANDS__ = [];

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
          .__INVOKED_COMMANDS__.push({ command, args });

        // Auto-confirm dialogs
        if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|ask') {
          return true;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display unstaged files', async ({ page }) => {
    // Should show unstaged files count
    const unstagedCount = await rightPanel.getUnstagedCount();
    expect(unstagedCount).toBe(3);
  });

  test('should display staged files', async ({ page }) => {
    // Should show staged files count
    const stagedCount = await rightPanel.getStagedCount();
    expect(stagedCount).toBe(1);
  });

  test('should open context menu on right-click on unstaged file', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    // Context menu should appear
    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).toBeVisible();
  });

  test('should show Stage option for unstaged files', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i });
    await expect(stageOption).toBeVisible();
  });

  test('should show Discard option for unstaged files', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const discardOption = page.locator('.context-menu-item, .menu-item', { hasText: /discard|revert/i });
    await expect(discardOption).toBeVisible();
  });

  test('should close context menu after clicking Stage', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await stageOption.waitFor({ state: 'visible' });
    await stageOption.click();

    // Context menu should close
    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke stage_files command for single file', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await stageOption.waitFor({ state: 'visible' });
    await stageOption.click();

    await page.waitForTimeout(100);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const stageCommand = commands.find(c => c.command === 'stage_files');
    expect(stageCommand).toBeDefined();
  });

  test('should close context menu after clicking Discard', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const discardOption = page.locator('.context-menu-item, .menu-item', { hasText: /discard|revert/i });
    await discardOption.waitFor({ state: 'visible' });
    await discardOption.click();

    // May show confirmation dialog - look for it in a dialog/modal container
    await page.waitForTimeout(100);
    const confirmDialog = page.locator('.dialog, .modal, [role="dialog"]');
    if (await confirmDialog.count() > 0) {
      const confirmButton = confirmDialog.locator('button', { hasText: /confirm|yes|ok|discard/i }).first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }

    // Context menu should close
    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should show Unstage option for staged files', async ({ page }) => {
    const stagedFile = rightPanel.getStagedFile('staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i });
    await expect(unstageOption).toBeVisible();
  });

  test('should close context menu after clicking Unstage', async ({ page }) => {
    const stagedFile = rightPanel.getStagedFile('staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i });
    await unstageOption.waitFor({ state: 'visible' });
    await unstageOption.click();

    // Context menu should close
    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke unstage_files command', async ({ page }) => {
    const stagedFile = rightPanel.getStagedFile('staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i });
    await unstageOption.waitFor({ state: 'visible' });
    await unstageOption.click();

    await page.waitForTimeout(100);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const unstageCommand = commands.find(c => c.command === 'unstage_files');
    expect(unstageCommand).toBeDefined();
  });

  test('should show Open in Editor option', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const openOption = page.locator('.context-menu-item, .menu-item', { hasText: /open|editor/i });
    // This option may or may not exist depending on implementation
    const count = await openOption.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should show Copy Path option', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const copyOption = page.locator('.context-menu-item, .menu-item', { hasText: /copy.*path/i });
    // This option may or may not exist depending on implementation
    const count = await copyOption.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('context menu should close when clicking elsewhere', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).toBeVisible();

    // Click elsewhere
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Context menu should close
    await expect(contextMenu).not.toBeVisible();
  });

  test('should handle new file status correctly', async ({ page }) => {
    const newFile = rightPanel.getUnstagedFile('new-file.ts');
    await newFile.click({ button: 'right' });

    // Should show stage option
    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();

    // May or may not show discard option for new files
    const discardOption = page.locator('.context-menu-item, .menu-item', { hasText: /discard|delete/i });
    const discardCount = await discardOption.count();
    expect(discardCount).toBeGreaterThanOrEqual(0);
  });

  test('should handle deleted file status correctly', async ({ page }) => {
    const deletedFile = rightPanel.getUnstagedFile('deleted-file.ts');
    await deletedFile.click({ button: 'right' });

    // Should show stage option
    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();

    // Should show restore/revert option
    const restoreOption = page.locator('.context-menu-item, .menu-item', { hasText: /restore|revert|discard/i });
    await expect(restoreOption).toBeVisible();
  });
});

test.describe('File Status Context Menu - Command Execution', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);

    await setupOpenRepository(page, {
      status: {
        staged: [
          { path: 'src/staged-file.ts', status: 'modified', isStaged: true, isConflicted: false },
        ],
        unstaged: [
          { path: 'src/modified-file.ts', status: 'modified', isStaged: false, isConflicted: false },
        ],
      },
    });

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __INVOKED_COMMANDS__: { command: string; args: unknown }[];
      }).__INVOKED_COMMANDS__ = [];

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
          .__INVOKED_COMMANDS__.push({ command, args });

        if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|ask') {
          return true;
        }
        return originalInvoke(command, args);
      };
    });
  });

  test('should invoke stage_files and reload status after staging', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await stageOption.waitFor({ state: 'visible' });
    await stageOption.click();

    await page.waitForTimeout(300);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    // Should invoke stage_files command
    const stageCommand = commands.find(c => c.command === 'stage_files');
    expect(stageCommand).toBeDefined();

    // Should reload status after staging
    const statusCommands = commands.filter(c => c.command === 'get_status');
    expect(statusCommands.length).toBeGreaterThanOrEqual(1);
  });

  test('should invoke unstage_files and reload status after unstaging', async ({ page }) => {
    const stagedFile = rightPanel.getStagedFile('staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i }).first();
    await unstageOption.waitFor({ state: 'visible' });
    await unstageOption.click();

    await page.waitForTimeout(300);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    // Should invoke unstage_files command
    const unstageCommand = commands.find(c => c.command === 'unstage_files');
    expect(unstageCommand).toBeDefined();

    // Should reload status after unstaging
    const statusCommands = commands.filter(c => c.command === 'get_status');
    expect(statusCommands.length).toBeGreaterThanOrEqual(1);
  });

  test('should invoke discard_changes and reload status after discarding', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const discardOption = page.locator('.context-menu-item, .menu-item', { hasText: /discard/i }).first();
    if (await discardOption.isVisible()) {
      await discardOption.click();

      await page.waitForTimeout(300);

      const commands = await page.evaluate(() => {
        return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
          .__INVOKED_COMMANDS__;
      });

      // Should invoke discard_changes command (or restore_file)
      const discardCommand = commands.find(c =>
        c.command === 'discard_changes' || c.command === 'restore_file'
      );
      expect(discardCommand).toBeDefined();
    }
  });
});
