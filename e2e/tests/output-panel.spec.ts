import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for the Output Panel (lv-output-panel).
 *
 * The output panel is a singleton log viewer that shows git command executions.
 * It uses a module-level logEntries array and notifies listeners on changes.
 * Entries have: timestamp, command, output, success.
 *
 * The panel shows:
 * - A header with "Output" title, entry count, and Clear button
 * - Expandable entries with status dot, timestamp, and command text
 * - An empty state message when no commands have been logged
 *
 * NOTE: This component is not yet integrated into the app shell layout.
 * It uses direct DOM injection because there is no parent component that
 * renders it. The module-level singleton pattern (logGitCommand) also
 * requires direct access. When the component is integrated into the app
 * layout (e.g., as a collapsible bottom panel), these tests should be
 * updated to use the real app flow instead of injection.
 */

/** Inject lv-output-panel into the page */
async function injectOutputPanel(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const existing = document.querySelector('lv-output-panel');
    if (existing) existing.remove();

    const panel = document.createElement('lv-output-panel');
    panel.style.cssText = 'display: flex; flex-direction: column; width: 600px; height: 400px;';
    document.body.appendChild(panel);
  });
  // Wait for the component to render by checking for a visible element inside it
  await expect(page.locator('lv-output-panel .header-title')).toBeVisible();
}

/** Add log entries via the module's exported function */
async function addLogEntries(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    // @ts-expect-error - dynamic import resolved by Vite at runtime
    import('/src/components/panels/lv-output-panel.ts').then((mod: Record<string, unknown>) => {
      const logFn = mod.logGitCommand as (cmd: string, output: string, success: boolean) => void;
      logFn('git fetch origin', 'Fetching origin\nFrom github.com:test/repo\n * [new branch]      main -> origin/main', true);
      logFn('git pull origin main', 'Already up to date.', true);
      logFn('git push origin main', 'error: failed to push some refs', false);
    });
  });

  await expect(page.locator('lv-output-panel .entry')).toHaveCount(3);
}

/** Add a single failed entry for error-specific tests */
async function addFailedEntry(
  page: import('@playwright/test').Page,
  command: string,
  output: string
): Promise<void> {
  await page.evaluate(
    ({ cmd, out }) => {
      // @ts-expect-error - dynamic import resolved by Vite at runtime
      import('/src/components/panels/lv-output-panel.ts').then((mod: Record<string, unknown>) => {
        const logFn = mod.logGitCommand as (cmd: string, output: string, success: boolean) => void;
        logFn(cmd, out, false);
      });
    },
    { cmd: command, out: output }
  );
}

/** Clear all entries via the module function */
async function clearEntries(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    // @ts-expect-error - dynamic import resolved by Vite at runtime
    const mod = await import('/src/components/panels/lv-output-panel.ts');
    const clearFn = mod.clearLogEntries as () => void;
    clearFn();
  });
  await expect(page.locator('lv-output-panel .entry')).toHaveCount(0);
}

// --------------------------------------------------------------------------
// Empty State
// --------------------------------------------------------------------------
test.describe('Output Panel - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await clearEntries(page);
    await injectOutputPanel(page);
  });

  test('should show header with "Output" title', async ({ page }) => {
    await expect(page.locator('lv-output-panel .header-title')).toContainText('Output');
  });

  test('should show "No output yet" when no entries exist', async ({ page }) => {
    await expect(page.locator('lv-output-panel .empty')).toHaveText('No output yet');
  });

  test('should not show Clear button when no entries exist', async ({ page }) => {
    await expect(page.locator('lv-output-panel .clear-btn')).toHaveCount(0);
  });

  test('should not show entry count in header when no entries exist', async ({ page }) => {
    await expect(page.locator('lv-output-panel .entry-count')).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------
// With Entries
// --------------------------------------------------------------------------
test.describe('Output Panel - With Entries', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await clearEntries(page);
    await injectOutputPanel(page);
    await addLogEntries(page);
  });

  test('should show entries after commands are logged', async ({ page }) => {
    await expect(page.locator('lv-output-panel .entry')).toHaveCount(3);
  });

  test('should show entry count in header', async ({ page }) => {
    await expect(page.locator('lv-output-panel .entry-count')).toHaveText('(3)');
  });

  test('each entry should show a timestamp in HH:MM:SS format', async ({ page }) => {
    const timestamps = page.locator('lv-output-panel .entry-timestamp');
    await expect(timestamps).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      const text = await timestamps.nth(i).textContent();
      expect(text?.trim()).toMatch(/\d{2}:\d{2}:\d{2}/);
    }
  });

  test('each entry should show the command text', async ({ page }) => {
    const commands = page.locator('lv-output-panel .entry-command');
    await expect(commands).toHaveCount(3);

    // Entries are added most recent first (unshift)
    await expect(commands.nth(0)).toHaveText('git push origin main');
    await expect(commands.nth(1)).toHaveText('git pull origin main');
    await expect(commands.nth(2)).toHaveText('git fetch origin');
  });

  test('each entry should show a status dot (success or failure)', async ({ page }) => {
    const statusDots = page.locator('lv-output-panel .status-dot');
    await expect(statusDots).toHaveCount(3);

    // First entry (push) failed
    await expect(page.locator('lv-output-panel .entry').nth(0).locator('.status-dot.failure')).toBeVisible();
    // Second entry (pull) succeeded
    await expect(page.locator('lv-output-panel .entry').nth(1).locator('.status-dot.success')).toBeVisible();
    // Third entry (fetch) succeeded
    await expect(page.locator('lv-output-panel .entry').nth(2).locator('.status-dot.success')).toBeVisible();
  });

  test('failed command should have failure class on command text', async ({ page }) => {
    await expect(
      page.locator('lv-output-panel .entry').nth(0).locator('.entry-command.failure')
    ).toBeVisible();
  });

  test('should show Clear button when entries exist', async ({ page }) => {
    const clearBtn = page.locator('lv-output-panel .clear-btn');
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toContainText('Clear');
  });
});

// --------------------------------------------------------------------------
// Entry Expand / Collapse
// --------------------------------------------------------------------------
test.describe('Output Panel - Entry Expansion', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await clearEntries(page);
    await injectOutputPanel(page);
    await addLogEntries(page);
  });

  test('clicking an entry header should expand it to show output', async ({ page }) => {
    // Click the first entry header (the push failure, which has output)
    await page.locator('lv-output-panel .entry-header').first().click();

    await expect(page.locator('lv-output-panel .entry-output')).toBeVisible();
  });

  test('expanded entry should show the correct output text', async ({ page }) => {
    // Expand the first entry (push failure)
    await page.locator('lv-output-panel .entry-header').first().click();

    await expect(page.locator('lv-output-panel .entry-output').first()).toHaveText(
      'error: failed to push some refs'
    );
  });

  test('expanding a success entry should show its output', async ({ page }) => {
    // Click the third entry header (fetch, which succeeded)
    await page.locator('lv-output-panel .entry-header').nth(2).click();

    await expect(page.locator('lv-output-panel .entry-output')).toContainText('Fetching origin');
    await expect(page.locator('lv-output-panel .entry-output')).toContainText(
      'main -> origin/main'
    );
  });

  test('clicking the entry header again should collapse the output', async ({ page }) => {
    const firstHeader = page.locator('lv-output-panel .entry-header').first();

    // Expand
    await firstHeader.click();
    await expect(page.locator('lv-output-panel .entry-output')).toBeVisible();

    // Collapse
    await firstHeader.click();
    await expect(page.locator('lv-output-panel .entry-output')).toHaveCount(0);
  });

  test('expand icon should rotate when entry is expanded', async ({ page }) => {
    // Expand
    await page.locator('lv-output-panel .entry-header').first().click();

    await expect(
      page.locator('lv-output-panel .entry').first().locator('.expand-icon.expanded')
    ).toBeVisible();
  });

  test('expand icon should not be rotated when entry is collapsed', async ({ page }) => {
    const firstHeader = page.locator('lv-output-panel .entry-header').first();

    // Expand then collapse
    await firstHeader.click();
    await expect(
      page.locator('lv-output-panel .entry').first().locator('.expand-icon.expanded')
    ).toBeVisible();

    await firstHeader.click();
    await expect(
      page.locator('lv-output-panel .entry').first().locator('.expand-icon.expanded')
    ).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------
// Clear Functionality
// --------------------------------------------------------------------------
test.describe('Output Panel - Clear', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await clearEntries(page);
    await injectOutputPanel(page);
    await addLogEntries(page);
  });

  test('clicking Clear should remove all entries', async ({ page }) => {
    await page.locator('lv-output-panel .clear-btn').click();

    await expect(page.locator('lv-output-panel .entry')).toHaveCount(0);
  });

  test('should show empty state after clearing', async ({ page }) => {
    await page.locator('lv-output-panel .clear-btn').click();

    await expect(page.locator('lv-output-panel .empty')).toHaveText('No output yet');
  });

  test('Clear button should disappear after clearing', async ({ page }) => {
    await page.locator('lv-output-panel .clear-btn').click();

    await expect(page.locator('lv-output-panel .clear-btn')).toHaveCount(0);
  });

  test('entry count should disappear after clearing', async ({ page }) => {
    await page.locator('lv-output-panel .clear-btn').click();

    await expect(page.locator('lv-output-panel .entry-count')).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------
// Error Entry Display
// --------------------------------------------------------------------------
test.describe('Output Panel - Error Entry Display', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await clearEntries(page);
    await injectOutputPanel(page);
  });

  test('failed command should display with failure status dot', async ({ page }) => {
    await addFailedEntry(page, 'git merge feature', 'CONFLICT (content): Merge conflict in file.ts\nAutomatic merge failed; fix conflicts and then commit the result.');
    await expect(page.locator('lv-output-panel .entry')).toHaveCount(1);

    await expect(page.locator('lv-output-panel .status-dot.failure')).toBeVisible();
    await expect(page.locator('lv-output-panel .status-dot.success')).toHaveCount(0);
  });

  test('failed command text should have failure class', async ({ page }) => {
    await addFailedEntry(page, 'git rebase main', 'error: could not apply abc1234');
    await expect(page.locator('lv-output-panel .entry')).toHaveCount(1);

    await expect(page.locator('lv-output-panel .entry-command.failure')).toBeVisible();
    await expect(page.locator('lv-output-panel .entry-command.failure')).toHaveText('git rebase main');
  });

  test('expanding a failed entry should show the error output', async ({ page }) => {
    const errorOutput = 'CONFLICT (content): Merge conflict in file.ts\nAutomatic merge failed; fix conflicts and then commit the result.';
    await addFailedEntry(page, 'git merge feature', errorOutput);
    await expect(page.locator('lv-output-panel .entry')).toHaveCount(1);

    // Expand the entry
    await page.locator('lv-output-panel .entry-header').click();

    await expect(page.locator('lv-output-panel .entry-output')).toBeVisible();
    await expect(page.locator('lv-output-panel .entry-output')).toContainText('CONFLICT (content)');
    await expect(page.locator('lv-output-panel .entry-output')).toContainText('Automatic merge failed');
  });

  test('multiple failed entries should all show failure styling', async ({ page }) => {
    await addFailedEntry(page, 'git push origin main', 'rejected: non-fast-forward');
    await expect(page.locator('lv-output-panel .entry')).toHaveCount(1);

    await addFailedEntry(page, 'git pull --rebase', 'error: cannot pull with rebase');
    await expect(page.locator('lv-output-panel .entry')).toHaveCount(2);

    await expect(page.locator('lv-output-panel .status-dot.failure')).toHaveCount(2);
    await expect(page.locator('lv-output-panel .entry-command.failure')).toHaveCount(2);
  });

  test('failed entry with empty output should expand but show nothing', async ({ page }) => {
    await addFailedEntry(page, 'git checkout nonexistent', '');
    await expect(page.locator('lv-output-panel .entry')).toHaveCount(1);

    // Expand the entry - with empty output, no .entry-output div should render
    await page.locator('lv-output-panel .entry-header').click();

    // The component renders entry-output only when entry.output is truthy
    // An empty string is falsy, so no output div appears
    await expect(page.locator('lv-output-panel .entry-output')).toHaveCount(0);

    // But the expand icon should still toggle
    await expect(
      page.locator('lv-output-panel .entry').first().locator('.expand-icon.expanded')
    ).toBeVisible();
  });
});
