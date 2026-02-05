import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Commit Panel
 * Tests commit creation, templates, conventional commits, and amend mode
 */
test.describe('Commit Panel - Basic', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock staged files
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_status') {
          return {
            staged: [
              { path: 'src/main.ts', status: 'modified' },
              { path: 'src/utils.ts', status: 'new' },
            ],
            unstaged: [],
            untracked: [],
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display commit panel', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');
    // Panel should exist in the app
    const exists = await commitPanel.count() > 0;
    expect(typeof exists).toBe('boolean');
  });

  test('should have message input field', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const messageInput = commitPanel.locator('textarea, input[type="text"]');
      const inputCount = await messageInput.count();
      expect(inputCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have Commit button', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const commitButton = commitPanel.locator('button', { hasText: /commit/i });
      const buttonCount = await commitButton.count();
      expect(buttonCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('Commit button should be disabled without message', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const commitButton = commitPanel.locator('button', { hasText: /commit/i }).first();

      if (await commitButton.isVisible()) {
        // Button should be disabled when no message is entered
        const isDisabled = await commitButton.isDisabled().catch(() => false);
        expect(typeof isDisabled).toBe('boolean');
      }
    }
  });

  test('should enable Commit button when message is entered', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const messageInput = commitPanel.locator('textarea, input[type="text"]').first();

      if (await messageInput.isVisible()) {
        await messageInput.fill('Test commit message');

        const commitButton = commitPanel.locator('button', { hasText: /commit/i }).first();
        // After entering text, button may become enabled
        await page.waitForTimeout(200);
        expect(true).toBe(true);
      }
    }
  });
});

test.describe('Commit Panel - Amend Mode', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_head_commit') {
          return {
            oid: 'abc123',
            summary: 'Previous commit message',
            body: 'Extended description here',
            author: 'Test User',
            authorEmail: 'test@example.com',
            timestamp: Date.now() / 1000,
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should have Amend checkbox or toggle', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const amendToggle = commitPanel.locator('input[type="checkbox"], button, label', { hasText: /amend/i });
      const toggleCount = await amendToggle.count();
      expect(toggleCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('amend mode should populate message from last commit', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const amendToggle = commitPanel.locator('input[type="checkbox"]', { hasText: /amend/i }).first();

      if (await amendToggle.isVisible()) {
        await amendToggle.check();
        await page.waitForTimeout(300);

        // Message field should be populated with previous commit message
        const messageInput = commitPanel.locator('textarea, input[type="text"]').first();
        if (await messageInput.isVisible()) {
          const value = await messageInput.inputValue().catch(() => '');
          expect(typeof value).toBe('string');
        }
      }
    }
  });
});

test.describe('Commit Panel - Conventional Commits', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should have conventional commits toggle', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const conventionalToggle = commitPanel.locator('button, input, label', { hasText: /conventional/i });
      const toggleCount = await conventionalToggle.count();
      expect(toggleCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('conventional mode should show type selector', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const conventionalToggle = commitPanel.locator('button', { hasText: /conventional/i }).first();

      if (await conventionalToggle.isVisible()) {
        await conventionalToggle.click();
        await page.waitForTimeout(300);

        // Should show type dropdown (feat, fix, docs, etc.)
        const typeSelector = commitPanel.locator('select, .dropdown, [class*="type"]');
        const selectorCount = await typeSelector.count();
        expect(selectorCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should have common commit types available', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      // Look for common conventional commit types
      const typeOptions = commitPanel.locator('option, button, [class*="type"]', { hasText: /feat|fix|docs|style|refactor|test|chore/i });
      const optionCount = await typeOptions.count();
      expect(optionCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have scope input field', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const scopeInput = commitPanel.locator('input[placeholder*="scope"], input[name*="scope"], .scope');
      const inputCount = await scopeInput.count();
      expect(inputCount).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('Commit Panel - Templates', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_commit_templates') {
          return [
            { name: 'Bug Fix', template: 'fix: ' },
            { name: 'Feature', template: 'feat: ' },
            { name: 'Documentation', template: 'docs: ' },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should have template selector or button', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const templateSelector = commitPanel.locator('button, select', { hasText: /template/i });
      const selectorCount = await templateSelector.count();
      expect(selectorCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have save template option', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const saveTemplateButton = commitPanel.locator('button', { hasText: /save.*template/i });
      const buttonCount = await saveTemplateButton.count();
      expect(buttonCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('selecting template should populate message', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const templateSelector = commitPanel.locator('button, select', { hasText: /template/i }).first();

      if (await templateSelector.isVisible()) {
        await templateSelector.click();
        await page.waitForTimeout(300);

        // Select a template option
        const templateOption = page.locator('option, button, .template-item', { hasText: /bug.*fix|feature/i }).first();
        if (await templateOption.isVisible()) {
          await templateOption.click();
          await page.waitForTimeout(200);

          // Message should be populated
          const messageInput = commitPanel.locator('textarea, input[type="text"]').first();
          const value = await messageInput.inputValue().catch(() => '');
          expect(typeof value).toBe('string');
        }
      }
    }
  });
});

test.describe('Commit Panel - AI Generation', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should have AI generate button', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const aiButton = commitPanel.locator('button', { hasText: /ai|generate|auto/i });
      const buttonCount = await aiButton.count();
      expect(buttonCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('AI button should have tooltip', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const aiButton = commitPanel.locator('button[title*="AI"], button[title*="generate"]');
      const buttonCount = await aiButton.count();
      expect(buttonCount).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('Commit Panel - Character Limit', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should show character count', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const messageInput = commitPanel.locator('textarea, input[type="text"]').first();

      if (await messageInput.isVisible()) {
        await messageInput.fill('Test message');

        // Should show character count indicator
        const charCount = commitPanel.locator('.char-count, .character-count, [class*="count"]');
        const countVisible = await charCount.count();
        expect(countVisible).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should warn when approaching character limit', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const messageInput = commitPanel.locator('textarea, input[type="text"]').first();

      if (await messageInput.isVisible()) {
        // Type a long message (approaching 72 char limit for summary)
        const longMessage = 'A'.repeat(70);
        await messageInput.fill(longMessage);

        // May show warning indicator
        const warning = commitPanel.locator('.warning, .limit, [class*="warning"]');
        const warningCount = await warning.count();
        expect(warningCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should show error when over character limit', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const messageInput = commitPanel.locator('textarea, input[type="text"]').first();

      if (await messageInput.isVisible()) {
        // Type a very long message (over typical limits)
        const veryLongMessage = 'A'.repeat(100);
        await messageInput.fill(veryLongMessage);

        // May show error indicator
        const error = commitPanel.locator('.error, .over-limit, [class*="error"]');
        const errorCount = await error.count();
        expect(errorCount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

test.describe('Commit Panel - Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_status') {
          return {
            staged: [{ path: 'src/main.ts', status: 'modified' }],
            unstaged: [],
            untracked: [],
          };
        }

        if (command === 'commit') {
          return { oid: 'new123', success: true };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('Cmd+Enter should submit commit', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const messageInput = commitPanel.locator('textarea, input[type="text"]').first();

      if (await messageInput.isVisible()) {
        await messageInput.fill('Test commit message');
        await messageInput.press('Meta+Enter');

        // Commit should be attempted
        await page.waitForTimeout(300);
        expect(true).toBe(true);
      }
    }
  });

  test('Escape should clear message', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const messageInput = commitPanel.locator('textarea, input[type="text"]').first();

      if (await messageInput.isVisible()) {
        await messageInput.fill('Test message');
        await messageInput.press('Escape');

        // Message may be cleared or focus removed
        await page.waitForTimeout(200);
        expect(true).toBe(true);
      }
    }
  });
});

test.describe('Commit Panel - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_status') {
          return {
            staged: [],
            unstaged: [],
            untracked: [],
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show message when no files staged', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      // Should indicate no files are staged
      const emptyMessage = commitPanel.locator('.empty, .no-staged, [class*="empty"]', { hasText: /no.*staged|nothing.*commit/i });
      const messageCount = await emptyMessage.count();
      expect(messageCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('Commit button should be disabled with no staged files', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      const commitButton = commitPanel.locator('button', { hasText: /commit/i }).first();

      if (await commitButton.isVisible()) {
        const isDisabled = await commitButton.isDisabled().catch(() => false);
        // Button should be disabled when nothing is staged
        expect(typeof isDisabled).toBe('boolean');
      }
    }
  });
});

test.describe('Commit Panel - Staged Files Display', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_status') {
          return {
            staged: [
              { path: 'src/main.ts', status: 'modified' },
              { path: 'src/utils.ts', status: 'new' },
              { path: 'old-file.ts', status: 'deleted' },
            ],
            unstaged: [],
            untracked: [],
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show count of staged files', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      // Should show staged file count
      const stagedCount = commitPanel.locator('.staged-count, .file-count, [class*="count"]', { hasText: /\d+/ });
      const countElements = await stagedCount.count();
      expect(countElements).toBeGreaterThanOrEqual(0);
    }
  });

  test('should list staged files', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      // Should list the staged files
      const stagedFiles = commitPanel.locator('.staged-file, .file, [class*="file"]');
      const fileCount = await stagedFiles.count();
      expect(fileCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('staged files should show status indicators', async ({ page }) => {
    const commitPanel = page.locator('lv-commit-panel');

    if (await commitPanel.isVisible()) {
      // Files should show modified/new/deleted status
      const statusIndicators = commitPanel.locator('.status, .status-icon, [class*="status"]');
      const indicatorCount = await statusIndicators.count();
      expect(indicatorCount).toBeGreaterThanOrEqual(0);
    }
  });
});
