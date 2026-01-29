//! External merge tool configuration and launch
//!
//! Provides commands for configuring and launching external merge tools
//! such as kdiff3, meld, Beyond Compare, vimdiff, etc.

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

/// Merge tool configuration
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeToolConfig {
    /// Name of the configured merge tool (e.g., "kdiff3", "meld")
    pub tool_name: Option<String>,
    /// Custom command for the merge tool
    pub tool_cmd: Option<String>,
}

/// Information about a known merge tool
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeToolInfo {
    /// Tool identifier name
    pub name: String,
    /// Human-readable display name
    pub display_name: String,
}

/// Result of launching a merge tool
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeToolResult {
    /// Whether the merge tool exited successfully
    pub success: bool,
    /// Output or error message from the merge tool
    pub message: String,
}

/// Run git config command (local helper)
fn run_git_config(repo_path: &Path, args: &[&str]) -> Result<String> {
    let mut cmd = create_command("git");
    cmd.current_dir(repo_path);
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

/// Get the current merge tool configuration
#[command]
pub async fn get_merge_tool_config(path: String) -> Result<MergeToolConfig> {
    let repo_path = Path::new(&path);

    let tool_name = run_git_config(repo_path, &["--get", "merge.tool"])
        .ok()
        .filter(|s| !s.is_empty());

    let tool_cmd = if let Some(ref name) = tool_name {
        let key = format!("mergetool.{}.cmd", name);
        run_git_config(repo_path, &["--get", &key])
            .ok()
            .filter(|s| !s.is_empty())
    } else {
        None
    };

    Ok(MergeToolConfig {
        tool_name,
        tool_cmd,
    })
}

/// Set the merge tool configuration
#[command]
pub async fn set_merge_tool_config(
    path: String,
    tool_name: String,
    tool_cmd: Option<String>,
) -> Result<()> {
    let repo_path = Path::new(&path);

    run_git_config(repo_path, &["merge.tool", &tool_name])?;

    if let Some(ref cmd) = tool_cmd {
        let key = format!("mergetool.{}.cmd", tool_name);
        run_git_config(repo_path, &[&key, cmd])?;
    }

    Ok(())
}

/// Launch the configured merge tool for a specific file
#[command]
pub async fn launch_merge_tool(path: String, file_path: String) -> Result<MergeToolResult> {
    let repo_path = Path::new(&path);

    // First, get the configured merge tool name
    let tool_name = run_git_config(repo_path, &["--get", "merge.tool"])
        .ok()
        .filter(|s| !s.is_empty());

    let mut cmd = create_command("git");
    cmd.current_dir(repo_path);
    cmd.arg("mergetool");
    cmd.arg("--no-prompt");

    if let Some(ref name) = tool_name {
        cmd.arg(format!("--tool={}", name));
    }

    cmd.arg(&file_path);

    let output = cmd.output().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to launch merge tool: {}", e))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(MergeToolResult {
            success: true,
            message: if stdout.is_empty() {
                "Merge tool completed successfully".to_string()
            } else {
                stdout
            },
        })
    } else {
        Ok(MergeToolResult {
            success: false,
            message: if stderr.is_empty() { stdout } else { stderr },
        })
    }
}

/// Get a list of commonly available merge tools
#[command]
pub async fn get_available_merge_tools() -> Result<Vec<MergeToolInfo>> {
    let tools = vec![
        MergeToolInfo {
            name: "kdiff3".to_string(),
            display_name: "KDiff3".to_string(),
        },
        MergeToolInfo {
            name: "meld".to_string(),
            display_name: "Meld".to_string(),
        },
        MergeToolInfo {
            name: "bc".to_string(),
            display_name: "Beyond Compare".to_string(),
        },
        MergeToolInfo {
            name: "vimdiff".to_string(),
            display_name: "Vimdiff".to_string(),
        },
        MergeToolInfo {
            name: "opendiff".to_string(),
            display_name: "FileMerge (macOS)".to_string(),
        },
        MergeToolInfo {
            name: "p4merge".to_string(),
            display_name: "P4Merge (Perforce)".to_string(),
        },
        MergeToolInfo {
            name: "tortoisemerge".to_string(),
            display_name: "TortoiseMerge".to_string(),
        },
        MergeToolInfo {
            name: "winmerge".to_string(),
            display_name: "WinMerge".to_string(),
        },
        MergeToolInfo {
            name: "vscode".to_string(),
            display_name: "Visual Studio Code".to_string(),
        },
        MergeToolInfo {
            name: "smerge".to_string(),
            display_name: "Sublime Merge".to_string(),
        },
    ];

    Ok(tools)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_merge_tool_config_default() {
        let repo = TestRepo::with_initial_commit();
        let result = get_merge_tool_config(repo.path_str()).await;
        assert!(result.is_ok());
        let config = result.unwrap();
        // Fresh repo should not have a merge tool configured
        assert!(config.tool_name.is_none());
        assert!(config.tool_cmd.is_none());
    }

    #[tokio::test]
    async fn test_set_and_get_merge_tool_config() {
        let repo = TestRepo::with_initial_commit();

        let result = set_merge_tool_config(repo.path_str(), "kdiff3".to_string(), None).await;
        assert!(result.is_ok());

        let config = get_merge_tool_config(repo.path_str()).await.unwrap();
        assert_eq!(config.tool_name.as_deref(), Some("kdiff3"));
    }

    #[tokio::test]
    async fn test_set_merge_tool_config_with_cmd() {
        let repo = TestRepo::with_initial_commit();

        let result = set_merge_tool_config(
            repo.path_str(),
            "custom".to_string(),
            Some("/usr/bin/custom-merge $LOCAL $REMOTE $MERGED".to_string()),
        )
        .await;
        assert!(result.is_ok());

        let config = get_merge_tool_config(repo.path_str()).await.unwrap();
        assert_eq!(config.tool_name.as_deref(), Some("custom"));
        assert_eq!(
            config.tool_cmd.as_deref(),
            Some("/usr/bin/custom-merge $LOCAL $REMOTE $MERGED")
        );
    }

    #[tokio::test]
    async fn test_get_available_merge_tools() {
        let result = get_available_merge_tools().await;
        assert!(result.is_ok());
        let tools = result.unwrap();
        assert!(!tools.is_empty());
        assert!(tools.iter().any(|t| t.name == "kdiff3"));
        assert!(tools.iter().any(|t| t.name == "meld"));
        assert!(tools.iter().any(|t| t.name == "bc"));
        assert!(tools.iter().any(|t| t.name == "vimdiff"));
    }
}
