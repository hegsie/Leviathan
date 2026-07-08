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

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
};

import { expect } from '@open-wc/testing';
import {
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
    installMock();
  });

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
