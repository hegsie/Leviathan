//! External diff tool configuration and launch
//!
//! Provides commands for configuring and launching external diff tools
//! such as VS Code, kdiff3, meld, Beyond Compare, etc.

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

/// Diff tool configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffToolConfig {
    /// Name of the configured diff tool (e.g., "vscode", "meld", "kdiff3")
    pub tool: Option<String>,
    /// Custom command for the diff tool
    pub cmd: Option<String>,
    /// Whether to prompt before launching the diff tool
    pub prompt: bool,
}

/// Information about an available diff tool
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableDiffTool {
    /// Tool identifier name
    pub name: String,
    /// Command used to launch the tool
    pub command: String,
    /// Whether the tool is available on the system
    pub available: bool,
}

/// Result of launching a diff tool
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffToolResult {
    /// Whether the diff tool exited successfully
    pub success: bool,
    /// Output or error message from the diff tool
    pub message: String,
}

/// Run git config command (local helper)
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

/// Check if a command is available on the system
fn is_command_available(command: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        // On Windows, use `where` command
        let output = create_command("where").arg(command).output();
        output.map(|o| o.status.success()).unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Unix-like systems, use `which` command
        let output = create_command("which").arg(command).output();
        output.map(|o| o.status.success()).unwrap_or(false)
    }
}

/// Get the current diff tool configuration
#[command]
pub async fn get_diff_tool(path: String, global: Option<bool>) -> Result<DiffToolConfig> {
    let repo_path = if global.unwrap_or(false) {
        None
    } else {
        Some(Path::new(&path))
    };

    let scope = if global.unwrap_or(false) {
        vec!["--global"]
    } else {
        vec![]
    };

    let tool = {
        let mut args = scope.clone();
        args.extend(["--get", "diff.tool"]);
        run_git_config(repo_path, &args)
            .ok()
            .filter(|s| !s.is_empty())
    };

    let cmd = if let Some(ref name) = tool {
        let key = format!("difftool.{}.cmd", name);
        let mut args = scope.clone();
        args.extend(["--get", &key]);
        run_git_config(repo_path, &args)
            .ok()
            .filter(|s| !s.is_empty())
    } else {
        None
    };

    let prompt = {
        let mut args = scope.clone();
        args.extend(["--get", "difftool.prompt"]);
        let value = run_git_config(repo_path, &args)
            .ok()
            .filter(|s| !s.is_empty());
        // Default is true, but git config stores "false" to disable
        value.map(|v| v != "false").unwrap_or(true)
    };

    Ok(DiffToolConfig { tool, cmd, prompt })
}

/// Set the diff tool configuration
#[command]
pub async fn set_diff_tool(
    path: String,
    tool: String,
    cmd: Option<String>,
    global: Option<bool>,
) -> Result<()> {
    let repo_path = if global.unwrap_or(false) {
        None
    } else {
        Some(Path::new(&path))
    };

    let scope = if global.unwrap_or(false) {
        "--global"
    } else {
        "--local"
    };

    run_git_config(repo_path, &[scope, "diff.tool", &tool])?;

    if let Some(ref command) = cmd {
        let key = format!("difftool.{}.cmd", tool);
        run_git_config(repo_path, &[scope, &key, command])?;
    }

    Ok(())
}

/// List available diff tools with their availability status
#[command]
pub async fn list_diff_tools(_path: String) -> Result<Vec<AvailableDiffTool>> {
    let tools = vec![
        ("vscode", "code --wait --diff $LOCAL $REMOTE"),
        ("meld", "meld $LOCAL $REMOTE"),
        ("kdiff3", "kdiff3 $LOCAL $REMOTE"),
        ("beyond", "bcomp $LOCAL $REMOTE"),
        ("bc", "bcomp $LOCAL $REMOTE"),
        ("bc3", "bcomp $LOCAL $REMOTE"),
        ("vimdiff", "vimdiff $LOCAL $REMOTE"),
        ("nvim", "nvim -d $LOCAL $REMOTE"),
        ("opendiff", "opendiff $LOCAL $REMOTE"),
        ("p4merge", "p4merge $LOCAL $REMOTE"),
        ("winmerge", "WinMergeU $LOCAL $REMOTE"),
        ("tkdiff", "tkdiff $LOCAL $REMOTE"),
        ("diffuse", "diffuse $LOCAL $REMOTE"),
        ("kompare", "kompare $LOCAL $REMOTE"),
        ("sublime", "smerge mergetool $LOCAL $REMOTE -o $MERGED"),
        ("smerge", "smerge mergetool $LOCAL $REMOTE -o $MERGED"),
    ];

    // Map of tool name to executable to check
    let executables: std::collections::HashMap<&str, &str> = [
        ("vscode", "code"),
        ("meld", "meld"),
        ("kdiff3", "kdiff3"),
        ("beyond", "bcomp"),
        ("bc", "bcomp"),
        ("bc3", "bcomp"),
        ("vimdiff", "vimdiff"),
        ("nvim", "nvim"),
        ("opendiff", "opendiff"),
        ("p4merge", "p4merge"),
        ("winmerge", "WinMergeU"),
        ("tkdiff", "tkdiff"),
        ("diffuse", "diffuse"),
        ("kompare", "kompare"),
        ("sublime", "smerge"),
        ("smerge", "smerge"),
    ]
    .into_iter()
    .collect();

    let result: Vec<AvailableDiffTool> = tools
        .into_iter()
        .map(|(name, command)| {
            let executable = executables.get(name).unwrap_or(&name);
            let available = is_command_available(executable);
            AvailableDiffTool {
                name: name.to_string(),
                command: command.to_string(),
                available,
            }
        })
        .collect();

    Ok(result)
}

/// Launch the configured diff tool for a specific file
#[command]
pub async fn launch_diff_tool(
    path: String,
    file_path: String,
    staged: Option<bool>,
    commit: Option<String>,
) -> Result<DiffToolResult> {
    let repo_path = Path::new(&path);

    // First, get the configured diff tool name
    let tool_name = run_git_config(Some(repo_path), &["--get", "diff.tool"])
        .ok()
        .filter(|s| !s.is_empty());

    let mut cmd = create_command("git");
    cmd.current_dir(repo_path);
    cmd.arg("difftool");
    cmd.arg("--no-prompt");

    if let Some(ref name) = tool_name {
        cmd.arg(format!("--tool={}", name));
    }

    // Determine what to diff
    if let Some(ref commit_oid) = commit {
        // Diff against a specific commit
        cmd.arg(commit_oid);
    } else if staged.unwrap_or(false) {
        // Diff staged changes (index vs HEAD)
        cmd.arg("--staged");
    }
    // else: diff working directory vs index (default)

    cmd.arg("--");
    cmd.arg(&file_path);

    let output = cmd.output().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to launch diff tool: {}", e))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(DiffToolResult {
            success: true,
            message: if stdout.is_empty() {
                "Diff tool completed successfully".to_string()
            } else {
                stdout
            },
        })
    } else {
        Ok(DiffToolResult {
            success: false,
            message: if stderr.is_empty() { stdout } else { stderr },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_diff_tool_default() {
        let repo = TestRepo::with_initial_commit();
        let result = get_diff_tool(repo.path_str(), None).await;
        assert!(result.is_ok());
        let config = result.unwrap();
        // Fresh repo should not have a diff tool configured
        assert!(config.tool.is_none());
        assert!(config.cmd.is_none());
        // Prompt defaults to true
        assert!(config.prompt);
    }

    #[tokio::test]
    async fn test_set_and_get_diff_tool() {
        let repo = TestRepo::with_initial_commit();

        let result = set_diff_tool(repo.path_str(), "vscode".to_string(), None, None).await;
        assert!(result.is_ok());

        let config = get_diff_tool(repo.path_str(), None).await.unwrap();
        assert_eq!(config.tool.as_deref(), Some("vscode"));
    }

    #[tokio::test]
    async fn test_set_diff_tool_with_custom_cmd() {
        let repo = TestRepo::with_initial_commit();

        let result = set_diff_tool(
            repo.path_str(),
            "custom".to_string(),
            Some("my-diff-tool $LOCAL $REMOTE".to_string()),
            None,
        )
        .await;
        assert!(result.is_ok());

        let config = get_diff_tool(repo.path_str(), None).await.unwrap();
        assert_eq!(config.tool.as_deref(), Some("custom"));
        assert_eq!(config.cmd.as_deref(), Some("my-diff-tool $LOCAL $REMOTE"));
    }

    #[tokio::test]
    async fn test_list_diff_tools() {
        let repo = TestRepo::with_initial_commit();
        let result = list_diff_tools(repo.path_str()).await;
        assert!(result.is_ok());
        let tools = result.unwrap();
        assert!(!tools.is_empty());
        // Check that common tools are in the list
        assert!(tools.iter().any(|t| t.name == "vscode"));
        assert!(tools.iter().any(|t| t.name == "meld"));
        assert!(tools.iter().any(|t| t.name == "kdiff3"));
        assert!(tools.iter().any(|t| t.name == "beyond"));
    }

    #[tokio::test]
    async fn test_launch_diff_tool_no_tool_configured() {
        let repo = TestRepo::with_initial_commit();

        // Create a modified file
        repo.create_file("test.txt", "initial content");
        repo.stage_file("test.txt");
        repo.create_commit("Add test file", &[]);
        repo.create_file("test.txt", "modified content");

        // Launch diff tool without configuration
        // This may fail or use default tool depending on system
        let result = launch_diff_tool(repo.path_str(), "test.txt".to_string(), None, None).await;
        // We're just testing that the function runs without panic
        // The actual success depends on whether a diff tool is available
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_launch_diff_tool_nonexistent_file() {
        let repo = TestRepo::with_initial_commit();

        // Try to launch diff tool for a non-existent file
        let result =
            launch_diff_tool(repo.path_str(), "nonexistent.txt".to_string(), None, None).await;
        // Git difftool should handle this gracefully
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_diff_tool_global() {
        let repo = TestRepo::with_initial_commit();
        // Just verify it doesn't error - global config may or may not have a tool
        let result = get_diff_tool(repo.path_str(), Some(true)).await;
        assert!(result.is_ok());
    }
}
