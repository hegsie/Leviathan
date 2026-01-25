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
