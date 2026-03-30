//! OAuth service for provider authentication
//!
//! This module provides OAuth 2.0 authentication with PKCE support
//! for GitHub, GitLab, Azure DevOps, and Bitbucket.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// PKCE challenge for OAuth 2.0 authorization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PKCEChallenge {
    /// The code verifier (random string, stored client-side)
    pub verifier: String,
    /// The code challenge (SHA256 hash of verifier, sent to auth server)
    pub challenge: String,
}

impl PKCEChallenge {
    /// Generate a new PKCE challenge
    pub fn new() -> Self {
        // Generate a random 43-128 character verifier (RFC 7636)
        let verifier: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(64)
            .map(char::from)
            .collect();

        // Generate challenge as base64url(SHA256(verifier))
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

        Self {
            verifier,
            challenge,
        }
    }
}

impl Default for PKCEChallenge {
    fn default() -> Self {
        Self::new()
    }
}

/// OAuth provider types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OAuthProvider {
    GitHub,
    GitLab,
    Azure,
    Bitbucket,
    Oidc,
}

impl std::fmt::Display for OAuthProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OAuthProvider::GitHub => write!(f, "github"),
            OAuthProvider::GitLab => write!(f, "gitlab"),
            OAuthProvider::Azure => write!(f, "azure"),
            OAuthProvider::Bitbucket => write!(f, "bitbucket"),
            OAuthProvider::Oidc => write!(f, "oidc"),
        }
    }
}

impl std::str::FromStr for OAuthProvider {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "github" => Ok(OAuthProvider::GitHub),
            "gitlab" => Ok(OAuthProvider::GitLab),
            "azure" => Ok(OAuthProvider::Azure),
            "bitbucket" => Ok(OAuthProvider::Bitbucket),
            "oidc" => Ok(OAuthProvider::Oidc),
            _ => Err(format!("Unknown OAuth provider: {}", s)),
        }
    }
}

/// OAuth provider configuration
#[derive(Debug, Clone)]
pub struct OAuthConfig {
    /// OAuth client ID
    pub client_id: String,
    /// Authorization endpoint URL
    pub authorize_url: String,
    /// Token endpoint URL
    pub token_url: String,
    /// Required scopes
    pub scopes: Vec<String>,
    /// Redirect URI for this provider
    pub redirect_uri: String,
}

impl OAuthConfig {
    /// Get GitHub OAuth configuration
    pub fn github(client_id: &str, redirect_port: u16) -> Self {
        Self {
            client_id: client_id.to_string(),
            authorize_url: "https://github.com/login/oauth/authorize".to_string(),
            token_url: "https://github.com/login/oauth/access_token".to_string(),
            scopes: vec!["repo".to_string(), "read:user".to_string()],
            redirect_uri: format!("http://127.0.0.1:{}/callback", redirect_port),
        }
    }

    /// Get GitLab OAuth configuration
    pub fn gitlab(client_id: &str, instance_url: Option<&str>, redirect_port: u16) -> Self {
        let base_url = instance_url.unwrap_or("https://gitlab.com");
        Self {
            client_id: client_id.to_string(),
            authorize_url: format!("{}/oauth/authorize", base_url),
            token_url: format!("{}/oauth/token", base_url),
            scopes: vec!["api".to_string(), "read_user".to_string()],
            redirect_uri: format!("http://127.0.0.1:{}/callback", redirect_port),
        }
    }

    /// Get Azure DevOps (Microsoft Entra ID) OAuth configuration
    /// Note: Only supports work/school accounts. Personal accounts must use PAT authentication.
    pub fn azure(client_id: &str, tenant_id: Option<&str>) -> Self {
        let tenant = tenant_id.unwrap_or("common");
        Self {
            client_id: client_id.to_string(),
            authorize_url: format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize",
                tenant
            ),
            token_url: format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
                tenant
            ),
            scopes: vec![
                "499b84ac-1321-427f-aa17-267ca6975798/user_impersonation".to_string(),
                "offline_access".to_string(),
            ],
            redirect_uri: "leviathan://oauth/azure/callback".to_string(),
        }
    }

    /// Get Bitbucket OAuth configuration
    /// Bitbucket requires http/https redirect URIs, so we use the loopback server
    pub fn bitbucket(client_id: &str, redirect_port: u16) -> Self {
        Self {
            client_id: client_id.to_string(),
            authorize_url: "https://bitbucket.org/site/oauth2/authorize".to_string(),
            token_url: "https://bitbucket.org/site/oauth2/access_token".to_string(),
            scopes: vec![
                "repository".to_string(),
                "pullrequest".to_string(),
                "account".to_string(),
            ],
            redirect_uri: format!("http://127.0.0.1:{}/callback", redirect_port),
        }
    }

    /// Get OIDC provider configuration from discovery or direct endpoints
    pub fn oidc(
        client_id: &str,
        authorize_url: &str,
        token_url: &str,
        scopes: Vec<String>,
        redirect_port: u16,
    ) -> Self {
        Self {
            client_id: client_id.to_string(),
            authorize_url: authorize_url.to_string(),
            token_url: token_url.to_string(),
            scopes,
            redirect_uri: format!("http://127.0.0.1:{}/callback", redirect_port),
        }
    }

    /// Build the authorization URL with PKCE challenge
    pub fn build_authorize_url(&self, pkce: &PKCEChallenge, state: &str) -> String {
        let scopes = self.scopes.join(" ");
        format!(
            "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
            self.authorize_url,
            urlencoding::encode(&self.client_id),
            urlencoding::encode(&self.redirect_uri),
            urlencoding::encode(&scopes),
            urlencoding::encode(state),
            urlencoding::encode(&pkce.challenge)
        )
    }
}

/// OAuth token response from provider
/// Note: Uses aliases to accept snake_case from providers but serialize to camelCase for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenResponse {
    #[serde(alias = "access_token")]
    pub access_token: String,
    #[serde(default, alias = "refresh_token")]
    pub refresh_token: Option<String>,
    #[serde(default, alias = "expires_in")]
    pub expires_in: Option<u64>,
    #[serde(default, alias = "token_type")]
    pub token_type: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default, alias = "id_token")]
    pub id_token: Option<String>,
}

/// OIDC provider discovery response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OidcDiscovery {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    #[serde(default)]
    pub jwks_uri: Option<String>,
    pub issuer: String,
    #[serde(default)]
    pub scopes_supported: Vec<String>,
}

/// User info extracted from an OIDC ID token
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OidcUserInfo {
    pub sub: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub preferred_username: Option<String>,
    pub picture: Option<String>,
}

/// Discover OIDC provider configuration from the well-known endpoint
pub async fn discover_oidc_config(issuer_url: &str) -> Result<OidcDiscovery, String> {
    let discovery_url = format!(
        "{}/.well-known/openid-configuration",
        issuer_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&discovery_url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch OIDC discovery: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "OIDC discovery failed (HTTP {})",
            response.status()
        ));
    }

    response
        .json::<OidcDiscovery>()
        .await
        .map_err(|e| format!("Failed to parse OIDC discovery: {}", e))
}

/// Decode an OIDC ID token JWT without signature verification.
/// Safe because the token was received directly from the provider over TLS.
pub fn decode_id_token(id_token: &str) -> Result<OidcUserInfo, String> {
    // Split JWT into parts and decode the payload (middle part)
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        return Err("Invalid JWT format".to_string());
    }

    // Decode base64url payload
    use base64::Engine;
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|e| format!("Failed to decode JWT payload: {}", e))?;

    let claims: serde_json::Value = serde_json::from_slice(&payload)
        .map_err(|e| format!("Failed to parse JWT claims: {}", e))?;

    Ok(OidcUserInfo {
        sub: claims["sub"].as_str().unwrap_or_default().to_string(),
        email: claims["email"].as_str().map(|s| s.to_string()),
        name: claims["name"].as_str().map(|s| s.to_string()),
        preferred_username: claims["preferred_username"].as_str().map(|s| s.to_string()),
        picture: claims["picture"].as_str().map(|s| s.to_string()),
    })
}

/// Response for authorization URL generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizeUrlResponse {
    /// The URL to open in the browser
    pub authorize_url: String,
    /// The PKCE verifier to store (needed for token exchange)
    pub verifier: String,
    /// State parameter for CSRF protection
    pub state: String,
}

/// Generate a random state parameter for CSRF protection
pub fn generate_state() -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // PKCE Tests
    // ==========================================================================

    #[test]
    fn test_pkce_generation() {
        let pkce = PKCEChallenge::new();
        assert_eq!(pkce.verifier.len(), 64);
        assert!(!pkce.challenge.is_empty());
        // Challenge should be base64url encoded SHA256 (43 characters)
        assert_eq!(pkce.challenge.len(), 43);
    }

    #[test]
    fn test_pkce_unique_generation() {
        let pkce1 = PKCEChallenge::new();
        let pkce2 = PKCEChallenge::new();

        // Each PKCE challenge should be unique
        assert_ne!(pkce1.verifier, pkce2.verifier);
        assert_ne!(pkce1.challenge, pkce2.challenge);
    }

    #[test]
    fn test_pkce_verifier_is_alphanumeric() {
        let pkce = PKCEChallenge::new();
        assert!(pkce.verifier.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_pkce_challenge_is_valid_base64url() {
        let pkce = PKCEChallenge::new();
        // Base64url characters: A-Z, a-z, 0-9, -, _
        assert!(pkce
            .challenge
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_pkce_default_implementation() {
        let pkce = PKCEChallenge::default();
        assert_eq!(pkce.verifier.len(), 64);
        assert_eq!(pkce.challenge.len(), 43);
    }

    // ==========================================================================
    // Provider Parsing Tests
    // ==========================================================================

    #[test]
    fn test_provider_parsing() {
        assert_eq!(
            "github".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::GitHub
        );
        assert_eq!(
            "GitLab".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::GitLab
        );
        assert_eq!(
            "AZURE".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::Azure
        );
        assert_eq!(
            "bitbucket".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::Bitbucket
        );
    }

    #[test]
    fn test_provider_parsing_case_insensitive() {
        assert_eq!(
            "GITHUB".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::GitHub
        );
        assert_eq!(
            "Github".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::GitHub
        );
        assert_eq!(
            "gitHUB".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::GitHub
        );
    }

    #[test]
    fn test_provider_parsing_invalid() {
        assert!("invalid".parse::<OAuthProvider>().is_err());
        assert!("".parse::<OAuthProvider>().is_err());
        assert!("git".parse::<OAuthProvider>().is_err());
    }

    #[test]
    fn test_provider_display() {
        assert_eq!(OAuthProvider::GitHub.to_string(), "github");
        assert_eq!(OAuthProvider::GitLab.to_string(), "gitlab");
        assert_eq!(OAuthProvider::Azure.to_string(), "azure");
        assert_eq!(OAuthProvider::Bitbucket.to_string(), "bitbucket");
    }

    // ==========================================================================
    // OAuth Config Tests
    // ==========================================================================

    #[test]
    fn test_github_config() {
        let config = OAuthConfig::github("test-client-id", 12345);

        assert_eq!(config.client_id, "test-client-id");
        assert_eq!(
            config.authorize_url,
            "https://github.com/login/oauth/authorize"
        );
        assert_eq!(
            config.token_url,
            "https://github.com/login/oauth/access_token"
        );
        assert_eq!(config.redirect_uri, "http://127.0.0.1:12345/callback");
        assert!(config.scopes.contains(&"repo".to_string()));
        assert!(config.scopes.contains(&"read:user".to_string()));
    }

    #[test]
    fn test_gitlab_config_default_instance() {
        let config = OAuthConfig::gitlab("test-client-id", None, 8080);

        assert_eq!(config.client_id, "test-client-id");
        assert_eq!(config.authorize_url, "https://gitlab.com/oauth/authorize");
        assert_eq!(config.token_url, "https://gitlab.com/oauth/token");
        assert_eq!(config.redirect_uri, "http://127.0.0.1:8080/callback");
        assert!(config.scopes.contains(&"api".to_string()));
    }

    #[test]
    fn test_gitlab_config_custom_instance() {
        let config =
            OAuthConfig::gitlab("test-client-id", Some("https://gitlab.example.com"), 9000);

        assert_eq!(
            config.authorize_url,
            "https://gitlab.example.com/oauth/authorize"
        );
        assert_eq!(config.token_url, "https://gitlab.example.com/oauth/token");
        assert_eq!(config.redirect_uri, "http://127.0.0.1:9000/callback");
    }

    #[test]
    fn test_azure_config_common_tenant() {
        let config = OAuthConfig::azure("test-client-id", None);

        assert!(config.authorize_url.contains("/common/"));
        assert!(config.token_url.contains("/common/"));
        assert_eq!(config.redirect_uri, "leviathan://oauth/azure/callback");
    }

    #[test]
    fn test_azure_config_specific_tenant() {
        let config = OAuthConfig::azure("test-client-id", Some("my-tenant"));

        assert!(config.authorize_url.contains("/my-tenant/"));
        assert!(config.token_url.contains("/my-tenant/"));
    }

    #[test]
    fn test_bitbucket_config() {
        // Bitbucket uses dedicated port 8085 to avoid conflicts
        let config = OAuthConfig::bitbucket("test-client-id", 8085);

        assert_eq!(config.client_id, "test-client-id");
        assert_eq!(
            config.authorize_url,
            "https://bitbucket.org/site/oauth2/authorize"
        );
        assert_eq!(
            config.token_url,
            "https://bitbucket.org/site/oauth2/access_token"
        );
        assert_eq!(config.redirect_uri, "http://127.0.0.1:8085/callback");
        assert!(config.scopes.contains(&"repository".to_string()));
        assert!(config.scopes.contains(&"pullrequest".to_string()));
    }

    // ==========================================================================
    // Authorization URL Building Tests
    // ==========================================================================

    #[test]
    fn test_authorize_url_building() {
        let config = OAuthConfig::gitlab("test-client-id", None, 8080);
        let pkce = PKCEChallenge::new();
        let url = config.build_authorize_url(&pkce, "test-state");

        assert!(url.starts_with("https://gitlab.com/oauth/authorize?"));
        assert!(url.contains("client_id=test-client-id"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn test_authorize_url_contains_state() {
        let config = OAuthConfig::github("client", 8080);
        let pkce = PKCEChallenge::new();
        let url = config.build_authorize_url(&pkce, "my-unique-state");

        assert!(url.contains("state=my-unique-state"));
    }

    #[test]
    fn test_authorize_url_contains_pkce_challenge() {
        let config = OAuthConfig::github("client", 8080);
        let pkce = PKCEChallenge::new();
        let url = config.build_authorize_url(&pkce, "state");

        assert!(url.contains(&format!("code_challenge={}", pkce.challenge)));
    }

    #[test]
    fn test_authorize_url_encodes_special_characters() {
        let config = OAuthConfig::gitlab("client-id-with-special-chars", None, 8080);
        let pkce = PKCEChallenge::new();
        let url = config.build_authorize_url(&pkce, "state with spaces");

        // Spaces should be encoded
        assert!(url.contains("state+with+spaces") || url.contains("state%20with%20spaces"));
    }

    #[test]
    fn test_azure_devops_authorize_url() {
        let config = OAuthConfig::azure("test-client-id", None);
        let pkce = PKCEChallenge::new();
        let url = config.build_authorize_url(&pkce, "test-state");

        assert!(url.starts_with("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"));
        assert!(url.contains("client_id=test-client-id"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge_method=S256"));
    }

    // ==========================================================================
    // State Generation Tests
    // ==========================================================================

    #[test]
    fn test_state_generation_length() {
        let state = generate_state();
        assert_eq!(state.len(), 32);
    }

    #[test]
    fn test_state_generation_unique() {
        let state1 = generate_state();
        let state2 = generate_state();
        assert_ne!(state1, state2);
    }

    #[test]
    fn test_state_is_alphanumeric() {
        let state = generate_state();
        assert!(state.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    // ==========================================================================
    // OAuth Token Response Tests
    // ==========================================================================

    #[test]
    fn test_token_response_deserialization() {
        let json = r#"{
            "access_token": "gho_test123",
            "token_type": "bearer",
            "scope": "repo,user"
        }"#;

        let response: OAuthTokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.access_token, "gho_test123");
        assert_eq!(response.token_type, Some("bearer".to_string()));
        assert_eq!(response.scope, Some("repo,user".to_string()));
        assert!(response.refresh_token.is_none());
        assert!(response.expires_in.is_none());
    }

    #[test]
    fn test_token_response_with_refresh_token() {
        let json = r#"{
            "access_token": "access",
            "refresh_token": "refresh",
            "expires_in": 3600
        }"#;

        let response: OAuthTokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.access_token, "access");
        assert_eq!(response.refresh_token, Some("refresh".to_string()));
        assert_eq!(response.expires_in, Some(3600));
    }

    #[test]
    fn test_token_response_minimal() {
        let json = r#"{"access_token": "token"}"#;

        let response: OAuthTokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.access_token, "token");
    }

    // ==========================================================================
    // OIDC Config Tests
    // ==========================================================================

    #[test]
    fn test_oidc_config() {
        let config = OAuthConfig::oidc(
            "oidc-client",
            "https://auth.example.com/authorize",
            "https://auth.example.com/token",
            vec!["openid".to_string(), "profile".to_string()],
            9090,
        );

        assert_eq!(config.client_id, "oidc-client");
        assert_eq!(config.authorize_url, "https://auth.example.com/authorize");
        assert_eq!(config.token_url, "https://auth.example.com/token");
        assert_eq!(config.redirect_uri, "http://127.0.0.1:9090/callback");
        assert_eq!(config.scopes, vec!["openid", "profile"]);
    }

    #[test]
    fn test_provider_parsing_oidc() {
        assert_eq!(
            "oidc".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::Oidc
        );
        assert_eq!(
            "OIDC".parse::<OAuthProvider>().unwrap(),
            OAuthProvider::Oidc
        );
    }

    #[test]
    fn test_provider_display_oidc() {
        assert_eq!(OAuthProvider::Oidc.to_string(), "oidc");
    }

    // ==========================================================================
    // decode_id_token Tests
    // ==========================================================================

    #[test]
    fn test_decode_id_token_valid() {
        // Build a valid JWT (header.payload.signature)
        use base64::Engine;
        let payload = serde_json::json!({
            "sub": "user-123",
            "email": "user@example.com",
            "name": "Test User",
            "preferred_username": "testuser",
            "picture": "https://example.com/avatar.png"
        });
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
        let header_b64 = URL_SAFE_NO_PAD.encode(b"{}");
        let token = format!("{}.{}.sig", header_b64, payload_b64);

        let result = decode_id_token(&token);
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.sub, "user-123");
        assert_eq!(info.email, Some("user@example.com".to_string()));
        assert_eq!(info.name, Some("Test User".to_string()));
        assert_eq!(info.preferred_username, Some("testuser".to_string()));
        assert_eq!(
            info.picture,
            Some("https://example.com/avatar.png".to_string())
        );
    }

    #[test]
    fn test_decode_id_token_minimal_claims() {
        use base64::Engine;
        let payload = serde_json::json!({ "sub": "min-user" });
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
        let header_b64 = URL_SAFE_NO_PAD.encode(b"{}");
        let token = format!("{}.{}.sig", header_b64, payload_b64);

        let info = decode_id_token(&token).unwrap();
        assert_eq!(info.sub, "min-user");
        assert!(info.email.is_none());
        assert!(info.name.is_none());
        assert!(info.preferred_username.is_none());
        assert!(info.picture.is_none());
    }

    #[test]
    fn test_decode_id_token_invalid_format_too_few_parts() {
        let result = decode_id_token("only.two");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid JWT format"));
    }

    #[test]
    fn test_decode_id_token_invalid_format_too_many_parts() {
        let result = decode_id_token("a.b.c.d");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid JWT format"));
    }

    #[test]
    fn test_decode_id_token_invalid_base64() {
        let result = decode_id_token("header.!!!invalid_base64!!!.sig");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to decode JWT payload"));
    }

    #[test]
    fn test_decode_id_token_invalid_json() {
        use base64::Engine;
        let payload_b64 = URL_SAFE_NO_PAD.encode(b"not valid json");
        let token = format!("hdr.{}.sig", payload_b64);

        let result = decode_id_token(&token);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to parse JWT claims"));
    }

    // ==========================================================================
    // OidcDiscovery Deserialization Tests
    // ==========================================================================

    #[test]
    fn test_oidc_discovery_deserialization() {
        let json = r#"{
            "authorizationEndpoint": "https://auth.example.com/authorize",
            "tokenEndpoint": "https://auth.example.com/token",
            "jwksUri": "https://auth.example.com/.well-known/jwks.json",
            "issuer": "https://auth.example.com",
            "scopesSupported": ["openid", "profile", "email"]
        }"#;

        let discovery: OidcDiscovery = serde_json::from_str(json).unwrap();
        assert_eq!(
            discovery.authorization_endpoint,
            "https://auth.example.com/authorize"
        );
        assert_eq!(discovery.token_endpoint, "https://auth.example.com/token");
        assert_eq!(discovery.issuer, "https://auth.example.com");
        assert!(discovery.jwks_uri.is_some());
        assert_eq!(discovery.scopes_supported.len(), 3);
    }

    #[test]
    fn test_oidc_discovery_minimal() {
        let json = r#"{
            "authorizationEndpoint": "https://auth.example.com/authorize",
            "tokenEndpoint": "https://auth.example.com/token",
            "issuer": "https://auth.example.com"
        }"#;

        let discovery: OidcDiscovery = serde_json::from_str(json).unwrap();
        assert!(discovery.jwks_uri.is_none());
        assert!(discovery.scopes_supported.is_empty());
    }

    // ==========================================================================
    // OAuthTokenResponse Snake Case Alias Tests
    // ==========================================================================

    #[test]
    fn test_token_response_snake_case_aliases() {
        // Providers return snake_case keys; serde aliases should accept them
        let json = r#"{
            "access_token": "abc123",
            "refresh_token": "ref456",
            "expires_in": 7200,
            "token_type": "Bearer",
            "id_token": "jwt.payload.sig"
        }"#;

        let response: OAuthTokenResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.access_token, "abc123");
        assert_eq!(response.refresh_token, Some("ref456".to_string()));
        assert_eq!(response.expires_in, Some(7200));
        assert_eq!(response.token_type, Some("Bearer".to_string()));
        assert_eq!(response.id_token, Some("jwt.payload.sig".to_string()));
    }

    #[test]
    fn test_token_response_serializes_to_camel_case() {
        let response = OAuthTokenResponse {
            access_token: "tok".to_string(),
            refresh_token: Some("ref".to_string()),
            expires_in: Some(3600),
            token_type: Some("bearer".to_string()),
            scope: None,
            id_token: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("accessToken"));
        assert!(json.contains("refreshToken"));
        assert!(json.contains("expiresIn"));
        assert!(json.contains("tokenType"));
    }

    // ==========================================================================
    // PKCE Deterministic Verification Test
    // ==========================================================================

    #[test]
    fn test_pkce_challenge_matches_verifier() {
        let pkce = PKCEChallenge::new();

        // Recompute the challenge from the verifier to verify correctness
        let mut hasher = Sha256::new();
        hasher.update(pkce.verifier.as_bytes());
        let expected_challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

        assert_eq!(pkce.challenge, expected_challenge);
    }
}
