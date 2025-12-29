//! Staging command handlers

use std::io::Write;
use std::path::Path;
use std::process::Command;
use tauri::command;

use crate::error::Result;
use crate::models::{FileStatus, StatusEntry};

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

    let mut checkout_opts = git2::build::CheckoutBuilder::new();
    checkout_opts.force();

    for file_path in &paths {
        checkout_opts.path(file_path);
    }

    let head = repo.head()?.peel_to_tree()?;
    repo.checkout_tree(head.as_object(), Some(&mut checkout_opts))?;

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
    let output = Command::new("git")
        // Prevent credential popup dialogs on Windows
        .env("GIT_TERMINAL_PROMPT", "0")
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
    let output = Command::new("git")
        // Prevent credential popup dialogs on Windows
        .env("GIT_TERMINAL_PROMPT", "0")
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
