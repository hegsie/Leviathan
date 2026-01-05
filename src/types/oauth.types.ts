/**
 * OAuth types for authentication flow
 */

/** OAuth provider types */
export type OAuthProvider = 'github' | 'gitlab' | 'azure' | 'bitbucket';

/** Response from starting an OAuth flow */
export interface StartOAuthResponse {
  /** The URL to open in the browser */
  authorizeUrl: string;
  /** The PKCE verifier (store client-side for token exchange) */
  verifier: string;
  /** State for CSRF protection */
  state: string;
  /** Port if using loopback server (for GitHub) */
  loopbackPort?: number;
}

/** OAuth token response from provider */
export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
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

/** Pending OAuth authentication */
export interface PendingOAuth {
  verifier: string;
  provider: OAuthProvider;
  state: string;
  instanceUrl?: string;
  loopbackPort?: number;
  startedAt: number;
}
