//! Stash command handlers

use std::path::Path;
use tauri::command;

use crate::error::Result;
use crate::models::Stash;

/// Get all stashes
#[command]
pub async fn get_stashes(path: String) -> Result<Vec<Stash>> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    let mut stashes = Vec::new();

    repo.stash_foreach(|index, message, oid| {
        stashes.push(Stash {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
        });
        true
    })?;

    Ok(stashes)
}

/// Create a new stash
#[command]
pub async fn create_stash(
    path: String,
    message: Option<String>,
    include_untracked: Option<bool>,
) -> Result<Stash> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    let signature = repo.signature()?;

    let mut flags = git2::StashFlags::DEFAULT;
    if include_untracked.unwrap_or(false) {
        flags |= git2::StashFlags::INCLUDE_UNTRACKED;
    }

    let oid = repo.stash_save(&signature, message.as_deref().unwrap_or("WIP"), Some(flags))?;

    Ok(Stash {
        index: 0,
        message: message.unwrap_or_else(|| "WIP".to_string()),
        oid: oid.to_string(),
    })
}

/// Apply a stash
#[command]
pub async fn apply_stash(path: String, index: usize, drop_after: Option<bool>) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;

    repo.stash_apply(index, None)?;

    if drop_after.unwrap_or(false) {
        repo.stash_drop(index)?;
    }

    Ok(())
}

/// Drop a stash
#[command]
pub async fn drop_stash(path: String, index: usize) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    repo.stash_drop(index)?;
    Ok(())
}

/// Pop a stash (apply and drop)
#[command]
pub async fn pop_stash(path: String, index: usize) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    repo.stash_pop(index, None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    /// Helper to create a commit with a tracked file for stash tests
    fn setup_tracked_file(repo: &TestRepo, filename: &str, content: &str) {
        repo.create_file(filename, content);
        repo.stage_file(filename);
        repo.create_commit(&format!("Add {}", filename), &[]);
    }

    #[tokio::test]
    async fn test_get_stashes_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_stashes(repo.path_str()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_create_stash_with_changes() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "tracked.txt", "original");

        // Modify the tracked file
        repo.create_file("tracked.txt", "modified");

        let result = create_stash(repo.path_str(), Some("Test stash".to_string()), None).await;
        assert!(result.is_ok());
        let stash = result.unwrap();
        assert_eq!(stash.index, 0);
        assert_eq!(stash.message, "Test stash");
    }

    #[tokio::test]
    async fn test_create_stash_default_message() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "content");

        // Modify to have something to stash
        repo.create_file("file.txt", "modified");

        let result = create_stash(repo.path_str(), None, None).await;
        assert!(result.is_ok());
        let stash = result.unwrap();
        assert_eq!(stash.message, "WIP");
    }

    #[tokio::test]
    async fn test_create_stash_no_changes_fails() {
        let repo = TestRepo::with_initial_commit();
        // No changes to stash
        let result = create_stash(repo.path_str(), Some("Empty stash".to_string()), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_stashes_returns_created() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "content");

        // Modify and stash
        repo.create_file("file.txt", "modified");
        create_stash(repo.path_str(), Some("First stash".to_string()), None)
            .await
            .unwrap();

        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 1);
        assert!(stashes[0].message.contains("First stash"));
    }

    #[tokio::test]
    async fn test_drop_stash() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "content");

        // Modify and stash
        repo.create_file("file.txt", "modified");
        create_stash(repo.path_str(), Some("To drop".to_string()), None)
            .await
            .unwrap();

        // Verify stash exists
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 1);

        // Drop it
        let result = drop_stash(repo.path_str(), 0).await;
        assert!(result.is_ok());

        // Verify it's gone
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert!(stashes.is_empty());
    }

    #[tokio::test]
    async fn test_drop_stash_invalid_index() {
        let repo = TestRepo::with_initial_commit();
        let result = drop_stash(repo.path_str(), 999).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_apply_stash() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original");

        // Modify and stash
        repo.create_file("file.txt", "stashed content");
        create_stash(repo.path_str(), Some("Apply test".to_string()), None)
            .await
            .unwrap();

        // File should be back to original
        let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
        assert_eq!(content, "original");

        // Apply stash
        let result = apply_stash(repo.path_str(), 0, Some(false)).await;
        assert!(result.is_ok());

        // File should have stashed content
        let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
        assert_eq!(content, "stashed content");

        // Stash should still exist (we didn't drop it)
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 1);
    }

    #[tokio::test]
    async fn test_apply_stash_with_drop() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original");

        // Modify and stash
        repo.create_file("file.txt", "stashed");
        create_stash(repo.path_str(), Some("Apply and drop".to_string()), None)
            .await
            .unwrap();

        // Apply with drop
        let result = apply_stash(repo.path_str(), 0, Some(true)).await;
        assert!(result.is_ok());

        // Stash should be gone
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert!(stashes.is_empty());
    }

    #[tokio::test]
    async fn test_pop_stash() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original");

        // Modify and stash
        repo.create_file("file.txt", "popped content");
        create_stash(repo.path_str(), Some("Pop test".to_string()), None)
            .await
            .unwrap();

        // Pop stash
        let result = pop_stash(repo.path_str(), 0).await;
        assert!(result.is_ok());

        // File should have stashed content
        let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
        assert_eq!(content, "popped content");

        // Stash should be gone (pop = apply + drop)
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert!(stashes.is_empty());
    }

    #[tokio::test]
    async fn test_multiple_stashes() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original");

        // Create first stash
        repo.create_file("file.txt", "first change");
        create_stash(repo.path_str(), Some("First".to_string()), None)
            .await
            .unwrap();

        // Create second stash
        repo.create_file("file.txt", "second change");
        create_stash(repo.path_str(), Some("Second".to_string()), None)
            .await
            .unwrap();

        // Should have 2 stashes, newest first
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 2);
        assert!(stashes[0].message.contains("Second")); // index 0 is newest
        assert!(stashes[1].message.contains("First")); // index 1 is older
    }
}
