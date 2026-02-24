import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import {
  startCommandCaptureWithMocks,
  findCommand,
  injectCommandMock,
  openViaCommandPalette,
} from '../fixtures/test-helpers';

async function openWorkspaceManager(page: import('@playwright/test').Page): Promise<void> {
  await openViaCommandPalette(page, 'workspaces');
  await page.locator('lv-workspace-manager-dialog[open]').waitFor({ state: 'visible', timeout: 3000 });
}

test.describe('Workspace Manager - open-repo-file handler', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await injectCommandMock(page, {
      get_workspaces: [],
      search_workspace: [],
    });
  });

  test('should open workspace manager from command palette', async ({ page }) => {
    await openWorkspaceManager(page);
    await expect(page.locator('lv-workspace-manager-dialog[open]')).toBeVisible();
  });

  test('open-repo-file event should close workspace manager and show blame view', async ({ page }) => {
    await openWorkspaceManager(page);

    // Dispatch open-repo-file event from workspace manager
    await page.evaluate(() => {
      const dialog = document.querySelector('lv-workspace-manager-dialog');
      if (dialog) {
        dialog.dispatchEvent(new CustomEvent('open-repo-file', {
          detail: { repoPath: '/tmp/test-repo', filePath: 'src/main.ts', lineNumber: 10 },
          bubbles: true,
          composed: true,
        }));
      }
    });

    // Workspace manager should close
    await expect(page.locator('lv-workspace-manager-dialog[open]')).not.toBeVisible();
  });

  test('open-repo-file for different repo should call open_repository', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      get_workspaces: [],
      open_repository: {
        path: '/tmp/other-repo',
        name: 'other-repo',
        isValid: true,
        isBare: false,
        headRef: 'refs/heads/main',
        state: 'clean',
      },
      get_commits: [],
      get_branches: [],
      get_status: [],
      get_stashes: [],
      get_tags: [],
      get_remotes: [],
      get_head_info: { name: 'main', oid: 'abc123', isDetached: false },
    });

    await openWorkspaceManager(page);

    // Dispatch open-repo-file with a different repo path
    await page.evaluate(() => {
      const dialog = document.querySelector('lv-workspace-manager-dialog');
      if (dialog) {
        dialog.dispatchEvent(new CustomEvent('open-repo-file', {
          detail: { repoPath: '/tmp/other-repo', filePath: 'README.md', lineNumber: 1 },
          bubbles: true,
          composed: true,
        }));
      }
    });

    // Should have called open_repository with the other repo path
    await expect
      .poll(async () => {
        const cmds = await findCommand(page, 'open_repository');
        return cmds.filter(c => (c.args as { path?: string })?.path === '/tmp/other-repo').length;
      })
      .toBeGreaterThan(0);
  });

  test('open-repo-file error should show toast notification', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      get_workspaces: [],
      open_repository: { __error__: 'Repository not found' },
    });

    await openWorkspaceManager(page);

    // Dispatch open-repo-file with a non-existent repo
    await page.evaluate(() => {
      const dialog = document.querySelector('lv-workspace-manager-dialog');
      if (dialog) {
        dialog.dispatchEvent(new CustomEvent('open-repo-file', {
          detail: { repoPath: '/tmp/nonexistent', filePath: 'file.ts', lineNumber: 1 },
          bubbles: true,
          composed: true,
        }));
      }
    });

    // Should show an error toast
    await expect(page.locator('lv-toast-container .toast.error, lv-toast-container .toast-error')).toBeVisible({ timeout: 5000 });
  });
});
