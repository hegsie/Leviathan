//! Credential management command handlers
//! Manage git credential helpers and stored credentials

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

/// Credential helper configuration
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialHelper {
    /// Helper name (e.g., "osxkeychain", "manager-core", "store")
    pub name: String,
    /// Full helper command
    pub command: String,
    /// Scope (global, local, or url-specific)
    pub scope: String,
    /// URL pattern if url-specific
    pub url_pattern: Option<String>,
}

/// Credential test result
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialTestResult {
    /// Whether credentials are configured and working
    pub success: bool,
    /// The host that was tested
    pub host: String,
    /// Protocol used (https or ssh)
    pub protocol: String,
    /// Username if available
    pub username: Option<String>,
    /// Message describing the result
    pub message: String,
}

/// Available credential helper
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableHelper {
    /// Helper name
    pub name: String,
    /// Description
    pub description: String,
    /// Whether it's available on this system
    pub available: bool,
}

/// Run git config command
fn run_git_config(repo_path: Option<&Path>, args: &[&str]) -> Result<String> {
    let mut cmd = create_command("git");

    if let Some(path) = repo_path {
        cmd.current_dir(path);
    }

    cmd.arg("config");
    cmd.args(args);

    let output = cmd
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run git config: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(stdout)
    } else if output.status.code() == Some(1) && stderr.is_empty() && stdout.is_empty() {
        Ok(String::new())
    } else {
        Err(LeviathanError::OperationFailed(if stderr.is_empty() {
            stdout
        } else {
            stderr
        }))
    }
}

/// Get configured credential helpers
#[command]
pub async fn get_credential_helpers(path: String) -> Result<Vec<CredentialHelper>> {
    let repo_path = Path::new(&path);
    let mut helpers = Vec::new();

    // Get global credential helper
    if let Ok(helper) = run_git_config(None, &["--global", "--get", "credential.helper"]) {
        if !helper.is_empty() {
            helpers.push(CredentialHelper {
                name: extract_helper_name(&helper),
                command: helper,
                scope: "global".to_string(),
                url_pattern: None,
            });
        }
    }

    // Get local credential helper
    if let Ok(helper) = run_git_config(Some(repo_path), &["--local", "--get", "credential.helper"])
    {
        if !helper.is_empty() {
            helpers.push(CredentialHelper {
                name: extract_helper_name(&helper),
                command: helper,
                scope: "local".to_string(),
                url_pattern: None,
            });
        }
    }

    // Get URL-specific credential helpers
    if let Ok(config) = run_git_config(
        Some(repo_path),
        &["--get-regexp", "^credential\\..+\\.helper"],
    ) {
        for line in config.lines() {
            let parts: Vec<&str> = line.splitn(2, ' ').collect();
            if parts.len() == 2 {
                // Extract URL pattern from key (credential.https://github.com.helper)
                let key = parts[0];
                if let Some(url) = key
                    .strip_prefix("credential.")
                    .and_then(|s| s.strip_suffix(".helper"))
                {
                    helpers.push(CredentialHelper {
                        name: extract_helper_name(parts[1]),
                        command: parts[1].to_string(),
                        scope: "url".to_string(),
                        url_pattern: Some(url.to_string()),
                    });
                }
            }
        }
    }

    Ok(helpers)
}

/// Extract helper name from command
fn extract_helper_name(cmd: &str) -> String {
    // Handle common formats:
    // - "osxkeychain" -> "osxkeychain"
    // - "manager-core" -> "manager-core"
    // - "/path/to/helper" -> "helper"
    // - "!helper" -> "helper"
    // - "cache --timeout=3600" -> "cache"
    // - "store --file ~/.git-credentials" -> "store"
    let clean = cmd.trim_start_matches('!');
    // First split by whitespace to isolate the command from its arguments
    let command_part = clean.split_whitespace().next().unwrap_or(clean);
    // Then extract basename from path
    command_part
        .split('/')
        .next_back()
        .unwrap_or(command_part)
        .to_string()
}

/// Set credential helper
#[command]
pub async fn set_credential_helper(
    path: Option<String>,
    helper: String,
    global: Option<bool>,
    url_pattern: Option<String>,
) -> Result<()> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    if let Some(url) = url_pattern {
        // URL-specific helper
        let key = format!("credential.{}.helper", url);
        let scope = if global.unwrap_or(false) {
            "--global"
        } else {
            "--local"
        };
        run_git_config(repo_path, &[scope, &key, &helper])?;
    } else {
        // Global or local helper
        let scope = if global.unwrap_or(false) {
            "--global"
        } else {
            "--local"
        };
        run_git_config(repo_path, &[scope, "credential.helper", &helper])?;
    }

    Ok(())
}

/// Unset credential helper
#[command]
pub async fn unset_credential_helper(
    path: Option<String>,
    global: Option<bool>,
    url_pattern: Option<String>,
) -> Result<()> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    if let Some(url) = url_pattern {
        // URL-specific helper
        let key = format!("credential.{}.helper", url);
        let scope = if global.unwrap_or(false) {
            "--global"
        } else {
            "--local"
        };
        let _ = run_git_config(repo_path, &[scope, "--unset", &key]);
    } else {
        // Global or local helper
        let scope = if global.unwrap_or(false) {
            "--global"
        } else {
            "--local"
        };
        let _ = run_git_config(repo_path, &[scope, "--unset", "credential.helper"]);
    }

    Ok(())
}

/// Get available credential helpers on this system
#[command]
pub async fn get_available_helpers() -> Result<Vec<AvailableHelper>> {
    let mut helpers = Vec::new();

    // Common credential helpers by platform
    #[cfg(target_os = "macos")]
    {
        helpers.push(AvailableHelper {
            name: "osxkeychain".to_string(),
            description: "macOS Keychain (recommended)".to_string(),
            available: check_helper_available("osxkeychain"),
        });
    }

    #[cfg(target_os = "windows")]
    {
        helpers.push(AvailableHelper {
            name: "manager".to_string(),
            description: "Git Credential Manager".to_string(),
            available: check_helper_available("manager"),
        });
        helpers.push(AvailableHelper {
            name: "wincred".to_string(),
            description: "Windows Credential Store".to_string(),
            available: check_helper_available("wincred"),
        });
    }

    #[cfg(target_os = "linux")]
    {
        helpers.push(AvailableHelper {
            name: "libsecret".to_string(),
            description: "GNOME Keyring / libsecret".to_string(),
            available: check_helper_available("libsecret"),
        });
        helpers.push(AvailableHelper {
            name: "store".to_string(),
            description: "Store credentials in plain text (not recommended)".to_string(),
            available: true, // Always available as fallback
        });
    }

    // Cross-platform helpers
    helpers.push(AvailableHelper {
        name: "cache".to_string(),
        description: "Cache credentials in memory temporarily".to_string(),
        available: true,
    });

    helpers.push(AvailableHelper {
        name: "store".to_string(),
        description: "Store credentials in plain text file".to_string(),
        available: true,
    });

    Ok(helpers)
}

/// Check if a credential helper is available
fn check_helper_available(helper: &str) -> bool {
    create_command("git")
        .arg(format!("credential-{}", helper))
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
        || create_command(&format!("git-credential-{}", helper))
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

/// Test credentials for a remote URL
#[command]
pub async fn test_credentials(path: String, remote_url: String) -> Result<CredentialTestResult> {
    let repo_path = Path::new(&path);

    // Determine protocol and host from URL
    let (protocol, host) = if remote_url.starts_with("git@") || remote_url.starts_with("ssh://") {
        ("ssh".to_string(), extract_host(&remote_url))
    } else {
        ("https".to_string(), extract_host(&remote_url))
    };

    if protocol == "ssh" {
        // For SSH, test the connection
        let output = create_command("ssh")
            .args([
                "-T",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                "BatchMode=yes",
                &format!("git@{}", host),
            ])
            .output()
            .map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to test SSH connection: {}", e))
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = if stdout.is_empty() {
            stderr.to_string()
        } else {
            stdout.to_string()
        };

        let success = message.contains("successfully authenticated")
            || message.contains("Welcome")
            || message.contains("logged in as");

        let username = extract_ssh_username(&message);

        Ok(CredentialTestResult {
            success,
            host,
            protocol,
            username,
            message: message.trim().to_string(),
        })
    } else {
        // For HTTPS, use git credential fill
        let mut cmd = create_command("git");
        cmd.current_dir(repo_path);
        cmd.args(["credential", "fill"]);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to run git credential: {}", e))
        })?;

        // Send credential request
        use std::io::Write;
        if let Some(mut stdin) = child.stdin.take() {
            let input = format!("protocol=https\nhost={}\n\n", host);
            let _ = stdin.write_all(input.as_bytes());
        }

        let output = child.wait_with_output().map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to get credential output: {}", e))
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse response
        let mut username = None;
        let mut has_password = false;

        for line in stdout.lines() {
            if let Some(u) = line.strip_prefix("username=") {
                username = Some(u.to_string());
            } else if line.starts_with("password=") {
                has_password = true;
            }
        }

        let success = username.is_some() && has_password;
        let message = if success {
            format!("Credentials found for {}", host)
        } else if username.is_some() {
            format!("Username found but no password for {}", host)
        } else {
            format!("No credentials found for {}", host)
        };

        Ok(CredentialTestResult {
            success,
            host,
            protocol,
            username,
            message,
        })
    }
}

/// Extract host from URL
fn extract_host(url: &str) -> String {
    // Handle various URL formats:
    // - https://github.com/user/repo.git
    // - git@github.com:user/repo.git
    // - ssh://git@github.com/user/repo.git

    if let Some(rest) = url.strip_prefix("https://") {
        rest.split('/').next().unwrap_or("").to_string()
    } else if let Some(rest) = url.strip_prefix("http://") {
        rest.split('/').next().unwrap_or("").to_string()
    } else if let Some(rest) = url.strip_prefix("ssh://") {
        rest.split('@')
            .next_back()
            .and_then(|s| s.split('/').next())
            .unwrap_or("")
            .to_string()
    } else if url.contains('@') && url.contains(':') {
        // git@host:path format
        url.split('@')
            .next_back()
            .and_then(|s| s.split(':').next())
            .unwrap_or("")
            .to_string()
    } else {
        url.to_string()
    }
}

/// Extract username from SSH response
fn extract_ssh_username(message: &str) -> Option<String> {
    if message.contains("Hi ") {
        message
            .split("Hi ")
            .nth(1)
            .and_then(|s| s.split('!').next())
            .map(|s| s.to_string())
    } else if message.contains("Welcome to GitLab, @") {
        message
            .split('@')
            .nth(1)
            .and_then(|s| s.split('!').next())
            .map(|s| s.to_string())
    } else if message.contains("logged in as ") {
        message
            .split("logged in as ")
            .nth(1)
            .and_then(|s| s.split('.').next())
            .map(|s| s.to_string())
    } else {
        None
    }
}

/// Store git credentials in the system keyring
/// This is used for HTTPS authentication with git operations
#[command]
pub async fn store_git_credentials(url: String, username: String, password: String) -> Result<()> {
    use crate::services::credentials_service;

    tracing::info!("Storing git credentials for URL: {}", url);
    credentials_service::store_credentials(&url, &username, &password).map_err(|e| {
        tracing::error!("Failed to store credentials for {}: {}", url, e);
        LeviathanError::OperationFailed(format!("Failed to store credentials: {}", e))
    })?;
    tracing::info!("Successfully stored git credentials for URL: {}", url);
    Ok(())
}

/// Delete git credentials from the system keyring
#[command]
pub async fn delete_git_credentials(url: String) -> Result<()> {
    use crate::services::credentials_service;

    credentials_service::delete_credentials(&url).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to delete credentials: {}", e))
    })
}

/// Erase stored credentials for a host
#[command]
pub async fn erase_credentials(path: String, host: String, protocol: String) -> Result<()> {
    let repo_path = Path::new(&path);

    let mut cmd = create_command("git");
    cmd.current_dir(repo_path);
    cmd.args(["credential", "reject"]);
    cmd.stdin(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to run git credential: {}", e))
    })?;

    // Send credential info to reject
    use std::io::Write;
    if let Some(mut stdin) = child.stdin.take() {
        let input = format!("protocol={}\nhost={}\n\n", protocol, host);
        let _ = stdin.write_all(input.as_bytes());
    }

    let _ = child.wait();

    Ok(())
}

/// Migrate old vault file to new location if needed
/// Old path was missing the / separator between app dir and filename
#[command]
pub async fn migrate_vault_if_needed(data_dir: String, new_vault_path: String) -> Result<()> {
    use std::fs;

    let new_path = Path::new(&new_vault_path);

    // If new vault already exists, no migration needed
    if new_path.exists() {
        return Ok(());
    }

    // Old path was missing the / separator
    // data_dir is like: /Users/.../io.github.hegsie.leviathan/
    // Old vault was at: /Users/.../io.github.hegsie.leviathancredentials.hold
    let parent_dir = data_dir.trim_end_matches('/');
    let old_vault_path = format!("{}credentials.hold", parent_dir);
    let old_path = Path::new(&old_vault_path);

    if old_path.exists() {
        tracing::info!(
            "Migrating vault from old location: {} → {}",
            old_vault_path,
            new_vault_path
        );
        fs::rename(old_path, new_path).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to migrate vault: {}", e))
        })?;
        tracing::info!("Vault migration complete");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;
    use tempfile::TempDir;

    #[test]
    fn test_extract_helper_name_simple() {
        assert_eq!(extract_helper_name("osxkeychain"), "osxkeychain");
        assert_eq!(extract_helper_name("manager-core"), "manager-core");
        assert_eq!(extract_helper_name("store"), "store");
        assert_eq!(extract_helper_name("cache"), "cache");
    }

    #[test]
    fn test_extract_helper_name_with_path() {
        assert_eq!(
            extract_helper_name("/usr/local/bin/git-credential-helper"),
            "git-credential-helper"
        );
        assert_eq!(
            extract_helper_name("/path/to/custom-helper"),
            "custom-helper"
        );
    }

    #[test]
    fn test_extract_helper_name_with_bang() {
        assert_eq!(extract_helper_name("!helper"), "helper");
        assert_eq!(extract_helper_name("!/path/to/helper"), "helper");
    }

    #[test]
    fn test_extract_helper_name_with_args() {
        assert_eq!(extract_helper_name("cache --timeout=3600"), "cache");
        assert_eq!(
            extract_helper_name("store --file ~/.git-credentials"),
            "store"
        );
    }

    #[test]
    fn test_extract_host_https() {
        assert_eq!(
            extract_host("https://github.com/user/repo.git"),
            "github.com"
        );
        assert_eq!(extract_host("https://gitlab.com/user/repo"), "gitlab.com");
        assert_eq!(
            extract_host("https://bitbucket.org/user/repo.git"),
            "bitbucket.org"
        );
    }

    #[test]
    fn test_extract_host_http() {
        assert_eq!(
            extract_host("http://github.com/user/repo.git"),
            "github.com"
        );
        assert_eq!(
            extract_host("http://internal-git.company.com/repo"),
            "internal-git.company.com"
        );
    }

    #[test]
    fn test_extract_host_ssh() {
        assert_eq!(extract_host("git@github.com:user/repo.git"), "github.com");
        assert_eq!(
            extract_host("git@gitlab.com:group/project.git"),
            "gitlab.com"
        );
    }

    #[test]
    fn test_extract_host_ssh_url() {
        assert_eq!(
            extract_host("ssh://git@github.com/user/repo.git"),
            "github.com"
        );
    }

    #[test]
    fn test_extract_ssh_username_github() {
        assert_eq!(
            extract_ssh_username("Hi testuser! You've successfully authenticated"),
            Some("testuser".to_string())
        );
    }

    #[test]
    fn test_extract_ssh_username_gitlab() {
        assert_eq!(
            extract_ssh_username("Welcome to GitLab, @testuser!"),
            Some("testuser".to_string())
        );
    }

    #[test]
    fn test_extract_ssh_username_bitbucket() {
        assert_eq!(
            extract_ssh_username("logged in as testuser."),
            Some("testuser".to_string())
        );
    }

    #[test]
    fn test_extract_ssh_username_no_match() {
        assert_eq!(extract_ssh_username("Connection refused"), None);
        assert_eq!(extract_ssh_username("Permission denied"), None);
    }

    #[tokio::test]
    async fn test_get_credential_helpers() {
        let repo = TestRepo::with_initial_commit();
        let result = get_credential_helpers(repo.path_str()).await;
        assert!(result.is_ok());
        // Result may or may not have helpers depending on system config
        let _helpers = result.unwrap();
    }

    #[tokio::test]
    async fn test_set_credential_helper_local() {
        let repo = TestRepo::with_initial_commit();

        // Set a local credential helper
        let result = set_credential_helper(
            Some(repo.path_str()),
            "cache".to_string(),
            Some(false),
            None,
        )
        .await;
        assert!(result.is_ok());

        // Verify it was set
        let helpers = get_credential_helpers(repo.path_str()).await.unwrap();
        let local_helper = helpers.iter().find(|h| h.scope == "local");
        assert!(local_helper.is_some());
        assert_eq!(local_helper.unwrap().name, "cache");
    }

    #[tokio::test]
    async fn test_unset_credential_helper_local() {
        let repo = TestRepo::with_initial_commit();

        // First set a helper
        set_credential_helper(
            Some(repo.path_str()),
            "cache".to_string(),
            Some(false),
            None,
        )
        .await
        .unwrap();

        // Then unset it
        let result = unset_credential_helper(Some(repo.path_str()), Some(false), None).await;
        assert!(result.is_ok());

        // Verify it was unset
        let helpers = get_credential_helpers(repo.path_str()).await.unwrap();
        let local_helper = helpers.iter().find(|h| h.scope == "local");
        assert!(local_helper.is_none());
    }

    #[tokio::test]
    async fn test_set_credential_helper_with_url_pattern() {
        let repo = TestRepo::with_initial_commit();

        // Set a URL-specific helper
        let result = set_credential_helper(
            Some(repo.path_str()),
            "cache".to_string(),
            Some(false),
            Some("https://github.com".to_string()),
        )
        .await;
        assert!(result.is_ok());

        // Verify it was set
        let helpers = get_credential_helpers(repo.path_str()).await.unwrap();
        let url_helper = helpers
            .iter()
            .find(|h| h.scope == "url" && h.url_pattern.as_deref() == Some("https://github.com"));
        assert!(url_helper.is_some());
    }

    #[tokio::test]
    async fn test_get_available_helpers() {
        let result = get_available_helpers().await;
        assert!(result.is_ok());

        let helpers = result.unwrap();
        // Should always have cache and store as available
        let cache_helper = helpers.iter().find(|h| h.name == "cache");
        let store_helper = helpers.iter().find(|h| h.name == "store");

        assert!(cache_helper.is_some());
        assert!(store_helper.is_some());
        assert!(cache_helper.unwrap().available);
        assert!(store_helper.unwrap().available);
    }

    #[tokio::test]
    async fn test_erase_credentials() {
        let repo = TestRepo::with_initial_commit();

        // This should not fail even if no credentials exist
        let result = erase_credentials(
            repo.path_str(),
            "github.com".to_string(),
            "https".to_string(),
        )
        .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_migrate_vault_if_needed_no_old_vault() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let data_dir = dir.path().join("app_data");
        std::fs::create_dir_all(&data_dir).unwrap();

        let new_vault_path = data_dir.join("credentials.hold");

        let result = migrate_vault_if_needed(
            data_dir.to_string_lossy().to_string(),
            new_vault_path.to_string_lossy().to_string(),
        )
        .await;
        assert!(result.is_ok());
        // New vault should not exist since there was no old vault
        assert!(!new_vault_path.exists());
    }

    #[tokio::test]
    async fn test_migrate_vault_if_needed_new_vault_exists() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let data_dir = dir.path().join("app_data");
        std::fs::create_dir_all(&data_dir).unwrap();

        let new_vault_path = data_dir.join("credentials.hold");
        std::fs::write(&new_vault_path, "existing vault content").unwrap();

        let result = migrate_vault_if_needed(
            data_dir.to_string_lossy().to_string(),
            new_vault_path.to_string_lossy().to_string(),
        )
        .await;
        assert!(result.is_ok());
        // Should still have the original content
        assert!(new_vault_path.exists());
    }

    #[tokio::test]
    async fn test_credential_helper_struct() {
        let helper = CredentialHelper {
            name: "cache".to_string(),
            command: "cache --timeout=3600".to_string(),
            scope: "local".to_string(),
            url_pattern: None,
        };

        assert_eq!(helper.name, "cache");
        assert_eq!(helper.scope, "local");
        assert!(helper.url_pattern.is_none());
    }

    #[tokio::test]
    async fn test_credential_test_result_struct() {
        let result = CredentialTestResult {
            success: true,
            host: "github.com".to_string(),
            protocol: "https".to_string(),
            username: Some("testuser".to_string()),
            message: "Credentials found".to_string(),
        };

        assert!(result.success);
        assert_eq!(result.host, "github.com");
        assert_eq!(result.protocol, "https");
        assert_eq!(result.username, Some("testuser".to_string()));
    }

    #[tokio::test]
    async fn test_available_helper_struct() {
        let helper = AvailableHelper {
            name: "osxkeychain".to_string(),
            description: "macOS Keychain".to_string(),
            available: true,
        };

        assert_eq!(helper.name, "osxkeychain");
        assert!(helper.available);
    }
}
