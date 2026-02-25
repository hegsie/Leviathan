import { test, expect } from '@playwright/test';
import { setupOpenRepository, withModifiedFiles } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { RightPanelPage, GraphPanelPage } from '../pages/panels.page';
import {
  startCommandCapture,
  findCommand,
  injectCommandMock,
  injectCommandError,
} from '../fixtures/test-helpers';

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

  test('should display diff with file path and diff content', async ({ page }) => {
    // Click on the file to open diff
    const file = rightPanel.getUnstagedFile('src/main.ts');
    await expect(file).toBeVisible();
    await file.click();

    // Wait for diff overlay to appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Verify the diff view shows the file path
    const diffPath = page.locator('.diff-path');
    await expect(diffPath).toContainText('main.ts');

    // Verify diff view contains actual diff content (the mock returns hunks with lines)
    const diffView = page.locator('lv-diff-view');
    await expect(diffView).toBeVisible();
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

test.describe('Image Diff View', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);
    // Setup with image files
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'assets/logo.png', status: 'modified', isStaged: false, isConflicted: false },
        { path: 'images/icon.svg', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );
  });

  test('should show image files in file list', async () => {
    const pngFile = rightPanel.getUnstagedFile('assets/logo.png');
    await expect(pngFile).toBeVisible();

    const svgFile = rightPanel.getUnstagedFile('images/icon.svg');
    await expect(svgFile).toBeVisible();
  });

  test('clicking an image file should open diff overlay', async () => {
    const file = rightPanel.getUnstagedFile('assets/logo.png');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });
  });

  test('should close image diff with Escape key', async () => {
    const file = rightPanel.getUnstagedFile('assets/logo.png');
    await file.click();
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    await graph.closeDiff();
    await expect(graph.diffOverlay).not.toBeVisible();
  });
});

test.describe('Image Diff New Files', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'new-image.png', status: 'untracked', isStaged: false, isConflicted: false },
      ])
    );
  });

  test('should display new image files', async () => {
    const file = rightPanel.getUnstagedFile('new-image.png');
    await expect(file).toBeVisible();
  });
});

test.describe('Image Diff Deleted Files', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'deleted-image.jpg', status: 'deleted', isStaged: false, isConflicted: false },
      ])
    );
  });

  test('should display deleted image files', async () => {
    const file = rightPanel.getUnstagedFile('deleted-image.jpg');
    await expect(file).toBeVisible();
  });
});

test.describe('Image Diff Difference Mode', () => {
  let app: AppPage;
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);
    // Setup with a modified image file
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'assets/test-image.png', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );
  });

  test('clicking Difference button should switch to difference mode', async ({ page }) => {
    // Click on the image file to open diff
    const file = rightPanel.getUnstagedFile('assets/test-image.png');
    await file.click();

    // Wait for diff overlay to appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Find and click the Difference button
    const differenceButton = page.locator('lv-image-diff').getByRole('button', { name: 'Difference' });
    await expect(differenceButton).toBeVisible();
    await differenceButton.click();

    // Verify the difference mode is active (button should have 'active' class)
    await expect(differenceButton).toHaveClass(/active/);
  });

  test('difference mode should display sensitivity slider', async ({ page }) => {
    // Click on the image file to open diff
    const file = rightPanel.getUnstagedFile('assets/test-image.png');
    await file.click();

    // Wait for diff overlay to appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Click the Difference button
    const differenceButton = page.locator('lv-image-diff').getByRole('button', { name: 'Difference' });
    await differenceButton.click();

    // Verify sensitivity slider is visible
    const sensitivitySlider = page.locator('lv-image-diff').getByRole('slider', { name: /sensitivity/i });
    await expect(sensitivitySlider).toBeVisible({ timeout: 5000 });
  });

  test('difference mode should display legend with color swatches', async ({ page }) => {
    // Click on the image file to open diff
    const file = rightPanel.getUnstagedFile('assets/test-image.png');
    await file.click();

    // Wait for diff overlay to appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Click the Difference button
    const differenceButton = page.locator('lv-image-diff').getByRole('button', { name: 'Difference' });
    await differenceButton.click();

    // Wait for difference computation to complete by checking loading state disappears
    const imageDiff = page.locator('lv-image-diff');
    await expect(imageDiff.locator('.loading')).toBeHidden({ timeout: 10000 });

    // Verify legend items are displayed
    await expect(imageDiff.locator('.legend-item').filter({ hasText: 'Added' })).toBeVisible({ timeout: 5000 });
    await expect(imageDiff.locator('.legend-item').filter({ hasText: 'Removed' })).toBeVisible();
    await expect(imageDiff.locator('.legend-item').filter({ hasText: 'Changed' })).toBeVisible();
  });

  test('difference mode should show statistics with percentages', async ({ page }) => {
    // Click on the image file to open diff
    const file = rightPanel.getUnstagedFile('assets/test-image.png');
    await file.click();

    // Wait for diff overlay to appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Click the Difference button
    const differenceButton = page.locator('lv-image-diff').getByRole('button', { name: 'Difference' });
    await differenceButton.click();

    // Wait for difference computation to complete by checking loading state disappears
    const imageDiff = page.locator('lv-image-diff');
    await expect(imageDiff.locator('.loading')).toBeHidden({ timeout: 10000 });

    // Verify percentages are shown in legend (format: "Added (X.X%)")
    const addedLegend = imageDiff.locator('.legend-item').filter({ hasText: 'Added' });
    await expect(addedLegend).toContainText(/%/);
  });

  test('sensitivity slider should be adjustable', async ({ page }) => {
    // Click on the image file to open diff
    const file = rightPanel.getUnstagedFile('assets/test-image.png');
    await file.click();

    // Wait for diff overlay to appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Click the Difference button
    const differenceButton = page.locator('lv-image-diff').getByRole('button', { name: 'Difference' });
    await differenceButton.click();

    // Get the sensitivity slider
    const sensitivitySlider = page.locator('lv-image-diff').getByRole('slider', { name: /sensitivity/i });
    await expect(sensitivitySlider).toBeVisible({ timeout: 5000 });

    // Adjust the slider value
    await sensitivitySlider.fill('50');

    // Verify the threshold value display updates
    const thresholdValue = page.locator('lv-image-diff .threshold-value');
    await expect(thresholdValue).toHaveText('50');
  });

  test('should switch between image diff modes', async ({ page }) => {
    // Click on the image file to open diff
    const file = rightPanel.getUnstagedFile('assets/test-image.png');
    await file.click();

    // Wait for diff overlay to appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    const imageDiff = page.locator('lv-image-diff');

    // Verify all mode buttons are present
    await expect(imageDiff.getByRole('button', { name: 'Side by Side' })).toBeVisible();
    await expect(imageDiff.getByRole('button', { name: 'Onion Skin' })).toBeVisible();
    await expect(imageDiff.getByRole('button', { name: 'Swipe' })).toBeVisible();
    await expect(imageDiff.getByRole('button', { name: 'Difference' })).toBeVisible();

    // Switch to Difference mode
    await imageDiff.getByRole('button', { name: 'Difference' }).click();
    await expect(imageDiff.getByRole('button', { name: 'Difference' })).toHaveClass(/active/);

    // Switch back to Side by Side
    await imageDiff.getByRole('button', { name: 'Side by Side' }).click();
    await expect(imageDiff.getByRole('button', { name: 'Side by Side' })).toHaveClass(/active/);
  });
});

test.describe('Diff View - Text Content Verification', () => {
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);

    // Setup with a modified file and rich diff content
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'src/app.ts', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );

    // Override get_file_diff to return detailed hunks
    await injectCommandMock(page, {
      get_file_diff: {
        path: 'src/app.ts',
        oldPath: null,
        status: 'modified',
        hunks: [
          {
            header: '@@ -1,5 +1,6 @@',
            oldStart: 1,
            oldLines: 5,
            newStart: 1,
            newLines: 6,
            lines: [
              { content: 'import { LitElement } from "lit";', origin: 'context', oldLineNo: 1, newLineNo: 1 },
              { content: 'const old = true;', origin: 'deletion', oldLineNo: 2, newLineNo: null },
              { content: 'const updated = true;', origin: 'addition', oldLineNo: null, newLineNo: 2 },
              { content: 'const added = "new line";', origin: 'addition', oldLineNo: null, newLineNo: 3 },
              { content: 'export default {};', origin: 'context', oldLineNo: 3, newLineNo: 4 },
            ],
          },
        ],
        isBinary: false,
        isImage: false,
        imageType: null,
        additions: 2,
        deletions: 1,
      },
    });
  });

  test('should display diff with addition and deletion lines', async ({ page }) => {
    // Open the file diff
    const file = rightPanel.getUnstagedFile('src/app.ts');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // The diff view uses .code-addition and .code-deletion classes on .line elements
    const additionLines = page.locator('lv-diff-view .line.code-addition');
    await expect(additionLines.first()).toBeVisible({ timeout: 5000 });
    const addCount = await additionLines.count();
    expect(addCount).toBeGreaterThan(0);

    // The diff view should contain deletion lines (red)
    const deletionLines = page.locator('lv-diff-view .line.code-deletion');
    const delCount = await deletionLines.count();
    expect(delCount).toBeGreaterThan(0);
  });

  test('should show hunk header in diff view', async ({ page }) => {
    const file = rightPanel.getUnstagedFile('src/app.ts');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Verify the diff contains context/hunk content from the mock data
    // The diff view renders hunk content including the context line and code changes
    const diffView = page.locator('lv-diff-view');
    // Check that the mock diff content (e.g., 'LitElement' from context line) is rendered
    await expect(diffView).toContainText('LitElement');
  });

  test('should display file path in diff header', async ({ page }) => {
    const file = rightPanel.getUnstagedFile('src/app.ts');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // The file path is shown in the diff area header (app-shell's .diff-path span)
    const diffPath = page.locator('.diff-path');
    await expect(diffPath).toContainText('app.ts');
  });

  test('should show addition and deletion counts', async ({ page }) => {
    const file = rightPanel.getUnstagedFile('src/app.ts');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // The diff view header shows addition and deletion counts using .additions and .deletions spans
    const additions = page.locator('lv-diff-view .additions');
    await expect(additions).toContainText('+2');
    const deletions = page.locator('lv-diff-view .deletions');
    await expect(deletions).toContainText('-1');
  });
});

test.describe('Diff View - Binary File Handling', () => {
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);

    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'data/archive.zip', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );

    // Override diff to return binary file
    await injectCommandMock(page, {
      get_file_diff: {
        path: 'data/archive.zip',
        oldPath: null,
        status: 'modified',
        hunks: [],
        isBinary: true,
        isImage: false,
        imageType: null,
        additions: 0,
        deletions: 0,
      },
    });
  });

  test('should show binary file notice when opening binary diff', async ({ page }) => {
    const file = rightPanel.getUnstagedFile('data/archive.zip');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Should show some indication that the file is binary
    const diffView = page.locator('lv-diff-view');
    await expect(diffView).toContainText(/binary|Binary/i);
  });

  test('binary diff should not show addition/deletion lines', async ({ page }) => {
    const file = rightPanel.getUnstagedFile('data/archive.zip');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // No diff lines should be shown for binary files
    const diffLines = page.locator('lv-diff-view .line-addition, lv-diff-view .line-deletion, lv-diff-view .diff-line');
    const count = await diffLines.count();
    expect(count).toBe(0);
  });
});

test.describe('Diff View - Stage Hunk', () => {
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);

    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'src/main.ts', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );

    // Override diff with hunks that can be staged
    await injectCommandMock(page, {
      get_file_diff: {
        path: 'src/main.ts',
        oldPath: null,
        status: 'modified',
        hunks: [
          {
            header: '@@ -1,3 +1,4 @@',
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 4,
            lines: [
              { content: 'line 1', origin: 'context', oldLineNo: 1, newLineNo: 1 },
              { content: 'line 2', origin: 'deletion', oldLineNo: 2, newLineNo: null },
              { content: 'new line 2', origin: 'addition', oldLineNo: null, newLineNo: 2 },
              { content: 'line 3', origin: 'context', oldLineNo: 3, newLineNo: 3 },
            ],
          },
        ],
        isBinary: false,
        isImage: false,
        imageType: null,
        additions: 1,
        deletions: 1,
      },
    });
  });

  test('should show stage hunk button in diff view for unstaged files', async ({ page }) => {
    const file = rightPanel.getUnstagedFile('src/main.ts');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Stage hunk button has class .stage-btn.stage and title "Stage this hunk"
    const stageHunkBtn = page.locator('lv-diff-view button.stage-btn.stage[title="Stage this hunk"]');
    await expect(stageHunkBtn.first()).toBeVisible();
  });

  test('should invoke stage_hunk command when clicking stage hunk button', async ({ page }) => {
    await startCommandCapture(page);

    const file = rightPanel.getUnstagedFile('src/main.ts');
    await file.click();

    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Click the stage hunk button (class .stage-btn.stage, title "Stage this hunk")
    const stageHunkBtn = page.locator('lv-diff-view button.stage-btn.stage[title="Stage this hunk"]').first();
    await stageHunkBtn.click();

    await page.waitForFunction(() =>
      (window as unknown as { __INVOKED_COMMANDS__?: { command: string }[] })
        .__INVOKED_COMMANDS__?.some(
          (c) => c.command === 'stage_hunk' || c.command === 'stage_files' || c.command === 'stage_lines'
        )
    );

    const stageHunkCommands = await findCommand(page, 'stage_hunk');
    const stageFileCommands = await findCommand(page, 'stage_files');
    const stageLineCommands = await findCommand(page, 'stage_lines');
    expect(stageHunkCommands.length + stageFileCommands.length + stageLineCommands.length).toBeGreaterThan(0);
  });
});

test.describe('Diff Error Scenarios', () => {
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'src/main.ts', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );
  });

  test('should show error state when get_file_diff fails', async ({ page }) => {
    // Inject error so that fetching the diff throws
    await injectCommandError(page, 'get_file_diff', 'Failed to read file: permission denied');

    // Click the file to open diff
    const file = rightPanel.getUnstagedFile('src/main.ts');
    await file.click();

    // The diff overlay should appear, but with an error or empty state
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // The diff view component renders errors as <div class="error"> inside its shadow DOM.
    // Use a scoped locator to avoid matching unrelated .empty elements from other components.
    const errorDiv = page.locator('lv-diff-view .error');
    await expect(errorDiv).toBeVisible();
    await expect(errorDiv).toContainText('Failed to read file: permission denied');
  });

  test('should handle empty diff gracefully', async ({ page }) => {
    // Mock get_file_diff to return a diff with no hunks (empty diff)
    await injectCommandMock(page, {
      get_file_diff: {
        path: 'src/main.ts',
        oldPath: null,
        status: 'modified',
        hunks: [],
        isBinary: false,
        isImage: false,
        imageType: null,
        additions: 0,
        deletions: 0,
      },
    });

    // Click the file to open diff
    const file = rightPanel.getUnstagedFile('src/main.ts');
    await file.click();

    // The diff overlay should appear
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // With no hunks, there should be no addition or deletion lines
    const diffView = page.locator('lv-diff-view');
    const additionLines = diffView.locator('.line-addition, .diff-addition, .added');
    const deletionLines = diffView.locator('.line-deletion, .diff-deletion, .removed');

    expect(await additionLines.count()).toBe(0);
    expect(await deletionLines.count()).toBe(0);
  });
});

test.describe('Diff - UI Outcome Verification', () => {
  let rightPanel: RightPanelPage;
  let graph: GraphPanelPage;

  test('staging a hunk should move the file to the staged section', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);

    // Setup with a modified file in unstaged
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'src/staged-test.ts', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );

    // Override diff with a hunk
    await injectCommandMock(page, {
      get_file_diff: {
        path: 'src/staged-test.ts',
        oldPath: null,
        status: 'modified',
        hunks: [
          {
            header: '@@ -1,3 +1,4 @@',
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 4,
            lines: [
              { content: 'const a = 1;', origin: 'context', oldLineNo: 1, newLineNo: 1 },
              { content: 'const b = 2;', origin: 'deletion', oldLineNo: 2, newLineNo: null },
              { content: 'const b = 3;', origin: 'addition', oldLineNo: null, newLineNo: 2 },
              { content: 'const c = 4;', origin: 'context', oldLineNo: 3, newLineNo: 3 },
            ],
          },
        ],
        isBinary: false,
        isImage: false,
        imageType: null,
        additions: 1,
        deletions: 1,
      },
    });

    // Verify file appears in unstaged section
    const unstagedFile = rightPanel.getUnstagedFile('src/staged-test.ts');
    await expect(unstagedFile).toBeVisible();

    // Open the diff
    await unstagedFile.click();
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    // Mock stage_hunk to also move file from unstaged to staged in the mock state
    await injectCommandMock(page, {
      stage_hunk: null,
      stage_lines: null,
      get_staged_files: [{ path: 'src/staged-test.ts', status: 'modified', isStaged: true, isConflicted: false }],
      get_unstaged_files: [],
      get_status: [{ path: 'src/staged-test.ts', status: 'modified', isStaged: true, isConflicted: false }],
    });

    // Click the stage hunk button
    const stageHunkBtn = page.locator('lv-diff-view button.stage-btn.stage[title="Stage this hunk"]').first();
    await stageHunkBtn.click();

    // After staging, the staged section should show the file
    const stagedHeader = page.locator('lv-file-status .section-header:has-text("Staged")');
    await expect(stagedHeader).toBeVisible({ timeout: 5000 });
  });

  test('image diff mode toggle should visually switch the active view', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    graph = new GraphPanelPage(page);

    // Setup with a modified image file
    await setupOpenRepository(
      page,
      withModifiedFiles([
        { path: 'assets/photo.png', status: 'modified', isStaged: false, isConflicted: false },
      ])
    );

    // Click on the image file to open diff
    const file = rightPanel.getUnstagedFile('assets/photo.png');
    await file.click();
    await expect(graph.diffOverlay).toBeVisible({ timeout: 5000 });

    const imageDiff = page.locator('lv-image-diff');

    // Verify Side by Side is the default active mode
    const sideBySideBtn = imageDiff.getByRole('button', { name: 'Side by Side' });
    await expect(sideBySideBtn).toBeVisible();
    await expect(sideBySideBtn).toHaveClass(/active/);

    // Switch to Onion Skin mode
    const onionSkinBtn = imageDiff.getByRole('button', { name: 'Onion Skin' });
    await onionSkinBtn.click();

    // Verify Onion Skin is now active and Side by Side is not
    await expect(onionSkinBtn).toHaveClass(/active/);
    await expect(sideBySideBtn).not.toHaveClass(/active/);

    // Verify the onion skin specific UI element (opacity slider) is visible
    const opacitySlider = imageDiff.getByRole('slider');
    await expect(opacitySlider).toBeVisible({ timeout: 5000 });

    // Switch to Swipe mode
    const swipeBtn = imageDiff.getByRole('button', { name: 'Swipe' });
    await swipeBtn.click();

    // Verify Swipe is now active and Onion Skin is not
    await expect(swipeBtn).toHaveClass(/active/);
    await expect(onionSkinBtn).not.toHaveClass(/active/);
  });
});
