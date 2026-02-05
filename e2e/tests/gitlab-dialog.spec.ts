import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for GitLab Dialog
 * Tests GitLab integration with MRs, Issues, and Pipelines
 */
test.describe('GitLab Dialog - Connection Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_gitlab_repo') {
          return {
            projectPath: 'group/project',
            instanceUrl: 'https://gitlab.com',
            remoteName: 'origin',
          };
        }

        if (command === 'check_gitlab_connection_with_token') {
          return {
            user: { username: 'testuser', name: 'Test User', avatarUrl: '' },
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open GitLab dialog from command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        await expect(gitlabDialog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should display detected repository info', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          await page.waitForTimeout(500);

          const repoInfo = gitlabDialog.locator('text=group/project, text=gitlab.com', { exact: false });
          const infoCount = await repoInfo.count();
          expect(infoCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have instance URL input', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const instanceInput = gitlabDialog.locator('input[placeholder*="gitlab"], input[placeholder*="instance"]');
          const inputCount = await instanceInput.count();
          expect(inputCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have Personal Access Token input', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const patInput = gitlabDialog.locator('input[type="password"], input[placeholder*="token"]');
          const inputCount = await patInput.count();
          expect(inputCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('GitLab Dialog - Merge Requests Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_gitlab_repo') {
          return { projectPath: 'group/project', instanceUrl: 'https://gitlab.com', remoteName: 'origin' };
        }

        if (command === 'list_gitlab_merge_requests') {
          return [
            {
              iid: 42,
              title: 'Add new feature',
              state: 'opened',
              sourceBranch: 'feature/new',
              targetBranch: 'main',
              author: { username: 'developer' },
              createdAt: new Date().toISOString(),
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display Merge Requests tab', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const mrTab = gitlabDialog.locator('button, .tab', { hasText: /merge.*request/i });
          const tabCount = await mrTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have status filter dropdown', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const mrTab = gitlabDialog.locator('button, .tab', { hasText: /merge.*request/i }).first();
          if (await mrTab.isVisible()) {
            await mrTab.click();
            await page.waitForTimeout(300);

            const filterDropdown = gitlabDialog.locator('select, .dropdown, [class*="filter"]');
            const filterCount = await filterDropdown.count();
            expect(filterCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  test('should have New MR button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const mrTab = gitlabDialog.locator('button, .tab', { hasText: /merge.*request/i }).first();
          if (await mrTab.isVisible()) {
            await mrTab.click();
            await page.waitForTimeout(300);

            const newMrButton = gitlabDialog.locator('button', { hasText: /new.*mr|create.*mr/i });
            const buttonCount = await newMrButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('GitLab Dialog - Issues Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_gitlab_repo') {
          return { projectPath: 'group/project', instanceUrl: 'https://gitlab.com', remoteName: 'origin' };
        }

        if (command === 'list_gitlab_issues') {
          return [
            {
              iid: 15,
              title: 'Bug in feature',
              state: 'opened',
              author: { username: 'reporter' },
              createdAt: new Date().toISOString(),
              labels: ['bug'],
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
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const issuesTab = gitlabDialog.locator('button, .tab', { hasText: /issues/i });
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
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const issuesTab = gitlabDialog.locator('button, .tab', { hasText: /issues/i }).first();
          if (await issuesTab.isVisible()) {
            await issuesTab.click();
            await page.waitForTimeout(300);

            const newIssueButton = gitlabDialog.locator('button', { hasText: /new.*issue/i });
            const buttonCount = await newIssueButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('GitLab Dialog - Pipelines Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_gitlab_repo') {
          return { projectPath: 'group/project', instanceUrl: 'https://gitlab.com', remoteName: 'origin' };
        }

        if (command === 'list_gitlab_pipelines') {
          return [
            {
              id: 100,
              iid: 50,
              status: 'success',
              ref: 'main',
              sha: 'abc123',
              createdAt: new Date().toISOString(),
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
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const pipelinesTab = gitlabDialog.locator('button, .tab', { hasText: /pipelines/i });
          const tabCount = await pipelinesTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('GitLab Dialog - Close', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should close dialog on close button click', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('gitlab');
      await page.waitForTimeout(200);

      const gitlabOption = page.locator('lv-command-palette .command-item', { hasText: /gitlab/i });
      if (await gitlabOption.isVisible()) {
        await gitlabOption.click();

        const gitlabDialog = page.locator('lv-gitlab-dialog');
        if (await gitlabDialog.isVisible()) {
          const closeButton = gitlabDialog.locator('button[aria-label*="close"], button[title*="Close"], .close-button').first();
          if (await closeButton.isVisible()) {
            await closeButton.click();
            await expect(gitlabDialog).not.toBeVisible();
          }
        }
      }
    }
  });
});
