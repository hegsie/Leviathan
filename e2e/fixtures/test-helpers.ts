import type { Page } from '@playwright/test';

/**
 * Shared test helpers for E2E tests.
 * Eliminates repetitive boilerplate for command capture, event waiting, and dialog navigation.
 */

/**
 * Start recording all Tauri invoke calls.
 * Must be called before the actions you want to capture.
 */
export async function startCommandCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const originalInvoke = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__.invoke;

    (window as unknown as {
      __INVOKED_COMMANDS__: { command: string; args: unknown }[];
    }).__INVOKED_COMMANDS__ = [];

    (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
      (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__.push({ command, args });
      return originalInvoke(command, args);
    };
  });
}

/**
 * Get all captured commands since startCommandCapture was called.
 */
export async function getCapturedCommands(
  page: Page
): Promise<Array<{ command: string; args?: unknown }>> {
  return page.evaluate(() => {
    return (
      (window as unknown as { __INVOKED_COMMANDS__?: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__ || []
    );
  });
}

/**
 * Find captured commands by name.
 */
export async function findCommand(
  page: Page,
  commandName: string
): Promise<Array<{ command: string; args?: unknown }>> {
  const commands = await getCapturedCommands(page);
  return commands.filter((c) => c.command === commandName);
}

/**
 * Wait for a repository-changed event to fire during an action.
 * Returns true if the event was received within timeout, false otherwise.
 */
export async function waitForRepositoryChanged(
  page: Page,
  action: () => Promise<void>,
  timeout = 3000
): Promise<boolean> {
  const eventPromise = page.evaluate((ms: number) => {
    return new Promise<boolean>((resolve) => {
      document.addEventListener(
        'repository-changed',
        () => {
          resolve(true);
        },
        { once: true }
      );
      setTimeout(() => resolve(false), ms);
    });
  }, timeout);

  await action();

  return eventPromise;
}

/**
 * Override a specific Tauri command to throw an error.
 * Call this after setupOpenRepository to inject error behavior for specific commands.
 */
export async function injectCommandError(
  page: Page,
  command: string,
  message: string
): Promise<void> {
  await page.evaluate(
    ({ cmd, msg }) => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === cmd) {
          // Record the command for waitForCommand/findCommand if capture is active
          const captured = (window as unknown as { __INVOKED_COMMANDS__?: { command: string; args: unknown }[] })
            .__INVOKED_COMMANDS__;
          if (captured) {
            captured.push({ command, args });
          }
          throw new Error(msg);
        }
        return originalInvoke(command, args);
      };
    },
    { cmd: command, msg: message }
  );
}

/**
 * Override multiple Tauri commands to return custom responses.
 * Useful for mocking specific commands within a test.
 */
export async function injectCommandMock(
  page: Page,
  overrides: Record<string, unknown>
): Promise<void> {
  await page.evaluate((mocks) => {
    const originalInvoke = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__.invoke;

    (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
      if (command in mocks) {
        // Record the command for waitForCommand/findCommand if capture is active,
        // since we short-circuit and don't call originalInvoke which may have its own recording
        const captured = (window as unknown as { __INVOKED_COMMANDS__?: { command: string; args: unknown }[] })
          .__INVOKED_COMMANDS__;
        if (captured) {
          captured.push({ command, args });
        }
        const val = mocks[command];
        if (val instanceof Error || (typeof val === 'object' && val !== null && '__error__' in val)) {
          throw new Error(
            typeof val === 'object' && val !== null && '__error__' in val
              ? (val as { __error__: string }).__error__
              : (val as Error).message
          );
        }
        return val;
      }
      return originalInvoke(command, args);
    };
  }, overrides);
}

/**
 * Wait for a specific Tauri command to be invoked.
 * Useful when you need to wait for an async action to trigger a backend call.
 */
export async function waitForCommand(
  page: Page,
  commandName: string,
  timeout = 5000
): Promise<void> {
  await page.waitForFunction(
    (cmd) =>
      (window as unknown as { __INVOKED_COMMANDS__?: { command: string }[] })
        .__INVOKED_COMMANDS__?.some((c) => c.command === cmd),
    commandName,
    { timeout }
  );
}

/**
 * Auto-confirm all native dialog prompts (confirm/ask).
 */
export async function autoConfirmDialogs(page: Page): Promise<void> {
  await injectCommandMock(page, {
    'plugin:dialog|confirm': true,
    'plugin:dialog|ask': true,
  });
}

/**
 * Open a dialog via the command palette.
 */
export async function openViaCommandPalette(page: Page, commandName: string): Promise<void> {
  await page.keyboard.press('Meta+p');
  await page.locator('lv-command-palette[open]').waitFor({ state: 'visible' });
  await page.locator('lv-command-palette[open] .search-input').fill(commandName);
  await page.locator('lv-command-palette[open] .command').first().waitFor({ state: 'visible' });
  await page.keyboard.press('Enter');
}

/**
 * Start command capture with mock overrides combined.
 * Captures all commands AND overrides specific ones.
 */
export async function startCommandCaptureWithMocks(
  page: Page,
  overrides: Record<string, unknown>
): Promise<void> {
  await page.evaluate((mocks) => {
    const originalInvoke = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__.invoke;

    (window as unknown as {
      __INVOKED_COMMANDS__: { command: string; args: unknown }[];
    }).__INVOKED_COMMANDS__ = [];

    (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
      (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__.push({ command, args });

      if (command in mocks) {
        const val = mocks[command];
        if (typeof val === 'object' && val !== null && '__error__' in val) {
          throw new Error((val as { __error__: string }).__error__);
        }
        return val;
      }
      return originalInvoke(command, args);
    };
  }, overrides);
}
