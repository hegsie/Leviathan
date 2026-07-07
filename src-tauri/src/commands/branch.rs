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
        let old_head = crate::commands::hooks::head_oid_string(&repo);
        let obj = reference.peel(git2::ObjectType::Commit)?;
        repo.checkout_tree(&obj, None)?;
        repo.set_head(reference.name().map_err(|_| {
            LeviathanError::OperationFailed("Invalid reference name encoding".to_string())
        })?)?;
        let new_head = crate::commands::hooks::head_oid_string(&repo);
        crate::commands::hooks::run_post_checkout(&repo, &old_head, &new_head, true);
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
            // A branch is fully merged into HEAD when HEAD is at or descends
            // from the branch tip. The equality case matters: `git branch -d`
            // deletes a branch that points at the same commit as HEAD, but
            // graph_descendant_of returns false for equal oids.
            if head_oid == branch_oid || repo.graph_descendant_of(head_oid, branch_oid)? {
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

    // Capture HEAD before the switch so the post-checkout hook receives the
    // correct <old-ref> argument (githooks(5)).
    let old_head = crate::commands::hooks::head_oid_string(&repo);

    let mut checkout_opts = git2::build::CheckoutBuilder::new();
    if force.unwrap_or(false) {
        checkout_opts.force();
    } else {
        checkout_opts.safe();
    }

    // The working tree must always be checked out from the same commit HEAD
    // ends up pointing at, so resolve the effective target ref FIRST. In
    // particular, checking out a remote branch when a same-named local branch
    // already exists must check out the LOCAL branch (like `git checkout`),
    // not the remote tip — otherwise tree and HEAD diverge.
    if let Ok(branch) = repo.find_branch(&ref_name, git2::BranchType::Local) {
        let obj = branch.get().peel(git2::ObjectType::Commit)?;
        repo.checkout_tree(&obj, Some(&mut checkout_opts))?;
        repo.set_head(branch.get().name().map_err(|_| {
            LeviathanError::OperationFailed("Invalid reference name encoding".to_string())
        })?)?;
    } else if let Ok(remote_branch) = repo.find_branch(&ref_name, git2::BranchType::Remote) {
        // Checking out a remote branch - use or create a local tracking branch.
        // Extract the branch name without the remote prefix (e.g., "origin/feature" -> "feature")
        let remote_name = remote_branch
            .get()
            .shorthand()
            .unwrap_or(&ref_name)
            .to_string();

        if let Some(slash_pos) = remote_name.find('/') {
            let local_name = &remote_name[slash_pos + 1..];

            if let Ok(local_branch) = repo.find_branch(local_name, git2::BranchType::Local) {
                // Local branch exists: check out ITS tree, not the remote tip
                let obj = local_branch.get().peel(git2::ObjectType::Commit)?;
                repo.checkout_tree(&obj, Some(&mut checkout_opts))?;
                repo.set_head(local_branch.get().name().map_err(|_| {
                    LeviathanError::OperationFailed("Invalid reference name encoding".to_string())
                })?)?;
            } else {
                // Create new local branch from the remote branch
                let commit = remote_branch.get().peel_to_commit()?;
                repo.checkout_tree(commit.as_object(), Some(&mut checkout_opts))?;
                let mut new_branch = repo.branch(local_name, &commit, false)?;

                // Set upstream tracking
                new_branch.set_upstream(Some(&remote_name))?;

                // Set HEAD to the new branch
                repo.set_head(new_branch.get().name().map_err(|_| {
                    LeviathanError::OperationFailed("Invalid reference name encoding".to_string())
                })?)?;
            }
        } else {
            // Couldn't parse remote name, detach HEAD
            let commit = remote_branch.get().peel_to_commit()?;
            repo.checkout_tree(commit.as_object(), Some(&mut checkout_opts))?;
            repo.set_head_detached(commit.id())?;
        }
    } else {
        // Not a branch (could be a commit SHA or tag), detach HEAD
        let obj = repo.revparse_single(&ref_name)?;
        let commit = obj.peel_to_commit()?;
        repo.checkout_tree(&obj, Some(&mut checkout_opts))?;
        repo.set_head_detached(commit.id())?;
    }

    // Branch/commit switch complete — run post-checkout (flag=1), non-blocking.
    let new_head = crate::commands::hooks::head_oid_string(&repo);
    crate::commands::hooks::run_post_checkout(&repo, &old_head, &new_head, true);

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
            upstream
                .strip_prefix("refs/remotes/")
                .unwrap_or(&upstream)
                .to_string()
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

    // Capture HEAD before the switch for the post-checkout hook's <old-ref>.
    let old_head = crate::commands::hooks::head_oid_string(&repo);

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

    // Get target commit OID for checkout. Errors are produced as closure
    // values (NOT early function returns) so the map_err below actually runs
    // and restores the auto-stash on failure.
    let resolve_result: std::result::Result<(git2::Oid, bool, bool), String> = (|| {
        let is_local = repo.find_branch(&ref_name, git2::BranchType::Local).is_ok();
        let is_remote = !is_local
            && (repo
                .find_branch(&ref_name, git2::BranchType::Remote)
                .is_ok()
                || repo
                    .find_reference(&format!("refs/remotes/{}", ref_name))
                    .is_ok());

        // The working tree must be checked out from the commit HEAD ends up
        // pointing at. A remote branch whose same-named local branch already
        // exists checks out the LOCAL branch tip (mirrors `git checkout`),
        // not the remote tip — otherwise tree and HEAD diverge.
        if is_remote {
            let local_name = ref_name
                .find('/')
                .map(|pos| &ref_name[pos + 1..])
                .unwrap_or(ref_name.as_str());
            if let Ok(local) = repo.find_branch(local_name, git2::BranchType::Local) {
                let commit = local
                    .get()
                    .peel_to_commit()
                    .map_err(|e| format!("Could not resolve commit: {}", e.message()))?;
                return Ok((commit.id(), is_local, is_remote));
            }
        }

        let obj = repo
            .revparse_single(&ref_name)
            .map_err(|e| format!("Could not find ref '{}': {}", ref_name, e.message()))?;
        let commit = obj
            .peel_to_commit()
            .map_err(|e| format!("Could not resolve commit: {}", e.message()))?;
        Ok((commit.id(), is_local, is_remote))
    })();

    let (target_oid, is_local_branch, is_remote_branch) = resolve_result.map_err(|msg| {
        // Restore stash if checkout target resolution failed
        if stashed {
            // Best effort - try to pop stash, but don't fail if it doesn't work
            let _ = repo.stash_pop(0, None);
        }
        LeviathanError::OperationFailed(msg)
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
            repo.set_head(branch.get().name().map_err(|_| {
                LeviathanError::OperationFailed("Invalid reference name encoding".to_string())
            })?)?;
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

        if let Ok(name) = local_branch.get().name() {
            repo.set_head(name)?;
        }
    } else {
        repo.set_head_detached(target_oid)?;
    }

    // HEAD/working tree switched — run post-checkout (flag=1), non-blocking.
    // Runs before the stash re-apply so it fires even if re-applying conflicts.
    let new_head = crate::commands::hooks::head_oid_string(&repo);
    crate::commands::hooks::run_post_checkout(&repo, &old_head, &new_head, true);

    // If we stashed, try to re-apply the stash.
    if stashed {
        // Use stash_APPLY (not stash_pop): the stash must survive until we KNOW
        // the changes landed cleanly. git2's stash_pop is unsafe here in two
        // empirically-verified ways:
        //   - an UNSTAGED conflicting change makes apply return Ok while leaving
        //     a conflicted index; stash_pop would then DROP the stash, destroying
        //     the user's only copy of their work.
        //   - a STAGED conflicting change makes apply fail with ECONFLICT.
        // So we apply, then inspect the index ourselves and only drop the stash
        // when it is genuinely clean.
        //
        // Reinstate the index so files the user had staged before the checkout
        // come back staged instead of silently becoming unstaged.
        let mut stash_apply_opts = git2::StashApplyOptions::new();
        stash_apply_opts.reinstantiate_index();
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.safe();
        stash_apply_opts.checkout_options(checkout_opts);

        let conflict_message = format!(
            "Switched to {} but re-applying your stashed changes produced conflicts. \
             Resolve them, then the stash will be dropped.",
            ref_name
        );

        match repo.stash_apply(0, Some(&mut stash_apply_opts)) {
            Ok(()) => {
                // Apply reported success, but an unstaged conflicting change can
                // land conflicts in the index while still returning Ok. Only drop
                // the stash when the index is truly conflict-free.
                if repo.index()?.has_conflicts() {
                    return Ok(CheckoutWithStashResult {
                        success: true,
                        stashed: true,
                        stash_applied: false,
                        stash_conflict: true,
                        message: conflict_message,
                    });
                }
                repo.stash_drop(0)?;
                return Ok(CheckoutWithStashResult {
                    success: true,
                    stashed: true,
                    stash_applied: true,
                    stash_conflict: false,
                    message: format!("Switched to {} and re-applied stashed changes", ref_name),
                });
            }
            Err(e) => {
                // git2 signals a stash-apply conflict as either MergeConflict
                // (index-level) or Conflict (checkout-level, often with an empty
                // message), so match both.
                let has_conflicts = e.code() == git2::ErrorCode::MergeConflict
                    || e.code() == git2::ErrorCode::Conflict
                    || e.message().contains("conflict")
                    || e.message().contains("CONFLICT");

                if has_conflicts {
                    // A staged conflicting change fails the reinstate-index apply.
                    // Retry WITHOUT reinstating the index: applied unstaged-style,
                    // the conflict lands in the index (mirroring `git stash apply`)
                    // where the conflict-resolution flow can pick it up. The stash
                    // is kept for that flow to drop after resolution.
                    let mut retry_opts = git2::StashApplyOptions::new();
                    let mut retry_checkout = git2::build::CheckoutBuilder::new();
                    retry_checkout.safe();
                    retry_opts.checkout_options(retry_checkout);

                    if repo.stash_apply(0, Some(&mut retry_opts)).is_ok() {
                        if repo.index()?.has_conflicts() {
                            return Ok(CheckoutWithStashResult {
                                success: true,
                                stashed: true,
                                stash_applied: false,
                                stash_conflict: true,
                                message: conflict_message,
                            });
                        }
                        // The retry applied cleanly (no conflicts). The stashed
                        // changes ARE now in the working tree, so the stash must be
                        // dropped — otherwise it lingers and a later apply/pop would
                        // duplicate or conflict with the already-applied changes.
                        // The staged status could not be reinstated on this path, so
                        // note that in the message.
                        repo.stash_drop(0)?;
                        return Ok(CheckoutWithStashResult {
                            success: true,
                            stashed: true,
                            stash_applied: true,
                            stash_conflict: false,
                            message: format!(
                                "Switched to {} and re-applied stashed changes (staged status was not preserved)",
                                ref_name
                            ),
                        });
                    }
                }

                // Could not re-apply — the stash remains in the list untouched.
                return Ok(CheckoutWithStashResult {
                    success: true,
                    stashed: true,
                    stash_applied: false,
                    stash_conflict: false,
                    message: format!(
                        "Switched to {} but failed to re-apply stash: {}. Your changes remain stashed.",
                        ref_name,
                        e.message()
                    ),
                });
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

    // A branch pointing at the same commit as HEAD is fully merged, so a
    // non-force delete must succeed (matching `git branch -d`).
    #[tokio::test]
    async fn test_delete_branch_at_head_non_force_succeeds() {
        let repo = TestRepo::with_initial_commit();
        // Branch created at HEAD points to the same commit as HEAD.
        repo.create_branch("at-head");

        let result = delete_branch(repo.path_str(), "at-head".to_string(), Some(false)).await;
        assert!(
            result.is_ok(),
            "deleting a branch at HEAD should succeed without force"
        );

        let git_repo = repo.repo();
        assert!(git_repo
            .find_branch("at-head", git2::BranchType::Local)
            .is_err());
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

    // ── Additional coverage for error paths and edge cases ─────────────

    #[tokio::test]
    async fn test_create_branch_invalid_start_point() {
        let repo = TestRepo::with_initial_commit();
        let result = create_branch(
            repo.path_str(),
            "new-branch".to_string(),
            Some("nonexistent-ref-abc123".to_string()),
            Some(false),
        )
        .await;

        assert!(
            result.is_err(),
            "Creating branch from invalid start point should fail"
        );
    }

    #[tokio::test]
    async fn test_get_branches_invalid_repo_path() {
        let result = get_branches("/nonexistent/repo/path".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_checkout_invalid_repo_path() {
        let result = checkout(
            "/nonexistent/repo/path".to_string(),
            "main".to_string(),
            Some(false),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_branch_invalid_repo_path() {
        let result = create_branch(
            "/nonexistent/repo/path".to_string(),
            "branch".to_string(),
            None,
            Some(false),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_delete_branch_invalid_repo_path() {
        let result = delete_branch(
            "/nonexistent/repo/path".to_string(),
            "main".to_string(),
            Some(true),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_rename_branch_invalid_repo_path() {
        let result = rename_branch(
            "/nonexistent/repo/path".to_string(),
            "old".to_string(),
            "new".to_string(),
            None,
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_checkout_detached_head_to_another_commit() {
        let repo = TestRepo::with_initial_commit();
        let oid1 = repo.head_oid();
        let oid2 = repo.create_commit("Second commit", &[("file2.txt", "content2")]);

        // Checkout first commit (detached)
        let result = checkout(repo.path_str(), oid1.to_string(), Some(false)).await;
        assert!(result.is_ok());
        assert!(repo.repo().head_detached().unwrap());

        // Now checkout second commit (detached -> detached)
        let result = checkout(repo.path_str(), oid2.to_string(), Some(false)).await;
        assert!(result.is_ok());
        assert!(repo.repo().head_detached().unwrap());

        // HEAD should point to oid2
        let head_oid = repo.repo().head().unwrap().target().unwrap();
        assert_eq!(head_oid, oid2);
    }

    #[tokio::test]
    async fn test_delete_unmerged_branch_without_force_fails() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("diverged");

        // Checkout the new branch and make a commit that diverges from main
        repo.checkout_branch("diverged");
        repo.create_commit("Diverged commit", &[("diverged.txt", "content")]);
        repo.checkout_branch("main");

        // Delete without force should fail because the branch is not merged
        let result = delete_branch(repo.path_str(), "diverged".to_string(), Some(false)).await;
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("not fully merged"),
            "Error should mention branch is not merged, got: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_delete_merged_branch_without_force_succeeds() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("merged-feature");

        // Advance main past the branch point so HEAD is a true descendant
        repo.create_commit("Advance main", &[("advance.txt", "content")]);

        let result =
            delete_branch(repo.path_str(), "merged-feature".to_string(), Some(false)).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_checkout_with_autostash_detached_head_ref() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();
        repo.create_commit("Second commit", &[("file2.txt", "data")]);

        // Checkout a commit hash via autostash should detach HEAD
        let result = checkout_with_autostash(repo.path_str(), oid.to_string()).await;
        assert!(result.is_ok());
        let data = result.unwrap();
        assert!(data.success);
        assert!(repo.repo().head_detached().unwrap());
    }

    #[test]
    fn test_checkout_with_stash_result_serialization() {
        let result = CheckoutWithStashResult {
            success: true,
            stashed: true,
            stash_applied: false,
            stash_conflict: true,
            message: "test message".to_string(),
        };

        let json = serde_json::to_string(&result).unwrap();
        // Verify camelCase serialization
        assert!(json.contains("stashApplied"));
        assert!(json.contains("stashConflict"));
    }

    #[tokio::test]
    async fn test_branch_shorthand_for_remote() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();
        repo.create_remote_branch("feature/nested", oid);

        let branches = get_branches(repo.path_str()).await.unwrap();
        let remote_branch = branches.iter().find(|b| b.name == "origin/feature/nested");
        assert!(remote_branch.is_some());
        // shorthand should strip "origin/" prefix
        assert_eq!(remote_branch.unwrap().shorthand, "feature/nested");
    }

    #[tokio::test]
    async fn test_checkout_remote_branch_with_existing_local_uses_local_tip() {
        // Local "feature" is at commit A; origin/feature is at newer commit B.
        // Checking out "origin/feature" must put BOTH the working tree and
        // HEAD on local "feature" (commit A) — not tree=B with HEAD=A.
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature"); // at commit A
        let commit_b = repo.create_commit("B on main", &[("newer.txt", "from B")]);
        repo.create_remote_branch("feature", commit_b);

        let result = checkout(repo.path_str(), "origin/feature".to_string(), None).await;
        assert!(result.is_ok(), "checkout failed: {:?}", result.err());

        assert_eq!(repo.current_branch(), "feature");
        // Working tree must match local feature (commit A): newer.txt absent
        assert!(
            !repo.path.join("newer.txt").exists(),
            "working tree was checked out from the remote tip instead of the local branch"
        );
        // And the tree must be clean — no phantom modifications
        let git_repo = repo.repo();
        let statuses = git_repo.statuses(None).unwrap();
        assert!(
            statuses.is_empty(),
            "unexpected dirty status after checkout: {:?}",
            statuses
                .iter()
                .map(|s| s.path().unwrap_or("").to_string())
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn test_checkout_remote_branch_creates_local_tracking() {
        let repo = TestRepo::with_initial_commit();
        repo.add_remote("origin", "https://example.com/repo.git");
        let commit_b = repo.create_commit("B", &[("b.txt", "b")]);
        repo.create_remote_branch("topic", commit_b);

        let result = checkout(repo.path_str(), "origin/topic".to_string(), None).await;
        assert!(result.is_ok(), "checkout failed: {:?}", result.err());

        assert_eq!(repo.current_branch(), "topic");
        let git_repo = repo.repo();
        let local = git_repo
            .find_branch("topic", git2::BranchType::Local)
            .expect("local tracking branch should exist");
        assert_eq!(local.get().target(), Some(commit_b));
        assert!(repo.path.join("b.txt").exists());
    }

    #[tokio::test]
    async fn test_checkout_autostash_remote_branch_with_existing_local_uses_local_tip() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature"); // at commit A
        let commit_b = repo.create_commit("B on main", &[("newer.txt", "from B")]);
        repo.create_remote_branch("feature", commit_b);

        let result = checkout_with_autostash(repo.path_str(), "origin/feature".to_string()).await;
        assert!(result.is_ok(), "checkout failed: {:?}", result.err());
        assert!(result.unwrap().success);

        assert_eq!(repo.current_branch(), "feature");
        assert!(
            !repo.path.join("newer.txt").exists(),
            "working tree was checked out from the remote tip instead of the local branch"
        );
        let git_repo = repo.repo();
        let statuses = git_repo.statuses(None).unwrap();
        assert!(
            statuses.is_empty(),
            "unexpected dirty status after checkout"
        );
    }

    #[tokio::test]
    async fn test_checkout_autostash_bad_ref_restores_changes_without_prefix() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file("README.md", "# modified content");

        let result = checkout_with_autostash(repo.path_str(), "no-such-ref".to_string()).await;
        let err = result.expect_err("checkout of a nonexistent ref must fail");
        let msg = err.to_string();
        assert!(
            !msg.contains("RESTORE_STASH:"),
            "internal RESTORE_STASH: prefix leaked into the user-facing error: {msg}"
        );

        // The auto-stashed changes must be restored, not left in the stash
        let contents = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(
            contents, "# modified content",
            "working tree changes were not restored after failed checkout"
        );
        let mut git_repo = repo.repo();
        let mut stash_count = 0;
        git_repo
            .stash_foreach(|_, _, _| {
                stash_count += 1;
                true
            })
            .unwrap();
        assert_eq!(
            stash_count, 0,
            "auto-stash was left behind in the stash list"
        );
    }

    #[tokio::test]
    async fn test_checkout_autostash_preserves_staged_files() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("other");
        repo.create_file("README.md", "# staged change");
        repo.stage_file("README.md");

        let result = checkout_with_autostash(repo.path_str(), "other".to_string()).await;
        assert!(result.is_ok(), "checkout failed: {:?}", result.err());
        let data = result.unwrap();
        assert!(data.success);
        assert!(data.stashed);
        assert!(data.stash_applied);

        assert_eq!(repo.current_branch(), "other");
        let git_repo = repo.repo();
        let statuses = git_repo.statuses(None).unwrap();
        let readme = statuses
            .iter()
            .find(|s| s.path().ok() == Some("README.md"))
            .expect("README.md should still have changes after checkout");
        assert!(
            readme.status().contains(git2::Status::INDEX_MODIFIED),
            "staged change became unstaged across auto-stash checkout (status: {:?})",
            readme.status()
        );
    }

    /// Build a main/feature divergence on shared.txt and leave an UNCOMMITTED
    /// local change to shared.txt (staged when `stage` is true) that conflicts
    /// with feature's version. Ends checked out on the initial branch with the
    /// dirty change present. Returns the initial branch name.
    fn setup_autostash_conflict(repo: &TestRepo, stage: bool) -> String {
        let main = repo.current_branch();
        repo.create_commit("Add shared", &[("shared.txt", "base\n")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature version\n")]);
        repo.checkout_branch(&main);
        // Uncommitted local change that conflicts with feature's version
        repo.create_file("shared.txt", "local edit\n");
        if stage {
            repo.stage_file("shared.txt");
        }
        main
    }

    fn stash_count(repo: &TestRepo) -> usize {
        let mut git_repo = repo.repo();
        let mut count = 0;
        git_repo
            .stash_foreach(|_, _, _| {
                count += 1;
                true
            })
            .unwrap();
        count
    }

    #[tokio::test]
    async fn test_checkout_autostash_unstaged_conflict_keeps_stash() {
        // Empirical scenario (a): an UNSTAGED conflicting change makes the
        // re-apply land conflicts in the index while git2 returns Ok. The stash
        // must be REPORTED as conflicting and PRESERVED (not silently dropped).
        let repo = TestRepo::with_initial_commit();
        setup_autostash_conflict(&repo, false);

        let result = checkout_with_autostash(repo.path_str(), "feature".to_string())
            .await
            .expect("checkout_with_autostash should not hard-error");

        assert!(result.success);
        assert!(result.stashed);
        assert!(!result.stash_applied);
        assert!(
            result.stash_conflict,
            "unstaged conflicting re-apply must report a conflict"
        );

        assert!(
            repo.repo().index().unwrap().has_conflicts(),
            "conflict must land in the index for the resolution flow"
        );
        assert_eq!(
            stash_count(&repo),
            1,
            "stash must be preserved so the user's changes aren't lost"
        );
    }

    #[tokio::test]
    async fn test_checkout_autostash_retry_clean_apply_drops_stash() {
        // Exercises the retry branch where the reinstate-index apply FAILS but the
        // plain retry applies CLEANLY. To reach it we need the STAGED (index)
        // content to conflict with the target while the WORKING content does not:
        //   - staged change edits line 1 (the same line the feature edits) → the
        //     reinstate-index merge conflicts → stash_apply(reinstate) errors.
        //   - a further UNSTAGED edit puts line 1 back to its base value and instead
        //     edits line 10 → the retry's 3-way working merge is CLEAN.
        // The stashed changes are now in the working tree, so the stash MUST be
        // dropped. Before the fix this fell through to the generic failure return
        // (stash kept, stash_applied:false) even though the changes WERE applied,
        // so a later apply would duplicate/conflict.
        let base = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n";
        let feature_ver = "FEATURE\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n";
        // Staged: edits line 1 (overlaps feature → reinstate-index conflict).
        let staged_ver = "STAGED\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n";
        // Working (further unstaged edit): line 1 back to base, line 10 changed
        // (non-overlapping with feature → clean working merge).
        let working_ver = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nWORKING\n";

        let repo = TestRepo::with_initial_commit();
        let main = repo.current_branch();
        repo.create_commit("Add shared", &[("shared.txt", base)]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", feature_ver)]);
        repo.checkout_branch(&main);
        // Stage the line-1 change, then further modify the working tree (line 10)
        // without staging so index and working trees differ.
        repo.create_file("shared.txt", staged_ver);
        repo.stage_file("shared.txt");
        repo.create_file("shared.txt", working_ver);

        let result = checkout_with_autostash(repo.path_str(), "feature".to_string())
            .await
            .expect("checkout_with_autostash should not hard-error");

        assert!(result.success);
        assert!(result.stashed);
        assert!(
            result.stash_applied,
            "a clean retry apply must report the changes as applied: {}",
            result.message
        );
        assert!(
            !result.stash_conflict,
            "a clean retry apply must not report a conflict: {}",
            result.message
        );
        // Confirm we took the RETRY branch (reinstate failed, retry clean), not the
        // first clean apply — that path notes the staged status was not preserved.
        assert!(
            result.message.contains("staged status was not preserved"),
            "expected the retry-clean branch message, got: {}",
            result.message
        );

        // Index must be conflict-free and the merged content present in the tree.
        assert!(!repo.repo().index().unwrap().has_conflicts());
        let merged = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert!(
            merged.contains("FEATURE"),
            "feature edit preserved: {merged}"
        );
        assert!(merged.contains("WORKING"), "stashed edit applied: {merged}");

        // The stash must have been dropped now that the changes are in the tree.
        assert_eq!(
            stash_count(&repo),
            0,
            "stash must be dropped after a clean retry apply"
        );
    }

    #[tokio::test]
    async fn test_checkout_autostash_staged_conflict_keeps_stash() {
        // Empirical scenario (b): a STAGED conflicting change makes the
        // reinstate-index apply fail with ECONFLICT. The retry without
        // reinstating the index lands the conflict in the index; the stash is
        // kept and the conflict is reported.
        let repo = TestRepo::with_initial_commit();
        setup_autostash_conflict(&repo, true);

        let result = checkout_with_autostash(repo.path_str(), "feature".to_string())
            .await
            .expect("checkout_with_autostash should not hard-error");

        assert!(result.success);
        assert!(result.stashed);
        assert!(!result.stash_applied);
        assert!(
            result.stash_conflict,
            "staged conflicting re-apply must report a conflict"
        );

        assert!(
            repo.repo().index().unwrap().has_conflicts(),
            "conflict must land in the index for the resolution flow"
        );
        assert_eq!(
            stash_count(&repo),
            1,
            "stash must be preserved so the user's changes aren't lost"
        );
    }

    // ---- post-checkout hook parity ----

    #[cfg(unix)]
    #[tokio::test]
    async fn test_checkout_runs_post_checkout_hook() {
        let repo = TestRepo::with_initial_commit();
        let main = repo.current_branch();
        let old_head = repo.head_oid();
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature", &[("f.txt", "f")]);
        let feature_head = repo.head_oid();
        repo.checkout_branch(&main);

        let marker = repo.path.join("post-checkout.log");
        repo.install_hook(
            "post-checkout",
            &format!("#!/bin/sh\necho \"$1 $2 $3\" > \"{}\"\n", marker.display()),
        );

        // Switch to feature via the command under test.
        checkout(repo.path_str(), "feature".to_string(), None)
            .await
            .unwrap();

        let logged = std::fs::read_to_string(&marker).expect("post-checkout hook must run");
        let logged = logged.trim();
        assert_eq!(
            logged,
            format!("{} {} 1", old_head, feature_head),
            "post-checkout must receive <old> <new> 1"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_checkout_post_checkout_hook_is_nonblocking() {
        let repo = TestRepo::with_initial_commit();
        let main = repo.current_branch();
        repo.create_branch("feature");
        repo.install_hook("post-checkout", "#!/bin/sh\nexit 1\n");

        // A failing post-checkout hook must NOT fail the checkout.
        let result = checkout(repo.path_str(), "feature".to_string(), None).await;
        assert!(result.is_ok(), "post-checkout is non-blocking");
        assert_eq!(repo.current_branch(), "feature");
        let _ = main;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_checkout_with_autostash_runs_post_checkout_hook() {
        let repo = TestRepo::with_initial_commit();
        let main = repo.current_branch();
        let old_head = repo.head_oid();
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature", &[("f.txt", "f")]);
        let feature_head = repo.head_oid();
        repo.checkout_branch(&main);

        let marker = repo.path.join("post-checkout.log");
        repo.install_hook(
            "post-checkout",
            &format!("#!/bin/sh\necho \"$1 $2 $3\" > \"{}\"\n", marker.display()),
        );

        checkout_with_autostash(repo.path_str(), "feature".to_string())
            .await
            .unwrap();

        let logged = std::fs::read_to_string(&marker).expect("post-checkout hook must run");
        assert_eq!(logged.trim(), format!("{} {} 1", old_head, feature_head));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_create_branch_checkout_runs_post_checkout_hook() {
        let repo = TestRepo::with_initial_commit();
        let marker = repo.path.join("post-checkout.log");
        repo.install_hook(
            "post-checkout",
            &format!("#!/bin/sh\necho \"$3\" > \"{}\"\n", marker.display()),
        );

        create_branch(repo.path_str(), "brand-new".to_string(), None, Some(true))
            .await
            .unwrap();

        let logged = std::fs::read_to_string(&marker).expect("post-checkout hook must run");
        assert_eq!(logged.trim(), "1", "branch-switch flag must be 1");
    }
}
