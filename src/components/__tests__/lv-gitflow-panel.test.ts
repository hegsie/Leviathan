/**
 * Tests for lv-gitflow-panel component.
 *
 * These render the REAL lv-gitflow-panel component, mock only the Tauri invoke
 * layer, and verify the actual component code calls the right commands and
 * renders the correct DOM.
 *
 * IMPORTANT: The __TAURI_INTERNALS__.invoke mock intercepts at the lowest
 * level. The `invokeCommand` wrapper in tauri-api.ts wraps successful returns
 * with { success: true, data } and catches thrown errors as { success: false,
 * error }. So our mock must return RAW data (not pre-wrapped) and throw to
 * simulate errors.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const invokeHistory: Array<{ command: string; args?: unknown }> = [];
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvGitflowPanel } from '../sidebar/lv-gitflow-panel.ts';
import type { Branch } from '../../types/git.types.ts';

// Import the actual component — registers <lv-gitflow-panel> custom element
import '../sidebar/lv-gitflow-panel.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

// Raw config objects returned at the invoke level (invokeCommand wraps them)
const DEFAULT_CONFIG = {
  initialized: true,
  masterBranch: 'main',
  developBranch: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
  supportPrefix: 'support/',
  versionTagPrefix: '',
};

const UNINIT_CONFIG = {
  initialized: false,
  masterBranch: '',
  developBranch: '',
  featurePrefix: '',
  releasePrefix: '',
  hotfixPrefix: '',
  supportPrefix: '',
  versionTagPrefix: '',
};

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    name: 'develop',
    shorthand: 'develop',
    isHead: true,
    isRemote: false,
    upstream: null,
    targetOid: 'abc123',
    isStale: false,
    ...overrides,
  };
}

const featureBranches: Branch[] = [
  makeBranch({ name: 'develop', shorthand: 'develop', isHead: true }),
  makeBranch({ name: 'feature/login', shorthand: 'feature/login', isHead: false, targetOid: 'f1' }),
  makeBranch({ name: 'feature/signup', shorthand: 'feature/signup', isHead: false, targetOid: 'f2' }),
];

const releaseBranches: Branch[] = [
  makeBranch({ name: 'develop', shorthand: 'develop', isHead: true }),
  makeBranch({ name: 'release/1.0.0', shorthand: 'release/1.0.0', isHead: false, targetOid: 'r1' }),
];

const hotfixBranches: Branch[] = [
  makeBranch({ name: 'develop', shorthand: 'develop', isHead: true }),
  makeBranch({ name: 'hotfix/1.0.1', shorthand: 'hotfix/1.0.1', isHead: false, targetOid: 'h1' }),
];

const allTypeBranches: Branch[] = [
  makeBranch({ name: 'develop', shorthand: 'develop', isHead: true }),
  makeBranch({ name: 'feature/login', shorthand: 'feature/login', isHead: false, targetOid: 'f1' }),
  makeBranch({ name: 'release/1.0.0', shorthand: 'release/1.0.0', isHead: false, targetOid: 'r1' }),
  makeBranch({ name: 'hotfix/1.0.1', shorthand: 'hotfix/1.0.1', isHead: false, targetOid: 'h1' }),
];

const emptyBranches: Branch[] = [
  makeBranch({ name: 'develop', shorthand: 'develop', isHead: true }),
];

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

/**
 * Setup mock invoke. Returns RAW data at the __TAURI_INTERNALS__ level.
 * invokeCommand wraps successful returns as { success: true, data }.
 * For errors, throw — invokeCommand wraps as { success: false, error }.
 */
function setupMocks(opts: {
  config?: typeof DEFAULT_CONFIG;
  branches?: Branch[];
} = {}): void {
  const config = opts.config ?? DEFAULT_CONFIG;
  const branches = opts.branches ?? emptyBranches;

  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_gitflow_config':
        return config;
      case 'get_branches':
        return branches;
      case 'init_gitflow':
        return DEFAULT_CONFIG;
      case 'gitflow_start_feature':
      case 'gitflow_start_release':
      case 'gitflow_start_hotfix':
        return makeBranch();
      case 'gitflow_finish_feature':
      case 'gitflow_finish_release':
      case 'gitflow_finish_hotfix':
        return null;
      default:
        return null;
    }
  };
}

async function renderPanel(): Promise<LvGitflowPanel> {
  const el = await fixture<LvGitflowPanel>(
    html`<lv-gitflow-panel .repositoryPath=${REPO_PATH}></lv-gitflow-panel>`
  );
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 100));
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-gitflow-panel', () => {
  beforeEach(() => {
    clearHistory();
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('shows feature, release, and hotfix sections when initialized', async () => {
      setupMocks({ branches: allTypeBranches });
      const el = await renderPanel();

      const sections = el.shadowRoot!.querySelectorAll('.section');
      expect(sections.length).to.equal(3);

      const sectionTitles = Array.from(el.shadowRoot!.querySelectorAll('.section-title'))
        .map((t) => t.textContent?.trim());
      expect(sectionTitles.some((t) => t?.includes('Feature'))).to.be.true;
      expect(sectionTitles.some((t) => t?.includes('Release'))).to.be.true;
      expect(sectionTitles.some((t) => t?.includes('Hotfix'))).to.be.true;
    });

    it('shows branch counts next to section labels', async () => {
      setupMocks({ branches: allTypeBranches });
      const el = await renderPanel();

      const sectionHeaders = el.shadowRoot!.querySelectorAll('.section-header');
      expect(sectionHeaders[0].textContent).to.include('(1)');
      expect(sectionHeaders[1].textContent).to.include('(1)');
      expect(sectionHeaders[2].textContent).to.include('(1)');
    });

    it('shows multiple feature branches with correct count', async () => {
      setupMocks({ branches: featureBranches });
      const el = await renderPanel();

      const sectionHeaders = el.shadowRoot!.querySelectorAll('.section-header');
      expect(sectionHeaders[0].textContent).to.include('(2)');

      const items = el.shadowRoot!.querySelectorAll('.item-name');
      const itemNames = Array.from(items).map((i) => i.textContent?.trim());
      expect(itemNames).to.include('login');
      expect(itemNames).to.include('signup');
    });

    it('shows config summary with master, develop, and prefix values', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();

      const configSummary = el.shadowRoot!.querySelector('.config-summary');
      expect(configSummary).to.not.be.null;

      const configValues = Array.from(el.shadowRoot!.querySelectorAll('.config-value'))
        .map((v) => v.textContent?.trim());
      expect(configValues).to.include('main');
      expect(configValues).to.include('develop');
      expect(configValues).to.include('feature/*');
      expect(configValues).to.include('release/*');
      expect(configValues).to.include('hotfix/*');
    });
  });

  // ── Section toggle ─────────────────────────────────────────────────────
  describe('section toggle', () => {
    it('collapses a section when clicking its header', async () => {
      setupMocks({ branches: featureBranches });
      const el = await renderPanel();

      let featureItems = el.shadowRoot!.querySelectorAll('.item');
      expect(featureItems.length).to.be.greaterThan(0);

      const sectionHeaders = el.shadowRoot!.querySelectorAll('.section-header');
      (sectionHeaders[0] as HTMLElement).click();
      await el.updateComplete;

      const icon = el.shadowRoot!.querySelector('.section-icon');
      expect(icon?.classList.contains('collapsed')).to.be.true;

      featureItems = el.shadowRoot!.querySelectorAll('.item');
      expect(featureItems.length).to.equal(0);
    });

    it('re-expands a collapsed section on second click', async () => {
      setupMocks({ branches: featureBranches });
      const el = await renderPanel();

      const sectionHeaders = el.shadowRoot!.querySelectorAll('.section-header');
      const featureHeader = sectionHeaders[0] as HTMLElement;

      featureHeader.click();
      await el.updateComplete;
      featureHeader.click();
      await el.updateComplete;

      const icon = el.shadowRoot!.querySelector('.section-icon');
      expect(icon?.classList.contains('collapsed')).to.be.false;

      const featureItems = el.shadowRoot!.querySelectorAll('.item');
      expect(featureItems.length).to.be.greaterThan(0);
    });
  });

  // ── GitFlow init detection ─────────────────────────────────────────────
  describe('gitflow init detection', () => {
    it('shows Initialize Git Flow button when not initialized', async () => {
      setupMocks({ config: UNINIT_CONFIG });
      const el = await renderPanel();

      const initBtn = el.shadowRoot!.querySelector('.btn-primary');
      expect(initBtn).to.not.be.null;
      expect(initBtn!.textContent?.trim()).to.equal('Initialize Git Flow');
    });

    it('shows init description text when not initialized', async () => {
      setupMocks({ config: UNINIT_CONFIG });
      const el = await renderPanel();

      const desc = el.shadowRoot!.querySelector('.init-description');
      expect(desc).to.not.be.null;
      expect(desc!.textContent).to.include('not initialized');
    });

    it('does NOT show init section when already initialized', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();

      const initSection = el.shadowRoot!.querySelector('.init-section');
      expect(initSection).to.be.null;
    });

    it('calls init_gitflow when Initialize button is clicked', async () => {
      let initCalled = false;
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_gitflow_config':
            return initCalled ? DEFAULT_CONFIG : UNINIT_CONFIG;
          case 'init_gitflow':
            initCalled = true;
            return DEFAULT_CONFIG;
          case 'get_branches':
            return emptyBranches;
          default:
            return null;
        }
      };

      const el = await renderPanel();
      clearHistory();

      const initBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      initBtn.click();

      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      const initCalls = findCommands('init_gitflow');
      expect(initCalls.length).to.equal(1);
      expect((initCalls[0].args as Record<string, unknown>).path).to.equal(REPO_PATH);
    });

    it('dispatches gitflow-initialized event on successful init', async () => {
      let initCalled = false;
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_gitflow_config':
            return initCalled ? DEFAULT_CONFIG : UNINIT_CONFIG;
          case 'init_gitflow':
            initCalled = true;
            return DEFAULT_CONFIG;
          case 'get_branches':
            return emptyBranches;
          default:
            return null;
        }
      };

      const el = await renderPanel();

      let eventFired = false;
      el.addEventListener('gitflow-initialized', () => { eventFired = true; });

      const initBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      initBtn.click();

      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      expect(eventFired).to.be.true;
    });
  });

  // ── Start operations ───────────────────────────────────────────────────
  describe('start operations', () => {
    it('calls gitflow_start_feature when New Feature action button is clicked', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();
      clearHistory();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => 'my-feature';

      try {
        const actionBtns = el.shadowRoot!.querySelectorAll('.action-btn');
        (actionBtns[0] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 150));
        await el.updateComplete;

        const calls = findCommands('gitflow_start_feature');
        expect(calls.length).to.equal(1);
        expect((calls[0].args as Record<string, unknown>).path).to.equal(REPO_PATH);
        expect((calls[0].args as Record<string, unknown>).name).to.equal('my-feature');
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });

    it('calls gitflow_start_release when New Release action button is clicked', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();
      clearHistory();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => '2.0.0';

      try {
        const actionBtns = el.shadowRoot!.querySelectorAll('.action-btn');
        (actionBtns[1] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 150));
        await el.updateComplete;

        const calls = findCommands('gitflow_start_release');
        expect(calls.length).to.equal(1);
        expect((calls[0].args as Record<string, unknown>).path).to.equal(REPO_PATH);
        expect((calls[0].args as Record<string, unknown>).version).to.equal('2.0.0');
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });

    it('calls gitflow_start_hotfix when New Hotfix action button is clicked', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();
      clearHistory();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => '1.0.2';

      try {
        const actionBtns = el.shadowRoot!.querySelectorAll('.action-btn');
        (actionBtns[2] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 150));
        await el.updateComplete;

        const calls = findCommands('gitflow_start_hotfix');
        expect(calls.length).to.equal(1);
        expect((calls[0].args as Record<string, unknown>).path).to.equal(REPO_PATH);
        expect((calls[0].args as Record<string, unknown>).version).to.equal('1.0.2');
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });

    it('does NOT call start when prompt is cancelled (returns null)', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();
      clearHistory();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => null;

      try {
        const actionBtns = el.shadowRoot!.querySelectorAll('.action-btn');
        (actionBtns[0] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 100));
        await el.updateComplete;

        expect(findCommands('gitflow_start_feature').length).to.equal(0);
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });

    it('dispatches gitflow-operation event on successful start feature', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => 'new-feat';

      let eventDetail: unknown = null;
      el.addEventListener('gitflow-operation', ((e: CustomEvent) => {
        eventDetail = e.detail;
      }) as EventListener);

      try {
        const actionBtns = el.shadowRoot!.querySelectorAll('.action-btn');
        (actionBtns[0] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 150));
        await el.updateComplete;

        expect(eventDetail).to.deep.equal({ type: 'start-feature', name: 'new-feat' });
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });
  });

  // ── Finish operations ──────────────────────────────────────────────────
  describe('finish operations', () => {
    it('calls gitflow_finish_feature when finish button is clicked on a feature', async () => {
      setupMocks({ branches: featureBranches });
      const el = await renderPanel();
      clearHistory();

      const finishBtns = el.shadowRoot!.querySelectorAll('.item-finish-btn');
      expect(finishBtns.length).to.be.greaterThan(0);

      (finishBtns[0] as HTMLButtonElement).click();

      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      const calls = findCommands('gitflow_finish_feature');
      expect(calls.length).to.equal(1);
      const args = calls[0].args as Record<string, unknown>;
      expect(args.path).to.equal(REPO_PATH);
      expect(args.name).to.equal('login');
      expect(args.deleteBranch).to.equal(true);
      expect(args.squash).to.equal(false);
    });

    it('calls gitflow_finish_release when finish button is clicked on a release', async () => {
      setupMocks({ branches: releaseBranches });
      const el = await renderPanel();
      clearHistory();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => 'Release 1.0.0';

      try {
        const finishBtns = el.shadowRoot!.querySelectorAll('.item-finish-btn');
        expect(finishBtns.length).to.be.greaterThan(0);

        (finishBtns[0] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 150));
        await el.updateComplete;

        const calls = findCommands('gitflow_finish_release');
        expect(calls.length).to.equal(1);
        const args = calls[0].args as Record<string, unknown>;
        expect(args.path).to.equal(REPO_PATH);
        expect(args.version).to.equal('1.0.0');
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });

    it('calls gitflow_finish_hotfix when finish button is clicked on a hotfix', async () => {
      setupMocks({ branches: hotfixBranches });
      const el = await renderPanel();
      clearHistory();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => 'Hotfix 1.0.1';

      try {
        const finishBtns = el.shadowRoot!.querySelectorAll('.item-finish-btn');
        expect(finishBtns.length).to.be.greaterThan(0);

        (finishBtns[0] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 150));
        await el.updateComplete;

        const calls = findCommands('gitflow_finish_hotfix');
        expect(calls.length).to.equal(1);
        const args = calls[0].args as Record<string, unknown>;
        expect(args.path).to.equal(REPO_PATH);
        expect(args.version).to.equal('1.0.1');
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });

    it('dispatches gitflow-operation event on successful finish feature', async () => {
      setupMocks({ branches: featureBranches });
      const el = await renderPanel();

      let eventDetail: unknown = null;
      el.addEventListener('gitflow-operation', ((e: CustomEvent) => {
        eventDetail = e.detail;
      }) as EventListener);

      const finishBtns = el.shadowRoot!.querySelectorAll('.item-finish-btn');
      (finishBtns[0] as HTMLButtonElement).click();

      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      expect(eventDetail).to.deep.equal({ type: 'finish-feature', name: 'login' });
    });

    it('does NOT call finish release when prompt is cancelled', async () => {
      setupMocks({ branches: releaseBranches });
      const el = await renderPanel();
      clearHistory();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => null;

      try {
        const finishBtns = el.shadowRoot!.querySelectorAll('.item-finish-btn');
        (finishBtns[0] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 100));
        await el.updateComplete;

        expect(findCommands('gitflow_finish_release').length).to.equal(0);
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────
  describe('error handling', () => {
    it('shows init section when config load returns failure', async () => {
      // When get_gitflow_config throws, invokeCommand catches it and returns
      // { success: false }. loadConfig sees !result.success, sets config=null,
      // so the init section renders.
      mockInvoke = async (command: string) => {
        if (command === 'get_gitflow_config') {
          throw new Error('Config load failed');
        }
        return null;
      };

      const el = await renderPanel();

      const initSection = el.shadowRoot!.querySelector('.init-section');
      expect(initSection).to.not.be.null;
    });

    it('shows error when init_gitflow fails', async () => {
      // When init_gitflow throws, invokeCommand returns { success: false,
      // error: { message: '...' } }. Component sets this.error to the message.
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_gitflow_config':
            return UNINIT_CONFIG;
          case 'init_gitflow':
            throw new Error('Init failed: no main branch');
          default:
            return null;
        }
      };

      const el = await renderPanel();

      const initBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      initBtn.click();

      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      const errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.not.be.null;
      expect(errorEl!.textContent).to.include('Init failed: no main branch');
    });

    it('shows error when start feature fails', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_gitflow_config':
            return DEFAULT_CONFIG;
          case 'get_branches':
            return emptyBranches;
          case 'gitflow_start_feature':
            throw new Error('Branch already exists');
          default:
            return null;
        }
      };

      const el = await renderPanel();

      const originalPrompt = globalThis.prompt;
      globalThis.prompt = () => 'duplicate';

      try {
        const actionBtns = el.shadowRoot!.querySelectorAll('.action-btn');
        (actionBtns[0] as HTMLButtonElement).click();

        await new Promise((r) => setTimeout(r, 150));
        await el.updateComplete;

        const errorEl = el.shadowRoot!.querySelector('.error');
        expect(errorEl).to.not.be.null;
        expect(errorEl!.textContent).to.include('Branch already exists');
      } finally {
        globalThis.prompt = originalPrompt;
      }
    });

    it('shows error when finish feature fails', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_gitflow_config':
            return DEFAULT_CONFIG;
          case 'get_branches':
            return featureBranches;
          case 'gitflow_finish_feature':
            throw new Error('Merge conflict');
          default:
            return null;
        }
      };

      const el = await renderPanel();

      const finishBtns = el.shadowRoot!.querySelectorAll('.item-finish-btn');
      (finishBtns[0] as HTMLButtonElement).click();

      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      const errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.not.be.null;
      expect(errorEl!.textContent).to.include('Merge conflict');
    });
  });

  // ── Loading state ──────────────────────────────────────────────────────
  describe('loading state', () => {
    it('shows loading indicator during initial fetch', async () => {
      let resolveConfig: ((value: unknown) => void) | null = null;
      mockInvoke = (command: string) => {
        if (command === 'get_gitflow_config') {
          return new Promise((resolve) => {
            resolveConfig = resolve;
          });
        }
        if (command === 'get_branches') {
          return Promise.resolve(emptyBranches);
        }
        return Promise.resolve(null);
      };

      const el = await fixture<LvGitflowPanel>(
        html`<lv-gitflow-panel .repositoryPath=${REPO_PATH}></lv-gitflow-panel>`
      );
      await el.updateComplete;

      const loadingEl = el.shadowRoot!.querySelector('.loading');
      expect(loadingEl).to.not.be.null;
      expect(loadingEl!.textContent).to.include('Loading Git Flow');

      // Resolve so the component finishes cleanly
      resolveConfig!(DEFAULT_CONFIG);
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;
    });

    it('removes loading indicator after fetch completes', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();

      const loadingEl = el.shadowRoot!.querySelector('.loading');
      expect(loadingEl).to.be.null;
    });
  });

  // ── Empty state ────────────────────────────────────────────────────────
  describe('empty state', () => {
    it('shows "No active items" for sections with no branches', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();

      const emptySections = el.shadowRoot!.querySelectorAll('.empty-section');
      expect(emptySections.length).to.equal(3);

      Array.from(emptySections).forEach((section) => {
        expect(section.textContent).to.include('No active items');
      });
    });

    it('shows empty for hotfixes but items for features', async () => {
      setupMocks({ branches: featureBranches });
      const el = await renderPanel();

      const featureItems = el.shadowRoot!.querySelectorAll('.item');
      expect(featureItems.length).to.equal(2);

      const emptySections = el.shadowRoot!.querySelectorAll('.empty-section');
      expect(emptySections.length).to.equal(2);
    });
  });

  // ── Refresh ────────────────────────────────────────────────────────────
  describe('refresh', () => {
    it('public refresh() method reloads config and branches', async () => {
      setupMocks({ branches: emptyBranches });
      const el = await renderPanel();
      clearHistory();

      setupMocks({ branches: featureBranches });
      await el.refresh();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const configCalls = findCommands('get_gitflow_config');
      expect(configCalls.length).to.be.greaterThan(0);

      const items = el.shadowRoot!.querySelectorAll('.item');
      expect(items.length).to.equal(2);
    });
  });
});
