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
const keyringStore = new Map<string, string>();

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } })
  .__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import { expect, fixture, html } from '@open-wc/testing';
import { unifiedProfileStore } from '../../../stores/unified-profile.store.ts';
import { uiStore } from '../../../stores/ui.store.ts';
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
  keyringStore.clear();
  keyringStore.set('azure-devops_token_ado-acc-1', 'ado-pat-testtoken123456');

  mockInvoke = async (command: string, args?: unknown) => {
    const params = args as Record<string, unknown> | undefined;

    // Credential service (OS keyring)
    if (command === 'get_keyring_token') {
      const key = (params as Record<string, string>)?.key;
      return keyringStore.get(key) ?? null;
    }
    if (command === 'store_keyring_token') {
      const { key, value } = params as Record<string, string>;
      keyringStore.set(key, value);
      return null;
    }
    if (command === 'delete_keyring_token') {
      const key = (params as Record<string, string>)?.key;
      keyringStore.delete(key);
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

  describe('Create Work Item', () => {
    it('shows New Work Item button on the Work Items tab', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      (Array.from(tabs).find((t) => t.textContent?.trim() === 'Work Items') as HTMLButtonElement).click();
      await waitForLoad(el);

      const newBtn = Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New Work Item')
      );
      expect(newBtn).to.not.be.undefined;
    });

    it('renders the create-work-item form (type, title, description)', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      (Array.from(tabs).find((t) => t.textContent?.trim() === 'Work Items') as HTMLButtonElement).click();
      await waitForLoad(el);
      (Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New Work Item')
      ) as HTMLButtonElement).click();
      await waitForLoad(el);

      const form = el.shadowRoot!.querySelector('.token-form');
      expect(form).to.not.be.null;
      expect(form!.querySelector('select')).to.not.be.null;
      expect(form!.querySelector('input[type="text"]')).to.not.be.null;
      expect(form!.querySelector('textarea')).to.not.be.null;
    });

    it('submits create_azure_devops_work_item with the right args and refreshes', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;
      const createdItem = {
        id: 999,
        title: 'New task',
        workItemType: 'Task',
        state: 'New',
        assignedTo: null,
        createdDate: '2025-02-01T10:00:00Z',
        url: 'https://dev.azure.com/testorg/test-project/_workitems/edit/999',
      };
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'create_azure_devops_work_item') return createdItem;
        return origMock(command, args);
      };

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      (Array.from(tabs).find((t) => t.textContent?.trim() === 'Work Items') as HTMLButtonElement).click();
      await waitForLoad(el);
      (Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New Work Item')
      ) as HTMLButtonElement).click();
      await waitForLoad(el);

      const titleInput = el.shadowRoot!.querySelector('.token-form input[type="text"]') as HTMLInputElement;
      titleInput.value = 'New task';
      titleInput.dispatchEvent(new Event('input'));
      const textarea = el.shadowRoot!.querySelector('.token-form textarea') as HTMLTextAreaElement;
      textarea.value = 'Do it';
      textarea.dispatchEvent(new Event('input'));
      await el.updateComplete;

      invokeHistory.length = 0;
      (Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim() === 'Create Work Item'
      ) as HTMLButtonElement).click();
      await waitForLoad(el);

      const createCall = invokeHistory.find((c) => c.command === 'create_azure_devops_work_item');
      expect(createCall, 'create_azure_devops_work_item should be invoked').to.not.be.undefined;
      const callArgs = createCall!.args as Record<string, unknown>;
      expect(callArgs.organization).to.equal('testorg');
      expect(callArgs.project).to.equal('test-project');
      const input = callArgs.input as Record<string, unknown>;
      expect(input.title).to.equal('New task');
      expect(input.workItemType).to.equal('Task');
      expect(input.description).to.equal('Do it');

      // Refreshes work items list
      expect(invokeHistory.some((c) => c.command === 'query_ado_work_items')).to.be.true;
    });

    it('shows an error when create_azure_devops_work_item fails (not silent)', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'create_azure_devops_work_item') throw new Error('Permission denied');
        return origMock(command, args);
      };

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      (Array.from(tabs).find((t) => t.textContent?.trim() === 'Work Items') as HTMLButtonElement).click();
      await waitForLoad(el);
      (Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New Work Item')
      ) as HTMLButtonElement).click();
      await waitForLoad(el);

      const titleInput = el.shadowRoot!.querySelector('.token-form input[type="text"]') as HTMLInputElement;
      titleInput.value = 'Will fail';
      titleInput.dispatchEvent(new Event('input'));
      await el.updateComplete;

      (Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim() === 'Create Work Item'
      ) as HTMLButtonElement).click();
      await waitForLoad(el);

      const errorBanner = el.shadowRoot!.querySelector('.error');
      expect(errorBanner).to.not.be.null;
      expect(errorBanner!.textContent).to.include('Permission denied');
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

    it('surfaces a backend error when repo detection fails (not silent)', async () => {
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'detect_ado_repo') throw new Error('ado detect boom');
        return origMock(command, args);
      };

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error).to.include('ado detect boom');
    });
  });

  describe('Delete', () => {
    async function openConnectedDialog(): Promise<LvAzureDevOpsDialog> {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockConnectedStatus;
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = 'ado-acc-1';
      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      await el.updateComplete;
      return el;
    }

    it('deletes the account record BEFORE the keyring token (record is source of truth)', async () => {
      const el = await openConnectedDialog();
      invokeHistory.length = 0;
      uiStore.getState().toasts.length = 0;

      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command.startsWith('plugin:dialog|')) return 'Ok';
        return origMock(command, args);
      };

      await (el as unknown as { handleDeleteIntegration: () => Promise<void> }).handleDeleteIntegration();
      await el.updateComplete;

      const deleteAccountIdx = invokeHistory.findIndex((h) => h.command === 'delete_global_account');
      const deleteTokenIdx = invokeHistory.findIndex((h) => h.command === 'delete_keyring_token');
      expect(deleteAccountIdx, 'account record deletion happened').to.be.greaterThan(-1);
      expect(deleteTokenIdx, 'token deletion happened').to.be.greaterThan(-1);
      expect(deleteAccountIdx).to.be.lessThan(deleteTokenIdx);
    });

    it('surfaces an error (inline + toast) when account deletion fails', async () => {
      const el = await openConnectedDialog();
      uiStore.getState().toasts.length = 0;

      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command.startsWith('plugin:dialog|')) return 'Ok';
        if (command === 'delete_global_account') throw new Error('delete record boom');
        return origMock(command, args);
      };

      await (el as unknown as { handleDeleteIntegration: () => Promise<void> }).handleDeleteIntegration();
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error).to.include('delete record boom');
      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && /delete record boom/.test(t.message))).to.be.true;
    });
  });

  describe('Entra ID OAuth', () => {
    it('persists a new IntegrationAccount via save_global_account (not just the token)', async () => {
      connectionResponse = mockConnectedStatus;
      // Start with no accounts so the OAuth path creates a brand-new one. The
      // backend persists the saved account, so a stateful store mirrors that:
      // get_unified_profiles_config must return what save_global_account wrote
      // (otherwise the dialog's store subscription would drop the new selection).
      const persistedAccounts: IntegrationAccount[] = [];
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [...persistedAccounts], repositoryAssignments: {} };
          }
          // Echo back the persisted account (with its generated id) like the backend does.
          if (command === 'save_global_account') {
            const account = (args as { account?: IntegrationAccount } | undefined)?.account;
            if (account) persistedAccounts.push(account);
            return account ?? null;
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      (el as unknown as { oauthClientId: string }).oauthClientId = 'client-abc';
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = null;
      await el.updateComplete;

      invokeHistory.length = 0;
      // Registers the oauth-complete listener.
      await (el as unknown as { handleStartEntraOAuth: () => Promise<void> }).handleStartEntraOAuth();

      window.dispatchEvent(
        new CustomEvent('oauth-complete', {
          detail: { provider: 'azure', tokens: { accessToken: 'ado_oauth_token' } },
        })
      );
      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      const saveCall = invokeHistory.find((h) => h.command === 'save_global_account');
      expect(saveCall, 'save_global_account should be invoked').to.not.be.undefined;
      const storeCall = invokeHistory.find((h) => h.command === 'store_keyring_token');
      expect(storeCall, 'token should be stored too').to.not.be.undefined;

      // The account that was persisted carries the verified user as cachedUser.
      const account = (saveCall!.args as Record<string, unknown>).account as Record<string, unknown>;
      expect(account).to.not.be.undefined;
      expect((account.config as Record<string, unknown>).type).to.equal('azure-devops');
      expect((account.config as Record<string, unknown>).organization).to.equal('testorg');
      expect(account.cachedUser).to.not.be.null;

      // selectedAccountId now points at the persisted account (not a synthetic id).
      const selected = (el as unknown as { selectedAccountId: string | null }).selectedAccountId;
      expect(selected).to.equal((account as { id: string }).id);
    });

    it('Cancel during a pending sign-in tears down the flow so a late deep link does NOT connect', async () => {
      connectionResponse = mockConnectedStatus;
      // Start with no accounts: if the (cancelled) flow ever completed it would
      // create a brand-new account via save_global_account.
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          // Make startOAuth register a real pending flow so cancelOAuth('azure')
          // has something to tear down (deep-link provider, no loopback port).
          if (command === 'oauth_get_authorize_url') {
            return {
              authorizeUrl: 'https://login.microsoftonline.com/authorize',
              state: 'azure-state-xyz',
              loopbackPort: null,
            };
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      (el as unknown as { oauthClientId: string }).oauthClientId = 'client-abc';
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = null;
      await el.updateComplete;

      // Start the flow — registers the oauth-complete listener and sets pending.
      await (el as unknown as { handleStartEntraOAuth: () => Promise<void> }).handleStartEntraOAuth();
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.true;
      expect(
        (el as unknown as { _pendingOAuthHandler?: EventListener })._pendingOAuthHandler,
        'a listener is registered after start'
      ).to.not.be.undefined;

      // User clicks Cancel.
      invokeHistory.length = 0;
      await (el as unknown as { handleCancelEntraOAuth: () => void }).handleCancelEntraOAuth();
      await el.updateComplete;

      // The underlying flow is cancelled and the listener is removed.
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.false;
      expect(
        (el as unknown as { _pendingOAuthHandler?: EventListener })._pendingOAuthHandler,
        'listener removed after cancel'
      ).to.be.undefined;

      // A late deep-link completion fires AFTER cancel. With the listener gone,
      // it must NOT verify/persist/connect anything.
      window.dispatchEvent(
        new CustomEvent('oauth-complete', {
          detail: { provider: 'azure', tokens: { accessToken: 'ado_oauth_token' } },
        })
      );
      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      expect(
        invokeHistory.some((h) => h.command === 'check_ado_connection_with_token'),
        'no connection verification after cancel'
      ).to.be.false;
      expect(
        invokeHistory.some((h) => h.command === 'save_global_account'),
        'no account persisted after cancel'
      ).to.be.false;
      expect(
        invokeHistory.some((h) => h.command === 'store_keyring_token'),
        'no token stored after cancel'
      ).to.be.false;
      expect((el as unknown as { selectedAccountId: string | null }).selectedAccountId).to.be.null;
    });
  });

  describe('PAT rotation refreshes cachedUser', () => {
    it('calls update_global_account_cached_user after storing the token on an existing account', async () => {
      connectionResponse = mockConnectedStatus;
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = 'ado-acc-1';
      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      (el as unknown as { tokenInput: string }).tokenInput = 'new-rotated-pat';
      await el.updateComplete;

      invokeHistory.length = 0;
      await (el as unknown as { handleSaveToken: () => Promise<void> }).handleSaveToken();
      await el.updateComplete;

      const storeIdx = invokeHistory.findIndex((h) => h.command === 'store_keyring_token');
      const cachedUserIdx = invokeHistory.findIndex(
        (h) => h.command === 'update_global_account_cached_user'
      );
      expect(storeIdx, 'token stored').to.be.greaterThan(-1);
      expect(cachedUserIdx, 'cachedUser refreshed').to.be.greaterThan(-1);
      const cachedUserCall = invokeHistory[cachedUserIdx];
      const args = cachedUserCall.args as Record<string, unknown>;
      expect(args.accountId).to.equal('ado-acc-1');
      expect(args.user).to.not.be.null;
    });
  });
});
