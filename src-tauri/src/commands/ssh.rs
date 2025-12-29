//! SSH key management command handlers
//! View, generate, and test SSH keys for Git authentication

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// SSH key information
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    /// Key name (filename without extension)
    pub name: String,
    /// Full path to the private key
    pub path: String,
    /// Full path to the public key
    pub public_path: String,
    /// Key type (rsa, ed25519, ecdsa, etc.)
    pub key_type: String,
    /// Key fingerprint
    pub fingerprint: Option<String>,
    /// Key comment (usually email)
    pub comment: Option<String>,
    /// Public key content
    pub public_key: Option<String>,
}

/// SSH configuration info
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    /// Whether SSH is available
    pub ssh_available: bool,
    /// SSH version
    pub ssh_version: Option<String>,
    /// SSH directory path
    pub ssh_dir: String,
    /// Git's configured SSH command
    pub git_ssh_command: Option<String>,
}

/// SSH connection test result
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTestResult {
    /// Whether the connection was successful
    pub success: bool,
    /// The host that was tested
    pub host: String,
    /// Response message from the server
    pub message: String,
    /// Username authenticated as (if successful)
    pub username: Option<String>,
}

/// Get SSH directory path
fn get_ssh_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".ssh"))
        .unwrap_or_else(|| PathBuf::from("~/.ssh"))
}

/// Check if SSH is available
fn is_ssh_available() -> bool {
    Command::new("ssh")
        .arg("-V")
        .output()
        .map(|o| o.status.success() || !o.stderr.is_empty()) // ssh -V outputs to stderr
        .unwrap_or(false)
}

/// Get SSH version
fn get_ssh_version() -> Option<String> {
    Command::new("ssh")
        .arg("-V")
        .output()
        .ok()
        .map(|o| {
            // ssh -V outputs to stderr
            String::from_utf8_lossy(&o.stderr)
                .lines()
                .next()
                .unwrap_or("")
                .to_string()
        })
        .filter(|s| !s.is_empty())
}

/// Get SSH key fingerprint
fn get_key_fingerprint(public_key_path: &str) -> Option<String> {
    Command::new("ssh-keygen")
        .args(["-l", "-f", public_key_path])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            let output = String::from_utf8_lossy(&o.stdout);
            // Output format: "256 SHA256:xxx comment (type)"
            // Extract just the fingerprint part
            output.split_whitespace().nth(1).unwrap_or("").to_string()
        })
}

/// Parse public key content to get type and comment
fn parse_public_key(content: &str) -> (String, Option<String>) {
    let parts: Vec<&str> = content.split_whitespace().collect();
    let key_type = parts.first().unwrap_or(&"unknown").to_string();
    let comment = parts.get(2).map(|s| s.to_string());
    (key_type, comment)
}

/// Get SSH configuration
#[command]
pub async fn get_ssh_config() -> Result<SshConfig> {
    let ssh_available = is_ssh_available();
    let ssh_version = get_ssh_version();
    let ssh_dir = get_ssh_dir();

    // Get git's SSH command if configured
    let git_ssh_command = Command::new("git")
        // Prevent credential popup dialogs on Windows
        .env("GIT_TERMINAL_PROMPT", "0")
        .args(["config", "--get", "core.sshCommand"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    Ok(SshConfig {
        ssh_available,
        ssh_version,
        ssh_dir: ssh_dir.to_string_lossy().to_string(),
        git_ssh_command,
    })
}

/// List available SSH keys
#[command]
pub async fn get_ssh_keys() -> Result<Vec<SshKey>> {
    let ssh_dir = get_ssh_dir();

    if !ssh_dir.exists() {
        return Ok(Vec::new());
    }

    let mut keys = Vec::new();

    // Common key file patterns
    let key_patterns = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];

    // Also check for any files ending in .pub that have a matching private key
    if let Ok(entries) = fs::read_dir(&ssh_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                // Skip .pub files, we'll find them via their private key
                if filename.ends_with(".pub") {
                    continue;
                }

                // Check if this looks like a key file
                let is_known_key = key_patterns.contains(&filename);
                let has_public = ssh_dir.join(format!("{}.pub", filename)).exists();

                if (is_known_key || has_public) && path.is_file() {
                    let public_path = ssh_dir.join(format!("{}.pub", filename));
                    let public_path_str = public_path.to_string_lossy().to_string();

                    // Try to read public key content
                    let public_content = fs::read_to_string(&public_path).ok();
                    let (key_type, comment) = public_content
                        .as_ref()
                        .map(|c| parse_public_key(c))
                        .unwrap_or_else(|| ("unknown".to_string(), None));

                    // Get fingerprint
                    let fingerprint = if public_path.exists() {
                        get_key_fingerprint(&public_path_str)
                    } else {
                        None
                    };

                    keys.push(SshKey {
                        name: filename.to_string(),
                        path: path.to_string_lossy().to_string(),
                        public_path: public_path_str,
                        key_type,
                        fingerprint,
                        comment,
                        public_key: public_content,
                    });
                }
            }
        }
    }

    // Sort by name
    keys.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(keys)
}

/// Generate a new SSH key
#[command]
pub async fn generate_ssh_key(
    key_type: String,
    email: String,
    filename: Option<String>,
    passphrase: Option<String>,
) -> Result<SshKey> {
    let ssh_dir = get_ssh_dir();

    // Create .ssh directory if it doesn't exist
    if !ssh_dir.exists() {
        fs::create_dir_all(&ssh_dir).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to create .ssh directory: {}", e))
        })?;
    }

    // Determine filename
    let key_name = filename.unwrap_or_else(|| format!("id_{}", key_type.to_lowercase()));
    let key_path = ssh_dir.join(&key_name);

    // Check if key already exists
    if key_path.exists() {
        return Err(LeviathanError::OperationFailed(format!(
            "Key already exists: {}",
            key_path.display()
        )));
    }

    // Build ssh-keygen command
    let mut cmd = Command::new("ssh-keygen");
    cmd.args([
        "-t",
        &key_type.to_lowercase(),
        "-C",
        &email,
        "-f",
        &key_path.to_string_lossy(),
    ]);

    // Add passphrase (empty string for no passphrase)
    let pass = passphrase.unwrap_or_default();
    cmd.args(["-N", &pass]);

    // For ed25519, we don't need to specify key size
    // For RSA, use 4096 bits
    if key_type.to_lowercase() == "rsa" {
        cmd.args(["-b", "4096"]);
    }

    let output = cmd
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run ssh-keygen: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(LeviathanError::OperationFailed(format!(
            "ssh-keygen failed: {}",
            stderr
        )));
    }

    // Read the generated key info
    let public_path = ssh_dir.join(format!("{}.pub", key_name));
    let public_content = fs::read_to_string(&public_path).ok();
    let fingerprint = get_key_fingerprint(&public_path.to_string_lossy());

    Ok(SshKey {
        name: key_name,
        path: key_path.to_string_lossy().to_string(),
        public_path: public_path.to_string_lossy().to_string(),
        key_type: format!("ssh-{}", key_type.to_lowercase()),
        fingerprint,
        comment: Some(email),
        public_key: public_content,
    })
}

/// Test SSH connection to a host
#[command]
pub async fn test_ssh_connection(host: String) -> Result<SshTestResult> {
    // Common git hosts and their SSH test commands
    let (ssh_host, expected_pattern): (String, &str) = if host.contains("github") {
        ("git@github.com".to_string(), "successfully authenticated")
    } else if host.contains("gitlab") {
        ("git@gitlab.com".to_string(), "Welcome to GitLab")
    } else if host.contains("bitbucket") {
        ("git@bitbucket.org".to_string(), "logged in as")
    } else {
        // For custom hosts, just try to connect
        let ssh_host = if host.contains('@') {
            host.clone()
        } else {
            format!("git@{}", host)
        };
        (ssh_host, "")
    };

    // Run ssh -T to test connection
    let output = Command::new("ssh")
        .args([
            "-T",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            &ssh_host,
        ])
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run ssh: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = if stdout.is_empty() {
        stderr.to_string()
    } else {
        stdout.to_string()
    };

    // GitHub returns exit code 1 even on success, so check the message
    let success = message.to_lowercase().contains(expected_pattern)
        || message.contains("successfully authenticated")
        || message.contains("Welcome")
        || message.contains("logged in as")
        || output.status.success();

    // Try to extract username from the message
    let username = if message.contains("Hi ") {
        // GitHub format: "Hi username!"
        message
            .split("Hi ")
            .nth(1)
            .and_then(|s| s.split('!').next())
            .map(|s| s.to_string())
    } else if message.contains("Welcome to GitLab, @") {
        // GitLab format: "Welcome to GitLab, @username!"
        message
            .split("@")
            .nth(1)
            .and_then(|s| s.split('!').next())
            .map(|s| s.to_string())
    } else if message.contains("logged in as ") {
        // Bitbucket format: "logged in as username."
        message
            .split("logged in as ")
            .nth(1)
            .and_then(|s| s.split('.').next())
            .map(|s| s.to_string())
    } else {
        None
    };

    Ok(SshTestResult {
        success,
        host: host.clone(),
        message: message.trim().to_string(),
        username,
    })
}

/// Add SSH key to ssh-agent
#[command]
pub async fn add_key_to_agent(key_path: String) -> Result<()> {
    let output = Command::new("ssh-add")
        .arg(&key_path)
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run ssh-add: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(LeviathanError::OperationFailed(format!(
            "ssh-add failed: {}",
            stderr
        )));
    }

    Ok(())
}

/// List keys loaded in ssh-agent
#[command]
pub async fn list_agent_keys() -> Result<Vec<String>> {
    let output = Command::new("ssh-add")
        .arg("-l")
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run ssh-add: {}", e)))?;

    if !output.status.success() {
        // Exit code 1 means "no identities", which is not an error
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("no identities") || stderr.contains("The agent has no identities") {
            return Ok(Vec::new());
        }
        return Err(LeviathanError::OperationFailed(format!(
            "ssh-add failed: {}",
            stderr
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let keys: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    Ok(keys)
}

/// Get the public key content for copying to clipboard/services
#[command]
pub async fn get_public_key_content(key_name: String) -> Result<String> {
    let ssh_dir = get_ssh_dir();
    let public_path = ssh_dir.join(format!("{}.pub", key_name));

    if !public_path.exists() {
        return Err(LeviathanError::OperationFailed(format!(
            "Public key not found: {}",
            public_path.display()
        )));
    }

    fs::read_to_string(&public_path)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to read public key: {}", e)))
}

/// Delete an SSH key pair
#[command]
pub async fn delete_ssh_key(key_name: String) -> Result<()> {
    let ssh_dir = get_ssh_dir();
    let private_path = ssh_dir.join(&key_name);
    let public_path = ssh_dir.join(format!("{}.pub", key_name));

    // Remove private key
    if private_path.exists() {
        fs::remove_file(&private_path).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to delete private key: {}", e))
        })?;
    }

    // Remove public key
    if public_path.exists() {
        fs::remove_file(&public_path).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to delete public key: {}", e))
        })?;
    }

    Ok(())
}
