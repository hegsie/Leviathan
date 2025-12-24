//! GPG command handlers
//! Manage GPG signing for commits and tags

use std::path::Path;
use std::process::Command;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// GPG key information
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpgKey {
    /// Key ID (short form)
    pub key_id: String,
    /// Key ID (long form)
    pub key_id_long: String,
    /// User ID (name and email)
    pub user_id: String,
    /// Email address
    pub email: String,
    /// Key creation date
    pub created: Option<String>,
    /// Key expiration date (if set)
    pub expires: Option<String>,
    /// Whether this is the currently configured signing key
    pub is_signing_key: bool,
    /// Key type (RSA, DSA, etc.)
    pub key_type: String,
    /// Key size in bits
    pub key_size: u32,
    /// Trust level
    pub trust: String,
}

/// GPG signing configuration
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpgConfig {
    /// Whether GPG is available
    pub gpg_available: bool,
    /// GPG version
    pub gpg_version: Option<String>,
    /// Currently configured signing key
    pub signing_key: Option<String>,
    /// Whether commit signing is enabled
    pub sign_commits: bool,
    /// Whether tag signing is enabled
    pub sign_tags: bool,
    /// GPG program path
    pub gpg_program: Option<String>,
}

/// Commit signature information
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSignature {
    /// Whether the commit is signed
    pub signed: bool,
    /// Signature status (G=good, B=bad, U=unknown, X=expired, etc.)
    pub status: Option<String>,
    /// Signer's key ID
    pub key_id: Option<String>,
    /// Signer's name
    pub signer: Option<String>,
    /// Whether the signature is valid
    pub valid: bool,
    /// Trust level of the key
    pub trust: Option<String>,
}

/// Run a command and capture output
fn run_command(cmd: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run {}: {}", cmd, e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(LeviathanError::OperationFailed(
            if stderr.is_empty() { stdout } else { stderr }
                .trim()
                .to_string(),
        ))
    }
}

/// Run git command in a repository
fn run_git_command(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run git: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        Err(LeviathanError::OperationFailed(
            if stderr.is_empty() { stdout } else { stderr }
                .trim()
                .to_string(),
        ))
    }
}

/// Check if GPG is available
fn is_gpg_available() -> bool {
    Command::new("gpg")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get GPG version
fn get_gpg_version() -> Option<String> {
    Command::new("gpg")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .to_string()
        })
}

/// Get GPG signing configuration
#[command]
pub async fn get_gpg_config(path: String) -> Result<GpgConfig> {
    let repo_path = Path::new(&path);
    let gpg_available = is_gpg_available();
    let gpg_version = get_gpg_version();

    if !gpg_available {
        return Ok(GpgConfig {
            gpg_available: false,
            gpg_version: None,
            signing_key: None,
            sign_commits: false,
            sign_tags: false,
            gpg_program: None,
        });
    }

    // Get signing key from git config
    let signing_key = run_git_command(repo_path, &["config", "--get", "user.signingkey"])
        .ok()
        .filter(|s| !s.is_empty());

    // Check if commit signing is enabled
    let sign_commits = run_git_command(repo_path, &["config", "--get", "commit.gpgsign"])
        .ok()
        .map(|s| s.trim() == "true")
        .unwrap_or(false);

    // Check if tag signing is enabled
    let sign_tags = run_git_command(repo_path, &["config", "--get", "tag.gpgsign"])
        .ok()
        .map(|s| s.trim() == "true")
        .unwrap_or(false);

    // Get GPG program if configured
    let gpg_program = run_git_command(repo_path, &["config", "--get", "gpg.program"])
        .ok()
        .filter(|s| !s.is_empty());

    Ok(GpgConfig {
        gpg_available,
        gpg_version,
        signing_key,
        sign_commits,
        sign_tags,
        gpg_program,
    })
}

/// Get list of available GPG keys
#[command]
pub async fn get_gpg_keys(path: String) -> Result<Vec<GpgKey>> {
    let repo_path = Path::new(&path);

    if !is_gpg_available() {
        return Ok(Vec::new());
    }

    // Get current signing key
    let current_signing_key =
        run_git_command(repo_path, &["config", "--get", "user.signingkey"]).ok();

    // List secret keys (ones we can sign with)
    let output = run_command(
        "gpg",
        &["--list-secret-keys", "--keyid-format=long", "--with-colons"],
    )?;

    let mut keys = Vec::new();
    let mut current_key: Option<GpgKey> = None;

    for line in output.lines() {
        let fields: Vec<&str> = line.split(':').collect();
        if fields.is_empty() {
            continue;
        }

        match fields[0] {
            "sec" => {
                // Save previous key
                if let Some(key) = current_key.take() {
                    keys.push(key);
                }

                // Parse key info
                // Format: sec:validity:size:type:keyid:created:expires:...
                let key_size: u32 = fields.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
                let key_type = match *fields.get(3).unwrap_or(&"") {
                    "1" => "RSA",
                    "17" => "DSA",
                    "18" => "ECDH",
                    "19" => "ECDSA",
                    "22" => "EdDSA",
                    _ => "Unknown",
                }
                .to_string();
                let key_id_long = fields.get(4).unwrap_or(&"").to_string();
                let key_id = key_id_long
                    .get(key_id_long.len().saturating_sub(8)..)
                    .unwrap_or(&key_id_long)
                    .to_string();
                let created = fields.get(5).map(|s| s.to_string());
                let expires = fields.get(6).and_then(|s| {
                    if s.is_empty() {
                        None
                    } else {
                        Some(s.to_string())
                    }
                });
                let trust = match *fields.get(1).unwrap_or(&"") {
                    "u" => "Ultimate",
                    "f" => "Full",
                    "m" => "Marginal",
                    "n" => "Never",
                    "e" => "Expired",
                    "r" => "Revoked",
                    _ => "Unknown",
                }
                .to_string();

                let is_signing_key = current_signing_key
                    .as_ref()
                    .map(|sk| key_id_long.ends_with(sk) || sk.ends_with(&key_id))
                    .unwrap_or(false);

                current_key = Some(GpgKey {
                    key_id,
                    key_id_long,
                    user_id: String::new(),
                    email: String::new(),
                    created,
                    expires,
                    is_signing_key,
                    key_type,
                    key_size,
                    trust,
                });
            }
            "uid" => {
                // Parse user ID
                if let Some(ref mut key) = current_key {
                    if key.user_id.is_empty() {
                        let uid = fields.get(9).unwrap_or(&"").to_string();
                        key.user_id = uid.clone();

                        // Extract email from "Name <email>"
                        if let Some(start) = uid.find('<') {
                            if let Some(end) = uid.find('>') {
                                key.email = uid[start + 1..end].to_string();
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Don't forget the last key
    if let Some(key) = current_key {
        keys.push(key);
    }

    Ok(keys)
}

/// Set the signing key
#[command]
pub async fn set_signing_key(
    path: String,
    key_id: Option<String>,
    global: Option<bool>,
) -> Result<()> {
    let repo_path = Path::new(&path);
    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    if let Some(key) = key_id {
        run_git_command(repo_path, &["config", scope, "user.signingkey", &key])?;
    } else {
        // Unset the signing key
        let _ = run_git_command(repo_path, &["config", scope, "--unset", "user.signingkey"]);
    }

    Ok(())
}

/// Enable or disable commit signing
#[command]
pub async fn set_commit_signing(path: String, enabled: bool, global: Option<bool>) -> Result<()> {
    let repo_path = Path::new(&path);
    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    let value = if enabled { "true" } else { "false" };
    run_git_command(repo_path, &["config", scope, "commit.gpgsign", value])?;

    Ok(())
}

/// Enable or disable tag signing
#[command]
pub async fn set_tag_signing(path: String, enabled: bool, global: Option<bool>) -> Result<()> {
    let repo_path = Path::new(&path);
    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    let value = if enabled { "true" } else { "false" };
    run_git_command(repo_path, &["config", scope, "tag.gpgsign", value])?;

    Ok(())
}

/// Get signature information for a commit
#[command]
pub async fn get_commit_signature(path: String, commit_oid: String) -> Result<CommitSignature> {
    let repo_path = Path::new(&path);

    // Use git log with signature format
    let output = run_git_command(
        repo_path,
        &["log", "-1", "--format=%G?|%GK|%GS|%GT", &commit_oid],
    );

    match output {
        Ok(line) => {
            let parts: Vec<&str> = line.split('|').collect();
            let status = parts.first().map(|s| s.to_string());

            let signed = status
                .as_ref()
                .map(|s| !s.is_empty() && s != "N")
                .unwrap_or(false);

            let valid = status
                .as_ref()
                .map(|s| s == "G" || s == "U")
                .unwrap_or(false);

            let key_id = parts
                .get(1)
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            let signer = parts
                .get(2)
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            let trust = parts
                .get(3)
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());

            Ok(CommitSignature {
                signed,
                status,
                key_id,
                signer,
                valid,
                trust,
            })
        }
        Err(_) => Ok(CommitSignature {
            signed: false,
            status: None,
            key_id: None,
            signer: None,
            valid: false,
            trust: None,
        }),
    }
}

/// Verify signatures for multiple commits (batch operation)
#[command]
pub async fn get_commits_signatures(
    path: String,
    commit_oids: Vec<String>,
) -> Result<Vec<(String, CommitSignature)>> {
    let mut results = Vec::new();

    for oid in commit_oids {
        let sig = get_commit_signature(path.clone(), oid.clone()).await?;
        results.push((oid, sig));
    }

    Ok(results)
}
