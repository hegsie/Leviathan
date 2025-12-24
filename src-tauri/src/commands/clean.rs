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
