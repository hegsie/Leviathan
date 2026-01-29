/**
 * Azure DevOps Dialog Integration Tests
 *
 * Tests the lv-azure-devops-dialog Lit component for rendering, connection,
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
import '../lv-azure-devops-dialog.ts';
import type { LvAzureDevOpsDialog } from '../lv-azure-devops-dialog.ts';

// --- Test Data ---

const mockAdoUser = {
  id: 'ado-user-id-1',
  displayName: 'ADO User',
  uniqueName: 'adouser@myorg.com',
  imageUrl: null,
};

const mockConnectedStatus = {
  connected: true,
  user: mockAdoUser,
  organization: 'testorg',
};

const mockDisconnectedStatus = {
  connected: false,
  user: null,
  organization: null,
};

const mockDetectedRepo = {
  organization: 'testorg',
  project: 'test-project',
  repository: 'test-repo',
  remoteName: 'origin',
};

const mockPullRequests = [
  {
    pullRequestId: 101,
    title: 'Add authentication module',
    description: 'Implements OAuth2 authentication',
    status: 'active',
    createdBy: mockAdoUser,
    creationDate: '2025-01-15T10:00:00Z',
    sourceRefName: 'refs/heads/feature/auth',
    targetRefName: 'refs/heads/main',
    isDraft: false,
    url: 'https://dev.azure.com/testorg/test-project/_git/test-repo/pullrequest/101',
  },
  {
    pullRequestId: 100,
    title: 'Fix build pipeline',
    description: null,
    status: 'completed',
    createdBy: mockAdoUser,
    creationDate: '2025-01-10T10:00:00Z',
    sourceRefName: 'refs/heads/fix/build',
    targetRefName: 'refs/heads/main',
    isDraft: false,
    url: 'https://dev.azure.com/testorg/test-project/_git/test-repo/pullrequest/100',
  },
];

const mockWorkItems = [
  {
    id: 501,
    title: 'Implement user dashboard',
    workItemType: 'User Story',
    state: 'Active',
    assignedTo: mockAdoUser,
    createdDate: '2025-01-12T10:00:00Z',
    url: 'https://dev.azure.com/testorg/test-project/_workitems/edit/501',
  },
  {
    id: 502,
    title: 'Login button not responding',
    workItemType: 'Bug',
    state: 'New',
    assignedTo: null,
    createdDate: '2025-01-14T10:00:00Z',
    url: 'https://dev.azure.com/testorg/test-project/_workitems/edit/502',
  },
];

const mockPipelineRuns = [
  {
    id: 301,
    name: 'Build & Test',
    state: 'completed',
    result: 'succeeded',
    createdDate: '2025-01-15T10:00:00Z',
    finishedDate: '2025-01-15T10:05:00Z',
    sourceBranch: 'refs/heads/main',
    url: 'https://dev.azure.com/testorg/test-project/_build/results?buildId=301',
  },
];

function createTestAccount(
  overrides: Partial<IntegrationAccount> & { id: string }
): IntegrationAccount {
  const base = createEmptyIntegrationAccount(overrides.integrationType ?? 'azure-devops');
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

async function waitForLoad(el: LvAzureDevOpsDialog): Promise<void> {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
}

// --- Mock Setup ---

const mockAccount = createTestAccount({
  id: 'ado-acc-1',
  name: 'Work Azure DevOps',
  integrationType: 'azure-devops',
  config: { type: 'azure-devops', organization: 'testorg' },
  isDefault: true,
  cachedUser: {
    username: 'adouser@myorg.com',
    displayName: 'ADO User',
    avatarUrl: null,
    email: 'adouser@myorg.com',
  },
});

let connectionResponse: unknown = mockDisconnectedStatus;
let detectedRepoResponse: unknown = mockDetectedRepo;

function setupMockInvoke(): void {
  tokenStore.clear();
  tokenStore.set('azure-devops_token_ado-acc-1', encodeToken('ado-pat-testtoken123456'));

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

    // Azure DevOps-specific commands
    if (command === 'check_ado_connection') return connectionResponse;
    if (command === 'check_ado_connection_with_token') return connectionResponse;
    if (command === 'detect_ado_repo') return detectedRepoResponse;
    if (command === 'list_ado_pull_requests') return mockPullRequests;
    if (command === 'query_ado_work_items') return mockWorkItems;
    if (command === 'list_ado_pipeline_runs') return mockPipelineRuns;
    if (command === 'create_ado_pull_request') return mockPullRequests[0];
    if (command === 'sync_git_credential_for_ado') return null;

    return null;
  };
}

describe('lv-azure-devops-dialog', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    connectionResponse = mockDisconnectedStatus;
    detectedRepoResponse = mockDetectedRepo;
    unifiedProfileStore.getState().reset();
    setupMockInvoke();
  });

  describe('Rendering & Modal', () => {
    it('renders lv-modal when open=true', async () => {
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const modal = el.shadowRoot!.querySelector('lv-modal');
      expect(modal).to.not.be.null;
    });

    it('shows 4 tab buttons', async () => {
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      expect(tabs.length).to.equal(4);

      const tabTexts = Array.from(tabs).map((t) => t.textContent?.trim());
      expect(tabTexts).to.include('Connection');
      expect(tabTexts).to.include('Pull Requests');
      expect(tabTexts).to.include('Work Items');
      expect(tabTexts).to.include('Pipelines');
    });

    it('shows detected repo info (org/project/repo)', async () => {
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const repoName = el.shadowRoot!.querySelector('.repo-name');
      if (repoName) {
        expect(repoName.textContent).to.include('testorg');
        expect(repoName.textContent).to.include('test-project');
        expect(repoName.textContent).to.include('test-repo');
      }
    });

    it('shows account selector when accounts exist', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const selector = el.shadowRoot!.querySelector('lv-account-selector');
      expect(selector).to.not.be.null;
    });
  });

  describe('Connection Tab', () => {
    it('shows organization input and PAT input when disconnected', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const tokenForm = el.shadowRoot!.querySelector('.token-form');
      expect(tokenForm).to.not.be.null;

      // Should have organization input and PAT input
      const inputs = el.shadowRoot!.querySelectorAll('input');
      expect(inputs.length).to.be.greaterThan(0);

      const passwordInput = el.shadowRoot!.querySelector('input[type="password"]');
      expect(passwordInput).to.not.be.null;
    });

    it('shows user info (displayName, organization) when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const connectionStatus = el.shadowRoot!.querySelector('.connection-status');
      expect(connectionStatus).to.not.be.null;

      const userName = el.shadowRoot!.querySelector('.user-name');
      expect(userName).to.not.be.null;
      expect(userName!.textContent).to.include('ADO User');

      const userOrg = el.shadowRoot!.querySelector('.user-org');
      expect(userOrg).to.not.be.null;
      expect(userOrg!.textContent).to.include('testorg');
    });

    it('shows disconnect button when connected', async () => {
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
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

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      // Switch to Pull Requests tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const prTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Pull Requests') as HTMLButtonElement;
      prTab.click();
      await waitForLoad(el);

      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.not.be.null;
      expect(emptyState!.textContent).to.include('Connect to Azure DevOps');
    });

    it('renders PR items with ID, title, status, and branches', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
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
      expect(firstPr.querySelector('.pr-number')?.textContent).to.include('101');
      expect(firstPr.querySelector('.pr-title')?.textContent).to.include('Add authentication module');
      expect(firstPr.querySelector('.pr-branch')?.textContent).to.include('refs/heads/feature/auth');
      expect(firstPr.querySelector('.pr-branch')?.textContent).to.include('refs/heads/main');
    });

    it('shows filter dropdown and New PR button', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
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

  describe('Work Items Tab', () => {
    it('renders work items with #id, title, type badge, and state', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      // Switch to Work Items tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const wiTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Work Items') as HTMLButtonElement;
      wiTab.click();
      await waitForLoad(el);

      const workItems = el.shadowRoot!.querySelectorAll('.work-item');
      expect(workItems.length).to.equal(2);

      const firstItem = workItems[0];
      expect(firstItem.querySelector('.work-item-id')?.textContent).to.include('501');
      expect(firstItem.querySelector('.work-item-title')?.textContent).to.include('Implement user dashboard');
      expect(firstItem.querySelector('.work-item-type')?.textContent).to.include('User Story');
      expect(firstItem.querySelector('.work-item-state')?.textContent).to.include('Active');

      const secondItem = workItems[1];
      expect(secondItem.querySelector('.work-item-type')?.textContent).to.include('Bug');
    });
  });

  describe('Pipelines Tab', () => {
    it('renders pipeline runs with status indicator, name, and branch', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
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
      expect(firstPipeline.querySelector('.pipeline-name')?.textContent).to.include('Build & Test');
      expect(firstPipeline.querySelector('.pipeline-branch')?.textContent).to.include('refs/heads/main');

      // Status indicator should exist
      const statusDot = firstPipeline.querySelector('.pipeline-status');
      expect(statusDot).to.not.be.null;
    });
  });

  describe('Tab Navigation', () => {
    it('clicking tab button changes displayed content', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
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
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
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
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      // Set error state directly to test error rendering
      (el as unknown as { error: string | null }).error = 'Organization not found';
      await el.updateComplete;

      const errorMsg = el.shadowRoot!.querySelector('.error');
      expect(errorMsg).to.not.be.null;
      expect(errorMsg!.textContent).to.include('Organization not found');
    });
  });
});
