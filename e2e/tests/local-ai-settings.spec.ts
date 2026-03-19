import { test, expect, type Page } from '@playwright/test';
import { setupOpenRepository, withStagedFiles } from '../fixtures/tauri-mock';
import {
  startCommandCaptureWithMocks,
  injectCommandMock,
  injectCommandError,
  findCommand,
  waitForCommand,
} from '../fixtures/test-helpers';
import { RightPanelPage } from '../pages/panels.page';

// =========================================================================
// Shared mock data
// =========================================================================

const mockSystemCapabilities = {
  totalRamBytes: 16_000_000_000,
  availableRamBytes: 8_000_000_000,
  gpuInfo: {
    name: 'Apple M1',
    vendor: 'apple',
    vramBytes: null,
    metalSupported: true,
    cudaSupported: false,
  },
  recommendedTier: 'standard',
  gpuAccelerationAvailable: true,
};

const mockAvailableModels = [
  {
    id: 'gemma-3-1b-q4km',
    displayName: 'Gemma 3 1B (Q4_K_M)',
    hfRepo: 'unsloth/gemma-3-1b-it-GGUF',
    hfFilename: 'gemma-3-1b-it-Q4_K_M.gguf',
    sha256: '',
    sizeBytes: 700_000_000,
    minRamBytes: 8_000_000_000,
    tier: 'ultra_light',
    architecture: 'gemma3',
    contextLength: 8192,
  },
  {
    id: 'phi-4-mini-q4km',
    displayName: 'Phi-4 Mini 3.8B (Q4_K_M)',
    hfRepo: 'unsloth/Phi-4-mini-instruct-GGUF',
    hfFilename: 'Phi-4-mini-instruct-Q4_K_M.gguf',
    sha256: '',
    sizeBytes: 2_300_000_000,
    minRamBytes: 16_000_000_000,
    tier: 'standard',
    architecture: 'phi',
    contextLength: 4096,
  },
];

const mockDownloadedModel = {
  id: 'gemma-3-1b-q4km',
  displayName: 'Gemma 3 1B (Q4_K_M)',
  sizeBytes: 700_000_000,
  path: '/tmp/models/gemma-3-1b-q4km/model.gguf',
  status: 'downloaded',
};

const mockProvidersUnavailable = [
  {
    providerType: 'local_inference',
    name: 'Local AI (Embedded)',
    available: false,
    requiresApiKey: false,
    hasApiKey: false,
    endpoint: '',
    models: [],
    selectedModel: null,
  },
  {
    providerType: 'anthropic',
    name: 'Anthropic Claude',
    available: false,
    requiresApiKey: true,
    hasApiKey: false,
    endpoint: 'https://api.anthropic.com',
    models: [],
    selectedModel: null,
  },
];

const mockProvidersLocalAvailable = [
  {
    ...mockProvidersUnavailable[0],
    available: true,
    models: ['Gemma 3 1B (Q4_K_M)'],
  },
  mockProvidersUnavailable[1],
];

/** Build a base set of local AI mocks with overrides */
function localAiMocks(overrides: Record<string, unknown> = {}) {
  return {
    get_ai_providers: mockProvidersUnavailable,
    get_active_ai_provider: null,
    get_system_capabilities: mockSystemCapabilities,
    get_available_models: mockAvailableModels,
    get_downloaded_models: [],
    get_recommended_model: mockAvailableModels[0],
    get_model_status: 'unloaded',
    get_loaded_model_name: null,
    is_ai_available: false,
    ...overrides,
  };
}

/** Open the settings dialog via keyboard shortcut */
async function openSettings(page: Page) {
  await page.keyboard.press('Meta+,');
  await expect(page.locator('lv-settings-dialog')).toBeVisible();
}

/** Force the commit panel to re-check AI availability */
async function refreshCommitPanelAi(page: Page) {
  await page.locator('lv-commit-panel').evaluate(async (el: unknown) => {
    const panel = el as { checkAiAvailability?: () => Promise<void>; updateComplete?: Promise<boolean> };
    if (typeof panel.checkAiAvailability === 'function') {
      await panel.checkAiAvailability();
      await panel.updateComplete;
    }
  });
}

// =========================================================================
// Settings Dialog: Local AI Section
// =========================================================================

test.describe('Settings Dialog — Local AI', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('provider dropdown shows Unavailable when no model loaded', async ({ page }) => {
    await injectCommandMock(page, localAiMocks());
    await openSettings(page);

    const option = page.locator('lv-settings-dialog select option[value="local_inference"]');
    await expect(option).toContainText('Unavailable');
  });

  test('provider dropdown shows Available when model is loaded', async ({ page }) => {
    await injectCommandMock(page, localAiMocks({
      get_ai_providers: mockProvidersLocalAvailable,
      get_downloaded_models: [mockDownloadedModel],
      get_model_status: 'ready',
      get_loaded_model_name: 'Gemma 3 1B (Q4_K_M)',
      is_ai_available: true,
    }));
    await openSettings(page);

    const option = page.locator('lv-settings-dialog select option[value="local_inference"]');
    await expect(option).toContainText('Available');
  });

  test('shows Download button for models not yet downloaded', async ({ page }) => {
    await injectCommandMock(page, localAiMocks());
    await openSettings(page);

    // Use tier text to distinguish from recommended section
    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await expect(modelRow).toBeVisible();
    await expect(modelRow.getByRole('button', { name: 'Download' })).toBeVisible();
  });

  test('shows Load button for downloaded but unloaded model', async ({ page }) => {
    await injectCommandMock(page, localAiMocks({
      get_downloaded_models: [mockDownloadedModel],
    }));
    await openSettings(page);

    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await expect(modelRow.getByRole('button', { name: 'Load' })).toBeVisible();
    await expect(modelRow.locator('.status-indicator')).toContainText('Downloaded');
  });

  test('shows Loaded status and Unload button for loaded model', async ({ page }) => {
    await injectCommandMock(page, localAiMocks({
      get_ai_providers: mockProvidersLocalAvailable,
      get_downloaded_models: [mockDownloadedModel],
      get_model_status: 'ready',
      get_loaded_model_name: 'Gemma 3 1B (Q4_K_M)',
    }));
    await openSettings(page);

    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await expect(modelRow.getByRole('button', { name: 'Unload' })).toBeVisible();
    await expect(modelRow.locator('.status-indicator.configured')).toContainText('Loaded');
  });

  test('shows Loading state immediately after clicking Load', async ({ page }) => {
    // Use a stateful mock that makes load_model hang so we can observe loading state
    await page.evaluate((mocks) => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command in mocks) return mocks[command];
        if (command === 'load_model') {
          // Never resolve — simulates a slow load
          return new Promise(() => {});
        }
        return originalInvoke(command, args);
      };
    }, localAiMocks({ get_downloaded_models: [mockDownloadedModel] }));

    await openSettings(page);

    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await modelRow.getByRole('button', { name: 'Load' }).click();

    // Should show Loading... state
    await expect(modelRow.locator('.status-indicator')).toContainText('Loading');
  });

  test('Load button calls load_model with correct model ID', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      ...localAiMocks({ get_downloaded_models: [mockDownloadedModel] }),
      load_model: null,
    });
    await openSettings(page);

    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await modelRow.getByRole('button', { name: 'Load' }).click();

    const cmds = await findCommand(page, 'load_model');
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds[0].args).toEqual(expect.objectContaining({ modelId: 'gemma-3-1b-q4km' }));
  });

  test('Unload button calls unload_model', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      ...localAiMocks({
        get_ai_providers: mockProvidersLocalAvailable,
        get_downloaded_models: [mockDownloadedModel],
        get_model_status: 'ready',
      get_loaded_model_name: 'Gemma 3 1B (Q4_K_M)',
      }),
      unload_model: null,
    });
    await openSettings(page);

    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await modelRow.getByRole('button', { name: 'Unload' }).click();

    const cmds = await findCommand(page, 'unload_model');
    expect(cmds.length).toBeGreaterThan(0);
  });

  test('provider dropdown refreshes after loading model', async ({ page }) => {
    // Stateful mock: providers switch to available after load_model completes
    await page.evaluate((mocks) => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'load_model') {
          (window as unknown as { __MODEL_LOADED__: boolean }).__MODEL_LOADED__ = true;
          return null;
        }
        if (command === 'get_ai_providers') {
          return (window as unknown as { __MODEL_LOADED__?: boolean }).__MODEL_LOADED__
            ? mocks.__providers_after
            : mocks.__providers_before;
        }
        if (command === 'get_model_status') {
          return (window as unknown as { __MODEL_LOADED__?: boolean }).__MODEL_LOADED__
            ? 'ready'
            : 'unloaded';
        }
        if (command === 'get_loaded_model_name') {
          return (window as unknown as { __MODEL_LOADED__?: boolean }).__MODEL_LOADED__
            ? 'Gemma 3 1B (Q4_K_M)'
            : null;
        }
        if (command === 'is_ai_available') {
          return !!(window as unknown as { __MODEL_LOADED__?: boolean }).__MODEL_LOADED__;
        }
        if (command in mocks) return mocks[command];
        return originalInvoke(command, args);
      };
    }, {
      ...localAiMocks({ get_downloaded_models: [mockDownloadedModel] }),
      __providers_before: mockProvidersUnavailable,
      __providers_after: mockProvidersLocalAvailable,
    });

    await openSettings(page);

    const option = page.locator('lv-settings-dialog select option[value="local_inference"]');
    await expect(option).toContainText('Unavailable');

    // Click Load
    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await modelRow.getByRole('button', { name: 'Load' }).click();

    // Dropdown should update to Available
    await expect(option).toContainText('Available');
  });

  test('shows error message when load fails', async ({ page }) => {
    await injectCommandMock(page, {
      ...localAiMocks({ get_downloaded_models: [mockDownloadedModel] }),
      load_model: { __error__: 'Failed to load model weights: out of memory' },
    });
    await openSettings(page);

    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await modelRow.getByRole('button', { name: 'Load' }).click();

    await expect(page.locator('lv-settings-dialog .error-text')).toBeVisible();
  });

  test('delete unloads model first when loaded', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      ...localAiMocks({
        get_ai_providers: mockProvidersLocalAvailable,
        get_downloaded_models: [mockDownloadedModel],
        get_model_status: 'ready',
      get_loaded_model_name: 'Gemma 3 1B (Q4_K_M)',
      }),
      unload_model: null,
      delete_model: null,
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });
    await openSettings(page);

    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await modelRow.getByRole('button', { name: 'Delete' }).click();

    const unloadCmds = await findCommand(page, 'unload_model');
    const deleteCmds = await findCommand(page, 'delete_model');
    expect(unloadCmds.length).toBeGreaterThan(0);
    expect(deleteCmds.length).toBeGreaterThan(0);
  });

  test('multiple downloaded models each show correct buttons', async ({ page }) => {
    const secondDownloaded = {
      id: 'phi-4-mini-q4km',
      displayName: 'Phi-4 Mini 3.8B (Q4_K_M)',
      sizeBytes: 2_300_000_000,
      path: '/tmp/models/phi-4-mini-q4km/model.gguf',
      status: 'downloaded',
    };
    await injectCommandMock(page, localAiMocks({
      get_downloaded_models: [mockDownloadedModel, secondDownloaded],
    }));
    await openSettings(page);

    // Both should show Load buttons since model status is 'unloaded'
    const loadButtons = page.locator('lv-settings-dialog .setting-row button', { hasText: 'Load' });
    await expect(loadButtons).toHaveCount(2);
  });
});

// =========================================================================
// Commit Panel: AI Generate Button
// =========================================================================

test.describe('Commit Panel — AI Generate Flow', () => {
  let rightPanel: RightPanelPage;

  test.beforeEach(async ({ page }) => {
    rightPanel = new RightPanelPage(page);
  });

  test('shows Configure AI when no provider is available', async ({ page }) => {
    await setupOpenRepository(page);

    // Default mocks have is_ai_available: false
    const btn = page.locator('lv-commit-panel .generate-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Configure AI');
  });

  test('shows Generate with AI when provider is available', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    await injectCommandMock(page, { is_ai_available: true });
    await refreshCommitPanelAi(page);

    const btn = page.locator('lv-commit-panel .generate-btn');
    await expect(btn).toContainText('Generate with AI');
  });

  test('Configure AI button opens settings dialog', async ({ page }) => {
    await setupOpenRepository(page);

    const btn = page.locator('lv-commit-panel .generate-btn');
    await expect(btn).toContainText('Configure AI');
    await btn.click();

    await expect(page.locator('lv-settings-dialog')).toBeVisible();
  });

  test('Generate button is disabled with no staged files', async ({ page }) => {
    await setupOpenRepository(page); // Default has no staged files

    await injectCommandMock(page, { is_ai_available: true });
    await refreshCommitPanelAi(page);

    const btn = page.locator('lv-commit-panel .generate-btn');
    await expect(btn).toContainText('Generate with AI');
    await expect(btn).toBeDisabled();
  });

  test('Generate button is enabled with staged files', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    await injectCommandMock(page, { is_ai_available: true });
    await refreshCommitPanelAi(page);

    const btn = page.locator('lv-commit-panel .generate-btn');
    await expect(btn).toContainText('Generate with AI');
    await expect(btn).toBeEnabled();
  });

  test('clicking Generate calls generate_commit_message and populates fields', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    await injectCommandMock(page, { is_ai_available: true });
    await refreshCommitPanelAi(page);

    await startCommandCaptureWithMocks(page, {
      generate_commit_message: { summary: 'feat: add user authentication', body: 'Implements JWT-based auth flow' },
      is_ai_available: true,
    });

    await rightPanel.aiGenerateButton.click();
    await waitForCommand(page, 'generate_commit_message');

    const genCmds = await findCommand(page, 'generate_commit_message');
    expect(genCmds.length).toBeGreaterThan(0);

    // Verify the commit message fields are populated
    await expect(rightPanel.commitMessage).toHaveValue(/add user authentication/);
  });

  test('shows Generating... spinner during generation', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    // Make generate_commit_message hang to observe spinner
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'is_ai_available') return true;
        if (command === 'generate_commit_message') return new Promise(() => {});
        return originalInvoke(command, args);
      };
    });

    await refreshCommitPanelAi(page);

    const btn = page.locator('lv-commit-panel .generate-btn');
    await btn.click();

    await expect(btn).toContainText('Generating');
    await expect(btn).toBeDisabled();
  });

  test('shows error when generation fails', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    await injectCommandMock(page, { is_ai_available: true });
    await refreshCommitPanelAi(page);

    await injectCommandError(page, 'generate_commit_message', 'No AI provider available');

    await rightPanel.aiGenerateButton.click();

    // Error should appear
    const errorEl = page.locator('lv-commit-panel .error, lv-commit-panel .generation-error');
    await expect(errorEl).toBeVisible({ timeout: 5000 });
  });

  test('does not overwrite existing message on generation failure', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    await injectCommandMock(page, { is_ai_available: true });
    await refreshCommitPanelAi(page);

    await rightPanel.commitMessage.fill('my manual commit message');

    await injectCommandError(page, 'generate_commit_message', 'Provider offline');

    await rightPanel.aiGenerateButton.click();

    // Wait for error to appear, then verify message wasn't overwritten
    const errorEl = page.locator('lv-commit-panel .error, lv-commit-panel .generation-error');
    await expect(errorEl).toBeVisible({ timeout: 5000 });
    await expect(rightPanel.commitMessage).toHaveValue('my manual commit message');
  });

  test('ai-settings-changed event re-enables Generate button', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    const btn = page.locator('lv-commit-panel .generate-btn');
    await expect(btn).toContainText('Configure AI');

    // Simulate: settings change makes AI available
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'is_ai_available') return true;
        return originalInvoke(command, args);
      };

      window.dispatchEvent(new CustomEvent('ai-settings-changed'));
    });

    await expect(btn).toContainText('Generate with AI');
  });
});

// =========================================================================
// Full Lifecycle: Download → Load → Generate
// =========================================================================

test.describe('Local AI Full Lifecycle', () => {
  test('complete flow: model downloaded → load → generate button enables', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    // Start with no model, AI unavailable
    const btn = page.locator('lv-commit-panel .generate-btn');
    await expect(btn).toContainText('Configure AI');

    // Set up stateful mock that transitions through states
    await page.evaluate((mocks) => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      const state = { loaded: false };

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        switch (command) {
          case 'load_model':
            state.loaded = true;
            return null;
          case 'is_ai_available':
            return state.loaded;
          case 'get_ai_providers':
            return state.loaded ? mocks.providersAfter : mocks.providersBefore;
          case 'get_model_status':
            return state.loaded ? 'ready' : 'unloaded';
          case 'get_loaded_model_name':
            return state.loaded ? 'Gemma 3 1B (Q4_K_M)' : null;
          case 'get_downloaded_models':
            return [mocks.downloadedModel];
          default:
            if (command in mocks.base) return mocks.base[command];
            return originalInvoke(command, args);
        }
      };
    }, {
      base: localAiMocks(),
      downloadedModel: mockDownloadedModel,
      providersBefore: mockProvidersUnavailable,
      providersAfter: mockProvidersLocalAvailable,
    });

    // Open settings and load the model
    await openSettings(page);
    const modelRow = page.locator('lv-settings-dialog .setting-row', { hasText: 'Ultra-Light' });
    await modelRow.getByRole('button', { name: 'Load' }).click();

    // Verify model shows as Loaded
    await expect(modelRow.locator('.status-indicator.configured')).toContainText('Loaded');

    // Provider dropdown should show Available
    const option = page.locator('lv-settings-dialog select option[value="local_inference"]');
    await expect(option).toContainText('Available');

    // Close settings
    await page.keyboard.press('Escape');

    // Commit panel should now show "Generate with AI"
    // The ai-settings-changed event was dispatched by loadModel service call
    // But since we mocked load_model directly, we need to dispatch it manually
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('ai-settings-changed'));
    });

    await expect(btn).toContainText('Generate with AI');
  });

  test('delayed model auto-load enables Generate button via polling', async ({ page }) => {
    // This simulates the real-world scenario:
    // 1. App starts, commit panel mounts, checks AI → unavailable (model still loading)
    // 2. Commit panel starts polling every 5s
    // 3. Backend finishes auto-loading model → is_ai_available returns true
    // 4. Next poll picks it up → button enables
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    const btn = page.locator('lv-commit-panel .generate-btn');
    // Initially AI is unavailable (simulating model not loaded yet)
    await expect(btn).toContainText('Configure AI');

    // Simulate: backend finishes auto-loading — is_ai_available now returns true
    await injectCommandMock(page, { is_ai_available: true });

    // The commit panel polls every 5s when AI is initially unavailable.
    // Wait for the poll to pick up the change.
    await expect(btn).toContainText('Generate with AI', { timeout: 10000 });
  });

  test('complete flow: load → generate → message populated', async ({ page }) => {
    await setupOpenRepository(
      page,
      withStagedFiles([{ path: 'src/main.ts', status: 'modified', isStaged: true, isConflicted: false }])
    );

    // Mock AI as available with a specific generated message
    await injectCommandMock(page, {
      is_ai_available: true,
      generate_commit_message: {
        summary: 'refactor: extract shared utilities',
        body: 'Moved common helpers into a shared module for reuse across components.',
      },
    });

    await refreshCommitPanelAi(page);

    const btn = page.locator('lv-commit-panel .generate-btn');
    await expect(btn).toContainText('Generate with AI');
    await expect(btn).toBeEnabled();

    await btn.click();

    // Wait for message to be populated
    const rightPanel = new RightPanelPage(page);
    await expect(rightPanel.commitMessage).toHaveValue(/extract shared utilities/);
  });
});
