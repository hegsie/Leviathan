//! OAuth command handlers
//!
//! Provides Tauri commands for OAuth authentication flow.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::error::{LeviathanError, Result};
use crate::services::loopback_server::LoopbackServer;
use crate::services::oauth::{
    generate_state, OAuthConfig, OAuthProvider, OAuthTokenResponse, PKCEChallenge,
};
use once_cell::sync::Lazy;

/// Time-to-live for pending loopback servers (5 minutes).
/// Servers older than this are cleaned up to prevent unbounded growth
/// when OAuth callbacks never fire.
const PENDING_SERVER_TTL: Duration = Duration::from_secs(5 * 60);

/// A pending loopback server paired with its creation timestamp for TTL enforcement.
struct PendingServer {
    server: LoopbackServer,
    created_at: std::time::Instant,
}

/// Global storage for pending loopback servers (GitHub OAuth)
static PENDING_SERVERS: Lazy<Mutex<HashMap<u16, PendingServer>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Remove expired entries from the pending servers map.
fn cleanup_expired_pending_servers(map: &mut HashMap<u16, PendingServer>) {
    let now = std::time::Instant::now();
    map.retain(|port, entry| {
        let alive = now.duration_since(entry.created_at) < PENDING_SERVER_TTL;
        if !alive {
            tracing::debug!("Cleaned up expired pending OAuth server on port {}", port);
        }
        alive
    });
}

/// Server-side data for an in-flight OAuth flow.
///
/// The PKCE `verifier` is kept SERVER-SIDE (never returned to the frontend) and
/// is looked up by the `state` parameter once the provider redirects back. The
/// `redirect_uri` is stored so the token exchange can reproduce the exact value
/// sent in the authorize request.
#[derive(Debug, Clone)]
pub struct PendingOAuthFlow {
    /// The OAuth provider for this flow.
    pub provider: OAuthProvider,
    /// PKCE code verifier (secret — never sent to the frontend).
    pub verifier: String,
    /// Instance / issuer URL (GitLab self-hosted, Azure tenant, OIDC issuer).
    pub instance_url: Option<String>,
    /// The redirect URI used when building the authorize URL.
    pub redirect_uri: String,
    /// Creation timestamp for TTL enforcement.
    pub created_at: std::time::Instant,
}

/// State for pending OAuth flows, keyed by the issued `state` parameter.
///
/// This stores the PKCE verifier and per-flow metadata server-side so the
/// verifier never has to round-trip through the frontend, and so the `state`
/// echoed back on the callback can be validated (CSRF / flow-binding).
pub struct OAuthState {
    /// Map of `state` -> pending flow data.
    pending: Mutex<HashMap<String, PendingOAuthFlow>>,
}

impl Default for OAuthState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }
}

impl OAuthState {
    /// Insert a pending flow keyed by its `state`, evicting any expired flows.
    pub fn insert_pending(&self, state: String, flow: PendingOAuthFlow) -> Result<()> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|e| LeviathanError::OAuth(format!("Failed to store OAuth flow: {}", e)))?;
        cleanup_expired_flows(&mut pending);
        pending.insert(state, flow);
        Ok(())
    }

    /// Look up and REMOVE the pending flow for a given `state`.
    ///
    /// Returns `None` if no matching flow exists (state mismatch / expired /
    /// already consumed) — callers MUST treat that as a rejected callback.
    pub fn take_pending(&self, state: &str) -> Result<Option<PendingOAuthFlow>> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|e| LeviathanError::OAuth(format!("Failed to access OAuth flow: {}", e)))?;
        cleanup_expired_flows(&mut pending);
        Ok(pending.remove(state))
    }
}

/// Remove expired pending OAuth flows (same TTL as pending loopback servers).
fn cleanup_expired_flows(map: &mut HashMap<String, PendingOAuthFlow>) {
    let now = std::time::Instant::now();
    map.retain(|_, flow| now.duration_since(flow.created_at) < PENDING_SERVER_TTL);
}

/// Global storage for in-flight OAuth flows (keyed by `state`).
///
/// Used because the OAuth Tauri commands are free functions and `OAuthState`
/// is not registered as Tauri-managed state.
static OAUTH_FLOWS: Lazy<OAuthState> = Lazy::new(OAuthState::default);

/// Response from starting an OAuth flow
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOAuthResponse {
    /// The URL to open in the browser
    pub authorize_url: String,
    /// State for CSRF protection.
    ///
    /// The PKCE verifier is intentionally NOT returned: it is stored
    /// server-side keyed by this `state` and looked up during token exchange.
    pub state: String,
    /// Port if using loopback server (for GitHub)
    pub loopback_port: Option<u16>,
}

/// Request to exchange authorization code for tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeCodeRequest {
    pub provider: String,
    pub code: String,
    pub verifier: String,
    pub instance_url: Option<String>,
    pub redirect_uri: String,
}

/// Get the authorize URL for OAuth flow
///
/// For GitHub, this also starts a loopback server to receive the callback.
/// For other providers, returns a deep link redirect URI.
#[tauri::command]
pub async fn oauth_get_authorize_url(
    provider: String,
    instance_url: Option<String>,
    client_id: String,
) -> Result<StartOAuthResponse> {
    let provider_enum: OAuthProvider = provider
        .parse()
        .map_err(|e: String| LeviathanError::OAuth(e))?;

    // Generate PKCE challenge
    let pkce = PKCEChallenge::new();
    let state = generate_state();

    // Build config based on provider
    let (config, loopback_port) = match provider_enum {
        OAuthProvider::GitHub => {
            // GitHub requires loopback server
            let server = LoopbackServer::new()?;
            let port = server.port();
            let config = OAuthConfig::github(&client_id, port);

            // Cleanup expired servers, then store for later retrieval
            let mut servers = PENDING_SERVERS
                .lock()
                .map_err(|e| LeviathanError::OAuth(format!("Failed to store server: {}", e)))?;
            cleanup_expired_pending_servers(&mut servers);
            servers.insert(
                port,
                PendingServer {
                    server,
                    created_at: std::time::Instant::now(),
                },
            );

            (config, Some(port))
        }
        OAuthProvider::GitLab => {
            // GitLab uses loopback server (like GitHub)
            let server = LoopbackServer::new()?;
            let port = server.port();
            let config = OAuthConfig::gitlab(&client_id, instance_url.as_deref(), port);

            // Cleanup expired servers, then store for later retrieval
            let mut servers = PENDING_SERVERS
                .lock()
                .map_err(|e| LeviathanError::OAuth(format!("Failed to store server: {}", e)))?;
            cleanup_expired_pending_servers(&mut servers);
            servers.insert(
                port,
                PendingServer {
                    server,
                    created_at: std::time::Instant::now(),
                },
            );

            (config, Some(port))
        }
        OAuthProvider::Azure => {
            // For Azure, instance_url is used as tenant_id
            let config = OAuthConfig::azure(&client_id, instance_url.as_deref());
            (config, None)
        }
        OAuthProvider::Bitbucket => {
            // Bitbucket requires http/https redirect URIs and only allows ONE callback URL
            // We use a dedicated port (8085) to avoid conflicts with GitHub/GitLab
            const BITBUCKET_PORT: u16 = 8085;
            let server = LoopbackServer::new_with_port(BITBUCKET_PORT)?;
            let port = server.port();
            let config = OAuthConfig::bitbucket(&client_id, port);

            // Cleanup expired servers, then store for later retrieval
            let mut servers = PENDING_SERVERS
                .lock()
                .map_err(|e| LeviathanError::OAuth(format!("Failed to store server: {}", e)))?;
            cleanup_expired_pending_servers(&mut servers);
            servers.insert(
                port,
                PendingServer {
                    server,
                    created_at: std::time::Instant::now(),
                },
            );

            (config, Some(port))
        }
        OAuthProvider::Oidc => {
            // OIDC: instance_url is the issuer URL — discover endpoints
            let issuer_url = instance_url.as_deref().ok_or_else(|| {
                LeviathanError::OAuth(
                    "OIDC requires an issuer URL (pass as instanceUrl)".to_string(),
                )
            })?;

            let discovery = crate::services::oauth::discover_oidc_config(issuer_url)
                .await
                .map_err(LeviathanError::OAuth)?;

            let server = LoopbackServer::new()?;
            let port = server.port();
            let scopes = vec![
                "openid".to_string(),
                "profile".to_string(),
                "email".to_string(),
            ];
            let config = OAuthConfig::oidc(
                &client_id,
                &discovery.authorization_endpoint,
                &discovery.token_endpoint,
                scopes,
                port,
            );

            // Cleanup expired servers, then store for later retrieval
            let mut servers = PENDING_SERVERS
                .lock()
                .map_err(|e| LeviathanError::OAuth(format!("Failed to store server: {}", e)))?;
            cleanup_expired_pending_servers(&mut servers);
            servers.insert(
                port,
                PendingServer {
                    server,
                    created_at: std::time::Instant::now(),
                },
            );

            (config, Some(port))
        }
    };

    let authorize_url = config.build_authorize_url(&pkce, &state);

    // Store the PKCE verifier and per-flow data SERVER-SIDE, keyed by `state`.
    // The verifier is never returned to the frontend; the loopback callback and
    // token exchange look it up by the `state` value the provider echoes back.
    OAUTH_FLOWS.insert_pending(
        state.clone(),
        PendingOAuthFlow {
            provider: provider_enum,
            verifier: pkce.verifier,
            instance_url,
            redirect_uri: config.redirect_uri.clone(),
            created_at: std::time::Instant::now(),
        },
    )?;

    Ok(StartOAuthResponse {
        authorize_url,
        state,
        loopback_port,
    })
}

/// Start GitHub OAuth flow with loopback server
///
/// This starts a loopback server and returns immediately.
/// The server will wait for the callback and the frontend should poll
/// using `oauth_poll_github_callback`.
#[tauri::command]
pub async fn oauth_start_github_flow(client_id: String) -> Result<StartOAuthResponse> {
    oauth_get_authorize_url("github".to_string(), None, client_id).await
}

/// Exchange authorization code for tokens.
///
/// The PKCE `verifier`, provider, redirect URI, and instance/issuer URL are
/// looked up SERVER-SIDE from the pending-flow map keyed by `state` — they are
/// NOT accepted from the frontend. This both validates the `state` (it must
/// match an in-flight flow this process issued) and prevents the PKCE secret
/// from round-tripping through the client.
#[tauri::command]
pub async fn oauth_exchange_code(
    state: String,
    code: String,
    client_id: String,
    client_secret: Option<String>,
) -> Result<OAuthTokenResponse> {
    // Look up (and consume) the pending flow for this state. A missing entry
    // means the state is unknown/expired/replayed — reject the exchange.
    let flow = OAUTH_FLOWS.take_pending(&state)?.ok_or_else(|| {
        LeviathanError::OAuth("OAuth state did not match any pending flow".to_string())
    })?;

    let provider_enum = flow.provider.clone();
    let verifier = flow.verifier.clone();
    let redirect_uri = flow.redirect_uri.clone();
    let instance_url = flow.instance_url.clone();

    // Build token URL based on provider
    let token_url = match provider_enum {
        OAuthProvider::GitHub => "https://github.com/login/oauth/access_token".to_string(),
        OAuthProvider::GitLab => {
            let base = instance_url.as_deref().unwrap_or("https://gitlab.com");
            format!("{}/oauth/token", base)
        }
        OAuthProvider::Azure => {
            let tenant = instance_url.as_deref().unwrap_or("common");
            format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
                tenant
            )
        }
        OAuthProvider::Bitbucket => "https://bitbucket.org/site/oauth2/access_token".to_string(),
        OAuthProvider::Oidc => {
            // For OIDC, discover the token endpoint from the issuer URL
            let issuer = instance_url
                .as_deref()
                .ok_or_else(|| LeviathanError::OAuth("OIDC requires issuer URL".to_string()))?;
            let discovery = crate::services::oauth::discover_oidc_config(issuer)
                .await
                .map_err(LeviathanError::OAuth)?;
            discovery.token_endpoint
        }
    };

    // Build request body
    let mut params = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.clone()),
        ("redirect_uri", redirect_uri.clone()),
        ("client_id", client_id.clone()),
        ("code_verifier", verifier.clone()),
    ];

    // Add client_secret if provided (required for GitHub OAuth Apps)
    if let Some(ref secret) = client_secret {
        params.push(("client_secret", secret.clone()));
    }

    // Make token request
    let client = reqwest::Client::new();
    let response = client
        .post(&token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| LeviathanError::OAuth(format!("Token request failed: {}", e)))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        // Some IdPs echo the submitted `code` / `code_verifier` (PKCE secret)
        // back in 4xx response bodies. Discard the body before surfacing the
        // error so it doesn't reach toasts or logs.
        tracing::debug!(
            "OAuth exchange failed with status {} ({} body bytes discarded)",
            status,
            text.len()
        );
        return Err(LeviathanError::OAuth(format!(
            "Token request failed with status {}",
            status
        )));
    }

    // Check if the response contains an error (GitHub returns 200 with error in body)
    if let Ok(error_response) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(error) = error_response.get("error").and_then(|e| e.as_str()) {
            let description = error_response
                .get("error_description")
                .and_then(|d| d.as_str())
                .unwrap_or("Unknown error");
            return Err(LeviathanError::OAuth(format!("{}: {}", error, description)));
        }
    }

    // Try to parse as token response. Do NOT log the raw response — it contains
    // access_token / refresh_token / id_token in plaintext.
    tracing::debug!("Token exchange response received ({} bytes)", text.len());
    let tokens: OAuthTokenResponse = serde_json::from_str(&text)
        .map_err(|e| LeviathanError::OAuth(format!("Failed to parse token response: {}", e)))?;

    tracing::info!(
        "Parsed token - has access_token: {}",
        !tokens.access_token.is_empty()
    );
    Ok(tokens)
}

/// Refresh an OAuth token
#[tauri::command]
pub async fn oauth_refresh_token(
    provider: String,
    refresh_token: String,
    client_id: String,
    instance_url: Option<String>,
) -> Result<OAuthTokenResponse> {
    let provider_enum: OAuthProvider = provider
        .parse()
        .map_err(|e: String| LeviathanError::OAuth(e))?;

    // Build token URL based on provider
    let token_url = match provider_enum {
        OAuthProvider::GitHub => "https://github.com/login/oauth/access_token".to_string(),
        OAuthProvider::GitLab => {
            let base = instance_url.as_deref().unwrap_or("https://gitlab.com");
            format!("{}/oauth/token", base)
        }
        OAuthProvider::Azure => {
            let tenant = instance_url.as_deref().unwrap_or("common");
            format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
                tenant
            )
        }
        OAuthProvider::Bitbucket => "https://bitbucket.org/site/oauth2/access_token".to_string(),
        OAuthProvider::Oidc => {
            let issuer = instance_url
                .as_deref()
                .ok_or_else(|| LeviathanError::OAuth("OIDC requires issuer URL".to_string()))?;
            let discovery = crate::services::oauth::discover_oidc_config(issuer)
                .await
                .map_err(LeviathanError::OAuth)?;
            discovery.token_endpoint
        }
    };

    // Build request body
    let params = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh_token),
        ("client_id", &client_id),
    ];

    // Make token request
    let client = reqwest::Client::new();
    let response = client
        .post(&token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| LeviathanError::OAuth(format!("Refresh request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        // Some IdPs echo the submitted refresh_token back inside 4xx error
        // bodies. Discard the body so it doesn't propagate to user-visible
        // error toasts or logs.
        let body_len = response.text().await.unwrap_or_default().len();
        tracing::debug!(
            "OAuth refresh failed with status {} ({} body bytes discarded)",
            status,
            body_len
        );
        return Err(LeviathanError::OAuth(format!(
            "Refresh request failed with status {}",
            status
        )));
    }

    let tokens: OAuthTokenResponse = response
        .json()
        .await
        .map_err(|e| LeviathanError::OAuth(format!("Failed to parse token response: {}", e)))?;

    Ok(tokens)
}

/// Result of a validated loopback OAuth callback returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallbackResponse {
    /// Authorization code to pass to `oauth_exchange_code`.
    pub code: String,
    /// The validated `state` (matches an in-flight flow); pass this back to
    /// `oauth_exchange_code` so the server can look up the PKCE verifier.
    pub state: String,
}

/// Wait for loopback callback (works for GitHub, GitLab, and any provider using loopback)
///
/// This should be called after opening the authorize URL. It waits for the
/// callback on the loopback server, VALIDATES the `state` parameter echoed back
/// by the provider against the set of in-flight flows this process issued, and
/// returns the authorization code together with the validated state. A callback
/// whose `state` does not match a pending flow is rejected (CSRF protection).
#[tauri::command]
pub async fn oauth_wait_for_callback(port: u16) -> Result<CallbackResponse> {
    // Retrieve the stored server for this port
    let pending = PENDING_SERVERS
        .lock()
        .map_err(|e| LeviathanError::OAuth(format!("Failed to access server storage: {}", e)))?
        .remove(&port)
        .ok_or_else(|| LeviathanError::OAuth(format!("No server found for port {}", port)))?;

    // Use the server's wait_for_callback method
    // This runs in a blocking thread to avoid blocking the async runtime
    let timeout = Duration::from_secs(300); // 5 minutes

    let callback = tokio::task::spawn_blocking(move || pending.server.wait_for_callback(timeout))
        .await
        .map_err(|e| LeviathanError::OAuth(format!("Task join error: {}", e)))??;

    // Validate the returned `state` against an in-flight flow. We only PEEK here
    // (the flow is consumed later by `oauth_exchange_code`), so confirm a match
    // without removing the entry.
    validate_callback_state(&callback.state)?;

    Ok(CallbackResponse {
        code: callback.code,
        state: callback.state,
    })
}

/// Confirm that the given `state` matches an in-flight OAuth flow without
/// consuming it. Returns an error if no matching flow exists.
fn validate_callback_state(state: &str) -> Result<()> {
    let pending = OAUTH_FLOWS
        .pending
        .lock()
        .map_err(|e| LeviathanError::OAuth(format!("Failed to access OAuth flow: {}", e)))?;
    if pending.contains_key(state) {
        Ok(())
    } else {
        Err(LeviathanError::OAuth(
            "OAuth callback state did not match any pending flow".to_string(),
        ))
    }
}

/// Alias for backward compatibility
#[tauri::command]
pub async fn oauth_wait_for_github_callback(port: u16) -> Result<CallbackResponse> {
    oauth_wait_for_callback(port).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // StartOAuthResponse Tests
    // ==========================================================================

    #[test]
    fn test_start_oauth_response_serialization() {
        let response = StartOAuthResponse {
            authorize_url: "https://example.com/oauth".to_string(),
            state: "test-state".to_string(),
            loopback_port: Some(8080),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("authorizeUrl"));
        assert!(json.contains("state"));
        assert!(json.contains("loopbackPort"));
        // SECURITY: the PKCE verifier must NOT be serialized to the frontend.
        assert!(!json.contains("verifier"));
    }

    #[test]
    fn test_start_oauth_response_without_loopback_port() {
        let response = StartOAuthResponse {
            authorize_url: "https://example.com/oauth".to_string(),
            state: "test-state".to_string(),
            loopback_port: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("loopbackPort"));
        assert!(json.contains("null"));
    }

    #[test]
    fn test_start_oauth_response_deserialization() {
        let json = r#"{
            "authorizeUrl": "https://example.com/oauth",
            "state": "test-state",
            "loopbackPort": 8080
        }"#;

        let response: StartOAuthResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.authorize_url, "https://example.com/oauth");
        assert_eq!(response.state, "test-state");
        assert_eq!(response.loopback_port, Some(8080));
    }

    // ==========================================================================
    // ExchangeCodeRequest Tests
    // ==========================================================================

    #[test]
    fn test_exchange_code_request_serialization() {
        let request = ExchangeCodeRequest {
            provider: "github".to_string(),
            code: "auth-code".to_string(),
            verifier: "test-verifier".to_string(),
            instance_url: None,
            redirect_uri: "http://127.0.0.1:8080/callback".to_string(),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("provider"));
        assert!(json.contains("code"));
        assert!(json.contains("verifier"));
        assert!(json.contains("instanceUrl"));
        assert!(json.contains("redirectUri"));
    }

    #[test]
    fn test_exchange_code_request_with_instance_url() {
        let request = ExchangeCodeRequest {
            provider: "gitlab".to_string(),
            code: "auth-code".to_string(),
            verifier: "test-verifier".to_string(),
            instance_url: Some("https://gitlab.example.com".to_string()),
            redirect_uri: "http://127.0.0.1:8080/callback".to_string(),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("gitlab.example.com"));
    }

    #[test]
    fn test_exchange_code_request_deserialization() {
        let json = r#"{
            "provider": "github",
            "code": "auth-code",
            "verifier": "test-verifier",
            "instanceUrl": null,
            "redirectUri": "http://127.0.0.1:8080/callback"
        }"#;

        let request: ExchangeCodeRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.provider, "github");
        assert_eq!(request.code, "auth-code");
        assert_eq!(request.verifier, "test-verifier");
        assert!(request.instance_url.is_none());
        assert_eq!(request.redirect_uri, "http://127.0.0.1:8080/callback");
    }

    // ==========================================================================
    // OAuthState Tests
    // ==========================================================================

    #[test]
    fn test_oauth_state_default() {
        let state = OAuthState::default();
        let pending = state.pending.lock().unwrap();
        assert!(pending.is_empty());
    }

    // ==========================================================================
    // oauth_get_authorize_url Tests
    // ==========================================================================

    #[tokio::test]
    async fn test_oauth_get_authorize_url_github() {
        let result =
            oauth_get_authorize_url("github".to_string(), None, "test-client-id".to_string()).await;

        assert!(result.is_ok());
        let response = result.unwrap();

        assert!(response.authorize_url.contains("github.com"));
        assert!(response.authorize_url.contains("client_id=test-client-id"));
        assert!(response.authorize_url.contains("response_type=code"));
        assert!(response.authorize_url.contains("code_challenge="));
        assert!(!response.state.is_empty());
        assert!(response.loopback_port.is_some());

        // The verifier is stored server-side keyed by state, not returned.
        let flow = OAUTH_FLOWS
            .take_pending(&response.state)
            .unwrap()
            .expect("pending flow should be stored for the issued state");
        assert!(!flow.verifier.is_empty());
        assert_eq!(flow.provider, OAuthProvider::GitHub);
    }

    #[tokio::test]
    async fn test_oauth_get_authorize_url_gitlab() {
        let result =
            oauth_get_authorize_url("gitlab".to_string(), None, "test-client-id".to_string()).await;

        assert!(result.is_ok());
        let response = result.unwrap();

        assert!(response.authorize_url.contains("gitlab.com"));
        assert!(response.authorize_url.contains("client_id=test-client-id"));
        assert!(response.loopback_port.is_some());
    }

    #[tokio::test]
    async fn test_oauth_get_authorize_url_gitlab_custom_instance() {
        let result = oauth_get_authorize_url(
            "gitlab".to_string(),
            Some("https://gitlab.example.com".to_string()),
            "test-client-id".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let response = result.unwrap();

        assert!(response.authorize_url.contains("gitlab.example.com"));
    }

    #[tokio::test]
    async fn test_oauth_get_authorize_url_azure() {
        let result =
            oauth_get_authorize_url("azure".to_string(), None, "test-client-id".to_string()).await;

        assert!(result.is_ok());
        let response = result.unwrap();

        assert!(response.authorize_url.contains("login.microsoftonline.com"));
        assert!(response.authorize_url.contains("common"));
        // Azure uses deep link, not loopback server
        assert!(response.loopback_port.is_none());
    }

    #[tokio::test]
    async fn test_oauth_get_authorize_url_azure_custom_tenant() {
        let result = oauth_get_authorize_url(
            "azure".to_string(),
            Some("my-tenant-id".to_string()),
            "test-client-id".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let response = result.unwrap();

        assert!(response.authorize_url.contains("my-tenant-id"));
    }

    #[tokio::test]
    async fn test_oauth_get_authorize_url_bitbucket() {
        let result =
            oauth_get_authorize_url("bitbucket".to_string(), None, "test-client-id".to_string())
                .await;

        assert!(result.is_ok());
        let response = result.unwrap();

        assert!(response.authorize_url.contains("bitbucket.org"));
        assert!(response.loopback_port.is_some());
        // Bitbucket uses dedicated port 8085
        assert_eq!(response.loopback_port, Some(8085));
    }

    #[tokio::test]
    async fn test_oauth_get_authorize_url_invalid_provider() {
        let result = oauth_get_authorize_url(
            "invalid-provider".to_string(),
            None,
            "test-client-id".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_oauth_get_authorize_url_generates_unique_state() {
        let result1 =
            oauth_get_authorize_url("azure".to_string(), None, "test-client-id".to_string()).await;
        let result2 =
            oauth_get_authorize_url("azure".to_string(), None, "test-client-id".to_string()).await;

        assert!(result1.is_ok());
        assert!(result2.is_ok());

        let response1 = result1.unwrap();
        let response2 = result2.unwrap();

        // Each call should generate unique state
        assert_ne!(response1.state, response2.state);

        // Each call stores a unique verifier server-side (never returned).
        let flow1 = OAUTH_FLOWS.take_pending(&response1.state).unwrap().unwrap();
        let flow2 = OAUTH_FLOWS.take_pending(&response2.state).unwrap().unwrap();
        assert_ne!(flow1.verifier, flow2.verifier);
    }

    // ==========================================================================
    // oauth_start_github_flow Tests
    // ==========================================================================

    #[tokio::test]
    async fn test_oauth_start_github_flow() {
        let result = oauth_start_github_flow("test-client-id".to_string()).await;

        assert!(result.is_ok());
        let response = result.unwrap();

        assert!(response.authorize_url.contains("github.com"));
        assert!(response.loopback_port.is_some());
    }

    // ==========================================================================
    // oauth_wait_for_callback Tests
    // ==========================================================================

    #[tokio::test]
    async fn test_oauth_wait_for_callback_no_server() {
        // Attempting to wait on a port with no pending server should fail
        let result = oauth_wait_for_callback(59999).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_oauth_wait_for_github_callback_alias() {
        // The alias should behave the same as oauth_wait_for_callback
        let result = oauth_wait_for_github_callback(59999).await;
        assert!(result.is_err());
    }

    // ==========================================================================
    // Provider Case Sensitivity Tests
    // ==========================================================================

    #[tokio::test]
    async fn test_oauth_provider_case_insensitive() {
        let result_lower =
            oauth_get_authorize_url("github".to_string(), None, "test-client-id".to_string()).await;
        let result_upper =
            oauth_get_authorize_url("GITHUB".to_string(), None, "test-client-id".to_string()).await;
        let result_mixed =
            oauth_get_authorize_url("GitHub".to_string(), None, "test-client-id".to_string()).await;

        assert!(result_lower.is_ok());
        assert!(result_upper.is_ok());
        assert!(result_mixed.is_ok());
    }

    // ==========================================================================
    // URL Structure Tests
    // ==========================================================================

    #[tokio::test]
    async fn test_oauth_authorize_url_contains_pkce() {
        let result =
            oauth_get_authorize_url("github".to_string(), None, "test-client-id".to_string()).await;

        assert!(result.is_ok());
        let response = result.unwrap();

        assert!(response.authorize_url.contains("code_challenge="));
        assert!(response
            .authorize_url
            .contains("code_challenge_method=S256"));
    }

    #[tokio::test]
    async fn test_oauth_authorize_url_contains_scopes() {
        let result =
            oauth_get_authorize_url("github".to_string(), None, "test-client-id".to_string()).await;

        assert!(result.is_ok());
        let response = result.unwrap();

        // GitHub scopes include "repo" and "read:user"
        assert!(response.authorize_url.contains("scope="));
    }

    // ==========================================================================
    // Pending Server Cleanup Tests
    // ==========================================================================

    #[test]
    fn test_cleanup_expired_pending_servers_removes_old() {
        let mut map: HashMap<u16, PendingServer> = HashMap::new();
        // Create a server that is already expired
        let server = LoopbackServer::new().unwrap();
        let port = server.port();
        map.insert(
            port,
            PendingServer {
                server,
                created_at: std::time::Instant::now() - PENDING_SERVER_TTL - Duration::from_secs(1),
            },
        );

        cleanup_expired_pending_servers(&mut map);
        assert!(map.is_empty(), "expired server should be removed");
    }

    #[test]
    fn test_cleanup_expired_pending_servers_keeps_fresh() {
        let mut map: HashMap<u16, PendingServer> = HashMap::new();
        let server = LoopbackServer::new().unwrap();
        let port = server.port();
        map.insert(
            port,
            PendingServer {
                server,
                created_at: std::time::Instant::now(),
            },
        );

        cleanup_expired_pending_servers(&mut map);
        assert_eq!(map.len(), 1, "fresh server should remain");
    }

    #[test]
    fn test_cleanup_empty_pending_servers() {
        let mut map: HashMap<u16, PendingServer> = HashMap::new();
        cleanup_expired_pending_servers(&mut map);
        assert!(map.is_empty());
    }

    #[test]
    fn test_cleanup_mixed_pending_servers() {
        let mut map: HashMap<u16, PendingServer> = HashMap::new();

        // Add an expired server
        let old_server = LoopbackServer::new().unwrap();
        let old_port = old_server.port();
        map.insert(
            old_port,
            PendingServer {
                server: old_server,
                created_at: std::time::Instant::now()
                    - PENDING_SERVER_TTL
                    - Duration::from_secs(60),
            },
        );

        // Add a fresh server
        let new_server = LoopbackServer::new().unwrap();
        let new_port = new_server.port();
        map.insert(
            new_port,
            PendingServer {
                server: new_server,
                created_at: std::time::Instant::now(),
            },
        );

        cleanup_expired_pending_servers(&mut map);
        assert_eq!(map.len(), 1);
        assert!(map.contains_key(&new_port));
        assert!(!map.contains_key(&old_port));
    }

    // ==========================================================================
    // decode_oidc_id_token Command Tests
    // ==========================================================================

    #[tokio::test]
    async fn test_decode_oidc_id_token_valid() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

        let payload = serde_json::json!({
            "sub": "user-456",
            "email": "test@example.com",
            "name": "OIDC User"
        });
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
        let header_b64 = URL_SAFE_NO_PAD.encode(b"{}");
        let token = format!("{}.{}.sig", header_b64, payload_b64);

        let result = decode_oidc_id_token(token).await;
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.sub, "user-456");
        assert_eq!(info.email, Some("test@example.com".to_string()));
        assert_eq!(info.name, Some("OIDC User".to_string()));
    }

    #[tokio::test]
    async fn test_decode_oidc_id_token_invalid() {
        let result = decode_oidc_id_token("not.valid".to_string()).await;
        assert!(result.is_err());
    }

    // ==========================================================================
    // Multiple OAuth Flows Tests
    // ==========================================================================

    #[tokio::test]
    async fn test_multiple_concurrent_github_flows() {
        // Start multiple GitHub OAuth flows — each should get a unique port/state
        let result1 =
            oauth_get_authorize_url("github".to_string(), None, "client1".to_string()).await;
        let result2 =
            oauth_get_authorize_url("github".to_string(), None, "client2".to_string()).await;

        assert!(result1.is_ok());
        assert!(result2.is_ok());

        let r1 = result1.unwrap();
        let r2 = result2.unwrap();

        // Different ports and states
        assert_ne!(r1.loopback_port, r2.loopback_port);
        assert_ne!(r1.state, r2.state);

        // Each flow's verifier (stored server-side) is unique.
        let f1 = OAUTH_FLOWS.take_pending(&r1.state).unwrap().unwrap();
        let f2 = OAUTH_FLOWS.take_pending(&r2.state).unwrap().unwrap();
        assert_ne!(f1.verifier, f2.verifier);
    }

    fn make_flow(provider: OAuthProvider, verifier: &str) -> PendingOAuthFlow {
        PendingOAuthFlow {
            provider,
            verifier: verifier.to_string(),
            instance_url: None,
            redirect_uri: "http://127.0.0.1:8080/callback".to_string(),
            created_at: std::time::Instant::now(),
        }
    }

    #[test]
    fn test_oauth_state_pending_operations() {
        let state = OAuthState::default();

        // Insert a pending flow and round-trip it by `state` key.
        state
            .insert_pending(
                "rt-state".to_string(),
                make_flow(OAuthProvider::GitHub, "v1"),
            )
            .unwrap();

        let flow = state.take_pending("rt-state").unwrap().unwrap();
        assert_eq!(flow.provider, OAuthProvider::GitHub);
        assert_eq!(flow.verifier, "v1");
        assert!(flow.instance_url.is_none());

        // take_pending consumes the entry: a second lookup yields None.
        assert!(state.take_pending("rt-state").unwrap().is_none());
    }

    #[test]
    fn test_take_pending_state_mismatch_rejected() {
        let state = OAuthState::default();
        state
            .insert_pending(
                "issued-state".to_string(),
                make_flow(OAuthProvider::GitLab, "v2"),
            )
            .unwrap();

        // A non-matching state must not resolve to any flow.
        assert!(state.take_pending("attacker-state").unwrap().is_none());
        // The legitimate state still resolves.
        assert!(state.take_pending("issued-state").unwrap().is_some());
    }

    #[test]
    fn test_validate_callback_state_via_global_store() {
        // Insert into the global flow store and validate the state matches.
        OAUTH_FLOWS
            .insert_pending(
                "global-valid-state".to_string(),
                make_flow(OAuthProvider::GitHub, "vg"),
            )
            .unwrap();

        assert!(validate_callback_state("global-valid-state").is_ok());
        assert!(validate_callback_state("does-not-exist").is_err());

        // Validation peeks without consuming — the flow is still retrievable.
        assert!(OAUTH_FLOWS
            .take_pending("global-valid-state")
            .unwrap()
            .is_some());
    }

    #[test]
    fn test_exchange_code_request_all_fields() {
        let request = ExchangeCodeRequest {
            provider: "oidc".to_string(),
            code: "auth-code-123".to_string(),
            verifier: "pkce-verifier".to_string(),
            instance_url: Some("https://auth.example.com".to_string()),
            redirect_uri: "http://127.0.0.1:9090/callback".to_string(),
        };

        // Round-trip serialization
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ExchangeCodeRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.provider, "oidc");
        assert_eq!(deserialized.code, "auth-code-123");
        assert_eq!(deserialized.verifier, "pkce-verifier");
        assert_eq!(
            deserialized.instance_url,
            Some("https://auth.example.com".to_string())
        );
    }
}

// ========================================================================
// OIDC Commands
// ========================================================================

/// Discover an OIDC provider's configuration from its issuer URL
#[tauri::command]
pub async fn discover_oidc_provider(
    issuer_url: String,
) -> Result<crate::services::oauth::OidcDiscovery> {
    crate::services::oauth::discover_oidc_config(&issuer_url)
        .await
        .map_err(LeviathanError::OperationFailed)
}

/// Decode an OIDC ID token to extract user identity
#[tauri::command]
pub async fn decode_oidc_id_token(
    id_token: String,
) -> Result<crate::services::oauth::OidcUserInfo> {
    crate::services::oauth::decode_id_token(&id_token).map_err(LeviathanError::OperationFailed)
}
