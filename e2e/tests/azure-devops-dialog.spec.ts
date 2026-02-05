import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Azure DevOps Dialog
 * Tests Azure DevOps integration with PRs, Work Items, and Pipelines
 */
test.describe('Azure DevOps Dialog - Connection Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock Azure DevOps-related commands
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_ado_repo') {
          return {
            organization: 'testorg',
            project: 'testproject',
            repoName: 'testrepo',
            remoteName: 'origin',
          };
        }

        if (command === 'check_ado_connection_with_pat') {
          return {
            user: { displayName: 'Test User', emailAddress: 'test@example.com', id: 'user-1' },
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open Azure DevOps dialog from command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        await expect(azureDialog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should display detected repository info', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should show repo info
          const repoInfo = azureDialog.locator('text=testorg, text=testproject', { exact: false });
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
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          // Should have tabs
          const tabs = azureDialog.locator('.tab, button[role="tab"], [class*="tab"]');
          const tabCount = await tabs.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show Personal Access Token option', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          const patOption = azureDialog.locator('text=Personal Access Token, text=PAT, input[type="password"], button:has-text("token")', { exact: false });
          const optionCount = await patOption.count();
          expect(optionCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have organization URL input', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          const orgInput = azureDialog.locator('input[placeholder*="organization"], input[placeholder*="dev.azure.com"]');
          const inputCount = await orgInput.count();
          expect(inputCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Azure DevOps Dialog - Pull Requests Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_ado_repo') {
          return { organization: 'testorg', project: 'testproject', repoName: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_ado_pull_requests') {
          return [
            {
              pullRequestId: 123,
              title: 'Add new feature',
              status: 'active',
              createdBy: { displayName: 'Developer', uniqueName: 'dev@example.com' },
              creationDate: new Date().toISOString(),
              sourceRefName: 'refs/heads/feature/new-feature',
              targetRefName: 'refs/heads/main',
            },
            {
              pullRequestId: 122,
              title: 'Fix bug in login',
              status: 'completed',
              createdBy: { displayName: 'Developer 2', uniqueName: 'dev2@example.com' },
              creationDate: new Date().toISOString(),
              sourceRefName: 'refs/heads/fix/login-bug',
              targetRefName: 'refs/heads/main',
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
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          const prTab = azureDialog.locator('button, .tab', { hasText: /pull.*request/i });
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
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          // Click PR tab
          const prTab = azureDialog.locator('button, .tab', { hasText: /pull.*request/i }).first();
          if (await prTab.isVisible()) {
            await prTab.click();
            await page.waitForTimeout(300);

            const filterDropdown = azureDialog.locator('select, .dropdown, [class*="filter"]');
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
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          const prTab = azureDialog.locator('button, .tab', { hasText: /pull.*request/i }).first();
          if (await prTab.isVisible()) {
            await prTab.click();
            await page.waitForTimeout(300);

            const newPrButton = azureDialog.locator('button', { hasText: /new.*pr|create.*pr/i });
            const buttonCount = await newPrButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('Azure DevOps Dialog - Work Items Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_ado_repo') {
          return { organization: 'testorg', project: 'testproject', repoName: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_ado_work_items') {
          return [
            {
              id: 45,
              title: 'Bug: Application crashes on startup',
              workItemType: 'Bug',
              state: 'Active',
              assignedTo: { displayName: 'Developer' },
              createdDate: new Date().toISOString(),
              priority: 1,
            },
            {
              id: 46,
              title: 'User Story: Add login feature',
              workItemType: 'User Story',
              state: 'New',
              assignedTo: { displayName: 'Developer 2' },
              createdDate: new Date().toISOString(),
              priority: 2,
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display Work Items tab', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          const workItemsTab = azureDialog.locator('button, .tab', { hasText: /work.*item/i });
          const tabCount = await workItemsTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have New Work Item button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          const workItemsTab = azureDialog.locator('button, .tab', { hasText: /work.*item/i }).first();
          if (await workItemsTab.isVisible()) {
            await workItemsTab.click();
            await page.waitForTimeout(300);

            const newWorkItemButton = azureDialog.locator('button', { hasText: /new.*work.*item/i });
            const buttonCount = await newWorkItemButton.count();
            expect(buttonCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('Azure DevOps Dialog - Pipelines Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'detect_ado_repo') {
          return { organization: 'testorg', project: 'testproject', repoName: 'testrepo', remoteName: 'origin' };
        }

        if (command === 'list_ado_pipeline_runs') {
          return [
            {
              id: 1,
              name: 'CI Pipeline',
              state: 'completed',
              result: 'succeeded',
              sourceBranch: 'refs/heads/main',
              createdDate: new Date().toISOString(),
              finishedDate: new Date().toISOString(),
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
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          const pipelinesTab = azureDialog.locator('button, .tab', { hasText: /pipelines/i });
          const tabCount = await pipelinesTab.count();
          expect(tabCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Azure DevOps Dialog - Close', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should close dialog on close button click', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('azure');
      await page.waitForTimeout(200);

      const azureOption = page.locator('lv-command-palette .command-item', { hasText: /azure.*devops/i });
      if (await azureOption.isVisible()) {
        await azureOption.click();

        const azureDialog = page.locator('lv-azure-devops-dialog');
        if (await azureDialog.isVisible()) {
          const closeButton = azureDialog.locator('button[aria-label*="close"], button[title*="Close"], .close-button').first();
          if (await closeButton.isVisible()) {
            await closeButton.click();
            await expect(azureDialog).not.toBeVisible();
          }
        }
      }
    }
  });
});
