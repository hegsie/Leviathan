import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';

test.describe('Cherry-Pick Dialog', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);
  });

  test('cherry-pick dialog component should be present in DOM', async ({ page }) => {
    // Check that the dialog component exists in the DOM (not open)
    const dialogComponent = page.locator('lv-cherry-pick-dialog');
    await expect(dialogComponent).toBeAttached();
  });

  test('cherry-pick dialog should have modal element', async ({ page }) => {
    // The dialog contains an lv-modal
    const modal = page.locator('lv-cherry-pick-dialog lv-modal');
    await expect(modal).toBeAttached();
  });
});

// Note: Testing the cherry-pick dialog when opened requires clicking on commits
// in the canvas-based graph, which is unreliable in E2E tests. The dialog
// functionality is better tested through:
// 1. Unit tests for the component itself
// 2. Integration tests that directly invoke the dialog's open() method
// 3. Manual testing
//
// The context-menus.spec.ts tests cover the operation banner and its
// "Resolve Conflicts" button which is the main UX improvement.
