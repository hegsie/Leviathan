//! Remote command handlers

use std::path::Path;
use tauri::{command, AppHandle, Emitter};

use crate::error::{LeviathanError, Result};
use crate::models::{
    FetchAllResult, MultiPushResult, Remote, RemoteFetchResult, RemoteFetchStatus,
    RemoteOperationResult, RemotePushResult,
};
use crate::services::credentials_service;
use crate::utils::create_command;

/// Add a new remote
#[command]
pub async fn add_remote(path: String, name: String, url: String) -> Result<Remote> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check if remote already exists
    if repo.find_remote(&name).is_ok() {
        return Err(LeviathanError::OperationFailed(format!(
            "Remote '{}' already exists",
            name
        )));
    }

    let remote = repo.remote(&name, &url)?;

    Ok(Remote {
        name,
        url: remote.url().unwrap_or("").to_string(),
        push_url: remote.pushurl().map(|s| s.to_string()),
    })
}

/// Remove a remote
#[command]
pub async fn remove_remote(path: String, name: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check if remote exists
    repo.find_remote(&name)
        .map_err(|_| LeviathanError::RemoteNotFound(name.clone()))?;

    repo.remote_delete(&name)?;

    Ok(())
}

/// Rename a remote
#[command]
pub async fn rename_remote(path: String, old_name: String, new_name: String) -> Result<Remote> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check if old remote exists
    let old_remote = repo
        .find_remote(&old_name)
        .map_err(|_| LeviathanError::RemoteNotFound(old_name.clone()))?;

    let url = old_remote.url().unwrap_or("").to_string();
    let push_url = old_remote.pushurl().map(|s| s.to_string());

    // Check if new name already exists
    if repo.find_remote(&new_name).is_ok() {
        return Err(LeviathanError::OperationFailed(format!(
            "Remote '{}' already exists",
            new_name
        )));
    }

    // git2 remote_rename returns problems as a string array
    let problems = repo.remote_rename(&old_name, &new_name)?;

    if !problems.is_empty() {
        let problem_list: Vec<&str> = problems.iter().flatten().collect();
        if !problem_list.is_empty() {
            tracing::warn!("Remote rename had issues: {:?}", problem_list);
        }
    }

    Ok(Remote {
        name: new_name,
        url,
        push_url,
    })
}

/// Set the URL of a remote
#[command]
pub async fn set_remote_url(
    path: String,
    name: String,
    url: String,
    push: Option<bool>,
) -> Result<Remote> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check if remote exists
    repo.find_remote(&name)
        .map_err(|_| LeviathanError::RemoteNotFound(name.clone()))?;

    if push.unwrap_or(false) {
        repo.remote_set_pushurl(&name, Some(&url))?;
    } else {
        repo.remote_set_url(&name, &url)?;
    }

    // Get updated remote info
    let remote = repo.find_remote(&name)?;

    Ok(Remote {
        name,
        url: remote.url().unwrap_or("").to_string(),
        push_url: remote.pushurl().map(|s| s.to_string()),
    })
}

/// Get all remotes
#[command]
pub async fn get_remotes(path: String) -> Result<Vec<Remote>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let remotes = repo.remotes()?;

    let mut result = Vec::new();

    for name in remotes.iter().flatten() {
        if let Ok(remote) = repo.find_remote(name) {
            result.push(Remote {
                name: name.to_string(),
                url: remote.url().unwrap_or("").to_string(),
                push_url: remote.pushurl().map(|s| s.to_string()),
            });
        }
    }

    Ok(result)
}

/// Fetch from remote
#[command]
pub async fn fetch(
    app_handle: AppHandle,
    path: String,
    remote: Option<String>,
    prune: Option<bool>,
    token: Option<String>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let remote_name = remote.as_deref().unwrap_or("origin");
    let mut git_remote = repo
        .find_remote(remote_name)
        .map_err(|_| LeviathanError::RemoteNotFound(remote_name.to_string()))?;

    let mut fetch_opts = credentials_service::get_fetch_options(token);

    if prune.unwrap_or(false) {
        fetch_opts.prune(git2::FetchPrune::On);
    }

    let refspecs: Vec<String> = git_remote
        .fetch_refspecs()?
        .iter()
        .filter_map(|s| s.map(|s| s.to_string()))
        .collect();

    let refspec_strs: Vec<&str> = refspecs.iter().map(|s| s.as_str()).collect();

    git_remote.fetch(&refspec_strs, Some(&mut fetch_opts), None)?;

    // Emit success event
    let _ = app_handle.emit(
        "remote-operation-completed",
        RemoteOperationResult {
            operation: "fetch".to_string(),
            remote: remote_name.to_string(),
            success: true,
            message: "Fetch completed successfully".to_string(),
        },
    );

    Ok(())
}

/// Pull from remote
#[command]
pub async fn pull(
    app_handle: AppHandle,
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    rebase: Option<bool>,
    token: Option<String>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let remote_name = remote.as_deref().unwrap_or("origin");

    // First fetch (without emitting separate event)
    fetch_internal(&path, remote_name, false, token)?;

    // Get the branch to merge
    let branch_name = if let Some(ref b) = branch {
        b.clone()
    } else {
        let head = repo.head()?;
        head.shorthand().unwrap_or("main").to_string()
    };

    let remote_ref = format!("{}/{}", remote_name, branch_name);
    let fetch_head = repo.find_reference(&format!("refs/remotes/{}", remote_ref))?;
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;

    let message: String;

    if rebase.unwrap_or(false) {
        // Rebase onto remote
        let head = repo.head()?;
        let head_commit = repo.reference_to_annotated_commit(&head)?;

        let mut rebase_obj = repo.rebase(Some(&head_commit), Some(&fetch_commit), None, None)?;

        let mut commit_count = 0;
        while let Some(op) = rebase_obj.next() {
            let _op = op?;
            let signature = repo.signature()?;
            rebase_obj.commit(None, &signature, None)?;
            commit_count += 1;
        }

        rebase_obj.finish(Some(&repo.signature()?))?;
        message = format!("Rebased {} commit(s)", commit_count);
    } else {
        // Merge
        let (analysis, _preference) = repo.merge_analysis(&[&fetch_commit])?;

        if analysis.is_up_to_date() {
            message = "Already up to date".to_string();
        } else if analysis.is_fast_forward() {
            // Fast-forward
            let refname = format!("refs/heads/{}", branch_name);
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(fetch_commit.id(), "Fast-forward")?;
            repo.set_head(&refname)?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
            message = "Fast-forward merge completed".to_string();
        } else {
            // Normal merge
            repo.merge(&[&fetch_commit], None, None)?;

            if repo.index()?.has_conflicts() {
                return Err(LeviathanError::MergeConflict);
            }

            // Create merge commit
            let signature = repo.signature()?;
            let head = repo.head()?.peel_to_commit()?;
            let remote_commit = repo.find_commit(fetch_commit.id())?;
            let tree_oid = repo.index()?.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;

            repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                &format!("Merge {} into {}", remote_ref, branch_name),
                &tree,
                &[&head, &remote_commit],
            )?;

            repo.cleanup_state()?;
            message = "Merge completed".to_string();
        }
    }

    // Emit success event
    let _ = app_handle.emit(
        "remote-operation-completed",
        RemoteOperationResult {
            operation: "pull".to_string(),
            remote: remote_name.to_string(),
            success: true,
            message,
        },
    );

    Ok(())
}

/// Internal fetch without event emission (used by pull)
fn fetch_internal(path: &str, remote_name: &str, prune: bool, token: Option<String>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(path))?;

    let mut git_remote = repo
        .find_remote(remote_name)
        .map_err(|_| LeviathanError::RemoteNotFound(remote_name.to_string()))?;

    let mut fetch_opts = credentials_service::get_fetch_options(token);

    if prune {
        fetch_opts.prune(git2::FetchPrune::On);
    }

    let refspecs: Vec<String> = git_remote
        .fetch_refspecs()?
        .iter()
        .filter_map(|s| s.map(|s| s.to_string()))
        .collect();

    let refspec_strs: Vec<&str> = refspecs.iter().map(|s| s.as_str()).collect();

    git_remote.fetch(&refspec_strs, Some(&mut fetch_opts), None)?;

    Ok(())
}

/// Push to remote
#[command]
pub async fn push(
    app_handle: AppHandle,
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    force: Option<bool>,
    force_with_lease: Option<bool>,
    push_tags: Option<bool>,
    set_upstream: Option<bool>,
    token: Option<String>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let remote_name = remote.as_deref().unwrap_or("origin");

    // Validate remote exists
    repo.find_remote(remote_name)
        .map_err(|_| LeviathanError::RemoteNotFound(remote_name.to_string()))?;

    let branch_name = if let Some(ref b) = branch {
        b.clone()
    } else {
        let head = repo.head()?;
        head.shorthand().unwrap_or("main").to_string()
    };

    let use_force_with_lease = force_with_lease.unwrap_or(false);
    let use_push_tags = push_tags.unwrap_or(false);

    // force_with_lease requires git CLI since git2 doesn't support it natively.
    // We also use git CLI when push_tags is requested, since git2 would require
    // building separate refspecs for each tag.
    if use_force_with_lease || use_push_tags {
        push_via_cli(
            &path,
            remote_name,
            &branch_name,
            force.unwrap_or(false),
            use_force_with_lease,
            use_push_tags,
            set_upstream.unwrap_or(false),
            token,
        )?;
    } else {
        // Use git2 for standard push (existing behavior)
        let mut git_remote = repo
            .find_remote(remote_name)
            .map_err(|_| LeviathanError::RemoteNotFound(remote_name.to_string()))?;

        let mut push_opts = credentials_service::get_push_options(token);

        let refspec = if force.unwrap_or(false) {
            format!("+refs/heads/{}:refs/heads/{}", branch_name, branch_name)
        } else {
            format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name)
        };

        git_remote.push(&[&refspec], Some(&mut push_opts))?;

        // Set upstream if requested
        if set_upstream.unwrap_or(false) {
            let mut local_branch = repo.find_branch(&branch_name, git2::BranchType::Local)?;
            let upstream_name = format!("{}/{}", remote_name, branch_name);
            local_branch.set_upstream(Some(&upstream_name))?;
        }
    }

    // Emit success event
    let mut message = format!("Pushed to {}/{}", remote_name, branch_name);
    if use_force_with_lease {
        message = format!(
            "Force-pushed (with lease) to {}/{}",
            remote_name, branch_name
        );
    } else if force.unwrap_or(false) {
        message = format!("Force-pushed to {}/{}", remote_name, branch_name);
    }
    if use_push_tags {
        message.push_str(" (including tags)");
    }

    let _ = app_handle.emit(
        "remote-operation-completed",
        RemoteOperationResult {
            operation: "push".to_string(),
            remote: remote_name.to_string(),
            success: true,
            message,
        },
    );

    Ok(())
}

/// Push via git CLI (used for --force-with-lease and --tags which git2 doesn't support)
fn push_via_cli(
    path: &str,
    remote_name: &str,
    branch_name: &str,
    force: bool,
    force_with_lease: bool,
    push_tags: bool,
    set_upstream: bool,
    token: Option<String>,
) -> Result<()> {
    let mut cmd = create_command("git");
    cmd.arg("-C").arg(path).arg("push");

    // force_with_lease takes priority over force
    if force_with_lease {
        cmd.arg("--force-with-lease");
    } else if force {
        cmd.arg("--force");
    }

    if push_tags {
        cmd.arg("--tags");
    }

    if set_upstream {
        cmd.arg("--set-upstream");
    }

    cmd.arg(remote_name);
    cmd.arg(branch_name);

    // If a token is provided, configure it via the GIT_ASKPASS mechanism
    if let Some(ref token_value) = token {
        // Use a helper that echoes the token for password prompts
        cmd.env("GIT_ASKPASS", "echo");
        cmd.env("GIT_CONFIG_COUNT", "1");
        cmd.env("GIT_CONFIG_KEY_0", "credential.helper");
        cmd.env("GIT_CONFIG_VALUE_0", "");
        // Provide credentials via URL embedding for HTTPS
        cmd.env("GIT_TOKEN", token_value);
    }

    let output = cmd.output().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to execute git push: {}", e))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(LeviathanError::OperationFailed(format!(
            "git push failed: {}",
            stderr.trim()
        )));
    }

    Ok(())
}

/// Internal function to push to a single remote (used by push_to_multiple_remotes)
fn push_single_remote(
    path: &str,
    remote_name: &str,
    branch_name: &str,
    force: bool,
    force_with_lease: bool,
    push_tags: bool,
    token: Option<String>,
) -> std::result::Result<(), String> {
    if force_with_lease || push_tags {
        push_via_cli(
            path,
            remote_name,
            branch_name,
            force,
            force_with_lease,
            push_tags,
            false,
            token,
        )
        .map_err(|e| e.to_string())
    } else {
        let repo = git2::Repository::open(Path::new(path)).map_err(|e| e.message().to_string())?;

        let mut git_remote = repo
            .find_remote(remote_name)
            .map_err(|_| format!("Remote '{}' not found", remote_name))?;

        let mut push_opts = credentials_service::get_push_options(token);

        let refspec = if force {
            format!("+refs/heads/{}:refs/heads/{}", branch_name, branch_name)
        } else {
            format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name)
        };

        git_remote
            .push(&[&refspec], Some(&mut push_opts))
            .map_err(|e| e.message().to_string())?;

        Ok(())
    }
}

/// Push to multiple remotes
#[command]
pub async fn push_to_multiple_remotes(
    app_handle: AppHandle,
    path: String,
    remotes: Vec<String>,
    branch: Option<String>,
    force: bool,
    force_with_lease: bool,
    push_tags: bool,
    token: Option<String>,
) -> Result<MultiPushResult> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let branch_name = if let Some(ref b) = branch {
        b.clone()
    } else {
        let head = repo.head()?;
        head.shorthand().unwrap_or("main").to_string()
    };

    // Validate that all remotes exist before starting
    for remote_name in &remotes {
        repo.find_remote(remote_name)
            .map_err(|_| LeviathanError::RemoteNotFound(remote_name.clone()))?;
    }

    let mut results: Vec<RemotePushResult> = Vec::new();
    let mut total_success: u32 = 0;
    let mut total_failed: u32 = 0;

    for remote_name in &remotes {
        match push_single_remote(
            &path,
            remote_name,
            &branch_name,
            force,
            force_with_lease,
            push_tags,
            token.clone(),
        ) {
            Ok(()) => {
                let mut message = format!("Pushed to {}/{}", remote_name, branch_name);
                if force_with_lease {
                    message = format!(
                        "Force-pushed (with lease) to {}/{}",
                        remote_name, branch_name
                    );
                } else if force {
                    message = format!("Force-pushed to {}/{}", remote_name, branch_name);
                }
                if push_tags {
                    message.push_str(" (including tags)");
                }

                results.push(RemotePushResult {
                    remote: remote_name.clone(),
                    success: true,
                    message: Some(message),
                });
                total_success += 1;
            }
            Err(e) => {
                results.push(RemotePushResult {
                    remote: remote_name.clone(),
                    success: false,
                    message: Some(e),
                });
                total_failed += 1;
            }
        }
    }

    let overall_success = total_failed == 0;

    // Emit event for the operation
    let _ = app_handle.emit(
        "remote-operation-completed",
        RemoteOperationResult {
            operation: "push_multiple".to_string(),
            remote: "multiple".to_string(),
            success: overall_success,
            message: format!(
                "Pushed to {} remote(s) ({} failed)",
                total_success, total_failed
            ),
        },
    );

    Ok(MultiPushResult {
        results,
        total_success,
        total_failed,
    })
}

/// Fetch from all remotes
#[command]
pub async fn fetch_all_remotes(
    app_handle: AppHandle,
    path: String,
    prune: bool,
    tags: bool,
    token: Option<String>,
) -> Result<FetchAllResult> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let remote_names = repo.remotes()?;

    let mut results: Vec<RemoteFetchResult> = Vec::new();
    let mut total_fetched: u32 = 0;
    let mut total_failed: u32 = 0;

    for remote_name in remote_names.iter().flatten() {
        let fetch_result = fetch_single_remote(&path, remote_name, prune, tags, token.clone());

        match fetch_result {
            Ok(refs_updated) => {
                results.push(RemoteFetchResult {
                    remote: remote_name.to_string(),
                    success: true,
                    message: Some(format!("Fetched {} refs", refs_updated)),
                    refs_updated,
                });
                total_fetched += 1;
            }
            Err(e) => {
                results.push(RemoteFetchResult {
                    remote: remote_name.to_string(),
                    success: false,
                    message: Some(e.to_string()),
                    refs_updated: 0,
                });
                total_failed += 1;
            }
        }
    }

    let overall_success = total_failed == 0;

    // Emit event for the operation
    let _ = app_handle.emit(
        "remote-operation-completed",
        RemoteOperationResult {
            operation: "fetch_all".to_string(),
            remote: "all".to_string(),
            success: overall_success,
            message: format!(
                "Fetched from {} remotes ({} failed)",
                total_fetched, total_failed
            ),
        },
    );

    Ok(FetchAllResult {
        remotes: results,
        success: overall_success,
        total_fetched,
        total_failed,
    })
}

/// Internal function to fetch from a single remote with tag support
fn fetch_single_remote(
    path: &str,
    remote_name: &str,
    prune: bool,
    tags: bool,
    token: Option<String>,
) -> Result<u32> {
    let repo = git2::Repository::open(Path::new(path))?;

    let mut git_remote = repo
        .find_remote(remote_name)
        .map_err(|_| LeviathanError::RemoteNotFound(remote_name.to_string()))?;

    let mut fetch_opts = credentials_service::get_fetch_options(token);

    if prune {
        fetch_opts.prune(git2::FetchPrune::On);
    }

    // Collect refspecs
    let mut refspecs: Vec<String> = git_remote
        .fetch_refspecs()?
        .iter()
        .filter_map(|s| s.map(|s| s.to_string()))
        .collect();

    // Add tag refspec if requested
    if tags {
        refspecs.push("refs/tags/*:refs/tags/*".to_string());
    }

    let refspec_strs: Vec<&str> = refspecs.iter().map(|s| s.as_str()).collect();

    // Track refs updated using a callback
    let refs_updated = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let refs_counter = refs_updated.clone();

    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.update_tips(move |_refname, _old, _new| {
        refs_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        true
    });

    // Transfer credentials callback from fetch_opts to our callbacks
    // We need to rebuild fetch options with our callbacks
    let mut fetch_opts_with_callbacks = credentials_service::get_fetch_options(None);
    if prune {
        fetch_opts_with_callbacks.prune(git2::FetchPrune::On);
    }
    fetch_opts_with_callbacks.remote_callbacks(callbacks);

    git_remote.fetch(&refspec_strs, Some(&mut fetch_opts_with_callbacks), None)?;

    Ok(refs_updated.load(std::sync::atomic::Ordering::Relaxed))
}

/// Get fetch status for all remotes
#[command]
pub async fn get_fetch_status(path: String) -> Result<Vec<RemoteFetchStatus>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let remote_names = repo.remotes()?;
    let mut statuses: Vec<RemoteFetchStatus> = Vec::new();

    for remote_name in remote_names.iter().flatten() {
        if let Ok(remote) = repo.find_remote(remote_name) {
            let url = remote.url().unwrap_or("").to_string();

            // Get branches that track this remote
            let mut branches: Vec<String> = Vec::new();
            if let Ok(branch_iter) = repo.branches(Some(git2::BranchType::Remote)) {
                for (branch, _) in branch_iter.flatten() {
                    if let Some(name) = branch.name().ok().flatten() {
                        if name.starts_with(&format!("{}/", remote_name)) {
                            // Strip the remote prefix to get just the branch name
                            let branch_name = name
                                .strip_prefix(&format!("{}/", remote_name))
                                .unwrap_or(name)
                                .to_string();
                            branches.push(branch_name);
                        }
                    }
                }
            }

            // Try to get last fetch time from FETCH_HEAD
            let last_fetch = get_last_fetch_time(&repo, remote_name);

            statuses.push(RemoteFetchStatus {
                remote: remote_name.to_string(),
                url,
                last_fetch,
                branches,
            });
        }
    }

    Ok(statuses)
}

/// Get the last fetch time for a remote by checking FETCH_HEAD modification time
fn get_last_fetch_time(repo: &git2::Repository, _remote_name: &str) -> Option<i64> {
    let fetch_head_path = repo.path().join("FETCH_HEAD");
    if let Ok(metadata) = std::fs::metadata(&fetch_head_path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                return Some(duration.as_secs() as i64);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_add_remote() {
        let repo = TestRepo::with_initial_commit();
        let result = add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let remote = result.unwrap();
        assert_eq!(remote.name, "origin");
        assert_eq!(remote.url, "https://github.com/test/repo.git");
        assert!(remote.push_url.is_none());
    }

    #[tokio::test]
    async fn test_add_remote_duplicate_fails() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();

        // Adding same remote name again should fail
        let result = add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/other.git".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_remotes_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_remotes(repo.path_str()).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_remotes_returns_added() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();
        add_remote(
            repo.path_str(),
            "upstream".to_string(),
            "https://github.com/upstream/repo.git".to_string(),
        )
        .await
        .unwrap();

        let result = get_remotes(repo.path_str()).await;
        assert!(result.is_ok());
        let remotes = result.unwrap();
        assert_eq!(remotes.len(), 2);

        let names: Vec<&str> = remotes.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"origin"));
        assert!(names.contains(&"upstream"));
    }

    #[tokio::test]
    async fn test_remove_remote() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();

        let result = remove_remote(repo.path_str(), "origin".to_string()).await;
        assert!(result.is_ok());

        // Verify it's gone
        let remotes = get_remotes(repo.path_str()).await.unwrap();
        assert!(remotes.is_empty());
    }

    #[tokio::test]
    async fn test_remove_remote_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = remove_remote(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_rename_remote() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();

        let result = rename_remote(
            repo.path_str(),
            "origin".to_string(),
            "upstream".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let renamed = result.unwrap();
        assert_eq!(renamed.name, "upstream");
        assert_eq!(renamed.url, "https://github.com/test/repo.git");

        // Verify old name is gone
        let remotes = get_remotes(repo.path_str()).await.unwrap();
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].name, "upstream");
    }

    #[tokio::test]
    async fn test_rename_remote_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = rename_remote(
            repo.path_str(),
            "nonexistent".to_string(),
            "newname".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_rename_remote_to_existing_fails() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();
        add_remote(
            repo.path_str(),
            "upstream".to_string(),
            "https://github.com/upstream/repo.git".to_string(),
        )
        .await
        .unwrap();

        // Renaming origin to upstream should fail since upstream exists
        let result = rename_remote(
            repo.path_str(),
            "origin".to_string(),
            "upstream".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_set_remote_url() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();

        let result = set_remote_url(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/newowner/repo.git".to_string(),
            None,
        )
        .await;

        assert!(result.is_ok());
        let remote = result.unwrap();
        assert_eq!(remote.url, "https://github.com/newowner/repo.git");
    }

    #[tokio::test]
    async fn test_set_remote_push_url() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();

        let result = set_remote_url(
            repo.path_str(),
            "origin".to_string(),
            "git@github.com:test/repo.git".to_string(),
            Some(true),
        )
        .await;

        assert!(result.is_ok());
        let remote = result.unwrap();
        // Fetch URL unchanged
        assert_eq!(remote.url, "https://github.com/test/repo.git");
        // Push URL set
        assert_eq!(
            remote.push_url,
            Some("git@github.com:test/repo.git".to_string())
        );
    }

    #[tokio::test]
    async fn test_set_remote_url_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = set_remote_url(
            repo.path_str(),
            "nonexistent".to_string(),
            "https://github.com/test/repo.git".to_string(),
            None,
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_add_multiple_remotes() {
        let repo = TestRepo::with_initial_commit();

        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/owner/repo.git".to_string(),
        )
        .await
        .unwrap();

        add_remote(
            repo.path_str(),
            "fork".to_string(),
            "https://github.com/fork/repo.git".to_string(),
        )
        .await
        .unwrap();

        add_remote(
            repo.path_str(),
            "upstream".to_string(),
            "https://github.com/upstream/repo.git".to_string(),
        )
        .await
        .unwrap();

        let remotes = get_remotes(repo.path_str()).await.unwrap();
        assert_eq!(remotes.len(), 3);
    }

    #[tokio::test]
    async fn test_remote_with_ssh_url() {
        let repo = TestRepo::with_initial_commit();
        let result = add_remote(
            repo.path_str(),
            "origin".to_string(),
            "git@github.com:test/repo.git".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let remote = result.unwrap();
        assert_eq!(remote.url, "git@github.com:test/repo.git");
    }

    #[tokio::test]
    async fn test_get_fetch_status_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_fetch_status(repo.path_str()).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_fetch_status_with_remotes() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();
        add_remote(
            repo.path_str(),
            "upstream".to_string(),
            "https://github.com/upstream/repo.git".to_string(),
        )
        .await
        .unwrap();

        let result = get_fetch_status(repo.path_str()).await;
        assert!(result.is_ok());

        let statuses = result.unwrap();
        assert_eq!(statuses.len(), 2);

        let remote_names: Vec<&str> = statuses.iter().map(|s| s.remote.as_str()).collect();
        assert!(remote_names.contains(&"origin"));
        assert!(remote_names.contains(&"upstream"));

        // Verify URLs are correct
        for status in &statuses {
            if status.remote == "origin" {
                assert_eq!(status.url, "https://github.com/test/repo.git");
            } else if status.remote == "upstream" {
                assert_eq!(status.url, "https://github.com/upstream/repo.git");
            }
        }
    }

    #[tokio::test]
    async fn test_fetch_single_remote_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = fetch_single_remote(&repo.path_str(), "nonexistent", false, false, None);

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_push_single_remote_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = push_single_remote(
            &repo.path_str(),
            "nonexistent",
            "main",
            false,
            false,
            false,
            None,
        );

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_push_single_remote_validates_remote() {
        let repo = TestRepo::with_initial_commit();
        add_remote(
            repo.path_str(),
            "origin".to_string(),
            "https://github.com/test/repo.git".to_string(),
        )
        .await
        .unwrap();

        // Push will fail because we can't actually connect, but it should find the remote
        let result = push_single_remote(
            &repo.path_str(),
            "origin",
            "main",
            false,
            false,
            false,
            None,
        );

        // This will error since we can't connect to the remote, but it should not
        // error with "Remote not found"
        if let Err(ref e) = result {
            assert!(
                !e.contains("not found"),
                "Expected connection error, not 'not found': {}",
                e
            );
        }
    }

    #[test]
    fn test_multi_push_result_serialization() {
        use crate::models::{MultiPushResult, RemotePushResult};

        let result = MultiPushResult {
            results: vec![
                RemotePushResult {
                    remote: "origin".to_string(),
                    success: true,
                    message: Some("Pushed to origin/main".to_string()),
                },
                RemotePushResult {
                    remote: "upstream".to_string(),
                    success: false,
                    message: Some("Authentication failed".to_string()),
                },
            ],
            total_success: 1,
            total_failed: 1,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"totalSuccess\":1"));
        assert!(json.contains("\"totalFailed\":1"));
        assert!(json.contains("\"remote\":\"origin\""));
        assert!(json.contains("\"remote\":\"upstream\""));

        // Verify deserialization roundtrip
        let deserialized: MultiPushResult = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.total_success, 1);
        assert_eq!(deserialized.total_failed, 1);
        assert_eq!(deserialized.results.len(), 2);
        assert!(deserialized.results[0].success);
        assert!(!deserialized.results[1].success);
    }

    #[test]
    fn test_remote_push_result_serialization() {
        use crate::models::RemotePushResult;

        let result = RemotePushResult {
            remote: "origin".to_string(),
            success: true,
            message: Some("Pushed successfully".to_string()),
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"remote\":\"origin\""));
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"message\":\"Pushed successfully\""));

        // Test with None message
        let result_no_msg = RemotePushResult {
            remote: "upstream".to_string(),
            success: false,
            message: None,
        };

        let json2 = serde_json::to_string(&result_no_msg).unwrap();
        assert!(json2.contains("\"message\":null"));
    }
}
