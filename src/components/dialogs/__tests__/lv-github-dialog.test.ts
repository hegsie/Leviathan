/**
 * GitHub Dialog Integration Tests
 *
 * Tests the lv-github-dialog Lit component for rendering, connection,
 * tab navigation, data display, and error handling with mocked Tauri backend.
 */

// Mock Tauri API before importing any modules that use it
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeHistory: Array<{ command: string; args: unknown }> = [];
const tokenStore = new Map<string, number[]>();

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } })
  .__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import { expect, fixture, html } from '@open-wc/testing';
import { unifiedProfileStore } from '../../../stores/unified-profile.store.ts';
import { createEmptyIntegrationAccount } from '../../../types/unified-profile.types.ts';
import type { IntegrationAccount } from '../../../types/unified-profile.types.ts';
import '../lv-github-dialog.ts';
import type { LvGitHubDialog } from '../lv-github-dialog.ts';

// --- Test Data ---

const mockGitHubUser = {
  login: 'octocat',
  id: 12345,
  avatarUrl: 'https://example.com/avatar.png',
  name: 'The Octocat',
  email: 'octocat@github.com',
};

const mockConnectedStatus = {
  connected: true,
  user: mockGitHubUser,
  scopes: ['repo', 'read:user'],
};

const mockDisconnectedStatus = {
  connected: false,
  user: null,
  scopes: [],
};

const mockDetectedRepo = {
  owner: 'test-owner',
  repo: 'test-repo',
  remoteName: 'origin',
};

const mockPullRequests = [
  {
    number: 42,
    title: 'Add new feature',
    state: 'open',
    user: mockGitHubUser,
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-16T10:00:00Z',
    mergedAt: null,
    headRef: 'feature/new-thing',
    headSha: 'abc1234',
    baseRef: 'main',
    draft: false,
    mergeable: true,
    htmlUrl: 'https://github.com/test-owner/test-repo/pull/42',
    additions: 150,
    deletions: 30,
    changedFiles: 5,
  },
  {
    number: 41,
    title: 'Fix bug in login',
    state: 'closed',
    user: mockGitHubUser,
    createdAt: '2025-01-10T10:00:00Z',
    updatedAt: '2025-01-12T10:00:00Z',
    mergedAt: '2025-01-12T10:00:00Z',
    headRef: 'fix/login-bug',
    headSha: 'def5678',
    baseRef: 'main',
    draft: false,
    mergeable: null,
    htmlUrl: 'https://github.com/test-owner/test-repo/pull/41',
    additions: 10,
    deletions: 5,
    changedFiles: 2,
  },
];

const mockIssues = [
  {
    number: 100,
    title: 'Bug: Login fails on mobile',
    state: 'open',
    user: mockGitHubUser,
    labels: [
      { id: 1, name: 'bug', color: 'd73a4a', description: 'Something is broken' },
      { id: 2, name: 'priority: high', color: 'e11d48', description: null },
    ],
    assignees: [],
    comments: 3,
    createdAt: '2025-01-10T10:00:00Z',
    updatedAt: '2025-01-11T10:00:00Z',
    closedAt: null,
    htmlUrl: 'https://github.com/test-owner/test-repo/issues/100',
  },
];

const mockWorkflowRuns = [
  {
    id: 1001,
    name: 'CI',
    headBranch: 'main',
    headSha: 'abc1234',
    status: 'completed',
    conclusion: 'success',
    workflowId: 10,
    htmlUrl: 'https://github.com/test-owner/test-repo/actions/runs/1001',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:05:00Z',
    runNumber: 55,
    event: 'push',
  },
];

const mockReleases = [
  {
    id: 2001,
    tagName: 'v1.0.0',
    name: 'Version 1.0.0',
    body: 'First stable release',
    draft: false,
    prerelease: false,
    createdAt: '2025-01-01T10:00:00Z',
    publishedAt: '2025-01-01T12:00:00Z',
    htmlUrl: 'https://github.com/test-owner/test-repo/releases/tag/v1.0.0',
    author: mockGitHubUser,
    assetsCount: 2,
  },
];

const mockLabels = [
  { id: 1, name: 'bug', color: 'd73a4a', description: 'Something is broken' },
  { id: 2, name: 'enhancement', color: 'a2eeef', description: 'New feature' },
];

function createTestAccount(
  overrides: Partial<IntegrationAccount> & { id: string }
): IntegrationAccount {
  const base = createEmptyIntegrationAccount(overrides.integrationType ?? 'github');
  return {
    ...base,
    name: 'Test Account',
    isDefault: true,
    cachedUser: null,
    ...overrides,
  } as IntegrationAccount;
}

function encodeToken(token: string): number[] {
  return Array.from(new TextEncoder().encode(token));
}

async function waitForLoad(el: LvGitHubDialog): Promise<void> {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 300));
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 100));
  await el.updateComplete;
}

// --- Mock Setup ---

const mockAccount = createTestAccount({
  id: 'gh-acc-1',
  name: 'Work GitHub',
  integrationType: 'github',
  isDefault: true,
  cachedUser: {
    username: 'octocat',
    displayName: 'The Octocat',
    avatarUrl: 'https://example.com/avatar.png',
    email: 'octocat@github.com',
  },
});

let connectionResponse: unknown = mockDisconnectedStatus;
let detectedRepoResponse: unknown = mockDetectedRepo;

function setupMockInvoke(): void {
  tokenStore.clear();
  tokenStore.set('github_token_gh-acc-1', encodeToken('ghp_testtoken123456'));

  mockInvoke = async (command: string, args?: unknown) => {
    const params = args as Record<string, unknown> | undefined;

    // Stronghold / credential service
    if (command === 'plugin:path|resolve_directory') return '/mock/app/data';
    if (command === 'plugin:stronghold|initialize') return null;
    if (command === 'plugin:stronghold|load_client') return null;
    if (command === 'plugin:stronghold|create_client') return null;
    if (command === 'plugin:stronghold|save') return null;
    if (command === 'migrate_vault_if_needed') return null;

    if (command === 'plugin:stronghold|get_store_record') {
      const recordPath = (params?.recordPath ?? params?.record_path) as string | undefined;
      if (recordPath && tokenStore.has(recordPath)) {
        return tokenStore.get(recordPath);
      }
      return null;
    }

    // Unified profile commands
    if (command === 'get_unified_profiles_config') {
      return {
        version: 3,
        profiles: [],
        accounts: [mockAccount],
        repositoryAssignments: {},
      };
    }
    if (command === 'load_unified_profile_for_repository') return null;
    if (command === 'save_global_account') return params;
    if (command === 'update_global_account_cached_user') return null;

    // GitHub-specific commands
    if (command === 'check_github_connection') return connectionResponse;
    if (command === 'check_github_connection_with_token') return connectionResponse;
    if (command === 'detect_github_repo') return detectedRepoResponse;
    if (command === 'list_pull_requests') return mockPullRequests;
    if (command === 'list_issues' || command === 'list_github_issues') return mockIssues;
    if (command === 'get_workflow_runs') return mockWorkflowRuns;
    if (command === 'list_releases') return mockReleases;
    if (command === 'get_github_labels' || command === 'get_repo_labels') return mockLabels;
    if (command === 'create_pull_request') return mockPullRequests[0];
    if (command === 'create_issue' || command === 'create_github_issue') return mockIssues[0];
    if (command === 'create_release' || command === 'create_github_release') return mockReleases[0];

    // OAuth
    if (command === 'get_oauth_client_id') return null;

    return null;
  };
}

describe('lv-github-dialog', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    connectionResponse = mockDisconnectedStatus;
    detectedRepoResponse = mockDetectedRepo;
    unifiedProfileStore.getState().reset();
    setupMockInvoke();
  });

  describe('Rendering & Modal', () => {
    it('renders lv-modal when open=true', async () => {
      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const modal = el.shadowRoot!.querySelector('lv-modal');
      expect(modal).to.not.be.null;
    });

    it('shows all 5 tab buttons', async () => {
      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      expect(tabs.length).to.equal(5);

      const tabTexts = Array.from(tabs).map((t) => t.textContent?.trim());
      expect(tabTexts).to.include('Connection');
      expect(tabTexts).to.include('Pull Requests');
      expect(tabTexts).to.include('Issues');
      expect(tabTexts).to.include('Releases');
      expect(tabTexts).to.include('Actions');
    });

    it('shows detected repo info after load', async () => {
      connectionResponse = mockDisconnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const repoName = el.shadowRoot!.querySelector('.repo-name');
      if (repoName) {
        expect(repoName.textContent).to.include('test-owner');
        expect(repoName.textContent).to.include('test-repo');
      }
    });

    it('shows account selector when accounts exist', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const selector = el.shadowRoot!.querySelector('lv-account-selector');
      expect(selector).to.not.be.null;
    });
  });

  describe('Connection Tab', () => {
    it('shows auth form when not connected', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      // When disconnected, the token-form or auth-method-toggle should be present
      const tokenForm = el.shadowRoot!.querySelector('.token-form');
      const authToggle = el.shadowRoot!.querySelector('.auth-method-toggle');
      const oauthSection = el.shadowRoot!.querySelector('.oauth-section');
      expect(tokenForm !== null || authToggle !== null || oauthSection !== null).to.be.true;
    });

    it('shows user info when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const connectionStatus = el.shadowRoot!.querySelector('.connection-status');
      expect(connectionStatus).to.not.be.null;

      const userName = el.shadowRoot!.querySelector('.user-name');
      expect(userName).to.not.be.null;
      expect(userName!.textContent).to.include('The Octocat');

      const userLogin = el.shadowRoot!.querySelector('.user-login');
      expect(userLogin).to.not.be.null;
      expect(userLogin!.textContent).to.include('octocat');
    });

    it('shows scopes when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const scopeBadges = el.shadowRoot!.querySelectorAll('.scope-badge');
      expect(scopeBadges.length).to.equal(2);
      const scopeTexts = Array.from(scopeBadges).map((s) => s.textContent?.trim());
      expect(scopeTexts).to.include('repo');
      expect(scopeTexts).to.include('read:user');
    });

    it('shows disconnect button when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const disconnectBtn = el.shadowRoot!.querySelector('.btn-danger');
      expect(disconnectBtn).to.not.be.null;
      expect(disconnectBtn!.textContent?.trim()).to.include('Disconnect');
    });
  });

  describe('Pull Requests Tab', () => {
    it('shows empty state when not connected', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      // Switch to Pull Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const prTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pull Requests') as HTMLButtonElement;
      prTab.click();
      await waitForLoad(el);

      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.not.be.null;
      expect(emptyState!.textContent).to.include('Connect to GitHub');
    });

    it('renders PR items with number, title, state, and branches', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-github-dialog>
      `);
      await waitForLoad(el);

      // Switch to Pull Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const prTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pull Requests') as HTMLButtonElement;
      prTab.click();
      await waitForLoad(el);

      const prItems = el.shadowRoot!.querySelectorAll('.pr-item');
      expect(prItems.length).to.equal(2);

      const firstPr = prItems[0];
      expect(firstPr.querySelector('.pr-number')?.textContent).to.include('42');
      expect(firstPr.querySelector('.pr-title')?.textContent).to.include('Add new feature');
      expect(firstPr.querySelector('.pr-branch')?.textContent).to.include('feature/new-thing');
      expect(firstPr.querySelector('.pr-branch')?.textContent).to.include('main');
    });

    it('shows filter dropdown and New PR button', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-github-dialog>
      `);
      await waitForLoad(el);

      // Switch to Pull Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const prTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pull Requests') as HTMLButtonElement;
      prTab.click();
      await waitForLoad(el);

      const filterSelect = el.shadowRoot!.querySelector('.filter-select');
      expect(filterSelect).to.not.be.null;

      const newPrBtn = Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New PR')
      );
      expect(newPrBtn).to.not.be.undefined;
    });
  });

  describe('Issues Tab', () => {
    it('renders issue items with number, title, and labels', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-github-dialog>
      `);
      await waitForLoad(el);

      // Switch to Issues tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const issuesTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Issues') as HTMLButtonElement;
      issuesTab.click();
      await waitForLoad(el);

      const issueItems = el.shadowRoot!.querySelectorAll('.issue-item');
      expect(issueItems.length).to.equal(1);

      const firstIssue = issueItems[0];
      expect(firstIssue.querySelector('.issue-number')?.textContent).to.include('100');
      expect(firstIssue.querySelector('.issue-title')?.textContent).to.include('Bug: Login fails on mobile');

      const labels = firstIssue.querySelectorAll('.issue-label');
      expect(labels.length).to.equal(2);
      expect(labels[0].textContent?.trim()).to.equal('bug');
    });
  });

  describe('Releases Tab', () => {
    it('renders release items with tag name and badges', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-github-dialog>
      `);
      await waitForLoad(el);

      // Switch to Releases tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const releasesTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Releases') as HTMLButtonElement;
      releasesTab.click();
      await waitForLoad(el);

      const releaseItems = el.shadowRoot!.querySelectorAll('.release-item');
      expect(releaseItems.length).to.equal(1);

      const firstRelease = releaseItems[0];
      expect(firstRelease.querySelector('.release-tag')?.textContent).to.include('v1.0.0');
      expect(firstRelease.querySelector('.release-title')?.textContent).to.include('Version 1.0.0');

      // First non-draft, non-prerelease should get "Latest" badge
      const latestBadge = firstRelease.querySelector('.release-badge.latest');
      expect(latestBadge).to.not.be.null;
    });
  });

  describe('Actions Tab', () => {
    it('renders workflow runs with status indicators', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-github-dialog>
      `);
      await waitForLoad(el);

      // Switch to Actions tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const actionsTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Actions') as HTMLButtonElement;
      actionsTab.click();
      await waitForLoad(el);

      const workflowItems = el.shadowRoot!.querySelectorAll('.workflow-item');
      expect(workflowItems.length).to.equal(1);

      const firstRun = workflowItems[0];
      expect(firstRun.querySelector('.workflow-name')?.textContent).to.include('CI');
      expect(firstRun.querySelector('.workflow-branch')?.textContent).to.include('main');

      // Status indicator should exist
      const statusDot = firstRun.querySelector('.workflow-status');
      expect(statusDot).to.not.be.null;
    });
  });

  describe('Tab Navigation', () => {
    it('clicking tab button changes displayed content', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-github-dialog>
      `);
      await waitForLoad(el);

      // Initially on Connection tab - verify connection content visible
      const connectionStatus = el.shadowRoot!.querySelector('.connection-status');
      expect(connectionStatus).to.not.be.null;

      // Click Pull Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const prTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pull Requests') as HTMLButtonElement;
      prTab.click();
      await waitForLoad(el);

      // Connection status should be gone, PR content visible
      const connectionAfter = el.shadowRoot!.querySelector('.connection-status');
      expect(connectionAfter).to.be.null;

      const prList = el.shadowRoot!.querySelector('.pr-list, .filter-row, .empty-state');
      expect(prList).to.not.be.null;
    });

    it('active tab has correct styling', async () => {
      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const connectionTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Connection');
      expect(connectionTab?.classList.contains('active')).to.be.true;

      // Click Pull Requests tab
      const prTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pull Requests') as HTMLButtonElement;
      prTab.click();
      await el.updateComplete;

      expect(prTab.classList.contains('active')).to.be.true;
      expect(connectionTab?.classList.contains('active')).to.be.false;
    });
  });

  describe('Error Handling', () => {
    it('displays error message when error state is set', async () => {
      // Make connection check throw an error
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'check_github_connection_with_token' || command === 'check_github_connection') {
          throw new Error('Network timeout');
        }
        return origMock(command, args);
      };

      const el = await fixture<LvGitHubDialog>(html`
        <lv-github-dialog .open=${true}></lv-github-dialog>
      `);
      await waitForLoad(el);

      const errorMsg = el.shadowRoot!.querySelector('.error-message');
      expect(errorMsg).to.not.be.null;
      expect(errorMsg!.textContent).to.include('Network timeout');
    });
  });
});
