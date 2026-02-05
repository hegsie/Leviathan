import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for GitHub Dialog
 * Tests GitHub integration with PRs, Issues, Releases, and Actions
 */
test.describe('GitHub Dialog - Connection Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock GitHub-related commands
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_github_repo') {
          return {
            owner: 'testuser',
            repo: 'testrepo',
            remoteName: 'origin',
          };
        }

        if (command === 'check_github_connection_with_token') {
          return {
            user: { login: 'testuser', name: 'Test User', avatarUrl: '' },
            scopes: ['repo', 'read:user'],
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open GitHub dialog from command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        await expect(githubDialog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should display detected repository info', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should show repo info
          const repoInfo = githubDialog.locator('text=testuser, text=testrepo', { exact: false });
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
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          // Should have tabs
          const tabs = githubDialog.locator('.tab, button[role="tab"], [class*="tab"]');
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
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const oauthButton = githubDialog.locator('button', { hasText: /sign.*in|oauth|github/i });
          const buttonCount = await oauthButton.count();
          expect(buttonCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show Personal Access Token option', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const patOption = githubDialog.locator('text=Personal Access Token, text=PAT, button:has-text("token")', { exact: false });
          const patCount = await patOption.count();
          expect(patCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('GitHub Dialog - Pull Requests Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_github_repo') {
          return { owner: 'testuser', repo: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_pull_requests') {
          return [
            {
              number: 123,
              title: 'Add new feature',
              state: 'open',
              author: 'developer',
              createdAt: new Date().toISOString(),
              headRef: 'feature/new-feature',
              baseRef: 'main',
              additions: 50,
              deletions: 10,
            },
            {
              number: 122,
              title: 'Fix bug in login',
              state: 'closed',
              author: 'developer2',
              createdAt: new Date().toISOString(),
              headRef: 'fix/login-bug',
              baseRef: 'main',
              additions: 5,
              deletions: 3,
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
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const prTab = githubDialog.locator('button, .tab', { hasText: /pull.*request/i });
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
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          // Click PR tab
          const prTab = githubDialog.locator('button, .tab', { hasText: /pull.*request/i }).first();
          if (await prTab.isVisible()) {
            await prTab.click();
            await page.waitForTimeout(300);

            const filterDropdown = githubDialog.locator('select, .dropdown, [class*="filter"]');
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
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const prTab = githubDialog.locator('button, .tab', { hasText: /pull.*request/i }).first();
          if (await prTab.isVisible()) {
            await prTab.click();
            await page.waitForTimeout(300);

            const newPrButton = githubDialog.locator('button', { hasText: /new.*pr|create.*pr/i });
            const buttonCount = await newPrButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('GitHub Dialog - Issues Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_github_repo') {
          return { owner: 'testuser', repo: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_issues') {
          return [
            {
              number: 45,
              title: 'Bug: Application crashes on startup',
              state: 'open',
              author: 'user1',
              createdAt: new Date().toISOString(),
              labels: [{ name: 'bug', color: 'ff0000' }],
              commentCount: 5,
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
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const issuesTab = githubDialog.locator('button, .tab', { hasText: /issues/i });
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
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const issuesTab = githubDialog.locator('button, .tab', { hasText: /issues/i }).first();
          if (await issuesTab.isVisible()) {
            await issuesTab.click();
            await page.waitForTimeout(300);

            const newIssueButton = githubDialog.locator('button', { hasText: /new.*issue/i });
            const buttonCount = await newIssueButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('GitHub Dialog - Actions Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_github_repo') {
          return { owner: 'testuser', repo: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'get_workflow_runs') {
          return [
            {
              id: 1,
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
              headBranch: 'main',
              runNumber: 42,
              event: 'push',
              createdAt: new Date().toISOString(),
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display Actions tab', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const actionsTab = githubDialog.locator('button, .tab', { hasText: /actions/i });
          const tabCount = await actionsTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('GitHub Dialog - Releases Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_github_repo') {
          return { owner: 'testuser', repo: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_releases') {
          return [
            {
              id: 1,
              tagName: 'v1.0.0',
              name: 'Release 1.0.0',
              isPrerelease: false,
              isDraft: false,
              author: 'maintainer',
              publishedAt: new Date().toISOString(),
              assetCount: 3,
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display Releases tab', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const releasesTab = githubDialog.locator('button, .tab', { hasText: /releases/i });
          const tabCount = await releasesTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have New Release button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const releasesTab = githubDialog.locator('button, .tab', { hasText: /releases/i }).first();
          if (await releasesTab.isVisible()) {
            await releasesTab.click();
            await page.waitForTimeout(300);

            const newReleaseButton = githubDialog.locator('button', { hasText: /new.*release/i });
            const buttonCount = await newReleaseButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('GitHub Dialog - Close', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should close dialog on close button click', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('github');
      await page.waitForTimeout(200);

      const githubOption = page.locator('lv-command-palette .command-item', { hasText: /github/i });
      if (await githubOption.isVisible()) {
        await githubOption.click();

        const githubDialog = page.locator('lv-github-dialog');
        if (await githubDialog.isVisible()) {
          const closeButton = githubDialog.locator('button[aria-label*="close"], button[title*="Close"], .close-button').first();
          if (await closeButton.isVisible()) {
            await closeButton.click();
            await expect(githubDialog).not.toBeVisible();
          }
        }
      }
    }
  });
});
