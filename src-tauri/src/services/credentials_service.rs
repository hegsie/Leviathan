//! Git credentials service
//!
//! Provides credential management for git operations using the system keyring
//! for secure storage.

use base64::Engine;
use git2::{Cred, CredentialType, RemoteCallbacks};

/// Service name for keyring storage
const SERVICE_NAME: &str = "leviathan-git";

/// Credentials helper that provides git2 remote callbacks with authentication support
pub struct CredentialsHelper {
    /// Whether to try SSH agent
    try_ssh_agent: bool,
    /// Whether to try SSH key from default locations
    try_ssh_key: bool,
}

impl Default for CredentialsHelper {
    fn default() -> Self {
        Self {
            try_ssh_agent: true,
            try_ssh_key: true,
        }
    }
}

impl CredentialsHelper {
    /// Create new credentials helper
    pub fn new() -> Self {
        Self::default()
    }

    /// Get remote callbacks configured with credential support
    pub fn get_callbacks(&self) -> RemoteCallbacks<'static> {
        let try_ssh_agent = self.try_ssh_agent;
        let try_ssh_key = self.try_ssh_key;
        let mut tried_ssh_agent = false;
        let mut tried_ssh_key = false;
        let mut tried_keyring = false;

        let mut callbacks = RemoteCallbacks::new();

        callbacks.credentials(move |url, username_from_url, allowed_types| {
            tracing::debug!(
                "Credential callback: url={}, username={:?}, allowed={:?}",
                url,
                username_from_url,
                allowed_types
            );

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

                // First, check if this is an Azure DevOps URL and try the stored ADO token
                if let Some(token) = get_ado_token_for_git(url) {
                    tracing::debug!("Using stored Azure DevOps PAT for: {}", url);
                    // Azure DevOps accepts any username with PAT as password
                    return Cred::userpass_plaintext("", &token);
                }

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

/// Check if URL is an Azure DevOps URL and get the stored ADO token
fn get_ado_token_for_git(url: &str) -> Option<String> {
    // Check if this is an Azure DevOps URL
    if !url.contains("dev.azure.com") && !url.contains("visualstudio.com") {
        return None;
    }

    // Try to read the ADO token from the stored file
    let data_dir = dirs::data_local_dir()?;
    let token_path = data_dir.join("leviathan").join("ado_token.dat");

    if !token_path.exists() {
        tracing::debug!("ADO token file not found at {:?}", token_path);
        return None;
    }

    let obfuscated = std::fs::read_to_string(&token_path).ok()?;

    // Deobfuscate the token (same logic as in azure_devops.rs)
    let key: u8 = 0x5A;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&obfuscated)
        .ok()?;
    let original: Vec<u8> = decoded.iter().map(|b| b ^ key).collect();
    let token = String::from_utf8(original).ok()?;

    tracing::debug!("Found ADO token for git operations (length: {})", token.len());
    Some(token)
}

/// Get stored credentials from the system keyring
fn get_stored_credentials(url: &str) -> Option<(String, String)> {
    // Parse URL to get host for keyring lookup
    let host = extract_host(url)?;

    // Try to get username from keyring
    let username_entry = keyring::Entry::new(SERVICE_NAME, &format!("{}_username", host)).ok()?;
    let username = username_entry.get_password().ok()?;

    // Try to get password from keyring
    let password_entry = keyring::Entry::new(SERVICE_NAME, &format!("{}_password", host)).ok()?;
    let password = password_entry.get_password().ok()?;

    Some((username, password))
}

/// Store credentials in the system keyring
pub fn store_credentials(url: &str, username: &str, password: &str) -> Result<(), String> {
    let host = extract_host(url).ok_or("Invalid URL")?;

    let username_entry = keyring::Entry::new(SERVICE_NAME, &format!("{}_username", host))
        .map_err(|e| e.to_string())?;
    username_entry
        .set_password(username)
        .map_err(|e| e.to_string())?;

    let password_entry = keyring::Entry::new(SERVICE_NAME, &format!("{}_password", host))
        .map_err(|e| e.to_string())?;
    password_entry
        .set_password(password)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Delete stored credentials from the system keyring
pub fn delete_credentials(url: &str) -> Result<(), String> {
    let host = extract_host(url).ok_or("Invalid URL")?;

    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, &format!("{}_username", host)) {
        let _ = entry.delete_credential();
    }

    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, &format!("{}_password", host)) {
        let _ = entry.delete_credential();
    }

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
pub fn get_fetch_options<'a>() -> git2::FetchOptions<'a> {
    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(get_callbacks_with_progress());
    fetch_opts
}

/// Get push options with credential and progress callbacks
pub fn get_push_options<'a>() -> git2::PushOptions<'a> {
    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(get_callbacks_with_progress());
    push_opts
}

/// Get remote callbacks with both credential and progress support
fn get_callbacks_with_progress<'a>() -> RemoteCallbacks<'a> {
    let mut callbacks = CredentialsHelper::new().get_callbacks();

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
