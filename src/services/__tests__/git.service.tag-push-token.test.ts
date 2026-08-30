/**
 * Which identity a tag push authenticates as.
 *
 * `pushTag`/`deleteRemoteTag` scope the credential to the remote the tag is
 * actually going to. Two things have to hold for that to be safe:
 *
 * - the remote-name lookup misses on any remote the provider detectors did not
 *   report first, so an unfiltered retry rescues those pushes — but it resolves
 *   the account for a DIFFERENT remote, and two github.com remotes routinely
 *   belong to different accounts;
 * - and when the push URL cannot be read at all, the credential must degrade to
 *   the remote-scoped lookup rather than disappear.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';
import { pushTag, deleteRemoteTag } from '../git.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import { createEmptyIntegrationAccount } from '../../types/unified-profile.types.ts';
import type { IntegrationAccount } from '../../types/unified-profile.types.ts';

// ── Fixtures ───────────────────────────────────────────────────────────────
const REPO = '/test/repo';
/** The company repo. Detected first, and matched to the work account. */
const ORIGIN_URL = 'https://github.com/acme/app.git';
/** The user's own fork. Same host, different account. */
const FORK_URL = 'https://github.com/me/app.git';

const keyring = new Map<string, string>();
let pushTagToken: string | undefined;
let deleteRemoteTagToken: string | undefined;
let pushTagCalled = false;

interface MockOptions {
  /** get_remotes result, or 'fail' to reject it. */
  remotes?: Array<{ name: string; url: string; pushUrl: string | null }> | 'fail';
  /** Which account the backend resolver returns for a given repo URL. */
  accountForUrl?: (url: string | null) => IntegrationAccount | null;
}

function installMock(opts: MockOptions) {
  mockInvoke = async (command: string, args?: unknown) => {
    const a = args as Record<string, unknown> | undefined;
    if (command === 'detect_github_repo') {
      // The detector reports the FIRST GitHub remote it finds, whatever the
      // caller asked about.
      return { owner: 'acme', repo: 'app', remoteName: 'origin' };
    }
    if (command === 'detect_ado_repo' || command === 'detect_gitlab_repo') return null;
    if (command === 'get_remotes') {
      if (opts.remotes === 'fail') throw new Error('could not read remote config');
      return (
        opts.remotes ?? [
          { name: 'origin', url: ORIGIN_URL, pushUrl: null },
          { name: 'personal-fork', url: FORK_URL, pushUrl: null },
        ]
      );
    }
    if (command === 'get_assigned_unified_profile') return null;
    if (command === 'get_repository_preferred_account') {
      return opts.accountForUrl?.((a?.repoUrl as string | null) ?? null) ?? null;
    }
    if (command === 'get_keyring_token') return keyring.get(a!.key as string) ?? null;
    if (command === 'push_tag') {
      pushTagCalled = true;
      pushTagToken = a?.token as string | undefined;
      return null;
    }
    if (command === 'delete_remote_tag') {
      deleteRemoteTagToken = a?.token as string | undefined;
      return null;
    }
    return null;
  };
}

function account(id: string, isDefault: boolean): IntegrationAccount {
  return { ...createEmptyIntegrationAccount('github'), id, name: id, isDefault };
}

/** Work is only reachable via URL-pattern matching; personal is the global default. */
function setupTwoGitHubAccounts() {
  const personal = account('gh-personal', true);
  const work = account('gh-work', false);
  unifiedProfileStore.getState().setAccounts([personal, work]);
  keyring.clear();
  keyring.set('github_token_gh-personal', 'personal-tok');
  keyring.set('github_token_gh-work', 'work-tok');
  return { personal, work };
}

describe('git.service - tag push credential scoping', () => {
  beforeEach(() => {
    pushTagToken = undefined;
    deleteRemoteTagToken = undefined;
    pushTagCalled = false;
  });

  afterEach(() => {
    unifiedProfileStore.getState().reset();
    mockInvoke = () => Promise.resolve(null);
  });

  it("does not lend one account's token to another account's remote", async () => {
    // The detectors report `origin` first, so the remote-scoped lookup finds
    // nothing for `personal-fork` and the unfiltered retry resolves the WORK
    // account. Both remotes are on github.com, so host equality alone would
    // hand the work token to a push aimed at the user's own fork.
    const { personal, work } = setupTwoGitHubAccounts();
    installMock({ accountForUrl: (url) => (url === FORK_URL ? personal : work) });

    await pushTag({ path: REPO, name: 'v1.0.0', remote: 'personal-fork' });

    expect(pushTagCalled, 'the push still happens').to.equal(true);
    expect(pushTagToken, 'the work account must not authenticate a fork push').to.be.undefined;
  });

  it('still lends the token when the same account owns the push URL', async () => {
    // The single-account fork case the unfiltered retry exists for: nothing
    // repo-specific matches, so both URLs resolve to the same account.
    const { personal } = setupTwoGitHubAccounts();
    installMock({ accountForUrl: () => personal });

    await pushTag({ path: REPO, name: 'v1.0.0', remote: 'personal-fork' });

    expect(pushTagToken, 'a fork push still authenticates').to.equal('personal-tok');
  });

  it('keeps the credential when the push URL cannot be read', async () => {
    // get_remotes failing leaves no push URL to scope against. Dropping the
    // token here fails the push with "No valid credentials found" on exactly
    // the token-authenticated HTTPS remotes this plumbing exists for.
    const { personal } = setupTwoGitHubAccounts();
    installMock({ remotes: 'fail', accountForUrl: () => personal });

    await pushTag({ path: REPO, name: 'v1.0.0', remote: 'origin' });

    expect(pushTagToken, 'a transient remote-list failure must not cost the token').to.equal(
      'personal-tok',
    );
  });

  it('applies the same two rules to a remote tag delete', async () => {
    const { personal, work } = setupTwoGitHubAccounts();
    installMock({ accountForUrl: (url) => (url === FORK_URL ? personal : work) });

    await deleteRemoteTag({ path: REPO, name: 'v1.0.0', remote: 'personal-fork' });
    expect(deleteRemoteTagToken, 'no borrowed identity on the delete either').to.be.undefined;

    installMock({ remotes: 'fail', accountForUrl: () => personal });
    await deleteRemoteTag({ path: REPO, name: 'v1.0.0', remote: 'origin' });
    expect(deleteRemoteTagToken, 'and the same credential fallback').to.equal('personal-tok');
  });
});
