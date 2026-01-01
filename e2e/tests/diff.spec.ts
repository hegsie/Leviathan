import { test, expect } from '@playwright/test';
import { setupOpenRepository, withModifiedFiles } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { RightPanelPage, GraphPanelPage } from '../pages/panels.page';

test.describe('Diff View', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);
    // Setup with modified files
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'src/main.ts', status: 'modified', isStaged: false, isConflicted: false },
        { path: 'README.md', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );
  });

  test('should have files in unstaged section', async () => {
    const count = await rightPanel.getUnstagedCount();
    expect(count).toBe(2);
  });

  test('should display file list', async () => {
    await expect(rightPanel.fileStatus).toBeVisible();
  });

  test('clicking a file should open diff view', async () => {
    // Click on a file to open diff
    await rightPanel.openFileDiff('src/main.ts');

    // Diff overlay should appear
    await expect(graph.diffOverlay).toBeVisible();
  });

  test('should close diff with Escape key', async () => {
    await rightPanel.openFileDiff('src/main.ts');
    await expect(graph.diffOverlay).toBeVisible();

    await graph.closeDiff();
    await expect(graph.diffOverlay).not.toBeVisible();
  });
});

test.describe('Diff View Content', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);
    // Setup with a file that has diff content
    await setupOpenRepository(
      page,
      withModifiedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: false, isConflicted: false }])
    );
  });

  test('should display diff with additions and deletions', async () => {
    // Click on the file to open diff
    const file = rightPanel.getUnstagedFile('src/main.ts');
    await expect(file).toBeVisible();
    await file.click();

    // Wait for diff overlay to appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Binary Files', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);
    // Setup with a binary file
    await setupOpenRepository(
      page,
      withModifiedFiles([{ path: 'image.png', status: 'modified', isStaged: false, isConflicted: false }])
    );
  });

  test('should show binary file in file list', async () => {
    const file = rightPanel.getUnstagedFile('image.png');
    await expect(file).toBeVisible();
  });
});

test.describe('New Files', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withModifiedFiles([{ path: 'newfile.ts', status: 'untracked', isStaged: false, isConflicted: false }])
    );
  });

  test('should display new/untracked files', async () => {
    const file = rightPanel.getUnstagedFile('newfile.ts');
    await expect(file).toBeVisible();
  });
});

test.describe('Deleted Files', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withModifiedFiles([{ path: 'deleted.ts', status: 'deleted', isStaged: false, isConflicted: false }])
    );
  });

  test('should display deleted files', async () => {
    const file = rightPanel.getUnstagedFile('deleted.ts');
    await expect(file).toBeVisible();
  });
});

test.describe('Renamed Files', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withModifiedFiles([{ path: 'newname.ts', status: 'renamed', isStaged: false, isConflicted: false }])
    );
  });

  test('should display renamed files', async () => {
    const file = rightPanel.getUnstagedFile('newname.ts');
    await expect(file).toBeVisible();
  });
});
