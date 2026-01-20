//! Merge and rebase command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{ConflictEntry, ConflictFile};
use crate::utils::create_command;

/// Represents a commit in the interactive rebase todo list
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseCommit {
    pub oid: String,
    pub short_id: String,
    pub summary: String,
    pub action: String,
}

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
    let reference = repo
        .find_reference(&format!("refs/heads/{}", source_ref))
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
        let refname = head
            .name()
            .ok_or_else(|| LeviathanError::InvalidReference)?;

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
pub async fn rebase(path: String, onto: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Find the onto commit
    let onto_ref = repo
        .find_reference(&format!("refs/heads/{}", onto))
        .or_else(|_| repo.find_reference(&format!("refs/remotes/{}", onto)))
        .or_else(|_| repo.find_reference(&onto))?;

    let onto_commit = repo.reference_to_annotated_commit(&onto_ref)?;
    let head = repo.head()?;
    let head_commit = repo.reference_to_annotated_commit(&head)?;

    let mut rebase = repo.rebase(Some(&head_commit), Some(&onto_commit), None, None)?;

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

/// Get commits between HEAD and a target ref for interactive rebase
#[command]
pub async fn get_rebase_commits(path: String, onto: String) -> Result<Vec<RebaseCommit>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Find the onto commit
    let onto_ref = repo
        .find_reference(&format!("refs/heads/{}", onto))
        .or_else(|_| repo.find_reference(&format!("refs/remotes/{}", onto)))
        .or_else(|_| repo.find_reference(&onto))?;

    let onto_oid = onto_ref
        .target()
        .ok_or_else(|| LeviathanError::InvalidReference)?;

    let head_oid = repo
        .head()?
        .target()
        .ok_or_else(|| LeviathanError::InvalidReference)?;

    let mut revwalk = repo.revwalk()?;
    revwalk.push(head_oid)?;
    revwalk.hide(onto_oid)?;

    let mut commits = Vec::new();

    for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;

        commits.push(RebaseCommit {
            oid: oid.to_string(),
            short_id: oid.to_string()[..7].to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            action: "pick".to_string(),
        });
    }

    // Reverse to get oldest first (git rebase order)
    commits.reverse();

    Ok(commits)
}

/// Execute an interactive rebase using git CLI
#[command]
pub async fn execute_interactive_rebase(path: String, onto: String, todo: String) -> Result<()> {
    // Write the todo to a temp file
    let todo_path = std::env::temp_dir().join("leviathan-rebase-todo");
    std::fs::write(&todo_path, &todo)?;

    // Create a script that outputs the todo file content
    let script_path = std::env::temp_dir().join("leviathan-rebase-editor");

    #[cfg(target_os = "windows")]
    {
        let script_content = format!("@echo off\r\ntype \"{}\" > \"%1\"", todo_path.display());
        std::fs::write(&script_path, script_content)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let script_content = format!("#!/bin/sh\ncat \"{}\" > \"$1\"", todo_path.display());
        std::fs::write(&script_path, &script_content)?;
        // Make the script executable
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))?;
    }

    // Run git rebase -i with our custom editor
    let output = create_command("git")
        .current_dir(&path)
        .env("GIT_SEQUENCE_EDITOR", script_path.to_str().unwrap_or(""))
        .args(["rebase", "-i", &onto])
        .output()
        .map_err(|e| LeviathanError::OperationFailed(e.to_string()))?;

    // Clean up temp files
    let _ = std::fs::remove_file(&todo_path);
    let _ = std::fs::remove_file(&script_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("CONFLICT") || stderr.contains("conflict") {
            return Err(LeviathanError::RebaseConflict);
        }
        return Err(LeviathanError::OperationFailed(stderr.to_string()));
    }

    Ok(())
}

/// Get list of conflicted files
#[command]
pub async fn get_conflicts(path: String) -> Result<Vec<ConflictFile>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let index = repo.index()?;

    tracing::debug!(
        "get_conflicts: repo_state={:?}, has_conflicts={}",
        repo.state(),
        index.has_conflicts()
    );

    let mut conflicts = Vec::new();

    for conflict in index.conflicts()? {
        let conflict = conflict?;

        let get_entry = |entry: Option<git2::IndexEntry>| -> Option<ConflictEntry> {
            entry.map(|e| ConflictEntry {
                oid: e.id.to_string(),
                path: String::from_utf8_lossy(&e.path).to_string(),
                mode: e.mode,
            })
        };

        let file_path = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref())
            .map(|e| String::from_utf8_lossy(&e.path).to_string())
            .unwrap_or_default();

        conflicts.push(ConflictFile {
            path: file_path,
            ancestor: get_entry(conflict.ancestor),
            ours: get_entry(conflict.our),
            theirs: get_entry(conflict.their),
        });
    }

    tracing::debug!("get_conflicts: returning {} conflicts", conflicts.len());
    Ok(conflicts)
}

/// Get content of a blob by OID
#[command]
pub async fn get_blob_content(path: String, oid: String) -> Result<String> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let blob_oid = git2::Oid::from_str(&oid)?;
    let blob = repo.find_blob(blob_oid)?;

    if blob.is_binary() {
        return Err(LeviathanError::OperationFailed(
            "Cannot display binary file".to_string(),
        ));
    }

    Ok(String::from_utf8_lossy(blob.content()).to_string())
}

/// Mark a file as resolved with the given content
#[command]
pub async fn resolve_conflict(path: String, file_path: String, content: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Write the resolved content to the working directory
    let full_path = Path::new(&path).join(&file_path);
    std::fs::write(&full_path, &content)?;

    // Stage the resolved file
    let mut index = repo.index()?;
    index.add_path(Path::new(&file_path))?;
    index.write()?;

    Ok(())
}
