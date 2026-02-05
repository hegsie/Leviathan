import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Interactive Rebase Dialog
 * Tests drag-drop reordering, action changes, preview, and execution
 */
test.describe('Interactive Rebase Dialog', () => {
  test.beforeEach(async ({ page }) => {
    // Setup with mock data including rebase commits
    await setupOpenRepository(page);

    // Add mock for getRebaseCommits and executeInteractiveRebase
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
        __INVOKED_COMMANDS__: { command: string; args: unknown }[];
      }).__INVOKED_COMMANDS__ = [];

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
          .__INVOKED_COMMANDS__.push({ command, args });

        if (command === 'get_rebase_commits') {
          return [
            { oid: 'abc123', shortId: 'abc123', summary: 'First commit', author: 'Test', timestamp: Date.now() / 1000 },
            { oid: 'def456', shortId: 'def456', summary: 'Second commit', author: 'Test', timestamp: Date.now() / 1000 - 3600 },
            { oid: 'ghi789', shortId: 'ghi789', summary: 'Third commit', author: 'Test', timestamp: Date.now() / 1000 - 7200 },
          ];
        }

        if (command === 'execute_interactive_rebase') {
          return null; // Success
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open dialog and show commits', async ({ page }) => {
    // Trigger opening the interactive rebase dialog from branch context menu
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });

    const rebaseMenuItem = page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' });
    await rebaseMenuItem.waitFor({ state: 'visible' });
    await rebaseMenuItem.click();

    // Dialog should open
    const dialog = page.locator('lv-interactive-rebase-dialog lv-modal[open]');
    await expect(dialog).toBeVisible();

    // Should show commits
    const commitRows = page.locator('lv-interactive-rebase-dialog .commit-row');
    await expect(commitRows).toHaveCount(3);
  });

  test('should show action dropdown for each commit', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Each commit should have an action select
    const actionSelects = page.locator('lv-interactive-rebase-dialog .action-select');
    await expect(actionSelects).toHaveCount(3);

    // Default action should be 'pick'
    const firstSelect = actionSelects.first();
    await expect(firstSelect).toHaveValue('pick');
  });

  test('should change action and update preview', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Change first commit action to 'drop'
    const firstSelect = page.locator('lv-interactive-rebase-dialog .action-select').first();
    await firstSelect.selectOption('drop');

    // Commit row should have 'action-drop' class
    const firstRow = page.locator('lv-interactive-rebase-dialog .commit-row').first();
    await expect(firstRow).toHaveClass(/action-drop/);

    // Stats should update to show 1 dropped
    await expect(page.locator('lv-interactive-rebase-dialog .stat', { hasText: 'Dropped' })).toBeVisible();
  });

  test('should show reword textarea when action is reword', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Change first commit action to 'reword'
    const firstSelect = page.locator('lv-interactive-rebase-dialog .action-select').first();
    await firstSelect.selectOption('reword');

    // Reword textarea should appear
    const rewordInput = page.locator('lv-interactive-rebase-dialog .reword-input').first();
    await expect(rewordInput).toBeVisible();

    // Should be pre-filled with original message
    await expect(rewordInput).toHaveValue('First commit');
  });

  test('should allow editing reword message', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Change to reword and edit message
    const firstSelect = page.locator('lv-interactive-rebase-dialog .action-select').first();
    await firstSelect.selectOption('reword');

    const rewordInput = page.locator('lv-interactive-rebase-dialog .reword-input').first();
    await rewordInput.fill('Updated commit message');

    await expect(rewordInput).toHaveValue('Updated commit message');
  });

  test('should toggle preview panel', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Preview should be visible by default
    const previewSection = page.locator('lv-interactive-rebase-dialog .preview-section');
    await expect(previewSection).toBeVisible();

    // Click toggle button
    const previewToggle = page.locator('lv-interactive-rebase-dialog .btn-small', { hasText: 'Preview' });
    await previewToggle.click();

    // Preview should be hidden
    await expect(previewSection).not.toBeVisible();

    // Click again to show
    await previewToggle.click();
    await expect(previewSection).toBeVisible();
  });

  test('should show squash indicator in preview', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Set second commit to squash
    const secondSelect = page.locator('lv-interactive-rebase-dialog .action-select').nth(1);
    await secondSelect.selectOption('squash');

    // Preview should show squash badge
    const squashBadge = page.locator('lv-interactive-rebase-dialog .squash-badge');
    await expect(squashBadge).toBeVisible();
    await expect(squashBadge).toContainText('+1 squashed');
  });

  test('should show error for orphaned squash', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Set first commit to squash (orphaned - no commit before it)
    const firstSelect = page.locator('lv-interactive-rebase-dialog .action-select').first();
    await firstSelect.selectOption('squash');

    // Preview should show error
    const errorPreview = page.locator('lv-interactive-rebase-dialog .preview-commit.error');
    await expect(errorPreview).toBeVisible();

    // Start Rebase button should be disabled
    const startButton = page.locator('lv-interactive-rebase-dialog .btn-primary', { hasText: 'Start Rebase' });
    await expect(startButton).toBeDisabled();
  });

  test('should close dialog on Cancel', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    const dialog = page.locator('lv-interactive-rebase-dialog lv-modal[open]');
    await dialog.waitFor({ state: 'visible' });

    // Click Cancel
    const cancelButton = page.locator('lv-interactive-rebase-dialog .btn-secondary', { hasText: 'Cancel' });
    await cancelButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible();
  });

  test('should execute rebase and invoke command', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Click Start Rebase
    const startButton = page.locator('lv-interactive-rebase-dialog .btn-primary', { hasText: 'Start Rebase' });
    await startButton.click();

    // Wait for command to be invoked
    await page.waitForTimeout(100);

    // Check that execute_interactive_rebase was called
    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const rebaseCommand = commands.find(c => c.command === 'execute_interactive_rebase');
    expect(rebaseCommand).toBeDefined();
  });

  test('should show stats for dropped and reworded commits', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Drop first commit
    await page.locator('lv-interactive-rebase-dialog .action-select').first().selectOption('drop');

    // Reword second commit
    await page.locator('lv-interactive-rebase-dialog .action-select').nth(1).selectOption('reword');

    // Check stats
    await expect(page.locator('lv-interactive-rebase-dialog .stat', { hasText: 'Dropped' })).toContainText('1');
    await expect(page.locator('lv-interactive-rebase-dialog .stat', { hasText: 'Reworded' })).toContainText('1');
    await expect(page.locator('lv-interactive-rebase-dialog .stat', { hasText: 'Resulting' })).toContainText('2');
  });
});

test.describe('Interactive Rebase Autosquash', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Add mock with fixup! commits
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_rebase_commits') {
          return [
            { oid: 'abc123', shortId: 'abc123', summary: 'Add feature', author: 'Test', timestamp: Date.now() / 1000 },
            { oid: 'def456', shortId: 'def456', summary: 'fixup! Add feature', author: 'Test', timestamp: Date.now() / 1000 - 3600 },
            { oid: 'ghi789', shortId: 'ghi789', summary: 'Another commit', author: 'Test', timestamp: Date.now() / 1000 - 7200 },
          ];
        }

        if (command === 'execute_interactive_rebase') {
          return null;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show autosquash banner when fixup! commits exist', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Autosquash banner should be visible
    const banner = page.locator('lv-interactive-rebase-dialog .autosquash-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('fixup!');
  });

  test('should apply autosquash when button clicked', async ({ page }) => {
    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Click Apply Autosquash
    const applyButton = page.locator('lv-interactive-rebase-dialog .autosquash-banner button');
    await applyButton.click();

    // The fixup commit should now have action 'fixup'
    const actionSelects = page.locator('lv-interactive-rebase-dialog .action-select');

    // After autosquash, the fixup commit should be set to 'fixup' action
    // and reordered after its target
    const secondSelect = actionSelects.nth(1);
    await expect(secondSelect).toHaveValue('fixup');

    // Autosquash banner should be hidden after applying
    await expect(page.locator('lv-interactive-rebase-dialog .autosquash-banner')).not.toBeVisible();
  });
});

test.describe('Interactive Rebase - Event Propagation', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_rebase_commits') {
          return [
            { oid: 'abc123', shortId: 'abc123', summary: 'First commit', author: 'Test', timestamp: Date.now() / 1000 },
            { oid: 'def456', shortId: 'def456', summary: 'Second commit', author: 'Test', timestamp: Date.now() / 1000 - 3600 },
          ];
        }

        if (command === 'execute_interactive_rebase') {
          return null; // Success
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should dispatch repository-changed event after executing rebase', async ({ page }) => {
    const eventPromise = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        document.addEventListener('repository-changed', () => {
          resolve(true);
        }, { once: true });
        setTimeout(() => resolve(false), 5000);
      });
    });

    // Open dialog
    const developBranch = page.locator('lv-branch-list').getByRole('listitem', { name: /refs\/heads\/feature/ });
    await developBranch.click({ button: 'right' });
    await page.locator('.context-menu-item', { hasText: 'Interactive rebase onto this' }).click();

    await page.locator('lv-interactive-rebase-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Click Start Rebase button
    const startButton = page.locator('lv-interactive-rebase-dialog button', { hasText: /start.*rebase/i });
    await startButton.click();

    const eventReceived = await eventPromise;
    expect(eventReceived).toBe(true);
  });
});
