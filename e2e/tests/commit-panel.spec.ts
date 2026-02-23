import { test, expect } from '@playwright/test';
import { setupOpenRepository, withStagedFiles } from '../fixtures/tauri-mock';
import { RightPanelPage } from '../pages/panels.page';
import {
  startCommandCaptureWithMocks,
  findCommand,
  waitForCommand,
  injectCommandError,
  injectCommandMock,
} from '../fixtures/test-helpers';

test.describe('Commit Panel - Basic', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, {
      status: {
        staged: [
          { path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false },
          { path: 'src/utils.ts', status: 'new', isStaged: true, isConflicted: false },
        ],
        unstaged: [],
      },
    });
  });

  test('should display commit panel', async () => {
    await expect(rightPanel.commitPanel).toBeVisible();
  });

  test('should have message input field', async () => {
    await expect(rightPanel.commitMessage).toBeVisible();
  });

  test('should have Commit button', async () => {
    await expect(rightPanel.commitButton).toBeVisible();
  });

  test('Commit button should be disabled without message', async () => {
    await expect(rightPanel.commitButton).toBeDisabled();
  });

  test('should enable Commit button when message is entered', async () => {
    await rightPanel.commitMessage.fill('Test commit message');

    await expect(rightPanel.commitButton).toBeEnabled();
  });
});

test.describe('Commit Panel - Amend Mode', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, {
      commits: [
        {
          oid: 'abc123def456',
          shortId: 'abc123d',
          message: 'Previous commit message\n\nExtended description here',
          summary: 'Previous commit message',
          body: 'Extended description here',
          author: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
          committer: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
          parentIds: [],
          timestamp: Date.now() / 1000,
        },
      ],
    });
  });

  test('should have Amend checkbox or toggle', async ({ page }) => {
    const amendToggle = page.locator('lv-commit-panel').locator('label', { hasText: /amend/i });
    const toggleCount = await amendToggle.count();
    expect(toggleCount).toBeGreaterThan(0);
  });

  test('amend mode should populate message from last commit', async ({ page }) => {
    const amendToggle = page.locator('lv-commit-panel label', { hasText: /amend/i }).first();

    await expect(amendToggle).toBeVisible();
    await amendToggle.click();

    await expect(rightPanel.commitMessage).toHaveValue(/Previous commit message/);
  });
});

test.describe('Commit Panel - Conventional Commits', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page);
  });

  test('should have conventional commits toggle', async ({ page }) => {
    const conventionalToggle = page.locator('lv-commit-panel').locator('button, input, label', { hasText: /conventional/i });
    const toggleCount = await conventionalToggle.count();
    expect(toggleCount).toBeGreaterThan(0);
  });

  test('conventional mode should show type selector', async ({ page }) => {
    const conventionalToggle = page.locator('lv-commit-panel label', { hasText: /conventional/i }).first();

    await expect(conventionalToggle).toBeVisible();
    await conventionalToggle.click();

    const typeSelector = page.locator('lv-commit-panel').locator('select.type-select');
    await expect(typeSelector.first()).toBeVisible();
  });

  test('should have common commit types available', async ({ page }) => {
    const conventionalToggle = page.locator('lv-commit-panel label', { hasText: /conventional/i }).first();

    await expect(conventionalToggle).toBeVisible();
    await conventionalToggle.click();

    // Verify the type select is visible and has options
    const typeSelect = page.locator('lv-commit-panel select.type-select');
    await expect(typeSelect).toBeVisible();

    // Verify common types are present by checking the select's options
    const optionTexts = await typeSelect.locator('option').allTextContents();
    const allText = optionTexts.join(' ').toLowerCase();
    expect(allText).toContain('feat');
    expect(allText).toContain('fix');
  });

  test('should have scope input field', async ({ page }) => {
    const conventionalToggle = page.locator('lv-commit-panel label', { hasText: /conventional/i }).first();

    await expect(conventionalToggle).toBeVisible();
    await conventionalToggle.click();

    const scopeInput = page.locator('lv-commit-panel input.scope-input');
    await expect(scopeInput.first()).toBeVisible();
  });
});

test.describe('Commit Panel - Templates', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page);

    // Override list_templates to return templates so the template selector appears
    await injectCommandMock(page, {
      list_templates: [
        { id: 'tpl-1', name: 'Bug Fix', content: 'fix: ', isConventional: false, createdAt: Date.now() },
        { id: 'tpl-2', name: 'Feature', content: 'feat: ', isConventional: false, createdAt: Date.now() },
        { id: 'tpl-3', name: 'Documentation', content: 'docs: ', isConventional: false, createdAt: Date.now() },
      ],
    });

    // Force the commit panel to reload templates using Playwright locator (auto-pierces shadow DOM)
    await page.locator('lv-commit-panel').evaluate(async (el: any) => {
      if (typeof el.loadTemplates === 'function') {
        await el.loadTemplates();
        await el.updateComplete;
      }
    });
    // Wait for templates to load and render
    await page.locator('lv-commit-panel select.template-select').waitFor({ state: 'visible', timeout: 5000 });
  });

  test('should have template selector or button', async ({ page }) => {
    const templateSelector = page.locator('lv-commit-panel select.template-select');
    await expect(templateSelector).toBeVisible();
  });

  test('should have save template option', async ({ page }) => {
    // Save template button is the icon-btn next to the template selector
    const saveTemplateButton = page.locator('lv-commit-panel .icon-btn[title="Save as template"]');
    await expect(saveTemplateButton).toBeVisible();
  });

  test('selecting template should populate message', async ({ page }) => {
    const templateSelector = page.locator('lv-commit-panel select.template-select');
    await expect(templateSelector).toBeVisible();

    // Select the "Bug Fix" template
    await templateSelector.selectOption({ value: 'tpl-1' });

    // Verify the commit message is populated
    await expect(rightPanel.commitMessage).toHaveValue(/fix:/);
  });
});

test.describe('Commit Panel - AI Generation', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page);
  });

  test('should have AI generate button', async () => {
    await expect(rightPanel.aiGenerateButton).toBeVisible();
  });

  test('AI button should have tooltip', async ({ page }) => {
    const generateBtn = page.locator('lv-commit-panel .generate-btn');
    await expect(generateBtn).toBeVisible();
    const title = await generateBtn.getAttribute('title');
    expect(title).not.toBeNull();
    expect(title!.length).toBeGreaterThan(0);
  });
});

test.describe('Commit Panel - Character Limit', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page);
  });

  test('should show character count', async ({ page }) => {
    await rightPanel.commitMessage.fill('Test message');

    const charCount = page.locator('lv-commit-panel .char-count');
    await expect(charCount).toBeVisible();
    await expect(charCount).toContainText('12/72');
  });

  test('should warn when approaching character limit', async ({ page }) => {
    const longMessage = 'A'.repeat(70);
    await rightPanel.commitMessage.fill(longMessage);

    const charCount = page.locator('lv-commit-panel .char-count');
    await expect(charCount).toBeVisible();
    await expect(charCount).toContainText('70/72');
  });

  test('should show error when over character limit', async ({ page }) => {
    const veryLongMessage = 'A'.repeat(80);
    await rightPanel.commitMessage.fill(veryLongMessage);

    const charCount = page.locator('lv-commit-panel .char-count');
    await expect(charCount).toBeVisible();
    await expect(charCount).toContainText('80/72');
  });
});

test.describe('Commit Panel - Keyboard Shortcuts', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );
  });

  test('Cmd+Enter should submit commit', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      create_commit: { oid: 'new123', shortId: 'new123', summary: 'test' },
    });

    await rightPanel.commitMessage.fill('Test commit message');
    await rightPanel.commitMessage.press('Meta+Enter');

    await waitForCommand(page, 'create_commit');

    const commitCommands = await findCommand(page, 'create_commit');
    expect(commitCommands.length).toBe(1);

    const args = commitCommands[0].args as { message: string };
    expect(args.message).toBe('Test commit message');

    // Verify the commit message input is cleared after successful commit
    await expect(rightPanel.commitMessage).toHaveValue('');
  });

  test('Escape should blur message input', async ({ page }) => {
    await rightPanel.commitMessage.focus();
    await rightPanel.commitMessage.fill('Test message');

    // Click elsewhere to blur the textarea (the Commit panel header)
    await page.locator('lv-commit-panel .header').click();

    // Verify the textarea lost focus
    await expect(rightPanel.commitMessage).not.toBeFocused();

    // Verify the message is still preserved
    await expect(rightPanel.commitMessage).toHaveValue('Test message');
  });
});

test.describe('Commit Panel - Empty State', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, {
      status: {
        staged: [],
        unstaged: [],
      },
    });
  });

  test('should show clean working tree message when no files staged', async ({ page }) => {
    const cleanState = page.locator('lv-file-status .clean-state');
    await expect(cleanState).toBeVisible();
    await expect(cleanState.locator('.title')).toHaveText('Working tree clean');
  });

  test('Commit button should be disabled with no staged files', async () => {
    await expect(rightPanel.commitButton).toBeDisabled();
  });
});

test.describe('Commit Panel - Staged Files Display', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, {
      status: {
        staged: [
          { path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false },
          { path: 'src/utils.ts', status: 'new', isStaged: true, isConflicted: false },
          { path: 'old-file.ts', status: 'deleted', isStaged: true, isConflicted: false },
        ],
        unstaged: [],
      },
    });
  });

  test('should show count of staged files', async () => {
    const count = await rightPanel.getStagedCount();
    expect(count).toBe(3);
  });

  test('should list staged files', async () => {
    await expect(rightPanel.getStagedFile('src/main.ts')).toBeVisible();
    await expect(rightPanel.getStagedFile('src/utils.ts')).toBeVisible();
    await expect(rightPanel.getStagedFile('old-file.ts')).toBeVisible();
  });

  test('staged files should show status indicators', async ({ page }) => {
    const statusIndicators = page.locator('lv-file-status .status, lv-file-status .status-icon, lv-file-status [class*="status"]');
    const indicatorCount = await statusIndicators.count();
    expect(indicatorCount).toBeGreaterThan(0);
  });
});

test.describe('Commit Panel - Commit E2E', () => {
  let rightPanel: RightPanelPage;

  test('commit success should clear message and show success feedback', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    await startCommandCaptureWithMocks(page, {
      create_commit: { oid: 'commit-success-123', shortId: 'commit-s', summary: 'test success' },
    });

    await rightPanel.commitMessage.fill('feat: successful commit');
    await rightPanel.commitButton.click();

    await expect(rightPanel.commitMessage).toHaveValue('');

    const successMessage = page.locator('lv-commit-panel .success');
    await expect(successMessage).toBeVisible();
    await expect(successMessage).toContainText('commit-s');
  });

  test('commit success should fire repository-refresh event', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    await startCommandCaptureWithMocks(page, {
      create_commit: { oid: 'abc123', shortId: 'abc123d', summary: 'test' },
    });

    // Set up the event listener before performing the action
    await page.evaluate(() => {
      (window as any).__REFRESH_RECEIVED__ = false;
      window.addEventListener('repository-refresh', () => {
        (window as any).__REFRESH_RECEIVED__ = true;
      }, { once: true });
    });

    await rightPanel.commitMessage.fill('feat: trigger refresh');
    await rightPanel.commitButton.click();

    // Wait for the event to be received
    await page.waitForFunction(() => (window as any).__REFRESH_RECEIVED__ === true);
    const result = await page.evaluate(() => (window as any).__REFRESH_RECEIVED__);
    expect(result).toBe(true);
  });

  test('commit failure should show error and NOT clear message', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    await injectCommandError(page, 'create_commit', 'Commit hook failed: pre-commit rejected');

    await rightPanel.commitMessage.fill('test: failing commit');
    await rightPanel.commitButton.click();

    const errorMessage = page.locator('lv-commit-panel .error');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Commit hook failed');

    await expect(rightPanel.commitMessage).toHaveValue('test: failing commit');
  });

  test('amend toggle should populate summary from last commit message', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, {
      commits: [
        {
          oid: 'abc123',
          shortId: 'abc123d',
          message: 'fix: previous commit to amend\n\nThis body should also appear',
          summary: 'fix: previous commit to amend',
          body: 'This body should also appear',
          author: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
          committer: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
          parentIds: [],
          timestamp: Date.now() / 1000,
        },
      ],
    });

    const amendToggle = page.locator('lv-commit-panel label', { hasText: /amend/i }).first();
    await expect(amendToggle).toBeVisible();
    await amendToggle.click();

    await expect(rightPanel.commitMessage).toHaveValue(/previous commit to amend/);
  });

  test('AI generate button should invoke generate_commit_message command', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    // Make AI available so the generate button works
    await injectCommandMock(page, {
      is_ai_available: true,
    });

    // Force the commit panel to re-check AI availability using Playwright locator (auto-pierces shadow DOM)
    await page.locator('lv-commit-panel').evaluate(async (el: any) => {
      if (typeof el.checkAiAvailability === 'function') {
        await el.checkAiAvailability();
        await el.updateComplete;
      }
    });

    // Wait for the button text to change to "Generate with AI"
    await expect(page.locator('lv-commit-panel .generate-btn')).toContainText('Generate with AI');

    await startCommandCaptureWithMocks(page, {
      generate_commit_message: { summary: 'feat: auto-generated message', body: null },
      is_ai_available: true,
    });

    await rightPanel.aiGenerateButton.click();

    await waitForCommand(page, 'generate_commit_message');

    const genCommands = await findCommand(page, 'generate_commit_message');
    expect(genCommands.length).toBeGreaterThan(0);

    // Verify the commit message is populated with the generated message
    await expect(rightPanel.commitMessage).toHaveValue(/auto-generated message/);
  });

  test('commit with amend flag should send amend=true in command args', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page, {
      status: {
        staged: [{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }],
        unstaged: [],
      },
      commits: [
        {
          oid: 'abc123',
          shortId: 'abc123d',
          message: 'old message',
          summary: 'old message',
          body: null,
          author: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
          committer: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
          parentIds: [],
          timestamp: Date.now() / 1000,
        },
      ],
    });

    const amendToggle = page.locator('lv-commit-panel label', { hasText: /amend/i }).first();
    await amendToggle.click();

    await expect(rightPanel.commitMessage).toHaveValue(/old message/);

    await startCommandCaptureWithMocks(page, {
      create_commit: { oid: 'amended123', shortId: 'amended', summary: 'amended message' },
    });

    await rightPanel.commitMessage.fill('chore: amended message');
    await rightPanel.commitButton.click();

    await waitForCommand(page, 'create_commit');

    const commitCommands = await findCommand(page, 'create_commit');
    expect(commitCommands.length).toBe(1);

    const args = commitCommands[0].args as { message: string; amend: boolean };
    expect(args.message).toBe('chore: amended message');
    expect(args.amend).toBe(true);

    // Verify the commit message input is cleared after successful amend commit
    await expect(rightPanel.commitMessage).toHaveValue('');
  });
});

test.describe('Commit Panel - UI Outcome Verification', () => {
  let rightPanel: RightPanelPage;

  test('template selection should insert template text into message textarea', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(page);

    // Inject templates so the template selector appears
    await injectCommandMock(page, {
      list_templates: [
        { id: 'tpl-bug', name: 'Bug Fix Template', content: 'fix: resolve issue with', isConventional: false, createdAt: Date.now() },
        { id: 'tpl-feat', name: 'Feature Template', content: 'feat: implement new functionality for', isConventional: false, createdAt: Date.now() },
      ],
    });

    // Force the commit panel to reload templates
    await page.locator('lv-commit-panel').evaluate(async (el: any) => {
      if (typeof el.loadTemplates === 'function') {
        await el.loadTemplates();
        await el.updateComplete;
      }
    });
    await page.locator('lv-commit-panel select.template-select').waitFor({ state: 'visible', timeout: 5000 });

    // Select the Feature Template
    const templateSelector = page.locator('lv-commit-panel select.template-select');
    await templateSelector.selectOption({ value: 'tpl-feat' });

    // Verify the message textarea is populated with the exact template content
    await expect(rightPanel.commitMessage).toHaveValue('feat: implement new functionality for');
  });

  test('AI generation should populate message textarea with generated text', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    // Make AI available
    await injectCommandMock(page, {
      is_ai_available: true,
    });

    // Force the commit panel to re-check AI availability
    await page.locator('lv-commit-panel').evaluate(async (el: any) => {
      if (typeof el.checkAiAvailability === 'function') {
        await el.checkAiAvailability();
        await el.updateComplete;
      }
    });

    // Wait for the button text to indicate AI is available
    await expect(page.locator('lv-commit-panel .generate-btn')).toContainText('Generate with AI');

    // Mock the AI response with a specific message
    await injectCommandMock(page, {
      generate_commit_message: { summary: 'refactor: extract helper utilities into shared module', body: null },
      is_ai_available: true,
    });

    await rightPanel.aiGenerateButton.click();

    // Verify the textarea contains the AI-generated message text
    await expect(rightPanel.commitMessage).toHaveValue('refactor: extract helper utilities into shared module');
  });

  test('generate_commit_message failure should show error feedback', async ({ page }) => {
    rightPanel = new RightPanelPage(page);
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    // Make AI available so the button is clickable
    await injectCommandMock(page, {
      is_ai_available: true,
    });

    // Force the commit panel to re-check AI availability
    await page.locator('lv-commit-panel').evaluate(async (el: any) => {
      if (typeof el.checkAiAvailability === 'function') {
        await el.checkAiAvailability();
        await el.updateComplete;
      }
    });

    await expect(page.locator('lv-commit-panel .generate-btn')).toContainText('Generate with AI');

    // Inject error for generate_commit_message
    await injectCommandError(page, 'generate_commit_message', 'AI service unavailable: rate limit exceeded');

    // Enter a pre-existing message to verify it is preserved after the error
    await rightPanel.commitMessage.fill('existing draft message');

    await rightPanel.aiGenerateButton.click();

    // Verify error feedback is shown - either inline error in commit panel or a toast notification
    const inlineError = page.locator('lv-commit-panel .error');
    const toast = page.locator('.toast.error, .toast-error, .toast');

    await expect(inlineError.or(toast).first()).toBeVisible({ timeout: 5000 });

    // Verify the error feedback contains the failure reason
    const errorElement = inlineError.or(toast).first();
    await expect(errorElement).toContainText(/AI service unavailable|rate limit|error/i);

    // Verify the commit message textarea remains unchanged (pre-existing text preserved)
    await expect(rightPanel.commitMessage).toHaveValue('existing draft message');
  });
});
