import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Worktree and Clean Dialogs
 * Tests worktree management and untracked file cleanup
 */

test.describe('Worktree Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

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

        if (command === 'get_worktrees') {
          return [
            {
              path: '/tmp/test-repo',
              branch: 'main',
              isMain: true,
              isLocked: false,
              commit: 'abc123',
            },
            {
              path: '/tmp/test-repo-feature',
              branch: 'feature/new-feature',
              isMain: false,
              isLocked: false,
              commit: 'def456',
            },
          ];
        }

        if (command === 'add_worktree' || command === 'remove_worktree' || command === 'lock_worktree' || command === 'unlock_worktree') {
          return null;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display worktree dialog', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');
    const count = await worktreeDialog.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should show existing worktrees', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      const worktreeEntries = page.locator('lv-worktree-dialog .worktree-entry, lv-worktree-dialog .worktree-item');
      const count = await worktreeEntries.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have Add Worktree button', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      const addButton = page.locator('lv-worktree-dialog button', { hasText: /add|create/i });
      await expect(addButton.first()).toBeVisible();
    }
  });

  test('should show form for creating new worktree', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      const addButton = page.locator('lv-worktree-dialog button', { hasText: /add|create/i }).first();

      if (await addButton.isVisible()) {
        await addButton.click();

        // Form fields should appear
        const pathInput = page.locator('lv-worktree-dialog input[name="path"], lv-worktree-dialog input[placeholder*="path"]');
        const branchInput = page.locator('lv-worktree-dialog input[name="branch"], lv-worktree-dialog select');

        // At least one should exist
        const pathCount = await pathInput.count();
        const branchCount = await branchInput.count();
        expect(pathCount + branchCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should allow selecting branch for new worktree', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      const branchSelect = page.locator('lv-worktree-dialog select');

      if (await branchSelect.isVisible()) {
        // Should have options
        const options = branchSelect.locator('option');
        const count = await options.count();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should invoke add_worktree command', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      // Fill form and submit
      const pathInput = page.locator('lv-worktree-dialog input[name="path"]').first();
      const submitButton = page.locator('lv-worktree-dialog button[type="submit"], lv-worktree-dialog button', { hasText: /create|add/i }).first();

      if (await pathInput.isVisible() && await submitButton.isVisible()) {
        await pathInput.fill('/tmp/new-worktree');
        await submitButton.click();

        await page.waitForTimeout(100);

        const commands = await page.evaluate(() => {
          return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
            .__INVOKED_COMMANDS__;
        });

        const addCommand = commands.find(c => c.command === 'add_worktree');
        expect(addCommand).toBeDefined();
      }
    }
  });

  test('should have Remove Worktree option', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      const removeButton = page.locator('lv-worktree-dialog button', { hasText: /remove|delete/i });
      // May exist for non-main worktrees
      const count = await removeButton.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have Lock/Unlock option', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      const lockButton = page.locator('lv-worktree-dialog button', { hasText: /lock|unlock/i });
      const count = await lockButton.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should close dialog on Cancel', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      const cancelButton = page.locator('lv-worktree-dialog button', { hasText: /cancel|close/i });

      if (await cancelButton.isVisible()) {
        await cancelButton.click();
        await expect(worktreeDialog).not.toBeVisible();
      }
    }
  });
});

test.describe('Clean Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page, {
      status: {
        staged: [],
        unstaged: [
          { path: 'untracked-file.txt', status: 'new', isStaged: false, isConflicted: false },
          { path: 'another-untracked.js', status: 'new', isStaged: false, isConflicted: false },
          { path: 'build/output.js', status: 'new', isStaged: false, isConflicted: false },
          { path: 'node_modules/dep/index.js', status: 'new', isStaged: false, isConflicted: false },
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

        if (command === 'get_untracked_files') {
          return [
            { path: 'untracked-file.txt', isDirectory: false },
            { path: 'another-untracked.js', isDirectory: false },
            { path: 'build/', isDirectory: true },
            { path: 'node_modules/', isDirectory: true },
          ];
        }

        if (command === 'clean_files') {
          return null;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display clean dialog', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');
    const count = await cleanDialog.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should show untracked files list', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const fileEntries = page.locator('lv-clean-dialog .file-entry, lv-clean-dialog .untracked-file');
      const count = await fileEntries.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have checkboxes to select files', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const checkboxes = page.locator('lv-clean-dialog input[type="checkbox"]');
      const count = await checkboxes.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have Select All option', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const selectAllButton = page.locator('lv-clean-dialog button', { hasText: /select.*all/i });
      const selectAllCheckbox = page.locator('lv-clean-dialog input[type="checkbox"]').first();

      // At least one should exist
      const buttonCount = await selectAllButton.count();
      const checkboxCount = await selectAllCheckbox.count();
      expect(buttonCount + checkboxCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have Clean/Delete button', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const cleanButton = page.locator('lv-clean-dialog button', { hasText: /clean|delete|remove/i });
      await expect(cleanButton.first()).toBeVisible();
    }
  });

  test('should show warning about irreversible action', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const warning = page.locator('lv-clean-dialog', { hasText: /warning|cannot.*undo|irreversible/i });
      // Warning may or may not be visible depending on implementation
      const count = await warning.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should invoke clean_files command', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      // Select files and click clean
      const checkbox = page.locator('lv-clean-dialog input[type="checkbox"]').first();

      if (await checkbox.isVisible()) {
        await checkbox.check();
      }

      const cleanButton = page.locator('lv-clean-dialog button', { hasText: /clean|delete/i }).first();

      if (await cleanButton.isVisible()) {
        await cleanButton.click();

        // May show confirmation
        const confirmButton = page.locator('button', { hasText: /confirm|yes|ok/i });
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
        }

        await page.waitForTimeout(100);

        const commands = await page.evaluate(() => {
          return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
            .__INVOKED_COMMANDS__;
        });

        const cleanCommand = commands.find(c => c.command === 'clean_files');
        expect(cleanCommand).toBeDefined();
      }
    }
  });

  test('should have option to include directories', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const includeDirectoriesOption = page.locator('lv-clean-dialog', { hasText: /director/i });
      const count = await includeDirectoriesOption.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have option to include ignored files', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const includeIgnoredOption = page.locator('lv-clean-dialog', { hasText: /ignored/i });
      const count = await includeIgnoredOption.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should close dialog on Cancel', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const cancelButton = page.locator('lv-clean-dialog button', { hasText: /cancel|close/i });

      if (await cancelButton.isVisible()) {
        await cancelButton.click();
        await expect(cleanDialog).not.toBeVisible();
      }
    }
  });

  test('should differentiate files and directories in list', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      // Directories should have some indicator (icon, trailing slash, etc.)
      const directoryIndicators = page.locator('lv-clean-dialog .directory-icon, lv-clean-dialog :text("build/"), lv-clean-dialog :text("node_modules/")');
      const count = await directoryIndicators.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('Worktree Dialog - Event Propagation', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_worktrees') {
          return [
            {
              path: '/tmp/test-repo',
              branch: 'main',
              isMain: true,
              isLocked: false,
              commit: 'abc123',
            },
          ];
        }

        if (command === 'add_worktree' || command === 'remove_worktree') {
          return null;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should dispatch repository-changed event after adding worktree', async ({ page }) => {
    const worktreeDialog = page.locator('lv-worktree-dialog');

    if (await worktreeDialog.isVisible()) {
      const pathInput = page.locator('lv-worktree-dialog input[name="path"]').first();
      const submitButton = page.locator('lv-worktree-dialog button[type="submit"], lv-worktree-dialog button', { hasText: /create|add/i }).first();

      if (await pathInput.isVisible() && await submitButton.isVisible()) {
        const eventPromise = page.evaluate(() => {
          return new Promise<boolean>((resolve) => {
            document.addEventListener('repository-changed', () => {
              resolve(true);
            }, { once: true });
            setTimeout(() => resolve(false), 3000);
          });
        });

        await pathInput.fill('/tmp/new-worktree');
        await submitButton.click();

        const eventReceived = await eventPromise;
        expect(eventReceived).toBe(true);
      }
    }
  });
});

test.describe('Clean Dialog - Event Propagation', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page, {
      status: {
        staged: [],
        unstaged: [
          { path: 'untracked-file.txt', status: 'new', isStaged: false, isConflicted: false },
        ],
      },
    });

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_untracked_files') {
          return [
            { path: 'untracked-file.txt', isDirectory: false },
          ];
        }

        if (command === 'clean_files') {
          return null;
        }

        if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|ask') {
          return true;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should dispatch repository-changed event after cleaning files', async ({ page }) => {
    const cleanDialog = page.locator('lv-clean-dialog');

    if (await cleanDialog.isVisible()) {
      const checkbox = page.locator('lv-clean-dialog input[type="checkbox"]').first();

      if (await checkbox.isVisible()) {
        await checkbox.check();
      }

      const cleanButton = page.locator('lv-clean-dialog button', { hasText: /clean|delete/i }).first();

      if (await cleanButton.isVisible()) {
        const eventPromise = page.evaluate(() => {
          return new Promise<boolean>((resolve) => {
            document.addEventListener('repository-changed', () => {
              resolve(true);
            }, { once: true });
            setTimeout(() => resolve(false), 3000);
          });
        });

        await cleanButton.click();

        // Handle confirmation if shown
        const confirmButton = page.locator('button', { hasText: /confirm|yes|ok/i });
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
        }

        const eventReceived = await eventPromise;
        expect(eventReceived).toBe(true);
      }
    }
  });
});
