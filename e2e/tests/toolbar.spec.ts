import { test, expect } from '@playwright/test';
import { setupOpenRepository, setupTauriMocks } from '../fixtures/tauri-mock';
import { startCommandCapture, startCommandCaptureWithMocks, findCommand, waitForCommand, injectCommandError, injectCommandMock } from '../fixtures/test-helpers';

/**
 * E2E tests for Toolbar
 * Tests toolbar buttons, repository tabs, and actions
 */

/**
 * Fetch/Pull/Push exist on two surfaces — the toolbar and the context
 * dashboard — so every locator for them must say which one it means. The
 * dashboard's copies are covered in remote-operations.spec.ts.
 */
function toolbarButton(page: import('@playwright/test').Page, name: RegExp) {
  return page.locator('lv-toolbar').getByRole('button', { name });
}

/** Ahead/behind values for the current branch, as the store holds them. */
function withAheadBehind(ahead: number, behind: number, upstream: string | null = 'origin/main') {
  return {
    branches: [
      {
        name: 'main',
        shorthand: 'main',
        isHead: true,
        isRemote: false,
        upstream,
        targetOid: 'abc123def456',
        aheadBehind: upstream ? { ahead, behind } : undefined,
        lastCommitTimestamp: Date.now() / 1000,
        isStale: false,
      },
    ],
  };
}
test.describe('Toolbar Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should display Open Repository button', async ({ page }) => {
    const openButton = page.locator('button[title="Open Repository"]');
    await expect(openButton).toBeVisible();
  });

  test('should display Clone Repository button', async ({ page }) => {
    const cloneButton = page.locator('button[title="Clone Repository"]');
    await expect(cloneButton).toBeVisible();
  });

  test('should display Init Repository button', async ({ page }) => {
    const initButton = page.locator('button[title="Init Repository"]');
    await expect(initButton).toBeVisible();
  });

  test('should display Search button when repo is open', async ({ page }) => {
    const searchButton = page.locator('button[title*="Search commits"]');
    await expect(searchButton).toBeVisible();
  });

  test('should display Command Palette button', async ({ page }) => {
    const commandPaletteButton = page.locator('button[title*="Command Palette"]');
    await expect(commandPaletteButton).toBeVisible();
  });

  test('should display Keyboard Shortcuts button', async ({ page }) => {
    const shortcutsButton = page.locator('button[title*="Keyboard Shortcuts"]');
    await expect(shortcutsButton).toBeVisible();
  });

  test('should display Settings button', async ({ page }) => {
    const settingsButton = page.locator('button[title="Settings"]');
    await expect(settingsButton).toBeVisible();
  });
});

test.describe('Toolbar Clone Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should open clone dialog when clicking Clone button', async ({ page }) => {
    const cloneButton = page.locator('button[title="Clone Repository"]');
    await cloneButton.click();

    // Clone dialog uses role="dialog"
    const cloneDialog = page.getByRole('dialog', { name: /clone/i });
    await expect(cloneDialog).toBeVisible({ timeout: 3000 });
  });

  test('clone dialog should have URL input', async ({ page }) => {
    const cloneButton = page.locator('button[title="Clone Repository"]');
    await cloneButton.click();

    const cloneDialog = page.getByRole('dialog', { name: /clone/i });
    await expect(cloneDialog).toBeVisible({ timeout: 3000 });

    // URL input should be inside the dialog
    const urlInput = page.getByRole('textbox', { name: /url/i });
    await expect(urlInput).toBeVisible();
  });

  test('clone dialog should have Clone button', async ({ page }) => {
    const cloneButton = page.locator('button[title="Clone Repository"]');
    await cloneButton.click();

    const cloneDialog = page.getByRole('dialog', { name: /clone/i });
    await expect(cloneDialog).toBeVisible({ timeout: 3000 });

    // Clone button (may be disabled initially)
    const dialogCloneButton = page.getByRole('button', { name: /^clone$/i });
    await expect(dialogCloneButton).toBeVisible();
  });

  test('clone dialog should close on Cancel', async ({ page }) => {
    const cloneButton = page.locator('button[title="Clone Repository"]');
    await cloneButton.click();

    const cloneDialog = page.getByRole('dialog', { name: /clone/i });
    await expect(cloneDialog).toBeVisible({ timeout: 3000 });

    // Click Cancel button (use page-level selector)
    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.click();

    await expect(cloneDialog).not.toBeVisible();
  });
});

test.describe('Toolbar Init Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should open init dialog when clicking Init button', async ({ page }) => {
    const initButton = page.locator('button[title="Init Repository"]');
    await initButton.click();

    // Init dialog uses role="dialog"
    const initDialog = page.getByRole('dialog', { name: /init/i });
    await expect(initDialog).toBeVisible({ timeout: 3000 });
  });

  test('init dialog should have path input or browse button', async ({ page }) => {
    const initButton = page.locator('button[title="Init Repository"]');
    await initButton.click();

    const initDialog = page.getByRole('dialog', { name: /init/i });
    await expect(initDialog).toBeVisible({ timeout: 3000 });

    // Should have Browse button or Initialize button (page-level selectors)
    await expect(
      page.getByRole('button', { name: /browse|init/i }).first()
    ).toBeVisible();
  });
});

test.describe('Toolbar Repository Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should display repository tab when repo is open', async ({ page }) => {
    const repoTab = page.locator('button', { hasText: 'test-repo' });
    await expect(repoTab).toBeVisible();
  });

  test('repository tab should show repo name', async ({ page }) => {
    const repoTab = page.locator('button', { hasText: 'test-repo' });
    await expect(repoTab).toContainText('test-repo');
  });

  test('opening repo should highlight current branch in branch list', async ({ page }) => {
    // The current branch should be marked active in the branch list
    const activeBranch = page.locator('lv-branch-list .branch-item.active');
    await expect(activeBranch).toBeVisible();
    await expect(activeBranch).toContainText('main');
  });

  test('repository tab should have close button', async ({ page }) => {
    const repoTab = page.locator('button', { hasText: 'test-repo' });
    // Close icon should exist within the tab (usually an svg icon)
    const closeIcon = repoTab.locator('img, svg').last();
    await expect(closeIcon).toBeVisible();
  });
});

test.describe('Toolbar Settings Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should open settings dialog when clicking Settings button', async ({ page }) => {
    const settingsButton = page.locator('button[title="Settings"]');
    await settingsButton.click();

    const settingsDialog = page.locator('lv-settings-dialog');
    await expect(settingsDialog).toBeVisible();
  });

  test('settings dialog should have theme options', async ({ page }) => {
    const settingsButton = page.locator('button[title="Settings"]');
    await settingsButton.click();

    // Should have some theme-related UI
    const themeSection = page.locator('lv-settings-dialog', { hasText: /theme|appearance/i });
    await expect(themeSection).toBeVisible();
  });
});

test.describe('Toolbar Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should open command palette when clicking button', async ({ page }) => {
    const commandPaletteButton = page.locator('button[title*="Command Palette"]');
    await commandPaletteButton.click();

    const commandPalette = page.locator('lv-command-palette');
    await expect(commandPalette).toBeVisible();
  });

  test('should open command palette with Cmd+P', async ({ page }) => {
    await page.keyboard.press('Meta+p');

    const commandPalette = page.locator('lv-command-palette');
    await expect(commandPalette).toBeVisible();
  });

  test('command palette should have search input', async ({ page }) => {
    const commandPaletteButton = page.locator('button[title*="Command Palette"]');
    await commandPaletteButton.click();

    const searchInput = page.locator('lv-command-palette input');
    await expect(searchInput).toBeVisible();
  });

  test('command palette should close with Escape', async ({ page }) => {
    const commandPaletteButton = page.locator('button[title*="Command Palette"]');
    await commandPaletteButton.click();

    const commandPalette = page.locator('lv-command-palette');
    await expect(commandPalette).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(commandPalette).not.toBeVisible();
  });
});

test.describe('Toolbar Keyboard Shortcuts Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should open keyboard shortcuts dialog when clicking button', async ({ page }) => {
    const shortcutsButton = page.locator('button[title*="Keyboard Shortcuts"]');
    await shortcutsButton.click();

    const shortcutsDialog = page.locator('lv-keyboard-shortcuts-dialog');
    await expect(shortcutsDialog).toBeVisible();
  });

  test('should open keyboard shortcuts with ? key', async ({ page }) => {
    // Focus the page first, then press ?
    await page.click('body');
    await page.keyboard.press('?');

    const shortcutsDialog = page.locator('lv-keyboard-shortcuts-dialog[open]');
    await expect(shortcutsDialog).toBeVisible();
  });

  test('keyboard shortcuts dialog should list shortcuts', async ({ page }) => {
    const shortcutsButton = page.locator('button[title*="Keyboard Shortcuts"]');
    await shortcutsButton.click();

    // Wait for dialog to open
    const shortcutsDialog = page.locator('lv-keyboard-shortcuts-dialog[open]');
    await expect(shortcutsDialog).toBeVisible();

    // The dialog should show shortcuts content with shortcut rows
    const shortcutRows = page.locator('lv-keyboard-shortcuts-dialog[open] .shortcut-row');
    const rowCount = await shortcutRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(5);
  });
});

test.describe('Toolbar without Repository', () => {
  test.beforeEach(async ({ page }) => {
    // Setup without opening a repository
    await setupTauriMocks(page, {
      repository: {
        path: '',
        name: '',
        isValid: false,
        isBare: false,
        headRef: null,
        state: 'clean',
      },
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should show Open/Clone/Init buttons without repo', async ({ page }) => {
    const openButton = page.locator('button[title="Open Repository"]');
    const cloneButton = page.locator('button[title="Clone Repository"]');
    const initButton = page.locator('button[title="Init Repository"]');

    await expect(openButton).toBeVisible();
    await expect(cloneButton).toBeVisible();
    await expect(initButton).toBeVisible();
  });

  test('should not show search button without repo', async ({ page }) => {
    // Search button should not be visible when no repo is open
    const searchButton = page.locator('button[title*="Search commits"]');
    await expect(searchButton).not.toBeVisible();
  });
});

test.describe('Toolbar Clone Dialog - Full Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('fill URL and click Clone should call clone_repository command', async ({ page }) => {
    const cloneButton = page.locator('button[title="Clone Repository"]');
    await cloneButton.click();

    const cloneDialog = page.getByRole('dialog', { name: /clone/i });
    await expect(cloneDialog).toBeVisible({ timeout: 3000 });

    // Fill the URL
    const urlInput = page.getByRole('textbox', { name: /url/i });
    await urlInput.fill('https://github.com/test/repo.git');

    // Fill the destination path (required for Clone button to be enabled)
    const pathInput = page.getByRole('textbox', { name: /clone to/i });
    await pathInput.fill('/tmp/clone-dest');

    await startCommandCapture(page);

    // Click Clone button
    const dialogCloneButton = page.locator('lv-clone-dialog').getByRole('button', { name: 'Clone', exact: true });
    await dialogCloneButton.click();

    await waitForCommand(page, 'clone_repository');

    const cloneCommands = await findCommand(page, 'clone_repository');
    expect(cloneCommands.length).toBeGreaterThan(0);
  });

  test('clone failure should show error in dialog', async ({ page }) => {
    const cloneButton = page.locator('button[title="Clone Repository"]');
    await cloneButton.click();

    const cloneDialog = page.getByRole('dialog', { name: /clone/i });
    await expect(cloneDialog).toBeVisible({ timeout: 3000 });

    // Inject error for clone_repository
    await injectCommandError(page, 'clone_repository', 'Repository not found');

    // Fill the URL
    const urlInput = page.getByRole('textbox', { name: /url/i });
    await urlInput.fill('https://github.com/nonexistent/repo.git');

    // Fill the destination path (required for Clone button to be enabled)
    const pathInput = page.getByRole('textbox', { name: /clone to/i });
    await pathInput.fill('/tmp/clone-dest');

    // Click Clone
    const dialogCloneButton = page.locator('lv-clone-dialog').getByRole('button', { name: 'Clone', exact: true });
    await dialogCloneButton.click();

    // Error inline message should appear in the clone dialog
    const errorMessage = page.locator('lv-clone-dialog .error-message');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
    await expect(errorMessage).toContainText(/error|fail|not found/i);
  });
});

test.describe('Toolbar Close Repository Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('closing repository tab should remove it from the toolbar', async ({ page }) => {
    const repoTab = page.locator('lv-toolbar .tab', { hasText: 'test-repo' });
    await expect(repoTab).toBeVisible();

    // Click the close icon on the tab (the .tab-close span inside the tab)
    const closeIcon = repoTab.locator('.tab-close');
    await closeIcon.click();

    // The tab should be removed
    await expect(repoTab).not.toBeVisible();
  });

  test('closing last tab should show welcome screen', async ({ page }) => {
    const repoTab = page.locator('lv-toolbar .tab', { hasText: 'test-repo' });
    await expect(repoTab).toBeVisible();

    // Click the close icon (the .tab-close span inside the tab)
    const closeIcon = repoTab.locator('.tab-close');
    await closeIcon.click();

    // Welcome screen should appear
    const welcomeScreen = page.locator('lv-welcome');
    await expect(welcomeScreen).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Toolbar Init Dialog - Full Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('init dialog should close on Escape', async ({ page }) => {
    const initButton = page.locator('button[title="Init Repository"]');
    await initButton.click();

    const initDialog = page.getByRole('dialog', { name: /init/i });
    await expect(initDialog).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');
    await expect(initDialog).not.toBeVisible();
  });
});

test.describe('Toolbar Error Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should show error toast when fetch fails and re-enable button', async ({ page }) => {
    // Inject error for the fetch command
    await injectCommandError(page, 'fetch', 'Network error: could not resolve host');

    const fetchButton = toolbarButton(page, /Fetch/i);
    await fetchButton.click();

    // Error toast should appear with informative message
    const toast = page.locator('.toast').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/error|network|resolve/i);

    // Fetch button should be re-enabled for retry
    await expect(fetchButton).toBeEnabled();
  });

  test('should show error toast when push fails and re-enable button', async ({ page }) => {
    // Inject error for the push command
    await injectCommandError(page, 'push', 'Push rejected: non-fast-forward update');

    const pushButton = toolbarButton(page, /Push/i);
    await pushButton.click();

    // Error toast should appear with informative message. A non-fast-forward
    // rejection is routed through the suggestion service, which replaces the
    // raw message with the recovery action — that, not the server's wording,
    // is what the user needs here.
    const toast = page.locator('.toast').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toHaveClass(/error/);
    await expect(toast).toContainText(/pull before pushing/i);
    await expect(toast.getByRole('button', { name: 'Pull Now' })).toBeVisible();

    // Push button should be re-enabled for retry
    await expect(pushButton).toBeEnabled();
  });
});

test.describe('Toolbar - Extended Tests', () => {
  test('error toast appears with correct message content after fetch failure', async ({ page }) => {
    await setupOpenRepository(page);

    // Inject a specific error for the fetch command
    await injectCommandError(page, 'fetch', 'Network error: could not resolve host');

    // Click the Fetch button
    const fetchButton = toolbarButton(page, /Fetch/i);
    await fetchButton.click();

    // Error toast should appear within a reasonable time and contain the error message
    const toast = page.locator('.toast, .error-message, .notification').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/error|network|resolve/i);
  });

  test('toolbar shows new repository name after successful clone', async ({ page }) => {
    await setupOpenRepository(page);

    // Mock clone_repository to succeed and return a Repository object
    // (clone_repository returns a Repository, not a path string)
    const clonedRepo = {
      path: '/tmp/new-cloned-repo',
      name: 'new-cloned-repo',
      isValid: true,
      isBare: false,
      headRef: 'main',
      state: 'clean',
    };
    await startCommandCaptureWithMocks(page, {
      clone_repository: clonedRepo,
      open_repository: clonedRepo,
      get_repository_info: clonedRepo,
    });

    // Open clone dialog
    const cloneButton = page.locator('button[title="Clone Repository"]');
    await cloneButton.click();

    const cloneDialog = page.getByRole('dialog', { name: /clone/i });
    await expect(cloneDialog).toBeVisible({ timeout: 3000 });

    // Fill the URL
    const urlInput = page.getByRole('textbox', { name: /url/i });
    await urlInput.fill('https://github.com/test/new-cloned-repo.git');

    // Fill the destination path (required for Clone button to be enabled)
    const pathInput = page.getByRole('textbox', { name: /clone to/i });
    await pathInput.fill('/tmp');

    // Click Clone button
    const dialogCloneButton = page.locator('lv-clone-dialog').getByRole('button', { name: 'Clone', exact: true });
    await dialogCloneButton.click();

    // Wait for the clone command to be invoked
    await waitForCommand(page, 'clone_repository');

    // Verify clone_repository was called
    const cloneCommands = await findCommand(page, 'clone_repository');
    expect(cloneCommands.length).toBeGreaterThan(0);

    // After a successful clone, the toolbar tab should eventually show the new repo name
    // The app opens the repository after cloning, so look for the new tab
    const newRepoTab = page.locator('lv-toolbar .tab', { hasText: 'new-cloned-repo' });
    await expect(newRepoTab).toBeVisible({ timeout: 5000 });
  });

  test('toolbar shows new repository name after successful init', async ({ page }) => {
    await setupOpenRepository(page);

    // Mock init_repository to succeed and return a new repository
    await injectCommandMock(page, {
      init_repository: {
        path: '/tmp/new-init-repo',
        name: 'new-init-repo',
        isValid: true,
        isBare: false,
        headRef: null,
        state: 'clean',
      },
      open_repository: {
        path: '/tmp/new-init-repo',
        name: 'new-init-repo',
        isValid: true,
        isBare: false,
        headRef: null,
        state: 'clean',
      },
      get_repository_info: {
        path: '/tmp/new-init-repo',
        name: 'new-init-repo',
        isValid: true,
        isBare: false,
        headRef: null,
        state: 'clean',
      },
      'plugin:dialog|open': '/tmp/new-init-repo',
    });

    // Open init dialog
    const initButton = page.locator('button[title="Init Repository"]');
    await initButton.click();

    const initDialog = page.getByRole('dialog', { name: /init/i });
    await expect(initDialog).toBeVisible({ timeout: 3000 });

    // Fill the path input (required for Initialize button to be enabled)
    const pathInput = page.getByRole('textbox', { name: /repository location/i });
    await pathInput.fill('/tmp/new-init-repo');

    // Click Initialize button
    const initializeButton = page.getByRole('button', { name: /initialize/i });
    await expect(initializeButton).toBeEnabled();
    await initializeButton.click();

    // After successful init, the toolbar should show the new repo name
    const newRepoTab = page.locator('lv-toolbar .tab', { hasText: 'new-init-repo' });
    await expect(newRepoTab).toBeVisible({ timeout: 5000 });
  });
});


// ============================================================================
// Toolbar remote operations (Fetch / Pull / Push)
//
// The three most frequent remote operations used to have no toolbar presence
// at all: their only mouse route was the context dashboard, which collapses
// and remembers that it is collapsed — so a user who collapsed it had no way
// to push without the keyboard or the command palette.
// ============================================================================

test.describe('Toolbar Remote Operations', () => {
  test('shows Fetch, Pull and Push in the toolbar', async ({ page }) => {
    await setupOpenRepository(page);

    for (const name of [/Fetch/i, /Pull/i, /Push/i]) {
      await expect(toolbarButton(page, name)).toBeVisible();
    }
  });

  test('shows the behind count on Pull and the ahead count on Push', async ({ page }) => {
    await setupOpenRepository(page, withAheadBehind(2, 5));

    const pull = toolbarButton(page, /Pull/i);
    const push = toolbarButton(page, /Push/i);
    await expect(pull.locator('.remote-count')).toHaveText('5');
    await expect(push.locator('.remote-count')).toHaveText('2');
    await expect(pull).toHaveAttribute('title', /5 incoming commits/);
    await expect(push).toHaveAttribute('title', /2 local commits/);
  });

  test('dims Pull and Push, without disabling them, when there is nothing to do', async ({ page }) => {
    await setupOpenRepository(page, withAheadBehind(0, 0));

    const pull = toolbarButton(page, /Pull/i);
    const push = toolbarButton(page, /Push/i);
    await expect(pull).toHaveClass(/idle/);
    await expect(push).toHaveClass(/idle/);
    await expect(pull).toBeEnabled();
    await expect(push).toBeEnabled();
    await expect(pull.locator('.remote-count')).toHaveCount(0);
    await expect(push.locator('.remote-count')).toHaveCount(0);
  });

  test('disables all three when the repository has no remote', async ({ page }) => {
    await setupOpenRepository(page, { remotes: [] });

    for (const name of [/Fetch/i, /Pull/i, /Push/i]) {
      const btn = toolbarButton(page, name);
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveAttribute('title', /no remote configured/);
    }
  });

  test('disables all three on the welcome screen, explaining why', async ({ page }) => {
    // No repository opened at all — mocks only.
    await setupTauriMocks(page);
    await page.goto('/');

    for (const name of [/Fetch/i, /Pull/i, /Push/i]) {
      const btn = toolbarButton(page, name);
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveAttribute('title', /open a repository first/);
    }
  });

  test('clicking Fetch runs a fetch and refreshes the counts', async ({ page }) => {
    await setupOpenRepository(page, withAheadBehind(0, 3));
    await expect(toolbarButton(page, /Pull/i).locator('.remote-count')).toHaveText('3');

    // After the fetch the branch is up to date, so the refresh that follows
    // must clear the toolbar's badge.
    await startCommandCaptureWithMocks(page, {
      fetch: null,
      get_branches: [
        {
          name: 'main',
          shorthand: 'main',
          isHead: true,
          isRemote: false,
          upstream: 'origin/main',
          targetOid: 'abc123def456',
          aheadBehind: { ahead: 0, behind: 0 },
          isStale: false,
        },
      ],
    });

    await toolbarButton(page, /Fetch/i).click();
    await waitForCommand(page, 'fetch');

    expect(findCommand(page, 'fetch')).toBeTruthy();
    await expect(toolbarButton(page, /Pull/i).locator('.remote-count')).toHaveCount(0);
    await expect(toolbarButton(page, /Pull/i)).toHaveClass(/idle/);
  });

  test('clicking Pull runs a pull', async ({ page }) => {
    await setupOpenRepository(page, withAheadBehind(0, 2));
    await startCommandCapture(page);

    await toolbarButton(page, /Pull/i).click();
    await waitForCommand(page, 'pull');
  });

  test('clicking Push runs a push', async ({ page }) => {
    await setupOpenRepository(page, withAheadBehind(2, 0));
    await startCommandCapture(page);

    await toolbarButton(page, /Push/i).click();
    await waitForCommand(page, 'push');
  });

  test('a failed toolbar fetch is reported and the button comes back', async ({ page }) => {
    await setupOpenRepository(page);
    await injectCommandError(page, 'fetch', 'Network error: could not resolve host');

    const fetchButton = toolbarButton(page, /Fetch/i);
    await fetchButton.click();

    const toast = page.locator('.toast').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/error|network|resolve/i);
    await expect(fetchButton).toBeEnabled();
  });
});
