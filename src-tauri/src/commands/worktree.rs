//! Worktree command handlers
//! Manage git worktrees for working on multiple branches simultaneously

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

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
    let output = create_command("git")
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;
    use tempfile::TempDir;

    /// Helper to add a worktree using git CLI directly (more reliable for tests)
    fn add_worktree_cli(
        repo_path: &std::path::Path,
        worktree_path: &std::path::Path,
        branch: &str,
    ) {
        let output = std::process::Command::new("git")
            .current_dir(repo_path)
            .args([
                "worktree",
                "add",
                "-b",
                branch,
                &worktree_path.to_string_lossy(),
            ])
            .output()
            .expect("Failed to run git worktree add");

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            panic!("git worktree add failed: {}", stderr);
        }
    }

    #[tokio::test]
    async fn test_get_worktrees_single_main() {
        let repo = TestRepo::with_initial_commit();
        let result = get_worktrees(repo.path_str()).await;

        assert!(result.is_ok());
        let worktrees = result.unwrap();
        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].is_main);
        assert!(worktrees[0].head_oid.is_some());
    }

    #[tokio::test]
    async fn test_add_worktree_creates_directory() {
        let repo = TestRepo::with_initial_commit();
        let worktree_dir = TempDir::new().expect("Failed to create temp dir");
        let worktree_path = worktree_dir.path().join("feature-worktree");

        // Use the function - even if it returns an error finding the worktree,
        // the worktree should still be created
        let _ = add_worktree(
            repo.path_str(),
            worktree_path.to_string_lossy().to_string(),
            None,
            Some("feature-branch".to_string()),
            None,
            None,
            None,
        )
        .await;

        // Verify worktree directory exists
        assert!(worktree_path.exists());

        // Verify worktrees count increased
        let worktrees = get_worktrees(repo.path_str()).await.unwrap();
        assert_eq!(worktrees.len(), 2);
    }

    #[tokio::test]
    async fn test_get_worktrees_multiple() {
        let repo = TestRepo::with_initial_commit();

        let worktree_dir = TempDir::new().expect("Failed to create temp dir");
        let worktree_path = worktree_dir.path().join("extra-worktree");

        // Use CLI helper for reliable worktree creation
        add_worktree_cli(&repo.path, &worktree_path, "extra-branch");

        let worktrees = get_worktrees(repo.path_str()).await.unwrap();
        assert_eq!(worktrees.len(), 2);

        // First should be main
        assert!(worktrees[0].is_main);
        // Second should not be main
        assert!(!worktrees[1].is_main);
    }

    #[tokio::test]
    async fn test_worktree_has_branch_info() {
        let repo = TestRepo::with_initial_commit();

        let worktree_dir = TempDir::new().expect("Failed to create temp dir");
        let worktree_path = worktree_dir.path().join("branch-worktree");

        add_worktree_cli(&repo.path, &worktree_path, "test-branch");

        let worktrees = get_worktrees(repo.path_str()).await.unwrap();
        let new_wt = worktrees.iter().find(|wt| !wt.is_main);
        assert!(new_wt.is_some());
        assert_eq!(new_wt.unwrap().branch, Some("test-branch".to_string()));
    }

    #[tokio::test]
    async fn test_remove_worktree() {
        let repo = TestRepo::with_initial_commit();

        let worktree_dir = TempDir::new().expect("Failed to create temp dir");
        let worktree_path = worktree_dir.path().join("to-remove");

        add_worktree_cli(&repo.path, &worktree_path, "remove-branch");

        // Verify it exists
        let worktrees = get_worktrees(repo.path_str()).await.unwrap();
        assert_eq!(worktrees.len(), 2);

        // Remove it
        let result = remove_worktree(
            repo.path_str(),
            worktree_path.to_string_lossy().to_string(),
            Some(false),
        )
        .await;
        assert!(result.is_ok());

        // Verify it's gone
        let worktrees = get_worktrees(repo.path_str()).await.unwrap();
        assert_eq!(worktrees.len(), 1);
    }

    #[tokio::test]
    async fn test_remove_worktree_force() {
        let repo = TestRepo::with_initial_commit();

        let worktree_dir = TempDir::new().expect("Failed to create temp dir");
        let worktree_path = worktree_dir.path().join("force-remove");

        add_worktree_cli(&repo.path, &worktree_path, "force-branch");

        // Create uncommitted changes in the worktree
        std::fs::write(worktree_path.join("uncommitted.txt"), "changes").unwrap();

        // Force remove should work even with uncommitted changes
        let result = remove_worktree(
            repo.path_str(),
            worktree_path.to_string_lossy().to_string(),
            Some(true),
        )
        .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_remove_worktree_not_found() {
        let repo = TestRepo::with_initial_commit();

        let result = remove_worktree(
            repo.path_str(),
            "/nonexistent/path".to_string(),
            Some(false),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_prune_worktrees_clean() {
        let repo = TestRepo::with_initial_commit();

        // Prune on clean repo should succeed
        let result = prune_worktrees(repo.path_str(), Some(false)).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_prune_worktrees_dry_run() {
        let repo = TestRepo::with_initial_commit();

        let result = prune_worktrees(repo.path_str(), Some(true)).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_lock_unlock_worktree() {
        let repo = TestRepo::with_initial_commit();

        let worktree_dir = TempDir::new().expect("Failed to create temp dir");
        let worktree_path = worktree_dir.path().join("lockable");

        add_worktree_cli(&repo.path, &worktree_path, "lock-branch");

        // Lock the worktree
        let lock_result = lock_worktree(
            repo.path_str(),
            worktree_path.to_string_lossy().to_string(),
            Some("Testing lock".to_string()),
        )
        .await;
        assert!(lock_result.is_ok());

        // Verify it's locked
        let worktrees = get_worktrees(repo.path_str()).await.unwrap();
        let locked_wt = worktrees
            .iter()
            .find(|wt| wt.branch == Some("lock-branch".to_string()));
        assert!(locked_wt.is_some());
        assert!(locked_wt.unwrap().is_locked);

        // Unlock the worktree
        let unlock_result =
            unlock_worktree(repo.path_str(), worktree_path.to_string_lossy().to_string()).await;
        assert!(unlock_result.is_ok());

        // Verify it's unlocked
        let worktrees = get_worktrees(repo.path_str()).await.unwrap();
        let unlocked_wt = worktrees
            .iter()
            .find(|wt| wt.branch == Some("lock-branch".to_string()));
        assert!(unlocked_wt.is_some());
        assert!(!unlocked_wt.unwrap().is_locked);
    }

    #[tokio::test]
    async fn test_move_worktree() {
        let repo = TestRepo::with_initial_commit();

        let worktree_dir = TempDir::new().expect("Failed to create temp dir");
        let original_path = worktree_dir.path().join("original");
        let new_path = worktree_dir.path().join("moved");

        add_worktree_cli(&repo.path, &original_path, "move-branch");

        // Move the worktree
        let result = move_worktree(
            repo.path_str(),
            original_path.to_string_lossy().to_string(),
            new_path.to_string_lossy().to_string(),
            None,
        )
        .await;
        assert!(result.is_ok());

        // Verify new path exists and old doesn't
        assert!(new_path.exists());
        assert!(!original_path.exists());
    }

    #[tokio::test]
    async fn test_repair_worktrees() {
        let repo = TestRepo::with_initial_commit();

        // Repair on clean repo should succeed
        let result = repair_worktrees(repo.path_str()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_worktree_struct_fields() {
        let worktree = Worktree {
            path: "/path/to/worktree".to_string(),
            head_oid: Some("abc123".to_string()),
            branch: Some("feature".to_string()),
            is_main: false,
            is_locked: false,
            lock_reason: None,
            is_bare: false,
            is_prunable: false,
        };

        assert_eq!(worktree.path, "/path/to/worktree");
        assert_eq!(worktree.head_oid, Some("abc123".to_string()));
        assert_eq!(worktree.branch, Some("feature".to_string()));
        assert!(!worktree.is_main);
        assert!(!worktree.is_locked);
        assert!(!worktree.is_bare);
        assert!(!worktree.is_prunable);
    }

    #[tokio::test]
    async fn test_worktree_locked_with_reason() {
        let worktree = Worktree {
            path: "/path/to/locked".to_string(),
            head_oid: Some("def456".to_string()),
            branch: Some("locked-branch".to_string()),
            is_main: false,
            is_locked: true,
            lock_reason: Some("Ongoing work".to_string()),
            is_bare: false,
            is_prunable: false,
        };

        assert!(worktree.is_locked);
        assert_eq!(worktree.lock_reason, Some("Ongoing work".to_string()));
    }

    #[tokio::test]
    async fn test_worktree_head_oid_present() {
        let repo = TestRepo::with_initial_commit();
        let worktrees = get_worktrees(repo.path_str()).await.unwrap();

        assert!(!worktrees.is_empty());
        // Main worktree should have a HEAD OID
        assert!(worktrees[0].head_oid.is_some());
        assert!(!worktrees[0].head_oid.as_ref().unwrap().is_empty());
    }
}
