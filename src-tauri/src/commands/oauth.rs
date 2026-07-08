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
    /// The client ID used to build the authorize URL. Stored so the token
    /// exchange can reuse it for providers (e.g. OIDC) whose client ID is
    /// per-account and therefore not available from the embedded client-ID map
    /// the frontend uses for the built-in providers.
    pub client_id: String,
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
            // Azure DevOps (Entra ID) does not use the redirect/authorization-code
            // flow: the embedded public client doesn't own our redirect URIs, so
            // Entra would reject them (AADSTS50011). Sign-in goes through the
            // device-code flow instead (oauth_start_device_code / oauth_poll_device_code).
            return Err(LeviathanError::OAuth(
                "Azure DevOps uses device-code sign-in — call oauth_start_device_code".to_string(),
            ));
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
            client_id: config.client_id.clone(),
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

    // Prefer the frontend-supplied client ID (built-in providers source it from
    // the embedded client-ID map), but fall back to the one captured when the
    // authorize URL was built. OIDC client IDs are per-account, so the frontend
    // passes an empty string for them and we must use the stored value.
    let client_id = if client_id.trim().is_empty() {
        flow.client_id.clone()
    } else {
        client_id
    };

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
    let mut pending = OAUTH_FLOWS
        .pending
        .lock()
        .map_err(|e| LeviathanError::OAuth(format!("Failed to access OAuth flow: {}", e)))?;
    // Evict expired flows first so this peek stays consistent with the later
    // consume in `oauth_exchange_code` (which also cleans up). Otherwise an
    // expired state could validate here only to fail at exchange time.
    cleanup_expired_flows(&mut pending);
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

// ========================================================================
// Device Authorization Grant (OAuth 2.0 Device Code) — used by Azure DevOps
// ========================================================================
//
// The device-code flow needs no redirect URI, so it works with the embedded
// public client (whose registered redirects we don't control). The user is shown
// a short code to enter at a verification URL; the backend polls the token
// endpoint until they finish. This is how `az devops` / Git Credential Manager
// authenticate against Azure DevOps.

/// Server-side state for an in-flight device-code flow, keyed by a generated flow id.
struct PendingDeviceFlow {
    provider: OAuthProvider,
    /// Client ID used to start the flow (reused for polling).
    client_id: String,
    /// Instance / tenant (Azure). Determines the token endpoint.
    instance_url: Option<String>,
    /// The device_code secret returned by the authorization server.
    device_code: String,
    /// Poll interval in seconds (may be increased on `slow_down`).
    interval: u64,
    /// Absolute expiry — polling stops after this.
    expires_at: std::time::Instant,
}

static DEVICE_FLOWS: Lazy<Mutex<HashMap<String, PendingDeviceFlow>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Response returned to the frontend when a device-code flow starts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDeviceCodeResponse {
    /// Handle used to poll this flow (the device_code itself stays server-side).
    pub flow_id: String,
    /// Short code the user types at the verification URL.
    pub user_code: String,
    /// URL the user opens to enter the code.
    pub verification_uri: String,
    /// Seconds until the code expires.
    pub expires_in: u64,
    /// Suggested seconds between polls.
    pub interval: u64,
    /// Human-readable instruction message from the provider.
    pub message: String,
}

/// Azure DevOps scopes requested for the device-code flow.
const AZURE_DEVICE_SCOPES: &str =
    "499b84ac-1321-427f-aa17-267ca6975798/user_impersonation offline_access";

fn azure_tenant_base(instance_url: Option<&str>) -> String {
    let tenant = instance_url.unwrap_or("common");
    format!("https://login.microsoftonline.com/{}/oauth2/v2.0", tenant)
}

/// Start a device-code flow. Currently only Azure (Entra ID) is supported.
#[tauri::command]
pub async fn oauth_start_device_code(
    provider: String,
    client_id: String,
    instance_url: Option<String>,
) -> Result<StartDeviceCodeResponse> {
    let provider_enum: OAuthProvider = provider
        .parse()
        .map_err(|e: String| LeviathanError::OAuth(e))?;

    let (device_url, scopes) = match provider_enum {
        OAuthProvider::Azure => (
            format!("{}/devicecode", azure_tenant_base(instance_url.as_deref())),
            AZURE_DEVICE_SCOPES,
        ),
        _ => {
            return Err(LeviathanError::OAuth(
                "Device-code flow is not supported for this provider".to_string(),
            ))
        }
    };

    #[derive(Deserialize)]
    struct DeviceCodeApiResponse {
        device_code: String,
        user_code: String,
        verification_uri: String,
        expires_in: u64,
        interval: u64,
        message: Option<String>,
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&device_url)
        .header("Accept", "application/json")
        .form(&[("client_id", client_id.as_str()), ("scope", scopes)])
        .send()
        .await
        .map_err(|e| LeviathanError::OAuth(format!("Device code request failed: {}", e)))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        // Surface the provider's error field without echoing the whole body.
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error_description")
                    .or_else(|| v.get("error"))
                    .and_then(|d| d.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("HTTP {}", status));
        return Err(LeviathanError::OAuth(format!(
            "Failed to start device sign-in: {}",
            msg
        )));
    }

    let data: DeviceCodeApiResponse = serde_json::from_str(&text).map_err(|e| {
        LeviathanError::OAuth(format!("Failed to parse device code response: {}", e))
    })?;

    let flow_id = generate_state();
    let expires_at = std::time::Instant::now() + Duration::from_secs(data.expires_in);

    {
        let mut flows = DEVICE_FLOWS
            .lock()
            .map_err(|e| LeviathanError::OAuth(format!("Failed to store device flow: {}", e)))?;
        // Evict expired flows opportunistically.
        let now = std::time::Instant::now();
        flows.retain(|_, f| f.expires_at > now);
        flows.insert(
            flow_id.clone(),
            PendingDeviceFlow {
                provider: provider_enum,
                client_id,
                instance_url,
                device_code: data.device_code,
                interval: data.interval,
                expires_at,
            },
        );
    }

    Ok(StartDeviceCodeResponse {
        flow_id,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        expires_in: data.expires_in,
        interval: data.interval,
        message: data
            .message
            .unwrap_or_else(|| "Sign in with the code shown.".to_string()),
    })
}

/// Poll a device-code flow until the user completes sign-in, it is cancelled, or
/// it expires. Blocks server-side (polling the token endpoint at the provider's
/// interval) so the frontend only awaits once.
#[tauri::command]
pub async fn oauth_poll_device_code(flow_id: String) -> Result<OAuthTokenResponse> {
    // Snapshot the flow parameters (do not hold the lock across awaits).
    let (token_url, client_id, device_code, mut interval) = {
        let flows = DEVICE_FLOWS
            .lock()
            .map_err(|e| LeviathanError::OAuth(format!("Failed to access device flow: {}", e)))?;
        let flow = flows.get(&flow_id).ok_or_else(|| {
            LeviathanError::OAuth("Device sign-in flow not found or already finished".to_string())
        })?;
        let token_url = match flow.provider {
            OAuthProvider::Azure => {
                format!("{}/token", azure_tenant_base(flow.instance_url.as_deref()))
            }
            _ => {
                return Err(LeviathanError::OAuth(
                    "Device-code flow is not supported for this provider".to_string(),
                ))
            }
        };
        (
            token_url,
            flow.client_id.clone(),
            flow.device_code.clone(),
            flow.interval,
        )
    };

    let client = reqwest::Client::new();

    loop {
        // Bail if the flow was cancelled (removed) or has expired.
        {
            let mut flows = DEVICE_FLOWS.lock().map_err(|e| {
                LeviathanError::OAuth(format!("Failed to access device flow: {}", e))
            })?;
            match flows.get(&flow_id) {
                None => {
                    return Err(LeviathanError::OAuth(
                        "Device sign-in was cancelled".to_string(),
                    ))
                }
                Some(f) if f.expires_at <= std::time::Instant::now() => {
                    // Remove the expired flow so its device_code secret doesn't
                    // linger until the next start's opportunistic cleanup.
                    flows.remove(&flow_id);
                    return Err(LeviathanError::OAuth(
                        "Device sign-in timed out — please try again".to_string(),
                    ));
                }
                _ => {}
            }
        }

        tokio::time::sleep(Duration::from_secs(interval.max(1))).await;

        // A transient transport error (wifi drop, sleep/resume, VPN reconnect)
        // must NOT abort a flow the user is still completing — retry on the next
        // tick (bounded by the expiry check at the top of the loop).
        let response = match client
            .post(&token_url)
            .header("Accept", "application/json")
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", client_id.as_str()),
                ("device_code", device_code.as_str()),
            ])
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::debug!("Device token poll transient error (will retry): {}", e);
                continue;
            }
        };

        let status = response.status();
        let text = response.text().await.unwrap_or_default();

        if status.is_success() {
            // This flow is terminal now — remove it BEFORE parsing so a 2xx body
            // that fails to deserialize doesn't leave the entry (and its
            // device_code secret) lingering in the map until expiry.
            DEVICE_FLOWS.lock().ok().map(|mut f| f.remove(&flow_id));
            let tokens: OAuthTokenResponse = serde_json::from_str(&text).map_err(|e| {
                LeviathanError::OAuth(format!("Failed to parse token response: {}", e))
            })?;
            return Ok(tokens);
        }

        // Non-success: inspect the OAuth error code to decide whether to keep polling.
        let error_code = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_default();

        match classify_device_poll_error(&error_code, status.as_u16()) {
            DevicePollAction::KeepWaiting => { /* authorization_pending */ }
            DevicePollAction::SlowDown => interval += 5,
            DevicePollAction::Fail(msg) => {
                DEVICE_FLOWS.lock().ok().map(|mut f| f.remove(&flow_id));
                return Err(LeviathanError::OAuth(msg));
            }
        }
    }
}

/// What the device-code poll loop should do for a given token-endpoint error.
#[derive(Debug, PartialEq)]
enum DevicePollAction {
    /// Authorization still pending — poll again on the next tick.
    KeepWaiting,
    /// Provider asked us to back off — increase the interval and poll again.
    SlowDown,
    /// Terminal failure — stop polling and surface this message.
    Fail(String),
}

/// Classify a device-code token-poll error (RFC 8628 §3.5) into a poll action.
/// Pure function so the state machine is unit-testable without an HTTP server.
fn classify_device_poll_error(error_code: &str, status: u16) -> DevicePollAction {
    match error_code {
        "authorization_pending" => DevicePollAction::KeepWaiting,
        "slow_down" => DevicePollAction::SlowDown,
        "authorization_declined" => DevicePollAction::Fail("Sign-in was declined".to_string()),
        "expired_token" => {
            DevicePollAction::Fail("Device sign-in timed out — please try again".to_string())
        }
        // No recognized OAuth error field. A 5xx is a transient server blip —
        // keep polling (same tolerance as a transport error) instead of aborting
        // a flow the user is still completing; a 4xx is a genuine terminal error.
        "" if status >= 500 => DevicePollAction::KeepWaiting,
        "" => DevicePollAction::Fail(format!("Token poll failed (HTTP {})", status)),
        other => DevicePollAction::Fail(other.to_string()),
    }
}

/// Cancel an in-flight device-code flow so its poll stops.
#[tauri::command]
pub async fn oauth_cancel_device_code(flow_id: String) -> Result<()> {
    if let Ok(mut flows) = DEVICE_FLOWS.lock() {
        flows.remove(&flow_id);
    }
    Ok(())
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
    async fn test_oauth_get_authorize_url_azure_rejected() {
        // Azure DevOps uses the device-code flow, not the redirect/authorize path,
        // so the authorize-url command must reject it (pointing at device-code).
        let result =
            oauth_get_authorize_url("azure".to_string(), None, "test-client-id".to_string()).await;

        assert!(result.is_err());
        let msg = format!("{:?}", result.unwrap_err());
        assert!(msg.contains("device-code"));
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
        // Use a redirect-flow provider (Azure uses device-code and has no authorize URL).
        let result1 =
            oauth_get_authorize_url("gitlab".to_string(), None, "test-client-id".to_string()).await;
        let result2 =
            oauth_get_authorize_url("gitlab".to_string(), None, "test-client-id".to_string()).await;

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
            client_id: "test-client-id".to_string(),
            redirect_uri: "http://127.0.0.1:8080/callback".to_string(),
            created_at: std::time::Instant::now(),
        }
    }

    #[test]
    fn test_pending_flow_stores_client_id() {
        // The pending flow must retain the client ID used to build the authorize
        // URL so the token exchange can reuse it for per-account providers (OIDC).
        let state = OAuthState::default();
        let mut flow = make_flow(OAuthProvider::Oidc, "oidc-verifier");
        flow.client_id = "oidc-account-client".to_string();
        flow.instance_url = Some("https://auth.example.com".to_string());
        state
            .insert_pending("oidc-state".to_string(), flow)
            .unwrap();

        let retrieved = state.take_pending("oidc-state").unwrap().unwrap();
        assert_eq!(retrieved.provider, OAuthProvider::Oidc);
        assert_eq!(retrieved.client_id, "oidc-account-client");
        assert_eq!(
            retrieved.instance_url,
            Some("https://auth.example.com".to_string())
        );
    }

    #[test]
    fn test_exchange_client_id_fallback_semantics() {
        // Mirrors the fallback used in oauth_exchange_code: an empty/whitespace
        // client ID from the frontend falls back to the one stored on the flow
        // (OIDC), while a non-empty value is preserved (built-in providers).
        let stored = "stored-oidc-client".to_string();

        let frontend_empty = String::new();
        let resolved = if frontend_empty.trim().is_empty() {
            stored.clone()
        } else {
            frontend_empty
        };
        assert_eq!(resolved, "stored-oidc-client");

        let frontend_whitespace = "   ".to_string();
        let resolved = if frontend_whitespace.trim().is_empty() {
            stored.clone()
        } else {
            frontend_whitespace
        };
        assert_eq!(resolved, "stored-oidc-client");

        let frontend_present = "github-embedded-client".to_string();
        let resolved = if frontend_present.trim().is_empty() {
            stored.clone()
        } else {
            frontend_present
        };
        assert_eq!(resolved, "github-embedded-client");
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

    // ==========================================================================
    // Device Code Flow Tests
    // ==========================================================================

    #[test]
    fn test_azure_tenant_base_default() {
        let base = azure_tenant_base(None);
        assert_eq!(base, "https://login.microsoftonline.com/common/oauth2/v2.0");
    }

    #[test]
    fn test_azure_tenant_base_specific() {
        let base = azure_tenant_base(Some("my-tenant"));
        assert_eq!(
            base,
            "https://login.microsoftonline.com/my-tenant/oauth2/v2.0"
        );
    }

    #[test]
    fn test_start_device_code_response_serializes_camel_case() {
        let response = StartDeviceCodeResponse {
            flow_id: "flow-1".to_string(),
            user_code: "ABCD-EFGH".to_string(),
            verification_uri: "https://microsoft.com/devicelogin".to_string(),
            expires_in: 900,
            interval: 5,
            message: "Enter the code".to_string(),
        };
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("flowId"));
        assert!(json.contains("userCode"));
        assert!(json.contains("verificationUri"));
        assert!(json.contains("expiresIn"));
    }

    #[tokio::test]
    async fn test_start_device_code_rejects_unsupported_provider() {
        // Only Azure supports device code; GitHub must be rejected before any network call.
        let result =
            oauth_start_device_code("github".to_string(), "client".to_string(), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_start_device_code_rejects_invalid_provider() {
        let result =
            oauth_start_device_code("nonsense".to_string(), "client".to_string(), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_poll_device_code_unknown_flow_errors() {
        // A flow id that was never started (or already consumed) must error, not hang.
        let result = oauth_poll_device_code("does-not-exist".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cancel_device_code_is_ok_for_missing_flow() {
        // Cancelling a non-existent flow is a no-op success (idempotent).
        assert!(oauth_cancel_device_code("no-such-flow".to_string())
            .await
            .is_ok());
    }

    #[test]
    fn test_classify_device_poll_pending_keeps_waiting() {
        assert_eq!(
            classify_device_poll_error("authorization_pending", 400),
            DevicePollAction::KeepWaiting
        );
    }

    #[test]
    fn test_classify_device_poll_slow_down() {
        assert_eq!(
            classify_device_poll_error("slow_down", 400),
            DevicePollAction::SlowDown
        );
    }

    #[test]
    fn test_classify_device_poll_declined_fails() {
        match classify_device_poll_error("authorization_declined", 400) {
            DevicePollAction::Fail(msg) => assert!(msg.contains("declined")),
            other => panic!("expected Fail, got {:?}", other),
        }
    }

    #[test]
    fn test_classify_device_poll_expired_fails() {
        match classify_device_poll_error("expired_token", 400) {
            DevicePollAction::Fail(msg) => assert!(msg.contains("timed out")),
            other => panic!("expected Fail, got {:?}", other),
        }
    }

    #[test]
    fn test_classify_device_poll_empty_error_4xx_terminates_with_status() {
        // A non-JSON / empty error body on a 4xx terminates, surfacing the status.
        match classify_device_poll_error("", 400) {
            DevicePollAction::Fail(msg) => assert!(msg.contains("400")),
            other => panic!("expected Fail, got {:?}", other),
        }
    }

    #[test]
    fn test_classify_device_poll_empty_error_5xx_retries() {
        // A transient 5xx blip must be retried, not treated as terminal.
        assert_eq!(
            classify_device_poll_error("", 503),
            DevicePollAction::KeepWaiting
        );
    }

    #[test]
    fn test_classify_device_poll_unknown_error_passed_through() {
        match classify_device_poll_error("invalid_grant", 400) {
            DevicePollAction::Fail(msg) => assert_eq!(msg, "invalid_grant"),
            other => panic!("expected Fail, got {:?}", other),
        }
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
