//! Remote command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::Remote;

/// Get all remotes
#[command]
pub async fn get_remotes(path: String) -> Result<Vec<Remote>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let remotes = repo.remotes()?;

    let mut result = Vec::new();

    for name in remotes.iter() {
        if let Some(name) = name {
            if let Ok(remote) = repo.find_remote(name) {
                result.push(Remote {
                    name: name.to_string(),
                    url: remote.url().unwrap_or("").to_string(),
                    push_url: remote.pushurl().map(|s| s.to_string()),
                });
            }
        }
    }

    Ok(result)
}

/// Fetch from remote
#[command]
pub async fn fetch(path: String, remote: Option<String>, prune: Option<bool>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let remote_name = remote.as_deref().unwrap_or("origin");
    let mut remote = repo
        .find_remote(remote_name)
        .map_err(|_| LeviathanError::RemoteNotFound(remote_name.to_string()))?;

    let mut fetch_opts = git2::FetchOptions::new();

    if prune.unwrap_or(false) {
        fetch_opts.prune(git2::FetchPrune::On);
    }

    // TODO: Add credential callbacks
    // TODO: Add progress callbacks

    let refspecs: Vec<String> = remote
        .fetch_refspecs()?
        .iter()
        .filter_map(|s| s.map(|s| s.to_string()))
        .collect();

    let refspec_strs: Vec<&str> = refspecs.iter().map(|s| s.as_str()).collect();

    remote.fetch(&refspec_strs, Some(&mut fetch_opts), None)?;

    Ok(())
}

/// Pull from remote
#[command]
pub async fn pull(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    rebase: Option<bool>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let remote_name = remote.as_deref().unwrap_or("origin");

    // First fetch
    fetch(path.clone(), Some(remote_name.to_string()), None).await?;

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

    if rebase.unwrap_or(false) {
        // Rebase onto remote
        let head = repo.head()?;
        let head_commit = repo.reference_to_annotated_commit(&head)?;

        let mut rebase = repo.rebase(Some(&head_commit), Some(&fetch_commit), None, None)?;

        while let Some(op) = rebase.next() {
            let _op = op?;
            let signature = repo.signature()?;
            rebase.commit(None, &signature, None)?;
        }

        rebase.finish(Some(&repo.signature()?))?;
    } else {
        // Merge
        let (analysis, _preference) = repo.merge_analysis(&[&fetch_commit])?;

        if analysis.is_up_to_date() {
            // Nothing to do
        } else if analysis.is_fast_forward() {
            // Fast-forward
            let refname = format!("refs/heads/{}", branch_name);
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(fetch_commit.id(), "Fast-forward")?;
            repo.set_head(&refname)?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
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
        }
    }

    Ok(())
}

/// Push to remote
#[command]
pub async fn push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    force: Option<bool>,
    set_upstream: Option<bool>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let remote_name = remote.as_deref().unwrap_or("origin");
    let mut remote = repo
        .find_remote(remote_name)
        .map_err(|_| LeviathanError::RemoteNotFound(remote_name.to_string()))?;

    let branch_name = if let Some(ref b) = branch {
        b.clone()
    } else {
        let head = repo.head()?;
        head.shorthand().unwrap_or("main").to_string()
    };

    let mut push_opts = git2::PushOptions::new();
    // TODO: Add credential callbacks

    let refspec = if force.unwrap_or(false) {
        format!("+refs/heads/{}:refs/heads/{}", branch_name, branch_name)
    } else {
        format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name)
    };

    remote.push(&[&refspec], Some(&mut push_opts))?;

    // Set upstream if requested
    if set_upstream.unwrap_or(false) {
        let mut local_branch = repo.find_branch(&branch_name, git2::BranchType::Local)?;
        let upstream_name = format!("{}/{}", remote_name, branch_name);
        local_branch.set_upstream(Some(&upstream_name))?;
    }

    Ok(())
}
