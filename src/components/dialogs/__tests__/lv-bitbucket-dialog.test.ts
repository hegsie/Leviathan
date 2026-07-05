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
import * as oauthService from '../../../services/oauth.service.ts';
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
  keyringStore.clear();
  keyringStore.set('bitbucket_token_bb-acc-1', 'bb-app-password-test');

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

    // Regression: the account-selector dispatches a bubbling/composed
    // `manage-accounts` event. The dialog must CONSUME it and re-emit its own,
    // so the host receives EXACTLY ONE event — not the selector's plus the
    // re-dispatch. The double-fire corrupted the manager's reversible-Back state.
    it('forwards manage-accounts to the host exactly once', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const events: CustomEvent[] = [];
      el.addEventListener('manage-accounts', (e) => events.push(e as CustomEvent));

      const selector = el.shadowRoot!.querySelector('lv-account-selector')!;
      selector.dispatchEvent(
        new CustomEvent('manage-accounts', {
          detail: { integrationType: 'bitbucket' },
          bubbles: true,
          composed: true,
        })
      );

      expect(events).to.have.lengthOf(1);
      expect(events[0].detail.integrationType).to.equal('bitbucket');
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

  describe('Create Issue', () => {
    it('shows New Issue button on the Issues tab', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const issuesTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Issues') as HTMLButtonElement;
      issuesTab.click();
      await waitForLoad(el);

      const newIssueBtn = Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New Issue')
      );
      expect(newIssueBtn).to.not.be.undefined;
    });

    it('renders the create-issue form (title + description) when navigated to', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      (Array.from(tabs).find((t) => t.textContent?.trim() === 'Issues') as HTMLButtonElement).click();
      await waitForLoad(el);

      const newIssueBtn = Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New Issue')
      ) as HTMLButtonElement;
      newIssueBtn.click();
      await waitForLoad(el);

      const form = el.shadowRoot!.querySelector('.token-form');
      expect(form).to.not.be.null;
      expect(form!.querySelector('input[type="text"]')).to.not.be.null;
      expect(form!.querySelector('textarea')).to.not.be.null;
    });

    it('submits create_bitbucket_issue with the right args and refreshes the list', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;
      const createdIssue = {
        id: 11,
        title: 'New bug',
        content: 'Something broke',
        state: 'new',
        priority: 'major',
        kind: 'bug',
        reporter: mockBitbucketUser,
        assignee: null,
        createdOn: '2025-02-01T10:00:00Z',
        url: 'https://bitbucket.org/test-workspace/test-repo/issues/11',
      };
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'create_bitbucket_issue') return createdIssue;
        return origMock(command, args);
      };

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      (Array.from(tabs).find((t) => t.textContent?.trim() === 'Issues') as HTMLButtonElement).click();
      await waitForLoad(el);
      (Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New Issue')
      ) as HTMLButtonElement).click();
      await waitForLoad(el);

      const titleInput = el.shadowRoot!.querySelector('.token-form input[type="text"]') as HTMLInputElement;
      titleInput.value = 'New bug';
      titleInput.dispatchEvent(new Event('input'));
      const textarea = el.shadowRoot!.querySelector('.token-form textarea') as HTMLTextAreaElement;
      textarea.value = 'Something broke';
      textarea.dispatchEvent(new Event('input'));
      await el.updateComplete;

      invokeHistory.length = 0;
      const createBtn = Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim() === 'Create Issue'
      ) as HTMLButtonElement;
      createBtn.click();
      await waitForLoad(el);

      const createCall = invokeHistory.find((c) => c.command === 'create_bitbucket_issue');
      expect(createCall, 'create_bitbucket_issue should be invoked').to.not.be.undefined;
      const callArgs = createCall!.args as Record<string, unknown>;
      expect(callArgs.workspace).to.equal('test-workspace');
      expect(callArgs.repoSlug).to.equal('test-repo');
      const input = callArgs.input as Record<string, unknown>;
      expect(input.title).to.equal('New bug');
      expect(input.content).to.equal('Something broke');

      // Returns to issues list and reloads
      expect(invokeHistory.some((c) => c.command === 'list_bitbucket_issues')).to.be.true;
    });

    it('shows an error when create_bitbucket_issue fails (not silent)', async () => {
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'create_bitbucket_issue') throw new Error('Issue tracker disabled');
        return origMock(command, args);
      };

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      (Array.from(tabs).find((t) => t.textContent?.trim() === 'Issues') as HTMLButtonElement).click();
      await waitForLoad(el);
      (Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim().includes('New Issue')
      ) as HTMLButtonElement).click();
      await waitForLoad(el);

      const titleInput = el.shadowRoot!.querySelector('.token-form input[type="text"]') as HTMLInputElement;
      titleInput.value = 'Will fail';
      titleInput.dispatchEvent(new Event('input'));
      await el.updateComplete;

      (Array.from(el.shadowRoot!.querySelectorAll('.btn')).find(
        (b) => b.textContent?.trim() === 'Create Issue'
      ) as HTMLButtonElement).click();
      await waitForLoad(el);

      const errorBanner = el.shadowRoot!.querySelector('.error');
      expect(errorBanner).to.not.be.null;
      expect(errorBanner!.textContent).to.include('Issue tracker disabled');
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

    it('surfaces a backend error when repo detection fails (not silent)', async () => {
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'detect_bitbucket_repo') throw new Error('bitbucket detect boom');
        return origMock(command, args);
      };

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error).to.include('bitbucket detect boom');
    });
  });

  describe('Delete & Disconnect', () => {
    async function openConnectedDialog(): Promise<LvBitbucketDialog> {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockConnectedStatus;
      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = 'bb-acc-1';
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

  describe('OAuth failure is surfaced (not a silent dead-end)', () => {
    it('shows an error and a toast when the OAuth flow errors', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'get_unified_profiles_config') {
          return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
        }
        if (command === 'oauth_get_authorize_url') {
          throw new Error('Authorize URL request failed');
        }
        return null;
      };

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await el.updateComplete;

      uiStore.getState().toasts.length = 0;
      await oauthService.startOAuth('bitbucket', 'test-client-id');
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error, 'error surfaced').to.be.a('string').and.not.empty;
      expect(uiStore.getState().toasts.some((t) => t.type === 'error'), 'error toast shown').to.be.true;
    });
  });

  describe('Add account guard', () => {
    it('does not re-select an existing account when a background store emit fires mid-add', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { handleAddAccount: () => void }).handleAddAccount();
      await el.updateComplete;
      expect((el as unknown as { selectedAccountId: string | null }).selectedAccountId).to.equal(null);

      unifiedProfileStore.getState().setAccountConnectionStatus('bb-acc-1', 'connected');
      await el.updateComplete;

      expect((el as unknown as { selectedAccountId: string | null }).selectedAccountId).to.equal(null);
    });

    it('creates a NEW account (not clobbering an existing same-workspace account) on OAuth complete when adding', async () => {
      connectionResponse = mockConnectedStatus;
      // Existing account uses workspace 'bbuser' — which is exactly what the
      // OAuth-complete handler derives from the signed-in user (no repo detected).
      // Adding a second identity must not match/overwrite it.
      const existing = createTestAccount({
        id: 'bb-acc-existing',
        name: 'First Bitbucket',
        integrationType: 'bitbucket',
        config: { type: 'bitbucket', workspace: 'bbuser' },
        isDefault: true,
        cachedUser: { username: 'bbuser', displayName: 'BB User', avatarUrl: null, email: null },
      });
      unifiedProfileStore.getState().setAccounts([existing]);

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { handleAddAccount: () => void }).handleAddAccount();
      await el.updateComplete;

      invokeHistory.length = 0;
      window.dispatchEvent(
        new CustomEvent('oauth-complete', {
          detail: { provider: 'bitbucket', tokens: { accessToken: 'bbp_oauth_2' } },
        })
      );
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      const saveCall = invokeHistory.find((h) => h.command === 'save_global_account');
      expect(saveCall, 'save_global_account was called').to.not.be.undefined;
      const account = (saveCall!.args as Record<string, unknown>).account as IntegrationAccount;
      expect(account.id).to.not.equal('bb-acc-existing');
      expect((account.config as Record<string, unknown>).type).to.equal('bitbucket');
    });
  });

  describe('App Password Basic-auth routing (regression)', () => {
    // Regression: app-password accounts broke after the first session because the
    // raw app password was stored in the per-account token slot and re-sent as a
    // Bearer token (Bitbucket rejects app passwords as Bearer). App-password
    // credentials must be stored prefixed (`bbapp:<user>:<pass>`) so the backend
    // routes them through Basic auth on the connection check AND every API call.
    it('reopen: passes the prefixed app-password credential to the connection check', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockConnectedStatus;
      // Simulate a previously-saved app-password account: the stored token slot
      // holds the prefixed credential, not a raw OAuth bearer token.
      keyringStore.set('bitbucket_token_bb-acc-1', 'bbapp:bbuser:app-secret-123');

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const check = invokeHistory.find((c) => c.command === 'check_bitbucket_connection_with_token');
      expect(check, 'connection check ran with token').to.not.be.undefined;
      // The prefixed credential is what the backend detects to build Basic auth.
      expect((check!.args as Record<string, unknown>).token).to.equal('bbapp:bbuser:app-secret-123');
    });

    it('reopen: passes the prefixed credential to loadPullRequests (Basic auth for API calls)', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;
      keyringStore.set('bitbucket_token_bb-acc-1', 'bbapp:bbuser:app-secret-123');

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      const prCall = invokeHistory.find((c) => c.command === 'list_bitbucket_pull_requests');
      expect(prCall, 'PRs were loaded').to.not.be.undefined;
      expect((prCall!.args as Record<string, unknown>).token).to.equal('bbapp:bbuser:app-secret-123');
    });

    it('save: stores the app password with the bbapp: prefix (not the raw password)', async () => {
      // No accounts: the save flow creates a new account and stores its token.
      unifiedProfileStore.getState().setAccounts([]);
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { usernameInput: string }).usernameInput = 'bbuser';
      (el as unknown as { appPasswordInput: string }).appPasswordInput = 'raw-app-pass';

      invokeHistory.length = 0;
      await (el as unknown as { handleSaveCredentials: () => Promise<void> }).handleSaveCredentials();
      await el.updateComplete;

      // The per-account token slot (bitbucket_token_*) must hold the prefixed
      // credential, never the raw app password on its own.
      const tokenWrite = invokeHistory.find(
        (c) =>
          c.command === 'store_keyring_token' &&
          typeof (c.args as Record<string, string>).key === 'string' &&
          (c.args as Record<string, string>).key.startsWith('bitbucket_token_')
      );
      expect(tokenWrite, 'account token was stored').to.not.be.undefined;
      const value = (tokenWrite!.args as Record<string, string>).value;
      expect(value).to.equal('bbapp:bbuser:raw-app-pass');
    });
  });

  describe('Legacy app-password migration (raw -> bbapp:)', () => {
    // Regression: accounts saved BEFORE the bbapp: prefix fix stored the RAW app
    // password as the token. The backend now sends unprefixed tokens as Bearer, so
    // those accounts fail the connection check and look permanently disconnected.
    // On a FAILED check, retry with `bbapp:<username>:<token>` and, on success,
    // re-store the prefixed credential.

    it('reconnects a legacy raw-token account by retrying with the prefixed credential', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      keyringStore.clear();
      keyringStore.set('bitbucket_token_bb-acc-1', 'raw-legacy-pass');

      // Raw token fails; only the prefixed credential connects.
      mockInvoke = async (command: string, args?: unknown) => {
        const params = args as Record<string, string> | undefined;
        if (command === 'get_keyring_token') return keyringStore.get(params!.key) ?? null;
        if (command === 'store_keyring_token') {
          keyringStore.set(params!.key, params!.value);
          return null;
        }
        if (command === 'delete_keyring_token') { keyringStore.delete(params!.key); return null; }
        if (command === 'get_unified_profiles_config') {
          return { version: 3, profiles: [], accounts: [mockAccount], repositoryAssignments: {} };
        }
        if (command === 'load_unified_profile_for_repository') return null;
        if (command === 'update_global_account_cached_user') return null;
        if (command === 'check_bitbucket_connection_with_token') {
          return params!.token === 'bbapp:bbuser:raw-legacy-pass'
            ? mockConnectedStatus
            : mockDisconnectedStatus;
        }
        if (command === 'check_bitbucket_connection') return mockDisconnectedStatus;
        return null;
      };

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      // Now reports connected via the migrated credential.
      expect((el as unknown as { connectionStatus: { connected: boolean } | null }).connectionStatus?.connected)
        .to.be.true;
      // The prefixed credential is adopted for subsequent API calls.
      expect((el as unknown as { oauthToken: string | null }).oauthToken)
        .to.equal('bbapp:bbuser:raw-legacy-pass');
      // And it was persisted back to the account token slot.
      expect(keyringStore.get('bitbucket_token_bb-acc-1')).to.equal('bbapp:bbuser:raw-legacy-pass');
    });

    it('does NOT rewrite an OAuth (Bearer) token that connects on the first check', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      keyringStore.clear();
      keyringStore.set('bitbucket_token_bb-acc-1', 'oauth-bearer-token');

      // Any token connects (simulates a valid OAuth bearer) — no migration needed.
      mockInvoke = async (command: string, args?: unknown) => {
        const params = args as Record<string, string> | undefined;
        if (command === 'get_keyring_token') return keyringStore.get(params!.key) ?? null;
        if (command === 'store_keyring_token') { keyringStore.set(params!.key, params!.value); return null; }
        if (command === 'delete_keyring_token') { keyringStore.delete(params!.key); return null; }
        if (command === 'get_unified_profiles_config') {
          return { version: 3, profiles: [], accounts: [mockAccount], repositoryAssignments: {} };
        }
        if (command === 'load_unified_profile_for_repository') return null;
        if (command === 'update_global_account_cached_user') return null;
        if (command === 'check_bitbucket_connection_with_token') return mockConnectedStatus;
        if (command === 'check_bitbucket_connection') return mockConnectedStatus;
        return null;
      };

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      expect((el as unknown as { connectionStatus: { connected: boolean } | null }).connectionStatus?.connected)
        .to.be.true;
      // The OAuth token is untouched — never rewritten to a bbapp: credential.
      expect((el as unknown as { oauthToken: string | null }).oauthToken).to.equal('oauth-bearer-token');
      expect(keyringStore.get('bitbucket_token_bb-acc-1')).to.equal('oauth-bearer-token');
      // No re-store to a prefixed credential happened.
      const bbappWrite = invokeHistory.find(
        (h) => h.command === 'store_keyring_token' &&
          typeof (h.args as Record<string, string>).value === 'string' &&
          (h.args as Record<string, string>).value.startsWith('bbapp:')
      );
      expect(bbappWrite, 'no bbapp re-store for OAuth token').to.be.undefined;
    });

    it('leaves the account disconnected when the prefixed retry also fails', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      keyringStore.clear();
      keyringStore.set('bitbucket_token_bb-acc-1', 'raw-legacy-pass');

      // Both raw and prefixed fail (e.g. genuinely revoked credential).
      mockInvoke = async (command: string, args?: unknown) => {
        const params = args as Record<string, string> | undefined;
        if (command === 'get_keyring_token') return keyringStore.get(params!.key) ?? null;
        if (command === 'store_keyring_token') { keyringStore.set(params!.key, params!.value); return null; }
        if (command === 'delete_keyring_token') { keyringStore.delete(params!.key); return null; }
        if (command === 'get_unified_profiles_config') {
          return { version: 3, profiles: [], accounts: [mockAccount], repositoryAssignments: {} };
        }
        if (command === 'load_unified_profile_for_repository') return null;
        if (command === 'update_global_account_cached_user') return null;
        if (command === 'check_bitbucket_connection_with_token') return mockDisconnectedStatus;
        if (command === 'check_bitbucket_connection') return mockDisconnectedStatus;
        return null;
      };

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      expect((el as unknown as { connectionStatus: { connected: boolean } | null }).connectionStatus?.connected)
        .to.be.false;
      // The raw token is NOT overwritten when the retry fails.
      expect(keyringStore.get('bitbucket_token_bb-acc-1')).to.equal('raw-legacy-pass');
    });
  });

  describe('Create PR feedback', () => {
    it('shows a success toast after creating a pull request', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockConnectedStatus;
      detectedRepoResponse = mockDetectedRepo;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true} .repositoryPath=${'/mock/repo'}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);

      (el as unknown as { activeTab: string }).activeTab = 'create-pr';
      (el as unknown as { createPrTitle: string }).createPrTitle = 'My PR';
      (el as unknown as { createPrSource: string }).createPrSource = 'feature/x';
      (el as unknown as { createPrDestination: string }).createPrDestination = 'main';
      await el.updateComplete;

      uiStore.getState().toasts.length = 0;
      await (el as unknown as { handleCreatePr: () => Promise<void> }).handleCreatePr();
      await el.updateComplete;

      const toasts = uiStore.getState().toasts;
      expect(
        toasts.some((t) => t.type === 'success' && /Pull request created successfully/.test(t.message))
      ).to.be.true;
    });
  });

  describe('Disconnect clears a stale error', () => {
    it('handleDisconnect resets a pre-existing error banner', async () => {
      unifiedProfileStore.getState().setAccounts([mockAccount]);
      connectionResponse = mockConnectedStatus;

      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${true}></lv-bitbucket-dialog>
      `);
      await waitForLoad(el);
      (el as unknown as { selectedAccountId: string | null }).selectedAccountId = 'bb-acc-1';
      (el as unknown as { error: string | null }).error = 'stale error from before';
      await el.updateComplete;

      await (el as unknown as { handleDisconnect: () => Promise<void> }).handleDisconnect();
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error).to.equal(null);
    });
  });

  describe('OAuth completes after dialog closed', () => {
    it('persists the account and surfaces a toast instead of failing silently', async () => {
      connectionResponse = mockConnectedStatus;
      const el = await fixture<LvBitbucketDialog>(html`
        <lv-bitbucket-dialog .open=${false}></lv-bitbucket-dialog>
      `);
      await el.updateComplete;

      uiStore.getState().toasts.length = 0;
      invokeHistory.length = 0;

      window.dispatchEvent(
        new CustomEvent('oauth-complete', {
          detail: { provider: 'bitbucket', tokens: { accessToken: 'bbp_oauth' } },
        })
      );
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      const persisted = invokeHistory.filter(
        (h) => h.command === 'save_global_account' || h.command === 'store_keyring_token'
      );
      expect(persisted.length).to.be.greaterThan(0);

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'success' && /Connected Bitbucket/.test(t.message))).to.be.true;
    });
  });
});
