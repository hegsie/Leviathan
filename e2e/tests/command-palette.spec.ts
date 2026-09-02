import { test, expect, type Page } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { injectCommandError } from '../fixtures/test-helpers';

/**
 * The palette is loaded per repository: it caches the active repo's branches
 * and tracked files at open time and every entry it dispatches is scoped to
 * that repository. These specs cover the repository boundary from the real
 * surfaces — Ctrl/Cmd+P and the tab bar — rather than the internal flags.
 */

const palette = 'lv-command-palette[open]';

async function addRepo(page: Page, path: string, name: string): Promise<void> {
  await page.evaluate(
    ({ path, name }) => {
      const stores = (window as unknown as Record<string, unknown>).__LEVIATHAN_STORES__ as {
        repositoryStore: {
          getState: () => { addRepository: (repo: unknown) => void };
        };
      };
      stores.repositoryStore.getState().addRepository({
        path,
        name,
        isValid: true,
        isBare: false,
        headRef: 'main',
        state: 'clean',
        isShallow: false,
        isPartialClone: false,
        cloneFilter: null,
      });
    },
    { path, name }
  );
}

test.describe('Command palette repository boundary', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('an open palette closes when the active repository changes', async ({ page }) => {
    await addRepo(page, '/work/other-repo', 'other-repo');
    await expect(page.locator('lv-toolbar .tab.active')).toHaveAttribute(
      'title',
      '/work/other-repo'
    );

    await page.keyboard.press('Meta+p');
    await expect(page.locator(palette)).toBeVisible();

    // Ctrl+digit, not a click: the palette is a full-screen overlay, so a
    // click on the tab would dismiss it through the backdrop and prove
    // nothing about the repository switch.
    await page.keyboard.press('Control+1');

    await expect(page.locator('lv-toolbar .tab.active')).toHaveAttribute('title', '/tmp/test-repo');
    await expect(page.locator(palette)).toHaveCount(0);
  });

  test('a failed branch load is reported and the palette still opens', async ({ page }) => {
    await injectCommandError(page, 'get_branches', 'branches unavailable');

    await page.keyboard.press('Meta+p');

    await expect(page.locator('lv-toast-container .toast.error')).toContainText(
      'Failed to load branches: branches unavailable'
    );
    await expect(page.locator(palette)).toBeVisible();
  });

  test('a failed tracked-file load is reported and the palette still opens', async ({ page }) => {
    await injectCommandError(page, 'list_tracked_files', 'index unreadable');

    await page.keyboard.press('Meta+p');

    await expect(page.locator('lv-toast-container .toast.error')).toContainText(
      'Failed to load tracked files: index unreadable'
    );
    await expect(page.locator(palette)).toBeVisible();
  });

  test('an ordinary open reports nothing', async ({ page }) => {
    await page.keyboard.press('Meta+p');

    await expect(page.locator(palette)).toBeVisible();
    await expect(page.locator('lv-toast-container .toast.error')).toHaveCount(0);
  });
});
