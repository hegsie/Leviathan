//! Staging command handlers

use std::path::Path;
use std::process::Command;
use std::io::Write;
use tauri::command;

use crate::error::Result;
use crate::models::{StatusEntry, FileStatus};

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

        let (file_status, is_staged, is_conflicted) = parse_status(status);

        entries.push(StatusEntry {
            path,
            status: file_status,
            is_staged,
            is_conflicted,
        });
    }

    Ok(entries)
}

fn parse_status(status: git2::Status) -> (FileStatus, bool, bool) {
    let is_conflicted = status.is_conflicted();

    if is_conflicted {
        return (FileStatus::Conflicted, false, true);
    }

    // Check index (staged) status first
    if status.is_index_new() {
        return (FileStatus::New, true, false);
    }
    if status.is_index_modified() {
        return (FileStatus::Modified, true, false);
    }
    if status.is_index_deleted() {
        return (FileStatus::Deleted, true, false);
    }
    if status.is_index_renamed() {
        return (FileStatus::Renamed, true, false);
    }
    if status.is_index_typechange() {
        return (FileStatus::Typechange, true, false);
    }

    // Check worktree (unstaged) status
    if status.is_wt_new() {
        return (FileStatus::Untracked, false, false);
    }
    if status.is_wt_modified() {
        return (FileStatus::Modified, false, false);
    }
    if status.is_wt_deleted() {
        return (FileStatus::Deleted, false, false);
    }
    if status.is_wt_renamed() {
        return (FileStatus::Renamed, false, false);
    }
    if status.is_wt_typechange() {
        return (FileStatus::Typechange, false, false);
    }

    if status.is_ignored() {
        return (FileStatus::Ignored, false, false);
    }

    (FileStatus::Modified, false, false)
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
        .args(["apply", "--cached", "--unidiff-zero"])
        .arg(&patch_file)
        .current_dir(&repo_path)
        .output()?;

    // Clean up temp file
    let _ = std::fs::remove_file(&patch_file);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(crate::error::LeviathanError::OperationFailed(format!("Failed to stage hunk: {}", stderr)));
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
        .args(["apply", "--cached", "--reverse", "--unidiff-zero"])
        .arg(&patch_file)
        .current_dir(&repo_path)
        .output()?;

    // Clean up temp file
    let _ = std::fs::remove_file(&patch_file);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(crate::error::LeviathanError::OperationFailed(format!("Failed to unstage hunk: {}", stderr)));
    }

    Ok(())
}
