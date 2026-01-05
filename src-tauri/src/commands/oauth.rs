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

/// Global storage for pending loopback servers (GitHub OAuth)
static PENDING_SERVERS: std::sync::LazyLock<Mutex<HashMap<u16, LoopbackServer>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// State for pending OAuth flows
pub struct OAuthState {
    /// Map of state -> (provider, verifier, instance_url)
    #[allow(dead_code)]
    pending: Mutex<HashMap<String, (OAuthProvider, String, Option<String>)>>,
}

impl Default for OAuthState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }
}

/// Response from starting an OAuth flow
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOAuthResponse {
    /// The URL to open in the browser
    pub authorize_url: String,
    /// The PKCE verifier (store client-side for token exchange)
    pub verifier: String,
    /// State for CSRF protection
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

            // Store the server for later retrieval by oauth_wait_for_github_callback
            PENDING_SERVERS
                .lock()
                .map_err(|e| LeviathanError::OAuth(format!("Failed to store server: {}", e)))?
                .insert(port, server);

            (config, Some(port))
        }
        OAuthProvider::GitLab => {
            // GitLab uses loopback server (like GitHub)
            let server = LoopbackServer::new()?;
            let port = server.port();
            let config = OAuthConfig::gitlab(&client_id, instance_url.as_deref(), port);

            // Store the server for later retrieval
            PENDING_SERVERS
                .lock()
                .map_err(|e| LeviathanError::OAuth(format!("Failed to store server: {}", e)))?
                .insert(port, server);

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

            // Store the server for later retrieval
            PENDING_SERVERS
                .lock()
                .map_err(|e| LeviathanError::OAuth(format!("Failed to store server: {}", e)))?
                .insert(port, server);

            (config, Some(port))
        }
    };

    let authorize_url = config.build_authorize_url(&pkce, &state);

    Ok(StartOAuthResponse {
        authorize_url,
        verifier: pkce.verifier,
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
pub async fn oauth_start_github_flow(
    client_id: String,
) -> Result<StartOAuthResponse> {
    oauth_get_authorize_url("github".to_string(), None, client_id).await
}

/// Exchange authorization code for tokens
#[tauri::command]
pub async fn oauth_exchange_code(
    provider: String,
    code: String,
    verifier: String,
    redirect_uri: String,
    client_id: String,
    client_secret: Option<String>,
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
        return Err(LeviathanError::OAuth(format!(
            "Token request failed with status {}: {}",
            status, text
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

    // Try to parse as token response
    tracing::info!("Token exchange raw response: {}", text);
    let tokens: OAuthTokenResponse = serde_json::from_str(&text)
        .map_err(|e| LeviathanError::OAuth(format!("Failed to parse token response: {}. Raw response: {}", e, text)))?;

    tracing::info!("Parsed token - has access_token: {}", !tokens.access_token.is_empty());
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
        let text = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OAuth(format!(
            "Refresh request failed with status {}: {}",
            status, text
        )));
    }

    let tokens: OAuthTokenResponse = response
        .json()
        .await
        .map_err(|e| LeviathanError::OAuth(format!("Failed to parse token response: {}", e)))?;

    Ok(tokens)
}

/// Wait for loopback callback (works for GitHub, GitLab, and any provider using loopback)
///
/// This should be called after opening the authorize URL.
/// It will wait for the callback on the loopback server and return the authorization code.
#[tauri::command]
pub async fn oauth_wait_for_callback(
    port: u16,
) -> Result<String> {
    // Retrieve the stored server for this port
    let server = PENDING_SERVERS
        .lock()
        .map_err(|e| LeviathanError::OAuth(format!("Failed to access server storage: {}", e)))?
        .remove(&port)
        .ok_or_else(|| LeviathanError::OAuth(format!("No server found for port {}", port)))?;

    // Use the server's wait_for_callback method
    // This runs in a blocking thread to avoid blocking the async runtime
    let timeout = Duration::from_secs(300); // 5 minutes

    tokio::task::spawn_blocking(move || {
        server.wait_for_callback(timeout)
    })
    .await
    .map_err(|e| LeviathanError::OAuth(format!("Task join error: {}", e)))?
}

/// Alias for backward compatibility
#[tauri::command]
pub async fn oauth_wait_for_github_callback(port: u16) -> Result<String> {
    oauth_wait_for_callback(port).await
}
