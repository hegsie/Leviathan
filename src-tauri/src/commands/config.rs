//! Git configuration command handlers
//! Manage global and repository-level git settings

use std::path::Path;
use std::process::Command;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Git configuration entry
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEntry {
    /// Configuration key (e.g., "user.name")
    pub key: String,
    /// Configuration value
    pub value: String,
    /// Scope of the configuration (global, local, system)
    pub scope: String,
}

/// Git alias
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAlias {
    /// Alias name (without "alias." prefix)
    pub name: String,
    /// Command the alias expands to
    pub command: String,
    /// Whether this is a global alias
    pub is_global: bool,
}

/// User identity configuration
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserIdentity {
    /// User name
    pub name: Option<String>,
    /// User email
    pub email: Option<String>,
    /// Whether the name is globally configured
    pub name_is_global: bool,
    /// Whether the email is globally configured
    pub email_is_global: bool,
}

/// Run git config command
fn run_git_config(repo_path: Option<&Path>, args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");

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
    } else {
        // Exit code 1 with no output means "key not found", which is not an error
        if output.status.code() == Some(1) && stderr.is_empty() && stdout.is_empty() {
            Ok(String::new())
        } else {
            Err(LeviathanError::OperationFailed(
                if stderr.is_empty() { stdout } else { stderr },
            ))
        }
    }
}

/// Get a single config value
#[command]
pub async fn get_config_value(
    path: Option<String>,
    key: String,
    global: Option<bool>,
) -> Result<Option<String>> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    let mut args = vec!["--get"];
    if global.unwrap_or(false) {
        args.insert(0, "--global");
    }
    args.push(&key);

    let result = run_git_config(repo_path, &args)?;
    if result.is_empty() {
        Ok(None)
    } else {
        Ok(Some(result))
    }
}

/// Set a config value
#[command]
pub async fn set_config_value(
    path: Option<String>,
    key: String,
    value: String,
    global: Option<bool>,
) -> Result<()> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    run_git_config(repo_path, &[scope, &key, &value])?;
    Ok(())
}

/// Unset a config value
#[command]
pub async fn unset_config_value(
    path: Option<String>,
    key: String,
    global: Option<bool>,
) -> Result<()> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    // --unset might fail if the key doesn't exist, which is fine
    let _ = run_git_config(repo_path, &[scope, "--unset", &key]);
    Ok(())
}

/// Get all config entries from a specific scope
#[command]
pub async fn get_config_list(
    path: Option<String>,
    global: Option<bool>,
) -> Result<Vec<ConfigEntry>> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    let scope_arg = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    let scope_name = if global.unwrap_or(false) {
        "global"
    } else {
        "local"
    };

    let result = run_git_config(repo_path, &[scope_arg, "--list"])?;

    let entries: Vec<ConfigEntry> = result
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(2, '=').collect();
            if parts.len() == 2 {
                Some(ConfigEntry {
                    key: parts[0].to_string(),
                    value: parts[1].to_string(),
                    scope: scope_name.to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(entries)
}

/// Get user identity (name and email)
#[command]
pub async fn get_user_identity(path: String) -> Result<UserIdentity> {
    let repo_path = Path::new(&path);

    // Get local values first
    let local_name = run_git_config(Some(repo_path), &["--local", "--get", "user.name"]).ok();
    let local_email = run_git_config(Some(repo_path), &["--local", "--get", "user.email"]).ok();

    // Get global values
    let global_name = run_git_config(None, &["--global", "--get", "user.name"]).ok();
    let global_email = run_git_config(None, &["--global", "--get", "user.email"]).ok();

    // Determine effective values and where they come from
    let (name, name_is_global) = if let Some(n) = local_name.filter(|s| !s.is_empty()) {
        (Some(n), false)
    } else if let Some(n) = global_name.filter(|s| !s.is_empty()) {
        (Some(n), true)
    } else {
        (None, false)
    };

    let (email, email_is_global) = if let Some(e) = local_email.filter(|s| !s.is_empty()) {
        (Some(e), false)
    } else if let Some(e) = global_email.filter(|s| !s.is_empty()) {
        (Some(e), true)
    } else {
        (None, false)
    };

    Ok(UserIdentity {
        name,
        email,
        name_is_global,
        email_is_global,
    })
}

/// Set user identity
#[command]
pub async fn set_user_identity(
    path: Option<String>,
    name: Option<String>,
    email: Option<String>,
    global: Option<bool>,
) -> Result<()> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    if let Some(n) = name {
        if n.is_empty() {
            let _ = run_git_config(repo_path, &[scope, "--unset", "user.name"]);
        } else {
            run_git_config(repo_path, &[scope, "user.name", &n])?;
        }
    }

    if let Some(e) = email {
        if e.is_empty() {
            let _ = run_git_config(repo_path, &[scope, "--unset", "user.email"]);
        } else {
            run_git_config(repo_path, &[scope, "user.email", &e])?;
        }
    }

    Ok(())
}

/// Get all git aliases
#[command]
pub async fn get_aliases(path: Option<String>) -> Result<Vec<GitAlias>> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    // Get global aliases
    let global_result = run_git_config(None, &["--global", "--get-regexp", "^alias\\."])?;
    let global_aliases: Vec<GitAlias> = global_result
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(2, ' ').collect();
            if parts.len() == 2 && parts[0].starts_with("alias.") {
                Some(GitAlias {
                    name: parts[0].strip_prefix("alias.").unwrap_or(parts[0]).to_string(),
                    command: parts[1].to_string(),
                    is_global: true,
                })
            } else {
                None
            }
        })
        .collect();

    // Get local aliases if repo path is provided
    let mut all_aliases = global_aliases;

    if repo_path.is_some() {
        let local_result = run_git_config(repo_path, &["--local", "--get-regexp", "^alias\\."])
            .unwrap_or_default();

        for line in local_result.lines() {
            let parts: Vec<&str> = line.splitn(2, ' ').collect();
            if parts.len() == 2 && parts[0].starts_with("alias.") {
                let name = parts[0].strip_prefix("alias.").unwrap_or(parts[0]).to_string();

                // Check if we already have a global alias with this name
                // If so, replace it with the local one
                if let Some(idx) = all_aliases.iter().position(|a| a.name == name) {
                    all_aliases[idx] = GitAlias {
                        name,
                        command: parts[1].to_string(),
                        is_global: false,
                    };
                } else {
                    all_aliases.push(GitAlias {
                        name,
                        command: parts[1].to_string(),
                        is_global: false,
                    });
                }
            }
        }
    }

    // Sort by name
    all_aliases.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(all_aliases)
}

/// Set a git alias
#[command]
pub async fn set_alias(
    path: Option<String>,
    name: String,
    command: String,
    global: Option<bool>,
) -> Result<()> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    let alias_key = format!("alias.{}", name);
    run_git_config(repo_path, &[scope, &alias_key, &command])?;

    Ok(())
}

/// Delete a git alias
#[command]
pub async fn delete_alias(path: Option<String>, name: String, global: Option<bool>) -> Result<()> {
    let repo_path = path.as_ref().map(|p| Path::new(p.as_str()));

    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    let alias_key = format!("alias.{}", name);
    run_git_config(repo_path, &[scope, "--unset", &alias_key])?;

    Ok(())
}

/// Get common git configuration settings with their current values
#[command]
pub async fn get_common_settings(path: String) -> Result<Vec<ConfigEntry>> {
    let repo_path = Path::new(&path);

    // List of common settings to check
    let common_keys = [
        "core.autocrlf",
        "core.filemode",
        "core.ignorecase",
        "core.editor",
        "core.pager",
        "pull.rebase",
        "push.default",
        "push.autoSetupRemote",
        "fetch.prune",
        "merge.ff",
        "merge.conflictstyle",
        "diff.colorMoved",
        "init.defaultBranch",
        "credential.helper",
    ];

    let mut settings = Vec::new();

    for key in common_keys {
        // Try local first, then global
        let local_value = run_git_config(Some(repo_path), &["--local", "--get", key]).ok();
        let global_value = run_git_config(None, &["--global", "--get", key]).ok();

        if let Some(val) = local_value.filter(|s| !s.is_empty()) {
            settings.push(ConfigEntry {
                key: key.to_string(),
                value: val,
                scope: "local".to_string(),
            });
        } else if let Some(val) = global_value.filter(|s| !s.is_empty()) {
            settings.push(ConfigEntry {
                key: key.to_string(),
                value: val,
                scope: "global".to_string(),
            });
        }
    }

    Ok(settings)
}
