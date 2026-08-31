import { expect } from '@open-wc/testing';
import {
  parseIssueReferences,
  isClosingKeyword,
  getAdoToken,
  fetch as gitFetch,
  resetAdoGitCredentialSyncCache,
} from '../git.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import { createEmptyIntegrationAccount } from '../../types/unified-profile.types.ts';
import type { IntegrationAccount } from '../../types/unified-profile.types.ts';

// Mock Tauri API for tests that need invokeCommand
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    return mockInvoke(command, args);
  },
};

describe('git.service - parseIssueReferences', () => {
  it('parses standalone issue references', () => {
    const refs = parseIssueReferences('This references #123');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(123);
    expect(refs[0].keyword).to.be.null;
    expect(refs[0].fullMatch).to.equal('#123');
  });

  it('parses multiple issue references', () => {
    const refs = parseIssueReferences('See #123 and #456');
    expect(refs.length).to.equal(2);
    expect(refs[0].number).to.equal(123);
    expect(refs[1].number).to.equal(456);
  });

  it('parses "fixes" keyword', () => {
    const refs = parseIssueReferences('fixes #123');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(123);
    expect(refs[0].keyword).to.equal('fixes');
  });

  it('parses "closes" keyword', () => {
    const refs = parseIssueReferences('closes #456');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(456);
    expect(refs[0].keyword).to.equal('closes');
  });

  it('parses "resolves" keyword', () => {
    const refs = parseIssueReferences('resolves #789');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(789);
    expect(refs[0].keyword).to.equal('resolves');
  });

  it('parses mixed keywords and standalone references', () => {
    const refs = parseIssueReferences('fixes #123, see also #456 and closes #789');
    expect(refs.length).to.equal(3);
    expect(refs[0].number).to.equal(123);
    expect(refs[0].keyword).to.equal('fixes');
    expect(refs[1].number).to.equal(789);
    expect(refs[1].keyword).to.equal('closes');
    expect(refs[2].number).to.equal(456);
    expect(refs[2].keyword).to.be.null;
  });

  it('is case insensitive for keywords', () => {
    const refs = parseIssueReferences('FIXES #123 Closes #456 ResolVes #789');
    expect(refs.length).to.equal(3);
    expect(refs[0].keyword).to.equal('fixes');
    expect(refs[1].keyword).to.equal('closes');
    expect(refs[2].keyword).to.equal('resolves');
  });

  it('handles past tense keywords', () => {
    const refs = parseIssueReferences('fixed #123 closed #456 resolved #789');
    expect(refs.length).to.equal(3);
    expect(refs[0].keyword).to.equal('fixed');
    expect(refs[1].keyword).to.equal('closed');
    expect(refs[2].keyword).to.equal('resolved');
  });

  it('returns empty array for text without references', () => {
    const refs = parseIssueReferences('No issues here');
    expect(refs.length).to.equal(0);
  });

  it('does not duplicate issue numbers', () => {
    const refs = parseIssueReferences('fixes #123 and also #123');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(123);
  });

  it('handles multiline commit messages', () => {
    const message = `feat: add new feature

fixes #123
closes #456

Related to #789`;
    const refs = parseIssueReferences(message);
    expect(refs.length).to.equal(3);
  });
});

describe('git.service - isClosingKeyword', () => {
  it('returns true for "fixes"', () => {
    expect(isClosingKeyword('fixes')).to.be.true;
  });

  it('returns true for "closes"', () => {
    expect(isClosingKeyword('closes')).to.be.true;
  });

  it('returns true for "resolves"', () => {
    expect(isClosingKeyword('resolves')).to.be.true;
  });

  it('returns true for past tense variants', () => {
    expect(isClosingKeyword('fixed')).to.be.true;
    expect(isClosingKeyword('closed')).to.be.true;
    expect(isClosingKeyword('resolved')).to.be.true;
  });

  it('returns true for base form variants', () => {
    expect(isClosingKeyword('fix')).to.be.true;
    expect(isClosingKeyword('close')).to.be.true;
    expect(isClosingKeyword('resolve')).to.be.true;
  });

  it('returns false for null', () => {
    expect(isClosingKeyword(null)).to.be.false;
  });

  it('returns false for non-closing keywords', () => {
    expect(isClosingKeyword('see')).to.be.false;
    expect(isClosingKeyword('related')).to.be.false;
    expect(isClosingKeyword('ref')).to.be.false;
  });

  it('is case insensitive', () => {
    expect(isClosingKeyword('FIXES')).to.be.true;
    expect(isClosingKeyword('Closes')).to.be.true;
    expect(isClosingKeyword('RESOLVES')).to.be.true;
  });
});

describe('git.service - Tauri command invocations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    // Reset mock to return success by default
    mockInvoke = () => Promise.resolve({ success: true, data: null });
  });

  it('openRepository calls open_repository with correct args', async () => {
    const { openRepository } = await import('../git.service.ts');
    await openRepository({ path: '/test/path' });
    expect(lastInvokedCommand).to.equal('open_repository');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/path' });
  });

  it('getBranches calls get_branches with path', async () => {
    const { getBranches } = await import('../git.service.ts');
    await getBranches('/test/repo');
    expect(lastInvokedCommand).to.equal('get_branches');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('createBranch calls create_branch with correct args', async () => {
    const { createBranch } = await import('../git.service.ts');
    await createBranch('/test/repo', { name: 'feature-branch', startPoint: 'main', checkout: true });
    expect(lastInvokedCommand).to.equal('create_branch');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      name: 'feature-branch',
      startPoint: 'main',
      checkout: true,
    });
  });

  it('deleteBranch calls delete_branch with force option', async () => {
    const { deleteBranch } = await import('../git.service.ts');
    await deleteBranch('/test/repo', 'old-branch', true);
    expect(lastInvokedCommand).to.equal('delete_branch');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', name: 'old-branch', force: true });
  });

  it('getStatus calls get_status with path', async () => {
    const { getStatus } = await import('../git.service.ts');
    await getStatus('/test/repo');
    expect(lastInvokedCommand).to.equal('get_status');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('getTags calls get_tags with path', async () => {
    const { getTags } = await import('../git.service.ts');
    await getTags('/test/repo');
    expect(lastInvokedCommand).to.equal('get_tags');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('describeCommit passes camelCase params to Tauri', async () => {
    const { describeCommit } = await import('../git.service.ts');
    await describeCommit('/test/repo', {
      commitish: 'abc1234',
      tags: true,
      matchPattern: 'v*',
      excludePattern: '*-rc*',
      firstParent: true,
      dirty: false,
    });
    expect(lastInvokedCommand).to.equal('describe');
    // Tauri converts these to Rust's match_pattern/exclude_pattern/first_parent
    // itself — a snake_case key here would arrive as an unknown argument.
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      commitish: 'abc1234',
      tags: true,
      all: undefined,
      long: undefined,
      abbrev: undefined,
      matchPattern: 'v*',
      excludePattern: '*-rc*',
      firstParent: true,
      dirty: false,
    });
  });

  it('getStashes calls get_stashes with path', async () => {
    const { getStashes } = await import('../git.service.ts');
    await getStashes('/test/repo');
    expect(lastInvokedCommand).to.equal('get_stashes');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('compareBranches passes camelCase option flags to Tauri', async () => {
    const { compareBranches } = await import('../git.service.ts');
    await compareBranches('/test/repo', 'main', 'feature', {
      includeCommits: true,
      includeFiles: true,
    });
    expect(lastInvokedCommand).to.equal('compare_branches');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      base: 'main',
      compare: 'feature',
      includeCommits: true,
      includeFiles: true,
    });
  });

  it('compareBranches defaults both option flags to false', async () => {
    const { compareBranches } = await import('../git.service.ts');
    await compareBranches('/test/repo', 'main', 'feature');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      base: 'main',
      compare: 'feature',
      includeCommits: false,
      includeFiles: false,
    });
  });

  it('getRemotes calls get_remotes with path', async () => {
    const { getRemotes } = await import('../git.service.ts');
    await getRemotes('/test/repo');
    expect(lastInvokedCommand).to.equal('get_remotes');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('searchCommits passes camelCase params to Tauri', async () => {
    const { searchCommits } = await import('../git.service.ts');
    await searchCommits('/test/repo', {
      query: 'search',
      author: 'user',
      dateFrom: 1000,
      dateTo: 2000,
      filePath: 'file.ts',
      limit: 50,
    });
    expect(lastInvokedCommand).to.equal('search_commits');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      query: 'search',
      author: 'user',
      dateFrom: 1000,
      dateTo: 2000,
      filePath: 'file.ts',
      branch: undefined,
      limit: 50,
    });
  });

  it('amendCommit calls amend_commit with message and resetAuthor', async () => {
    const { amendCommit } = await import('../git.service.ts');
    await amendCommit('/test/repo', { message: 'New message', resetAuthor: true });
    expect(lastInvokedCommand).to.equal('amend_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      message: 'New message',
      resetAuthor: true,
      signAmend: undefined,
    });
  });

  it('amendCommit calls amend_commit with only message', async () => {
    const { amendCommit } = await import('../git.service.ts');
    await amendCommit('/test/repo', { message: 'Updated message' });
    expect(lastInvokedCommand).to.equal('amend_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      message: 'Updated message',
      resetAuthor: undefined,
      signAmend: undefined,
    });
  });

  it('amendCommit calls amend_commit without args', async () => {
    const { amendCommit } = await import('../git.service.ts');
    await amendCommit('/test/repo');
    expect(lastInvokedCommand).to.equal('amend_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      message: undefined,
      resetAuthor: undefined,
      signAmend: undefined,
    });
  });

  it('amendCommit calls amend_commit with signAmend', async () => {
    const { amendCommit } = await import('../git.service.ts');
    await amendCommit('/test/repo', { message: 'Signed amend', signAmend: true });
    expect(lastInvokedCommand).to.equal('amend_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      message: 'Signed amend',
      resetAuthor: undefined,
      signAmend: true,
    });
  });

  it('getCommitMessage calls get_commit_message with path and oid', async () => {
    const { getCommitMessage } = await import('../git.service.ts');
    await getCommitMessage('/test/repo', 'abc123');
    expect(lastInvokedCommand).to.equal('get_commit_message');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      oid: 'abc123',
    });
  });

  it('rewordCommit calls reword_commit with path, oid, and message', async () => {
    const { rewordCommit } = await import('../git.service.ts');
    await rewordCommit('/test/repo', 'abc123', 'Reworded message');
    expect(lastInvokedCommand).to.equal('reword_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      oid: 'abc123',
      message: 'Reworded message',
    });
  });

  it('getSigningStatus calls get_signing_status with path', async () => {
    const { getSigningStatus } = await import('../git.service.ts');
    await getSigningStatus('/test/repo');
    expect(lastInvokedCommand).to.equal('get_signing_status');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
    });
  });
});

describe('git.service - getAdoToken refresh wiring', () => {
  const keyring = new Map<string, string>();

  afterEach(() => {
    unifiedProfileStore.getState().reset();
    mockInvoke = () => Promise.resolve(null);
  });

  it('refreshes an expiring Entra OAuth token for the default azure-devops account', async () => {
    const account: IntegrationAccount = {
      ...createEmptyIntegrationAccount('azure-devops', 'myorg'),
      id: 'ado-1',
      isDefault: true,
    };
    unifiedProfileStore.getState().setAccounts([account]);

    const key = 'azure-devops_token_ado-1';
    keyring.clear();
    keyring.set(key, 'old-access');
    // Bundle within the 5-minute refresh window (expires ~1s out).
    keyring.set(`${key}_oauth`, JSON.stringify({
      accessToken: 'old-access',
      refreshToken: 'r1',
      expiresAt: Date.now() + 1000,
    }));

    let refreshCalled = false;
    mockInvoke = async (command: string, args?: unknown) => {
      const a = args as Record<string, unknown> | undefined;
      if (command === 'get_keyring_token') return keyring.get(a!.key as string) ?? null;
      if (command === 'store_keyring_token') { keyring.set(a!.key as string, a!.value as string); return null; }
      if (command === 'oauth_refresh_token') {
        refreshCalled = true;
        return { accessToken: 'new-access', refreshToken: 'r2', expiresIn: 3600 };
      }
      return null;
    };

    const result = await getAdoToken();
    expect(result.success).to.be.true;
    expect(result.data, 'returns the refreshed token').to.equal('new-access');
    expect(refreshCalled, 'refresh grant was used').to.be.true;
  });
});

describe('git.service - getRepoToken keyring sync (via fetch)', () => {
  const keyring = new Map<string, string>();

  function setupAdoAccount(accountOrg: string) {
    const account: IntegrationAccount = {
      ...createEmptyIntegrationAccount('azure-devops', accountOrg),
      id: 'ado-1',
      isDefault: true,
    };
    unifiedProfileStore.getState().setAccounts([account]);
    const key = 'azure-devops_token_ado-1';
    keyring.clear();
    keyring.set(key, 'tok');
    // Expiry an hour out — well past the 5-minute refresh threshold, so
    // getFreshAccountToken returns the stored token without refreshing.
    keyring.set(`${key}_oauth`, JSON.stringify({
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
    }));
  }

  /** Mock invoke: GH repo absent, ADO repo in `repoOrg`, keyring-backed, fetch ok. */
  function installMock(repoOrg: string, credWrites: string[]) {
    mockInvoke = async (command: string, args?: unknown) => {
      const a = args as Record<string, unknown> | undefined;
      if (command === 'detect_github_repo') return null;
      if (command === 'detect_gitlab_repo') return null;
      if (command === 'detect_ado_repo') {
        return { organization: repoOrg, project: 'p', repository: 'repo', remoteName: 'origin' };
      }
      if (command === 'get_keyring_token') return keyring.get(a!.key as string) ?? null;
      if (command === 'store_keyring_token') { keyring.set(a!.key as string, a!.value as string); return null; }
      if (command === 'store_git_credentials') { credWrites.push(a!.url as string); return null; }
      if (command === 'fetch') return null;
      return null;
    };
  }

  afterEach(() => {
    unifiedProfileStore.getState().reset();
    resetAdoGitCredentialSyncCache();
    mockInvoke = () => Promise.resolve(null);
  });

  it('syncs keyring git credentials when the default account org matches the repo org', async () => {
    setupAdoAccount('myorg');
    const credWrites: string[] = [];
    installMock('myorg', credWrites);

    await gitFetch({ path: '/repo', silent: true });

    expect(credWrites).to.include('https://dev.azure.com');
    expect(credWrites).to.include('https://myorg.visualstudio.com');
  });

  it('does NOT sync when the default account org differs from the repo org', async () => {
    setupAdoAccount('myorg');
    const credWrites: string[] = [];
    installMock('otherorg', credWrites); // repo is in a different org than the account

    await gitFetch({ path: '/repo', silent: true });

    expect(credWrites, 'no keyring write for a mismatched org').to.have.length(0);
  });

  it('dedupes repeat syncs and re-syncs after resetAdoGitCredentialSyncCache', async () => {
    setupAdoAccount('myorg');
    const credWrites: string[] = [];
    installMock('myorg', credWrites);

    await gitFetch({ path: '/repo', silent: true });
    expect(credWrites).to.have.length(2);

    // Same (org, token) → deduped, no new writes.
    await gitFetch({ path: '/repo', silent: true });
    expect(credWrites, 'deduped repeat').to.have.length(2);

    // After a reset (mirrors disconnect/delete), the next call re-writes.
    resetAdoGitCredentialSyncCache();
    await gitFetch({ path: '/repo', silent: true });
    expect(credWrites, 're-synced after reset').to.have.length(4);
  });
});

describe('git.service - getRepoToken repo-aware account resolution', () => {
  const keyring = new Map<string, string>();
  /** The token `fetch` actually sent to the backend — i.e. the one that authenticates. */
  let fetchToken: string | undefined;
  /** Args the backend resolver was invoked with, or null when it was never called. */
  let resolverArgs: Record<string, unknown> | null;
  let credWrites: string[];

  const GH_REPO = { owner: 'acme', repo: 'app', remoteName: 'origin' };
  const GH_URL = 'https://github.com/acme/app.git';

  /** Keyring entries for an account, with an OAuth expiry an hour out — well past the 5-minute refresh threshold (→ no refresh). */
  function seedToken(integrationType: string, accountId: string, token: string) {
    const key = `${integrationType}_token_${accountId}`;
    keyring.set(key, token);
    keyring.set(`${key}_oauth`, JSON.stringify({
      accessToken: token,
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
    }));
  }

  /** Simulates an account whose keyring entry is gone (revoked, or a fresh machine). */
  function clearToken(integrationType: string, accountId: string) {
    const key = `${integrationType}_token_${accountId}`;
    keyring.delete(key);
    keyring.delete(`${key}_oauth`);
  }

  interface MockOptions {
    detectGitHub?: unknown;
    detectAdo?: unknown;
    detectGitLab?: unknown;
    remoteUrl?: string;
    remotes?: Array<{ name: string; url: string; pushUrl: string | null }>;
    /** null → no profile assigned; 'throw' → the profile lookup fails. */
    assignedProfile?: { id: string } | null | 'throw';
    /** What the backend resolver returns; 'throw' → the command fails. */
    preferredAccount?: IntegrationAccount | null | 'throw';
    /** The remote `fetch` resolves when the caller names none. */
    fetchRemote?: string;
  }

  function installMock(opts: MockOptions) {
    mockInvoke = async (command: string, args?: unknown) => {
      const a = args as Record<string, unknown> | undefined;
      // `fetch` resolves the repo's fetch remote before picking a credential,
      // and only takes the remote-scoped token path when it has one. Leaving
      // this unmocked sent every assertion below down a branch the real
      // toolbar and background fetches no longer use.
      if (command === 'get_fetch_remote') return opts.fetchRemote ?? 'origin';
      if (command === 'detect_github_repo') return opts.detectGitHub ?? null;
      if (command === 'detect_ado_repo') return opts.detectAdo ?? null;
      if (command === 'detect_gitlab_repo') return opts.detectGitLab ?? null;
      if (command === 'get_remotes') {
        return opts.remotes ?? [{ name: 'origin', url: opts.remoteUrl ?? GH_URL, pushUrl: null }];
      }
      if (command === 'get_assigned_unified_profile') {
        if (opts.assignedProfile === 'throw') throw new Error('profile lookup failed');
        return opts.assignedProfile ?? null;
      }
      if (command === 'get_repository_preferred_account') {
        resolverArgs = a ?? null;
        if (opts.preferredAccount === 'throw') throw new Error('resolver unavailable');
        return opts.preferredAccount ?? null;
      }
      if (command === 'get_keyring_token') return keyring.get(a!.key as string) ?? null;
      if (command === 'store_keyring_token') { keyring.set(a!.key as string, a!.value as string); return null; }
      if (command === 'store_git_credentials') { credWrites.push(a!.url as string); return null; }
      if (command === 'fetch') { fetchToken = a?.token as string | undefined; return null; }
      return null;
    };
  }

  /** Personal is the global default; work is only reachable via repo-aware resolution. */
  function setupGitHubAccounts() {
    const personal: IntegrationAccount = {
      ...createEmptyIntegrationAccount('github'),
      id: 'gh-personal',
      isDefault: true,
    };
    const work: IntegrationAccount = {
      ...createEmptyIntegrationAccount('github'),
      id: 'gh-work',
      isDefault: false,
    };
    unifiedProfileStore.getState().setAccounts([personal, work]);
    keyring.clear();
    seedToken('github', 'gh-personal', 'personal-tok');
    seedToken('github', 'gh-work', 'work-tok');
    return { personal, work };
  }

  beforeEach(() => {
    fetchToken = undefined;
    resolverArgs = null;
    credWrites = [];
  });

  afterEach(() => {
    unifiedProfileStore.getState().reset();
    resetAdoGitCredentialSyncCache();
    mockInvoke = () => Promise.resolve(null);
  });

  it("uses the repo's assigned-profile account, not the global default", async () => {
    const { work } = setupGitHubAccounts();
    installMock({
      detectGitHub: GH_REPO,
      assignedProfile: { id: 'profile-work' },
      preferredAccount: work,
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken, "the work repo's own account authenticates").to.equal('work-tok');
  });

  it("passes the assigned profile id and the repo's remote URL to the resolver", async () => {
    const { work } = setupGitHubAccounts();
    installMock({
      detectGitHub: GH_REPO,
      assignedProfile: { id: 'profile-work' },
      preferredAccount: work,
    });

    await gitFetch({ path: '/repo', silent: true });

    // The repo URL is what feeds the account-urlPatterns tier of the resolver.
    expect(resolverArgs).to.deep.equal({
      profileId: 'profile-work',
      integrationType: 'github',
      repoUrl: GH_URL,
    });
  });

  it('scopes provider detection and account resolution to the requested remote', async () => {
    const { work } = setupGitHubAccounts();
    const upstreamUrl = 'https://github.com/acme/upstream.git';
    let detectedRemote: unknown;
    installMock({
      detectGitHub: { owner: 'acme', repo: 'upstream', remoteName: 'upstream' },
      remotes: [
        { name: 'origin', url: GH_URL, pushUrl: null },
        { name: 'upstream', url: upstreamUrl, pushUrl: null },
      ],
      assignedProfile: { id: 'profile-work' },
      preferredAccount: work,
    });
    const baseInvoke = mockInvoke;
    mockInvoke = async (command: string, args?: unknown) => {
      if (command === 'detect_github_repo') {
        detectedRemote = (args as Record<string, unknown>).remoteName;
      }
      return baseInvoke(command, args);
    };

    await gitFetch({ path: '/repo', remote: 'upstream', silent: true });

    expect(detectedRemote).to.equal('upstream');
    expect(resolverArgs).to.deep.equal({
      profileId: 'profile-work',
      integrationType: 'github',
      repoUrl: upstreamUrl,
    });
    expect(fetchToken).to.equal('work-tok');
  });

  it("withholds the token when the fetch remote is on a different host from the account's", async () => {
    // A fork setup: `origin` is the GitHub repo the account belongs to,
    // `upstream` lives somewhere else entirely. Nothing about `upstream`
    // resolves to an account, so the lookup falls back to the repo's default
    // remote — and that token must not follow the fetch to another host.
    setupGitHubAccounts();
    installMock({
      detectGitHub: GH_REPO, // matches `origin` only
      remotes: [
        { name: 'origin', url: GH_URL, pushUrl: null },
        { name: 'upstream', url: 'https://git.other.test/acme/app.git', pushUrl: null },
      ],
      assignedProfile: null,
      preferredAccount: null,
    });

    await gitFetch({ path: '/repo', remote: 'upstream', silent: true });

    expect(fetchToken, "origin's token must not authenticate to another host").to.be.undefined;
  });

  it('withholds a host-agnostic token too when the fetch remote host differs', async () => {
    // The Azure DevOps branch resolves no credential host, so only the
    // source-host === target-host comparison stands between an ADO token and
    // an unrelated remote.
    const work: IntegrationAccount = {
      ...createEmptyIntegrationAccount('azure-devops', 'workorg'),
      id: 'ado-work',
      isDefault: true,
    };
    unifiedProfileStore.getState().setAccounts([work]);
    keyring.clear();
    seedToken('azure-devops', 'ado-work', 'ado-tok');
    installMock({
      detectAdo: { organization: 'workorg', project: 'p', repository: 'repo', remoteName: 'origin' },
      remotes: [
        { name: 'origin', url: 'https://dev.azure.com/workorg/p/_git/repo', pushUrl: null },
        { name: 'upstream', url: 'https://github.com/acme/app.git', pushUrl: null },
      ],
      assignedProfile: null,
      preferredAccount: null,
    });

    await gitFetch({ path: '/repo', remote: 'upstream', silent: true });

    expect(fetchToken, 'an ADO token must not be offered to github.com').to.be.undefined;
  });

  it('still resolves by account URL patterns when the profile lookup fails', async () => {
    const { work } = setupGitHubAccounts();
    installMock({
      detectGitHub: GH_REPO,
      assignedProfile: 'throw',
      preferredAccount: work, // backend matched urlPatterns without a profile
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(resolverArgs!.profileId, 'resolves with no profile rather than aborting').to.equal('');
    expect(fetchToken).to.equal('work-tok');
  });

  it('falls back to the global default when the resolver command fails', async () => {
    setupGitHubAccounts();
    installMock({
      detectGitHub: GH_REPO,
      assignedProfile: null,
      preferredAccount: 'throw',
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken, 'a resolver hiccup must not cost the user their token').to.equal(
      'personal-tok',
    );
    expect(fetchToken).to.not.be.undefined;
  });

  it("syncs keyring credentials for the resolved non-default account's org", async () => {
    const personal: IntegrationAccount = {
      ...createEmptyIntegrationAccount('azure-devops', 'personalorg'),
      id: 'ado-personal',
      isDefault: true,
    };
    const work: IntegrationAccount = {
      ...createEmptyIntegrationAccount('azure-devops', 'workorg'),
      id: 'ado-work',
      isDefault: false,
    };
    unifiedProfileStore.getState().setAccounts([personal, work]);
    keyring.clear();
    seedToken('azure-devops', 'ado-personal', 'personal-tok');
    seedToken('azure-devops', 'ado-work', 'work-tok');
    installMock({
      detectAdo: { organization: 'workorg', project: 'p', repository: 'repo', remoteName: 'origin' },
      remoteUrl: 'https://dev.azure.com/workorg/p/_git/repo',
      assignedProfile: { id: 'profile-work' },
      preferredAccount: work,
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken).to.equal('work-tok');
    // The org guard only lets the sync through when the resolved account's org
    // is the repo's org — which it now is.
    expect(credWrites).to.include('https://workorg.visualstudio.com');
  });

  it('applies repo-aware resolution on the GitLab branch too', async () => {
    const personal: IntegrationAccount = {
      ...createEmptyIntegrationAccount('gitlab'),
      id: 'gl-personal',
      isDefault: true,
    };
    const work: IntegrationAccount = {
      ...createEmptyIntegrationAccount('gitlab'),
      id: 'gl-work',
      isDefault: false,
    };
    unifiedProfileStore.getState().setAccounts([personal, work]);
    keyring.clear();
    seedToken('gitlab', 'gl-personal', 'gl-personal-tok');
    seedToken('gitlab', 'gl-work', 'gl-work-tok');
    installMock({
      detectGitLab: { projectId: '1', projectPath: 'acme/app', remoteName: 'origin' },
      remoteUrl: 'https://gitlab.com/acme/app.git',
      assignedProfile: { id: 'profile-work' },
      preferredAccount: work,
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken).to.equal('gl-work-tok');
  });

  it('keeps using the global default when nothing repo-specific matches', async () => {
    setupGitHubAccounts();
    installMock({
      detectGitHub: GH_REPO,
      assignedProfile: null,
      preferredAccount: null, // no urlPattern match, no profile default
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken, 'single-account setups are unaffected').to.equal('personal-tok');
  });

  it("sends no token when the repo's resolved GitHub account has no keyring entry", async () => {
    const { work } = setupGitHubAccounts();
    clearToken('github', 'gh-work');
    // A legacy single-token credential is present too — it is just as wrong an
    // identity for this repo as the global default account.
    keyring.set('github_token', 'legacy-tok');
    installMock({
      detectGitHub: GH_REPO,
      assignedProfile: { id: 'profile-work' },
      preferredAccount: work,
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken, 'must not authenticate as the personal account').to.be.undefined;
  });

  it("sends no token when the repo's resolved Azure DevOps account has no keyring entry", async () => {
    const personal: IntegrationAccount = {
      ...createEmptyIntegrationAccount('azure-devops', 'personalorg'),
      id: 'ado-personal',
      isDefault: true,
    };
    const work: IntegrationAccount = {
      ...createEmptyIntegrationAccount('azure-devops', 'workorg'),
      id: 'ado-work',
      isDefault: false,
    };
    unifiedProfileStore.getState().setAccounts([personal, work]);
    keyring.clear();
    seedToken('azure-devops', 'ado-personal', 'personal-tok');
    keyring.set('azure_devops_token', 'legacy-tok');
    installMock({
      detectAdo: { organization: 'workorg', project: 'p', repository: 'repo', remoteName: 'origin' },
      remoteUrl: 'https://dev.azure.com/workorg/p/_git/repo',
      assignedProfile: { id: 'profile-work' },
      preferredAccount: work,
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken, 'must not authenticate as the personal org').to.be.undefined;
    expect(credWrites, 'and must not clobber the keyring credential either').to.have.length(0);
  });

  it("sends no token when the repo's resolved GitLab account has no keyring entry", async () => {
    const personal: IntegrationAccount = {
      ...createEmptyIntegrationAccount('gitlab'),
      id: 'gl-personal',
      isDefault: true,
    };
    const work: IntegrationAccount = {
      ...createEmptyIntegrationAccount('gitlab'),
      id: 'gl-work',
      isDefault: false,
    };
    unifiedProfileStore.getState().setAccounts([personal, work]);
    keyring.clear();
    seedToken('gitlab', 'gl-personal', 'gl-personal-tok');
    keyring.set('gitlab_token', 'legacy-tok');
    installMock({
      detectGitLab: { projectId: '1', projectPath: 'acme/app', remoteName: 'origin' },
      remoteUrl: 'https://gitlab.com/acme/app.git',
      assignedProfile: { id: 'profile-work' },
      preferredAccount: work,
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken, 'must not authenticate as the personal account').to.be.undefined;
  });

  it('still uses the legacy single token when the global default has none', async () => {
    setupGitHubAccounts();
    clearToken('github', 'gh-personal');
    keyring.set('github_token', 'legacy-tok');
    installMock({
      detectGitHub: GH_REPO,
      assignedProfile: null,
      preferredAccount: null, // nothing repo-specific → the legacy path still applies
    });

    await gitFetch({ path: '/repo', silent: true });

    expect(fetchToken, 'legacy setups keep working').to.equal('legacy-tok');
  });
});
