//! Branch command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{AheadBehind, Branch};

/// Default stale threshold in days
const STALE_THRESHOLD_DAYS: i64 = 90;

/// Get all branches in the repository
#[command]
pub async fn get_branches(path: String) -> Result<Vec<Branch>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut branches = Vec::new();

    let head = repo.head().ok();
    let _head_oid = head.as_ref().and_then(|h| h.target());

    // Calculate stale threshold (90 days ago in seconds since epoch)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let stale_threshold = now - (STALE_THRESHOLD_DAYS * 24 * 60 * 60);

    for branch_result in repo.branches(None)? {
        let (branch, branch_type) = branch_result?;
        let name = branch.name()?.unwrap_or("").to_string();
        let reference = branch.get();

        let is_remote = branch_type == git2::BranchType::Remote;
        let is_head = head
            .as_ref()
            .map(|h| h.name() == reference.name())
            .unwrap_or(false);

        let target_oid = reference
            .target()
            .map(|oid| oid.to_string())
            .unwrap_or_default();

        // Get the last commit timestamp for this branch
        let last_commit_timestamp = reference.target().and_then(|oid| {
            repo.find_commit(oid)
                .ok()
                .map(|commit| commit.time().seconds())
        });

        // Branch is stale if it's not HEAD and hasn't been updated in threshold days
        let is_stale = !is_head
            && last_commit_timestamp
                .map(|ts| ts < stale_threshold)
                .unwrap_or(false);

        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(|n| n.to_string()));

        let ahead_behind = if !is_remote {
            if let (Some(local_oid), Some(upstream_branch)) =
                (reference.target(), branch.upstream().ok())
            {
                if let Some(upstream_oid) = upstream_branch.get().target() {
                    repo.graph_ahead_behind(local_oid, upstream_oid)
                        .ok()
                        .map(|(ahead, behind)| AheadBehind { ahead, behind })
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        branches.push(Branch {
            name: name.clone(),
            shorthand: if is_remote {
                // For remote branches, strip the remote name prefix (e.g., "origin/main" -> "main")
                name.split_once('/')
                    .map(|x| x.1)
                    .unwrap_or(&name)
                    .to_string()
            } else {
                // For local branches, use the full name (e.g., "feature/my-fix")
                name.clone()
            },
            is_head,
            is_remote,
            upstream,
            target_oid,
            ahead_behind,
            last_commit_timestamp,
            is_stale,
        });
    }

    Ok(branches)
}

/// Create a new branch
#[command]
pub async fn create_branch(
    path: String,
    name: String,
    start_point: Option<String>,
    checkout: Option<bool>,
) -> Result<Branch> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let commit = if let Some(ref start) = start_point {
        let obj = repo.revparse_single(start)?;
        obj.peel_to_commit()?
    } else {
        repo.head()?.peel_to_commit()?
    };

    let branch = repo.branch(&name, &commit, false)?;
    let reference = branch.get();

    if checkout.unwrap_or(false) {
        let obj = reference.peel(git2::ObjectType::Commit)?;
        repo.checkout_tree(&obj, None)?;
        repo.set_head(reference.name().unwrap())?;
    }

    Ok(Branch {
        name: name.clone(),
        shorthand: name.clone(),
        is_head: checkout.unwrap_or(false),
        is_remote: false,
        upstream: None,
        target_oid: commit.id().to_string(),
        ahead_behind: None,
        last_commit_timestamp: Some(commit.time().seconds()),
        is_stale: false, // Newly created branches are never stale
    })
}

/// Delete a branch
#[command]
pub async fn delete_branch(path: String, name: String, force: Option<bool>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut branch = repo
        .find_branch(&name, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(name.clone()))?;

    if force.unwrap_or(false) {
        branch.delete()?;
    } else {
        // Check if branch is merged before deleting
        let head = repo.head()?;
        if let (Some(head_oid), Some(branch_oid)) = (head.target(), branch.get().target()) {
            if repo.graph_descendant_of(head_oid, branch_oid)? {
                branch.delete()?;
            } else {
                return Err(LeviathanError::OperationFailed(
                    "Branch is not fully merged. Use force to delete anyway.".to_string(),
                ));
            }
        } else {
            branch.delete()?;
        }
    }

    Ok(())
}

/// Rename a branch
#[command]
pub async fn rename_branch(path: String, old_name: String, new_name: String) -> Result<Branch> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut branch = repo
        .find_branch(&old_name, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(old_name.clone()))?;

    branch.rename(&new_name, false)?;

    // Get the renamed branch to return updated info
    let renamed_branch = repo.find_branch(&new_name, git2::BranchType::Local)?;
    let reference = renamed_branch.get();
    let target_oid = reference
        .target()
        .map(|o| o.to_string())
        .unwrap_or_default();

    let is_head = repo
        .head()
        .ok()
        .map(|h| h.name() == reference.name())
        .unwrap_or(false);

    let upstream = renamed_branch
        .upstream()
        .ok()
        .and_then(|u| u.name().ok().flatten().map(|n| n.to_string()));

    // Get the last commit timestamp
    let last_commit_timestamp = reference.target().and_then(|oid| {
        repo.find_commit(oid)
            .ok()
            .map(|commit| commit.time().seconds())
    });

    // Calculate if stale (if not HEAD)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let stale_threshold = now - (STALE_THRESHOLD_DAYS * 24 * 60 * 60);
    let is_stale = !is_head
        && last_commit_timestamp
            .map(|ts| ts < stale_threshold)
            .unwrap_or(false);

    Ok(Branch {
        name: new_name.clone(),
        shorthand: new_name,
        is_head,
        is_remote: false,
        upstream,
        target_oid,
        ahead_behind: None,
        last_commit_timestamp,
        is_stale,
    })
}

/// Checkout a branch or commit
#[command]
pub async fn checkout(path: String, ref_name: String, force: Option<bool>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let obj = repo.revparse_single(&ref_name)?;
    let commit = obj.peel_to_commit()?;

    let mut checkout_opts = git2::build::CheckoutBuilder::new();
    if force.unwrap_or(false) {
        checkout_opts.force();
    } else {
        checkout_opts.safe();
    }

    repo.checkout_tree(&obj, Some(&mut checkout_opts))?;

    // Try to set HEAD to branch, otherwise detach
    if let Ok(branch) = repo.find_branch(&ref_name, git2::BranchType::Local) {
        repo.set_head(branch.get().name().unwrap())?;
    } else {
        repo.set_head_detached(commit.id())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_branches_empty_repo() {
        let repo = TestRepo::new();
        // Empty repo has no branches until first commit
        let result = get_branches(repo.path_str()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_branches_with_initial_commit() {
        let repo = TestRepo::with_initial_commit();
        let result = get_branches(repo.path_str()).await;
        assert!(result.is_ok());
        let branches = result.unwrap();
        assert_eq!(branches.len(), 1);
        // Default branch name may vary (main, master, etc.)
        assert!(branches[0].is_head);
        assert!(!branches[0].is_remote);
    }

    #[tokio::test]
    async fn test_get_branches_multiple() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature-1");
        repo.create_branch("feature-2");

        let result = get_branches(repo.path_str()).await;
        assert!(result.is_ok());
        let branches = result.unwrap();
        assert_eq!(branches.len(), 3); // main + 2 features
    }

    #[tokio::test]
    async fn test_create_branch() {
        let repo = TestRepo::with_initial_commit();
        let result = create_branch(
            repo.path_str(),
            "new-feature".to_string(),
            None,
            Some(false),
        )
        .await;

        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "new-feature");
        assert!(!branch.is_head); // checkout was false
        assert!(!branch.is_remote);
    }

    #[tokio::test]
    async fn test_create_branch_and_checkout() {
        let repo = TestRepo::with_initial_commit();
        let result =
            create_branch(repo.path_str(), "new-feature".to_string(), None, Some(true)).await;

        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "new-feature");
        assert!(branch.is_head); // checkout was true
    }

    #[tokio::test]
    async fn test_create_branch_from_commit() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();
        repo.create_commit("Second commit", &[("file2.txt", "content2")]);

        let result = create_branch(
            repo.path_str(),
            "from-initial".to_string(),
            Some(initial_oid.to_string()),
            Some(false),
        )
        .await;

        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.target_oid, initial_oid.to_string());
    }

    #[tokio::test]
    async fn test_create_branch_duplicate_fails() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("existing");

        let result =
            create_branch(repo.path_str(), "existing".to_string(), None, Some(false)).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_delete_branch() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("to-delete");

        let result = delete_branch(repo.path_str(), "to-delete".to_string(), Some(true)).await;
        assert!(result.is_ok());

        // Verify branch is gone
        let git_repo = repo.repo();
        let branch = git_repo.find_branch("to-delete", git2::BranchType::Local);
        assert!(branch.is_err());
    }

    #[tokio::test]
    async fn test_delete_branch_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = delete_branch(repo.path_str(), "nonexistent".to_string(), Some(true)).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_delete_current_branch_fails() {
        let repo = TestRepo::with_initial_commit();
        let current = repo.current_branch();

        let result = delete_branch(repo.path_str(), current, Some(true)).await;
        // Should fail because you can't delete the checked out branch
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_rename_branch() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("old-name");

        let result = rename_branch(
            repo.path_str(),
            "old-name".to_string(),
            "new-name".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "new-name");

        // Verify old name is gone
        let git_repo = repo.repo();
        let old_branch = git_repo.find_branch("old-name", git2::BranchType::Local);
        assert!(old_branch.is_err());
    }

    #[tokio::test]
    async fn test_rename_branch_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = rename_branch(
            repo.path_str(),
            "nonexistent".to_string(),
            "new-name".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_checkout_branch() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");

        let result = checkout(repo.path_str(), "feature".to_string(), Some(false)).await;
        assert!(result.is_ok());
        assert_eq!(repo.current_branch(), "feature");
    }

    #[tokio::test]
    async fn test_checkout_commit_detached() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();
        repo.create_commit("Second", &[("file.txt", "content")]);

        let result = checkout(repo.path_str(), oid.to_string(), Some(false)).await;
        assert!(result.is_ok());

        // HEAD should be detached
        let git_repo = repo.repo();
        assert!(git_repo.head_detached().unwrap());
    }

    #[tokio::test]
    async fn test_checkout_nonexistent_fails() {
        let repo = TestRepo::with_initial_commit();
        let result = checkout(repo.path_str(), "nonexistent".to_string(), Some(false)).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_checkout_force() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");

        // Create uncommitted changes
        repo.create_file("uncommitted.txt", "changes");

        // Force checkout should work
        let result = checkout(repo.path_str(), "feature".to_string(), Some(true)).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_branch_with_slash_in_name() {
        let repo = TestRepo::with_initial_commit();
        let result = create_branch(
            repo.path_str(),
            "feature/my-feature".to_string(),
            None,
            Some(false),
        )
        .await;

        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "feature/my-feature");
        assert_eq!(branch.shorthand, "feature/my-feature");
    }
}
