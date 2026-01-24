//! Cherry-pick, revert, and reset command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::Commit;

/// Cherry-pick a commit onto the current branch
///
/// Options:
/// - `no_commit`: If true, stages changes without committing (like `git cherry-pick -n`)
#[command]
pub async fn cherry_pick(
    path: String,
    commit_oid: String,
    no_commit: Option<bool>,
) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let no_commit = no_commit.unwrap_or(false);

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
        "Cherry-pick completed. has_conflicts: {}, repo_state: {:?}, no_commit: {}",
        has_conflicts,
        repo.state(),
        no_commit
    );

    if has_conflicts {
        tracing::debug!("Returning CherryPickConflict error");
        return Err(LeviathanError::CherryPickConflict);
    }

    // If no_commit is true, just stage the changes without committing
    if no_commit {
        // Clean up cherry-pick state but keep the staged changes
        repo.cleanup_state()?;
        // Return the original commit info since we didn't create a new one
        return Ok(Commit::from_git2(&commit));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    // ==================== Cherry-Pick Tests ====================

    #[tokio::test]
    async fn test_cherry_pick_success() {
        // Setup: Create repo with main branch, create feature branch with a commit,
        // then cherry-pick that commit to main
        let test_repo = TestRepo::with_initial_commit();
        let initial_main_head = test_repo.head_oid();

        // Create a feature branch and add a commit
        test_repo.create_branch("feature");
        test_repo.checkout_branch("feature");
        let feature_commit_oid =
            test_repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);

        // Switch back to main
        test_repo.checkout_branch("main");

        // Verify main is still at initial commit
        assert_eq!(test_repo.head_oid(), initial_main_head);

        // Verify feature.txt doesn't exist on main
        assert!(!test_repo.path.join("feature.txt").exists());

        // Cherry-pick the feature commit
        let result = cherry_pick(test_repo.path_str(), feature_commit_oid.to_string(), None).await;

        assert!(result.is_ok(), "Cherry-pick should succeed");
        let new_commit = result.unwrap();

        // Verify the commit message was preserved
        assert_eq!(new_commit.summary, "Feature commit");

        // Verify main HEAD has advanced (new commit was created)
        assert_ne!(test_repo.head_oid(), initial_main_head);

        // Verify the file now exists on main
        assert!(test_repo.path.join("feature.txt").exists());
        let content = std::fs::read_to_string(test_repo.path.join("feature.txt")).unwrap();
        assert_eq!(content, "feature content");

        // Verify we're still on main
        assert_eq!(test_repo.current_branch(), "main");

        // Verify repo state is clean
        assert_eq!(test_repo.repo().state(), git2::RepositoryState::Clean);
    }

    #[tokio::test]
    async fn test_cherry_pick_no_commit_option() {
        // Test cherry-pick with no_commit=true (stages changes without committing)
        let test_repo = TestRepo::with_initial_commit();
        let initial_head = test_repo.head_oid();

        // Create a feature branch and add a commit
        test_repo.create_branch("feature");
        test_repo.checkout_branch("feature");
        let feature_commit_oid =
            test_repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);

        // Switch back to main
        test_repo.checkout_branch("main");

        // Cherry-pick with no_commit=true
        let result = cherry_pick(
            test_repo.path_str(),
            feature_commit_oid.to_string(),
            Some(true),
        )
        .await;

        assert!(result.is_ok(), "Cherry-pick with no_commit should succeed");

        // Verify HEAD hasn't changed (no new commit created)
        assert_eq!(test_repo.head_oid(), initial_head);

        // Verify the file exists in working directory
        assert!(test_repo.path.join("feature.txt").exists());

        // Verify changes are staged
        let repo = test_repo.repo();
        let index = repo.index().unwrap();
        let entry = index.get_path(std::path::Path::new("feature.txt"), 0);
        assert!(entry.is_some(), "feature.txt should be staged");

        // Verify repo state is clean (no cherry-pick in progress)
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    #[tokio::test]
    async fn test_cherry_pick_conflict() {
        // Test cherry-pick that results in a conflict
        let test_repo = TestRepo::with_initial_commit();

        // Create a file on main
        test_repo.create_commit("Add conflict file", &[("conflict.txt", "main content")]);

        // Create a feature branch from initial commit and modify same file
        test_repo.checkout_branch("main");
        let repo = test_repo.repo();
        let head = repo.head().unwrap();
        let head_commit = head.peel_to_commit().unwrap();
        let parent = head_commit.parent(0).unwrap();

        // Create branch from parent (before conflict.txt was added)
        repo.branch("feature", &parent, false).unwrap();
        test_repo.checkout_branch("feature");

        // Add the same file with different content
        let feature_commit_oid =
            test_repo.create_commit("Feature conflict", &[("conflict.txt", "feature content")]);

        // Switch back to main
        test_repo.checkout_branch("main");

        // Cherry-pick should result in conflict
        let result = cherry_pick(test_repo.path_str(), feature_commit_oid.to_string(), None).await;

        assert!(result.is_err(), "Cherry-pick should fail with conflict");
        let err = result.unwrap_err();
        assert!(
            matches!(err, LeviathanError::CherryPickConflict),
            "Error should be CherryPickConflict"
        );

        // Verify repo is in cherry-pick state
        let repo = test_repo.repo();
        assert_eq!(repo.state(), git2::RepositoryState::CherryPick);

        // Verify CHERRY_PICK_HEAD exists
        let cherry_pick_head = test_repo.path.join(".git/CHERRY_PICK_HEAD");
        assert!(cherry_pick_head.exists(), "CHERRY_PICK_HEAD should exist");
    }

    #[tokio::test]
    async fn test_cherry_pick_abort() {
        // Test aborting a cherry-pick in progress
        let test_repo = TestRepo::with_initial_commit();

        // Create a conflict scenario (same as above)
        test_repo.create_commit("Add conflict file", &[("conflict.txt", "main content")]);

        let repo = test_repo.repo();
        let head = repo.head().unwrap();
        let head_commit = head.peel_to_commit().unwrap();
        let parent = head_commit.parent(0).unwrap();

        repo.branch("feature", &parent, false).unwrap();
        test_repo.checkout_branch("feature");
        let feature_commit_oid =
            test_repo.create_commit("Feature conflict", &[("conflict.txt", "feature content")]);

        test_repo.checkout_branch("main");

        // Cherry-pick to create conflict
        let _ = cherry_pick(test_repo.path_str(), feature_commit_oid.to_string(), None).await;

        // Verify we're in cherry-pick state
        assert_eq!(test_repo.repo().state(), git2::RepositoryState::CherryPick);

        // Abort the cherry-pick
        let abort_result = abort_cherry_pick(test_repo.path_str()).await;
        assert!(abort_result.is_ok(), "Abort should succeed");

        // Verify repo state is clean
        assert_eq!(test_repo.repo().state(), git2::RepositoryState::Clean);

        // Verify CHERRY_PICK_HEAD is removed
        let cherry_pick_head = test_repo.path.join(".git/CHERRY_PICK_HEAD");
        assert!(
            !cherry_pick_head.exists(),
            "CHERRY_PICK_HEAD should be removed"
        );

        // Verify working directory is clean (conflict file has original content)
        let content = std::fs::read_to_string(test_repo.path.join("conflict.txt")).unwrap();
        assert_eq!(content, "main content");
    }

    #[tokio::test]
    async fn test_cherry_pick_continue_after_resolve() {
        // Test continuing cherry-pick after manually resolving conflicts
        let test_repo = TestRepo::with_initial_commit();

        // Create a conflict scenario
        test_repo.create_commit("Add conflict file", &[("conflict.txt", "main content")]);

        let repo = test_repo.repo();
        let head = repo.head().unwrap();
        let head_commit = head.peel_to_commit().unwrap();
        let parent = head_commit.parent(0).unwrap();

        repo.branch("feature", &parent, false).unwrap();
        test_repo.checkout_branch("feature");
        let feature_commit_oid =
            test_repo.create_commit("Feature conflict", &[("conflict.txt", "feature content")]);

        test_repo.checkout_branch("main");
        let main_head_before = test_repo.head_oid();

        // Cherry-pick to create conflict
        let _ = cherry_pick(test_repo.path_str(), feature_commit_oid.to_string(), None).await;

        // Manually resolve the conflict by writing resolved content
        std::fs::write(test_repo.path.join("conflict.txt"), "resolved content").unwrap();

        // Stage the resolved file
        let repo = test_repo.repo();
        let mut index = repo.index().unwrap();
        index
            .add_path(std::path::Path::new("conflict.txt"))
            .unwrap();
        index.write().unwrap();

        // Continue the cherry-pick
        let continue_result = continue_cherry_pick(test_repo.path_str()).await;
        assert!(continue_result.is_ok(), "Continue should succeed");

        let new_commit = continue_result.unwrap();
        assert_eq!(new_commit.summary, "Feature conflict");

        // Verify a new commit was created
        assert_ne!(test_repo.head_oid(), main_head_before);

        // Verify repo state is clean
        assert_eq!(test_repo.repo().state(), git2::RepositoryState::Clean);

        // Verify CHERRY_PICK_HEAD is removed
        let cherry_pick_head = test_repo.path.join(".git/CHERRY_PICK_HEAD");
        assert!(!cherry_pick_head.exists());

        // Verify resolved content is in the commit
        let content = std::fs::read_to_string(test_repo.path.join("conflict.txt")).unwrap();
        assert_eq!(content, "resolved content");
    }

    #[tokio::test]
    async fn test_cherry_pick_cannot_pick_root_commit() {
        // Test that cherry-picking a root commit fails
        let test_repo = TestRepo::new();

        // Create a single commit (root commit)
        let root_oid = test_repo.create_commit("Root commit", &[("file.txt", "content")]);

        // Try to cherry-pick the root commit
        let result = cherry_pick(test_repo.path_str(), root_oid.to_string(), None).await;

        assert!(
            result.is_err(),
            "Should not be able to cherry-pick root commit"
        );
        let err = result.unwrap_err();
        assert!(matches!(err, LeviathanError::OperationFailed(_)));
    }

    #[tokio::test]
    async fn test_cherry_pick_fails_when_operation_in_progress() {
        // Test that cherry-pick fails if another operation is already in progress
        let test_repo = TestRepo::with_initial_commit();

        // Create a conflict scenario to get into cherry-pick state
        test_repo.create_commit("Add conflict file", &[("conflict.txt", "main content")]);

        let repo = test_repo.repo();
        let head = repo.head().unwrap();
        let head_commit = head.peel_to_commit().unwrap();
        let parent = head_commit.parent(0).unwrap();

        repo.branch("feature", &parent, false).unwrap();
        test_repo.checkout_branch("feature");
        let feature_commit_oid =
            test_repo.create_commit("Feature conflict", &[("conflict.txt", "feature content")]);

        // Create another commit on feature
        let another_commit_oid =
            test_repo.create_commit("Another commit", &[("another.txt", "content")]);

        test_repo.checkout_branch("main");

        // First cherry-pick creates conflict
        let _ = cherry_pick(test_repo.path_str(), feature_commit_oid.to_string(), None).await;

        // Verify we're in cherry-pick state
        assert_eq!(test_repo.repo().state(), git2::RepositoryState::CherryPick);

        // Second cherry-pick should fail
        let result = cherry_pick(test_repo.path_str(), another_commit_oid.to_string(), None).await;

        assert!(
            result.is_err(),
            "Should fail when cherry-pick already in progress"
        );
        let err = result.unwrap_err();
        assert!(matches!(err, LeviathanError::CherryPickInProgress));
    }

    #[tokio::test]
    async fn test_cherry_pick_preserves_author() {
        // Test that cherry-pick preserves the original author
        let test_repo = TestRepo::with_initial_commit();

        // Create a feature branch and add a commit
        test_repo.create_branch("feature");
        test_repo.checkout_branch("feature");
        let feature_commit_oid =
            test_repo.create_commit("Feature commit", &[("feature.txt", "content")]);

        // Get original author info
        let repo = test_repo.repo();
        let original_commit = repo.find_commit(feature_commit_oid).unwrap();
        let original_author = original_commit.author();

        // Switch back to main and cherry-pick
        test_repo.checkout_branch("main");
        let result = cherry_pick(test_repo.path_str(), feature_commit_oid.to_string(), None)
            .await
            .unwrap();

        // Verify author is preserved
        assert_eq!(result.author.name, original_author.name().unwrap());
        assert_eq!(result.author.email, original_author.email().unwrap());
    }

    // ==================== Revert Tests ====================

    #[tokio::test]
    async fn test_revert_success() {
        let test_repo = TestRepo::with_initial_commit();

        // Create a commit to revert
        let commit_to_revert =
            test_repo.create_commit("Add file to revert", &[("revert-me.txt", "content")]);

        // Verify file exists
        assert!(test_repo.path.join("revert-me.txt").exists());

        // Revert the commit
        let result = revert(test_repo.path_str(), commit_to_revert.to_string()).await;
        assert!(result.is_ok(), "Revert should succeed");

        let revert_commit = result.unwrap();
        assert!(revert_commit.summary.contains("Revert"));

        // Verify the file no longer exists
        assert!(!test_repo.path.join("revert-me.txt").exists());

        // Verify repo state is clean
        assert_eq!(test_repo.repo().state(), git2::RepositoryState::Clean);
    }

    #[tokio::test]
    async fn test_revert_conflict() {
        let test_repo = TestRepo::with_initial_commit();

        // Create a commit that adds a file
        let commit_to_revert =
            test_repo.create_commit("Add file", &[("file.txt", "original content")]);

        // Modify the file in another commit
        test_repo.create_commit("Modify file", &[("file.txt", "modified content")]);

        // Revert the original commit - this should conflict
        let result = revert(test_repo.path_str(), commit_to_revert.to_string()).await;

        assert!(result.is_err(), "Revert should fail with conflict");
        let err = result.unwrap_err();
        assert!(matches!(err, LeviathanError::RevertConflict));
    }

    #[tokio::test]
    async fn test_abort_revert() {
        let test_repo = TestRepo::with_initial_commit();

        // Create conflict scenario
        let commit_to_revert =
            test_repo.create_commit("Add file", &[("file.txt", "original content")]);
        test_repo.create_commit("Modify file", &[("file.txt", "modified content")]);

        // Revert to create conflict
        let _ = revert(test_repo.path_str(), commit_to_revert.to_string()).await;

        // Abort
        let abort_result = abort_revert(test_repo.path_str()).await;
        assert!(abort_result.is_ok());

        // Verify state is clean
        assert_eq!(test_repo.repo().state(), git2::RepositoryState::Clean);
    }

    // ==================== Reset Tests ====================

    #[tokio::test]
    async fn test_reset_soft() {
        let test_repo = TestRepo::with_initial_commit();
        let initial_head = test_repo.head_oid();

        // Create another commit
        test_repo.create_commit("Second commit", &[("file2.txt", "content")]);

        // Soft reset to initial commit
        let result = reset(
            test_repo.path_str(),
            initial_head.to_string(),
            "soft".to_string(),
        )
        .await;

        assert!(result.is_ok());

        // HEAD should point to initial commit
        assert_eq!(test_repo.head_oid(), initial_head);

        // File should still exist (soft reset keeps working directory)
        assert!(test_repo.path.join("file2.txt").exists());

        // Changes should be staged
        let repo = test_repo.repo();
        let index = repo.index().unwrap();
        assert!(index
            .get_path(std::path::Path::new("file2.txt"), 0)
            .is_some());
    }

    #[tokio::test]
    async fn test_reset_hard() {
        let test_repo = TestRepo::with_initial_commit();
        let initial_head = test_repo.head_oid();

        // Create another commit
        test_repo.create_commit("Second commit", &[("file2.txt", "content")]);

        // Hard reset to initial commit
        let result = reset(
            test_repo.path_str(),
            initial_head.to_string(),
            "hard".to_string(),
        )
        .await;

        assert!(result.is_ok());

        // HEAD should point to initial commit
        assert_eq!(test_repo.head_oid(), initial_head);

        // File should NOT exist (hard reset discards working directory)
        assert!(!test_repo.path.join("file2.txt").exists());
    }

    #[tokio::test]
    async fn test_reset_mixed() {
        let test_repo = TestRepo::with_initial_commit();
        let initial_head = test_repo.head_oid();

        // Create another commit
        test_repo.create_commit("Second commit", &[("file2.txt", "content")]);

        // Mixed reset to initial commit
        let result = reset(
            test_repo.path_str(),
            initial_head.to_string(),
            "mixed".to_string(),
        )
        .await;

        assert!(result.is_ok());

        // HEAD should point to initial commit
        assert_eq!(test_repo.head_oid(), initial_head);

        // File should still exist
        assert!(test_repo.path.join("file2.txt").exists());

        // Changes should NOT be staged (mixed reset unstages)
        let repo = test_repo.repo();
        let index = repo.index().unwrap();
        assert!(index
            .get_path(std::path::Path::new("file2.txt"), 0)
            .is_none());
    }

    #[tokio::test]
    async fn test_reset_invalid_mode() {
        let test_repo = TestRepo::with_initial_commit();

        let result = reset(
            test_repo.path_str(),
            test_repo.head_oid().to_string(),
            "invalid".to_string(),
        )
        .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, LeviathanError::OperationFailed(_)));
    }
}
