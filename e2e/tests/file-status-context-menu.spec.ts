import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { RightPanelPage } from '../pages/panels.page';
import {
  startCommandCapture,
  startCommandCaptureWithMocks,
  findCommand,
  getCapturedCommands,
  injectCommandError,
  injectCommandMock,
  waitForRepositoryChanged,
} from '../fixtures/test-helpers';

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

    await startCommandCapture(page);
    await injectCommandMock(page, { 'plugin:dialog|confirm': true, 'plugin:dialog|ask': true });
  });

  test('should display unstaged files', async ({ page }) => {
    const unstagedCount = await rightPanel.getUnstagedCount();
    expect(unstagedCount).toBe(3);
  });

  test('should display staged files', async ({ page }) => {
    const stagedCount = await rightPanel.getStagedCount();
    expect(stagedCount).toBe(1);
  });

  test('should open context menu on right-click on unstaged file', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).toBeVisible();
  });

  test('should show Stage option for unstaged files', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i });
    await expect(stageOption).toBeVisible();
  });

  test('should show Discard option for unstaged files', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const discardOption = page.locator('.context-menu-item, .menu-item', { hasText: /discard|revert/i });
    await expect(discardOption).toBeVisible();
  });

  test('should close context menu after clicking Stage', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();
    await stageOption.click();

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke stage_files command for single file', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();
    await stageOption.click();

    const commands = await findCommand(page, 'stage_files');
    expect(commands.length).toBeGreaterThan(0);
  });

  test('should close context menu after clicking Discard', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const discardOption = page.locator('.context-menu-item, .menu-item', { hasText: /discard|revert/i });
    await expect(discardOption).toBeVisible();
    await discardOption.click();

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should show Unstage option for staged files', async ({ page }) => {
    const stagedFile = rightPanel.getStagedFile('src/staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i });
    await expect(unstageOption).toBeVisible();
  });

  test('should close context menu after clicking Unstage', async ({ page }) => {
    const stagedFile = rightPanel.getStagedFile('src/staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i });
    await expect(unstageOption).toBeVisible();
    await unstageOption.click();

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke unstage_files command', async ({ page }) => {
    const stagedFile = rightPanel.getStagedFile('src/staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i });
    await expect(unstageOption).toBeVisible();
    await unstageOption.click();

    const commands = await findCommand(page, 'unstage_files');
    expect(commands.length).toBeGreaterThan(0);
  });

  test('should show Open in Editor option', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).toBeVisible();

    const openOption = page.locator('.context-menu-item, .menu-item', { hasText: /open|editor/i });
    await expect(openOption.first()).toBeVisible();
  });

  test('should show Copy Path option', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).toBeVisible();

    const copyOption = page.locator('.context-menu-item, .menu-item', { hasText: /copy.*path/i });
    await expect(copyOption.first()).toBeVisible();
  });

  test('context menu should close when clicking elsewhere', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).toBeVisible();

    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await expect(contextMenu).not.toBeVisible();
  });

  test('should handle new file status correctly', async ({ page }) => {
    const newFile = rightPanel.getUnstagedFile('src/new-file.ts');
    await newFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();

    const discardOption = page.locator('.context-menu-item, .menu-item', { hasText: /discard|delete/i });
    await expect(discardOption.first()).toBeVisible();
  });

  test('should handle deleted file status correctly', async ({ page }) => {
    const deletedFile = rightPanel.getUnstagedFile('src/deleted-file.ts');
    await deletedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();

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

    await startCommandCaptureWithMocks(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });
  });

  test('should invoke stage_files and reload status after staging', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();
    await stageOption.click();

    const stageCommands = await findCommand(page, 'stage_files');
    expect(stageCommands.length).toBeGreaterThan(0);

    const statusCommands = await findCommand(page, 'get_status');
    expect(statusCommands.length).toBeGreaterThanOrEqual(1);

    await expect(rightPanel.getStagedFile('src/modified-file.ts')).toBeVisible();
    const stagedCount = await rightPanel.getStagedCount();
    expect(stagedCount).toBe(2);
  });

  test('should invoke unstage_files and reload status after unstaging', async ({ page }) => {
    const stagedFile = rightPanel.getStagedFile('src/staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i }).first();
    await expect(unstageOption).toBeVisible();
    await unstageOption.click();

    const unstageCommands = await findCommand(page, 'unstage_files');
    expect(unstageCommands.length).toBeGreaterThan(0);

    const statusCommands = await findCommand(page, 'get_status');
    expect(statusCommands.length).toBeGreaterThanOrEqual(1);

    await expect(rightPanel.getUnstagedFile('src/staged-file.ts')).toBeVisible();
    const unstagedCount = await rightPanel.getUnstagedCount();
    expect(unstagedCount).toBe(2);
  });

  test('should invoke discard_changes and reload status after discarding', async ({ page }) => {
    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const discardOption = page.locator('.context-menu-item, .menu-item', { hasText: /discard/i }).first();
    await expect(discardOption).toBeVisible();
    await discardOption.click();

    const commands = await getCapturedCommands(page);

    const discardCommand = commands.find(c =>
      c.command === 'discard_changes' || c.command === 'restore_file'
    );
    expect(discardCommand).toBeDefined();
  });
});

test.describe('File Status Context Menu - Error Handling', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);

    await setupOpenRepository(page, {
      status: {
        staged: [],
        unstaged: [
          { path: 'src/modified-file.ts', status: 'modified', isStaged: false, isConflicted: false },
        ],
      },
    });
  });

  test('should show error toast when stage fails', async ({ page }) => {
    await injectCommandError(page, 'stage_files', 'Failed to stage: permission denied');

    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();
    await stageOption.click();

    const errorToast = page.locator('lv-toast-container .toast.error').first();
    await expect(errorToast).toBeVisible({ timeout: 5000 });
    await expect(errorToast).toContainText('permission denied');
  });

  test('should keep file in unstaged section after stage failure', async ({ page }) => {
    await injectCommandError(page, 'stage_files', 'Failed to stage');

    const modifiedFile = rightPanel.getUnstagedFile('src/modified-file.ts');
    await modifiedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();
    await stageOption.click();

    await expect(rightPanel.getUnstagedFile('src/modified-file.ts')).toBeVisible();
    const unstagedCount = await rightPanel.getUnstagedCount();
    expect(unstagedCount).toBe(1);
  });
});

test.describe('File Status Context Menu - Stage/Unstage DOM Updates', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);

    await setupOpenRepository(page, {
      status: {
        staged: [
          { path: 'src/staged-file.ts', status: 'modified', isStaged: true, isConflicted: false },
        ],
        unstaged: [
          { path: 'src/unstaged-file.ts', status: 'modified', isStaged: false, isConflicted: false },
        ],
      },
    });
  });

  test('should invoke stage_files with correct file path', async ({ page }) => {
    await startCommandCapture(page);

    const unstagedFile = rightPanel.getUnstagedFile('src/unstaged-file.ts');
    await unstagedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();
    await stageOption.click();

    const stageCommands = await findCommand(page, 'stage_files');
    expect(stageCommands.length).toBeGreaterThan(0);
    const args = stageCommands[0].args as { paths?: string[]; files?: string[] };
    const paths = args?.paths || args?.files || [];
    expect(paths.some((p: string) => p.includes('unstaged-file.ts'))).toBe(true);
  });

  test('should invoke unstage_files with correct file path', async ({ page }) => {
    await startCommandCapture(page);

    const stagedFile = rightPanel.getStagedFile('src/staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i }).first();
    await expect(unstageOption).toBeVisible();
    await unstageOption.click();

    const unstageCommands = await findCommand(page, 'unstage_files');
    expect(unstageCommands.length).toBeGreaterThan(0);
    const args = unstageCommands[0].args as { paths?: string[]; files?: string[] };
    const paths = args?.paths || args?.files || [];
    expect(paths.some((p: string) => p.includes('staged-file.ts'))).toBe(true);
  });

  test('should reload status after staging via context menu', async ({ page }) => {
    await startCommandCapture(page);

    const unstagedFile = rightPanel.getUnstagedFile('src/unstaged-file.ts');
    await unstagedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();
    await stageOption.click();

    // Verify stage_files was called and then status was reloaded
    const stageCommands = await findCommand(page, 'stage_files');
    expect(stageCommands.length).toBeGreaterThan(0);
    const statusCommands = await findCommand(page, 'get_status');
    expect(statusCommands.length).toBeGreaterThan(0);
  });

  test('should reload status after unstaging via context menu', async ({ page }) => {
    await startCommandCapture(page);

    const stagedFile = rightPanel.getStagedFile('src/staged-file.ts');
    await stagedFile.click({ button: 'right' });

    const unstageOption = page.locator('.context-menu-item, .menu-item', { hasText: /unstage/i }).first();
    await expect(unstageOption).toBeVisible();
    await unstageOption.click();

    // Verify unstage_files was called and then status was reloaded
    const unstageCommands = await findCommand(page, 'unstage_files');
    expect(unstageCommands.length).toBeGreaterThan(0);
    const statusCommands = await findCommand(page, 'get_status');
    expect(statusCommands.length).toBeGreaterThan(0);
  });
});

test.describe('File Status Context Menu - Extended Tests', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);

    await setupOpenRepository(page, {
      status: {
        staged: [
          { path: 'src/already-staged.ts', status: 'modified', isStaged: true, isConflicted: false },
        ],
        unstaged: [
          { path: 'src/to-be-staged.ts', status: 'modified', isStaged: false, isConflicted: false },
          { path: 'src/another-file.ts', status: 'new', isStaged: false, isConflicted: false },
        ],
      },
    });

    await startCommandCaptureWithMocks(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });
  });

  test('staging a file via context menu moves it from unstaged to staged list', async ({ page }) => {
    // Verify initial counts
    const initialUnstagedCount = await rightPanel.getUnstagedCount();
    expect(initialUnstagedCount).toBe(2);
    const initialStagedCount = await rightPanel.getStagedCount();
    expect(initialStagedCount).toBe(1);

    // Right-click on the unstaged file and stage it
    const unstagedFile = rightPanel.getUnstagedFile('src/to-be-staged.ts');
    await unstagedFile.click({ button: 'right' });

    const stageOption = page.locator('.context-menu-item, .menu-item', { hasText: /stage/i }).first();
    await expect(stageOption).toBeVisible();
    await stageOption.click();

    // After staging, the file should move from unstaged to staged
    // Verify the staged file is now visible in the staged section
    await expect(rightPanel.getStagedFile('src/to-be-staged.ts')).toBeVisible();

    // Verify the staged count increased
    const newStagedCount = await rightPanel.getStagedCount();
    expect(newStagedCount).toBe(2);

    // Verify the unstaged count decreased
    const newUnstagedCount = await rightPanel.getUnstagedCount();
    expect(newUnstagedCount).toBe(1);
  });

  test('clicking Copy Path copies the file path to clipboard', async ({ page }) => {
    // Mock navigator.clipboard.writeText to capture the copied value
    await page.evaluate(() => {
      (window as unknown as { __CLIPBOARD_WRITTEN__: string[] }).__CLIPBOARD_WRITTEN__ = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            (window as unknown as { __CLIPBOARD_WRITTEN__: string[] }).__CLIPBOARD_WRITTEN__.push(text);
          },
        },
        writable: true,
        configurable: true,
      });
    });

    // Right-click on a file to open context menu
    const unstagedFile = rightPanel.getUnstagedFile('src/to-be-staged.ts');
    await unstagedFile.click({ button: 'right' });

    const contextMenu = page.locator('.context-menu, .file-context-menu');
    await expect(contextMenu).toBeVisible();

    // Find and click the Copy Path option
    const copyOption = page.locator('.context-menu-item, .menu-item', { hasText: /copy.*path/i });
    await expect(copyOption.first()).toBeVisible();
    await copyOption.first().click();

    // Context menu should close after clicking
    await expect(contextMenu).not.toBeVisible();

    // Verify clipboard.writeText was called with the file path
    const written = await page.evaluate(() =>
      (window as unknown as { __CLIPBOARD_WRITTEN__: string[] }).__CLIPBOARD_WRITTEN__
    );
    expect(written.length).toBeGreaterThan(0);
    expect(written[0]).toContain('to-be-staged.ts');
  });
});
