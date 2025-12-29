//! Worktree command handlers
//! Manage git worktrees for working on multiple branches simultaneously

use std::path::Path;
use std::process::Command;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Information about a worktree
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// Absolute path to the worktree
    pub path: String,
    /// HEAD commit of the worktree
    pub head_oid: Option<String>,
    /// Branch checked out in this worktree (if any)
    pub branch: Option<String>,
    /// Whether this is the main worktree
    pub is_main: bool,
    /// Whether the worktree is locked
    pub is_locked: bool,
    /// Lock reason (if locked)
    pub lock_reason: Option<String>,
    /// Whether this worktree is bare (detached HEAD)
    pub is_bare: bool,
    /// Whether this worktree is prunable (stale)
    pub is_prunable: bool,
}

/// Helper to run git commands
fn run_git_command(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        // Prevent credential popup dialogs on Windows
        .env("GIT_TERMINAL_PROMPT", "0")
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

/// Get list of all worktrees
#[command]
pub async fn get_worktrees(path: String) -> Result<Vec<Worktree>> {
    let repo_path = Path::new(&path);

    // Use porcelain format for stable parsing
    let output = run_git_command(repo_path, &["worktree", "list", "--porcelain"])?;

    let mut worktrees = Vec::new();
    let mut current_worktree: Option<Worktree> = None;

    for line in output.lines() {
        if line.starts_with("worktree ") {
            // Save previous worktree if exists
            if let Some(wt) = current_worktree.take() {
                worktrees.push(wt);
            }

            // Start new worktree
            let wt_path = line.strip_prefix("worktree ").unwrap_or("").to_string();
            current_worktree = Some(Worktree {
                path: wt_path,
                head_oid: None,
                branch: None,
                is_main: false,
                is_locked: false,
                lock_reason: None,
                is_bare: false,
                is_prunable: false,
            });
        } else if let Some(ref mut wt) = current_worktree {
            if line.starts_with("HEAD ") {
                wt.head_oid = Some(line.strip_prefix("HEAD ").unwrap_or("").to_string());
            } else if line.starts_with("branch ") {
                let branch_ref = line.strip_prefix("branch ").unwrap_or("");
                // Convert refs/heads/main to main
                wt.branch = Some(
                    branch_ref
                        .strip_prefix("refs/heads/")
                        .unwrap_or(branch_ref)
                        .to_string(),
                );
            } else if line == "bare" {
                wt.is_bare = true;
            } else if line == "detached" {
                // Detached HEAD, no branch
            } else if line == "locked" {
                wt.is_locked = true;
            } else if line.starts_with("locked ") {
                wt.is_locked = true;
                wt.lock_reason = Some(line.strip_prefix("locked ").unwrap_or("").to_string());
            } else if line == "prunable" || line.starts_with("prunable ") {
                wt.is_prunable = true;
            }
        }
    }

    // Don't forget the last worktree
    if let Some(wt) = current_worktree {
        worktrees.push(wt);
    }

    // Mark the first worktree as main (the original)
    if let Some(first) = worktrees.first_mut() {
        first.is_main = true;
    }

    Ok(worktrees)
}

/// Add a new worktree
#[command]
pub async fn add_worktree(
    path: String,
    worktree_path: String,
    branch: Option<String>,
    new_branch: Option<String>,
    commit: Option<String>,
    force: Option<bool>,
    detach: Option<bool>,
) -> Result<Worktree> {
    let repo_path = Path::new(&path);

    let mut args = vec!["worktree", "add"];

    if force.unwrap_or(false) {
        args.push("-f");
    }

    if detach.unwrap_or(false) {
        args.push("--detach");
    }

    // Add -b for new branch
    let new_branch_owned: String;
    if let Some(ref nb) = new_branch {
        new_branch_owned = nb.clone();
        args.push("-b");
        args.push(&new_branch_owned);
    }

    args.push(&worktree_path);

    // Branch or commit to checkout
    let branch_owned: String;
    let commit_owned: String;
    if let Some(ref b) = branch {
        branch_owned = b.clone();
        args.push(&branch_owned);
    } else if let Some(ref c) = commit {
        commit_owned = c.clone();
        args.push(&commit_owned);
    }

    run_git_command(repo_path, &args)?;

    // Get the newly added worktree info
    let worktrees = get_worktrees(path).await?;
    let abs_path = std::fs::canonicalize(&worktree_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(worktree_path.clone());

    worktrees
        .into_iter()
        .find(|wt| wt.path == abs_path || wt.path.ends_with(&worktree_path))
        .ok_or_else(|| {
            LeviathanError::OperationFailed("Failed to find newly created worktree".to_string())
        })
}

/// Remove a worktree
#[command]
pub async fn remove_worktree(
    path: String,
    worktree_path: String,
    force: Option<bool>,
) -> Result<()> {
    let repo_path = Path::new(&path);

    let mut args = vec!["worktree", "remove"];

    if force.unwrap_or(false) {
        args.push("--force");
    }

    args.push(&worktree_path);

    run_git_command(repo_path, &args)?;
    Ok(())
}

/// Prune stale worktree information
#[command]
pub async fn prune_worktrees(path: String, dry_run: Option<bool>) -> Result<String> {
    let repo_path = Path::new(&path);

    let mut args = vec!["worktree", "prune"];

    if dry_run.unwrap_or(false) {
        args.push("--dry-run");
    }

    args.push("-v"); // Verbose output

    run_git_command(repo_path, &args)
}

/// Lock a worktree to prevent accidental removal
#[command]
pub async fn lock_worktree(
    path: String,
    worktree_path: String,
    reason: Option<String>,
) -> Result<()> {
    let repo_path = Path::new(&path);

    let mut args = vec!["worktree", "lock"];

    let reason_owned: String;
    if let Some(ref r) = reason {
        reason_owned = r.clone();
        args.push("--reason");
        args.push(&reason_owned);
    }

    args.push(&worktree_path);

    run_git_command(repo_path, &args)?;
    Ok(())
}

/// Unlock a worktree
#[command]
pub async fn unlock_worktree(path: String, worktree_path: String) -> Result<()> {
    let repo_path = Path::new(&path);

    run_git_command(repo_path, &["worktree", "unlock", &worktree_path])?;
    Ok(())
}

/// Move a worktree to a new location
#[command]
pub async fn move_worktree(
    path: String,
    worktree_path: String,
    new_path: String,
    force: Option<bool>,
) -> Result<()> {
    let repo_path = Path::new(&path);

    let mut args = vec!["worktree", "move"];

    if force.unwrap_or(false) {
        args.push("--force");
    }

    args.push(&worktree_path);
    args.push(&new_path);

    run_git_command(repo_path, &args)?;
    Ok(())
}

/// Repair worktree administrative files
#[command]
pub async fn repair_worktrees(path: String) -> Result<String> {
    let repo_path = Path::new(&path);

    run_git_command(repo_path, &["worktree", "repair"])
}
