//! Git credentials service
//!
//! Provides credential management for git operations using macOS Keychain
//! via the `security` CLI tool (avoids permission prompts that the keyring crate triggers).

use git2::{Cred, CredentialType, RemoteCallbacks};
use keyring::Entry;
use std::collections::HashMap;
use std::sync::Mutex;

/// Service name for keychain storage
const SERVICE_NAME: &str = "leviathan-git";

/// In-memory credential cache (host -> (username, password))
/// Used as a fast lookup before hitting keychain
static CREDENTIAL_CACHE: Mutex<Option<HashMap<String, (String, String)>>> = Mutex::new(None);

/// Get credentials from the in-memory cache
fn get_cached_credentials(host: &str) -> Option<(String, String)> {
    let cache = CREDENTIAL_CACHE.lock().ok()?;
    cache.as_ref()?.get(host).cloned()
}

/// Store credentials in the in-memory cache
fn cache_credentials(host: &str, username: &str, password: &str) {
    if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(
            host.to_string(),
            (username.to_string(), password.to_string()),
        );
    }
}

/// Get a password from the keyring
fn keyring_get(service: &str, account: &str) -> Option<String> {
    let entry = Entry::new(service, account).ok()?;
    entry.get_password().ok()
}

/// Store a password in the keyring
fn keyring_set(service: &str, account: &str, password: &str) -> bool {
    let entry = match Entry::new(service, account) {
        Ok(e) => e,
        Err(_) => return false,
    };

    entry.set_password(password).is_ok()
}

/// Delete a password from the keyring
fn keyring_delete(service: &str, account: &str) -> bool {
    let entry = match Entry::new(service, account) {
        Ok(e) => e,
        Err(_) => return false,
    };

    entry.delete_credential().is_ok()
}

/// Credentials helper that provides git2 remote callbacks with authentication support
pub struct CredentialsHelper {
    /// Whether to try SSH agent
    try_ssh_agent: bool,
    /// Whether to try SSH key from default locations
    try_ssh_key: bool,
    /// Specific token to use for authentication (bypasses keychain)
    token: Option<String>,
}

impl Default for CredentialsHelper {
    fn default() -> Self {
        Self {
            try_ssh_agent: true,
            try_ssh_key: true,
            token: None,
        }
    }
}

impl CredentialsHelper {
    /// Create new credentials helper
    pub fn new() -> Self {
        Self::default()
    }

    /// Create new credentials helper with a specific token
    pub fn new_with_token(token: Option<String>) -> Self {
        Self {
            token,
            ..Self::default()
        }
    }

    /// Get remote callbacks configured with credential support
    pub fn get_callbacks(&self) -> RemoteCallbacks<'static> {
        let try_ssh_agent = self.try_ssh_agent;
        let try_ssh_key = self.try_ssh_key;
        let token = self.token.clone();
        let mut tried_ssh_agent = false;
        let mut tried_ssh_key = false;
        let mut tried_keyring = false;
        let mut tried_token = false;

        let mut callbacks = RemoteCallbacks::new();

        callbacks.credentials(move |url, username_from_url, allowed_types| {
            tracing::debug!(
                "Credential callback: url={}, username={:?}, allowed={:?}",
                url,
                username_from_url,
                allowed_types
            );

            // Try provided token first for HTTPS
            if let Some(ref token_value) = token {
                if allowed_types.contains(CredentialType::USER_PASS_PLAINTEXT) && !tried_token {
                    tried_token = true;
                    tracing::debug!("Using provided token for authentication");
                    let username = username_from_url.unwrap_or("git");
                    return Cred::userpass_plaintext(username, token_value);
                }
            }

            // Try SSH agent first for SSH URLs
            if allowed_types.contains(CredentialType::SSH_KEY) && try_ssh_agent && !tried_ssh_agent
            {
                tried_ssh_agent = true;
                let username = username_from_url.unwrap_or("git");
                tracing::debug!("Trying SSH agent for user: {}", username);
                if let Ok(cred) = Cred::ssh_key_from_agent(username) {
                    return Ok(cred);
                }
            }

            // Try SSH key from default location
            if allowed_types.contains(CredentialType::SSH_KEY) && try_ssh_key && !tried_ssh_key {
                tried_ssh_key = true;
                let username = username_from_url.unwrap_or("git");

                // Try common SSH key locations
                if let Some(home) = dirs::home_dir() {
                    for key_name in &["id_ed25519", "id_rsa", "id_ecdsa"] {
                        let private_key = home.join(".ssh").join(key_name);
                        let public_key = home.join(".ssh").join(format!("{}.pub", key_name));

                        if private_key.exists() {
                            tracing::debug!("Trying SSH key: {:?}", private_key);
                            if let Ok(cred) =
                                Cred::ssh_key(username, Some(&public_key), &private_key, None)
                            {
                                return Ok(cred);
                            }
                        }
                    }
                }
            }

            // Try stored credentials from keyring for HTTPS
            if allowed_types.contains(CredentialType::USER_PASS_PLAINTEXT) && !tried_keyring {
                tried_keyring = true;

                if let Some((username, password)) = get_stored_credentials(url) {
                    tracing::debug!("Using stored credentials for: {}", url);
                    return Cred::userpass_plaintext(&username, &password);
                }
            }

            // Try default credentials (for public repos or pre-configured git)
            if allowed_types.contains(CredentialType::DEFAULT) {
                tracing::debug!("Trying default credentials");
                return Cred::default();
            }

            Err(git2::Error::from_str(
                "No valid credentials found. For private repositories, configure SSH keys or store credentials.",
            ))
        });

        callbacks
    }
}

/// Get stored credentials - checks memory cache first, then keychain
fn get_stored_credentials(url: &str) -> Option<(String, String)> {
    let host = extract_host(url)?;
    tracing::debug!("Looking up credentials for host: {}", host);

    // Check memory cache first (fast path)
    if let Some(creds) = get_cached_credentials(&host) {
        tracing::debug!(
            "Found credentials in cache for host: {} (username len: {}, password len: {})",
            host,
            creds.0.len(),
            creds.1.len()
        );
        return Some(creds);
    }

    // Try keyring
    let username_key = format!("{}_username", host);
    let password_key = format!("{}_password", host);

    let username = keyring_get(SERVICE_NAME, &username_key)?;
    let password = keyring_get(SERVICE_NAME, &password_key)?;

    // Cache for faster future lookups
    cache_credentials(&host, &username, &password);

    tracing::debug!(
        "Found credentials in keyring for host: {} (username len: {}, password len: {})",
        host,
        username.len(),
        password.len()
    );
    Some((username, password))
}

/// Store credentials in memory cache and keychain
pub fn store_credentials(url: &str, username: &str, password: &str) -> Result<(), String> {
    let host = extract_host(url).ok_or("Invalid URL")?;
    tracing::debug!(
        "Storing credentials for host: {} (username len: {}, password len: {})",
        host,
        username.len(),
        password.len()
    );

    // Store in memory cache
    cache_credentials(&host, username, password);

    // Store in keyring
    let username_key = format!("{}_username", host);
    let password_key = format!("{}_password", host);

    let username_ok = keyring_set(SERVICE_NAME, &username_key, username);
    let password_ok = keyring_set(SERVICE_NAME, &password_key, password);

    if username_ok && password_ok {
        tracing::info!("Stored credentials in keyring for host: {}", host);
    } else {
        tracing::warn!(
            "Failed to store credentials in keyring for host: {} (cached in memory only)",
            host
        );
    }

    Ok(())
}

/// Delete stored credentials from memory cache and keychain
pub fn delete_credentials(url: &str) -> Result<(), String> {
    let host = extract_host(url).ok_or("Invalid URL")?;

    // Remove from memory cache
    if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
        if let Some(map) = cache.as_mut() {
            map.remove(&host);
        }
    }

    // Remove from keyring
    let username_key = format!("{}_username", host);
    let password_key = format!("{}_password", host);
    keyring_delete(SERVICE_NAME, &username_key);
    keyring_delete(SERVICE_NAME, &password_key);

    tracing::debug!("Deleted credentials for host: {}", host);
    Ok(())
}

/// Extract host from a git URL
fn extract_host(url: &str) -> Option<String> {
    // Handle SSH URLs like git@github.com:user/repo.git
    if url.contains('@') && url.contains(':') && !url.contains("://") {
        let parts: Vec<&str> = url.split('@').collect();
        if parts.len() >= 2 {
            let host_part: Vec<&str> = parts[1].split(':').collect();
            return Some(host_part[0].to_string());
        }
    }

    // Handle HTTPS URLs
    if let Ok(parsed) = url::Url::parse(url) {
        return parsed.host_str().map(|s| s.to_string());
    }

    None
}

/// Get fetch options with credential and progress callbacks
pub fn get_fetch_options<'a>(token: Option<String>) -> git2::FetchOptions<'a> {
    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(get_callbacks_with_progress(token));
    fetch_opts
}

/// Get push options with credential and progress callbacks
pub fn get_push_options<'a>(token: Option<String>) -> git2::PushOptions<'a> {
    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(get_callbacks_with_progress(token));
    push_opts
}

/// Get remote callbacks with both credential and progress support
fn get_callbacks_with_progress<'a>(token: Option<String>) -> RemoteCallbacks<'a> {
    let mut callbacks = CredentialsHelper::new_with_token(token).get_callbacks();

    // Add transfer progress callback
    callbacks.transfer_progress(|stats| {
        let received = stats.received_objects();
        let total = stats.total_objects();
        let bytes = stats.received_bytes();

        if total > 0 {
            let percent = (received as f64 / total as f64) * 100.0;
            tracing::debug!(
                "Transfer progress: {}/{} objects ({:.1}%), {} bytes",
                received,
                total,
                percent,
                bytes
            );
        }

        true // Continue the transfer
    });

    // Add sideband progress callback (for server messages)
    callbacks.sideband_progress(|data| {
        if let Ok(msg) = std::str::from_utf8(data) {
            let msg = msg.trim();
            if !msg.is_empty() {
                tracing::info!("Remote: {}", msg);
            }
        }
        true
    });

    // Add push transfer progress callback
    callbacks.push_transfer_progress(|current, total, bytes| {
        if total > 0 {
            let percent = (current as f64 / total as f64) * 100.0;
            tracing::debug!(
                "Push progress: {}/{} objects ({:.1}%), {} bytes",
                current,
                total,
                percent,
                bytes
            );
        }
    });

    callbacks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_host_ssh() {
        assert_eq!(
            extract_host("git@github.com:user/repo.git"),
            Some("github.com".to_string())
        );
    }

    #[test]
    fn test_extract_host_https() {
        assert_eq!(
            extract_host("https://github.com/user/repo.git"),
            Some("github.com".to_string())
        );
    }
}
