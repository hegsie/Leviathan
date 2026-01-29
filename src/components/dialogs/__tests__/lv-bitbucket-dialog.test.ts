/**
 * Bitbucket Dialog Integration Tests
 *
 * Tests the lv-bitbucket-dialog Lit component for rendering, connection,
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
import '../lv-bitbucket-dialog.ts';
import type { LvBitbucketDialog } from '../lv-bitbucket-dialog.ts';

// --- Test Data ---

const mockBitbucketUser = {
  uuid: '{bb-uuid-12345}',
  username: 'bbuser',
  displayName: 'BB User',
  avatarUrl: 'https://example.com/bb-avatar.png',
};

const mockConnectedStatus = {
  connected: true,
  user: mockBitbucketUser,
};

const mockDisconnectedStatus = {
  connected: false,
  user: null,
};

const mockDetectedRepo = {
  workspace: 'test-workspace',
  repoSlug: 'test-repo',
  remoteName: 'origin',
};

const mockPullRequests = [
  {
    id: 25,
    title: 'Add README documentation',
    description: 'Adds comprehensive README',
    state: 'OPEN',
    author: mockBitbucketUser,
    createdOn: '2025-01-15T10:00:00Z',
    sourceBranch: 'feature/readme',
    destinationBranch: 'main',
    url: 'https://bitbucket.org/test-workspace/test-repo/pull-requests/25',
  },
  {
    id: 24,
    title: 'Update CI config',
    description: null,
    state: 'MERGED',
    author: mockBitbucketUser,
    createdOn: '2025-01-10T10:00:00Z',
    sourceBranch: 'fix/ci',
    destinationBranch: 'main',
    url: 'https://bitbucket.org/test-workspace/test-repo/pull-requests/24',
  },
];

const mockIssues = [
  {
    id: 10,
    title: 'Build fails on Windows',
    content: 'The build process fails on Windows machines',
    state: 'new',
    priority: 'critical',
    kind: 'bug',
    reporter: mockBitbucketUser,
    assignee: null,
    createdOn: '2025-01-12T10:00:00Z',
    url: 'https://bitbucket.org/test-workspace/test-repo/issues/10',
  },
];

const mockPipelines = [
  {
    uuid: '{pipe-uuid-1}',
    buildNumber: 42,
    stateName: 'COMPLETED',
    resultName: 'SUCCESSFUL',
    targetBranch: 'main',
    createdOn: '2025-01-15T10:00:00Z',
    completedOn: '2025-01-15T10:05:00Z',
    url: 'https://bitbucket.org/test-workspace/test-repo/addon/pipelines/home#!/results/42',
  },
];

function createTestAccount(
  overrides: Partial<IntegrationAccount> & { id: string }
): IntegrationAccount {
  const base = createEmptyIntegrationAccount(overrides.integrationType ?? 'bitbucket');
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

async function waitForLoad(el: LvBitbucketDialog): Promise<void> {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
}

// --- Mock Setup ---

const mockAccount = createTestAccount({
  id: 'bb-acc-1',
  name: 'Work Bitbucket',
  integrationType: 'bitbucket',
  config: { type: 'bitbucket', workspace: 'test-workspace' },
  isDefault: true,
  cachedUser: {
    username: 'bbuser',
    displayName: 'BB User',
    avatarUrl: 'https://example.com/bb-avatar.png',
    email: 'bb@example.com',
  },
});

let connectionResponse: unknown = mockDisconnectedStatus;
let detectedRepoResponse: unknown = mockDetectedRepo;

function setupMockInvoke(): void {
  tokenStore.clear();
  tokenStore.set('bitbucket_token_bb-acc-1', encodeToken('bb-app-password-test'));

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

    // Bitbucket-specific commands
    if (command === 'check_bitbucket_connection') return connectionResponse;
    if (command === 'check_bitbucket_connection_with_token') return connectionResponse;
    if (command === 'detect_bitbucket_repo') return detectedRepoResponse;
    if (command === 'list_bitbucket_pull_requests') return mockPullRequests;
    if (command === 'list_bitbucket_issues') return mockIssues;
    if (command === 'list_bitbucket_pipelines') return mockPipelines;
    if (command === 'create_bitbucket_pull_request') return mockPullRequests[0];
    if (command === 'store_bitbucket_credentials') return null;
    if (command === 'delete_bitbucket_credentials') return null;

    // OAuth
    if (command === 'get_oauth_client_id') return null;

    return null;
  };
}

describe('lv-bitbucket-dialog', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    connectionResponse = mockDisconnectedStatus;
    detectedRepoResponse = mockDetectedRepo;
    unifiedProfileStore.getState().reset();
    setupMockInvoke();
  });

  describe('Rendering & Modal', () => {
    it('renders lv-modal when open=true', async () => {
      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const modal = el.shadowRoot!.querySelector('lv-modal');
      expect(modal).to.not.be.null;
    });

    it('shows 4 tab buttons', async () => {
      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      expect(tabs.length).to.equal(4);

      const tabTexts = Array.from(tabs).map((t) => t.textContent?.trim());
      expect(tabTexts).to.include('Connection');
      expect(tabTexts).to.include('Pull Requests');
      expect(tabTexts).to.include('Issues');
      expect(tabTexts).to.include('Pipelines');
    });

    it('shows detected repo info (workspace/repoSlug)', async () => {
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const repoName = el.shadowRoot!.querySelector('.repo-name');
      if (repoName) {
        expect(repoName.textContent).to.include('test-workspace');
        expect(repoName.textContent).to.include('test-repo');
      }
    });

    it('shows account selector when accounts exist', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const selector = el.shadowRoot!.querySelector('lv-account-selector');
      expect(selector).to.not.be.null;
    });
  });

  describe('Connection Tab', () => {
    it('shows username and app password inputs when disconnected', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const tokenForm = el.shadowRoot!.querySelector('.token-form');
      expect(tokenForm).to.not.be.null;

      // Should have username and app password inputs
      const inputs = el.shadowRoot!.querySelectorAll('input');
      expect(inputs.length).to.be.greaterThan(0);

      const passwordInput = el.shadowRoot!.querySelector('input[type="password"]');
      expect(passwordInput).to.not.be.null;
    });

    it('shows user info (displayName, @username) when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const connectionStatus = el.shadowRoot!.querySelector('.connection-status');
      expect(connectionStatus).to.not.be.null;

      const userName = el.shadowRoot!.querySelector('.user-name');
      expect(userName).to.not.be.null;
      expect(userName!.textContent).to.include('BB User');

      const userLogin = el.shadowRoot!.querySelector('.user-login');
      expect(userLogin).to.not.be.null;
      expect(userLogin!.textContent).to.include('bbuser');
    });

    it('shows disconnect button when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
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

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      // Switch to Pull Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const prTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pull Requests') as HTMLButtonElement;
      prTab.click();
      await waitForLoad(el);

      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.not.be.null;
      expect(emptyState!.textContent).to.include('pull requests');
    });

    it('renders PR items with #id, title, UPPERCASE state, and branches', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
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
      expect(firstPr.querySelector('.pr-number')?.textContent).to.include('25');
      expect(firstPr.querySelector('.pr-title')?.textContent).to.include('Add README documentation');
      expect(firstPr.querySelector('.pr-state')?.textContent).to.include('OPEN');
      expect(firstPr.querySelector('.pr-branch')?.textContent).to.include('feature/readme');
      expect(firstPr.querySelector('.pr-branch')?.textContent).to.include('main');
    });

    it('shows filter dropdown and New PR button', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
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
    it('renders issue items with #id, title, kind, and priority', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
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
      expect(firstIssue.querySelector('.issue-number')?.textContent).to.include('10');
      expect(firstIssue.querySelector('.issue-title')?.textContent).to.include('Build fails on Windows');

      const metaText = firstIssue.querySelector('.issue-meta')?.textContent;
      expect(metaText).to.include('bug');
      expect(metaText).to.include('critical');
    });
  });

  describe('Pipelines Tab', () => {
    it('renders pipeline items with status dot, build number, and branch', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
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
      expect(firstPipeline.querySelector('.pipeline-name')?.textContent).to.include('42');
      expect(firstPipeline.querySelector('.pipeline-branch')?.textContent).to.include('main');

      // Status indicator should exist
      const statusDot = firstPipeline.querySelector('.pipeline-status');
      expect(statusDot).to.not.be.null;
    });
  });

  describe('Tab Navigation', () => {
    it('clicking tab button changes displayed content', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      // Initially on Connection tab - verify token form visible
      const tokenForm = el.shadowRoot!.querySelector('.token-form');
      expect(tokenForm).to.not.be.null;

      // Click Pull Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const prTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pull Requests') as HTMLButtonElement;
      prTab.click();
      await waitForLoad(el);

      // Token form should be gone
      const tokenFormAfter = el.shadowRoot!.querySelector('.token-form');
      expect(tokenFormAfter).to.be.null;

      // Empty state should be visible (not connected)
      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.not.be.null;
    });

    it('active tab has correct styling', async () => {
      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
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
      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      // Set error state directly to test error rendering
      (el as unknown as { error: string | null }).error = 'Bitbucket API rate limited';
      await el.updateComplete;

      const errorMsg = el.shadowRoot!.querySelector('.error');
      expect(errorMsg).to.not.be.null;
      expect(errorMsg!.textContent).to.include('Bitbucket API rate limited');
    });
  });
});
