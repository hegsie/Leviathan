/**
 * GitLab Dialog Integration Tests
 *
 * Tests the lv-gitlab-dialog Lit component for rendering, connection,
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
import '../lv-gitlab-dialog.ts';
import type { LvGitLabDialog } from '../lv-gitlab-dialog.ts';

// --- Test Data ---

const mockGitLabUser = {
  id: 54321,
  username: 'gluser',
  name: 'GL User',
  avatarUrl: 'https://example.com/gl-avatar.png',
  webUrl: 'https://gitlab.com/gluser',
};

const mockConnectedStatus = {
  connected: true,
  user: mockGitLabUser,
  instanceUrl: 'https://gitlab.com',
};

const mockDisconnectedStatus = {
  connected: false,
  user: null,
  instanceUrl: 'https://gitlab.com',
};

const mockDetectedRepo = {
  instanceUrl: 'https://gitlab.com',
  projectPath: 'test-group/test-project',
  remoteName: 'origin',
};

const mockMergeRequests = [
  {
    iid: 15,
    title: 'Add CI pipeline config',
    description: 'Adds .gitlab-ci.yml',
    state: 'opened',
    author: mockGitLabUser,
    createdAt: '2025-01-15T10:00:00Z',
    sourceBranch: 'feature/ci-setup',
    targetBranch: 'main',
    draft: false,
    webUrl: 'https://gitlab.com/test-group/test-project/-/merge_requests/15',
  },
  {
    iid: 14,
    title: 'Fix deploy script',
    description: null,
    state: 'merged',
    author: mockGitLabUser,
    createdAt: '2025-01-10T10:00:00Z',
    sourceBranch: 'fix/deploy',
    targetBranch: 'main',
    draft: false,
    webUrl: 'https://gitlab.com/test-group/test-project/-/merge_requests/14',
  },
];

const mockIssues = [
  {
    iid: 42,
    title: 'Performance regression in API',
    description: 'API calls are slow',
    state: 'opened',
    author: mockGitLabUser,
    assignees: [],
    labels: ['bug', 'performance'],
    createdAt: '2025-01-12T10:00:00Z',
    webUrl: 'https://gitlab.com/test-group/test-project/-/issues/42',
  },
];

const mockPipelines = [
  {
    id: 1001,
    iid: 55,
    status: 'success',
    source: 'push',
    ref: 'main',
    sha: 'abc1234567890def',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:05:00Z',
    webUrl: 'https://gitlab.com/test-group/test-project/-/pipelines/1001',
  },
];

const mockLabels = ['bug', 'enhancement', 'performance'];

function createTestAccount(
  overrides: Partial<IntegrationAccount> & { id: string }
): IntegrationAccount {
  const base = createEmptyIntegrationAccount(overrides.integrationType ?? 'gitlab');
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

async function waitForLoad(el: LvGitLabDialog): Promise<void> {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
}

// --- Mock Setup ---

const mockAccount = createTestAccount({
  id: 'gl-acc-1',
  name: 'Work GitLab',
  integrationType: 'gitlab',
  config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
  isDefault: true,
  cachedUser: {
    username: 'gluser',
    displayName: 'GL User',
    avatarUrl: 'https://example.com/gl-avatar.png',
    email: 'gl@example.com',
  },
});

let connectionResponse: unknown = mockDisconnectedStatus;
let detectedRepoResponse: unknown = mockDetectedRepo;

function setupMockInvoke(): void {
  tokenStore.clear();
  tokenStore.set('gitlab_token_gl-acc-1', encodeToken('glpat-testtoken123456'));

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

    // GitLab-specific commands
    if (command === 'check_gitlab_connection') return connectionResponse;
    if (command === 'check_gitlab_connection_with_token') return connectionResponse;
    if (command === 'detect_gitlab_repo') return detectedRepoResponse;
    if (command === 'list_gitlab_merge_requests') return mockMergeRequests;
    if (command === 'list_gitlab_issues') return mockIssues;
    if (command === 'list_gitlab_pipelines') return mockPipelines;
    if (command === 'get_gitlab_labels') return mockLabels;
    if (command === 'create_gitlab_merge_request') return mockMergeRequests[0];
    if (command === 'create_gitlab_issue') return mockIssues[0];

    // OAuth
    if (command === 'get_oauth_client_id') return null;

    return null;
  };
}

describe('lv-gitlab-dialog', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    connectionResponse = mockDisconnectedStatus;
    detectedRepoResponse = mockDetectedRepo;
    unifiedProfileStore.getState().reset();
    setupMockInvoke();
  });

  describe('Rendering & Modal', () => {
    it('renders lv-modal when open=true', async () => {
      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      const modal = el.shadowRoot!.querySelector('lv-modal');
      expect(modal).to.not.be.null;
    });

    it('shows 4 tab buttons', async () => {
      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      expect(tabs.length).to.equal(4);

      const tabTexts = Array.from(tabs).map((t) => t.textContent?.trim());
      expect(tabTexts).to.include('Connection');
      expect(tabTexts).to.include('Merge Requests');
      expect(tabTexts).to.include('Issues');
      expect(tabTexts).to.include('Pipelines');
    });

    it('shows detected repo info (projectPath @ instanceUrl)', async () => {
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      const repoName = el.shadowRoot!.querySelector('.repo-name');
      if (repoName) {
        expect(repoName.textContent).to.include('test-group/test-project');
      }
    });

    it('shows account selector when accounts exist', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      const selector = el.shadowRoot!.querySelector('lv-account-selector');
      expect(selector).to.not.be.null;
    });
  });

  describe('Connection Tab', () => {
    it('shows instance URL input and token input when disconnected', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      const tokenForm = el.shadowRoot!.querySelector('.token-form');
      expect(tokenForm).to.not.be.null;

      // Should have instance URL and token inputs
      const inputs = el.shadowRoot!.querySelectorAll('input');
      expect(inputs.length).to.be.greaterThan(0);

      const passwordInput = el.shadowRoot!.querySelector('input[type="password"]');
      expect(passwordInput).to.not.be.null;
    });

    it('shows user info (name, username) when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      const connectionStatus = el.shadowRoot!.querySelector('.connection-status');
      expect(connectionStatus).to.not.be.null;

      const userName = el.shadowRoot!.querySelector('.user-name');
      expect(userName).to.not.be.null;
      expect(userName!.textContent).to.include('GL User');

      const userLogin = el.shadowRoot!.querySelector('.user-login');
      expect(userLogin).to.not.be.null;
      expect(userLogin!.textContent).to.include('gluser');
    });

    it('shows disconnect button when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      const disconnectBtn = el.shadowRoot!.querySelector('.btn-danger');
      expect(disconnectBtn).to.not.be.null;
      expect(disconnectBtn!.textContent?.trim()).to.include('Disconnect');
    });
  });

  describe('Merge Requests Tab', () => {
    it('shows empty state when not connected', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      // Switch to Merge Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const mrTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Merge Requests') as HTMLButtonElement;
      mrTab.click();
      await waitForLoad(el);

      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.not.be.null;
      expect(emptyState!.textContent).to.include('merge requests');
    });

    it('renders MR items with !iid, title, state, and branches', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      // Switch to Merge Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const mrTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Merge Requests') as HTMLButtonElement;
      mrTab.click();
      await waitForLoad(el);

      const mrItems = el.shadowRoot!.querySelectorAll('.mr-item');
      expect(mrItems.length).to.equal(2);

      const firstMr = mrItems[0];
      expect(firstMr.querySelector('.mr-number')?.textContent).to.include('!15');
      expect(firstMr.querySelector('.mr-title')?.textContent).to.include('Add CI pipeline config');
      expect(firstMr.querySelector('.mr-branch')?.textContent).to.include('feature/ci-setup');
      expect(firstMr.querySelector('.mr-branch')?.textContent).to.include('main');
    });

    it('shows filter dropdown and New MR button', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      // Switch to Merge Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const mrTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Merge Requests') as HTMLButtonElement;
      mrTab.click();
      await waitForLoad(el);

      const filterSelect = el.shadowRoot!.querySelector('.filter-select');
      expect(filterSelect).to.not.be.null;

      const newMrBtn = Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New MR')
      );
      expect(newMrBtn).to.not.be.undefined;
    });
  });

  describe('Issues Tab', () => {
    it('renders issue items with #iid, title, and string labels', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-gitlab-dialog>
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
      expect(firstIssue.querySelector('.issue-number')?.textContent).to.include('42');
      expect(firstIssue.querySelector('.issue-title')?.textContent).to.include('Performance regression in API');

      const labels = firstIssue.querySelectorAll('.issue-label');
      expect(labels.length).to.equal(2);
      expect(labels[0].textContent?.trim()).to.equal('bug');
      expect(labels[1].textContent?.trim()).to.equal('performance');
    });
  });

  describe('Pipelines Tab', () => {
    it('renders pipeline items with status dot, ref, and sha', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      // Switch to Pipelines tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const pipelinesTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pipelines') as HTMLButtonElement;
      pipelinesTab.click();
      await waitForLoad(el);

      const pipelineItems = el.shadowRoot!.querySelectorAll('.pipeline-item');
      expect(pipelineItems.length).to.equal(1);

      const firstPipeline = pipelineItems[0];
      expect(firstPipeline.querySelector('.pipeline-ref')?.textContent).to.include('main');

      // Status indicator should exist
      const statusDot = firstPipeline.querySelector('.pipeline-status');
      expect(statusDot).to.not.be.null;

      // Should show truncated sha
      const metaText = firstPipeline.querySelector('.pipeline-meta')?.textContent;
      expect(metaText).to.include('abc12345');
    });
  });

  describe('Tab Navigation', () => {
    it('clicking tab button changes displayed content', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      // Initially on Connection tab - verify token form visible
      const tokenForm = el.shadowRoot!.querySelector('.token-form');
      expect(tokenForm).to.not.be.null;

      // Click Merge Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const mrTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Merge Requests') as HTMLButtonElement;
      mrTab.click();
      await waitForLoad(el);

      // Token form should be gone
      const tokenFormAfter = el.shadowRoot!.querySelector('.token-form');
      expect(tokenFormAfter).to.be.null;

      // Empty state should be visible (not connected)
      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.not.be.null;
    });

    it('active tab has correct styling', async () => {
      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const connectionTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Connection');
      expect(connectionTab?.classList.contains('active')).to.be.true;

      // Click Merge Requests tab
      const mrTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Merge Requests') as HTMLButtonElement;
      mrTab.click();
      await el.updateComplete;

      expect(mrTab.classList.contains('active')).to.be.true;
      expect(connectionTab?.classList.contains('active')).to.be.false;
    });
  });

  describe('Error Handling', () => {
    it('displays error message when error state is set', async () => {
      const el = await fixture<LvGitLabDialog>(html`
        <lv-gitlab-dialog .open=${true}></lv-gitlab-dialog>
      `);
      await waitForLoad(el);

      // Set error state directly to test error rendering
      (el as unknown as { error: string | null }).error = 'GitLab instance unreachable';
      await el.updateComplete;

      const errorMsg = el.shadowRoot!.querySelector('.error');
      expect(errorMsg).to.not.be.null;
      expect(errorMsg!.textContent).to.include('GitLab instance unreachable');
    });
  });
});
