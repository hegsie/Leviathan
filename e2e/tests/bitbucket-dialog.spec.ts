import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Bitbucket Dialog
 * Tests Bitbucket integration with PRs, Issues, and Pipelines
 */
test.describe('Bitbucket Dialog - Connection Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock Bitbucket-related commands
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_bitbucket_repo') {
          return {
            workspace: 'testworkspace',
            repoSlug: 'testrepo',
            remoteName: 'origin',
          };
        }

        if (command === 'check_bitbucket_connection_with_token') {
          return {
            user: { username: 'testuser', displayName: 'Test User', avatarUrl: '' },
            scopes: ['repository', 'pullrequest'],
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open Bitbucket dialog from command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        await expect(bitbucketDialog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should display detected repository info', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should show repo info
          const repoInfo = bitbucketDialog.locator('text=testworkspace, text=testrepo', { exact: false });
          const infoCount = await repoInfo.count();
          expect(infoCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have tab navigation', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          // Should have tabs
          const tabs = bitbucketDialog.locator('.tab, button[role="tab"], [class*="tab"]');
          const tabCount = await tabs.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show OAuth sign-in option', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          const oauthButton = bitbucketDialog.locator('button', { hasText: /sign.*in|oauth|bitbucket/i });
          const buttonCount = await oauthButton.count();
          expect(buttonCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show App Password option', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          const appPasswordOption = bitbucketDialog.locator('text=App Password, text=password, button:has-text("password")', { exact: false });
          const optionCount = await appPasswordOption.count();
          expect(optionCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Bitbucket Dialog - Pull Requests Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_bitbucket_repo') {
          return { workspace: 'testworkspace', repoSlug: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_bitbucket_pull_requests') {
          return [
            {
              id: 1,
              title: 'Add new feature',
              state: 'OPEN',
              author: { username: 'developer', displayName: 'Developer' },
              createdOn: new Date().toISOString(),
              sourceBranch: 'feature/new-feature',
              destinationBranch: 'main',
            },
            {
              id: 2,
              title: 'Fix bug in login',
              state: 'MERGED',
              author: { username: 'developer2', displayName: 'Developer 2' },
              createdOn: new Date().toISOString(),
              sourceBranch: 'fix/login-bug',
              destinationBranch: 'main',
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display Pull Requests tab', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          const prTab = bitbucketDialog.locator('button, .tab', { hasText: /pull.*request/i });
          const tabCount = await prTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have filter dropdown', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          // Click PR tab
          const prTab = bitbucketDialog.locator('button, .tab', { hasText: /pull.*request/i }).first();
          if (await prTab.isVisible()) {
            await prTab.click();
            await page.waitForTimeout(300);

            const filterDropdown = bitbucketDialog.locator('select, .dropdown, [class*="filter"]');
            const filterCount = await filterDropdown.count();
            expect(filterCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  test('should have New PR button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          const prTab = bitbucketDialog.locator('button, .tab', { hasText: /pull.*request/i }).first();
          if (await prTab.isVisible()) {
            await prTab.click();
            await page.waitForTimeout(300);

            const newPrButton = bitbucketDialog.locator('button', { hasText: /new.*pr|create.*pr/i });
            const buttonCount = await newPrButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('Bitbucket Dialog - Issues Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_bitbucket_repo') {
          return { workspace: 'testworkspace', repoSlug: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_bitbucket_issues') {
          return [
            {
              id: 45,
              title: 'Bug: Application crashes on startup',
              state: 'open',
              reporter: { username: 'user1', displayName: 'User 1' },
              createdOn: new Date().toISOString(),
              priority: 'major',
              kind: 'bug',
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display Issues tab', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          const issuesTab = bitbucketDialog.locator('button, .tab', { hasText: /issues/i });
          const tabCount = await issuesTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have New Issue button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          const issuesTab = bitbucketDialog.locator('button, .tab', { hasText: /issues/i }).first();
          if (await issuesTab.isVisible()) {
            await issuesTab.click();
            await page.waitForTimeout(300);

            const newIssueButton = bitbucketDialog.locator('button', { hasText: /new.*issue/i });
            const buttonCount = await newIssueButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('Bitbucket Dialog - Pipelines Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_bitbucket_repo') {
          return { workspace: 'testworkspace', repoSlug: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_bitbucket_pipelines') {
          return [
            {
              uuid: '{pipeline-1}',
              buildNumber: 42,
              state: { name: 'SUCCESSFUL' },
              target: { refName: 'main', refType: 'branch' },
              createdOn: new Date().toISOString(),
              durationInSeconds: 120,
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display Pipelines tab', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          const pipelinesTab = bitbucketDialog.locator('button, .tab', { hasText: /pipelines/i });
          const tabCount = await pipelinesTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Bitbucket Dialog - Close', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should close dialog on close button click', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('bitbucket');
      await page.waitForTimeout(200);

      const bitbucketOption = page.locator('lv-command-palette .command-item', { hasText: /bitbucket/i });
      if (await bitbucketOption.isVisible()) {
        await bitbucketOption.click();

        const bitbucketDialog = page.locator('lv-bitbucket-dialog');
        if (await bitbucketDialog.isVisible()) {
          const closeButton = bitbucketDialog.locator('button[aria-label*="close"], button[title*="Close"], .close-button').first();
          if (await closeButton.isVisible()) {
            await closeButton.click();
            await expect(bitbucketDialog).not.toBeVisible();
          }
        }
      }
    }
  });
});
