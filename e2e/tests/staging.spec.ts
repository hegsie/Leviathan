import { test, expect } from '@playwright/test';
import { setupOpenRepository, defaultMockData, withModifiedFiles, withStagedFiles } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { RightPanelPage } from '../pages/panels.page';

test.describe('File Staging', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    // Setup with a repository that has modified files
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'src/main.ts', status: 'modified', isStaged: false, isConflicted: false },
        { path: 'README.md', status: 'modified', isStaged: false, isConflicted: false },
        { path: 'newfile.ts', status: 'untracked', isStaged: false, isConflicted: false },
      ])
    );
  });

  test('should display right panel with changes tab', async () => {
    await expect(rightPanel.panel).toBeVisible();
  });

  test('should show unstaged files', async () => {
    await expect(rightPanel.fileStatus).toBeVisible();
    await expect(rightPanel.unstagedSection).toBeVisible();
  });

  test('should display file names in unstaged section', async () => {
    const files = rightPanel.unstagedFiles;
    await expect(files).toHaveCount(3);
  });

  test('should have stage all button', async () => {
    await expect(rightPanel.stageAllButton).toBeVisible();
  });
});

test.describe('Staged Files', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    // Setup with staged files
    await setupOpenRepository(
      page,
      withStagedFiles([
        { path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false },
        { path: 'README.md', status: 'modified', isStaged: true, isConflicted: false },
      ])
    );
  });

  test('should show staged files section', async () => {
    await expect(rightPanel.stagedSection).toBeVisible();
  });

  test('should display staged file count', async () => {
    const count = await rightPanel.getStagedCount();
    expect(count).toBe(2);
  });

  test('should have unstage all button when files are staged', async () => {
    await expect(rightPanel.unstageAllButton).toBeVisible();
  });
});

test.describe('Commit Panel', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    // Setup with staged files ready to commit
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );
  });

  test('should display commit panel', async () => {
    await expect(rightPanel.commitPanel).toBeVisible();
  });

  test('should have commit message textarea', async () => {
    await expect(rightPanel.commitMessage).toBeVisible();
  });

  test('should have commit button', async () => {
    await expect(rightPanel.commitButton).toBeVisible();
  });

  test('should allow entering commit message', async () => {
    await rightPanel.commitMessage.fill('feat: add new feature');
    await expect(rightPanel.commitMessage).toHaveValue('feat: add new feature');
  });

  test('should have AI generate button', async () => {
    await expect(rightPanel.aiGenerateButton).toBeVisible();
  });
});

test.describe('Mixed Staged and Unstaged', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    // Setup with mix of staged and unstaged files
    await setupOpenRepository(page, {
      status: {
        staged: [{ path: 'staged.ts', status: 'modified', isStaged: true, isConflicted: false }],
        unstaged: [{ path: 'unstaged.ts', status: 'modified', isStaged: false, isConflicted: false }],
      },
    });
  });

  test('should show both staged and unstaged sections', async () => {
    await expect(rightPanel.stagedSection).toBeVisible();
    await expect(rightPanel.unstagedSection).toBeVisible();
  });
});

test.describe('Empty Working Directory', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    // Setup with no changes
    await setupOpenRepository(page, {
      status: { staged: [], unstaged: [] },
    });
  });

  test('should show right panel even with no changes', async () => {
    await expect(rightPanel.panel).toBeVisible();
  });

  test('should have empty staged count', async () => {
    const count = await rightPanel.getStagedCount();
    expect(count).toBe(0);
  });

  test('should have empty unstaged count', async () => {
    const count = await rightPanel.getUnstagedCount();
    expect(count).toBe(0);
  });
});
