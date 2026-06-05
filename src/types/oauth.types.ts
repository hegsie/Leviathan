/**
 * OAuth types for authentication flow
 */

/** OAuth provider types */
export type OAuthProvider = 'github' | 'gitlab' | 'azure' | 'bitbucket' | 'oidc';

/** Response from starting an OAuth flow */
export interface StartOAuthResponse {
  /** The URL to open in the browser */
  authorizeUrl: string;
  /**
   * State for CSRF protection. Opaque handle that also keys the server-side
   * PKCE flow — pass it back to `oauth_exchange_code`. The PKCE verifier is
   * held server-side and is never returned to the frontend (M5/M11).
   */
  state: string;
  /** Port if using loopback server (for GitHub) */
  loopbackPort?: number;
}

/** Result of waiting on the loopback OAuth callback */
export interface CallbackResponse {
  /** The authorization code from the provider */
  code: string;
  /** The state echoed back by the provider (validated server-side) */
  state: string;
}

/** OAuth token response from provider */
export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
  idToken?: string;
}

/** Stored OAuth credential */
export interface OAuthCredential {
  type: 'oauth';
  accessToken: string;
  refreshToken?: string;
  /** Unix timestamp when token expires */
  expiresAt?: number;
  provider: OAuthProvider;
}

/** OAuth flow state */
export interface OAuthFlowState {
  status: 'idle' | 'pending' | 'exchanging' | 'success' | 'error';
  error?: string;
  provider?: OAuthProvider;
}

/** Pending OAuth authentication (the PKCE verifier lives server-side, keyed by `state`) */
export interface PendingOAuth {
  provider: OAuthProvider;
  state: string;
  instanceUrl?: string;
  loopbackPort?: number;
  startedAt: number;
}
