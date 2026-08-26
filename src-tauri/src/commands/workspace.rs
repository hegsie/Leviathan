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
                is_detached: false,
                ahead: 0,
                behind: 0,
            });
            continue;
        }

        match Repository::open(repo_path) {
            Ok(repo) => {
                let (current_branch, is_detached) = head_branch(&repo);

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
                    is_detached,
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
                    is_detached: false,
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

/// The checked-out branch name, plus whether HEAD is detached.
///
/// `shorthand()` returns the literal "HEAD" on a detached HEAD, which the
/// workspace dialog then rendered as if it were a branch called "HEAD". An
/// unborn HEAD has no branch yet and is not detached either.
fn head_branch(repo: &Repository) -> (Option<String>, bool) {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return (None, false),
    };

    if !head.is_branch() {
        return (None, true);
    }

    (head.shorthand().ok().map(String::from), false)
}

/// Compute ahead/behind counts for HEAD relative to its configured upstream
/// tracking branch
fn compute_ahead_behind(repo: &Repository) -> (usize, usize) {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return (0, 0),
    };

    // A detached HEAD is not a branch, so it has no upstream to compare
    // against. shorthand() is the literal "HEAD" when detached, which used to
    // resolve refs/remotes/origin/HEAD — the remote's default-branch pointer —
    // and count the checked-out commit against it.
    if !head.is_branch() {
        return (0, 0);
    }

    let local_oid = match head.target() {
        Some(oid) => oid,
        None => return (0, 0),
    };

    let branch_name = match head.shorthand() {
        Ok(name) => name,
        Err(_) => return (0, 0),
    };

    // Follow the branch's own upstream (branch.<name>.remote/merge) rather than
    // assuming origin/<branch>. A fork tracking upstream/main, a clone whose
    // remote is not called "origin", and a branch tracking a differently named
    // remote branch each counted against the wrong ref or reported nothing —
    // and disagreed with the branches panel for the same repository, which has
    // always used the configured upstream. A branch with no upstream has
    // nothing to report, which is not a failure.
    let upstream = match repo
        .find_branch(branch_name, git2::BranchType::Local)
        .and_then(|b| b.upstream())
    {
        Ok(u) => u,
        Err(_) => return (0, 0),
    };

    let upstream_oid = match upstream.get().target() {
        Some(oid) => oid,
        None => return (0, 0),
    };

    repo.graph_ahead_behind(local_oid, upstream_oid)
        .unwrap_or((0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    /// Commit on top of `parent` without moving any ref — stands in for
    /// commits that only exist on the remote-tracking side.
    fn dangling_commit(repo: &Repository, parent: git2::Oid, message: &str) -> git2::Oid {
        let parent_commit = repo.find_commit(parent).expect("parent commit");
        let tree = parent_commit.tree().expect("parent tree");
        let sig = repo.signature().expect("signature");
        repo.commit(None, &sig, &sig, message, &tree, &[&parent_commit])
            .expect("commit")
    }

    fn set_remote_ref(repo: &Repository, refname: &str, oid: git2::Oid) {
        repo.reference(refname, oid, true, "test").expect("ref");
    }

    /// Fork workflow: `origin` is your stale fork, the branch tracks
    /// `upstream/main`. Counting against origin/<branch> reported "in sync"
    /// for a branch that is two commits ahead of what it actually tracks.
    #[test]
    fn test_ahead_behind_follows_the_configured_upstream_not_origin() {
        let test_repo = TestRepo::with_initial_commit();
        let base = test_repo.head_oid();
        test_repo.create_commit("Local 1", &[("a.txt", "a")]);
        test_repo.create_commit("Local 2", &[("b.txt", "b")]);
        let local_tip = test_repo.head_oid();

        let repo = test_repo.repo();
        let branch = test_repo.current_branch();
        repo.remote("origin", "https://example.com/fork.git")
            .unwrap();
        repo.remote("upstream", "https://example.com/canonical.git")
            .unwrap();

        // The fork is up to date with the local branch; the real upstream is not.
        set_remote_ref(&repo, &format!("refs/remotes/origin/{}", branch), local_tip);
        set_remote_ref(&repo, &format!("refs/remotes/upstream/{}", branch), base);

        repo.find_branch(&branch, git2::BranchType::Local)
            .unwrap()
            .set_upstream(Some(&format!("upstream/{}", branch)))
            .unwrap();

        assert_eq!(compute_ahead_behind(&repo), (2, 0));
    }

    /// `git clone -o github` (or a renamed remote): there is no
    /// refs/remotes/origin/* at all, so a hard-coded origin lookup reported
    /// 0/0 while git reported divergence in both directions.
    #[test]
    fn test_ahead_behind_reports_divergence_when_the_remote_is_not_named_origin() {
        let test_repo = TestRepo::with_initial_commit();
        let base = test_repo.head_oid();
        test_repo.create_commit("Local 1", &[("a.txt", "a")]);

        let repo = test_repo.repo();
        let branch = test_repo.current_branch();
        repo.remote("github", "https://example.com/repo.git")
            .unwrap();
        assert!(repo.find_remote("origin").is_err(), "origin must not exist");

        let remote_1 = dangling_commit(&repo, base, "Remote 1");
        let remote_2 = dangling_commit(&repo, remote_1, "Remote 2");
        set_remote_ref(&repo, &format!("refs/remotes/github/{}", branch), remote_2);

        repo.find_branch(&branch, git2::BranchType::Local)
            .unwrap()
            .set_upstream(Some(&format!("github/{}", branch)))
            .unwrap();

        assert_eq!(compute_ahead_behind(&repo), (1, 2));
    }

    /// A branch with no upstream has nothing to report, even when a
    /// same-named remote-tracking ref happens to exist — git prints no
    /// ahead/behind for it, so neither should the workspace dialog.
    #[test]
    fn test_ahead_behind_is_zero_for_a_branch_with_no_upstream() {
        let test_repo = TestRepo::with_initial_commit();
        let base = test_repo.head_oid();
        // Creates refs/remotes/origin/<branch> only — no branch.<name>.merge.
        test_repo.create_remote_branch(&test_repo.current_branch(), base);
        test_repo.create_commit("Local 1", &[("a.txt", "a")]);
        test_repo.create_commit("Local 2", &[("b.txt", "b")]);

        let repo = test_repo.repo();
        let branch = test_repo.current_branch();
        assert!(
            repo.find_branch(&branch, git2::BranchType::Local)
                .unwrap()
                .upstream()
                .is_err(),
            "branch must have no configured upstream"
        );

        assert_eq!(compute_ahead_behind(&repo), (0, 0));
    }

    /// Detached HEAD: shorthand() is the literal "HEAD", which used to resolve
    /// refs/remotes/origin/HEAD. In a mirror-style clone that ref is a DIRECT
    /// ref to the remote's default branch, so the checked-out commit was
    /// counted against it.
    #[test]
    fn test_ahead_behind_on_a_detached_head_ignores_the_remote_head_pointer() {
        let test_repo = TestRepo::with_initial_commit();
        let base = test_repo.head_oid();
        test_repo.create_commit("Local 1", &[("a.txt", "a")]);
        test_repo.create_commit("Local 2", &[("b.txt", "b")]);
        let local_tip = test_repo.head_oid();

        let repo = test_repo.repo();
        set_remote_ref(&repo, "refs/remotes/origin/HEAD", base);
        repo.set_head_detached(local_tip).unwrap();
        assert!(
            !repo.head().unwrap().is_branch(),
            "HEAD must be detached for this test"
        );

        assert_eq!(compute_ahead_behind(&repo), (0, 0));
    }

    /// A detached HEAD is not a branch called "HEAD" — the dialog must not
    /// print one.
    #[test]
    fn test_head_branch_reports_a_detached_head_as_no_branch() {
        let test_repo = TestRepo::with_initial_commit();
        let repo = test_repo.repo();
        repo.set_head_detached(test_repo.head_oid()).unwrap();

        assert_eq!(head_branch(&repo), (None, true));
    }

    /// Guard against over-correcting: a checked-out branch still reports its
    /// name, and a fresh repository with an unborn HEAD is not "detached".
    #[test]
    fn test_head_branch_reports_the_checked_out_branch() {
        let test_repo = TestRepo::with_initial_commit();
        assert_eq!(
            head_branch(&test_repo.repo()),
            (Some(test_repo.current_branch()), false)
        );

        let empty = TestRepo::new();
        assert_eq!(head_branch(&empty.repo()), (None, false));
    }

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
