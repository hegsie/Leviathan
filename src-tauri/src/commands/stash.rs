//! Stash command handlers

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::command;

use crate::error::Result;
use crate::models::Stash;

/// Result of showing stash contents
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashShowResult {
    pub index: u32,
    pub message: String,
    pub files: Vec<StashFile>,
    pub total_additions: u32,
    pub total_deletions: u32,
    pub patch: Option<String>,
}

/// A file in a stash
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashFile {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    pub status: String,
}

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

/// Show stash contents
#[command]
pub async fn stash_show(
    path: String,
    index: u32,
    stat: Option<bool>,
    patch: Option<bool>,
) -> Result<StashShowResult> {
    let mut repo = git2::Repository::open(Path::new(&path))?;

    // Get stash info (message and oid) by iterating through stashes
    let mut stash_info: Option<(String, git2::Oid)> = None;
    repo.stash_foreach(|i, message, oid| {
        if i as u32 == index {
            stash_info = Some((message.to_string(), *oid));
            false // Stop iterating
        } else {
            true // Continue
        }
    })?;

    let (message, stash_oid) = stash_info.ok_or_else(|| {
        crate::error::LeviathanError::Git(git2::Error::from_str(&format!(
            "Stash entry {} not found",
            index
        )))
    })?;

    // Get the stash commit
    let stash_commit = repo.find_commit(stash_oid)?;

    // Get parent commit (the commit the stash was based on)
    let parent_commit = stash_commit.parent(0)?;

    // Get the diff between parent and stash commit
    let parent_tree = parent_commit.tree()?;
    let stash_tree = stash_commit.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&stash_tree), None)?;

    // Collect file stats
    let mut files: Vec<StashFile> = Vec::new();
    let mut total_additions: u32 = 0;
    let mut total_deletions: u32 = 0;

    // Get stats if requested (default true)
    if stat.unwrap_or(true) {
        let stats = diff.stats()?;

        diff.foreach(
            &mut |delta, _| {
                let file_path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let status = match delta.status() {
                    git2::Delta::Added => "added",
                    git2::Delta::Deleted => "deleted",
                    git2::Delta::Modified => "modified",
                    git2::Delta::Renamed => "renamed",
                    git2::Delta::Copied => "copied",
                    git2::Delta::Typechange => "typechange",
                    _ => "modified",
                };

                files.push(StashFile {
                    path: file_path,
                    additions: 0, // Will be filled in later
                    deletions: 0,
                    status: status.to_string(),
                });
                true
            },
            None,
            None,
            None,
        )?;

        // Get per-file stats by iterating through lines
        // Use RefCell to allow mutable borrow inside closures
        let file_stats: std::cell::RefCell<std::collections::HashMap<String, (u32, u32)>> =
            std::cell::RefCell::new(std::collections::HashMap::new());
        diff.foreach(
            &mut |_delta, _| true,
            None,
            None,
            Some(&mut |delta, _hunk, line| {
                let path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let mut stats = file_stats.borrow_mut();
                let entry = stats.entry(path).or_insert((0, 0));
                match line.origin() {
                    '+' => entry.0 += 1,
                    '-' => entry.1 += 1,
                    _ => {}
                }
                true
            }),
        )?;
        let file_stats = file_stats.into_inner();

        // Update file entries with stats
        for file in &mut files {
            if let Some((adds, dels)) = file_stats.get(&file.path) {
                file.additions = *adds;
                file.deletions = *dels;
            }
        }

        total_additions = stats.insertions() as u32;
        total_deletions = stats.deletions() as u32;
    }

    // Generate patch if requested
    let patch_output = if patch.unwrap_or(false) {
        let mut patch_buf = Vec::new();
        diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
            // Add the origin character for context/add/delete lines
            let origin = line.origin();
            if origin == '+' || origin == '-' || origin == ' ' {
                patch_buf.push(origin as u8);
            }
            patch_buf.extend_from_slice(line.content());
            true
        })?;
        Some(String::from_utf8_lossy(&patch_buf).to_string())
    } else {
        None
    };

    Ok(StashShowResult {
        index,
        message,
        files,
        total_additions,
        total_deletions,
        patch: patch_output,
    })
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

    #[tokio::test]
    async fn test_stash_show_basic() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original content");

        // Modify and stash
        repo.create_file("file.txt", "modified content");
        create_stash(repo.path_str(), Some("Show test".to_string()), None)
            .await
            .unwrap();

        // Show stash contents
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();
        assert_eq!(show.index, 0);
        assert!(show.message.contains("Show test"));
        assert_eq!(show.files.len(), 1);
        assert_eq!(show.files[0].path, "file.txt");
        assert_eq!(show.files[0].status, "modified");
        assert!(show.patch.is_none());
    }

    #[tokio::test]
    async fn test_stash_show_with_patch() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "line1\nline2\nline3");

        // Modify and stash
        repo.create_file("file.txt", "line1\nmodified\nline3");
        create_stash(repo.path_str(), Some("Patch test".to_string()), None)
            .await
            .unwrap();

        // Show stash with patch
        let result = stash_show(repo.path_str(), 0, Some(true), Some(true)).await;
        assert!(result.is_ok());
        let show = result.unwrap();
        assert!(show.patch.is_some());
        let patch = show.patch.unwrap();
        assert!(patch.contains("-line2"));
        assert!(patch.contains("+modified"));
    }

    #[tokio::test]
    async fn test_stash_show_multiple_files() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit multiple files
        setup_tracked_file(&repo, "file1.txt", "content1");
        setup_tracked_file(&repo, "file2.txt", "content2");

        // Modify both files and stash
        repo.create_file("file1.txt", "modified1");
        repo.create_file("file2.txt", "modified2");
        create_stash(repo.path_str(), Some("Multi file".to_string()), None)
            .await
            .unwrap();

        // Show stash
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();
        assert_eq!(show.files.len(), 2);

        // Both files should be present
        let paths: Vec<&str> = show.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"file1.txt"));
        assert!(paths.contains(&"file2.txt"));
    }

    #[tokio::test]
    async fn test_stash_show_invalid_index() {
        let repo = TestRepo::with_initial_commit();
        // Try to show non-existent stash
        let result = stash_show(repo.path_str(), 999, Some(true), Some(false)).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_stash_show_additions_deletions() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "line1\nline2\nline3\nline4");

        // Modify: remove line2, add two new lines
        repo.create_file("file.txt", "line1\nnew1\nnew2\nline3\nline4");
        create_stash(repo.path_str(), Some("Stats test".to_string()), None)
            .await
            .unwrap();

        // Show stash
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();

        // Check total stats
        assert!(show.total_additions > 0);
        assert!(show.total_deletions > 0);

        // Check file stats
        assert_eq!(show.files.len(), 1);
        assert!(show.files[0].additions > 0);
        assert!(show.files[0].deletions > 0);
    }

    #[tokio::test]
    async fn test_stash_show_staged_new_file() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "existing.txt", "content");

        // Create a new file and stage it
        repo.create_file("new_file.txt", "new content");
        repo.stage_file("new_file.txt");

        // Stash the staged new file
        create_stash(repo.path_str(), Some("New file stash".to_string()), None)
            .await
            .unwrap();

        // Show stash
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();

        // Should have the new file
        let new_file = show.files.iter().find(|f| f.path == "new_file.txt");
        assert!(new_file.is_some());
        assert_eq!(new_file.unwrap().status, "added");
    }

    #[tokio::test]
    async fn test_stash_show_deleted_file() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "to_delete.txt", "content");

        // Delete the file and stage the deletion
        std::fs::remove_file(repo.path.join("to_delete.txt")).unwrap();
        let git_repo = git2::Repository::open(&repo.path).unwrap();
        let mut index = git_repo.index().unwrap();
        index
            .remove_path(std::path::Path::new("to_delete.txt"))
            .unwrap();
        index.write().unwrap();

        // Stash the deletion
        create_stash(repo.path_str(), Some("Delete file stash".to_string()), None)
            .await
            .unwrap();

        // Show stash
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();

        // Should have the deleted file
        let deleted_file = show.files.iter().find(|f| f.path == "to_delete.txt");
        assert!(deleted_file.is_some());
        assert_eq!(deleted_file.unwrap().status, "deleted");
    }
}
