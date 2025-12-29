//! Staging command handlers

use std::io::Write;
use std::path::Path;
use tauri::command;

use crate::error::Result;
use crate::models::{FileStatus, StatusEntry};
use crate::utils::create_command;

/// Get repository status
#[command]
pub async fn get_status(path: String) -> Result<Vec<StatusEntry>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut entries = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();

        // A file can have both staged AND unstaged changes
        // We need to return separate entries for each
        let staged_entry = get_staged_status(status, &path);
        let unstaged_entry = get_unstaged_status(status, &path);

        if let Some(entry) = staged_entry {
            entries.push(entry);
        }
        if let Some(entry) = unstaged_entry {
            entries.push(entry);
        }
    }

    Ok(entries)
}

/// Get the staged (index) status for a file, if any
fn get_staged_status(status: git2::Status, path: &str) -> Option<StatusEntry> {
    if status.is_conflicted() {
        return Some(StatusEntry {
            path: path.to_string(),
            status: FileStatus::Conflicted,
            is_staged: false,
            is_conflicted: true,
        });
    }

    let file_status = if status.is_index_new() {
        Some(FileStatus::New)
    } else if status.is_index_modified() {
        Some(FileStatus::Modified)
    } else if status.is_index_deleted() {
        Some(FileStatus::Deleted)
    } else if status.is_index_renamed() {
        Some(FileStatus::Renamed)
    } else if status.is_index_typechange() {
        Some(FileStatus::Typechange)
    } else {
        None
    };

    file_status.map(|s| StatusEntry {
        path: path.to_string(),
        status: s,
        is_staged: true,
        is_conflicted: false,
    })
}

/// Get the unstaged (worktree) status for a file, if any
fn get_unstaged_status(status: git2::Status, path: &str) -> Option<StatusEntry> {
    if status.is_conflicted() {
        return None; // Already handled in staged
    }

    let file_status = if status.is_wt_new() {
        Some(FileStatus::Untracked)
    } else if status.is_wt_modified() {
        Some(FileStatus::Modified)
    } else if status.is_wt_deleted() {
        Some(FileStatus::Deleted)
    } else if status.is_wt_renamed() {
        Some(FileStatus::Renamed)
    } else if status.is_wt_typechange() {
        Some(FileStatus::Typechange)
    } else if status.is_ignored() {
        Some(FileStatus::Ignored)
    } else {
        None
    };

    file_status.map(|s| StatusEntry {
        path: path.to_string(),
        status: s,
        is_staged: false,
        is_conflicted: false,
    })
}

/// Stage files
#[command]
pub async fn stage_files(path: String, paths: Vec<String>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut index = repo.index()?;

    for file_path in paths {
        let full_path = Path::new(&path).join(&file_path);
        if full_path.exists() {
            index.add_path(Path::new(&file_path))?;
        } else {
            index.remove_path(Path::new(&file_path))?;
        }
    }

    index.write()?;
    Ok(())
}

/// Unstage files
#[command]
pub async fn unstage_files(path: String, paths: Vec<String>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let head_ref = repo.head()?;
    let head_commit = head_ref.peel_to_commit()?;
    let head_tree = head_commit.tree()?;
    let head_object = head_commit.as_object();

    let mut index = repo.index()?;

    for file_path in paths {
        let path_obj = Path::new(&file_path);

        // Check if file exists in HEAD
        if head_tree.get_path(path_obj).is_ok() {
            // Reset to HEAD version
            repo.reset_default(Some(head_object), [path_obj])?;
        } else {
            // Remove from index (was newly added)
            index.remove_path(path_obj)?;
        }
    }

    index.write()?;
    Ok(())
}

/// Discard changes in working directory
#[command]
pub async fn discard_changes(path: String, paths: Vec<String>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let repo_path = Path::new(&path);

    // Get HEAD tree (may not exist for initial commit)
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let index = repo.index()?;

    // Separate files into categories
    let mut tracked_paths: Vec<&str> = Vec::new();
    let mut untracked_paths: Vec<&str> = Vec::new();

    for file_path in &paths {
        let path_obj = Path::new(file_path);

        // Check if file exists in HEAD
        let in_head = head_tree
            .as_ref()
            .map(|t| t.get_path(path_obj).is_ok())
            .unwrap_or(false);

        // Check if file exists in index
        let in_index = index.get_path(path_obj, 0).is_some();

        if in_head || in_index {
            // File is tracked - will checkout from HEAD or index
            tracked_paths.push(file_path);
        } else {
            // File is untracked - need to delete it
            untracked_paths.push(file_path);
        }
    }

    // Checkout tracked files from HEAD (or index if not in HEAD)
    if !tracked_paths.is_empty() {
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.force();
        checkout_opts.remove_untracked(false);

        for file_path in &tracked_paths {
            checkout_opts.path(file_path);
        }

        if let Some(ref tree) = head_tree {
            repo.checkout_tree(tree.as_object(), Some(&mut checkout_opts))?;
        } else {
            // No HEAD yet (initial commit scenario) - checkout from index
            let mut fresh_index = repo.index()?;
            repo.checkout_index(Some(&mut fresh_index), Some(&mut checkout_opts))?;
        }
    }

    // Delete untracked files
    for file_path in untracked_paths {
        let full_path = repo_path.join(file_path);
        if full_path.exists() {
            if full_path.is_dir() {
                std::fs::remove_dir_all(&full_path)?;
            } else {
                std::fs::remove_file(&full_path)?;
            }
        }
    }

    Ok(())
}

/// Stage a specific hunk from a diff
///
/// Takes a patch string containing just the hunk to stage (with proper headers)
/// and applies it to the index using git apply --cached
#[command]
pub async fn stage_hunk(repo_path: String, patch: String) -> Result<()> {
    // Create a temporary file for the patch
    let temp_dir = std::env::temp_dir();
    let patch_file = temp_dir.join(format!("leviathan_hunk_{}.patch", std::process::id()));

    // Write patch to temp file
    let mut file = std::fs::File::create(&patch_file)?;
    file.write_all(patch.as_bytes())?;
    file.flush()?;
    drop(file);

    // Apply the patch to the index
    let output = create_command("git")
        .args(["apply", "--cached", "--unidiff-zero"])
        .arg(&patch_file)
        .current_dir(&repo_path)
        .output()?;

    // Clean up temp file
    let _ = std::fs::remove_file(&patch_file);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(crate::error::LeviathanError::OperationFailed(format!(
            "Failed to stage hunk: {}",
            stderr
        )));
    }

    Ok(())
}

/// Unstage a specific hunk from the index
///
/// Takes a patch string and applies it in reverse to unstage
#[command]
pub async fn unstage_hunk(repo_path: String, patch: String) -> Result<()> {
    // Create a temporary file for the patch
    let temp_dir = std::env::temp_dir();
    let patch_file = temp_dir.join(format!("leviathan_hunk_{}.patch", std::process::id()));

    // Write patch to temp file
    let mut file = std::fs::File::create(&patch_file)?;
    file.write_all(patch.as_bytes())?;
    file.flush()?;
    drop(file);

    // Apply the patch in reverse to unstage
    let output = create_command("git")
        .args(["apply", "--cached", "--reverse", "--unidiff-zero"])
        .arg(&patch_file)
        .current_dir(&repo_path)
        .output()?;

    // Clean up temp file
    let _ = std::fs::remove_file(&patch_file);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(crate::error::LeviathanError::OperationFailed(format!(
            "Failed to unstage hunk: {}",
            stderr
        )));
    }

    Ok(())
}

/// Write content to a file and optionally stage it
/// Used for inline editing in the diff view
#[command]
pub async fn write_file_content(
    repo_path: String,
    file_path: String,
    content: String,
    stage_after: Option<bool>,
) -> Result<()> {
    let full_path = Path::new(&repo_path).join(&file_path);

    // Ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Write content to file
    std::fs::write(&full_path, content)?;

    // Optionally stage the file
    if stage_after.unwrap_or(false) {
        let repo = git2::Repository::open(Path::new(&repo_path))?;
        let mut index = repo.index()?;
        index.add_path(Path::new(&file_path))?;
        index.write()?;
    }

    Ok(())
}

/// Read file content from working directory or index
#[command]
pub async fn read_file_content(
    repo_path: String,
    file_path: String,
    from_index: Option<bool>,
) -> Result<String> {
    if from_index.unwrap_or(false) {
        // Read from index
        let repo = git2::Repository::open(Path::new(&repo_path))?;
        let index = repo.index()?;

        if let Some(entry) = index.get_path(Path::new(&file_path), 0) {
            let blob = repo.find_blob(entry.id)?;
            let content = String::from_utf8_lossy(blob.content()).to_string();
            return Ok(content);
        }

        Err(crate::error::LeviathanError::OperationFailed(
            "File not found in index".to_string(),
        ))
    } else {
        // Read from working directory
        let full_path = Path::new(&repo_path).join(&file_path);
        let content = std::fs::read_to_string(&full_path)?;
        Ok(content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_discard_changes_modified_tracked_file() {
        let repo = TestRepo::with_initial_commit();

        // Modify an existing tracked file
        repo.create_file("README.md", "Modified content");

        // Verify file is modified
        let content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(content, "Modified content");

        // Discard changes
        let result = discard_changes(
            repo.path_str(),
            vec!["README.md".to_string()],
        ).await;

        assert!(result.is_ok());

        // File should be restored to original content
        let content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(content, "# Test Repo");
    }

    #[tokio::test]
    async fn test_discard_changes_untracked_file() {
        let repo = TestRepo::with_initial_commit();

        // Create an untracked file
        repo.create_file("untracked.txt", "Untracked content");

        // Verify file exists
        assert!(repo.path.join("untracked.txt").exists());

        // Discard changes (should delete the file)
        let result = discard_changes(
            repo.path_str(),
            vec!["untracked.txt".to_string()],
        ).await;

        assert!(result.is_ok());

        // File should be deleted
        assert!(!repo.path.join("untracked.txt").exists());
    }

    #[tokio::test]
    async fn test_discard_changes_staged_new_file() {
        let repo = TestRepo::with_initial_commit();

        // Create and stage a new file (not yet committed)
        repo.create_file("newfile.txt", "New file content");
        repo.stage_file("newfile.txt");

        // Verify file is staged
        let git_repo = repo.repo();
        let index = git_repo.index().unwrap();
        assert!(index.get_path(Path::new("newfile.txt"), 0).is_some());

        // Discard changes - this should restore from index since file is staged
        // but the working tree file should match the staged version
        let result = discard_changes(
            repo.path_str(),
            vec!["newfile.txt".to_string()],
        ).await;

        assert!(result.is_ok());

        // File should still exist (it's in the index)
        assert!(repo.path.join("newfile.txt").exists());
    }

    #[tokio::test]
    async fn test_discard_changes_deleted_tracked_file() {
        let repo = TestRepo::with_initial_commit();

        // Delete a tracked file
        std::fs::remove_file(repo.path.join("README.md")).unwrap();

        // Verify file is deleted
        assert!(!repo.path.join("README.md").exists());

        // Discard changes (should restore the file)
        let result = discard_changes(
            repo.path_str(),
            vec!["README.md".to_string()],
        ).await;

        assert!(result.is_ok());

        // File should be restored
        assert!(repo.path.join("README.md").exists());
        let content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(content, "# Test Repo");
    }

    #[tokio::test]
    async fn test_discard_changes_untracked_directory() {
        let repo = TestRepo::with_initial_commit();

        // Create an untracked directory with files
        repo.create_file("untracked_dir/file1.txt", "Content 1");
        repo.create_file("untracked_dir/file2.txt", "Content 2");

        // Verify directory exists
        assert!(repo.path.join("untracked_dir").exists());
        assert!(repo.path.join("untracked_dir").is_dir());

        // Discard changes (should delete the directory)
        let result = discard_changes(
            repo.path_str(),
            vec!["untracked_dir".to_string()],
        ).await;

        assert!(result.is_ok());

        // Directory should be deleted
        assert!(!repo.path.join("untracked_dir").exists());
    }

    #[tokio::test]
    async fn test_discard_changes_multiple_files() {
        let repo = TestRepo::with_initial_commit();

        // Create various changes
        repo.create_file("README.md", "Modified readme");
        repo.create_file("untracked.txt", "Untracked");
        repo.create_file("another.txt", "Another file");
        repo.stage_file("another.txt");

        // Discard all changes
        let result = discard_changes(
            repo.path_str(),
            vec![
                "README.md".to_string(),
                "untracked.txt".to_string(),
            ],
        ).await;

        assert!(result.is_ok());

        // README should be restored
        let content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(content, "# Test Repo");

        // Untracked file should be deleted
        assert!(!repo.path.join("untracked.txt").exists());

        // Staged file should still exist (wasn't in discard list)
        assert!(repo.path.join("another.txt").exists());
    }

    #[tokio::test]
    async fn test_get_status_shows_untracked() {
        let repo = TestRepo::with_initial_commit();

        // Create an untracked file
        repo.create_file("untracked.txt", "Content");

        let result = get_status(repo.path_str()).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        let untracked = entries.iter().find(|e| e.path == "untracked.txt");
        assert!(untracked.is_some());
        assert_eq!(untracked.unwrap().status, FileStatus::Untracked);
        assert!(!untracked.unwrap().is_staged);
    }

    #[tokio::test]
    async fn test_get_status_shows_modified() {
        let repo = TestRepo::with_initial_commit();

        // Modify a tracked file
        repo.create_file("README.md", "Modified");

        let result = get_status(repo.path_str()).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        let modified = entries.iter().find(|e| e.path == "README.md");
        assert!(modified.is_some());
        assert_eq!(modified.unwrap().status, FileStatus::Modified);
        assert!(!modified.unwrap().is_staged);
    }

    #[tokio::test]
    async fn test_stage_and_unstage_files() {
        let repo = TestRepo::with_initial_commit();

        // Create and stage a file
        repo.create_file("new.txt", "Content");

        let result = stage_files(
            repo.path_str(),
            vec!["new.txt".to_string()],
        ).await;
        assert!(result.is_ok());

        // Verify file is staged
        let status = get_status(repo.path_str()).await.unwrap();
        let staged = status.iter().find(|e| e.path == "new.txt" && e.is_staged);
        assert!(staged.is_some());

        // Unstage the file
        let result = unstage_files(
            repo.path_str(),
            vec!["new.txt".to_string()],
        ).await;
        assert!(result.is_ok());

        // Verify file is no longer staged
        let status = get_status(repo.path_str()).await.unwrap();
        let staged = status.iter().find(|e| e.path == "new.txt" && e.is_staged);
        assert!(staged.is_none());
    }
}
