//! Merge and rebase command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{
    ConflictDetails, ConflictEntry, ConflictFile, ConflictMarker, ConflictMarkerFile,
};
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

/// Detect conflict markers in files
///
/// Scans for Git conflict markers (<<<<<<< ======= >>>>>>>) in working directory files.
/// If file_path is provided, only scans that file. Otherwise, scans all conflicted files.
#[command]
pub async fn detect_conflict_markers(
    path: String,
    file_path: Option<String>,
) -> Result<Vec<ConflictMarkerFile>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let files_to_check: Vec<String> = if let Some(fp) = file_path {
        vec![fp]
    } else {
        // Get all conflicted files from the index
        let index = repo.index()?;
        let mut conflict_paths = Vec::new();
        for conflict in index.conflicts()? {
            let conflict = conflict?;
            if let Some(entry) = conflict.our.or(conflict.their).or(conflict.ancestor) {
                let p = String::from_utf8_lossy(&entry.path).to_string();
                if !conflict_paths.contains(&p) {
                    conflict_paths.push(p);
                }
            }
        }
        conflict_paths
    };

    let mut result = Vec::new();

    for file in files_to_check {
        let full_path = Path::new(&path).join(&file);
        if !full_path.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&full_path) {
            Ok(c) => c,
            Err(_) => continue, // Skip binary files or unreadable files
        };

        let markers = parse_conflict_markers(&content);
        if !markers.is_empty() {
            result.push(ConflictMarkerFile {
                path: file,
                conflict_count: markers.len() as u32,
                markers,
            });
        }
    }

    Ok(result)
}

/// Get detailed conflict information for a specific file
///
/// Returns conflict details including ref names and marker positions
#[command]
pub async fn get_conflict_details(path: String, file_path: String) -> Result<ConflictDetails> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Determine ref names based on repository state
    let (our_ref, their_ref, base_ref) = get_conflict_refs(&repo)?;

    // Read file content and parse markers
    let full_path = Path::new(&path).join(&file_path);
    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to read file: {}", e)))?;

    let markers = parse_conflict_markers(&content);

    Ok(ConflictDetails {
        file_path,
        our_ref,
        their_ref,
        base_ref,
        markers,
    })
}

/// Parse conflict markers from file content
fn parse_conflict_markers(content: &str) -> Vec<ConflictMarker> {
    let mut markers = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    let mut i = 0;
    while i < lines.len() {
        if lines[i].starts_with("<<<<<<<") {
            // Found start of conflict
            let start_line = i as u32 + 1; // 1-indexed
            let mut ours_content = String::new();
            let mut base_content: Option<String> = None;
            let mut theirs_content = String::new();
            let mut separator_line: Option<u32> = None;
            let mut end_line: Option<u32> = None;
            let mut in_base = false;

            i += 1;
            while i < lines.len() {
                let line = lines[i];

                if line.starts_with("|||||||") {
                    // diff3 style - base content marker
                    in_base = true;
                    base_content = Some(String::new());
                    i += 1;
                    continue;
                }

                if line.starts_with("=======") {
                    separator_line = Some(i as u32 + 1);
                    in_base = false;
                    i += 1;
                    continue;
                }

                if line.starts_with(">>>>>>>") {
                    end_line = Some(i as u32 + 1);
                    break;
                }

                if separator_line.is_some() {
                    // After separator, collecting theirs content
                    if !theirs_content.is_empty() {
                        theirs_content.push('\n');
                    }
                    theirs_content.push_str(line);
                } else if in_base {
                    // In base section (diff3 style)
                    if let Some(ref mut base) = base_content {
                        if !base.is_empty() {
                            base.push('\n');
                        }
                        base.push_str(line);
                    }
                } else {
                    // Before separator, collecting ours content
                    if !ours_content.is_empty() {
                        ours_content.push('\n');
                    }
                    ours_content.push_str(line);
                }

                i += 1;
            }

            if let (Some(sep), Some(end)) = (separator_line, end_line) {
                markers.push(ConflictMarker {
                    start_line,
                    separator_line: sep,
                    end_line: end,
                    ours_content,
                    theirs_content,
                    base_content,
                });
            }
        }
        i += 1;
    }

    markers
}

/// Get the ref names for conflicts based on repository state
fn get_conflict_refs(repo: &git2::Repository) -> Result<(String, String, Option<String>)> {
    let state = repo.state();

    match state {
        git2::RepositoryState::Merge => {
            // Read MERGE_HEAD for their ref
            let merge_head_path = repo.path().join("MERGE_HEAD");
            let their_ref = if merge_head_path.exists() {
                std::fs::read_to_string(&merge_head_path)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|_| "MERGE_HEAD".to_string())
            } else {
                "MERGE_HEAD".to_string()
            };

            // Try to get MERGE_MSG for more context
            let merge_msg_path = repo.path().join("MERGE_MSG");
            let their_ref = if let Ok(msg) = std::fs::read_to_string(&merge_msg_path) {
                // Parse branch name from merge message like "Merge branch 'feature' into main"
                if let Some(branch) = parse_merge_branch_from_msg(&msg) {
                    branch
                } else if their_ref.len() > 7 {
                    their_ref[..7].to_string()
                } else {
                    their_ref
                }
            } else if their_ref.len() > 7 {
                their_ref[..7].to_string()
            } else {
                their_ref
            };

            let our_ref = get_head_name(repo);

            Ok((our_ref, their_ref, None))
        }
        git2::RepositoryState::Rebase
        | git2::RepositoryState::RebaseInteractive
        | git2::RepositoryState::RebaseMerge => {
            // During rebase, HEAD is the rebased branch, and we're applying commits from another branch
            let rebase_dir = if repo.path().join("rebase-merge").exists() {
                repo.path().join("rebase-merge")
            } else {
                repo.path().join("rebase-apply")
            };

            let their_ref = std::fs::read_to_string(rebase_dir.join("head-name"))
                .map(|s| s.trim().replace("refs/heads/", ""))
                .unwrap_or_else(|_| "HEAD".to_string());

            let our_ref = std::fs::read_to_string(rebase_dir.join("onto"))
                .map(|s| {
                    let oid = s.trim();
                    if oid.len() > 7 {
                        oid[..7].to_string()
                    } else {
                        oid.to_string()
                    }
                })
                .unwrap_or_else(|_| "onto".to_string());

            Ok((our_ref, their_ref, None))
        }
        git2::RepositoryState::CherryPick => {
            let our_ref = get_head_name(repo);
            let cherry_pick_head = repo.path().join("CHERRY_PICK_HEAD");
            let their_ref = std::fs::read_to_string(&cherry_pick_head)
                .map(|s| {
                    let oid = s.trim();
                    if oid.len() > 7 {
                        oid[..7].to_string()
                    } else {
                        oid.to_string()
                    }
                })
                .unwrap_or_else(|_| "CHERRY_PICK_HEAD".to_string());

            Ok((our_ref, their_ref, None))
        }
        git2::RepositoryState::Revert => {
            let our_ref = get_head_name(repo);
            let revert_head = repo.path().join("REVERT_HEAD");
            let their_ref = std::fs::read_to_string(&revert_head)
                .map(|s| {
                    let oid = s.trim();
                    if oid.len() > 7 {
                        oid[..7].to_string()
                    } else {
                        oid.to_string()
                    }
                })
                .unwrap_or_else(|_| "REVERT_HEAD".to_string());

            Ok((our_ref, their_ref, None))
        }
        _ => {
            // Default to HEAD for our ref
            let our_ref = get_head_name(repo);
            Ok((our_ref, "incoming".to_string(), None))
        }
    }
}

/// Get a human-readable name for HEAD
fn get_head_name(repo: &git2::Repository) -> String {
    match repo.head() {
        Ok(head) => {
            if head.is_branch() {
                head.shorthand().unwrap_or("HEAD").to_string()
            } else if let Some(oid) = head.target() {
                let oid_str = oid.to_string();
                if oid_str.len() > 7 {
                    oid_str[..7].to_string()
                } else {
                    oid_str
                }
            } else {
                "HEAD".to_string()
            }
        }
        Err(_) => "HEAD".to_string(),
    }
}

/// Parse branch name from merge commit message
fn parse_merge_branch_from_msg(msg: &str) -> Option<String> {
    // Common patterns:
    // "Merge branch 'feature' into main"
    // "Merge branch 'feature/something' into develop"
    // "Merge remote-tracking branch 'origin/feature'"
    let first_line = msg.lines().next()?;

    if first_line.starts_with("Merge branch '") {
        let start = "Merge branch '".len();
        let rest = &first_line[start..];
        if let Some(end) = rest.find('\'') {
            return Some(rest[..end].to_string());
        }
    }

    if first_line.starts_with("Merge remote-tracking branch '") {
        let start = "Merge remote-tracking branch '".len();
        let rest = &first_line[start..];
        if let Some(end) = rest.find('\'') {
            return Some(rest[..end].to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_merge_fast_forward() {
        let repo = TestRepo::with_initial_commit();

        // Create a feature branch and add a commit
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);

        // Switch back to main/master branch
        let main_branch = repo.current_branch();
        repo.checkout_branch(&main_branch);

        // Merge feature branch (should be fast-forward)
        let result = merge(repo.path_str(), "feature".to_string(), None, None, None).await;

        assert!(result.is_ok());

        // Verify the file from feature branch exists
        assert!(repo.path.join("feature.txt").exists());
    }

    #[tokio::test]
    async fn test_merge_no_ff() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Create a feature branch and add a commit
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);

        // Switch back to main branch
        repo.checkout_branch(&initial_branch);

        // Merge with no-ff flag
        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true), // no-ff
            None,
            Some("Merge feature branch".to_string()),
        )
        .await;

        assert!(result.is_ok());

        // With no-ff, a merge commit should have been created
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap();
        let commit = head.peel_to_commit().unwrap();

        // Merge commit should have 2 parents
        assert_eq!(commit.parent_count(), 2);
    }

    #[tokio::test]
    async fn test_merge_squash() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Create a feature branch with multiple commits
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit 1", &[("file1.txt", "content1")]);
        repo.create_commit("Feature commit 2", &[("file2.txt", "content2")]);

        // Switch back to main branch
        repo.checkout_branch(&initial_branch);

        // Squash merge
        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            None,
            Some(true), // squash
            Some("Squashed feature".to_string()),
        )
        .await;

        assert!(result.is_ok());

        // Squash merge should have only 1 parent (not a merge commit)
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap();
        let commit = head.peel_to_commit().unwrap();
        assert_eq!(commit.parent_count(), 1);

        // But both files should exist
        assert!(repo.path.join("file1.txt").exists());
        assert!(repo.path.join("file2.txt").exists());
    }

    #[tokio::test]
    async fn test_merge_already_up_to_date() {
        let repo = TestRepo::with_initial_commit();

        // Create branch at same point
        repo.create_branch("same-point");

        // Merge should succeed (no-op)
        let result = merge(repo.path_str(), "same-point".to_string(), None, None, None).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_merge_nonexistent_branch() {
        let repo = TestRepo::with_initial_commit();

        let result = merge(repo.path_str(), "nonexistent".to_string(), None, None, None).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_abort_merge() {
        let repo = TestRepo::with_initial_commit();

        // Even without an active merge, abort_merge should succeed
        // (it just cleans up state and checks out HEAD)
        let result = abort_merge(repo.path_str()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_rebase_simple() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        let initial_oid = repo.head_oid();

        // Create a feature branch
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature")]);

        // Go back to main and add a commit
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main commit", &[("main.txt", "main")]);
        let main_oid = repo.head_oid();

        // Checkout feature and rebase onto main
        repo.checkout_branch("feature");

        let result = rebase(repo.path_str(), initial_branch.clone()).await;
        assert!(result.is_ok());

        // After rebase, feature should be based on main's latest commit
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap();
        let commit = head.peel_to_commit().unwrap();
        let parent = commit.parent(0).unwrap();

        assert_eq!(parent.id(), main_oid);
        assert_ne!(parent.id(), initial_oid);
    }

    #[tokio::test]
    async fn test_rebase_nonexistent_onto() {
        let repo = TestRepo::with_initial_commit();

        let result = rebase(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_abort_rebase() {
        let repo = TestRepo::with_initial_commit();

        // Without an active rebase, this should fail
        let result = abort_rebase(repo.path_str()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_rebase_commits() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Create feature branch with commits
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature 1", &[("f1.txt", "1")]);
        repo.create_commit("Feature 2", &[("f2.txt", "2")]);
        repo.create_commit("Feature 3", &[("f3.txt", "3")]);

        let result = get_rebase_commits(repo.path_str(), initial_branch).await;
        assert!(result.is_ok());

        let commits = result.unwrap();
        assert_eq!(commits.len(), 3);

        // Commits should be in oldest-first order (git rebase order)
        assert!(commits[0].summary.contains("Feature 1"));
        assert!(commits[1].summary.contains("Feature 2"));
        assert!(commits[2].summary.contains("Feature 3"));

        // Each commit should have "pick" as the default action
        for commit in &commits {
            assert_eq!(commit.action, "pick");
        }
    }

    #[tokio::test]
    async fn test_get_rebase_commits_no_divergence() {
        let repo = TestRepo::with_initial_commit();

        // Create branch at same point
        repo.create_branch("same-point");

        let result = get_rebase_commits(repo.path_str(), "same-point".to_string()).await;
        assert!(result.is_ok());

        // No commits to rebase
        let commits = result.unwrap();
        assert!(commits.is_empty());
    }

    #[tokio::test]
    async fn test_get_conflicts_no_conflicts() {
        let repo = TestRepo::with_initial_commit();

        let result = get_conflicts(repo.path_str()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_blob_content() {
        let repo = TestRepo::with_initial_commit();
        let content = "Hello, World!";
        repo.create_commit("Add file", &[("test.txt", content)]);

        // Get the blob OID from the tree
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap();
        let commit = head.peel_to_commit().unwrap();
        let tree = commit.tree().unwrap();
        let entry = tree.get_name("test.txt").unwrap();
        let blob_oid = entry.id().to_string();

        let result = get_blob_content(repo.path_str(), blob_oid).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), content);
    }

    #[tokio::test]
    async fn test_get_blob_content_invalid_oid() {
        let repo = TestRepo::with_initial_commit();

        let result = get_blob_content(
            repo.path_str(),
            "0000000000000000000000000000000000000000".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_resolve_conflict_writes_and_stages() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add file", &[("conflict.txt", "original")]);

        let resolved_content = "resolved content";
        let result = resolve_conflict(
            repo.path_str(),
            "conflict.txt".to_string(),
            resolved_content.to_string(),
        )
        .await;

        assert!(result.is_ok());

        // Verify file content was written
        let file_content = std::fs::read_to_string(repo.path.join("conflict.txt")).unwrap();
        assert_eq!(file_content, resolved_content);

        // Verify file is staged
        let git_repo = repo.repo();
        let index = git_repo.index().unwrap();
        let entry = index
            .iter()
            .find(|e| String::from_utf8_lossy(&e.path) == "conflict.txt");
        assert!(entry.is_some());
    }

    #[tokio::test]
    async fn test_rebase_commit_struct_serialization() {
        let commit = RebaseCommit {
            oid: "abc123def456".to_string(),
            short_id: "abc123d".to_string(),
            summary: "Test commit".to_string(),
            action: "pick".to_string(),
        };

        let json = serde_json::to_string(&commit);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("\"oid\":\"abc123def456\""));
        assert!(json_str.contains("\"shortId\":\"abc123d\""));
        assert!(json_str.contains("\"action\":\"pick\""));
    }

    #[tokio::test]
    async fn test_merge_with_conflict() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Create conflicting changes
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);

        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);

        // Attempt merge - should result in conflict
        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true), // no-ff to force merge
            None,
            None,
        )
        .await;

        // Should return MergeConflict error
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_continue_rebase_without_active_rebase() {
        let repo = TestRepo::with_initial_commit();

        // Should fail without an active rebase
        let result = continue_rebase(repo.path_str()).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_conflict_markers_simple() {
        let content = r#"some code
<<<<<<< HEAD
our changes
=======
their changes
>>>>>>> feature
more code"#;

        let markers = parse_conflict_markers(content);
        assert_eq!(markers.len(), 1);

        let marker = &markers[0];
        assert_eq!(marker.start_line, 2);
        assert_eq!(marker.separator_line, 4);
        assert_eq!(marker.end_line, 6);
        assert_eq!(marker.ours_content, "our changes");
        assert_eq!(marker.theirs_content, "their changes");
        assert!(marker.base_content.is_none());
    }

    #[test]
    fn test_parse_conflict_markers_diff3() {
        let content = r#"<<<<<<< HEAD
our changes
||||||| base
original content
=======
their changes
>>>>>>> feature"#;

        let markers = parse_conflict_markers(content);
        assert_eq!(markers.len(), 1);

        let marker = &markers[0];
        assert_eq!(marker.ours_content, "our changes");
        assert_eq!(marker.theirs_content, "their changes");
        assert_eq!(marker.base_content.as_deref(), Some("original content"));
    }

    #[test]
    fn test_parse_conflict_markers_multiple() {
        let content = r#"<<<<<<< HEAD
change 1 ours
=======
change 1 theirs
>>>>>>> branch
middle content
<<<<<<< HEAD
change 2 ours
=======
change 2 theirs
>>>>>>> branch"#;

        let markers = parse_conflict_markers(content);
        assert_eq!(markers.len(), 2);

        assert_eq!(markers[0].ours_content, "change 1 ours");
        assert_eq!(markers[0].theirs_content, "change 1 theirs");

        assert_eq!(markers[1].ours_content, "change 2 ours");
        assert_eq!(markers[1].theirs_content, "change 2 theirs");
    }

    #[test]
    fn test_parse_conflict_markers_multiline() {
        let content = r#"<<<<<<< HEAD
line 1
line 2
line 3
=======
other line 1
other line 2
>>>>>>> feature"#;

        let markers = parse_conflict_markers(content);
        assert_eq!(markers.len(), 1);

        assert_eq!(markers[0].ours_content, "line 1\nline 2\nline 3");
        assert_eq!(markers[0].theirs_content, "other line 1\nother line 2");
    }

    #[test]
    fn test_parse_conflict_markers_empty_sections() {
        let content = r#"<<<<<<< HEAD
=======
their content
>>>>>>> feature"#;

        let markers = parse_conflict_markers(content);
        assert_eq!(markers.len(), 1);

        assert_eq!(markers[0].ours_content, "");
        assert_eq!(markers[0].theirs_content, "their content");
    }

    #[test]
    fn test_parse_conflict_markers_no_conflicts() {
        let content = "normal file content\nno conflicts here";

        let markers = parse_conflict_markers(content);
        assert!(markers.is_empty());
    }

    #[test]
    fn test_parse_merge_branch_from_msg() {
        assert_eq!(
            parse_merge_branch_from_msg("Merge branch 'feature' into main"),
            Some("feature".to_string())
        );

        assert_eq!(
            parse_merge_branch_from_msg("Merge branch 'feature/login' into develop"),
            Some("feature/login".to_string())
        );

        assert_eq!(
            parse_merge_branch_from_msg("Merge remote-tracking branch 'origin/main'"),
            Some("origin/main".to_string())
        );

        assert_eq!(
            parse_merge_branch_from_msg("Some other commit message"),
            None
        );
    }

    #[tokio::test]
    async fn test_detect_conflict_markers_no_conflicts() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add file", &[("test.txt", "normal content")]);

        let result = detect_conflict_markers(repo.path_str(), Some("test.txt".to_string())).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_detect_conflict_markers_with_markers() {
        let repo = TestRepo::with_initial_commit();

        // Write a file with conflict markers directly (simulating a conflict state)
        let conflict_content = r#"start
<<<<<<< HEAD
our version
=======
their version
>>>>>>> feature
end"#;
        std::fs::write(repo.path.join("conflict.txt"), conflict_content).unwrap();

        let result =
            detect_conflict_markers(repo.path_str(), Some("conflict.txt".to_string())).await;
        assert!(result.is_ok());

        let files = result.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "conflict.txt");
        assert_eq!(files[0].conflict_count, 1);
        assert_eq!(files[0].markers[0].ours_content, "our version");
        assert_eq!(files[0].markers[0].theirs_content, "their version");
    }

    #[tokio::test]
    async fn test_get_conflict_details() {
        let repo = TestRepo::with_initial_commit();

        // Write a file with conflict markers
        let conflict_content = r#"<<<<<<< HEAD
ours
=======
theirs
>>>>>>> feature"#;
        std::fs::write(repo.path.join("file.txt"), conflict_content).unwrap();

        let result = get_conflict_details(repo.path_str(), "file.txt".to_string()).await;
        assert!(result.is_ok());

        let details = result.unwrap();
        assert_eq!(details.file_path, "file.txt");
        assert!(!details.our_ref.is_empty());
        assert_eq!(details.markers.len(), 1);
    }

    #[tokio::test]
    async fn test_get_conflict_details_nonexistent_file() {
        let repo = TestRepo::with_initial_commit();

        let result = get_conflict_details(repo.path_str(), "nonexistent.txt".to_string()).await;
        assert!(result.is_err());
    }
}
