/**
 * OIDC / Enterprise SSO Dialog Integration Tests
 *
 * Tests the lv-oidc-dialog Lit component: discovery (success/failure incl.
 * SSRF/validation error strings), starting OAuth with ('oidc', clientId,
 * issuerUrl), oauth-complete account creation (save_global_account with oidc
 * config) + token storage, and error surfacing — with a mocked Tauri backend.
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
import '../lv-oidc-dialog.ts';
import type { LvOidcDialog } from '../lv-oidc-dialog.ts';

const ISSUER = 'https://auth.example.com';

const mockDiscovery = {
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  jwksUri: 'https://auth.example.com/jwks',
  issuer: ISSUER,
  scopesSupported: ['openid', 'profile', 'email'],
};

const mockUserInfo = {
  sub: 'user-123',
  email: 'sso@example.com',
  name: 'SSO User',
  preferredUsername: 'ssouser',
  picture: null,
};

function createTestAccount(
  overrides: Partial<IntegrationAccount> & { id: string }
): IntegrationAccount {
  const base = createEmptyIntegrationAccount(overrides.integrationType ?? 'oidc');
  return {
    ...base,
    name: 'Test SSO',
    isDefault: true,
    cachedUser: null,
    ...overrides,
  } as IntegrationAccount;
}

const mockAccount = createTestAccount({
  id: 'oidc-acc-1',
  name: 'Acme SSO',
  integrationType: 'oidc',
  config: { type: 'oidc', issuerUrl: ISSUER, clientId: 'acme-client' },
  isDefault: true,
});

async function waitForLoad(el: LvOidcDialog): Promise<void> {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
}

function setupMockInvoke(): void {
  keyringStore.clear();

  mockInvoke = async (command: string, args?: unknown) => {
    const params = args as Record<string, unknown> | undefined;

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

    if (command === 'get_unified_profiles_config') {
      return {
        version: 3,
        profiles: [],
        accounts: unifiedProfileStore.getState().accounts,
        repositoryAssignments: {},
      };
    }
    if (command === 'load_unified_profile_for_repository') return null;
    if (command === 'save_global_account') return params;
    if (command === 'update_global_account_cached_user') return null;

    if (command === 'discover_oidc_provider') return mockDiscovery;
    if (command === 'decode_oidc_id_token') return mockUserInfo;
    if (command === 'oauth_get_authorize_url') {
      return { authorizeUrl: 'https://auth.example.com/authorize?x', state: 'st-1', loopbackPort: null };
    }

    return null;
  };
}

describe('lv-oidc-dialog', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    unifiedProfileStore.getState().reset();
    uiStore.getState().toasts.length = 0;
    setupMockInvoke();
  });

  describe('Rendering', () => {
    it('renders lv-modal with the OIDC form when open', async () => {
      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      expect(el.shadowRoot!.querySelector('lv-modal')).to.not.be.null;
      expect(el.shadowRoot!.querySelector('.token-form')).to.not.be.null;
      // Three text inputs: name, issuer, client id.
      const inputs = el.shadowRoot!.querySelectorAll('input');
      expect(inputs.length).to.equal(3);
    });
  });

  describe('Discovery', () => {
    it('shows discovered endpoints on success', async () => {
      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      (el as unknown as { issuerUrlInput: string }).issuerUrlInput = ISSUER;
      await (el as unknown as { handleDiscover: () => Promise<void> }).handleDiscover();
      await el.updateComplete;

      const discovery = el.shadowRoot!.querySelector('.discovery');
      expect(discovery).to.not.be.null;
      expect(discovery!.textContent).to.include('https://auth.example.com/authorize');
      expect(discovery!.textContent).to.include('https://auth.example.com/token');

      const discoverCall = invokeHistory.find((h) => h.command === 'discover_oidc_provider');
      expect(discoverCall).to.not.be.undefined;
      expect((discoverCall!.args as Record<string, string>).issuerUrl).to.equal(ISSUER);
    });

    it('surfaces a discovery/SSRF validation error inline', async () => {
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'discover_oidc_provider') {
          throw new Error('Issuer URL host is not allowed (loopback)');
        }
        return origMock(command, args);
      };

      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      (el as unknown as { issuerUrlInput: string }).issuerUrlInput = 'https://localhost';
      await (el as unknown as { handleDiscover: () => Promise<void> }).handleDiscover();
      await el.updateComplete;

      const errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.not.be.null;
      expect(errorEl!.textContent).to.include('loopback');
      expect((el as unknown as { discovery: unknown }).discovery).to.be.null;
    });
  });

  describe('Start OAuth', () => {
    it('invokes startOAuth with ("oidc", clientId, issuerUrl)', async () => {
      // startOAuth(provider, clientId, instanceUrl) calls the
      // oauth_get_authorize_url command with { provider, clientId, instanceUrl }.
      // Assert the dialog threads the OIDC issuer through as instanceUrl and the
      // per-account client ID.
      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      (el as unknown as { issuerUrlInput: string }).issuerUrlInput = ISSUER;
      (el as unknown as { clientIdInput: string }).clientIdInput = 'acme-client';
      invokeHistory.length = 0;
      await (el as unknown as { handleStartOAuth: () => Promise<void> }).handleStartOAuth();
      await new Promise((r) => setTimeout(r, 50));

      const authCall = invokeHistory.find((h) => h.command === 'oauth_get_authorize_url');
      expect(authCall, 'oauth_get_authorize_url invoked').to.not.be.undefined;
      const args = authCall!.args as Record<string, string>;
      expect(args.provider).to.equal('oidc');
      expect(args.clientId).to.equal('acme-client');
      expect(args.instanceUrl).to.equal(ISSUER);
    });

    it('shows an error if issuer or client id is missing', async () => {
      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      await (el as unknown as { handleStartOAuth: () => Promise<void> }).handleStartOAuth();
      await el.updateComplete;

      const errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.not.be.null;
      expect(errorEl!.textContent).to.include('required');
    });
  });

  describe('OAuth complete', () => {
    it('creates an oidc account (save_global_account with oidc config) and stores the token', async () => {
      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      (el as unknown as { issuerUrlInput: string }).issuerUrlInput = ISSUER;
      (el as unknown as { clientIdInput: string }).clientIdInput = 'acme-client';
      (el as unknown as { nameInput: string }).nameInput = 'Acme SSO';
      await el.updateComplete;

      invokeHistory.length = 0;

      window.dispatchEvent(
        new CustomEvent('oauth-complete', {
          detail: {
            provider: 'oidc',
            tokens: { accessToken: 'oidc-access', idToken: 'header.payload.sig' },
            instanceUrl: ISSUER,
          },
        })
      );
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      const saveCall = invokeHistory.find((h) => h.command === 'save_global_account');
      expect(saveCall, 'save_global_account was called').to.not.be.undefined;
      const account = (saveCall!.args as Record<string, unknown>).account as IntegrationAccount;
      expect(account.integrationType).to.equal('oidc');
      expect(account.config).to.deep.include({ type: 'oidc', issuerUrl: ISSUER, clientId: 'acme-client' });

      // Token stored in keyring.
      const stored = invokeHistory.some((h) => h.command === 'store_keyring_token');
      expect(stored, 'token stored').to.be.true;

      // Connected UI + identity from decoded ID token.
      expect((el as unknown as { connected: boolean }).connected).to.be.true;
      await el.updateComplete;
      const status = el.shadowRoot!.querySelector('.connection-status');
      expect(status).to.not.be.null;
      expect(status!.textContent).to.include('SSO User');
    });

    it('ignores oauth-complete for other providers', async () => {
      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);
      invokeHistory.length = 0;

      window.dispatchEvent(
        new CustomEvent('oauth-complete', {
          detail: { provider: 'github', tokens: { accessToken: 'gh' } },
        })
      );
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(invokeHistory.some((h) => h.command === 'save_global_account')).to.be.false;
      expect((el as unknown as { connected: boolean }).connected).to.be.false;
    });

    it('surfaces an error when account persistence fails', async () => {
      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'save_global_account') throw new Error('persist boom');
        return origMock(command, args);
      };

      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);
      (el as unknown as { issuerUrlInput: string }).issuerUrlInput = ISSUER;
      (el as unknown as { clientIdInput: string }).clientIdInput = 'acme-client';
      await el.updateComplete;

      window.dispatchEvent(
        new CustomEvent('oauth-complete', {
          detail: { provider: 'oidc', tokens: { accessToken: 'oidc-access' }, instanceUrl: ISSUER },
        })
      );
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error).to.include('persist boom');
    });
  });

  describe('Multi-account', () => {
    it('shows account selector and connected state when an account exists', async () => {
      unifiedProfileStore.getState().setAccounts([
        { ...mockAccount, cachedUser: { username: 'ssouser', displayName: 'SSO User', email: null, avatarUrl: null } },
      ]);

      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      expect(el.shadowRoot!.querySelector('lv-account-selector')).to.not.be.null;
      const status = el.shadowRoot!.querySelector('.connection-status');
      expect(status).to.not.be.null;
      expect(status!.textContent).to.include('SSO User');
    });
  });

  describe('Disconnect', () => {
    it('persists a cleared cachedUser so the account does not re-show Connected', async () => {
      const connectedAccount = {
        ...mockAccount,
        cachedUser: { username: 'ssouser', displayName: 'SSO User', email: null, avatarUrl: null },
      };
      unifiedProfileStore.getState().setAccounts([connectedAccount]);

      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);
      expect((el as unknown as { connected: boolean }).connected).to.be.true;

      invokeHistory.length = 0;
      await (el as unknown as { handleDisconnect: () => Promise<void> }).handleDisconnect();
      await el.updateComplete;

      // Token deleted from keyring.
      expect(invokeHistory.some((h) => h.command === 'delete_keyring_token')).to.be.true;

      // cachedUser cleared via save_global_account (drives connected state on reopen).
      const saveCall = invokeHistory.find((h) => h.command === 'save_global_account');
      expect(saveCall, 'save_global_account called to clear cachedUser').to.not.be.undefined;
      const saved = (saveCall!.args as Record<string, unknown>).account as IntegrationAccount;
      expect(saved.cachedUser).to.equal(null);

      // UI reflects disconnected immediately.
      expect((el as unknown as { connected: boolean }).connected).to.be.false;
      expect((el as unknown as { connectedUser: unknown }).connectedUser).to.equal(null);
    });

    it('surfaces an error toast when disconnect fails', async () => {
      const connectedAccount = {
        ...mockAccount,
        cachedUser: { username: 'ssouser', displayName: 'SSO User', email: null, avatarUrl: null },
      };
      unifiedProfileStore.getState().setAccounts([connectedAccount]);

      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      const origMock = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        // saveGlobalAccount (clearing cachedUser) throws on the invoke layer.
        if (command === 'save_global_account') throw new Error('persist boom');
        return origMock(command, args);
      };

      uiStore.getState().toasts.length = 0;
      await (el as unknown as { handleDisconnect: () => Promise<void> }).handleDisconnect();
      await el.updateComplete;

      expect((el as unknown as { error: string | null }).error).to.include('persist boom');
      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error')).to.be.true;
    });
  });

  describe('Add account guard', () => {
    it('does not clobber a half-typed Add form when a background store emit fires', async () => {
      const connectedAccount = {
        ...mockAccount,
        cachedUser: { username: 'ssouser', displayName: 'SSO User', email: null, avatarUrl: null },
      };
      unifiedProfileStore.getState().setAccounts([connectedAccount]);

      const el = await fixture<LvOidcDialog>(html`<lv-oidc-dialog .open=${true}></lv-oidc-dialog>`);
      await waitForLoad(el);

      // User clicks "Add account": selection cleared, form blanked.
      (el as unknown as { handleAddAccount: () => void }).handleAddAccount();
      await el.updateComplete;

      // User starts typing a new issuer/client/name.
      const elState = el as unknown as {
        issuerUrlInput: string;
        clientIdInput: string;
        nameInput: string;
      };
      elState.issuerUrlInput = 'https://new-issuer.example.com';
      elState.clientIdInput = 'new-client';
      elState.nameInput = 'My New SSO';

      // A background validation emit (e.g. setAccountConnectionStatus) fires.
      unifiedProfileStore.getState().setAccountConnectionStatus('oidc-acc-1', 'connected');
      await el.updateComplete;

      // The half-typed form must be preserved (not overwritten by applyAccount).
      expect(elState.issuerUrlInput).to.equal('https://new-issuer.example.com');
      expect(elState.clientIdInput).to.equal('new-client');
      expect(elState.nameInput).to.equal('My New SSO');
      expect((el as unknown as { selectedAccountId: string | null }).selectedAccountId).to.equal(null);
    });
  });
});
