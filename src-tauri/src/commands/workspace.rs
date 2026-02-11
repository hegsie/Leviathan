//! Workspace command handlers
//! Manage multi-repository workspaces

use std::fs;
use std::path::Path;
use std::process::Command;

use chrono::Utc;
use git2::Repository;
use tauri::command;
use uuid::Uuid;

use crate::commands::search::find_match_position;
use crate::error::{LeviathanError, Result};
use crate::models::{Workspace, WorkspaceRepoStatus, WorkspaceRepository, WorkspacesConfig};

/// A single search match across workspace repositories
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    pub repo_name: String,
    pub repo_path: String,
    pub file_path: String,
    pub line_number: u32,
    pub line_content: String,
    pub match_start: u32,
    pub match_end: u32,
}

/// Get the path to the workspaces config file
fn get_workspaces_path() -> Result<std::path::PathBuf> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        LeviathanError::OperationFailed("Could not find config directory".to_string())
    })?;

    let app_config_dir = config_dir.join("leviathan");

    if !app_config_dir.exists() {
        fs::create_dir_all(&app_config_dir).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to create config directory: {}", e))
        })?;
    }

    Ok(app_config_dir.join("workspaces.json"))
}

/// Load workspaces config from disk
fn load_workspaces_config() -> Result<WorkspacesConfig> {
    let path = get_workspaces_path()?;

    if !path.exists() {
        return Ok(WorkspacesConfig::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to read workspaces: {}", e))
    })?;

    let config: WorkspacesConfig = serde_json::from_str(&content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse workspaces: {}", e))
    })?;

    Ok(config)
}

/// Save workspaces config to disk
fn save_workspaces_config(config: &WorkspacesConfig) -> Result<()> {
    let path = get_workspaces_path()?;

    let content = serde_json::to_string_pretty(config).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to serialize workspaces: {}", e))
    })?;

    fs::write(&path, content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to write workspaces: {}", e))
    })?;

    Ok(())
}

/// Get all workspaces
#[command]
pub async fn get_workspaces() -> Result<Vec<Workspace>> {
    let config = load_workspaces_config()?;
    Ok(config.workspaces)
}

/// Get a single workspace by ID
#[command]
pub async fn get_workspace(workspace_id: String) -> Result<Workspace> {
    let config = load_workspaces_config()?;
    config
        .workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Workspace not found".to_string()))
}

/// Save a workspace (create or update)
/// If the id is empty, a new UUID is generated.
#[command]
pub async fn save_workspace(mut workspace: Workspace) -> Result<Workspace> {
    let mut config = load_workspaces_config()?;

    if workspace.id.is_empty() {
        workspace.id = Uuid::new_v4().to_string();
        workspace.created_at = Utc::now();
        config.workspaces.push(workspace.clone());
    } else if let Some(idx) = config.workspaces.iter().position(|w| w.id == workspace.id) {
        config.workspaces[idx] = workspace.clone();
    } else {
        config.workspaces.push(workspace.clone());
    }

    save_workspaces_config(&config)?;
    Ok(workspace)
}

/// Delete a workspace by ID
#[command]
pub async fn delete_workspace(workspace_id: String) -> Result<()> {
    let mut config = load_workspaces_config()?;
    config.workspaces.retain(|w| w.id != workspace_id);
    save_workspaces_config(&config)?;
    Ok(())
}

/// Add a repository to a workspace
#[command]
pub async fn add_repository_to_workspace(
    workspace_id: String,
    path: String,
    name: String,
) -> Result<Workspace> {
    let mut config = load_workspaces_config()?;

    let workspace = config
        .workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Workspace not found".to_string()))?;

    // Don't add duplicates
    if !workspace.repositories.iter().any(|r| r.path == path) {
        workspace
            .repositories
            .push(WorkspaceRepository { path, name });
    }

    let result = workspace.clone();
    save_workspaces_config(&config)?;
    Ok(result)
}

/// Remove a repository from a workspace
#[command]
pub async fn remove_repository_from_workspace(
    workspace_id: String,
    path: String,
) -> Result<Workspace> {
    let mut config = load_workspaces_config()?;

    let workspace = config
        .workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Workspace not found".to_string()))?;

    workspace.repositories.retain(|r| r.path != path);

    let result = workspace.clone();
    save_workspaces_config(&config)?;
    Ok(result)
}

/// Update the last_opened timestamp for a workspace
#[command]
pub async fn update_workspace_last_opened(workspace_id: String) -> Result<()> {
    let mut config = load_workspaces_config()?;

    if let Some(workspace) = config.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        workspace.last_opened = Some(Utc::now());
        save_workspaces_config(&config)?;
    }

    Ok(())
}

/// Validate all repositories in a workspace, returning status for each
#[command]
pub async fn validate_workspace_repositories(
    workspace_id: String,
) -> Result<Vec<WorkspaceRepoStatus>> {
    let config = load_workspaces_config()?;

    let workspace = config
        .workspaces
        .iter()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Workspace not found".to_string()))?;

    let mut statuses = Vec::new();

    for repo_entry in &workspace.repositories {
        let repo_path = Path::new(&repo_entry.path);
        let exists = repo_path.exists();

        if !exists {
            statuses.push(WorkspaceRepoStatus {
                path: repo_entry.path.clone(),
                name: repo_entry.name.clone(),
                exists: false,
                is_valid_repo: false,
                changed_files_count: 0,
                current_branch: None,
                ahead: 0,
                behind: 0,
            });
            continue;
        }

        match Repository::open(repo_path) {
            Ok(repo) => {
                let current_branch = repo
                    .head()
                    .ok()
                    .and_then(|head| head.shorthand().map(String::from));

                let changed_files_count = repo
                    .statuses(Some(
                        git2::StatusOptions::new()
                            .include_untracked(true)
                            .recurse_untracked_dirs(false),
                    ))
                    .map(|statuses| statuses.len())
                    .unwrap_or(0);

                // Compute ahead/behind relative to upstream
                let (ahead, behind) = compute_ahead_behind(&repo);

                statuses.push(WorkspaceRepoStatus {
                    path: repo_entry.path.clone(),
                    name: repo_entry.name.clone(),
                    exists: true,
                    is_valid_repo: true,
                    changed_files_count,
                    current_branch,
                    ahead,
                    behind,
                });
            }
            Err(_) => {
                statuses.push(WorkspaceRepoStatus {
                    path: repo_entry.path.clone(),
                    name: repo_entry.name.clone(),
                    exists: true,
                    is_valid_repo: false,
                    changed_files_count: 0,
                    current_branch: None,
                    ahead: 0,
                    behind: 0,
                });
            }
        }
    }

    Ok(statuses)
}

/// Search across all repositories in a workspace using git grep
#[command]
pub async fn search_workspace(
    workspace_id: String,
    query: String,
    case_sensitive: Option<bool>,
    regex: Option<bool>,
    file_pattern: Option<String>,
    max_results: Option<u32>,
) -> Result<Vec<WorkspaceSearchResult>> {
    let config = load_workspaces_config()?;
    let workspace = config
        .workspaces
        .iter()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Workspace not found".to_string()))?;

    let case_sensitive = case_sensitive.unwrap_or(false);
    let use_regex = regex.unwrap_or(false);
    let max_results = max_results.unwrap_or(500);
    let mut results: Vec<WorkspaceSearchResult> = Vec::new();

    for repo_entry in &workspace.repositories {
        if results.len() as u32 >= max_results {
            break;
        }

        let repo_path = Path::new(&repo_entry.path);
        if !repo_path.exists() {
            continue;
        }

        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&repo_entry.path).arg("grep").arg("-n");

        if !case_sensitive {
            cmd.arg("-i");
        }

        if use_regex {
            cmd.arg("-E");
        }

        cmd.arg("--").arg(&query);

        if let Some(ref pattern) = file_pattern {
            cmd.arg(pattern);
        }

        let output = match cmd.output() {
            Ok(o) => o,
            Err(_) => continue,
        };

        // git grep returns exit code 1 when no matches found (not an error)
        if !output.status.success() && output.status.code() != Some(1) {
            continue;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        for line in stdout.lines() {
            if results.len() as u32 >= max_results {
                break;
            }

            let parts: Vec<&str> = line.splitn(3, ':').collect();
            if parts.len() < 3 {
                continue;
            }

            let file_path = parts[0].to_string();
            let line_number: u32 = match parts[1].parse() {
                Ok(n) => n,
                Err(_) => continue,
            };
            let line_content = parts[2].to_string();

            let (match_start, match_end) =
                find_match_position(&line_content, &query, case_sensitive);

            results.push(WorkspaceSearchResult {
                repo_name: repo_entry.name.clone(),
                repo_path: repo_entry.path.clone(),
                file_path,
                line_number,
                line_content,
                match_start,
                match_end,
            });
        }
    }

    Ok(results)
}

/// Export a workspace configuration as a JSON string
#[command]
pub async fn export_workspace(workspace_id: String) -> Result<String> {
    let config = load_workspaces_config()?;
    let workspace = config
        .workspaces
        .iter()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Workspace not found".to_string()))?;

    let json = serde_json::to_string_pretty(workspace).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to serialize workspace: {}", e))
    })?;

    Ok(json)
}

/// Import a workspace from a JSON string
#[command]
pub async fn import_workspace(json_data: String) -> Result<Workspace> {
    let mut workspace: Workspace = serde_json::from_str(&json_data).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse workspace JSON: {}", e))
    })?;

    // Generate a new ID and creation timestamp
    workspace.id = Uuid::new_v4().to_string();
    workspace.created_at = Utc::now();
    workspace.last_opened = None;

    let mut config = load_workspaces_config()?;
    config.workspaces.push(workspace.clone());
    save_workspaces_config(&config)?;

    Ok(workspace)
}

/// Compute ahead/behind counts for HEAD relative to its upstream tracking branch
fn compute_ahead_behind(repo: &Repository) -> (usize, usize) {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return (0, 0),
    };

    let local_oid = match head.target() {
        Some(oid) => oid,
        None => return (0, 0),
    };

    let branch_name = match head.shorthand() {
        Some(name) => name.to_string(),
        None => return (0, 0),
    };

    let upstream_name = format!("refs/remotes/origin/{}", branch_name);
    let upstream_ref = match repo.find_reference(&upstream_name) {
        Ok(r) => r,
        Err(_) => return (0, 0),
    };

    let upstream_oid = match upstream_ref.target() {
        Some(oid) => oid,
        None => return (0, 0),
    };

    repo.graph_ahead_behind(local_oid, upstream_oid)
        .unwrap_or((0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_default_config() {
        // When no file exists, should return default
        let config = WorkspacesConfig::default();
        assert!(config.workspaces.is_empty());
    }

    #[test]
    fn test_config_serialization_roundtrip() {
        let config = WorkspacesConfig {
            workspaces: vec![Workspace {
                id: "ws-1".to_string(),
                name: "Test Workspace".to_string(),
                description: "Description".to_string(),
                color: "#81c784".to_string(),
                repositories: vec![
                    WorkspaceRepository {
                        path: "/path/to/repo1".to_string(),
                        name: "repo1".to_string(),
                    },
                    WorkspaceRepository {
                        path: "/path/to/repo2".to_string(),
                        name: "repo2".to_string(),
                    },
                ],
                created_at: Utc::now(),
                last_opened: None,
            }],
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let deserialized: WorkspacesConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.workspaces.len(), 1);
        assert_eq!(deserialized.workspaces[0].id, "ws-1");
        assert_eq!(deserialized.workspaces[0].repositories.len(), 2);
    }
}
