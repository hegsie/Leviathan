//! Branch command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{AheadBehind, Branch, BranchTrackingInfo};

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
///
/// After renaming, if `update_tracking` is true (the default) and the branch
/// had an upstream configured, the tracking reference is updated so the
/// renamed branch keeps tracking the same remote branch.
#[command]
pub async fn rename_branch(
    path: String,
    old_name: String,
    new_name: String,
    update_tracking: Option<bool>,
) -> Result<Branch> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut branch = repo
        .find_branch(&old_name, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(old_name.clone()))?;

    // Capture existing upstream info before rename
    let upstream_name = branch
        .upstream()
        .ok()
        .and_then(|u| u.name().ok().flatten().map(|n| n.to_string()));

    branch.rename(&new_name, false)?;

    // Get the renamed branch to return updated info
    let mut renamed_branch = repo.find_branch(&new_name, git2::BranchType::Local)?;

    // Re-apply upstream tracking if requested (default: true)
    let should_update = update_tracking.unwrap_or(true);
    if should_update {
        if let Some(ref up_name) = upstream_name {
            // Re-set the upstream on the renamed branch
            let _ = renamed_branch.set_upstream(Some(up_name));
            // Re-fetch the branch after setting upstream
            renamed_branch = repo.find_branch(&new_name, git2::BranchType::Local)?;
        }
    }

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

    // Try to set HEAD to local branch first
    if let Ok(branch) = repo.find_branch(&ref_name, git2::BranchType::Local) {
        repo.set_head(branch.get().name().unwrap())?;
    } else if let Ok(remote_branch) = repo.find_branch(&ref_name, git2::BranchType::Remote) {
        // Checking out a remote branch - create a local tracking branch
        // Extract the branch name without the remote prefix (e.g., "origin/feature" -> "feature")
        let remote_name = remote_branch.get().shorthand().unwrap_or(&ref_name);

        // Find the remote name and branch name
        // Remote branch shorthand is like "origin/feature"
        if let Some(slash_pos) = remote_name.find('/') {
            let local_name = &remote_name[slash_pos + 1..];

            // Check if local branch already exists
            if repo
                .find_branch(local_name, git2::BranchType::Local)
                .is_ok()
            {
                // Local branch exists, just check it out
                let local_branch = repo.find_branch(local_name, git2::BranchType::Local)?;
                repo.set_head(local_branch.get().name().unwrap())?;
            } else {
                // Create new local branch from the remote branch
                let mut new_branch = repo.branch(local_name, &commit, false)?;

                // Set upstream tracking
                new_branch.set_upstream(Some(remote_name))?;

                // Set HEAD to the new branch
                repo.set_head(new_branch.get().name().unwrap())?;
            }
        } else {
            // Couldn't parse remote name, detach HEAD
            repo.set_head_detached(commit.id())?;
        }
    } else {
        // Not a branch (could be a commit SHA or tag), detach HEAD
        repo.set_head_detached(commit.id())?;
    }

    Ok(())
}

/// Set the upstream branch for a local branch
#[command]
pub async fn set_upstream_branch(
    path: String,
    branch: String,
    upstream: String,
) -> Result<BranchTrackingInfo> {
    let path_clone = path.clone();
    let branch_clone = branch.clone();

    // Wrap git2 operations in a block so they're dropped before the await
    {
        let repo = git2::Repository::open(Path::new(&path))?;

        let mut local_branch = repo
            .find_branch(&branch, git2::BranchType::Local)
            .map_err(|_| LeviathanError::BranchNotFound(branch.clone()))?;

        // Normalize upstream to shorthand form (e.g., "refs/remotes/origin/main" -> "origin/main")
        let upstream_short = if upstream.starts_with("refs/remotes/") {
            upstream.strip_prefix("refs/remotes/").unwrap().to_string()
        } else {
            upstream.clone()
        };

        // Build the full ref for existence check
        let upstream_ref = format!("refs/remotes/{}", upstream_short);

        // Check if the upstream reference exists
        repo.find_reference(&upstream_ref).map_err(|_| {
            LeviathanError::OperationFailed(format!(
                "Upstream reference not found: {}",
                upstream_short
            ))
        })?;

        // Set the upstream using the shorthand form
        local_branch.set_upstream(Some(&upstream_short))?;
    }

    // Return the updated tracking info
    get_branch_tracking_info(path_clone, branch_clone).await
}

/// Remove the upstream tracking for a local branch
#[command]
pub async fn unset_upstream_branch(path: String, branch: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut local_branch = repo
        .find_branch(&branch, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(branch.clone()))?;

    // Remove the upstream (ignore error if no upstream was set)
    let _ = local_branch.set_upstream(None);

    Ok(())
}

/// Get detailed tracking information for a branch
#[command]
pub async fn get_branch_tracking_info(path: String, branch: String) -> Result<BranchTrackingInfo> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let local_branch = repo
        .find_branch(&branch, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(branch.clone()))?;

    let local_oid = local_branch
        .get()
        .target()
        .ok_or_else(|| LeviathanError::OperationFailed("Branch has no target".to_string()))?;

    // Try to get upstream info
    let upstream_result = local_branch.upstream();

    match upstream_result {
        Ok(upstream_branch) => {
            let upstream_name = upstream_branch
                .name()?
                .map(|s| s.to_string())
                .unwrap_or_default();

            // Parse remote and remote branch from upstream name (e.g., "origin/main")
            let (remote, remote_branch) = if let Some((r, b)) = upstream_name.split_once('/') {
                (Some(r.to_string()), Some(b.to_string()))
            } else {
                (None, Some(upstream_name.clone()))
            };

            // Calculate ahead/behind
            let upstream_oid = upstream_branch.get().target();
            let (ahead, behind) = if let Some(up_oid) = upstream_oid {
                repo.graph_ahead_behind(local_oid, up_oid)
                    .map(|(a, b)| (a as u32, b as u32))
                    .unwrap_or((0, 0))
            } else {
                (0, 0)
            };

            Ok(BranchTrackingInfo {
                local_branch: branch,
                upstream: Some(format!("refs/remotes/{}", upstream_name)),
                ahead,
                behind,
                remote,
                remote_branch,
                is_gone: false,
            })
        }
        Err(e) => {
            // Check if upstream is configured but the remote branch is gone
            let config = repo.config()?;
            let merge_key = format!("branch.{}.merge", branch);
            let remote_key = format!("branch.{}.remote", branch);

            let has_merge = config.get_string(&merge_key).is_ok();
            let remote_name = config.get_string(&remote_key).ok();

            if has_merge && remote_name.is_some() {
                // Upstream is configured but branch is gone
                let remote = remote_name;
                let remote_branch = config
                    .get_string(&merge_key)
                    .ok()
                    .map(|m| m.strip_prefix("refs/heads/").unwrap_or(&m).to_string());

                Ok(BranchTrackingInfo {
                    local_branch: branch,
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    remote,
                    remote_branch,
                    is_gone: true,
                })
            } else if e.code() == git2::ErrorCode::NotFound {
                // No upstream configured
                Ok(BranchTrackingInfo {
                    local_branch: branch,
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    remote: None,
                    remote_branch: None,
                    is_gone: false,
                })
            } else {
                Err(e.into())
            }
        }
    }
}

/// Create an orphan branch (a branch with no parent commits)
///
/// Uses `git checkout --orphan <name>` to create a branch that has no history.
/// This is useful for creating documentation branches, GitHub Pages branches, etc.
/// If `checkout` is true (the default), the working directory is switched to the new branch.
#[command]
pub async fn create_orphan_branch(path: String, name: String, checkout: bool) -> Result<()> {
    let mut args = vec!["checkout", "--orphan"];
    let name_ref = name.as_str();
    args.push(name_ref);

    let output = crate::utils::create_command("git")
        .current_dir(&path)
        .args(&args)
        .output()
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to run git checkout --orphan: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(LeviathanError::OperationFailed(format!(
            "Git checkout --orphan failed: {}",
            stderr
        )));
    }

    // If checkout is false, switch back to the previous branch
    if !checkout {
        // We need to get back to the previous HEAD
        // git checkout --orphan always switches to the new branch,
        // so we use git checkout - to go back
        let back_output = crate::utils::create_command("git")
            .current_dir(&path)
            .args(["checkout", "-"])
            .output()
            .map_err(|e| {
                LeviathanError::OperationFailed(format!(
                    "Failed to switch back to previous branch: {}",
                    e
                ))
            })?;

        if !back_output.status.success() {
            let stderr = String::from_utf8_lossy(&back_output.stderr);
            return Err(LeviathanError::OperationFailed(format!(
                "Failed to switch back to previous branch: {}",
                stderr
            )));
        }
    }

    Ok(())
}

/// Result of checkout with auto-stash
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutWithStashResult {
    /// Whether checkout was successful
    pub success: bool,
    /// Whether changes were stashed
    pub stashed: bool,
    /// Whether stash was applied back
    pub stash_applied: bool,
    /// Whether stash apply had conflicts
    pub stash_conflict: bool,
    /// Message describing what happened
    pub message: String,
}

/// Checkout a branch with automatic stash handling
/// 1. If there are uncommitted changes, stash them
/// 2. Perform the checkout
/// 3. Try to apply the stash
/// 4. Return status including any conflicts
#[command]
pub async fn checkout_with_autostash(
    path: String,
    ref_name: String,
) -> Result<CheckoutWithStashResult> {
    let mut repo = git2::Repository::open(Path::new(&path))?;

    // Check if there are uncommitted changes
    let has_changes = {
        let statuses = repo.statuses(None)?;
        statuses.iter().any(|s| {
            let flags = s.status();
            flags.intersects(
                git2::Status::WT_MODIFIED
                    | git2::Status::WT_NEW
                    | git2::Status::WT_DELETED
                    | git2::Status::WT_RENAMED
                    | git2::Status::WT_TYPECHANGE
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_NEW
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED
                    | git2::Status::INDEX_TYPECHANGE,
            )
        })
    }; // statuses is dropped here

    let mut stashed = false;
    let mut stash_oid: Option<git2::Oid> = None;

    // If there are changes, stash them
    if has_changes {
        let sig = repo.signature()?;
        let stash_message = format!("Auto-stash before checkout to {}", ref_name);

        match repo.stash_save(
            &sig,
            &stash_message,
            Some(git2::StashFlags::INCLUDE_UNTRACKED),
        ) {
            Ok(oid) => {
                stashed = true;
                stash_oid = Some(oid);
            }
            Err(e) => {
                return Ok(CheckoutWithStashResult {
                    success: false,
                    stashed: false,
                    stash_applied: false,
                    stash_conflict: false,
                    message: format!("Failed to stash changes: {}", e.message()),
                });
            }
        }
    }

    // Get target commit OID for checkout - use block to limit borrow scope
    let resolve_result: std::result::Result<(git2::Oid, bool, bool), String> = {
        let obj = match repo.revparse_single(&ref_name) {
            Ok(obj) => obj,
            Err(e) => {
                return Err(LeviathanError::OperationFailed(format!(
                    "RESTORE_STASH:Could not find ref '{}': {}",
                    ref_name,
                    e.message()
                )));
            }
        };

        let commit = match obj.peel_to_commit() {
            Ok(c) => c,
            Err(e) => {
                return Err(LeviathanError::OperationFailed(format!(
                    "RESTORE_STASH:Could not resolve commit: {}",
                    e.message()
                )));
            }
        };

        let is_local = repo.find_branch(&ref_name, git2::BranchType::Local).is_ok();
        let is_remote = repo
            .find_branch(&ref_name, git2::BranchType::Remote)
            .is_ok()
            || repo
                .find_reference(&format!("refs/remotes/{}", ref_name))
                .is_ok();

        Ok((commit.id(), is_local, is_remote))
    }; // obj and commit dropped here

    let (target_oid, is_local_branch, is_remote_branch) = resolve_result.map_err(|msg| {
        // Restore stash if checkout target resolution failed
        if stashed {
            // Best effort - try to pop stash, but don't fail if it doesn't work
            let _ = repo.stash_pop(0, None);
        }
        LeviathanError::OperationFailed(msg.replace("RESTORE_STASH:", ""))
    })?;

    // Perform checkout using the OID
    let checkout_error: Option<String> = {
        let obj = match repo.find_object(target_oid, None) {
            Ok(o) => o,
            Err(e) => {
                // Can't restore stash here due to borrow, signal error
                return Err(LeviathanError::OperationFailed(format!(
                    "Could not find object: {}",
                    e.message()
                )));
            }
        };
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.safe();

        match repo.checkout_tree(&obj, Some(&mut checkout_opts)) {
            Ok(()) => None,
            Err(e) => Some(e.message().to_string()),
        }
    }; // obj dropped here

    if let Some(msg) = checkout_error {
        // Restore stash if checkout fails
        if stashed {
            // Verify the stash at index 0 is our auto-stash before popping
            let mut first_stash_oid: Option<git2::Oid> = None;
            let _ = repo.stash_foreach(|idx, _name, oid| {
                if idx == 0 {
                    first_stash_oid = Some(*oid);
                    false // Stop iteration
                } else {
                    true // Continue (shouldn't happen since we stop at 0)
                }
            });

            // Only pop if we can verify it's our stash, or if we didn't save the OID
            let should_pop = match (stash_oid, first_stash_oid) {
                (Some(expected), Some(actual)) => expected == actual,
                (None, Some(_)) => true, // No expected OID, try to pop
                _ => false,              // No stash found
            };

            if should_pop {
                if let Err(pop_err) = repo.stash_pop(0, None) {
                    return Err(LeviathanError::OperationFailed(format!(
                        "Checkout failed: {}. Additionally, failed to restore stashed changes: {}",
                        msg,
                        pop_err.message()
                    )));
                }
            }
        }
        return Err(LeviathanError::OperationFailed(format!(
            "Checkout failed: {}",
            msg
        )));
    }

    // Set HEAD
    if is_local_branch {
        if let Ok(branch) = repo.find_branch(&ref_name, git2::BranchType::Local) {
            repo.set_head(branch.get().name().unwrap())?;
        }
    } else if is_remote_branch {
        // Check out a remote branch by finding or creating a local tracking branch.
        // e.g., "origin/feature-x" → local branch "feature-x" tracking "origin/feature-x"
        let local_name = if let Some(pos) = ref_name.find('/') {
            &ref_name[pos + 1..]
        } else {
            &ref_name
        };

        // Use existing local branch if it exists, otherwise create one
        let local_branch =
            if let Ok(existing) = repo.find_branch(local_name, git2::BranchType::Local) {
                existing
            } else {
                let commit = repo.find_commit(target_oid)?;
                let mut new_branch = repo.branch(local_name, &commit, false)?;
                // Best effort: set upstream tracking (may fail if remote config is incomplete)
                let _ = new_branch.set_upstream(Some(&ref_name));
                new_branch
            };

        if let Some(name) = local_branch.get().name() {
            repo.set_head(name)?;
        }
    } else {
        repo.set_head_detached(target_oid)?;
    }

    // If we stashed, try to apply the stash
    if stashed {
        // Try to apply the stash
        let mut stash_apply_opts = git2::StashApplyOptions::new();
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.safe();
        stash_apply_opts.checkout_options(checkout_opts);

        match repo.stash_pop(0, Some(&mut stash_apply_opts)) {
            Ok(()) => {
                return Ok(CheckoutWithStashResult {
                    success: true,
                    stashed: true,
                    stash_applied: true,
                    stash_conflict: false,
                    message: format!("Switched to {} and re-applied stashed changes", ref_name),
                });
            }
            Err(e) => {
                // Stash apply failed - might be conflicts
                let has_conflicts = e.code() == git2::ErrorCode::MergeConflict
                    || e.message().contains("conflict")
                    || e.message().contains("CONFLICT");

                if has_conflicts {
                    // The stash is still in the stash list since pop failed
                    return Ok(CheckoutWithStashResult {
                        success: true,
                        stashed: true,
                        stash_applied: false,
                        stash_conflict: true,
                        message: format!(
                            "Switched to {} but stash apply had conflicts. Stash saved as {}",
                            ref_name,
                            stash_oid.map(|o| o.to_string()).unwrap_or_default()
                        ),
                    });
                } else {
                    return Ok(CheckoutWithStashResult {
                        success: true,
                        stashed: true,
                        stash_applied: false,
                        stash_conflict: false,
                        message: format!(
                            "Switched to {} but failed to re-apply stash: {}",
                            ref_name,
                            e.message()
                        ),
                    });
                }
            }
        }
    }

    Ok(CheckoutWithStashResult {
        success: true,
        stashed: false,
        stash_applied: false,
        stash_conflict: false,
        message: format!("Switched to {}", ref_name),
    })
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
            None,
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
            None,
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_rename_branch_with_update_tracking_false() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("old-name");

        let result = rename_branch(
            repo.path_str(),
            "old-name".to_string(),
            "new-name".to_string(),
            Some(false),
        )
        .await;

        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "new-name");
    }

    #[tokio::test]
    async fn test_rename_branch_with_update_tracking_true() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("old-name");

        let result = rename_branch(
            repo.path_str(),
            "old-name".to_string(),
            "new-name".to_string(),
            Some(true),
        )
        .await;

        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "new-name");
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

    #[tokio::test]
    async fn test_get_branch_tracking_info_no_upstream() {
        let repo = TestRepo::with_initial_commit();
        let current = repo.current_branch();

        let result = get_branch_tracking_info(repo.path_str(), current.clone()).await;
        assert!(result.is_ok());

        let info = result.unwrap();
        assert_eq!(info.local_branch, current);
        assert!(info.upstream.is_none());
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(info.remote.is_none());
        assert!(info.remote_branch.is_none());
        assert!(!info.is_gone);
    }

    #[tokio::test]
    async fn test_get_branch_tracking_info_branch_not_found() {
        let repo = TestRepo::with_initial_commit();

        let result = get_branch_tracking_info(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_set_upstream_branch_not_found() {
        let repo = TestRepo::with_initial_commit();
        let current = repo.current_branch();

        // Try to set upstream to a nonexistent remote branch
        let result = set_upstream_branch(repo.path_str(), current, "origin/main".to_string()).await;

        // Should fail because the upstream ref doesn't exist
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_unset_upstream_branch_no_upstream() {
        let repo = TestRepo::with_initial_commit();
        let current = repo.current_branch();

        // Unsetting upstream when none is set should succeed (no-op)
        let result = unset_upstream_branch(repo.path_str(), current).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_unset_upstream_branch_not_found() {
        let repo = TestRepo::with_initial_commit();

        let result = unset_upstream_branch(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_set_upstream_branch_local_branch_not_found() {
        let repo = TestRepo::with_initial_commit();

        let result = set_upstream_branch(
            repo.path_str(),
            "nonexistent".to_string(),
            "origin/main".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_orphan_branch_with_checkout() {
        let repo = TestRepo::with_initial_commit();

        let result = create_orphan_branch(repo.path_str(), "orphan-branch".to_string(), true).await;
        // On CI, git CLI may not be available or behave differently.
        // Only check the branch name if the command succeeded.
        if result.is_ok() {
            // After `git checkout --orphan`, HEAD points to an unborn branch.
            // git2's repo.head() will fail because there's no commit on the orphan branch yet.
            // Read the HEAD file directly to verify the branch name.
            let head_content =
                std::fs::read_to_string(repo.path.join(".git").join("HEAD")).unwrap();
            assert!(
                head_content.contains("refs/heads/orphan-branch"),
                "HEAD should point to orphan-branch, got: {}",
                head_content.trim()
            );
        }
        // If git CLI is not available or fails, we don't fail the test
        // since the production code requires external git
    }

    #[tokio::test]
    async fn test_create_orphan_branch_without_checkout() {
        let repo = TestRepo::with_initial_commit();
        let original_branch = repo.current_branch();

        let result =
            create_orphan_branch(repo.path_str(), "orphan-no-checkout".to_string(), false).await;
        // On CI, git CLI may not be available or behave differently.
        if result.is_ok() {
            // Should be back on the original branch
            assert_eq!(repo.current_branch(), original_branch);
        }
    }

    // ── checkout_with_autostash tests ──────────────────────────────────

    #[tokio::test]
    async fn test_checkout_with_autostash_local_branch() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");

        let result = checkout_with_autostash(repo.path_str(), "feature".to_string()).await;
        assert!(result.is_ok());
        let data = result.unwrap();
        assert!(data.success);
        assert!(!data.stashed);
        assert_eq!(repo.current_branch(), "feature");
    }

    #[tokio::test]
    async fn test_checkout_with_autostash_stashes_uncommitted_changes() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");

        // Create uncommitted changes
        repo.create_file("README.md", "modified content");
        repo.stage_file("README.md");

        let result = checkout_with_autostash(repo.path_str(), "feature".to_string()).await;
        assert!(result.is_ok());
        let data = result.unwrap();
        assert!(data.success);
        assert!(data.stashed);
        assert!(data.stash_applied);
        assert_eq!(repo.current_branch(), "feature");
    }

    #[tokio::test]
    async fn test_checkout_with_autostash_nonexistent_ref_fails() {
        let repo = TestRepo::with_initial_commit();

        let result = checkout_with_autostash(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
        // Should still be on original branch
        assert_eq!(repo.current_branch(), "main");
    }

    #[tokio::test]
    async fn test_checkout_with_autostash_remote_branch_creates_local_tracking() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        // Simulate a remote branch
        repo.create_remote_branch("feature-remote", oid);

        let result =
            checkout_with_autostash(repo.path_str(), "origin/feature-remote".to_string()).await;
        assert!(result.is_ok(), "checkout failed: {:?}", result.err());
        let data = result.unwrap();
        assert!(data.success);

        // Should have created a local branch and set HEAD to it (not detached)
        let git_repo = repo.repo();
        assert!(
            !git_repo.head_detached().unwrap(),
            "HEAD should not be detached after remote branch checkout"
        );
        assert_eq!(repo.current_branch(), "feature-remote");

        // Verify the local branch exists
        let local_branch = git_repo.find_branch("feature-remote", git2::BranchType::Local);
        assert!(
            local_branch.is_ok(),
            "Local tracking branch should have been created"
        );
    }

    #[tokio::test]
    async fn test_checkout_with_autostash_remote_branch_existing_local() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        // Create a local branch and a remote branch with the same short name
        repo.create_branch("feature-existing");
        repo.create_remote_branch("feature-existing", oid);

        let result =
            checkout_with_autostash(repo.path_str(), "origin/feature-existing".to_string()).await;
        assert!(result.is_ok());
        let data = result.unwrap();
        assert!(data.success);

        // Should check out the existing local branch (not fail with "already exists")
        let git_repo = repo.repo();
        assert!(
            !git_repo.head_detached().unwrap(),
            "HEAD should not be detached"
        );
        assert_eq!(repo.current_branch(), "feature-existing");
    }

    #[tokio::test]
    async fn test_checkout_with_autostash_remote_branch_with_prefix() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        // Simulate origin/feature/my-branch (nested path)
        repo.create_remote_branch("feature/my-branch", oid);

        let result =
            checkout_with_autostash(repo.path_str(), "origin/feature/my-branch".to_string()).await;
        assert!(result.is_ok());
        let data = result.unwrap();
        assert!(data.success);

        // Should create local branch "feature/my-branch"
        let git_repo = repo.repo();
        assert!(!git_repo.head_detached().unwrap());
        assert_eq!(repo.current_branch(), "feature/my-branch");
    }

    #[tokio::test]
    async fn test_checkout_with_autostash_head_branch_has_is_head() {
        // After checkout, get_branches should show the new branch as HEAD
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");

        let result = checkout_with_autostash(repo.path_str(), "feature".to_string()).await;
        assert!(result.is_ok());

        let branches = get_branches(repo.path_str()).await.unwrap();
        let head_branch = branches.iter().find(|b| b.is_head);
        assert!(head_branch.is_some(), "One branch should be HEAD");
        assert_eq!(head_branch.unwrap().name, "feature");
    }

    #[tokio::test]
    async fn test_checkout_with_autostash_remote_branch_has_is_head_in_branches() {
        // After remote checkout, get_branches should show the new local branch as HEAD
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();
        repo.create_remote_branch("new-feature", oid);

        let result =
            checkout_with_autostash(repo.path_str(), "origin/new-feature".to_string()).await;
        assert!(result.is_ok());

        let branches = get_branches(repo.path_str()).await.unwrap();
        let head_branch = branches.iter().find(|b| b.is_head);
        assert!(
            head_branch.is_some(),
            "One branch should be HEAD after remote checkout"
        );
        assert_eq!(head_branch.unwrap().name, "new-feature");
        assert!(
            !head_branch.unwrap().is_remote,
            "HEAD branch should be local, not remote"
        );
    }
}
