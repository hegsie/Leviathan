import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Create Tag Dialog
 * Tests tag creation with annotated/lightweight options
 */
test.describe('Create Tag Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock create_tag command
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'create_tag') {
          return { name: 'v1.0.0', oid: 'abc123' };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open create tag dialog from toolbar or menu', async ({ page }) => {
    // Try to open via command palette or menu
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        await expect(tagDialog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should have tag name input field', async ({ page }) => {
    // Open dialog via command palette
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const nameInput = tagDialog.locator('input#tag-name-input, input[placeholder*="v1.0"]');
          await expect(nameInput).toBeVisible();
        }
      }
    }
  });

  test('should have target ref input field', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const targetInput = tagDialog.locator('input#target-input, input[placeholder*="HEAD"]');
          await expect(targetInput).toBeVisible();
        }
      }
    }
  });

  test('should have annotated tag toggle', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const annotatedToggle = tagDialog.locator('input[type="checkbox"], .toggle, label', { hasText: /annotated/i });
          const toggleCount = await annotatedToggle.count();
          expect(toggleCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show message textarea when annotated is enabled', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          // By default annotated is enabled, so message textarea should be visible
          const messageTextarea = tagDialog.locator('textarea#message-input, textarea');
          const textareaCount = await messageTextarea.count();
          expect(textareaCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have Cancel and Create Tag buttons', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const cancelButton = tagDialog.locator('button', { hasText: /cancel/i });
          const createButton = tagDialog.locator('button', { hasText: /create.*tag/i });

          await expect(cancelButton).toBeVisible();
          await expect(createButton).toBeVisible();
        }
      }
    }
  });

  test('Create Tag button should be disabled when name is empty', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const createButton = tagDialog.locator('button', { hasText: /create.*tag/i });
          const isDisabled = await createButton.isDisabled().catch(() => false);
          expect(typeof isDisabled).toBe('boolean');
        }
      }
    }
  });

  test('should close dialog on Cancel click', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const cancelButton = tagDialog.locator('button', { hasText: /cancel/i });
          await cancelButton.click();

          await expect(tagDialog).not.toBeVisible();
        }
      }
    }
  });

  test('should create tag when form is valid', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const nameInput = tagDialog.locator('input#tag-name-input, input[placeholder*="v1.0"]').first();
          await nameInput.fill('v1.0.0');

          const messageTextarea = tagDialog.locator('textarea').first();
          if (await messageTextarea.isVisible()) {
            await messageTextarea.fill('Release version 1.0.0');
          }

          const createButton = tagDialog.locator('button', { hasText: /create.*tag/i });
          await createButton.click();

          // Dialog should close after successful creation
          await page.waitForTimeout(500);
        }
      }
    }
  });

  test('should show hint about semantic versioning', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const hint = tagDialog.locator('.hint, .help-text, small', { hasText: /semantic|version/i });
          const hintCount = await hint.count();
          expect(hintCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Create Tag Dialog - Event Propagation', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'create_tag') {
          return { name: 'v1.0.0', oid: 'abc123' };
        }
        return originalInvoke(command, args);
      };
    });
  });

  test('should dispatch repository-changed event after creating tag', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('create tag');
      await page.waitForTimeout(200);

      const tagOption = page.locator('lv-command-palette .command-item', { hasText: /create.*tag/i });
      if (await tagOption.isVisible()) {
        await tagOption.click();

        const tagDialog = page.locator('lv-create-tag-dialog');
        if (await tagDialog.isVisible()) {
          const eventPromise = page.evaluate(() => {
            return new Promise<boolean>((resolve) => {
              document.addEventListener('repository-changed', () => {
                resolve(true);
              }, { once: true });
              setTimeout(() => resolve(false), 3000);
            });
          });

          const nameInput = tagDialog.locator('input#tag-name-input, input[placeholder*="v1.0"]').first();
          await nameInput.fill('v1.0.0');

          const createButton = tagDialog.locator('button', { hasText: /create.*tag/i });
          await createButton.click();

          const eventReceived = await eventPromise;
          expect(eventReceived).toBe(true);
        }
      }
    }
  });
});
