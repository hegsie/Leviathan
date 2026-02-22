/**
 * Tests for lv-context-dashboard component.
 *
 * Renders the REAL lv-context-dashboard component, mocking only the Tauri
 * invoke layer and Zustand stores, then verifies DOM output and interactions.
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
import { unifiedProfileStore } from '../../../stores/unified-profile.store.ts';
import { repositoryStore } from '../../../stores/repository.store.ts';
import type { UnifiedProfile, IntegrationAccount } from '../../../types/unified-profile.types.ts';
import type { Repository, Branch, Remote } from '../../../types/git.types.ts';
import type { LvContextDashboard } from '../lv-context-dashboard.ts';

// Import the actual component — registers <lv-context-dashboard> custom element
import '../lv-context-dashboard.ts';

// ── Constants ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'lv-context-dashboard-expanded';

// ── Test data ──────────────────────────────────────────────────────────────
function makeProfile(overrides: Partial<UnifiedProfile> = {}): UnifiedProfile {
  return {
    id: 'profile-1',
    name: 'Work',
    gitName: 'John Doe',
    gitEmail: 'john@work.com',
    signingKey: null,
    urlPatterns: [],
    isDefault: false,
    color: '#3b82f6',
    defaultAccounts: {},
    ...overrides,
  };
}

function makeAccount(overrides: Partial<IntegrationAccount> = {}): IntegrationAccount {
  return {
    id: 'account-1',
    name: 'Work GitHub',
    integrationType: 'github',
    config: { type: 'github' },
    color: null,
    cachedUser: null,
    urlPatterns: [],
    isDefault: false,
    ...overrides,
  };
}

function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    path: '/test/repo',
    name: 'my-repo',
    isValid: true,
    isBare: false,
    headRef: 'refs/heads/main',
    state: 'clean',
    ...overrides,
  };
}

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    name: 'main',
    shorthand: 'main',
    isHead: true,
    isRemote: false,
    upstream: null,
    targetOid: 'abc123',
    isStale: false,
    ...overrides,
  };
}

function makeRemote(overrides: Partial<Remote> = {}): Remote {
  return {
    name: 'origin',
    url: 'https://github.com/user/repo.git',
    pushUrl: null,
    ...overrides,
  };
}

const defaultProfile = makeProfile();
const defaultAccount = makeAccount();
const defaultRepo = makeRepository();
const defaultBranch = makeBranch();
const defaultRemote = makeRemote();

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function setupStores(opts: {
  profile?: UnifiedProfile | null;
  profiles?: UnifiedProfile[];
  accounts?: IntegrationAccount[];
  repository?: Repository | null;
  currentBranch?: Branch | null;
  remotes?: Remote[];
  repositoryAssignments?: Record<string, string>;
} = {}): void {
  const profile = opts.profile !== undefined ? opts.profile : defaultProfile;
  const profiles = opts.profiles ?? (profile ? [profile] : []);
  const accounts = opts.accounts ?? [defaultAccount];
  const repository = opts.repository !== undefined ? opts.repository : defaultRepo;
  const currentBranch = opts.currentBranch !== undefined ? opts.currentBranch : defaultBranch;
  const remotes = opts.remotes ?? [defaultRemote];
  const repositoryAssignments = opts.repositoryAssignments ?? {};

  // Set up unified profile store
  const profileState = unifiedProfileStore.getState();
  profileState.setActiveProfile(profile);
  profileState.setProfiles(profiles);
  profileState.setAccounts(accounts);
  profileState.setConfig({
    version: 3,
    profiles,
    accounts,
    repositoryAssignments,
  });

  // Set up repository store
  if (repository) {
    const repoState = repositoryStore.getState();
    repoState.addRepository(repository);
    // Update the active repo data
    repoState.setCurrentBranch(currentBranch);
    repoState.setRemotes(remotes);
  }
}

function teardownStores(): void {
  unifiedProfileStore.getState().reset();
  repositoryStore.getState().reset();
}

async function renderDashboard(): Promise<LvContextDashboard> {
  const el = await fixture<LvContextDashboard>(
    html`<lv-context-dashboard></lv-context-dashboard>`
  );
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-context-dashboard', () => {
  beforeEach(() => {
    clearHistory();
    mockInvoke = async () => null;
    // Ensure the dashboard starts collapsed by clearing persisted expand state
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  });

  afterEach(() => {
    teardownStores();
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  });

  describe('rendering', () => {
    it('renders nothing when no active repository', async () => {
      // Set up profile store with a profile but no repository
      const profileState = unifiedProfileStore.getState();
      profileState.setActiveProfile(defaultProfile);
      profileState.setProfiles([defaultProfile]);
      profileState.setAccounts([defaultAccount]);

      const el = await renderDashboard();
      // The component returns nothing when no active repository
      const compact = el.shadowRoot!.querySelector('.dashboard-compact');
      const expanded = el.shadowRoot!.querySelector('.dashboard-expanded');
      expect(compact).to.be.null;
      expect(expanded).to.be.null;
    });

    it('renders compact view by default', async () => {
      setupStores();
      const el = await renderDashboard();

      const compact = el.shadowRoot!.querySelector('.dashboard-compact');
      expect(compact).to.not.be.null;

      const expanded = el.shadowRoot!.querySelector('.dashboard-expanded');
      expect(expanded).to.be.null;
    });

    it('displays profile name in compact view', async () => {
      setupStores();
      const el = await renderDashboard();

      const profileName = el.shadowRoot!.querySelector('.profile-name');
      expect(profileName).to.not.be.null;
      expect(profileName!.textContent).to.include('Work');
    });

    it('displays git identity in compact view', async () => {
      setupStores();
      const el = await renderDashboard();

      const identity = el.shadowRoot!.querySelector('.compact-identity');
      expect(identity).to.not.be.null;
      expect(identity!.textContent).to.include('John Doe');
      expect(identity!.textContent).to.include('john@work.com');
    });

    it('shows profile color dot in compact view', async () => {
      setupStores();
      const el = await renderDashboard();

      const dot = el.shadowRoot!.querySelector('.profile-dot') as HTMLElement;
      expect(dot).to.not.be.null;
      // Browser converts hex to rgb
      const bg = dot.style.background;
      expect(bg === '#3b82f6' || bg.includes('rgb(59, 130, 246)')).to.be.true;
    });
  });

  describe('expand/collapse', () => {
    it('toggles to expanded view when expand button is clicked', async () => {
      setupStores();
      const el = await renderDashboard();

      // Verify starts compact
      expect(el.shadowRoot!.querySelector('.dashboard-compact')).to.not.be.null;

      // Click expand button
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expect(expandBtn).to.not.be.null;
      expandBtn.click();
      await el.updateComplete;

      const expanded = el.shadowRoot!.querySelector('.dashboard-expanded');
      expect(expanded).to.not.be.null;
    });

    it('shows dashboard title in expanded view', async () => {
      setupStores();
      const el = await renderDashboard();

      // Expand
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expandBtn.click();
      await el.updateComplete;

      const title = el.shadowRoot!.querySelector('.dashboard-title');
      expect(title).to.not.be.null;
      expect(title!.textContent).to.include('Repository Context');
    });

    it('renders profile card in expanded view', async () => {
      setupStores();
      const el = await renderDashboard();

      // Expand
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expandBtn.click();
      await el.updateComplete;

      const profileCard = el.shadowRoot!.querySelector('lv-profile-card');
      expect(profileCard).to.not.be.null;
    });

    it('renders repository card in expanded view', async () => {
      setupStores();
      const el = await renderDashboard();

      // Expand
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expandBtn.click();
      await el.updateComplete;

      const repoCard = el.shadowRoot!.querySelector('lv-repository-card');
      expect(repoCard).to.not.be.null;
    });

    it('renders integration card in expanded view when account exists', async () => {
      setupStores({
        accounts: [defaultAccount],
        profile: makeProfile({ defaultAccounts: { github: 'account-1' } }),
      });
      const el = await renderDashboard();

      // Expand
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expandBtn.click();
      await el.updateComplete;

      const integrationCard = el.shadowRoot!.querySelector('lv-integration-card');
      expect(integrationCard).to.not.be.null;
    });

    it('collapses back to compact view when collapse button is clicked', async () => {
      setupStores();
      const el = await renderDashboard();

      // Expand first
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expandBtn.click();
      await el.updateComplete;

      // Verify expanded
      expect(el.shadowRoot!.querySelector('.dashboard-expanded')).to.not.be.null;

      // Then collapse
      const collapseBtn = el.shadowRoot!.querySelector('.expand-btn.expanded') as HTMLButtonElement;
      expect(collapseBtn).to.not.be.null;
      collapseBtn.click();
      await el.updateComplete;

      const compact = el.shadowRoot!.querySelector('.dashboard-compact');
      expect(compact).to.not.be.null;
      const expanded = el.shadowRoot!.querySelector('.dashboard-expanded');
      expect(expanded).to.be.null;
    });

    it('persists expanded state to localStorage', async () => {
      setupStores();
      const el = await renderDashboard();

      // Expand
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expandBtn.click();
      await el.updateComplete;

      expect(localStorage.getItem(STORAGE_KEY)).to.equal('true');
    });
  });

  describe('provider detection', () => {
    it('shows account status dot for GitHub repos in compact view when connected', async () => {
      const ghAccount = makeAccount({ integrationType: 'github' });
      setupStores({
        accounts: [ghAccount],
        profile: makeProfile({ defaultAccounts: { github: ghAccount.id } }),
        remotes: [makeRemote({ url: 'https://github.com/user/repo.git' })],
      });
      // Set the account connection status to 'connected' so the dot (not Reconnect btn) is shown
      unifiedProfileStore.getState().setAccountConnectionStatus(ghAccount.id, 'connected');
      const el = await renderDashboard();

      // In compact view, a connected account shows account-status-btn with status dot
      const statusBtn = el.shadowRoot!.querySelector('.account-status-btn');
      expect(statusBtn).to.not.be.null;
      const dot = statusBtn!.querySelector('.account-status-dot');
      expect(dot).to.not.be.null;
      expect(dot!.classList.contains('connected')).to.be.true;
    });

    it('shows reconnect button for GitHub repos in compact view when disconnected', async () => {
      const ghAccount = makeAccount({ integrationType: 'github' });
      setupStores({
        accounts: [ghAccount],
        profile: makeProfile({ defaultAccounts: { github: ghAccount.id } }),
        remotes: [makeRemote({ url: 'https://github.com/user/repo.git' })],
      });
      // Disconnected/unknown status shows a "Reconnect" button instead of status dot
      unifiedProfileStore.getState().setAccountConnectionStatus(ghAccount.id, 'disconnected');
      const el = await renderDashboard();

      const configureBtn = el.shadowRoot!.querySelector('.configure-btn');
      expect(configureBtn).to.not.be.null;
      expect(configureBtn!.textContent).to.include('Reconnect');
    });

    it('shows configure button when provider detected but no account in compact view', async () => {
      setupStores({
        accounts: [],
        remotes: [makeRemote({ url: 'https://github.com/user/repo.git' })],
      });
      const el = await renderDashboard();

      const configureBtn = el.shadowRoot!.querySelector('.configure-btn');
      expect(configureBtn).to.not.be.null;
      expect(configureBtn!.textContent).to.include('Connect');
      expect(configureBtn!.textContent).to.include('GitHub');
    });

    it('shows configure card for GitLab repos without account in expanded view', async () => {
      setupStores({
        accounts: [],
        remotes: [makeRemote({ url: 'https://gitlab.com/user/repo.git' })],
      });
      const el = await renderDashboard();

      // Expand
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expandBtn.click();
      await el.updateComplete;

      const configureCard = el.shadowRoot!.querySelector('.configure-card');
      expect(configureCard).to.not.be.null;
      const cardTitle = el.shadowRoot!.querySelector('.configure-card-title');
      expect(cardTitle).to.not.be.null;
      expect(cardTitle!.textContent).to.include('GitLab');
    });

    it('detects Azure DevOps from remote URL', async () => {
      setupStores({
        accounts: [],
        remotes: [makeRemote({ url: 'https://dev.azure.com/org/project/_git/repo' })],
      });
      const el = await renderDashboard();

      const configureBtn = el.shadowRoot!.querySelector('.configure-btn');
      expect(configureBtn).to.not.be.null;
      expect(configureBtn!.textContent).to.include('Azure DevOps');
    });

    it('detects Bitbucket from remote URL', async () => {
      setupStores({
        accounts: [],
        remotes: [makeRemote({ url: 'https://bitbucket.org/team/repo.git' })],
      });
      const el = await renderDashboard();

      const configureBtn = el.shadowRoot!.querySelector('.configure-btn');
      expect(configureBtn).to.not.be.null;
      expect(configureBtn!.textContent).to.include('Bitbucket');
    });
  });

  describe('no profile state', () => {
    it('shows "No profile active" in compact view when no profile', async () => {
      setupStores({ profile: null, accounts: [] });
      const el = await renderDashboard();

      const noProfile = el.shadowRoot!.querySelector('.no-profile');
      expect(noProfile).to.not.be.null;
      expect(noProfile!.textContent).to.include('No profile active');
    });

    it('shows "Set up profile" button when no profile', async () => {
      setupStores({ profile: null, accounts: [] });
      const el = await renderDashboard();

      const setupBtn = el.shadowRoot!.querySelector('.no-profile-btn');
      expect(setupBtn).to.not.be.null;
      expect(setupBtn!.textContent).to.include('Set up profile');
    });

    it('dispatches open-profile-manager when "Set up profile" is clicked', async () => {
      setupStores({ profile: null, accounts: [] });
      const el = await renderDashboard();

      let eventFired = false;
      el.addEventListener('open-profile-manager', () => { eventFired = true; });

      const setupBtn = el.shadowRoot!.querySelector('.no-profile-btn') as HTMLButtonElement;
      expect(setupBtn).to.not.be.null;
      setupBtn.click();
      await el.updateComplete;

      expect(eventFired).to.be.true;
    });
  });

  describe('remote buttons', () => {
    it('renders fetch, pull, and push buttons in compact view', async () => {
      setupStores();
      const el = await renderDashboard();

      const remoteButtons = el.shadowRoot!.querySelectorAll('.remote-btn');
      expect(remoteButtons.length).to.equal(3);

      const buttonLabels = Array.from(remoteButtons).map((b) => b.textContent?.trim());
      expect(buttonLabels).to.include('Fetch');
      expect(buttonLabels).to.include('Pull');
      expect(buttonLabels).to.include('Push');
    });
  });

  describe('expand button aria', () => {
    it('has correct aria-expanded="false" when collapsed', async () => {
      setupStores();
      const el = await renderDashboard();

      // Ensure we're in compact view
      expect(el.shadowRoot!.querySelector('.dashboard-compact')).to.not.be.null;

      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expect(expandBtn.getAttribute('aria-expanded')).to.equal('false');
    });

    it('has correct aria-expanded="true" when expanded', async () => {
      setupStores();
      const el = await renderDashboard();

      // Expand
      const expandBtn = el.shadowRoot!.querySelector('.expand-btn') as HTMLButtonElement;
      expandBtn.click();
      await el.updateComplete;

      // In expanded view, the expand-btn has class "expanded"
      const collapseBtn = el.shadowRoot!.querySelector('.expand-btn.expanded') as HTMLButtonElement;
      expect(collapseBtn).to.not.be.null;
      expect(collapseBtn.getAttribute('aria-expanded')).to.equal('true');
    });
  });
});
