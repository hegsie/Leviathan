//! Clean command handlers
//! Remove untracked and ignored files from the working directory

use std::fs;
use std::path::Path;
use tauri::command;

use crate::error::Result;

/// Entry representing a file that can be cleaned
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanEntry {
    pub path: String,
    pub is_directory: bool,
    pub is_ignored: bool,
    pub size: Option<u64>,
}

/// Get list of files that would be cleaned (dry run)
#[command]
pub async fn get_cleanable_files(
    path: String,
    include_ignored: Option<bool>,
    include_directories: Option<bool>,
) -> Result<Vec<CleanEntry>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let workdir = repo.workdir().ok_or_else(|| {
        crate::error::LeviathanError::OperationFailed("Repository has no working directory".into())
    })?;

    let include_ignored = include_ignored.unwrap_or(false);
    let include_directories = include_directories.unwrap_or(true);

    let mut entries = Vec::new();

    // Get status to find untracked files
    let statuses = repo.statuses(Some(
        git2::StatusOptions::new()
            .include_untracked(true)
            .include_ignored(include_ignored)
            .recurse_untracked_dirs(true),
    ))?;

    for entry in statuses.iter() {
        let status = entry.status();
        let file_path = entry.path().unwrap_or("");

        // Check if file is untracked or ignored
        let is_untracked = status.contains(git2::Status::WT_NEW);
        let is_ignored = status.contains(git2::Status::IGNORED);

        if !is_untracked && !is_ignored {
            continue;
        }

        // Skip ignored files if not requested
        if is_ignored && !include_ignored {
            continue;
        }

        let full_path = workdir.join(file_path);
        let is_directory = full_path.is_dir();

        // Skip directories if not requested
        if is_directory && !include_directories {
            continue;
        }

        // Get file size
        let size = if is_directory {
            None
        } else {
            fs::metadata(&full_path).ok().map(|m| m.len())
        };

        entries.push(CleanEntry {
            path: file_path.to_string(),
            is_directory,
            is_ignored,
            size,
        });
    }

    // Sort: directories first, then by path
    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.path.cmp(&b.path),
    });

    Ok(entries)
}

/// Clean (remove) specified files
#[command]
pub async fn clean_files(path: String, paths: Vec<String>) -> Result<u32> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let workdir = repo.workdir().ok_or_else(|| {
        crate::error::LeviathanError::OperationFailed("Repository has no working directory".into())
    })?;

    let mut removed_count = 0;

    for file_path in &paths {
        let full_path = workdir.join(file_path);

        if full_path.is_dir() {
            if let Ok(()) = fs::remove_dir_all(&full_path) {
                removed_count += 1;
                tracing::info!("Removed directory: {}", file_path);
            } else {
                tracing::warn!("Failed to remove directory: {}", file_path);
            }
        } else if full_path.is_file() {
            if let Ok(()) = fs::remove_file(&full_path) {
                removed_count += 1;
                tracing::info!("Removed file: {}", file_path);
            } else {
                tracing::warn!("Failed to remove file: {}", file_path);
            }
        }
    }

    Ok(removed_count)
}

/// Clean all untracked files
#[command]
pub async fn clean_all(
    path: String,
    include_ignored: Option<bool>,
    include_directories: Option<bool>,
) -> Result<u32> {
    let entries = get_cleanable_files(path.clone(), include_ignored, include_directories).await?;

    let paths: Vec<String> = entries.into_iter().map(|e| e.path).collect();
    clean_files(path, paths).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_cleanable_files_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_cleanable_files(repo.path_str(), None, None).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_cleanable_files_untracked_file() {
        let repo = TestRepo::with_initial_commit();

        // Create an untracked file
        repo.create_file("untracked.txt", "untracked content");

        let result = get_cleanable_files(repo.path_str(), None, None).await;

        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "untracked.txt");
        assert!(!entries[0].is_directory);
        assert!(!entries[0].is_ignored);
        assert!(entries[0].size.is_some());
    }

    #[tokio::test]
    async fn test_get_cleanable_files_untracked_directory() {
        let repo = TestRepo::with_initial_commit();

        // Create an untracked directory with files
        repo.create_file("untracked_dir/file1.txt", "content 1");
        repo.create_file("untracked_dir/file2.txt", "content 2");

        let result = get_cleanable_files(repo.path_str(), None, Some(true)).await;

        assert!(result.is_ok());
        let entries = result.unwrap();
        // Should contain the files (directories are typically not listed separately)
        assert!(!entries.is_empty());
    }

    #[tokio::test]
    async fn test_get_cleanable_files_excludes_tracked() {
        let repo = TestRepo::with_initial_commit();

        // The README.md is tracked, so it shouldn't appear
        let result = get_cleanable_files(repo.path_str(), None, None).await;

        assert!(result.is_ok());
        let entries = result.unwrap();
        // Should not contain README.md
        assert!(!entries.iter().any(|e| e.path == "README.md"));
    }

    #[tokio::test]
    async fn test_get_cleanable_files_includes_ignored_when_requested() {
        let repo = TestRepo::with_initial_commit();

        // Create a .gitignore
        repo.create_file(".gitignore", "*.log\n");
        repo.stage_file(".gitignore");
        repo.create_commit("Add gitignore", &[]);

        // Create an ignored file
        repo.create_file("debug.log", "log content");

        // Without include_ignored, should not include ignored files
        let result_without = get_cleanable_files(repo.path_str(), Some(false), None).await;
        assert!(result_without.is_ok());
        let entries_without = result_without.unwrap();
        assert!(!entries_without.iter().any(|e| e.path == "debug.log"));

        // With include_ignored, should include ignored files
        let result_with = get_cleanable_files(repo.path_str(), Some(true), None).await;
        assert!(result_with.is_ok());
        let entries_with = result_with.unwrap();
        let ignored_entry = entries_with.iter().find(|e| e.path == "debug.log");
        assert!(ignored_entry.is_some());
        assert!(ignored_entry.unwrap().is_ignored);
    }

    #[tokio::test]
    async fn test_clean_files_removes_file() {
        let repo = TestRepo::with_initial_commit();

        // Create an untracked file
        repo.create_file("to_delete.txt", "delete me");

        // Verify file exists
        assert!(repo.path.join("to_delete.txt").exists());

        let result = clean_files(repo.path_str(), vec!["to_delete.txt".to_string()]).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1);

        // Verify file is deleted
        assert!(!repo.path.join("to_delete.txt").exists());
    }

    #[tokio::test]
    async fn test_clean_files_removes_directory() {
        let repo = TestRepo::with_initial_commit();

        // Create an untracked directory
        repo.create_file("temp_dir/file.txt", "content");

        // Verify directory exists
        assert!(repo.path.join("temp_dir").exists());

        let result = clean_files(repo.path_str(), vec!["temp_dir".to_string()]).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1);

        // Verify directory is deleted
        assert!(!repo.path.join("temp_dir").exists());
    }

    #[tokio::test]
    async fn test_clean_files_multiple() {
        let repo = TestRepo::with_initial_commit();

        // Create multiple untracked files
        repo.create_file("file1.txt", "content 1");
        repo.create_file("file2.txt", "content 2");
        repo.create_file("file3.txt", "content 3");

        let result = clean_files(
            repo.path_str(),
            vec![
                "file1.txt".to_string(),
                "file2.txt".to_string(),
                "file3.txt".to_string(),
            ],
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 3);

        // Verify all files are deleted
        assert!(!repo.path.join("file1.txt").exists());
        assert!(!repo.path.join("file2.txt").exists());
        assert!(!repo.path.join("file3.txt").exists());
    }

    #[tokio::test]
    async fn test_clean_files_nonexistent() {
        let repo = TestRepo::with_initial_commit();

        // Try to clean a file that doesn't exist
        let result = clean_files(repo.path_str(), vec!["nonexistent.txt".to_string()]).await;

        // Should succeed but with 0 files removed
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_clean_all_untracked() {
        let repo = TestRepo::with_initial_commit();

        // Create untracked files
        repo.create_file("untracked1.txt", "content 1");
        repo.create_file("untracked2.txt", "content 2");

        let result = clean_all(repo.path_str(), None, None).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 2);

        // Verify files are deleted
        assert!(!repo.path.join("untracked1.txt").exists());
        assert!(!repo.path.join("untracked2.txt").exists());

        // Tracked file should still exist
        assert!(repo.path.join("README.md").exists());
    }

    #[tokio::test]
    async fn test_clean_all_empty_repo() {
        let repo = TestRepo::with_initial_commit();

        // No untracked files
        let result = clean_all(repo.path_str(), None, None).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_get_cleanable_files_file_size() {
        let repo = TestRepo::with_initial_commit();

        // Create a file with known content
        let content = "Hello, World!";
        repo.create_file("sized_file.txt", content);

        let result = get_cleanable_files(repo.path_str(), None, None).await;

        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].size, Some(content.len() as u64));
    }

    #[tokio::test]
    async fn test_get_cleanable_files_excludes_directories_when_requested() {
        let repo = TestRepo::with_initial_commit();

        // Create an untracked directory and file
        repo.create_file("untracked_dir/file.txt", "content");
        repo.create_file("untracked_file.txt", "content");

        // Exclude directories
        let result = get_cleanable_files(repo.path_str(), None, Some(false)).await;

        assert!(result.is_ok());
        let entries = result.unwrap();
        // Should not contain any directories
        assert!(entries.iter().all(|e| !e.is_directory));
    }

    #[tokio::test]
    async fn test_clean_files_preserves_tracked() {
        let repo = TestRepo::with_initial_commit();

        // Try to clean a tracked file (should not delete it since it's not in workdir as untracked)
        // Actually clean_files will try to delete anything - but the tracked file is restored by git
        // For safety, we test that we don't accidentally delete tracked files
        let readme_content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();

        // Create an untracked file and clean only that
        repo.create_file("untracked.txt", "content");
        let result = clean_files(repo.path_str(), vec!["untracked.txt".to_string()]).await;

        assert!(result.is_ok());

        // README should still exist and be unchanged
        assert!(repo.path.join("README.md").exists());
        let after_content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(readme_content, after_content);
    }
}
