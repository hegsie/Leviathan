import { test, expect, type Page } from '@playwright/test';
import {
  setupTauriMocks,
  emptyRepository,
  initializeUnifiedProfileStore,
  type MockUnifiedProfile,
  type MockIntegrationAccount,
} from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { DialogsPage } from '../pages/dialogs.page';
import {
  startCommandCapture,
  findCommand,
  waitForCommand,
  injectCommandMock,
  injectCommandError,
} from '../fixtures/test-helpers';

/**
 * E2E: cloning one of your own repositories from a connected account.
 *
 * Covers the whole hand-off — pick an account, list its repositories, filter
 * them, select one, and let the existing clone flow run — plus the states that
 * are not a list: no account connected, a rejected token, and offline mode.
 */

const defaultProfile: MockUnifiedProfile = {
  id: 'profile-1',
  name: 'Default',
  gitName: 'Test User',
  gitEmail: 'test@example.com',
  signingKey: null,
  urlPatterns: [],
  isDefault: true,
  color: '#4f46e5',
  defaultAccounts: { github: 'gh-acc-1' },
};

const githubAccount: MockIntegrationAccount = {
  id: 'gh-acc-1',
  name: 'Work GitHub',
  integrationType: 'github',
  config: { type: 'github' },
  color: '#24292e',
  cachedUser: { username: 'octocat', displayName: 'Octo Cat', avatarUrl: null },
  urlPatterns: [],
  isDefault: true,
};

function repository(name: string, extra: Record<string, unknown> = {}) {
  return {
    id: name,
    name,
    owner: 'octocat',
    fullName: `octocat/${name}`,
    description: null,
    isPrivate: false,
    cloneUrl: `https://github.com/octocat/${name}.git`,
    webUrl: `https://github.com/octocat/${name}`,
    defaultBranch: 'main',
    lastPushedAt: null,
    ...extra,
  };
}

/** Open the clone dialog and switch it to the "From account" source. */
async function openAccountSource(page: Page, dialogs: DialogsPage): Promise<void> {
  const app = new AppPage(page);
  await app.cloneButton.click();
  await dialogs.clone.waitForOpen();
  await page.getByRole('tab', { name: 'From account' }).click();
}

const repoItems = (page: Page) => page.locator('lv-account-repo-picker .repo-item');

test.describe('Clone Dialog - from a connected account', () => {
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, emptyRepository());
    dialogs = new DialogsPage(page);
    await new AppPage(page).goto();
  });

  test.describe('with a connected GitHub account', () => {
    test.beforeEach(async ({ page }) => {
      await initializeUnifiedProfileStore(page, {
        profiles: [defaultProfile],
        accounts: [githubAccount],
        connectedAccounts: ['gh-acc-1'],
      });
      await injectCommandMock(page, {
        get_keyring_token: 'gh-e2e-tok',
        list_github_repositories: {
          repositories: [
            repository('leviathan', {
              isPrivate: true,
              description: 'A git client',
              lastPushedAt: '2024-05-01T10:00:00Z',
            }),
            repository('dotfiles'),
          ],
          nextPage: null,
        },
        clone_repository: {
          path: '/home/user/projects/leviathan',
          name: 'leviathan',
          headRef: null,
          isBare: false,
        },
      });
    });

    test('lists the account repositories with owner, visibility and last push', async ({
      page,
    }) => {
      await openAccountSource(page, dialogs);

      await expect(repoItems(page)).toHaveCount(2);
      const first = repoItems(page).first();
      await expect(first).toContainText('leviathan');
      await expect(first).toContainText('octocat');
      await expect(first).toContainText('Private');
      await expect(first).toContainText('A git client');
      await expect(first).toContainText('Updated');
    });

    test('filters the listed repositories', async ({ page }) => {
      await openAccountSource(page, dialogs);
      await expect(repoItems(page)).toHaveCount(2);

      await page.getByRole('searchbox', { name: 'Filter repositories' }).fill('dot');

      await expect(repoItems(page)).toHaveCount(1);
      await expect(repoItems(page).first()).toContainText('dotfiles');
    });

    test('selecting a repository fills the URL and path and clones it', async ({ page }) => {
      await openAccountSource(page, dialogs);
      await expect(repoItems(page)).toHaveCount(2);

      await repoItems(page).first().click();

      await expect(dialogs.clone.urlInput).toHaveValue(
        'https://github.com/octocat/leviathan.git',
      );
      await dialogs.clone.fillPath('/home/user/projects');
      await expect(page.getByText('Selected: octocat/leviathan')).toBeVisible();

      await startCommandCapture(page);
      await dialogs.clone.clone();
      await waitForCommand(page, 'clone_repository');

      const cloneCommands = await findCommand(page, 'clone_repository');
      const args = cloneCommands[0].args as { url?: string; path?: string; token?: string };
      expect(args.url).toBe('https://github.com/octocat/leviathan.git');
      expect(args.path).toBe('/home/user/projects/leviathan');
      // The clone still picks up the account's token, unchanged by this flow.
      expect(args.token).toBe('gh-e2e-tok');
    });

    test('does not list anything until the account source is chosen', async ({ page }) => {
      await startCommandCapture(page);
      await new AppPage(page).cloneButton.click();
      await dialogs.clone.waitForOpen();
      await expect(dialogs.clone.urlInput).toBeVisible();

      expect(await findCommand(page, 'list_github_repositories')).toHaveLength(0);
    });
  });

  test('loads a further page only when asked', async ({ page }) => {
    await initializeUnifiedProfileStore(page, {
      profiles: [defaultProfile],
      accounts: [githubAccount],
      connectedAccounts: ['gh-acc-1'],
    });
    await page.evaluate(() => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke;
      (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_keyring_token') return 'gh-e2e-tok';
        if (command === 'list_github_repositories') {
          const page1 = ((args as { page?: number }).page ?? 1) === 1;
          return page1
            ? {
                repositories: [
                  {
                    id: 'first',
                    name: 'first',
                    owner: 'octocat',
                    fullName: 'octocat/first',
                    description: null,
                    isPrivate: false,
                    cloneUrl: 'https://github.com/octocat/first.git',
                    webUrl: null,
                    defaultBranch: 'main',
                    lastPushedAt: null,
                  },
                ],
                nextPage: 2,
              }
            : {
                repositories: [
                  {
                    id: 'second',
                    name: 'second',
                    owner: 'octocat',
                    fullName: 'octocat/second',
                    description: null,
                    isPrivate: false,
                    cloneUrl: 'https://github.com/octocat/second.git',
                    webUrl: null,
                    defaultBranch: 'main',
                    lastPushedAt: null,
                  },
                ],
                nextPage: null,
              };
        }
        return invoke(command, args);
      };
    });

    await startCommandCapture(page);
    await openAccountSource(page, dialogs);
    await expect(repoItems(page)).toHaveCount(1);
    expect(await findCommand(page, 'list_github_repositories')).toHaveLength(1);

    await page.locator('[data-action="load-more"]').click();

    await expect(repoItems(page)).toHaveCount(2);
    await expect(repoItems(page).nth(1)).toContainText('second');
    await expect(page.locator('[data-action="load-more"]')).toHaveCount(0);
  });

  test('with no accounts connected, offers to connect one', async ({ page }) => {
    await initializeUnifiedProfileStore(page, { profiles: [defaultProfile], accounts: [] });

    await openAccountSource(page, dialogs);

    const empty = page.locator('[data-state="no-accounts"]');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No accounts are connected');

    await empty.getByRole('button', { name: 'Connect an account' }).click();

    // The clone dialog steps aside rather than trapping the user under the
    // accounts manager.
    await expect(dialogs.clone.dialog).toBeHidden();
    await expect(page.locator('lv-profile-manager-dialog[open]')).toHaveCount(1);
    await expect(
      page.locator('lv-profile-manager-dialog[open] .dialog-overlay'),
    ).toBeVisible();
  });

  test('explains a rejected token and offers to reconnect', async ({ page }) => {
    await initializeUnifiedProfileStore(page, {
      profiles: [defaultProfile],
      accounts: [githubAccount],
      connectedAccounts: ['gh-acc-1'],
    });
    await injectCommandMock(page, { get_keyring_token: 'stale-token' });
    await injectCommandError(
      page,
      'list_github_repositories',
      'Authentication required',
      'AUTH_REQUIRED',
    );

    await openAccountSource(page, dialogs);

    const message = page.locator('[data-state="auth-expired"]');
    await expect(message).toBeVisible();
    await expect(message).toContainText('expired');
    await expect(message.getByRole('button', { name: 'Reconnect account' })).toBeVisible();
  });

  test('explains an account with no stored credential', async ({ page }) => {
    await initializeUnifiedProfileStore(page, {
      profiles: [defaultProfile],
      accounts: [githubAccount],
    });
    await injectCommandMock(page, { get_keyring_token: null });
    // With no per-account token the backend still tries a configured GitHub
    // App; this is what it answers when there is none either.
    await injectCommandError(
      page,
      'list_github_repositories',
      'Operation failed: GitHub token not configured',
    );

    await openAccountSource(page, dialogs);

    await expect(page.locator('[data-state="no-credential"]')).toBeVisible();
  });

  test('explains offline mode instead of failing silently', async ({ page }) => {
    await initializeUnifiedProfileStore(page, {
      profiles: [defaultProfile],
      accounts: [githubAccount],
      connectedAccounts: ['gh-acc-1'],
    });
    await injectCommandMock(page, { get_keyring_token: 'gh-e2e-tok' });
    await page.evaluate(() => {
      const stores = (window as unknown as Record<string, unknown>).__LEVIATHAN_STORES__ as {
        settingsStore: { setState: (state: Record<string, unknown>) => void };
      };
      stores.settingsStore.setState({ offlineMode: true });
    });

    await startCommandCapture(page);
    await openAccountSource(page, dialogs);

    const blocked = page.locator('[data-state="blocked"]');
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText('Offline mode');
    await expect(blocked).toContainText('Settings > Security');
    // Blocked before the request is ever made.
    expect(await findCommand(page, 'list_github_repositories')).toHaveLength(0);

    await page.evaluate(() => {
      const stores = (window as unknown as Record<string, unknown>).__LEVIATHAN_STORES__ as {
        settingsStore: { setState: (state: Record<string, unknown>) => void };
      };
      stores.settingsStore.setState({ offlineMode: false });
    });
  });
});
