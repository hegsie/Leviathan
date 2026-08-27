/**
 * Tests for getFreshAccountToken — on-demand OAuth token refresh.
 *
 * Mocks the Tauri keyring commands with an in-memory map and the OAuth refresh
 * command, so the refresh/persist/fallback logic can be exercised without a
 * Tauri runtime.
 */

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const keyring = new Map<string, string>();
let refreshCalls = 0;
/** Raw object returned for `oauth_refresh_token`; null → the refresh call fails. */
let refreshResponse: unknown = null;
/** Args of the most recent `oauth_refresh_token` invoke. */
let lastRefreshArgs: Record<string, unknown> | undefined;
/** When set, `oauth_refresh_token` blocks on this until resolved (holds a refresh in flight). */
let refreshGate: Promise<void> | null = null;
/** Called as soon as `oauth_refresh_token` is entered, i.e. the bundle has been read. */
let onRefreshStart: (() => void) | undefined;

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
};

import { expect } from '@open-wc/testing';
import {
  deleteAccountToken,
  getFreshAccountToken,
  storeAccountOAuthToken,
  storeAccountToken,
} from '../credential.service.ts';

const OAUTH_KEY = 'azure-devops_token_a1_oauth';

function installMock(): void {
  mockInvoke = async (command: string, args?: unknown) => {
    const a = args as Record<string, unknown> | undefined;
    switch (command) {
      case 'store_keyring_token':
        keyring.set(a!.key as string, a!.value as string);
        return null;
      case 'get_keyring_token':
        return keyring.get(a!.key as string) ?? null;
      case 'delete_keyring_token':
        keyring.delete(a!.key as string);
        return null;
      case 'oauth_refresh_token':
        refreshCalls++;
        lastRefreshArgs = a;
        onRefreshStart?.();
        if (refreshGate) await refreshGate;
        return refreshResponse;
      default:
        return null;
    }
  };
}

describe('credential.service - getFreshAccountToken', () => {
  beforeEach(() => {
    keyring.clear();
    refreshCalls = 0;
    refreshResponse = null;
    lastRefreshArgs = undefined;
    refreshGate = null;
    onRefreshStart = undefined;
    installMock();
  });

  /**
   * Start a refresh and hand back a `release` that lets it finish, once the
   * refresh call is actually in flight (so the bundle has already been read and
   * anything the test stores next genuinely races the write-back).
   */
  async function startHeldRefresh(
    integrationType: 'gitlab' | 'bitbucket',
    accountId: string
  ): Promise<{ pending: Promise<string | null>; release: () => void }> {
    let release!: () => void;
    refreshGate = new Promise<void>((r) => (release = r));
    const started = new Promise<void>((r) => (onRefreshStart = r));
    const pending = getFreshAccountToken(integrationType, accountId, integrationType);
    await started;
    return { pending, release };
  }

  it('returns the stored access token when it is not near expiry (no refresh)', async () => {
    await storeAccountOAuthToken('azure-devops', 'a1', 'access-1', 'refresh-1', 3600); // ~1h out
    const token = await getFreshAccountToken('azure-devops', 'a1', 'azure');
    expect(token).to.equal('access-1');
    expect(refreshCalls, 'no refresh while the token is fresh').to.equal(0);
  });

  it('refreshes and persists a rotated bundle when the token is expiring', async () => {
    await storeAccountOAuthToken('azure-devops', 'a1', 'old-access', 'old-refresh', 60); // within 5-min window
    refreshResponse = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 };

    const token = await getFreshAccountToken('azure-devops', 'a1', 'azure');
    expect(token).to.equal('new-access');
    expect(refreshCalls).to.equal(1);

    // The rotated bundle (with a fresh expiry) is persisted — a second call reuses it.
    refreshCalls = 0;
    const again = await getFreshAccountToken('azure-devops', 'a1', 'azure');
    expect(again).to.equal('new-access');
    expect(refreshCalls, 'rotated token persisted with new expiry').to.equal(0);

    const stored = JSON.parse(keyring.get(OAUTH_KEY)!);
    expect(stored.accessToken).to.equal('new-access');
    expect(stored.refreshToken).to.equal('new-refresh');
  });

  it('keeps the previous refresh token when the provider returns none', async () => {
    await storeAccountOAuthToken('azure-devops', 'a1', 'old-access', 'old-refresh', 60);
    refreshResponse = { accessToken: 'new-access', expiresIn: 3600 }; // no refreshToken echoed back

    const token = await getFreshAccountToken('azure-devops', 'a1', 'azure');
    expect(token).to.equal('new-access');

    const stored = JSON.parse(keyring.get(OAUTH_KEY)!);
    expect(stored.refreshToken, 'previous refresh token retained').to.equal('old-refresh');
  });

  it('falls back to the existing token when the refresh call fails', async () => {
    await storeAccountOAuthToken('azure-devops', 'a1', 'old-access', 'old-refresh', 60);
    // refreshResponse stays null → invokeCommand treats it as failure → refresh throws.
    const token = await getFreshAccountToken('azure-devops', 'a1', 'azure');
    expect(token).to.equal('old-access');
    expect(refreshCalls).to.equal(1);
  });

  it('returns the plain token for a PAT account (no OAuth bundle)', async () => {
    await storeAccountToken('azure-devops', 'pat1', 'my-pat');
    const token = await getFreshAccountToken('azure-devops', 'pat1', 'azure');
    expect(token).to.equal('my-pat');
    expect(refreshCalls).to.equal(0);
  });

  // Regression: storing a PAT / app password over a previously OAuth-connected
  // account must retire the OAuth bundle, otherwise getFreshAccountToken keeps
  // returning the superseded access token from the leftover `_oauth` blob.
  it('a PAT stored over an OAuth account supersedes the stale bundle', async () => {
    await storeAccountOAuthToken('gitlab', 'g1', 'oauth-access', 'r1', 3600);
    await storeAccountToken('gitlab', 'g1', 'glpat-new');

    expect(await getFreshAccountToken('gitlab', 'g1', 'gitlab')).to.equal('glpat-new');
    expect(keyring.has('gitlab_token_g1_oauth'), 'stale OAuth bundle removed').to.be.false;
    expect(refreshCalls, 'a PAT is never refreshed').to.equal(0);
  });

  // Contract for the GitLab dialog: a self-hosted account must refresh against
  // its OWN instance, never the default gitlab.com endpoint.
  it('refreshes a self-hosted GitLab account against its own instance', async () => {
    await storeAccountOAuthToken('gitlab', 'g1', 'old-access', 'old-refresh', 60);
    refreshResponse = { accessToken: 'fresh', refreshToken: 'r2', expiresIn: 3600 };

    const token = await getFreshAccountToken('gitlab', 'g1', 'gitlab', 'https://gitlab.example.com');

    expect(token).to.equal('fresh');
    expect(lastRefreshArgs?.provider).to.equal('gitlab');
    expect(lastRefreshArgs?.instanceUrl).to.equal('https://gitlab.example.com');
  });

  // Regression: a refresh captures the OAuth bundle, awaits the network, then
  // persists the rotated bundle. If the user replaced or removed the credential
  // while that request was in flight, the write-back used to recreate the
  // `_oauth` blob AND overwrite the main key — silently resurrecting the OAuth
  // credential the user had just superseded or deleted.
  describe('credential replaced mid-refresh (regression)', () => {
    it('discards the rotated bundle when an app password is saved during the refresh', async () => {
      await storeAccountOAuthToken('bitbucket', 'b1', 'oauth-access', 'r1', 60);
      refreshResponse = { accessToken: 'rotated-access', refreshToken: 'r2', expiresIn: 3600 };

      const { pending, release } = await startHeldRefresh('bitbucket', 'b1');
      // The user saves an app password over the account while the refresh is out.
      await storeAccountToken('bitbucket', 'b1', 'bbapp:new-password');
      release();

      expect(await pending, 'the just-saved credential is used, not the rotated token').to.equal(
        'bbapp:new-password'
      );
      expect(keyring.get('bitbucket_token_b1'), 'app password not clobbered').to.equal(
        'bbapp:new-password'
      );
      expect(keyring.has('bitbucket_token_b1_oauth'), 'OAuth bundle not resurrected').to.be.false;
    });

    it('discards the rotated bundle when the account is disconnected during the refresh', async () => {
      await storeAccountOAuthToken('gitlab', 'g1', 'oauth-access', 'r1', 60);
      refreshResponse = { accessToken: 'rotated-access', refreshToken: 'r2', expiresIn: 3600 };

      const { pending, release } = await startHeldRefresh('gitlab', 'g1');
      // The user disconnects the account while the refresh is out.
      await deleteAccountToken('gitlab', 'g1');
      release();

      expect(await pending, 'no token for a disconnected account').to.equal(null);
      expect(keyring.has('gitlab_token_g1'), 'deleted credential stays deleted').to.be.false;
      expect(keyring.has('gitlab_token_g1_oauth'), 'OAuth bundle not resurrected').to.be.false;
    });

    it('still persists the rotated bundle when nothing changed during the refresh', async () => {
      await storeAccountOAuthToken('gitlab', 'g1', 'oauth-access', 'r1', 60);
      refreshResponse = { accessToken: 'rotated-access', refreshToken: 'r2', expiresIn: 3600 };

      const { pending, release } = await startHeldRefresh('gitlab', 'g1');
      release();

      expect(await pending).to.equal('rotated-access');
      const stored = JSON.parse(keyring.get('gitlab_token_g1_oauth')!);
      expect(stored.accessToken, 'undisturbed refresh still writes back').to.equal(
        'rotated-access'
      );
      expect(stored.refreshToken).to.equal('r2');
    });
  });

  it('coalesces concurrent refreshes into a single call (single-flight)', async () => {
    await storeAccountOAuthToken('azure-devops', 'a1', 'old-access', 'old-refresh', 60);
    refreshResponse = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 };

    // Two concurrent callers on the same expiring account share one refresh.
    const [t1, t2] = await Promise.all([
      getFreshAccountToken('azure-devops', 'a1', 'azure'),
      getFreshAccountToken('azure-devops', 'a1', 'azure'),
    ]);

    expect(t1).to.equal('new-access');
    expect(t2).to.equal('new-access');
    expect(refreshCalls, 'only one refresh for two concurrent callers').to.equal(1);
  });
});
