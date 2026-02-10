//! Git configuration command handlers
//! Manage global and repository-level git settings

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

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
    } else {
        // Exit code 1 with no output means "key not found", which is not an error
        if output.status.code() == Some(1) && stderr.is_empty() && stdout.is_empty() {
            Ok(String::new())
        } else {
            Err(LeviathanError::OperationFailed(if stderr.is_empty() {
                stdout
            } else {
                stderr
            }))
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
                    name: parts[0]
                        .strip_prefix("alias.")
                        .unwrap_or(parts[0])
                        .to_string(),
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
                let name = parts[0]
                    .strip_prefix("alias.")
                    .unwrap_or(parts[0])
                    .to_string();

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
        "rebase.autoStash",
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

/// Line ending configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineEndingConfig {
    /// core.autocrlf setting: "true", "false", "input"
    pub core_autocrlf: Option<String>,
    /// core.eol setting: "lf", "crlf", "native"
    pub core_eol: Option<String>,
    /// core.safecrlf setting: "true", "false", "warn"
    pub core_safecrlf: Option<String>,
}

/// Git config entry with scope information
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConfig {
    pub key: String,
    pub value: String,
    pub scope: String,
}

/// Get line ending configuration for a repository
#[command]
pub async fn get_line_ending_config(path: String) -> Result<LineEndingConfig> {
    let repo_path = Path::new(&path);

    let core_autocrlf = run_git_config(Some(repo_path), &["--get", "core.autocrlf"])
        .ok()
        .filter(|s| !s.is_empty());
    let core_eol = run_git_config(Some(repo_path), &["--get", "core.eol"])
        .ok()
        .filter(|s| !s.is_empty());
    let core_safecrlf = run_git_config(Some(repo_path), &["--get", "core.safecrlf"])
        .ok()
        .filter(|s| !s.is_empty());

    Ok(LineEndingConfig {
        core_autocrlf,
        core_eol,
        core_safecrlf,
    })
}

/// Set line ending configuration for a repository
#[command]
pub async fn set_line_ending_config(
    path: String,
    autocrlf: Option<String>,
    eol: Option<String>,
    safecrlf: Option<String>,
) -> Result<LineEndingConfig> {
    let repo_path = Path::new(&path);

    if let Some(ref val) = autocrlf {
        run_git_config(Some(repo_path), &["core.autocrlf", val])?;
    }
    if let Some(ref val) = eol {
        run_git_config(Some(repo_path), &["core.eol", val])?;
    }
    if let Some(ref val) = safecrlf {
        run_git_config(Some(repo_path), &["core.safecrlf", val])?;
    }

    // Return the updated config
    get_line_ending_config(path).await
}

/// Get a single git config value (generic)
#[command]
pub async fn get_git_config(path: String, key: String) -> Result<Option<String>> {
    let repo_path = Path::new(&path);
    let result = run_git_config(Some(repo_path), &["--get", &key])?;
    if result.is_empty() {
        Ok(None)
    } else {
        Ok(Some(result))
    }
}

/// Set a single git config value (generic)
#[command]
pub async fn set_git_config(
    path: String,
    key: String,
    value: String,
    global: Option<bool>,
) -> Result<()> {
    let repo_path = Path::new(&path);

    if global.unwrap_or(false) {
        run_git_config(Some(repo_path), &["--global", &key, &value])?;
    } else {
        run_git_config(Some(repo_path), &[&key, &value])?;
    }

    Ok(())
}

/// Get all git config entries with scope information
#[command]
pub async fn get_all_git_config(path: String) -> Result<Vec<GitConfig>> {
    let repo_path = Path::new(&path);
    let result = run_git_config(Some(repo_path), &["--list", "--show-scope"])?;

    let entries: Vec<GitConfig> = result
        .lines()
        .filter_map(|line| {
            // Format: "scope\tkey=value" or "scope key=value"
            // git config --show-scope outputs: "local   key=value" (tab-separated)
            let (scope, rest) = if let Some(idx) = line.find('\t') {
                (&line[..idx], &line[idx + 1..])
            } else {
                // Fallback: try splitting on first space
                let parts: Vec<&str> = line.splitn(2, ' ').collect();
                if parts.len() == 2 {
                    (parts[0], parts[1])
                } else {
                    return None;
                }
            };

            let kv_parts: Vec<&str> = rest.splitn(2, '=').collect();
            if kv_parts.len() == 2 {
                Some(GitConfig {
                    key: kv_parts[0].to_string(),
                    value: kv_parts[1].to_string(),
                    scope: scope.trim().to_string(),
                })
            } else {
                // Key with no value
                Some(GitConfig {
                    key: rest.to_string(),
                    value: String::new(),
                    scope: scope.trim().to_string(),
                })
            }
        })
        .collect();

    Ok(entries)
}

/// Unset a git config value
#[command]
pub async fn unset_git_config(path: String, key: String, global: Option<bool>) -> Result<()> {
    let repo_path = Path::new(&path);

    if global.unwrap_or(false) {
        let _ = run_git_config(Some(repo_path), &["--global", "--unset", &key]);
    } else {
        let _ = run_git_config(Some(repo_path), &["--unset", &key]);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_line_ending_config() {
        let repo = TestRepo::with_initial_commit();
        let result = get_line_ending_config(repo.path_str()).await;
        assert!(result.is_ok());
        let config = result.unwrap();
        // Fresh repo may not have these set
        // Just verify we got a valid response
        assert!(
            config.core_autocrlf.is_none()
                || config.core_autocrlf.as_deref() == Some("true")
                || config.core_autocrlf.as_deref() == Some("false")
                || config.core_autocrlf.as_deref() == Some("input")
        );
    }

    #[tokio::test]
    async fn test_set_line_ending_config() {
        let repo = TestRepo::with_initial_commit();

        let result = set_line_ending_config(
            repo.path_str(),
            Some("input".to_string()),
            Some("lf".to_string()),
            Some("warn".to_string()),
        )
        .await;
        assert!(result.is_ok());

        let config = result.unwrap();
        assert_eq!(config.core_autocrlf.as_deref(), Some("input"));
        assert_eq!(config.core_eol.as_deref(), Some("lf"));
        assert_eq!(config.core_safecrlf.as_deref(), Some("warn"));
    }

    #[tokio::test]
    async fn test_set_line_ending_config_partial() {
        let repo = TestRepo::with_initial_commit();

        // Only set autocrlf
        let result =
            set_line_ending_config(repo.path_str(), Some("true".to_string()), None, None).await;
        assert!(result.is_ok());

        let config = result.unwrap();
        assert_eq!(config.core_autocrlf.as_deref(), Some("true"));
    }

    #[tokio::test]
    async fn test_get_git_config() {
        let repo = TestRepo::with_initial_commit();

        // user.name should be set by TestRepo
        let result = get_git_config(repo.path_str(), "user.name".to_string()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("Test User".to_string()));
    }

    #[tokio::test]
    async fn test_get_git_config_missing_key() {
        let repo = TestRepo::with_initial_commit();

        let result = get_git_config(repo.path_str(), "nonexistent.key".to_string()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }

    #[tokio::test]
    async fn test_set_git_config() {
        let repo = TestRepo::with_initial_commit();

        let result = set_git_config(
            repo.path_str(),
            "test.key".to_string(),
            "test-value".to_string(),
            None,
        )
        .await;
        assert!(result.is_ok());

        // Verify it was set
        let get_result = get_git_config(repo.path_str(), "test.key".to_string()).await;
        assert!(get_result.is_ok());
        assert_eq!(get_result.unwrap(), Some("test-value".to_string()));
    }

    #[tokio::test]
    async fn test_get_all_git_config() {
        let repo = TestRepo::with_initial_commit();

        let result = get_all_git_config(repo.path_str()).await;
        assert!(result.is_ok());
        let entries = result.unwrap();
        assert!(!entries.is_empty());
        // Should contain user.name that was set during repo init
        assert!(entries.iter().any(|e| e.key == "user.name"));
    }

    #[tokio::test]
    async fn test_unset_git_config() {
        let repo = TestRepo::with_initial_commit();

        // Set a value first
        set_git_config(
            repo.path_str(),
            "test.toremove".to_string(),
            "value".to_string(),
            None,
        )
        .await
        .unwrap();

        // Verify it exists
        let val = get_git_config(repo.path_str(), "test.toremove".to_string())
            .await
            .unwrap();
        assert_eq!(val, Some("value".to_string()));

        // Unset it
        let result = unset_git_config(repo.path_str(), "test.toremove".to_string(), None).await;
        assert!(result.is_ok());

        // Verify it's gone
        let val2 = get_git_config(repo.path_str(), "test.toremove".to_string())
            .await
            .unwrap();
        assert_eq!(val2, None);
    }
}
