//! Custom Actions command handlers
//! Allow users to define and run custom scripts/commands from the UI

use std::path::Path;
use std::process::Command;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// A user-defined custom action
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomAction {
    pub id: String,
    pub name: String,
    pub command: String,
    pub arguments: Option<String>,
    pub working_directory: Option<String>,
    pub shortcut: Option<String>,
    pub show_in_toolbar: bool,
    pub open_in_terminal: bool,
    pub confirm_before_run: bool,
}

/// Result of executing a custom action
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

/// Path to the custom actions config file within the repo
fn actions_file_path(repo_path: &Path) -> std::path::PathBuf {
    repo_path
        .join(".git")
        .join("leviathan")
        .join("custom_actions.json")
}

/// Read custom actions from disk
fn read_actions(repo_path: &Path) -> Result<Vec<CustomAction>> {
    let file_path = actions_file_path(repo_path);
    if !file_path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&file_path)?;
    let actions: Vec<CustomAction> = serde_json::from_str(&content)?;
    Ok(actions)
}

/// Write custom actions to disk
fn write_actions(repo_path: &Path, actions: &[CustomAction]) -> Result<()> {
    let file_path = actions_file_path(repo_path);
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(actions)?;
    std::fs::write(&file_path, content)?;
    Ok(())
}

/// Get the current branch name for variable substitution
fn get_current_branch(repo_path: &Path) -> String {
    let repo = match git2::Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return String::new(),
    };
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return String::new(),
    };
    head.shorthand().unwrap_or("").to_string()
}

/// Replace template variables in a string
fn substitute_variables(input: &str, repo_path: &str, branch: &str) -> String {
    input.replace("$REPO", repo_path).replace("$BRANCH", branch)
}

/// Get all custom actions for a repository
#[command]
pub async fn get_custom_actions(path: String) -> Result<Vec<CustomAction>> {
    let repo_path = Path::new(&path);
    if !repo_path.join(".git").exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }
    read_actions(repo_path)
}

/// Save or update a custom action
#[command]
pub async fn save_custom_action(path: String, action: CustomAction) -> Result<Vec<CustomAction>> {
    let repo_path = Path::new(&path);
    if !repo_path.join(".git").exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    let mut actions = read_actions(repo_path)?;

    // Update existing or add new
    if let Some(existing) = actions.iter_mut().find(|a| a.id == action.id) {
        *existing = action;
    } else {
        actions.push(action);
    }

    write_actions(repo_path, &actions)?;
    Ok(actions)
}

/// Delete a custom action by ID
#[command]
pub async fn delete_custom_action(path: String, action_id: String) -> Result<Vec<CustomAction>> {
    let repo_path = Path::new(&path);
    if !repo_path.join(".git").exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    let mut actions = read_actions(repo_path)?;
    actions.retain(|a| a.id != action_id);
    write_actions(repo_path, &actions)?;
    Ok(actions)
}

/// Execute a custom action
#[command]
pub async fn run_custom_action(path: String, action_id: String) -> Result<ActionResult> {
    let repo_path = Path::new(&path);
    if !repo_path.join(".git").exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    let actions = read_actions(repo_path)?;
    let action = actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| LeviathanError::OperationFailed(format!("Action not found: {}", action_id)))?
        .clone();

    let branch = get_current_branch(repo_path);
    let command_str = substitute_variables(&action.command, &path, &branch);
    let arguments_str = action
        .arguments
        .as_deref()
        .map(|args| substitute_variables(args, &path, &branch))
        .unwrap_or_default();

    // Determine working directory
    let working_dir = match action.working_directory.as_deref() {
        Some("repo_root") | None => path.clone(),
        Some(custom_path) => substitute_variables(custom_path, &path, &branch),
    };

    // Build the command
    let output = if cfg!(target_os = "windows") {
        let mut full_command = command_str.clone();
        if !arguments_str.is_empty() {
            full_command.push(' ');
            full_command.push_str(&arguments_str);
        }
        Command::new("cmd")
            .args(["/C", &full_command])
            .current_dir(&working_dir)
            .output()
    } else {
        let mut full_command = command_str.clone();
        if !arguments_str.is_empty() {
            full_command.push(' ');
            full_command.push_str(&arguments_str);
        }
        Command::new("sh")
            .args(["-c", &full_command])
            .current_dir(&working_dir)
            .output()
    };

    match output {
        Ok(output) => {
            let exit_code = output.status.code().unwrap_or(-1);
            Ok(ActionResult {
                exit_code,
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                success: output.status.success(),
            })
        }
        Err(e) => Err(LeviathanError::OperationFailed(format!(
            "Failed to execute command: {}",
            e
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    fn make_action(id: &str, name: &str, command: &str) -> CustomAction {
        CustomAction {
            id: id.to_string(),
            name: name.to_string(),
            command: command.to_string(),
            arguments: None,
            working_directory: None,
            shortcut: None,
            show_in_toolbar: false,
            open_in_terminal: false,
            confirm_before_run: false,
        }
    }

    #[tokio::test]
    async fn test_get_custom_actions_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_custom_actions(repo.path_str()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_save_custom_action() {
        let repo = TestRepo::with_initial_commit();
        let action = make_action("1", "Build", "cargo build");

        let result = save_custom_action(repo.path_str(), action).await;
        assert!(result.is_ok());
        let actions = result.unwrap();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].name, "Build");
        assert_eq!(actions[0].command, "cargo build");
    }

    #[tokio::test]
    async fn test_save_custom_action_update() {
        let repo = TestRepo::with_initial_commit();
        let action1 = make_action("1", "Build", "cargo build");
        save_custom_action(repo.path_str(), action1).await.unwrap();

        let action_updated = make_action("1", "Build Release", "cargo build --release");
        let result = save_custom_action(repo.path_str(), action_updated).await;
        assert!(result.is_ok());
        let actions = result.unwrap();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].name, "Build Release");
        assert_eq!(actions[0].command, "cargo build --release");
    }

    #[tokio::test]
    async fn test_save_multiple_actions() {
        let repo = TestRepo::with_initial_commit();
        save_custom_action(repo.path_str(), make_action("1", "Build", "cargo build"))
            .await
            .unwrap();
        let result =
            save_custom_action(repo.path_str(), make_action("2", "Test", "cargo test")).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_delete_custom_action() {
        let repo = TestRepo::with_initial_commit();
        save_custom_action(repo.path_str(), make_action("1", "Build", "cargo build"))
            .await
            .unwrap();
        save_custom_action(repo.path_str(), make_action("2", "Test", "cargo test"))
            .await
            .unwrap();

        let result = delete_custom_action(repo.path_str(), "1".to_string()).await;
        assert!(result.is_ok());
        let actions = result.unwrap();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].id, "2");
    }

    #[tokio::test]
    async fn test_delete_nonexistent_action() {
        let repo = TestRepo::with_initial_commit();
        let result = delete_custom_action(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_run_custom_action() {
        let repo = TestRepo::with_initial_commit();
        let action = if cfg!(target_os = "windows") {
            make_action("1", "Echo", "echo hello")
        } else {
            make_action("1", "Echo", "echo hello")
        };
        save_custom_action(repo.path_str(), action).await.unwrap();

        let result = run_custom_action(repo.path_str(), "1".to_string()).await;
        assert!(result.is_ok());
        let action_result = result.unwrap();
        assert!(action_result.success);
        assert_eq!(action_result.exit_code, 0);
        assert!(action_result.stdout.contains("hello"));
    }

    #[tokio::test]
    async fn test_run_custom_action_with_arguments() {
        let repo = TestRepo::with_initial_commit();
        let mut action = make_action("1", "Echo Args", "echo");
        action.arguments = Some("hello world".to_string());
        save_custom_action(repo.path_str(), action).await.unwrap();

        let result = run_custom_action(repo.path_str(), "1".to_string()).await;
        assert!(result.is_ok());
        let action_result = result.unwrap();
        assert!(action_result.success);
        assert!(action_result.stdout.contains("hello world"));
    }

    #[tokio::test]
    async fn test_run_custom_action_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = run_custom_action(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_run_custom_action_variable_substitution() {
        let repo = TestRepo::with_initial_commit();
        let mut action = make_action("1", "Show Repo", "echo $REPO");
        action.arguments = Some("$BRANCH".to_string());
        save_custom_action(repo.path_str(), action).await.unwrap();

        let result = run_custom_action(repo.path_str(), "1".to_string()).await;
        assert!(result.is_ok());
        let action_result = result.unwrap();
        assert!(action_result.success);
        // The repo path should appear in the output
        assert!(!action_result.stdout.contains("$REPO"));
    }

    #[tokio::test]
    async fn test_run_custom_action_failing_command() {
        let repo = TestRepo::with_initial_commit();
        let action = if cfg!(target_os = "windows") {
            make_action("1", "Fail", "exit /b 1")
        } else {
            make_action("1", "Fail", "exit 1")
        };
        save_custom_action(repo.path_str(), action).await.unwrap();

        let result = run_custom_action(repo.path_str(), "1".to_string()).await;
        assert!(result.is_ok());
        let action_result = result.unwrap();
        assert!(!action_result.success);
        assert_eq!(action_result.exit_code, 1);
    }

    #[test]
    fn test_substitute_variables() {
        let result = substitute_variables("echo $REPO on $BRANCH", "/my/repo", "main");
        assert_eq!(result, "echo /my/repo on main");
    }

    #[test]
    fn test_substitute_variables_no_placeholders() {
        let result = substitute_variables("echo hello", "/my/repo", "main");
        assert_eq!(result, "echo hello");
    }

    #[tokio::test]
    async fn test_get_custom_actions_invalid_repo() {
        let result = get_custom_actions("/nonexistent/path".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_custom_action_persists() {
        let repo = TestRepo::with_initial_commit();
        save_custom_action(repo.path_str(), make_action("1", "Build", "cargo build"))
            .await
            .unwrap();

        // Read again to verify persistence
        let result = get_custom_actions(repo.path_str()).await;
        assert!(result.is_ok());
        let actions = result.unwrap();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].id, "1");
    }

    #[tokio::test]
    async fn test_custom_action_with_working_directory() {
        let repo = TestRepo::with_initial_commit();
        let mut action = make_action("1", "Echo", "echo hello");
        action.working_directory = Some("repo_root".to_string());
        save_custom_action(repo.path_str(), action).await.unwrap();

        let result = run_custom_action(repo.path_str(), "1".to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }
}
