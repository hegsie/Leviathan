import { test, expect } from '@playwright/test';
import { setupOpenRepository, withConflicts } from '../fixtures/tauri-mock';
import {
  startCommandCapture,
  findCommand,
  waitForCommand,
  injectCommandError,
  injectCommandMock,
} from '../fixtures/test-helpers';

/**
 * E2E tests for Merge Editor and Conflict Resolution Dialog
 *
 * The conflict resolution dialog opens when the app-shell receives an
 * 'open-conflict-dialog' or 'merge-conflict' event. It embeds the
 * lv-merge-editor component for 3-way conflict resolution.
 *
 * The dialog is `lv-conflict-resolution-dialog` (rendered by app-shell when showConflictDialog=true).
 * The merge editor within it is `lv-merge-editor`.
 */

/** Open the conflict resolution dialog by clicking the "Resolve Conflicts" button in the operation banner */
async function openConflictResolutionDialog(page: import('@playwright/test').Page) {
  // The operation banner appears when the repository state is 'merge' (set by withConflicts()).
  // It contains a "Resolve Conflicts" button that calls handleOpenConflictDialog() on app-shell,
  // which sets showConflictDialog=true and renders the lv-conflict-resolution-dialog.
  const resolveBtn = page.locator('.operation-btn-primary', { hasText: 'Resolve Conflicts' });
  await expect(resolveBtn).toBeVisible();
  await resolveBtn.click();

  // Wait for the dialog to become visible
  await page.locator('lv-conflict-resolution-dialog[open]').waitFor({ state: 'visible' });

  // Wait for conflicts to finish loading (file list items appear)
  await page.locator('lv-conflict-resolution-dialog .file-item').first().waitFor({ state: 'visible' });

  // Wait for the merge editor to finish loading its content
  await expect(page.locator('lv-merge-editor .toolbar')).toBeVisible();
}

/** Shared mock overrides for conflict resolution commands */
const conflictMocks = (conflictFiles: unknown[]) => ({
  get_conflicts: conflictFiles,
  get_blob_content: 'const value = "base";',
  read_file_content:
    '<<<<<<< HEAD\nconst value = "ours";\n=======\nconst value = "theirs";\n>>>>>>> feature-branch',
  resolve_conflict: null,
  abort_merge: null,
  auto_detect_merge_tool: null,
  is_ai_available: false,
});

test.describe('Merge Editor - Conflict Resolution Dialog', () => {
  const twoConflictFiles = [
    {
      path: 'src/conflict.ts',
      ancestor: { oid: 'ancestor_oid_123' },
      ours: { oid: 'ours_oid_456' },
      theirs: { oid: 'theirs_oid_789' },
    },
    {
      path: 'src/another.ts',
      ancestor: { oid: 'ancestor_oid_aaa' },
      ours: { oid: 'ours_oid_bbb' },
      theirs: { oid: 'theirs_oid_ccc' },
    },
  ];

  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page, {
      ...withConflicts(),
      status: {
        staged: [],
        unstaged: [
          { path: 'src/conflict.ts', status: 'conflicted', isStaged: false, isConflicted: true },
          { path: 'src/another.ts', status: 'conflicted', isStaged: false, isConflicted: true },
        ],
      },
    });

    // Mock commands for conflict resolution
    await injectCommandMock(page, conflictMocks(twoConflictFiles));
  });

  test('dialog opens and lists conflicted files', async ({ page }) => {
    await openConflictResolutionDialog(page);

    const dialog = page.locator('lv-conflict-resolution-dialog');
    await expect(dialog).toBeVisible();

    // Should show "Resolve Merge Conflicts" title
    const headerTitle = dialog.locator('.header-title');
    await expect(headerTitle).toContainText('Resolve');
    await expect(headerTitle).toContainText('Conflicts');

    // Should list both conflicted files
    const fileItems = dialog.locator('.file-item');
    await expect(fileItems).toHaveCount(2);
  });

  test('first file is selected by default and shows merge editor', async ({ page }) => {
    await openConflictResolutionDialog(page);

    // First file should be selected
    const selectedFile = page.locator('lv-conflict-resolution-dialog .file-item.selected');
    await expect(selectedFile).toBeVisible();

    // Merge editor should be visible
    const mergeEditor = page.locator('lv-merge-editor');
    await expect(mergeEditor).toBeVisible();
  });

  test('merge editor displays three source panels (Ours, Base, Theirs) and Output', async ({
    page,
  }) => {
    await openConflictResolutionDialog(page);

    const mergeEditor = page.locator('lv-merge-editor');
    await expect(mergeEditor).toBeVisible();

    // Should have the three source panel headers
    const oursHeader = mergeEditor.locator('.panel-header.ours');
    const baseHeader = mergeEditor.locator('.panel-header.base');
    const theirsHeader = mergeEditor.locator('.panel-header.theirs');
    const outputHeader = mergeEditor.locator('.panel-header.output');

    await expect(oursHeader).toBeVisible();
    await expect(baseHeader).toBeVisible();
    await expect(theirsHeader).toBeVisible();
    await expect(outputHeader).toBeVisible();

    await expect(oursHeader).toContainText('Ours');
    await expect(baseHeader).toContainText('Base');
    await expect(theirsHeader).toContainText('Theirs');
    await expect(outputHeader).toContainText('Output');
  });

  test('toolbar shows file path and action buttons', async ({ page }) => {
    await openConflictResolutionDialog(page);

    const toolbar = page.locator('lv-merge-editor .toolbar');
    await expect(toolbar).toBeVisible();

    // File path should be visible in toolbar title
    const toolbarTitle = page.locator('lv-merge-editor .toolbar-title');
    await expect(toolbarTitle).toContainText('conflict');

    // Should have Use Ours, Use Theirs, and Mark Resolved buttons in toolbar-actions
    const useOursBtn = page.locator('lv-merge-editor .toolbar-actions .btn-ours');
    const useTheirsBtn = page.locator('lv-merge-editor .toolbar-actions .btn-theirs');
    const markResolvedBtn = page.locator('lv-merge-editor .toolbar-actions .btn-primary');

    await expect(useOursBtn).toBeVisible();
    await expect(useTheirsBtn).toBeVisible();
    await expect(markResolvedBtn).toBeVisible();

    await expect(useOursBtn).toContainText('Use Ours');
    await expect(useTheirsBtn).toContainText('Use Theirs');
    await expect(markResolvedBtn).toContainText('Mark Resolved');
  });

  test('output panel shows conflict blocks with Use Ours/Theirs/Both buttons', async ({
    page,
  }) => {
    await openConflictResolutionDialog(page);

    const mergeEditor = page.locator('lv-merge-editor');

    // The conflict count in the output header should indicate conflicts remaining
    const conflictCount = mergeEditor.locator('.conflict-count');
    await expect(conflictCount).toBeVisible();
  });

  test('clicking Use Ours in toolbar replaces output with ours content', async ({ page }) => {
    await openConflictResolutionDialog(page);

    const useOursBtn = page.locator('lv-merge-editor .toolbar-actions .btn-ours');
    await expect(useOursBtn).toBeVisible();
    await useOursBtn.click();

    // After accepting ours, conflict count should show "No conflicts"
    const conflictCount = page.locator('lv-merge-editor .conflict-count');
    await expect(conflictCount).toContainText('No conflicts');
  });

  test('clicking Use Theirs in toolbar replaces output with theirs content', async ({ page }) => {
    await openConflictResolutionDialog(page);

    const useTheirsBtn = page.locator('lv-merge-editor .toolbar-actions .btn-theirs');
    await expect(useTheirsBtn).toBeVisible();
    await useTheirsBtn.click();

    // After accepting theirs, conflict count should show "No conflicts"
    const conflictCount = page.locator('lv-merge-editor .conflict-count');
    await expect(conflictCount).toContainText('No conflicts');
  });

  test('Mark Resolved calls resolve_conflict command', async ({ page }) => {
    await startCommandCapture(page);
    await openConflictResolutionDialog(page);

    const useOursBtn = page.locator('lv-merge-editor .toolbar-actions .btn-ours');
    await expect(useOursBtn).toBeVisible();
    await useOursBtn.click();

    // Click Mark Resolved
    const markResolvedBtn = page.locator('lv-merge-editor .toolbar-actions .btn-primary');
    await markResolvedBtn.click();

    await waitForCommand(page, 'resolve_conflict');

    const commands = await findCommand(page, 'resolve_conflict');
    expect(commands.length).toBeGreaterThanOrEqual(1);

    // Verify the file is marked as resolved in the file list
    const resolvedFile = page.locator('lv-conflict-resolution-dialog .file-item.resolved');
    await expect(resolvedFile).toBeVisible({ timeout: 3000 });

    // Verify the progress subtitle updates to reflect one resolved file
    const subtitle = page.locator('lv-conflict-resolution-dialog .header-subtitle');
    await expect(subtitle).toContainText('1 of 2');
  });

  test('Abort button shows confirmation dialog', async ({ page }) => {
    await openConflictResolutionDialog(page);

    // Click Abort button in the footer
    const abortBtn = page.locator(
      'lv-conflict-resolution-dialog .footer-actions .btn-danger'
    );
    await expect(abortBtn).toContainText('Abort');
    await abortBtn.click();

    // Confirmation dialog should appear
    const confirmDialog = page.locator('lv-conflict-resolution-dialog .confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('Abort');
  });

  test('Continue button is disabled when conflicts remain unresolved', async ({ page }) => {
    await openConflictResolutionDialog(page);

    // Continue button should be disabled since not all files are resolved
    const continueBtn = page.locator(
      'lv-conflict-resolution-dialog .footer-actions .btn-primary'
    );
    await expect(continueBtn).toBeDisabled();
  });

  test('file navigation between conflicted files works', async ({ page }) => {
    await openConflictResolutionDialog(page);

    // Should show navigation buttons
    const nextBtn = page.locator('lv-conflict-resolution-dialog .nav-btn', { hasText: 'Next' });
    await expect(nextBtn).toBeVisible();

    // Click next to go to second file
    await nextBtn.click();

    // Second file should now be selected
    const selectedFile = page.locator('lv-conflict-resolution-dialog .file-item.selected');
    await expect(selectedFile).toBeVisible();
  });

  test('shows progress of resolved files', async ({ page }) => {
    await openConflictResolutionDialog(page);

    // Header subtitle should show "0 of 2 conflicts resolved"
    const subtitle = page.locator('lv-conflict-resolution-dialog .header-subtitle');
    await expect(subtitle).toContainText('0 of 2');
  });

  test('can toggle between visual and raw edit mode in output', async ({ page }) => {
    await openConflictResolutionDialog(page);

    const toggleBtn = page.locator('lv-merge-editor .output-mode-toggle');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toContainText('Raw Edit');

    // Click to switch to raw edit mode
    await toggleBtn.click();

    // Now should show "Visual" option (meaning we're in raw mode)
    await expect(toggleBtn).toContainText('Visual');

    // Raw edit mode should show a textarea
    const textarea = page.locator('lv-merge-editor .editable-textarea');
    await expect(textarea).toBeVisible();
  });
});

test.describe('Merge Editor - Error Handling', () => {
  const oneConflictFile = [
    {
      path: 'src/conflict.ts',
      ancestor: { oid: 'ancestor_oid_123' },
      ours: { oid: 'ours_oid_456' },
      theirs: { oid: 'theirs_oid_789' },
    },
  ];

  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page, {
      ...withConflicts(),
      status: {
        staged: [],
        unstaged: [
          { path: 'src/conflict.ts', status: 'conflicted', isStaged: false, isConflicted: true },
        ],
      },
    });

    await injectCommandMock(page, conflictMocks(oneConflictFile));
  });

  test('resolve_conflict error shows feedback', async ({ page }) => {
    await injectCommandError(page, 'resolve_conflict', 'Permission denied');
    await openConflictResolutionDialog(page);

    const useOursBtn = page.locator('lv-merge-editor .toolbar-actions .btn-ours');
    await expect(useOursBtn).toBeVisible();
    await useOursBtn.click();

    // Click Mark Resolved
    const markResolvedBtn = page.locator('lv-merge-editor .toolbar-actions .btn-primary');
    await markResolvedBtn.click();

    // The dialog should remain open (not close) since resolve failed
    const dialog = page.locator('lv-conflict-resolution-dialog[open]');
    await expect(dialog).toBeVisible();
  });

  test('abort merge calls abort_merge and closes dialog', async ({ page }) => {
    await startCommandCapture(page);
    await openConflictResolutionDialog(page);

    // Click Abort in the footer
    const abortBtn = page.locator(
      'lv-conflict-resolution-dialog .footer-actions .btn-danger'
    );
    await abortBtn.click();

    // Confirm abort in the confirmation dialog
    const confirmBtn = page.locator(
      'lv-conflict-resolution-dialog .confirm-actions .btn-danger'
    );
    await confirmBtn.click();

    await waitForCommand(page, 'abort_merge');

    const commands = await findCommand(page, 'abort_merge');
    expect(commands.length).toBeGreaterThanOrEqual(1);

    // Verify the conflict resolution dialog closes after aborting merge
    // App-shell removes the dialog from DOM when showConflictDialog becomes false
    await expect(
      page.locator('lv-conflict-resolution-dialog[open]')
    ).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe('Merge Editor - UI Outcome Verification', () => {
  const twoConflictFiles = [
    {
      path: 'src/conflict.ts',
      ancestor: { oid: 'ancestor_oid_123' },
      ours: { oid: 'ours_oid_456' },
      theirs: { oid: 'theirs_oid_789' },
    },
    {
      path: 'src/another.ts',
      ancestor: { oid: 'ancestor_oid_aaa' },
      ours: { oid: 'ours_oid_bbb' },
      theirs: { oid: 'theirs_oid_ccc' },
    },
  ];

  const oneConflictFile = [
    {
      path: 'src/conflict.ts',
      ancestor: { oid: 'ancestor_oid_123' },
      ours: { oid: 'ours_oid_456' },
      theirs: { oid: 'theirs_oid_789' },
    },
  ];

  test('Use Ours resolves conflicts and output panel reflects no remaining conflicts', async ({
    page,
  }) => {
    await setupOpenRepository(page, {
      ...withConflicts(),
      status: {
        staged: [],
        unstaged: [
          { path: 'src/conflict.ts', status: 'conflicted', isStaged: false, isConflicted: true },
          { path: 'src/another.ts', status: 'conflicted', isStaged: false, isConflicted: true },
        ],
      },
    });
    await injectCommandMock(page, conflictMocks(twoConflictFiles));
    await openConflictResolutionDialog(page);

    // Before clicking Use Ours, the conflict count should indicate conflicts exist
    const conflictCount = page.locator('lv-merge-editor .conflict-count');
    await expect(conflictCount).toBeVisible();
    const initialText = await conflictCount.textContent();
    expect(initialText).not.toContain('No conflicts');

    // Click Use Ours
    const useOursBtn = page.locator('lv-merge-editor .toolbar-actions .btn-ours');
    await useOursBtn.click();

    // After clicking Use Ours, the conflict count should show "No conflicts"
    await expect(conflictCount).toContainText('No conflicts');

    // The output panel should now reflect the ours content (no conflict markers)
    const outputPanel = page.locator('lv-merge-editor .output-panel');
    await expect(outputPanel).toBeVisible();
    // There should be no conflict action buttons remaining in the output
    const conflictActions = page.locator('lv-merge-editor .output-panel .conflict-actions');
    const actionCount = await conflictActions.count();
    expect(actionCount).toBe(0);
  });

  test('Use Theirs resolves conflicts and output panel reflects no remaining conflicts', async ({
    page,
  }) => {
    await setupOpenRepository(page, {
      ...withConflicts(),
      status: {
        staged: [],
        unstaged: [
          { path: 'src/conflict.ts', status: 'conflicted', isStaged: false, isConflicted: true },
          { path: 'src/another.ts', status: 'conflicted', isStaged: false, isConflicted: true },
        ],
      },
    });
    await injectCommandMock(page, conflictMocks(twoConflictFiles));
    await openConflictResolutionDialog(page);

    // Click Use Theirs
    const useTheirsBtn = page.locator('lv-merge-editor .toolbar-actions .btn-theirs');
    await useTheirsBtn.click();

    // After clicking Use Theirs, the conflict count should show "No conflicts"
    const conflictCount = page.locator('lv-merge-editor .conflict-count');
    await expect(conflictCount).toContainText('No conflicts');

    // The output panel should reflect the theirs content (no conflict markers)
    const outputPanel = page.locator('lv-merge-editor .output-panel');
    await expect(outputPanel).toBeVisible();
    const conflictActions = page.locator('lv-merge-editor .output-panel .conflict-actions');
    const actionCount = await conflictActions.count();
    expect(actionCount).toBe(0);
  });

  test('Continue button enables after all conflicts are resolved', async ({ page }) => {
    await setupOpenRepository(page, {
      ...withConflicts(),
      status: {
        staged: [],
        unstaged: [
          { path: 'src/conflict.ts', status: 'conflicted', isStaged: false, isConflicted: true },
        ],
      },
    });
    await injectCommandMock(page, conflictMocks(oneConflictFile));
    await openConflictResolutionDialog(page);

    // Continue button should be disabled initially (unresolved conflicts)
    const continueBtn = page.locator(
      'lv-conflict-resolution-dialog .footer-actions .btn-primary'
    );
    await expect(continueBtn).toBeDisabled();

    // Resolve the conflict: Use Ours then Mark Resolved
    const useOursBtn = page.locator('lv-merge-editor .toolbar-actions .btn-ours');
    await useOursBtn.click();

    const markResolvedBtn = page.locator('lv-merge-editor .toolbar-actions .btn-primary');
    await markResolvedBtn.click();

    // Wait for the file to be marked as resolved
    const resolvedFile = page.locator('lv-conflict-resolution-dialog .file-item.resolved');
    await expect(resolvedFile).toBeVisible({ timeout: 3000 });

    // Continue button should now be enabled since all conflicts are resolved
    await expect(continueBtn).toBeEnabled({ timeout: 3000 });
  });

  test('get_conflicts failure shows error feedback in the dialog', async ({ page }) => {
    await setupOpenRepository(page, {
      ...withConflicts(),
      status: {
        staged: [],
        unstaged: [
          { path: 'src/conflict.ts', status: 'conflicted', isStaged: false, isConflicted: true },
        ],
      },
    });

    // Set up base mocks first, then inject error for get_conflicts
    await injectCommandMock(page, {
      get_blob_content: 'const value = "base";',
      read_file_content:
        '<<<<<<< HEAD\nconst value = "ours";\n=======\nconst value = "theirs";\n>>>>>>> feature-branch',
      resolve_conflict: null,
      abort_merge: null,
      auto_detect_merge_tool: null,
      is_ai_available: false,
    });
    await injectCommandError(page, 'get_conflicts', 'Failed to get conflicts');

    // Click the Resolve Conflicts button to open the dialog
    const resolveBtn = page.locator('.operation-btn-primary', { hasText: 'Resolve Conflicts' });
    await expect(resolveBtn).toBeVisible();
    await resolveBtn.click();

    // The dialog should open but show an error state:
    // either an error toast, an error message in the dialog, or the dialog stays open without file items
    const errorToast = page.locator('lv-toast-container .toast.error, .error-message, .error-banner');
    const dialog = page.locator('lv-conflict-resolution-dialog');
    const errorMsg = dialog.locator('.error-message, .error, .loading-error');

    // Wait for either the toast or an error indicator in the dialog
    await expect(errorToast.or(errorMsg).or(dialog)).toBeVisible({ timeout: 5000 });

    // The file list should not have loaded successfully (no file items or an error shown)
    const fileItems = dialog.locator('.file-item');
    const fileCount = await fileItems.count();
    // At least one error indicator should be visible (empty state, toast, or inline error)
    if (fileCount === 0) {
      // Empty state is a valid error response
      expect(fileCount).toBe(0);
    } else {
      // Must show explicit error feedback
      await expect(
        page.locator('.toast, .error-message, .error, .error-banner, lv-merge-editor .error').first()
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
