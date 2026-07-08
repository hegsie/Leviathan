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

const mockAdoOrganizations = [
  { id: 'org-1', name: 'contoso', url: 'https://dev.azure.com/contoso' },
  { id: 'org-2', name: 'fabrikam', url: 'https://dev.azure.com/fabrikam' },
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
    if (command === 'list_ado_organizations') return mockAdoOrganizations;
    if (command === 'create_ado_pull_request') return mockPullRequests[0];
    if (command === 'sync_git_credential_for_ado') return null;

    // Entra interactive auth-code + loopback flow (Sign in with Microsoft).
    // startOAuth: get authorize URL → open browser → wait for loopback callback →
    // exchange code → dispatch a global `oauth-complete` event with the tokens.
    if (command === 'oauth_get_authorize_url') {
      return {
        authorizeUrl:
          'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback',
        state: 'state-xyz',
        loopbackPort: 8080,
      };
    }
    if (command === 'oauth_wait_for_callback') return { code: 'code-123', state: 'state-xyz' };
    if (command === 'oauth_exchange_code') return { accessToken: 'ado_oauth_token' };

    return null;
  };
}

// --- Interactive Entra sign-in helpers (auth-code + loopback) ---

// Put the dialog into the "interactive sign-in started" state without driving the
// real loopback/browser plumbing (that lives in the OAuth service tests).
// Capturing entraFlowGeneration is what lets a later `oauth-complete` pass the
// generation guard — exactly what handleStartEntraOAuth does.
function beginPendingFlow(el: LvAzureDevOpsDialog): void {
  const api = el as unknown as {
    oauthPending: boolean;
    entraFlowGeneration: number;
    entraGeneration: number;
  };
  api.oauthPending = true;
  api.entraFlowGeneration = api.entraGeneration;
}

// Simulate the OAuth service finishing the loopback exchange: it dispatches a
// global `oauth-complete` window event with the exchanged tokens.
function dispatchOAuthComplete(accessToken = 'ado_oauth_token'): void {
  window.dispatchEvent(
    new CustomEvent('oauth-complete', {
      detail: { provider: 'azure', tokens: { accessToken } },
    })
  );
}

const flush = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

    // Regression: the account-selector dispatches a bubbling/composed
    // `manage-accounts` event. The dialog must CONSUME it and re-emit its own,
    // so the host receives EXACTLY ONE event — not the selector's plus the
    // re-dispatch. The double-fire corrupted the manager's reversible-Back state.
    it('forwards manage-accounts to the host exactly once', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      const events: CustomEvent[] = [];
      el.addEventListener('manage-accounts', (e) => events.push(e as CustomEvent));

      const selector = el.shadowRoot!.querySelector('lv-account-selector')!;
      selector.dispatchEvent(
        new CustomEvent('manage-accounts', {
          detail: { integrationType: 'azure-devops' },
          bubbles: true,
          composed: true,
        })
      );

      expect(events).to.have.lengthOf(1);
      expect(events[0].detail.integrationType).to.equal('azure-devops');
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

  describe('Create PR', () => {
    it('shows a success toast after creating a pull request (parity with work items)', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      // Fill the create-PR form and submit via the handler.
      Object.assign(el as unknown as Record<string, unknown>, {
        activeTab: 'create-pr',
        createPrTitle: 'Add feature',
        createPrSource: 'refs/heads/feature',
        createPrTarget: 'refs/heads/main',
      });
      await el.updateComplete;

      uiStore.getState().toasts.length = 0;
      invokeHistory.length = 0;
      await (el as unknown as { handleCreatePr: () => Promise<void> }).handleCreatePr();
      await el.updateComplete;

      expect(invokeHistory.some((c) => c.command === 'create_ado_pull_request'), 'PR create invoked').to.be.true;
      const toasts = uiStore.getState().toasts;
      expect(
        toasts.some((t) => t.type === 'success' && /pull request created/i.test(t.message)),
        'success toast shown',
      ).to.be.true;
      // Navigates back to the PR list on success.
      expect((el as unknown as { activeTab: string }).activeTab).to.equal('pull-requests');
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
    it('handleStartEntraOAuth kicks off the interactive loopback flow (oauth_get_authorize_url) and shows the connecting state', async () => {
      connectionResponse = mockConnectedStatus;
      // Hang the callback so the started flow stays pending and we can observe it.
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          if (command === 'oauth_wait_for_callback') {
            return new Promise(() => { /* never resolves */ });
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { authMethod: string }).authMethod = 'oauth';
      await el.updateComplete;

      invokeHistory.length = 0;
      await (el as unknown as { handleStartEntraOAuth: () => Promise<void> }).handleStartEntraOAuth();
      await flush(20);
      await el.updateComplete;

      // The interactive auth-code flow was started (no device-code command).
      expect(invokeHistory.some((h) => h.command === 'oauth_get_authorize_url'), 'authorize URL requested').to.be.true;
      expect(invokeHistory.some((h) => h.command === 'oauth_start_device_code'), 'no device-code flow').to.be.false;
      expect((el as unknown as { oauthPending: boolean }).oauthPending, 'connecting spinner shown').to.be.true;

      // The connecting state renders a spinner + Cancel, no device code.
      const tokenForm = el.shadowRoot!.querySelector('.token-form')!;
      expect(tokenForm.textContent).to.include('Complete sign-in in your browser');

      // Clean up the pending service flow so it doesn't leak into later tests.
      (el as unknown as { handleCancelEntraOAuth: () => void }).handleCancelEntraOAuth();
    });

    it('persists a new IntegrationAccount via save_global_account (not just the token) on completion', async () => {
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
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = null;
      await el.updateComplete;

      invokeHistory.length = 0;
      // A started flow completes: the service dispatches oauth-complete with tokens.
      beginPendingFlow(el);
      dispatchOAuthComplete();
      await flush();
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

    it('Cancel during a pending sign-in stops the flow so a late completion does NOT connect', async () => {
      connectionResponse = mockConnectedStatus;
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = null;
      await el.updateComplete;

      beginPendingFlow(el);
      await el.updateComplete;
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.true;

      // User clicks Cancel.
      (el as unknown as { handleCancelEntraOAuth: () => void }).handleCancelEntraOAuth();
      await el.updateComplete;
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.false;

      // A late callback arrives after cancel — the generation guard must ignore it.
      invokeHistory.length = 0;
      dispatchOAuthComplete();
      await flush();
      await el.updateComplete;

      expect(invokeHistory.some((h) => h.command === 'save_global_account'), 'no account persisted after cancel').to.be.false;
      expect(invokeHistory.some((h) => h.command === 'store_keyring_token')).to.be.false;
      expect((el as unknown as { selectedAccountId: string | null }).selectedAccountId).to.be.null;
    });

    it('closing the dialog mid-sign-in blocks a silent late connect', async () => {
      connectionResponse = mockConnectedStatus;
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = null;
      await el.updateComplete;

      beginPendingFlow(el);
      await el.updateComplete;

      // Close via the modal (X / Escape / backdrop all route through handleClose).
      (el as unknown as { handleClose: () => void }).handleClose();
      await el.updateComplete;
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.false;

      invokeHistory.length = 0;
      dispatchOAuthComplete();
      await flush();
      await el.updateComplete;

      expect(invokeHistory.some((h) => h.command === 'save_global_account'), 'no connect after close').to.be.false;
    });

    it('switching accounts mid-sign-in blocks a write to the new account', async () => {
      connectionResponse = mockConnectedStatus;
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      await el.updateComplete;

      beginPendingFlow(el);
      await el.updateComplete;

      // Starting an "Add account" must abandon the flow first.
      (el as unknown as { handleAddAccount: () => void }).handleAddAccount();
      await el.updateComplete;
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.false;

      invokeHistory.length = 0;
      dispatchOAuthComplete();
      await flush();
      await el.updateComplete;

      expect(invokeHistory.some((h) => h.command === 'save_global_account'), 'no connect after account switch').to.be.false;
    });

    it('cancelling clears the loading state so the sign-in button is not stuck disabled', async () => {
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      // Simulate being mid-"Connecting..." (resolveOrgAndFinalize sets both).
      (el as unknown as { isLoading: boolean }).isLoading = true;
      (el as unknown as { oauthPending: boolean }).oauthPending = true;
      await el.updateComplete;

      (el as unknown as { handleCancelEntraOAuth: () => void }).handleCancelEntraOAuth();
      await el.updateComplete;

      expect((el as unknown as { isLoading: boolean }).isLoading, 'loading cleared on cancel').to.be.false;
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.false;
    });

    it('Add account clears a stale organization so a new sign-in uses the org picker', async () => {
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      // A previously-selected account left an org populated.
      (el as unknown as { organizationInput: string }).organizationInput = 'previous-org';
      await el.updateComplete;

      (el as unknown as { handleAddAccount: () => void }).handleAddAccount();
      await el.updateComplete;

      expect((el as unknown as { organizationInput: string }).organizationInput, 'stale org cleared').to.equal('');
      expect((el as unknown as { selectedAccountId: string | null }).selectedAccountId).to.be.null;
    });

    it('switching to the PAT tab mid-sign-in abandons the flow', async () => {
      connectionResponse = mockConnectedStatus;
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { authMethod: string }).authMethod = 'oauth';
      await el.updateComplete;

      beginPendingFlow(el);
      await el.updateComplete;

      (el as unknown as { setAuthMethod: (m: string) => void }).setAuthMethod('pat');
      await el.updateComplete;

      expect((el as unknown as { authMethod: string }).authMethod).to.equal('pat');
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.false;

      invokeHistory.length = 0;
      dispatchOAuthComplete();
      await flush();
      await el.updateComplete;
      expect(invokeHistory.some((h) => h.command === 'save_global_account'), 'no connect after tab switch').to.be.false;
    });

    it('opening Manage Accounts mid-sign-in abandons the flow', async () => {
      connectionResponse = mockConnectedStatus;
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      await el.updateComplete;

      beginPendingFlow(el);
      await el.updateComplete;

      (el as unknown as { handleManageAccounts: (e: Event) => void }).handleManageAccounts(new Event('manage'));
      await el.updateComplete;
      expect((el as unknown as { oauthPending: boolean }).oauthPending).to.be.false;

      invokeHistory.length = 0;
      dispatchOAuthComplete();
      await flush();
      await el.updateComplete;
      expect(invokeHistory.some((h) => h.command === 'save_global_account'), 'no connect after manage-accounts').to.be.false;
    });

    it('preserves a PAT-typed organization across an OAuth tab round-trip', async () => {
      // No accounts so nothing is auto-selected (org clearing only applies when
      // there's no selected account and no detected repo).
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      const api = el as unknown as {
        setAuthMethod: (m: string) => void;
        organizationInput: string;
        selectedAccountId: string | null;
      };
      api.selectedAccountId = null;

      // On the PAT tab the user typed an org (no account/repo context).
      api.organizationInput = 'my-typed-org';

      // Switch to OAuth: the org is stashed (not used for OAuth resolution).
      api.setAuthMethod('oauth');
      await el.updateComplete;
      expect(api.organizationInput, 'org hidden from OAuth resolution').to.equal('');

      // Switch back to PAT: the typed org is restored, not lost.
      api.setAuthMethod('pat');
      await el.updateComplete;
      expect(api.organizationInput, 'PAT org restored').to.equal('my-typed-org');
    });

    it('surfaces an error and stops the spinner when the sign-in fails to start (not a stuck dead-end)', async () => {
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          // Fail to obtain the authorize URL: startOAuth emits an error state,
          // which the dialog's onOAuthStateChange subscription surfaces.
          if (command === 'oauth_get_authorize_url') return null;
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = null;
      (el as unknown as { authMethod: string }).authMethod = 'oauth';
      await el.updateComplete;

      await (el as unknown as { handleStartEntraOAuth: () => Promise<void> }).handleStartEntraOAuth();
      await flush();
      await el.updateComplete;

      // The failure must clear the spinner and surface an error — not hang.
      expect((el as unknown as { oauthPending: boolean }).oauthPending, 'spinner cleared on failure').to.be.false;
      expect((el as unknown as { error: string | null }).error, 'error surfaced').to.be.a('string').and.not.empty;
    });
  });

  describe('Entra OAuth tab UI', () => {
    it('renders a single "Sign in with Microsoft" button with no Client ID or Organization inputs', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { authMethod: string }).authMethod = 'oauth';
      await el.updateComplete;

      const tokenForm = el.shadowRoot!.querySelector('.token-form')!;
      expect(tokenForm).to.not.be.null;

      // The simplified OAuth path has NO inputs (no Client ID, no Organization).
      expect(tokenForm.querySelectorAll('input').length).to.equal(0);

      // Exactly the branded "Sign in with Microsoft" button is present.
      const signInBtn = tokenForm.querySelector('.ms-signin-btn');
      expect(signInBtn).to.not.be.null;
      expect(signInBtn!.textContent?.trim()).to.include('Sign in with Microsoft');
    });

    it('renders an org picker when needsOrgSelection is true with availableOrgs set', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { authMethod: string }).authMethod = 'oauth';
      (el as unknown as { availableOrgs: unknown[] }).availableOrgs = mockAdoOrganizations;
      (el as unknown as { needsOrgSelection: boolean }).needsOrgSelection = true;
      await el.updateComplete;

      const tokenForm = el.shadowRoot!.querySelector('.token-form')!;
      expect(tokenForm.textContent).to.include('Select an organization');

      // One clickable button per available organization.
      const orgButtons = Array.from(tokenForm.querySelectorAll('.btn')).filter((b) =>
        ['contoso', 'fabrikam'].includes(b.textContent?.trim() ?? '')
      );
      expect(orgButtons.length).to.equal(2);

      // The "Sign in with Microsoft" button is hidden while picking.
      expect(tokenForm.querySelector('.ms-signin-btn')).to.be.null;
    });

    it('shows the org picker after sign-in when the org cannot be detected (multiple orgs), and finalizes on selection', async () => {
      connectionResponse = mockConnectedStatus;
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          if (command === 'list_ado_organizations') return mockAdoOrganizations;
          if (command === 'save_global_account') {
            const account = (args as { account?: IntegrationAccount } | undefined)?.account;
            return account ?? null;
          }
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      // No detected repo and no org typed → resolution must fall back to listing orgs.
      (el as unknown as { organizationInput: string }).organizationInput = '';
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = null;
      (el as unknown as { authMethod: string }).authMethod = 'oauth';
      await el.updateComplete;

      // The sign-in completes with a token; org resolution then lists orgs.
      beginPendingFlow(el);
      dispatchOAuthComplete();
      await flush();
      await el.updateComplete;

      expect(invokeHistory.some((h) => h.command === 'list_ado_organizations')).to.be.true;
      expect((el as unknown as { needsOrgSelection: boolean }).needsOrgSelection).to.be.true;

      const orgButtons = Array.from(el.shadowRoot!.querySelectorAll('.btn')).filter((b) =>
        ['contoso', 'fabrikam'].includes(b.textContent?.trim() ?? '')
      );
      expect(orgButtons.length).to.equal(2);

      // Selecting an org verifies the connection and persists a new account.
      invokeHistory.length = 0;
      (orgButtons.find((b) => b.textContent?.trim() === 'fabrikam') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(invokeHistory.some((h) => h.command === 'check_ado_connection')).to.be.true;
      expect(invokeHistory.some((h) => h.command === 'save_global_account')).to.be.true;
      expect(invokeHistory.some((h) => h.command === 'store_keyring_token')).to.be.true;
      expect((el as unknown as { needsOrgSelection: boolean }).needsOrgSelection).to.be.false;
      expect((el as unknown as { organizationInput: string }).organizationInput).to.equal('fabrikam');
    });

    it('Cancel in the org picker returns to the sign-in button without picking an org', async () => {
      connectionResponse = mockDisconnectedStatus;

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { authMethod: string }).authMethod = 'oauth';
      (el as unknown as { availableOrgs: unknown[] }).availableOrgs = mockAdoOrganizations;
      (el as unknown as { needsOrgSelection: boolean }).needsOrgSelection = true;
      (el as unknown as { pendingTokens: unknown }).pendingTokens = { accessToken: 'tok' };
      await el.updateComplete;

      const cancelBtn = Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim() === 'Cancel'
      ) as HTMLButtonElement;
      expect(cancelBtn, 'org picker has a Cancel button').to.not.be.undefined;

      invokeHistory.length = 0;
      cancelBtn.click();
      await el.updateComplete;

      // No account verified/persisted, picker torn down, and the primary button is back.
      expect(invokeHistory.some((h) => h.command === 'check_ado_connection')).to.be.false;
      expect((el as unknown as { needsOrgSelection: boolean }).needsOrgSelection).to.be.false;
      expect((el as unknown as { pendingTokens: unknown }).pendingTokens).to.be.null;
      expect((el as unknown as { availableOrgs: unknown[] }).availableOrgs).to.have.length(0);
      const signInBtn = el.shadowRoot!.querySelector('.token-form .ms-signin-btn');
      expect(signInBtn?.textContent?.trim()).to.include('Sign in with Microsoft');
    });

    it('surfaces an error (not a silent dead-end) when the account has no organizations', async () => {
      connectionResponse = mockConnectedStatus;
      mockInvoke = (() => {
        const orig = mockInvoke;
        return async (command: string, args?: unknown) => {
          if (command === 'get_unified_profiles_config') {
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          }
          if (command === 'list_ado_organizations') return []; // no orgs for this account
          return orig(command, args);
        };
      })();

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { organizationInput: string }).organizationInput = '';
      (el as unknown as { authMethod: string }).authMethod = 'oauth';
      await el.updateComplete;

      beginPendingFlow(el);
      dispatchOAuthComplete();
      await flush();
      await el.updateComplete;

      // Error surfaced, spinner cleared, and no half-finished picker left behind.
      expect((el as unknown as { error: string | null }).error, 'error surfaced').to.be.a('string').and.not.empty;
      expect((el as unknown as { oauthPending: boolean }).oauthPending, 'spinner cleared').to.be.false;
      expect((el as unknown as { needsOrgSelection: boolean }).needsOrgSelection).to.be.false;
      expect(invokeHistory.some((h) => h.command === 'save_global_account')).to.be.false;
    });
  });

  describe('Add account guard', () => {
    it('does not re-select an existing account when a background store emit fires mid-add', async () => {
      connectionResponse = mockConnectedStatus;
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { handleAddAccount: () => void }).handleAddAccount();
      await el.updateComplete;
      expect((el as unknown as { selectedAccountId: string | null }).selectedAccountId).to.equal(null);

      unifiedProfileStore.getState().setAccountConnectionStatus('ado-acc-1', 'connected');
      await el.updateComplete;

      expect((el as unknown as { selectedAccountId: string | null }).selectedAccountId).to.equal(null);
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

  describe('Disconnect / delete clear a stale error (regression)', () => {
    it('handleDisconnect resets a pre-existing error banner', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockConnectedStatus;
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = 'ado-acc-1';
      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      (el as unknown as { error: string | null }).error = 'stale error';
      await el.updateComplete;

      await (el as unknown as { handleDisconnect: () => Promise<void> }).handleDisconnect();
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error).to.equal(null);
    });

    it('handleDeleteIntegration resets a pre-existing error banner', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockConnectedStatus;
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = 'ado-acc-1';
      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      (el as unknown as { error: string | null }).error = 'stale error';
      await el.updateComplete;

      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command.startsWith('plugin:dialog|')) return 'Ok';
        return origMock(command, args);
      };

      await (el as unknown as { handleDeleteIntegration: () => Promise<void> }).handleDeleteIntegration();
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error).to.equal(null);
    });
  });

  describe('PAT-form Delete Integration button (regression)', () => {
    it('is disabled while a request is in flight', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockDisconnectedStatus;
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = 'ado-acc-1';
      (el as unknown as { organizationInput: string }).organizationInput = 'testorg';
      (el as unknown as { isLoading: boolean }).isLoading = true;
      await el.updateComplete;

      const deleteBtn = Array.from(el.shadowRoot!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Delete Integration'
      ) as HTMLButtonElement | undefined;
      expect(deleteBtn, 'Delete Integration button rendered').to.not.be.undefined;
      expect(deleteBtn!.disabled).to.equal(true);
    });
  });

  describe('git credential sync', () => {
    it('writes credentials once per (org, token) and dedupes repeats; re-syncs on change', async () => {
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);
      const api = el as unknown as { syncGitCredentials: (org: string, token: string) => Promise<void> };

      const stores = () => invokeHistory.filter((h) => h.command === 'store_git_credentials').length;

      invokeHistory.length = 0;
      await api.syncGitCredentials('testorg', 'tok-1');
      expect(stores(), 'writes both dev.azure.com and {org}.visualstudio.com').to.equal(2);

      // Same (org, token) → deduped, no new writes.
      await api.syncGitCredentials('testorg', 'tok-1');
      expect(stores(), 'deduped repeat').to.equal(2);

      // A refreshed token re-syncs.
      await api.syncGitCredentials('testorg', 'tok-2');
      expect(stores(), 'new token re-syncs').to.equal(4);

      // A different org re-syncs even with the same token.
      await api.syncGitCredentials('otherorg', 'tok-2');
      expect(stores(), 'new org re-syncs').to.equal(6);
    });
  });

  describe('load-failure feedback', () => {
    it('surfaces an error banner when loading work items fails (parity with other providers)', async () => {
      const el = await fixture<LvAzureDevOpsDialog>(html`
        <lv-azure-devops-dialog .open=${true}></lv-azure-devops-dialog>
      `);
      await waitForLoad(el);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialog = el as any;
      dialog.detectedRepo = { organization: 'org', project: 'proj', repo: 'r' };
      dialog.connectionStatus = { connected: true };
      dialog.error = null;

      mockInvoke = async (command: string) => {
        if (command === 'query_ado_work_items') throw new Error('unauthorized');
        return null;
      };

      await dialog.loadWorkItems('tok');

      expect(dialog.error, 'a failed work-items load is surfaced').to.contain('unauthorized');
    });
  });
});
