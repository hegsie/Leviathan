//! Git credentials service
//!
//! Provides credential management for git operations using macOS Keychain
//! via the `security` CLI tool (avoids permission prompts that the keyring crate triggers).

use git2::{Cred, CredentialType, RemoteCallbacks};
#[cfg(not(target_os = "macos"))]
use keyring::Entry;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// Service name for keychain storage
const SERVICE_NAME: &str = "leviathan-git";

/// Time-to-live for cached credentials (30 minutes).
/// Expired entries are lazily removed on the next cache read.
const CREDENTIAL_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30 * 60);

/// A cached credential entry with an insertion timestamp for TTL enforcement.
#[derive(Clone)]
struct CachedCredential {
    username: String,
    password: String,
    cached_at: Instant,
}

/// In-memory credential cache (host -> credential + timestamp).
/// Used as a fast lookup before hitting keychain.
static CREDENTIAL_CACHE: Mutex<Option<HashMap<String, CachedCredential>>> = Mutex::new(None);

/// Remove all expired entries from the credential cache.
fn cleanup_expired_credentials(map: &mut HashMap<String, CachedCredential>) {
    let now = Instant::now();
    map.retain(|host, entry| {
        let alive = now.duration_since(entry.cached_at) < CREDENTIAL_CACHE_TTL;
        if !alive {
            tracing::debug!("Credential cache entry expired for host: {}", host);
        }
        alive
    });
}

/// Get credentials from the in-memory cache.
/// Performs lazy cleanup of expired entries before lookup.
fn get_cached_credentials(host: &str) -> Option<(String, String)> {
    let mut cache = CREDENTIAL_CACHE.lock().ok()?;
    let map = cache.as_mut()?;
    cleanup_expired_credentials(map);
    map.get(host)
        .map(|entry| (entry.username.clone(), entry.password.clone()))
}

/// Store credentials in the in-memory cache
fn cache_credentials(host: &str, username: &str, password: &str) {
    if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(
            host.to_string(),
            CachedCredential {
                username: username.to_string(),
                password: password.to_string(),
                cached_at: Instant::now(),
            },
        );
    }
}

/// Get a password from the keyring
fn keyring_get(service: &str, account: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("security")
            .args(["find-generic-password", "-s", service, "-a", account, "-w"])
            .output()
            .ok()?;
        if output.status.success() {
            let pw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if pw.is_empty() {
                None
            } else {
                Some(pw)
            }
        } else {
            None
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = Entry::new(service, account).ok()?;
        entry.get_password().ok()
    }
}

/// Store a password in the keyring.
/// On macOS uses the `security` CLI with `-A` to allow any application to access
/// the item without triggering authorization prompts.
fn keyring_set(service: &str, account: &str, password: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        // Delete existing entry first
        let _ = std::process::Command::new("security")
            .args(["delete-generic-password", "-s", service, "-a", account])
            .output();
        std::process::Command::new("security")
            .args([
                "add-generic-password",
                "-s",
                service,
                "-a",
                account,
                "-w",
                password,
                "-A", // Allow any application to access without prompt
                "-U",
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = match Entry::new(service, account) {
            Ok(e) => e,
            Err(_) => return false,
        };
        entry.set_password(password).is_ok()
    }
}

/// Delete a password from the keyring
fn keyring_delete(service: &str, account: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("security")
            .args(["delete-generic-password", "-s", service, "-a", account])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = match Entry::new(service, account) {
            Ok(e) => e,
            Err(_) => return false,
        };
        entry.delete_credential().is_ok()
    }
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

            // Skip Cred::default() — it invokes the system git credential helper
            // (osxkeychain on macOS) which triggers Keychain authorization dialogs.
            // Our stored credentials and SSH keys above are sufficient.

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

    /// Clear the global credential cache between tests to avoid cross-contamination.
    fn clear_cache() {
        if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
            *cache = None;
        }
    }

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

    #[test]
    fn test_cache_credentials_stores_and_retrieves() {
        clear_cache();
        cache_credentials("example.com", "user", "pass");
        let creds = get_cached_credentials("example.com");
        assert_eq!(creds, Some(("user".to_string(), "pass".to_string())));
    }

    #[test]
    fn test_cache_credentials_returns_none_for_missing_host() {
        clear_cache();
        cache_credentials("a.com", "u", "p");
        assert!(get_cached_credentials("b.com").is_none());
    }

    #[test]
    fn test_cleanup_expired_credentials_removes_old_entries() {
        let mut map = HashMap::new();
        // Insert an entry that is already past TTL
        map.insert(
            "old.example.com".to_string(),
            CachedCredential {
                username: "user".to_string(),
                password: "pass".to_string(),
                cached_at: Instant::now() - CREDENTIAL_CACHE_TTL - std::time::Duration::from_secs(1),
            },
        );
        // Insert a fresh entry
        map.insert(
            "fresh.example.com".to_string(),
            CachedCredential {
                username: "user2".to_string(),
                password: "pass2".to_string(),
                cached_at: Instant::now(),
            },
        );

        cleanup_expired_credentials(&mut map);

        assert!(!map.contains_key("old.example.com"), "expired entry should be removed");
        assert!(map.contains_key("fresh.example.com"), "fresh entry should remain");
    }

    #[test]
    fn test_get_cached_credentials_skips_expired() {
        clear_cache();
        // Manually insert an expired entry
        if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
            let map = cache.get_or_insert_with(HashMap::new);
            map.insert(
                "expired.example.com".to_string(),
                CachedCredential {
                    username: "user".to_string(),
                    password: "pass".to_string(),
                    cached_at: Instant::now() - CREDENTIAL_CACHE_TTL - std::time::Duration::from_secs(1),
                },
            );
        }

        // Should return None because the entry has expired
        assert!(get_cached_credentials("expired.example.com").is_none());

        // The entry should have been cleaned up
        if let Ok(cache) = CREDENTIAL_CACHE.lock() {
            let map = cache.as_ref().unwrap();
            assert!(!map.contains_key("expired.example.com"));
        }
    }

    #[test]
    fn test_cleanup_preserves_fresh_entries() {
        let mut map = HashMap::new();
        map.insert(
            "host.com".to_string(),
            CachedCredential {
                username: "u".to_string(),
                password: "p".to_string(),
                cached_at: Instant::now(),
            },
        );

        cleanup_expired_credentials(&mut map);
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn test_cleanup_empty_map() {
        let mut map: HashMap<String, CachedCredential> = HashMap::new();
        cleanup_expired_credentials(&mut map);
        assert!(map.is_empty());
    }
}
