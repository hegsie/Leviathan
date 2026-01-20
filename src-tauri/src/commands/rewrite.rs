//! Cherry-pick, revert, and reset command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::Commit;

/// Cherry-pick a commit onto the current branch
#[command]
pub async fn cherry_pick(path: String, commit_oid: String) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check for existing operations in progress
    if repo.state() != git2::RepositoryState::Clean {
        match repo.state() {
            git2::RepositoryState::CherryPick | git2::RepositoryState::CherryPickSequence => {
                return Err(LeviathanError::CherryPickInProgress);
            }
            git2::RepositoryState::Revert | git2::RepositoryState::RevertSequence => {
                return Err(LeviathanError::RevertInProgress);
            }
            git2::RepositoryState::Rebase
            | git2::RepositoryState::RebaseInteractive
            | git2::RepositoryState::RebaseMerge => {
                return Err(LeviathanError::RebaseInProgress);
            }
            _ => {
                return Err(LeviathanError::OperationFailed(
                    "Another operation is in progress".to_string(),
                ));
            }
        }
    }

    // Find the commit to cherry-pick
    let oid = git2::Oid::from_str(&commit_oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;

    // Verify commit has a parent (can't cherry-pick root commit)
    if commit.parent_count() == 0 {
        return Err(LeviathanError::OperationFailed(
            "Cannot cherry-pick root commit".to_string(),
        ));
    }

    // Use repo.cherrypick() which properly updates working directory and index
    let mut checkout_builder = git2::build::CheckoutBuilder::new();
    checkout_builder
        .allow_conflicts(true)
        .conflict_style_merge(true);

    let mut opts = git2::CherrypickOptions::new();
    opts.checkout_builder(checkout_builder);

    // For merge commits, specify mainline parent (1 = the branch that was merged into)
    if commit.parent_count() > 1 {
        opts.mainline(1);
    }

    repo.cherrypick(&commit, Some(&mut opts))?;

    // Check if there are conflicts
    let mut index = repo.index()?;
    let has_conflicts = index.has_conflicts();
    tracing::debug!(
        "Cherry-pick completed. has_conflicts: {}, repo_state: {:?}",
        has_conflicts,
        repo.state()
    );

    if has_conflicts {
        tracing::debug!("Returning CherryPickConflict error");
        return Err(LeviathanError::CherryPickConflict);
    }

    // No conflicts - the working directory and index are updated, now create the commit
    let head = repo.head()?.peel_to_commit()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let signature = repo.signature()?;

    let new_oid = repo.commit(
        Some("HEAD"),
        &signature,
        &commit.author(),
        commit.message().unwrap_or(""),
        &tree,
        &[&head],
    )?;

    // Clean up cherry-pick state
    repo.cleanup_state()?;

    let new_commit = repo.find_commit(new_oid)?;
    Ok(Commit::from_git2(&new_commit))
}

/// Continue a cherry-pick after resolving conflicts
#[command]
pub async fn continue_cherry_pick(path: String) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check if we're actually in a cherry-pick state
    let cherry_pick_head_path = Path::new(&path).join(".git/CHERRY_PICK_HEAD");
    if !cherry_pick_head_path.exists() {
        return Err(LeviathanError::OperationFailed(
            "No cherry-pick in progress".to_string(),
        ));
    }

    // Read the original commit OID
    let original_oid_str = std::fs::read_to_string(&cherry_pick_head_path)?
        .trim()
        .to_string();
    let original_oid = git2::Oid::from_str(&original_oid_str)
        .map_err(|_| LeviathanError::CommitNotFound(original_oid_str.clone()))?;
    let original_commit = repo.find_commit(original_oid)?;

    // Check for remaining conflicts
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(LeviathanError::CherryPickConflict);
    }

    // Get the current HEAD
    let head = repo.head()?.peel_to_commit()?;

    // Create the commit
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let signature = repo.signature()?;

    let new_oid = repo.commit(
        Some("HEAD"),
        &signature,
        &original_commit.author(),
        original_commit.message().unwrap_or(""),
        &tree,
        &[&head],
    )?;

    // Clean up cherry-pick state
    std::fs::remove_file(&cherry_pick_head_path)?;
    repo.cleanup_state()?;

    let new_commit = repo.find_commit(new_oid)?;
    Ok(Commit::from_git2(&new_commit))
}

/// Abort a cherry-pick in progress
#[command]
pub async fn abort_cherry_pick(path: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Remove cherry-pick state file if it exists
    let cherry_pick_head_path = Path::new(&path).join(".git/CHERRY_PICK_HEAD");
    if cherry_pick_head_path.exists() {
        std::fs::remove_file(&cherry_pick_head_path)?;
    }

    // Reset to HEAD
    repo.cleanup_state()?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

    Ok(())
}

/// Revert a commit (create a new commit that undoes the changes)
#[command]
pub async fn revert(path: String, commit_oid: String) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check for existing operations in progress
    if repo.state() != git2::RepositoryState::Clean {
        return Err(LeviathanError::OperationFailed(
            "Another operation is in progress".to_string(),
        ));
    }

    // Find the commit to revert
    let oid = git2::Oid::from_str(&commit_oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;

    // Verify commit has a parent (can't revert root commit)
    if commit.parent_count() == 0 {
        return Err(LeviathanError::OperationFailed(
            "Cannot revert root commit".to_string(),
        ));
    }

    // Use repo.revert() which properly updates working directory and index
    let mut checkout_builder = git2::build::CheckoutBuilder::new();
    checkout_builder
        .allow_conflicts(true)
        .conflict_style_merge(true);

    let mut opts = git2::RevertOptions::new();
    opts.checkout_builder(checkout_builder);

    // For merge commits, specify mainline parent (1 = the branch that was merged into)
    if commit.parent_count() > 1 {
        opts.mainline(1);
    }

    repo.revert(&commit, Some(&mut opts))?;

    // Check if there are conflicts
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(LeviathanError::RevertConflict);
    }

    // No conflicts - the working directory and index are updated, now create the commit
    let head = repo.head()?.peel_to_commit()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let signature = repo.signature()?;

    let revert_message = format!(
        "Revert \"{}\"\n\nThis reverts commit {}.",
        commit.summary().unwrap_or(""),
        commit_oid
    );

    let new_oid = repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &revert_message,
        &tree,
        &[&head],
    )?;

    // Clean up revert state
    repo.cleanup_state()?;

    let new_commit = repo.find_commit(new_oid)?;
    Ok(Commit::from_git2(&new_commit))
}

/// Continue a revert after resolving conflicts
#[command]
pub async fn continue_revert(path: String) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check if we're actually in a revert state
    let revert_head_path = Path::new(&path).join(".git/REVERT_HEAD");
    if !revert_head_path.exists() {
        return Err(LeviathanError::OperationFailed(
            "No revert in progress".to_string(),
        ));
    }

    // Read the original commit OID
    let original_oid_str = std::fs::read_to_string(&revert_head_path)?
        .trim()
        .to_string();
    let original_oid = git2::Oid::from_str(&original_oid_str)
        .map_err(|_| LeviathanError::CommitNotFound(original_oid_str.clone()))?;
    let original_commit = repo.find_commit(original_oid)?;

    // Check for remaining conflicts
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(LeviathanError::RevertConflict);
    }

    // Get the current HEAD
    let head = repo.head()?.peel_to_commit()?;

    // Create the revert commit
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let signature = repo.signature()?;

    let revert_message = format!(
        "Revert \"{}\"\n\nThis reverts commit {}.",
        original_commit.summary().unwrap_or(""),
        original_oid_str
    );

    let new_oid = repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &revert_message,
        &tree,
        &[&head],
    )?;

    // Clean up revert state
    std::fs::remove_file(&revert_head_path)?;
    repo.cleanup_state()?;

    let new_commit = repo.find_commit(new_oid)?;
    Ok(Commit::from_git2(&new_commit))
}

/// Abort a revert in progress
#[command]
pub async fn abort_revert(path: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Remove revert state file if it exists
    let revert_head_path = Path::new(&path).join(".git/REVERT_HEAD");
    if revert_head_path.exists() {
        std::fs::remove_file(&revert_head_path)?;
    }

    // Reset to HEAD
    repo.cleanup_state()?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

    Ok(())
}

/// Reset the current branch to a specific commit
#[command]
pub async fn reset(path: String, target_ref: String, mode: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check for existing operations in progress
    if repo.state() != git2::RepositoryState::Clean {
        return Err(LeviathanError::OperationFailed(
            "Another operation is in progress".to_string(),
        ));
    }

    // Find the target commit
    let obj = repo
        .revparse_single(&target_ref)
        .map_err(|_| LeviathanError::CommitNotFound(target_ref.clone()))?;
    let commit = obj
        .peel_to_commit()
        .map_err(|_| LeviathanError::CommitNotFound(target_ref.clone()))?;

    // Determine reset type
    let reset_type = match mode.as_str() {
        "soft" => git2::ResetType::Soft,
        "mixed" => git2::ResetType::Mixed,
        "hard" => git2::ResetType::Hard,
        _ => {
            return Err(LeviathanError::OperationFailed(format!(
                "Invalid reset mode: {}. Use 'soft', 'mixed', or 'hard'",
                mode
            )));
        }
    };

    // Perform the reset
    repo.reset(commit.as_object(), reset_type, None)?;

    Ok(())
}
