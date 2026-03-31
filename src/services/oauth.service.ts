/**
 * OAuth service for provider authentication
 *
 * Handles OAuth authentication flows for GitHub, GitLab, Azure DevOps, and Bitbucket.
 * - GitHub, GitLab, Bitbucket use loopback server (127.0.0.1:port)
 * - Azure uses deep links (leviathan://oauth/...)
 */

import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { open } from '@tauri-apps/plugin-shell';
import { listen } from '@tauri-apps/api/event';
import { invokeCommand } from './tauri-api.ts';
import type {
  OAuthProvider,
  StartOAuthResponse,
  OAuthTokenResponse,
  PendingOAuth,
  OAuthFlowState,
} from '../types/oauth.types';

/**
 * OAuth Client IDs for each provider
 * See docs/oauth-setup.md for registration instructions
 */
const OAUTH_CLIENT_IDS: Partial<Record<OAuthProvider, string>> = {
  github: 'Ov23liQxX14fxt3fRq4u',
  gitlab: '90d3d02fefb79e0303aaa54e8c6794bf806e9e8a1de7526bebc4f14288e12fec',
  // Azure DevOps: OAuth not supported for personal Microsoft accounts - use PAT instead
  // See ROADMAP.md for details on Microsoft's OAuth deprecation
  bitbucket: 'Tv5UjEqLKK7GSYjAJn',
};

/**
 * OAuth Client Secrets for providers that require them
 *
 * SECURITY NOTE: These secrets are embedded in the compiled application
 * and can be extracted by anyone. This is a known limitation of desktop OAuth apps.
 *
 * Best Practices:
 * - For GitHub: Client secret is optional when using PKCE (Proof Key for Code Exchange).
 *   Consider removing it and using PKCE-only flow.
 * - For Bitbucket: May require client secret for token exchange depending on configuration.
 *
 * Possible Future Improvements:
 * 1. Use PKCE-only flows where supported (no client secret needed)
 * 2. Accept client secrets via build-time environment variables so developers
 *    building from source can substitute their own credentials
 * 3. Implement a backend proxy service to handle token exchange securely
 *
 * See: https://datatracker.ietf.org/doc/html/rfc7636 (OAuth PKCE)
 */
const OAUTH_CLIENT_SECRETS: Partial<Record<OAuthProvider, string>> = {
  github: '5b7d15b2c5658908e0ced1682e53168269513592',
  // Bitbucket requires client secret for token exchange
  bitbucket: 'HAqqaX24y8QSexmnvfbQkEPShUjskmUm',
};

/** Currently pending OAuth authentications, keyed by provider to prevent race conditions */
const pendingAuthByProvider = new Map<OAuthProvider, PendingOAuth>();

/** Listeners for OAuth state changes */
const stateListeners = new Set<(state: OAuthFlowState) => void>();

/** Notify all state listeners */
function notifyStateChange(state: OAuthFlowState): void {
  stateListeners.forEach((listener) => listener(state));
}

/**
 * Subscribe to OAuth state changes
 */
export function onOAuthStateChange(
  listener: (state: OAuthFlowState) => void
): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/**
 * Initialize OAuth deep link listener
 * Should be called once when the app starts
 */
export async function initOAuthListener(): Promise<void> {
  // Check if app was launched via deep link
  try {
    const urls = await getCurrent();
    if (urls?.length) {
      handleDeepLink(urls[0]);
    }
  } catch (e) {
    // Deep link plugin may not be available in dev mode
    console.debug('Deep link getCurrent not available:', e);
  }

  // Listen for deep links while app is running
  try {
    await onOpenUrl((urls: string[]) => {
      if (urls.length) {
        handleDeepLink(urls[0]);
      }
    });
  } catch (e) {
    console.debug('Deep link onOpenUrl not available:', e);
  }

  // Also listen for deep links via single-instance plugin (Windows/Linux)
  try {
    await listen<string>('deep-link', (event) => {
      handleDeepLink(event.payload);
    });
  } catch (e) {
    console.debug('Deep link event listener not available:', e);
  }
}

/**
 * Handle incoming deep link
 */
async function handleDeepLink(url: string): Promise<void> {
  console.log('Received deep link:', url);

  if (!url.startsWith('leviathan://oauth/')) {
    return;
  }

  // Extract provider from URL path: leviathan://oauth/{provider}/callback?...
  const providerSegment = url.slice('leviathan://oauth/'.length).split('/')[0] as OAuthProvider;
  const pending = pendingAuthByProvider.get(providerSegment);

  if (!pending) {
    console.warn('Received OAuth callback but no pending auth for provider:', providerSegment);
    return;
  }

  try {
    // Parse the URL: leviathan://oauth/{provider}/callback?code=xxx&state=yyy
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    const error = parsed.searchParams.get('error');
    const errorDescription = parsed.searchParams.get('error_description');

    if (error) {
      notifyStateChange({
        status: 'error',
        error: errorDescription || error,
        provider: pending.provider,
      });
      pendingAuthByProvider.delete(pending.provider);
      return;
    }

    if (!code) {
      notifyStateChange({
        status: 'error',
        error: 'No authorization code received',
        provider: pending.provider,
      });
      pendingAuthByProvider.delete(pending.provider);
      return;
    }

    // Verify state matches
    if (state !== pending.state) {
      notifyStateChange({
        status: 'error',
        error: 'State mismatch - possible CSRF attack',
        provider: pending.provider,
      });
      pendingAuthByProvider.delete(pending.provider);
      return;
    }

    // Exchange code for tokens
    notifyStateChange({
      status: 'exchanging',
      provider: pending.provider,
    });

    const redirectUri = `leviathan://oauth/${pending.provider}/callback`;
    const tokens = await exchangeCode(
      pending.provider,
      code,
      pending.verifier,
      redirectUri,
      pending.instanceUrl
    );

    notifyStateChange({
      status: 'success',
      provider: pending.provider,
    });

    // Dispatch event for the dialog to handle
    window.dispatchEvent(
      new CustomEvent('oauth-complete', {
        detail: {
          provider: pending.provider,
          tokens,
          instanceUrl: pending.instanceUrl,
        },
      })
    );

    pendingAuthByProvider.delete(pending.provider);
  } catch (e) {
    console.error('OAuth callback error:', e);
    notifyStateChange({
      status: 'error',
      error: e instanceof Error ? e.message : 'Unknown error',
      provider: pending.provider,
    });
    pendingAuthByProvider.delete(pending.provider);
  }
}

/**
 * Start OAuth flow for a provider
 */
export async function startOAuth(
  provider: OAuthProvider,
  clientId: string,
  instanceUrl?: string
): Promise<void> {
  try {
    notifyStateChange({ status: 'pending', provider });

    const cmdResult = await invokeCommand<StartOAuthResponse>('oauth_get_authorize_url', {
      provider,
      clientId,
      instanceUrl,
    });
    if (!cmdResult.success || !cmdResult.data) {
      throw new Error(cmdResult.error?.message ?? 'Failed to get authorize URL');
    }
    const response = cmdResult.data;

    pendingAuthByProvider.set(provider, {
      verifier: response.verifier,
      provider,
      state: response.state,
      instanceUrl,
      loopbackPort: response.loopbackPort,
      startedAt: Date.now(),
    });

    // Open the authorization URL in the browser
    await open(response.authorizeUrl);

    // For providers using loopback server, poll for the callback
    if (response.loopbackPort) {
      pollLoopbackCallback(provider, response.loopbackPort).catch((e) => {
        console.error(`OAuth polling error for ${provider}:`, e);
        pendingAuthByProvider.delete(provider);
        notifyStateChange({
          status: 'error',
          error: e instanceof Error ? e.message : 'OAuth polling failed',
          provider,
        });
      });
    }
  } catch (e) {
    console.error('Failed to start OAuth:', e);
    notifyStateChange({
      status: 'error',
      error: e instanceof Error ? e.message : 'Failed to start OAuth',
      provider,
    });
  }
}

/**
 * Poll for loopback callback (works for GitHub, GitLab, and any provider using loopback server)
 */
async function pollLoopbackCallback(provider: OAuthProvider, port: number): Promise<void> {
  const pending = pendingAuthByProvider.get(provider);
  if (!pending) {
    return;
  }

  try {
    // Wait for the callback on the loopback server
    const codeResult = await invokeCommand<string>('oauth_wait_for_callback', {
      port,
    });
    if (!codeResult.success || !codeResult.data) {
      throw new Error(codeResult.error?.message ?? 'Failed to receive OAuth callback');
    }
    const code = codeResult.data;

    console.log(`[OAuth ${provider}] Received callback code:`, code?.substring(0, 10) + '...');

    // Re-check in case user cancelled while waiting for callback
    const current = pendingAuthByProvider.get(provider);
    if (!current) {
      return; // User cancelled or timeout
    }

    notifyStateChange({
      status: 'exchanging',
      provider,
    });

    const redirectUri = `http://127.0.0.1:${port}/callback`;
    console.log(`[OAuth ${provider}] Exchanging code for tokens...`);
    const tokens = await exchangeCode(provider, code, current.verifier, redirectUri, current.instanceUrl);
    console.log(`[OAuth ${provider}] Token exchange result:`, {
      hasAccessToken: !!tokens?.accessToken,
      accessTokenLength: tokens?.accessToken?.length,
      hasRefreshToken: !!tokens?.refreshToken,
      tokenType: tokens?.tokenType,
    });

    notifyStateChange({
      status: 'success',
      provider,
    });

    window.dispatchEvent(
      new CustomEvent('oauth-complete', {
        detail: {
          provider,
          tokens,
          instanceUrl: current.instanceUrl,
        },
      })
    );

    pendingAuthByProvider.delete(provider);
  } catch (e) {
    console.error(`${provider} OAuth error:`, e);
    notifyStateChange({
      status: 'error',
      error: e instanceof Error ? e.message : `${provider} OAuth failed`,
      provider,
    });
    pendingAuthByProvider.delete(provider);
  }
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  verifier: string,
  redirectUri: string,
  instanceUrl?: string
): Promise<OAuthTokenResponse> {
  // Get client ID and secret from config
  const clientId = getClientId(provider);
  const clientSecret = getClientSecret(provider);

  console.log('[OAuth] exchangeCode params:', { provider, redirectUri, hasClientId: !!clientId, hasClientSecret: !!clientSecret });

  const cmdResult = await invokeCommand<OAuthTokenResponse>('oauth_exchange_code', {
    provider,
    code,
    verifier,
    redirectUri,
    clientId,
    clientSecret,
    instanceUrl,
  });
  if (!cmdResult.success || !cmdResult.data) {
    throw new Error(cmdResult.error?.message ?? 'Failed to exchange OAuth code');
  }

  const result = cmdResult.data;
  console.log('[OAuth] exchangeCode result keys:', result ? Object.keys(result) : 'null');

  // Handle both camelCase and snake_case field names (Rust serde serialization edge case)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawResult = result as any;
  const normalizedResult: OAuthTokenResponse = {
    accessToken: rawResult.accessToken || rawResult.access_token,
    refreshToken: rawResult.refreshToken || rawResult.refresh_token,
    expiresIn: rawResult.expiresIn || rawResult.expires_in,
    tokenType: rawResult.tokenType || rawResult.token_type,
    scope: rawResult.scope,
  };

  console.log('[OAuth] exchangeCode normalized: has accessToken=%s, has refreshToken=%s',
    !!normalizedResult.accessToken, !!normalizedResult.refreshToken);

  return normalizedResult;
}

/**
 * Refresh an OAuth token
 */
export async function refreshToken(
  provider: OAuthProvider,
  refreshTokenValue: string,
  instanceUrl?: string
): Promise<OAuthTokenResponse> {
  const clientId = getClientId(provider);

  const result = await invokeCommand<OAuthTokenResponse>('oauth_refresh_token', {
    provider,
    refreshToken: refreshTokenValue,
    clientId,
    instanceUrl,
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? 'Failed to refresh OAuth token');
  }
  return result.data;
}

/**
 * Cancel pending OAuth flow
 */
export function cancelOAuth(provider?: OAuthProvider): void {
  if (provider) {
    const pending = pendingAuthByProvider.get(provider);
    if (pending) {
      notifyStateChange({ status: 'idle', provider });
      pendingAuthByProvider.delete(provider);
    }
  } else {
    for (const [p] of pendingAuthByProvider) {
      notifyStateChange({ status: 'idle', provider: p });
    }
    pendingAuthByProvider.clear();
  }
}

/**
 * Check if an OAuth flow is pending
 */
export function isPendingOAuth(): boolean {
  return pendingAuthByProvider.size > 0;
}

/**
 * Get the pending OAuth provider
 */
export function getPendingProvider(): OAuthProvider | null {
  const first = pendingAuthByProvider.keys().next();
  return first.done ? null : first.value;
}

/**
 * Get client ID for a provider
 */
export function getClientId(provider: OAuthProvider): string {
  return OAUTH_CLIENT_IDS[provider] || '';
}

/**
 * Get client secret for a provider (if required)
 */
export function getClientSecret(provider: OAuthProvider): string | undefined {
  return OAUTH_CLIENT_SECRETS[provider];
}

/**
 * Check if OAuth is configured for a provider
 */
export function isOAuthConfigured(provider: OAuthProvider): boolean {
  return !!getClientId(provider);
}

// ========================================================================
// OIDC (Enterprise SSO)
// ========================================================================

export interface OidcDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string | null;
  issuer: string;
  scopesSupported: string[];
}

export interface OidcUserInfo {
  sub: string;
  email: string | null;
  name: string | null;
  preferredUsername: string | null;
  picture: string | null;
}

/**
 * Discover OIDC provider configuration from an issuer URL
 */
export async function discoverOidcProvider(issuerUrl: string): Promise<OidcDiscovery> {
  const result = await invokeCommand<OidcDiscovery>('discover_oidc_provider', { issuerUrl });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? 'Failed to discover OIDC provider');
  }
  return result.data;
}

/**
 * Decode an OIDC ID token to extract user identity
 */
export async function decodeOidcIdToken(idToken: string): Promise<OidcUserInfo> {
  const result = await invokeCommand<OidcUserInfo>('decode_oidc_id_token', { idToken });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? 'Failed to decode OIDC ID token');
  }
  return result.data;
}
