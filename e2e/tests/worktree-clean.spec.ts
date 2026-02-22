import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import {
  startCommandCapture,
  findCommand,
  waitForCommand,
  injectCommandError,
  injectCommandMock,
  openViaCommandPalette,
} from '../fixtures/test-helpers';

/**
 * E2E tests for Worktree Dialog and Clean Dialog
 *
 * Worktree dialog: opened via command palette "Manage worktrees"
 *   - Element: `lv-worktree-dialog` with `.dialog` inside
 *   - Two modes: 'list' (shows existing worktrees) and 'add' (form to create new)
 *
 * Clean dialog: opened via command palette "Clean working directory"
 *   - Element: `lv-clean-dialog[open]` with `.dialog` inside
 *   - Shows untracked files with checkboxes, select all, and delete button
 */

// ============================================================================
// WORKTREE DIALOG
// ============================================================================

/** Open the worktree dialog via the command palette */
async function openWorktreeDialog(page: import('@playwright/test').Page) {
  await openViaCommandPalette(page, 'worktrees');
  await page.locator('lv-worktree-dialog .dialog').waitFor({ state: 'visible' });
}

test.describe('Worktree Dialog - List View', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await injectCommandMock(page, {
      get_worktrees: [
        {
          path: '/tmp/test-repo',
          branch: 'main',
          isMain: true,
          isLocked: false,
          commit: 'abc123',
          isBare: false,
          isPrunable: false,
        },
        {
          path: '/tmp/test-repo-feature',
          branch: 'feature/new-feature',
          isMain: false,
          isLocked: false,
          commit: 'def456',
          isBare: false,
          isPrunable: false,
        },
        {
          path: '/tmp/test-repo-locked',
          branch: 'hotfix/urgent',
          isMain: false,
          isLocked: true,
          commit: 'ghi789',
          isBare: false,
          isPrunable: false,
        },
      ],
      get_branches: [
        { name: 'refs/heads/main', shorthand: 'main', isHead: true, isRemote: false, upstream: null, targetOid: 'abc123', isStale: false },
        { name: 'refs/heads/develop', shorthand: 'develop', isHead: false, isRemote: false, upstream: null, targetOid: 'xyz789', isStale: false },
      ],
      add_worktree: {
        path: '/tmp/new-worktree',
        branch: 'develop',
        isMain: false,
        isLocked: false,
        commit: 'xyz789',
        isBare: false,
        isPrunable: false,
      },
      remove_worktree: null,
      lock_worktree: null,
      unlock_worktree: null,
    });
  });

  test('dialog opens and shows Worktrees title', async ({ page }) => {
    await openWorktreeDialog(page);

    const title = page.locator('lv-worktree-dialog .dialog-title');
    await expect(title).toContainText('Worktrees');
  });

  test('lists existing worktrees', async ({ page }) => {
    await openWorktreeDialog(page);

    const worktreeItems = page.locator('lv-worktree-dialog .worktree-item');
    await expect(worktreeItems).toHaveCount(3);
  });

  test('main worktree shows "main" badge', async ({ page }) => {
    await openWorktreeDialog(page);

    const mainBadge = page.locator('lv-worktree-dialog .main-badge');
    await expect(mainBadge).toBeVisible();
    await expect(mainBadge).toContainText('main');
  });

  test('locked worktree shows "locked" badge', async ({ page }) => {
    await openWorktreeDialog(page);

    const lockedBadge = page.locator('lv-worktree-dialog .locked-badge');
    await expect(lockedBadge).toBeVisible();
    await expect(lockedBadge).toContainText('locked');
  });

  test('each worktree shows its branch and path', async ({ page }) => {
    await openWorktreeDialog(page);

    // Check branch names are displayed
    const branchNames = page.locator('lv-worktree-dialog .worktree-branch');
    await expect(branchNames.first()).toContainText('main');

    // Check paths are displayed
    const paths = page.locator('lv-worktree-dialog .worktree-path');
    await expect(paths.first()).toContainText('/tmp/test-repo');
  });

  test('remove button is disabled for main worktree', async ({ page }) => {
    await openWorktreeDialog(page);

    // Main worktree's remove button should be disabled
    const mainItem = page.locator('lv-worktree-dialog .worktree-item.main');
    const removeBtn = mainItem.locator('.action-btn.danger');
    await expect(removeBtn).toBeDisabled();
  });

  test('remove button is disabled for locked worktree', async ({ page }) => {
    await openWorktreeDialog(page);

    // Locked worktree's remove button should be disabled
    const lockedItem = page.locator('lv-worktree-dialog .worktree-item.locked');
    const removeBtn = lockedItem.locator('.action-btn.danger');
    await expect(removeBtn).toBeDisabled();
  });

  test('lock button calls lock_worktree', async ({ page }) => {
    await startCommandCapture(page);
    await openWorktreeDialog(page);

    // Find the non-main, non-locked worktree's lock button
    const featureItem = page.locator('lv-worktree-dialog .worktree-item').nth(1);
    const lockBtn = featureItem.locator('.action-btn').first(); // Lock button
    await lockBtn.click();

    await waitForCommand(page, 'lock_worktree');

    const commands = await findCommand(page, 'lock_worktree');
    expect(commands.length).toBeGreaterThanOrEqual(1);
  });

  test('unlock button calls unlock_worktree', async ({ page }) => {
    await startCommandCapture(page);
    await openWorktreeDialog(page);

    // Locked worktree has an unlock button
    const lockedItem = page.locator('lv-worktree-dialog .worktree-item.locked');
    const unlockBtn = lockedItem.locator('.action-btn').first(); // Unlock button
    await unlockBtn.click();

    await waitForCommand(page, 'unlock_worktree');

    const commands = await findCommand(page, 'unlock_worktree');
    expect(commands.length).toBeGreaterThanOrEqual(1);
  });

  test('Add Worktree button switches to add form', async ({ page }) => {
    await openWorktreeDialog(page);

    const addBtn = page.locator('lv-worktree-dialog .btn-primary', { hasText: 'Add Worktree' });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Should switch to add mode with form title
    const title = page.locator('lv-worktree-dialog .dialog-title');
    await expect(title).toContainText('Add Worktree');

    // Form should be visible with path input
    const pathInput = page.locator('lv-worktree-dialog .form-input');
    await expect(pathInput.first()).toBeVisible();
  });

  test('Close button closes the dialog', async ({ page }) => {
    await openWorktreeDialog(page);

    const closeBtn = page.locator('lv-worktree-dialog .btn-secondary', { hasText: 'Close' });
    await closeBtn.click();

    const dialog = page.locator('lv-worktree-dialog .dialog');
    await expect(dialog).not.toBeVisible();
  });
});

test.describe('Worktree Dialog - Add Form', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await injectCommandMock(page, {
      get_worktrees: [
        {
          path: '/tmp/test-repo',
          branch: 'main',
          isMain: true,
          isLocked: false,
          commit: 'abc123',
          isBare: false,
          isPrunable: false,
        },
      ],
      get_branches: [
        { name: 'refs/heads/main', shorthand: 'main', isHead: true, isRemote: false, upstream: null, targetOid: 'abc123', isStale: false },
        { name: 'refs/heads/develop', shorthand: 'develop', isHead: false, isRemote: false, upstream: null, targetOid: 'xyz789', isStale: false },
      ],
      add_worktree: {
        path: '/tmp/new-worktree',
        branch: 'develop',
        isMain: false,
        isLocked: false,
        commit: 'xyz789',
        isBare: false,
        isPrunable: false,
      },
    });
  });

  test('add form shows path input and branch select', async ({ page }) => {
    await openWorktreeDialog(page);

    // Click Add Worktree
    const addBtn = page.locator('lv-worktree-dialog .btn-primary', { hasText: 'Add Worktree' });
    await addBtn.click();

    // Path input
    const pathInput = page.locator('lv-worktree-dialog .form-input');
    await expect(pathInput.first()).toBeVisible();

    // Branch select
    const branchSelect = page.locator('lv-worktree-dialog .form-select');
    await expect(branchSelect).toBeVisible();
  });

  test('create new branch checkbox toggles branch name input', async ({ page }) => {
    await openWorktreeDialog(page);

    const addBtn = page.locator('lv-worktree-dialog .btn-primary', { hasText: 'Add Worktree' });
    await addBtn.click();

    // Check "Create new branch"
    const checkbox = page.locator('lv-worktree-dialog .form-checkbox input[type="checkbox"]');
    await checkbox.check();

    // New branch name input should appear instead of select
    const branchNameInput = page.locator('lv-worktree-dialog .form-input').nth(1);
    await expect(branchNameInput).toBeVisible();
  });

  test('submitting add form calls add_worktree with correct args', async ({ page }) => {
    await startCommandCapture(page);
    await openWorktreeDialog(page);

    // Switch to add mode
    const addModeBtn = page.locator('lv-worktree-dialog .dialog-footer .btn-primary', { hasText: 'Add Worktree' });
    await addModeBtn.click();

    // Fill path
    const pathInput = page.locator('lv-worktree-dialog .form-input').first();
    await pathInput.fill('/tmp/new-worktree');

    // Select branch
    const branchSelect = page.locator('lv-worktree-dialog .form-select');
    await branchSelect.selectOption({ index: 1 }); // Select first real branch

    // Click Add Worktree submit button
    const submitBtn = page.locator('lv-worktree-dialog .dialog-footer-right .btn-primary', { hasText: 'Add Worktree' });
    await submitBtn.click();

    await waitForCommand(page, 'add_worktree');

    const commands = await findCommand(page, 'add_worktree');
    expect(commands.length).toBeGreaterThanOrEqual(1);

    // Verify path was passed
    const args = commands[0].args as { worktreePath?: string };
    expect(args.worktreePath).toBe('/tmp/new-worktree');
  });

  test('Add Worktree button is disabled without path', async ({ page }) => {
    await openWorktreeDialog(page);

    const addModeBtn = page.locator('lv-worktree-dialog .dialog-footer .btn-primary', { hasText: 'Add Worktree' });
    await addModeBtn.click();

    // Submit button should be disabled (no path)
    const submitBtn = page.locator('lv-worktree-dialog .dialog-footer-right .btn-primary', { hasText: 'Add Worktree' });
    await expect(submitBtn).toBeDisabled();
  });

  test('Cancel in add form returns to list view', async ({ page }) => {
    await openWorktreeDialog(page);

    const addBtn = page.locator('lv-worktree-dialog .dialog-footer .btn-primary', { hasText: 'Add Worktree' });
    await addBtn.click();

    // Cancel should return to list
    const cancelBtn = page.locator('lv-worktree-dialog .btn-secondary', { hasText: 'Cancel' });
    await cancelBtn.click();

    // Should be back in list mode
    const title = page.locator('lv-worktree-dialog .dialog-title');
    await expect(title).toContainText('Worktrees');
  });
});

test.describe('Worktree Dialog - Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await injectCommandMock(page, {
      get_worktrees: [
        {
          path: '/tmp/test-repo',
          branch: 'main',
          isMain: true,
          isLocked: false,
          commit: 'abc123',
          isBare: false,
          isPrunable: false,
        },
      ],
      get_branches: [
        { name: 'refs/heads/develop', shorthand: 'develop', isHead: false, isRemote: false, upstream: null, targetOid: 'xyz789', isStale: false },
      ],
    });
  });

  test('add_worktree failure shows error message', async ({ page }) => {
    await injectCommandError(page, 'add_worktree', 'Path already exists');

    await openWorktreeDialog(page);

    // Switch to add mode
    const addBtn = page.locator('lv-worktree-dialog .dialog-footer .btn-primary', { hasText: 'Add Worktree' });
    await addBtn.click();

    // Fill form
    const pathInput = page.locator('lv-worktree-dialog .form-input').first();
    await pathInput.fill('/tmp/existing-path');
    const branchSelect = page.locator('lv-worktree-dialog .form-select');
    await branchSelect.selectOption({ index: 1 });

    // Submit
    const submitBtn = page.locator('lv-worktree-dialog .dialog-footer-right .btn-primary');
    await submitBtn.click();

    const errorMessage = page.locator('lv-worktree-dialog .message.error');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Path already exists');
  });
});

// ============================================================================
// CLEAN DIALOG
// ============================================================================

/** Open the clean dialog via the command palette */
async function openCleanDialog(page: import('@playwright/test').Page) {
  await openViaCommandPalette(page, 'Clean working');
  await page.locator('lv-clean-dialog[open] .dialog').waitFor({ state: 'visible' });
}

test.describe('Clean Dialog - File List', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page, {
      status: {
        staged: [],
        unstaged: [
          { path: 'untracked-file.txt', status: 'new', isStaged: false, isConflicted: false },
          { path: 'another-untracked.js', status: 'new', isStaged: false, isConflicted: false },
        ],
      },
    });

    await injectCommandMock(page, {
      get_cleanable_files: [
        { path: 'untracked-file.txt', isDirectory: false, isIgnored: false, size: 1024 },
        { path: 'another-untracked.js', isDirectory: false, isIgnored: false, size: 2048 },
        { path: 'build/', isDirectory: true, isIgnored: false, size: null },
        { path: 'node_modules/', isDirectory: true, isIgnored: true, size: null },
      ],
      clean_files: 4,
    });
  });

  test('dialog opens with title and warning banner', async ({ page }) => {
    await openCleanDialog(page);

    const title = page.locator('lv-clean-dialog .title');
    await expect(title).toContainText('Clean Working Directory');

    // Warning banner should be visible
    const warning = page.locator('lv-clean-dialog .warning-banner');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('permanently delete');
    await expect(warning).toContainText('cannot be undone');
  });

  test('lists all cleanable files with checkboxes', async ({ page }) => {
    await openCleanDialog(page);

    const fileItems = page.locator('lv-clean-dialog .file-item');
    await expect(fileItems).toHaveCount(4);

    // Each should have a checkbox
    const checkboxes = page.locator('lv-clean-dialog .file-checkbox');
    await expect(checkboxes).toHaveCount(4);
  });

  test('files are selected by default', async ({ page }) => {
    await openCleanDialog(page);

    // All checkboxes should be checked by default
    const checkboxes = page.locator('lv-clean-dialog .file-checkbox');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('shows file paths and badges for directories and ignored files', async ({ page }) => {
    await openCleanDialog(page);

    // Directory badges
    const dirBadges = page.locator('lv-clean-dialog .file-badge.directory');
    await expect(dirBadges.first()).toBeVisible();
    await expect(dirBadges.first()).toContainText('dir');

    // Ignored badge
    const ignoredBadge = page.locator('lv-clean-dialog .file-badge.ignored');
    await expect(ignoredBadge).toBeVisible();
    await expect(ignoredBadge).toContainText('ignored');
  });

  test('shows file sizes', async ({ page }) => {
    await openCleanDialog(page);

    const fileSizes = page.locator('lv-clean-dialog .file-size');
    // At least the non-directory files should show sizes
    await expect(fileSizes.first()).toBeVisible();
  });

  test('Select All checkbox toggles all files', async ({ page }) => {
    await openCleanDialog(page);

    // Select all checkbox
    const selectAll = page.locator('lv-clean-dialog .select-all input[type="checkbox"]');
    await expect(selectAll).toBeVisible();

    // Uncheck all
    await selectAll.click();

    // All individual checkboxes should now be unchecked
    const checkboxes = page.locator('lv-clean-dialog .file-checkbox');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }

    // Check all again
    await selectAll.click();

    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('individual checkbox toggles selection', async ({ page }) => {
    await openCleanDialog(page);

    const firstCheckbox = page.locator('lv-clean-dialog .file-checkbox').first();

    // Uncheck first file
    await firstCheckbox.click();
    await expect(firstCheckbox).not.toBeChecked();

    // Check it again
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked();
  });

  test('footer shows selection count', async ({ page }) => {
    await openCleanDialog(page);

    const footerLeft = page.locator('lv-clean-dialog .footer-left');
    await expect(footerLeft).toContainText('4 selected');
  });

  test('Delete Selected button is enabled when files are selected', async ({ page }) => {
    await openCleanDialog(page);

    const deleteBtn = page.locator('lv-clean-dialog .btn-danger');
    await expect(deleteBtn).toBeEnabled();
    await expect(deleteBtn).toContainText('Delete Selected');
  });

  test('Delete Selected button is disabled when no files selected', async ({ page }) => {
    await openCleanDialog(page);

    // Uncheck all
    const selectAll = page.locator('lv-clean-dialog .select-all input[type="checkbox"]');
    await selectAll.click();

    const deleteBtn = page.locator('lv-clean-dialog .btn-danger');
    await expect(deleteBtn).toBeDisabled();
  });
});

test.describe('Clean Dialog - Operations', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await injectCommandMock(page, {
      get_cleanable_files: [
        { path: 'untracked-file.txt', isDirectory: false, isIgnored: false, size: 1024 },
        { path: 'temp.log', isDirectory: false, isIgnored: false, size: 512 },
      ],
      clean_files: 2,
    });
  });

  test('clicking Delete Selected calls clean_files with selected paths', async ({ page }) => {
    await startCommandCapture(page);
    await openCleanDialog(page);

    const deleteBtn = page.locator('lv-clean-dialog .btn-danger');
    await deleteBtn.click();

    await waitForCommand(page, 'clean_files');

    const commands = await findCommand(page, 'clean_files');
    expect(commands.length).toBeGreaterThanOrEqual(1);

    // Verify paths were passed
    const args = commands[0].args as { paths?: string[] };
    expect(args.paths).toContain('untracked-file.txt');
    expect(args.paths).toContain('temp.log');
  });

  test('successful clean closes dialog', async ({ page }) => {
    await openCleanDialog(page);

    const deleteBtn = page.locator('lv-clean-dialog .btn-danger');
    await deleteBtn.click();

    // Dialog should close after successful clean
    const dialog = page.locator('lv-clean-dialog[open] .dialog');
    await expect(dialog).not.toBeVisible();
  });

  test('Cancel button closes the dialog', async ({ page }) => {
    await openCleanDialog(page);

    const cancelBtn = page.locator('lv-clean-dialog .btn-secondary', { hasText: 'Cancel' });
    await cancelBtn.click();

    const dialog = page.locator('lv-clean-dialog[open] .dialog');
    await expect(dialog).not.toBeVisible();
  });

  test('Escape key closes the dialog', async ({ page }) => {
    await openCleanDialog(page);

    await page.keyboard.press('Escape');

    const dialog = page.locator('lv-clean-dialog[open] .dialog');
    await expect(dialog).not.toBeVisible();
  });
});

test.describe('Clean Dialog - Options', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await injectCommandMock(page, {
      get_cleanable_files: [
        { path: 'untracked.txt', isDirectory: false, isIgnored: false, size: 100 },
      ],
      clean_files: 1,
    });
  });

  test('shows Include ignored files and Include directories checkboxes', async ({ page }) => {
    await openCleanDialog(page);

    const options = page.locator('lv-clean-dialog .options .option');
    await expect(options).toHaveCount(2);

    await expect(options.first()).toContainText('Include ignored files');
    await expect(options.nth(1)).toContainText('Include directories');
  });

  test('Include directories is checked by default', async ({ page }) => {
    await openCleanDialog(page);

    const dirCheckbox = page.locator('lv-clean-dialog .options .option input').nth(1);
    await expect(dirCheckbox).toBeChecked();
  });

  test('Include ignored files is unchecked by default', async ({ page }) => {
    await openCleanDialog(page);

    const ignoredCheckbox = page.locator('lv-clean-dialog .options .option input').first();
    await expect(ignoredCheckbox).not.toBeChecked();
  });

  test('toggling options reloads the file list', async ({ page }) => {
    await startCommandCapture(page);
    await openCleanDialog(page);

    // Toggle "Include ignored files"
    const ignoredCheckbox = page.locator('lv-clean-dialog .options .option input').first();
    await ignoredCheckbox.click();

    // Wait until at least 2 invocations of get_cleanable_files (initial load + after toggle)
    await expect(async () => {
      const commands = await findCommand(page, 'get_cleanable_files');
      expect(commands.length).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 5000 });
  });
});

test.describe('Clean Dialog - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await injectCommandMock(page, {
      get_cleanable_files: [],
    });
  });

  test('shows empty state when no untracked files exist', async ({ page }) => {
    await openCleanDialog(page);

    const emptyState = page.locator('lv-clean-dialog .empty');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('Working directory is clean');

    // Delete button should be disabled
    const deleteBtn = page.locator('lv-clean-dialog .btn-danger');
    await expect(deleteBtn).toBeDisabled();
  });
});

test.describe('Clean Dialog - Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await injectCommandMock(page, {
      get_cleanable_files: [
        { path: 'important.txt', isDirectory: false, isIgnored: false, size: 100 },
      ],
    });
  });

  test('clean_files failure keeps dialog open', async ({ page }) => {
    await injectCommandError(page, 'clean_files', 'Permission denied');

    await openCleanDialog(page);

    const deleteBtn = page.locator('lv-clean-dialog .btn-danger');
    await deleteBtn.click();

    // The clean dialog catches errors and keeps the dialog open
    const dialog = page.locator('lv-clean-dialog[open] .dialog');
    await expect(dialog).toBeVisible();
  });
});

test.describe('Worktree Error Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should show error when add_worktree fails', async ({ page }) => {
    await injectCommandMock(page, {
      get_worktrees: [
        {
          path: '/tmp/test-repo',
          branch: 'main',
          isMain: true,
          isLocked: false,
          commit: 'abc123',
          isBare: false,
          isPrunable: false,
        },
      ],
      get_branches: [
        { name: 'refs/heads/main', shorthand: 'main', isHead: true, isRemote: false, upstream: null, targetOid: 'abc123', isStale: false },
        { name: 'refs/heads/develop', shorthand: 'develop', isHead: false, isRemote: false, upstream: null, targetOid: 'xyz789', isStale: false },
      ],
    });

    await injectCommandError(page, 'add_worktree', 'Failed to create worktree: path already exists');

    await openWorktreeDialog(page);

    // Switch to add mode
    const addBtn = page.locator('lv-worktree-dialog .btn-primary', { hasText: 'Add Worktree' });
    await addBtn.click();

    // Fill form
    const pathInput = page.locator('lv-worktree-dialog .form-input').first();
    await pathInput.fill('/tmp/existing-path');
    const branchSelect = page.locator('lv-worktree-dialog .form-select');
    await branchSelect.selectOption({ index: 1 });

    // Submit
    const submitBtn = page.locator('lv-worktree-dialog .dialog-footer-right .btn-primary');
    await submitBtn.click();

    // The worktree dialog shows errors in .message.error
    const errorMessage = page.locator('lv-worktree-dialog .message.error');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });

  test('should show error when clean_files fails', async ({ page }) => {
    await injectCommandMock(page, {
      get_cleanable_files: [
        { path: 'untracked.txt', isDirectory: false, isIgnored: false, size: 512 },
        { path: 'temp.log', isDirectory: false, isIgnored: false, size: 256 },
      ],
    });

    await injectCommandError(page, 'clean_files', 'Failed to clean files: permission denied');

    await openCleanDialog(page);

    const deleteBtn = page.locator('lv-clean-dialog .btn-danger');
    await deleteBtn.click();

    // The clean dialog uses showToast for errors which creates a toast notification
    // The dialog should remain open on error
    const dialog = page.locator('lv-clean-dialog[open] .dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });
});
