//! Merge and rebase command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Merge a branch into HEAD
#[command]
pub async fn merge(
    path: String,
    source_ref: String,
    no_ff: Option<bool>,
    squash: Option<bool>,
    message: Option<String>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Find the commit to merge
    let reference = repo.find_reference(&format!("refs/heads/{}", source_ref))
        .or_else(|_| repo.find_reference(&format!("refs/remotes/{}", source_ref)))
        .or_else(|_| repo.find_reference(&source_ref))?;

    let annotated_commit = repo.reference_to_annotated_commit(&reference)?;
    let (analysis, _preference) = repo.merge_analysis(&[&annotated_commit])?;

    if analysis.is_up_to_date() {
        return Ok(());
    }

    if analysis.is_fast_forward() && !no_ff.unwrap_or(false) && !squash.unwrap_or(false) {
        // Fast-forward merge
        let target_oid = annotated_commit.id();
        let head = repo.head()?;
        let refname = head.name().ok_or_else(|| LeviathanError::InvalidReference)?;

        let mut reference = repo.find_reference(refname)?;
        reference.set_target(target_oid, "Fast-forward merge")?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
    } else {
        // Normal or squash merge
        repo.merge(&[&annotated_commit], None, None)?;

        if repo.index()?.has_conflicts() {
            return Err(LeviathanError::MergeConflict);
        }

        let signature = repo.signature()?;
        let head = repo.head()?.peel_to_commit()?;
        let tree_oid = repo.index()?.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;

        let commit_message = message.unwrap_or_else(|| format!("Merge '{}' into HEAD", source_ref));

        if squash.unwrap_or(false) {
            // Squash merge - single parent
            repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                &commit_message,
                &tree,
                &[&head],
            )?;
        } else {
            // Regular merge - two parents
            let source_commit = repo.find_commit(annotated_commit.id())?;
            repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                &commit_message,
                &tree,
                &[&head, &source_commit],
            )?;
        }

        repo.cleanup_state()?;
    }

    Ok(())
}

/// Abort an in-progress merge
#[command]
pub async fn abort_merge(path: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    repo.cleanup_state()?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
    Ok(())
}

/// Rebase current branch onto another
#[command]
pub async fn rebase(
    path: String,
    onto: String,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Find the onto commit
    let onto_ref = repo.find_reference(&format!("refs/heads/{}", onto))
        .or_else(|_| repo.find_reference(&format!("refs/remotes/{}", onto)))
        .or_else(|_| repo.find_reference(&onto))?;

    let onto_commit = repo.reference_to_annotated_commit(&onto_ref)?;
    let head = repo.head()?;
    let head_commit = repo.reference_to_annotated_commit(&head)?;

    let mut rebase = repo.rebase(
        Some(&head_commit),
        Some(&onto_commit),
        None,
        None,
    )?;

    let signature = repo.signature()?;

    while let Some(op) = rebase.next() {
        let _op = op?;

        // Check for conflicts
        if repo.index()?.has_conflicts() {
            return Err(LeviathanError::RebaseConflict);
        }

        rebase.commit(None, &signature, None)?;
    }

    rebase.finish(Some(&signature))?;

    Ok(())
}

/// Continue a paused rebase
#[command]
pub async fn continue_rebase(path: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut rebase = repo.open_rebase(None)?;
    let signature = repo.signature()?;

    // Commit the current operation
    rebase.commit(None, &signature, None)?;

    // Continue with remaining operations
    while let Some(op) = rebase.next() {
        let _op = op?;

        if repo.index()?.has_conflicts() {
            return Err(LeviathanError::RebaseConflict);
        }

        rebase.commit(None, &signature, None)?;
    }

    rebase.finish(Some(&signature))?;

    Ok(())
}

/// Abort an in-progress rebase
#[command]
pub async fn abort_rebase(path: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut rebase = repo.open_rebase(None)?;
    rebase.abort()?;
    Ok(())
}
