import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import {
  startCommandCapture,
  findCommand,
  injectCommandError,
  openViaCommandPalette,
  waitForCommand,
} from '../fixtures/test-helpers';

/**
 * Open the Create Tag dialog via the command palette (no targetRef).
 * Returns a locator scoped to the dialog instance that has an open modal.
 */
async function openCreateTagDialog(page: import('@playwright/test').Page) {
  await openViaCommandPalette(page, 'Create tag');
  const modal = page.locator('lv-create-tag-dialog lv-modal[open]');
  await modal.waitFor({ state: 'visible' });
  // Scope to the lv-create-tag-dialog that has the open modal
  return page.locator('lv-create-tag-dialog').filter({ has: page.locator('lv-modal[open]') });
}

/**
 * Open the Create Tag dialog with a specific target ref pre-filled.
 * Uses Playwright's locator.evaluate() to call the component's open() method
 * on the app-shell's dialog instance.
 */
async function openCreateTagDialogWithRef(
  page: import('@playwright/test').Page,
  targetRef: string
) {
  // The app-shell's lv-create-tag-dialog is the first one; use .first() to target it
  const dialogEl = page.locator('lv-create-tag-dialog').first();
  await dialogEl.evaluate(
    (el, ref) => (el as HTMLElement & { open: (t?: string) => void }).open(ref),
    targetRef
  );
  const modal = page.locator('lv-create-tag-dialog lv-modal[open]');
  await modal.waitFor({ state: 'visible' });
  return page.locator('lv-create-tag-dialog').filter({ has: page.locator('lv-modal[open]') });
}

test.describe('Create Tag Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('dialog opens with name input and target ref fields', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await expect(nameInput).toBeVisible();

    const targetInput = dialog.locator('#target-input');
    await expect(targetInput).toBeVisible();
  });

  test('dialog opens with target ref pre-filled when provided', async ({ page }) => {
    const dialog = await openCreateTagDialogWithRef(page, 'abc123def456');

    const targetInput = dialog.locator('#target-input');
    await expect(targetInput).toHaveValue('abc123def456');
  });

  test('annotated tag is enabled by default and message textarea is visible', async ({
    page,
  }) => {
    const dialog = await openCreateTagDialog(page);

    const annotatedCheckbox = dialog.locator('.toggle-switch input[type="checkbox"]');
    await expect(annotatedCheckbox).toBeChecked();

    const messageTextarea = dialog.locator('#message-input');
    await expect(messageTextarea).toBeVisible();
  });

  test('disabling annotated tag hides message textarea', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);

    // Click the visible toggle slider to uncheck (the hidden input has zero dimensions)
    const toggleSlider = dialog.locator('.toggle-slider');
    await toggleSlider.click();

    const messageTextarea = dialog.locator('#message-input');
    await expect(messageTextarea).not.toBeVisible();
  });

  test('re-enabling annotated tag shows message textarea again', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);
    const toggleSlider = dialog.locator('.toggle-slider');

    // Click to uncheck (disable annotated)
    await toggleSlider.click();
    await expect(dialog.locator('#message-input')).not.toBeVisible();

    // Click again to re-check (enable annotated)
    await toggleSlider.click();
    await expect(dialog.locator('#message-input')).toBeVisible();
  });

  test('Create Tag button is disabled when name is empty', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);
    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });

    await expect(createBtn).toBeDisabled();
  });

  test('Create Tag button is disabled when annotated but message is empty', async ({
    page,
  }) => {
    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('v1.0.0');

    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });
    await expect(createBtn).toBeDisabled();
  });

  test('Create Tag button becomes enabled when form is valid', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('v2.0.0');

    const messageTextarea = dialog.locator('#message-input');
    await messageTextarea.fill('Release version 2.0.0');

    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });
    await expect(createBtn).toBeEnabled();
  });

  test('lightweight tag (annotated off) only needs name to be valid', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);

    // Click the visible toggle slider to uncheck (disable annotated)
    const toggleSlider = dialog.locator('.toggle-slider');
    await toggleSlider.click();

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('v2.0.0');

    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });
    await expect(createBtn).toBeEnabled();
  });

  test('fill form and create calls create_tag with correct args', async ({ page }) => {
    await startCommandCapture(page);
    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('v3.0.0');

    const targetInput = dialog.locator('#target-input');
    await targetInput.fill('abc123');

    const messageTextarea = dialog.locator('#message-input');
    await messageTextarea.fill('Release v3.0.0');

    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    await waitForCommand(page, 'create_tag');

    const commands = await findCommand(page, 'create_tag');
    expect(commands.length).toBeGreaterThanOrEqual(1);

    const args = commands[0].args as {
      name?: string;
      target?: string;
      message?: string;
      path?: string;
    };
    expect(args.name).toBe('v3.0.0');
    expect(args.target).toBe('abc123');
    expect(args.message).toBe('Release v3.0.0');

    // Verify the dialog closes after successful tag creation
    await expect(
      page.locator('lv-create-tag-dialog lv-modal[open]')
    ).not.toBeVisible({ timeout: 3000 });
  });

  test('tag-created event fires after successful creation', async ({ page }) => {
    // Set up event listener before opening dialog
    await page.evaluate(() => {
      (window as any).__TAG_CREATED_RECEIVED__ = false;
      document.addEventListener(
        'tag-created',
        () => {
          (window as any).__TAG_CREATED_RECEIVED__ = true;
        },
        { once: true }
      );
    });

    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('v4.0.0');

    const messageTextarea = dialog.locator('#message-input');
    await messageTextarea.fill('Release v4.0.0');

    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });
    await createBtn.click();

    await page.waitForFunction(
      () => (window as any).__TAG_CREATED_RECEIVED__ === true,
      { timeout: 5000 }
    );
  });

  test('dialog closes after successful tag creation', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('v5.0.0');

    const messageTextarea = dialog.locator('#message-input');
    await messageTextarea.fill('Release v5.0.0');

    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });
    await createBtn.click();

    const modal = page.locator('lv-create-tag-dialog lv-modal[open]');
    await expect(modal).not.toBeVisible();
  });

  test('cancel closes dialog without creating tag', async ({ page }) => {
    await startCommandCapture(page);
    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('v-canceled');

    const cancelBtn = dialog.locator('button.btn-secondary', { hasText: /Cancel/ });
    await cancelBtn.click();

    const modal = page.locator('lv-create-tag-dialog lv-modal[open]');
    await expect(modal).not.toBeVisible();

    const commands = await findCommand(page, 'create_tag');
    expect(commands.length).toBe(0);
  });

  test('error from create_tag shows error message in dialog', async ({ page }) => {
    await injectCommandError(page, 'create_tag', 'Tag already exists: v1.0.0');

    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('v1.0.0');

    const messageTextarea = dialog.locator('#message-input');
    await messageTextarea.fill('Duplicate tag');

    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });
    await createBtn.click();

    const errorMessage = dialog.locator('.error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Tag already exists: v1.0.0');

    const modal = page.locator('lv-create-tag-dialog lv-modal[open]');
    await expect(modal).toBeVisible();
  });

  test('semantic versioning hint is displayed', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);
    const hint = dialog.locator('.field-hint', { hasText: /semantic versioning/ });
    await expect(hint).toBeVisible();
  });

  test('tag name starting with dash shows validation error', async ({ page }) => {
    const dialog = await openCreateTagDialog(page);

    const nameInput = dialog.locator('#tag-name-input');
    await nameInput.fill('-invalid-tag');

    // Click the visible toggle slider to uncheck (disable annotated)
    const toggleSlider = dialog.locator('.toggle-slider');
    await toggleSlider.click();

    const createBtn = dialog.locator('button.btn-primary', { hasText: /Create Tag/ });
    await createBtn.click();

    const errorMessage = dialog.locator('.error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('cannot start with');
  });
});
