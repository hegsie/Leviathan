//! Cherry-pick, revert, and reset command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::Commit;

/// Cherry-pick a commit onto the current branch
#[command]
pub async fn cherry_pick(path: String, commit_oid: String) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;

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
        "Cherry-pick completed. has_conflicts: {}, repo_state: {:?}",
        has_conflicts,
        repo.state()
    );

    if has_conflicts {
        tracing::debug!("Returning CherryPickConflict error");
        return Err(LeviathanError::CherryPickConflict);
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

/// Cherry-pick a range of commits onto the current branch (oldest first order)
#[command]
pub async fn cherry_pick_range(path: String, commit_oids: Vec<String>) -> Result<Vec<Commit>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check for existing operations in progress
    if repo.state() != git2::RepositoryState::Clean {
        return Err(LeviathanError::OperationFailed(
            "Another operation is in progress".to_string(),
        ));
    }

    if commit_oids.is_empty() {
        return Err(LeviathanError::OperationFailed(
            "No commits specified for cherry-pick".to_string(),
        ));
    }

    let mut results = Vec::new();

    for commit_oid in &commit_oids {
        let oid = git2::Oid::from_str(commit_oid)
            .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;

        if commit.parent_count() == 0 {
            return Err(LeviathanError::OperationFailed(format!(
                "Cannot cherry-pick root commit {}",
                commit_oid
            )));
        }

        let mut checkout_builder = git2::build::CheckoutBuilder::new();
        checkout_builder
            .allow_conflicts(true)
            .conflict_style_merge(true);

        let mut opts = git2::CherrypickOptions::new();
        opts.checkout_builder(checkout_builder);

        if commit.parent_count() > 1 {
            opts.mainline(1);
        }

        repo.cherrypick(&commit, Some(&mut opts))?;

        let mut index = repo.index()?;
        if index.has_conflicts() {
            // Write the remaining commits to a sequence file so the user can continue
            let remaining: Vec<String> = commit_oids
                .iter()
                .skip(results.len() + 1)
                .cloned()
                .collect();
            if !remaining.is_empty() {
                let seq_path = Path::new(&path).join(".git/CHERRY_PICK_SEQUENCE");
                std::fs::write(&seq_path, remaining.join("\n"))?;
            }
            return Err(LeviathanError::CherryPickConflict);
        }

        // Create the commit
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

        repo.cleanup_state()?;

        let new_commit = repo.find_commit(new_oid)?;
        results.push(Commit::from_git2(&new_commit));
    }

    // Clean up sequence file if it exists
    let seq_path = Path::new(&path).join(".git/CHERRY_PICK_SEQUENCE");
    if seq_path.exists() {
        let _ = std::fs::remove_file(&seq_path);
    }

    Ok(results)
}

/// Represents the current state of an interactive rebase
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseState {
    pub in_progress: bool,
    pub head_name: Option<String>,
    pub onto: Option<String>,
    pub current_commit: Option<String>,
    pub done_count: u32,
    pub total_count: u32,
    pub has_conflicts: bool,
}

/// Represents an entry in the rebase todo list
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseTodoEntry {
    pub action: String,
    pub commit_oid: String,
    pub commit_short: String,
    pub message: String,
}

/// Represents the full rebase todo state
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseTodo {
    pub entries: Vec<RebaseTodoEntry>,
    pub done: Vec<RebaseTodoEntry>,
}

/// Get the current interactive rebase state
#[command]
pub async fn get_rebase_state(path: String) -> Result<RebaseState> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let state = repo.state();
    let in_progress = matches!(
        state,
        git2::RepositoryState::Rebase
            | git2::RepositoryState::RebaseInteractive
            | git2::RepositoryState::RebaseMerge
    );

    if !in_progress {
        return Ok(RebaseState {
            in_progress: false,
            head_name: None,
            onto: None,
            current_commit: None,
            done_count: 0,
            total_count: 0,
            has_conflicts: false,
        });
    }

    let git_dir = Path::new(&path).join(".git");
    let rebase_merge_dir = git_dir.join("rebase-merge");
    let rebase_apply_dir = git_dir.join("rebase-apply");

    // Determine which rebase directory is active
    let rebase_dir = if rebase_merge_dir.exists() {
        rebase_merge_dir
    } else if rebase_apply_dir.exists() {
        rebase_apply_dir
    } else {
        return Ok(RebaseState {
            in_progress: true,
            head_name: None,
            onto: None,
            current_commit: None,
            done_count: 0,
            total_count: 0,
            has_conflicts: repo.index()?.has_conflicts(),
        });
    };

    // Read head-name (branch being rebased)
    let head_name = std::fs::read_to_string(rebase_dir.join("head-name"))
        .ok()
        .map(|s| s.trim().to_string())
        .map(|s| s.strip_prefix("refs/heads/").unwrap_or(&s).to_string());

    // Read onto (target commit)
    let onto = std::fs::read_to_string(rebase_dir.join("onto"))
        .ok()
        .map(|s| s.trim().to_string());

    // Read current commit being applied (stopped-sha or current-commit)
    let current_commit = std::fs::read_to_string(rebase_dir.join("stopped-sha"))
        .or_else(|_| std::fs::read_to_string(rebase_dir.join("current-commit")))
        .ok()
        .map(|s| s.trim().to_string());

    // Count done and total entries
    let done_count = std::fs::read_to_string(rebase_dir.join("done"))
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0);

    let todo_count = std::fs::read_to_string(rebase_dir.join("git-rebase-todo"))
        .map(|s| {
            s.lines()
                .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
                .count() as u32
        })
        .unwrap_or(0);

    let total_count = done_count + todo_count;

    let has_conflicts = repo.index()?.has_conflicts();

    Ok(RebaseState {
        in_progress: true,
        head_name,
        onto,
        current_commit,
        done_count,
        total_count,
        has_conflicts,
    })
}

/// Parse a rebase todo line into a RebaseTodoEntry
fn parse_todo_line(line: &str, repo: &git2::Repository) -> Option<RebaseTodoEntry> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }

    let parts: Vec<&str> = line.splitn(3, ' ').collect();
    if parts.len() < 2 {
        return None;
    }

    let action = parts[0].to_lowercase();
    let commit_short = parts[1].to_string();

    // Try to resolve the full OID
    let commit_oid = repo
        .revparse_single(&commit_short)
        .ok()
        .map(|obj| obj.id().to_string())
        .unwrap_or_else(|| commit_short.clone());

    // Get the message from the line or from the commit
    let message = if parts.len() >= 3 {
        parts[2].to_string()
    } else {
        repo.find_commit(git2::Oid::from_str(&commit_oid).ok()?)
            .ok()
            .and_then(|c| c.summary().map(|s| s.to_string()))
            .unwrap_or_default()
    };

    Some(RebaseTodoEntry {
        action,
        commit_oid,
        commit_short,
        message,
    })
}

/// Get the current rebase todo list
#[command]
pub async fn get_rebase_todo(path: String) -> Result<RebaseTodo> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let state = repo.state();
    if !matches!(
        state,
        git2::RepositoryState::Rebase
            | git2::RepositoryState::RebaseInteractive
            | git2::RepositoryState::RebaseMerge
    ) {
        return Err(LeviathanError::OperationFailed(
            "No rebase in progress".to_string(),
        ));
    }

    let git_dir = Path::new(&path).join(".git");
    let rebase_merge_dir = git_dir.join("rebase-merge");
    let rebase_apply_dir = git_dir.join("rebase-apply");

    let rebase_dir = if rebase_merge_dir.exists() {
        rebase_merge_dir
    } else if rebase_apply_dir.exists() {
        rebase_apply_dir
    } else {
        return Err(LeviathanError::OperationFailed(
            "Cannot find rebase directory".to_string(),
        ));
    };

    // Read todo entries
    let todo_content =
        std::fs::read_to_string(rebase_dir.join("git-rebase-todo")).unwrap_or_default();
    let entries: Vec<RebaseTodoEntry> = todo_content
        .lines()
        .filter_map(|line| parse_todo_line(line, &repo))
        .collect();

    // Read done entries
    let done_content = std::fs::read_to_string(rebase_dir.join("done")).unwrap_or_default();
    let done: Vec<RebaseTodoEntry> = done_content
        .lines()
        .filter_map(|line| parse_todo_line(line, &repo))
        .collect();

    Ok(RebaseTodo { entries, done })
}

/// Update the rebase todo list (reorder, change actions)
#[command]
pub async fn update_rebase_todo(path: String, entries: Vec<RebaseTodoEntry>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let state = repo.state();
    if !matches!(
        state,
        git2::RepositoryState::Rebase
            | git2::RepositoryState::RebaseInteractive
            | git2::RepositoryState::RebaseMerge
    ) {
        return Err(LeviathanError::OperationFailed(
            "No rebase in progress".to_string(),
        ));
    }

    let git_dir = Path::new(&path).join(".git");
    let rebase_merge_dir = git_dir.join("rebase-merge");
    let rebase_apply_dir = git_dir.join("rebase-apply");

    let rebase_dir = if rebase_merge_dir.exists() {
        rebase_merge_dir
    } else if rebase_apply_dir.exists() {
        rebase_apply_dir
    } else {
        return Err(LeviathanError::OperationFailed(
            "Cannot find rebase directory".to_string(),
        ));
    };

    // Build the new todo content
    let todo_content: String = entries
        .iter()
        .map(|entry| format!("{} {} {}", entry.action, entry.commit_short, entry.message))
        .collect::<Vec<_>>()
        .join("\n");

    // Write the updated todo file
    std::fs::write(rebase_dir.join("git-rebase-todo"), todo_content)?;

    Ok(())
}

/// Skip the current commit during an interactive rebase
#[command]
pub async fn skip_rebase_commit(path: String) -> Result<()> {
    // Use git rebase --skip via CLI as it's the most reliable way
    let output = crate::utils::create_command("git")
        .current_dir(&path)
        .args(["rebase", "--skip"])
        .output()
        .map_err(|e| LeviathanError::OperationFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("CONFLICT") || stderr.contains("conflict") {
            return Err(LeviathanError::RebaseConflict);
        }
        return Err(LeviathanError::OperationFailed(stderr.to_string()));
    }

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

/// Result of a drop commit operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropCommitResult {
    pub success: bool,
    pub new_tip: String,
    pub has_conflicts: bool,
    pub dropped_message: String,
}

/// Drop (remove) a commit from history
///
/// This removes a commit from the branch history by replaying all commits
/// after the dropped one onto its parent, effectively performing an interactive
/// rebase with a "drop" action for the specified commit.
///
/// # Arguments
/// * `path` - Repository path
/// * `commit_oid` - The OID of the commit to drop
#[command]
pub async fn drop_commit(path: String, commit_oid: String) -> Result<DropCommitResult> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check for existing operations in progress
    if repo.state() != git2::RepositoryState::Clean {
        return Err(LeviathanError::OperationFailed(
            "Another operation is in progress".to_string(),
        ));
    }

    // Verify the repository has no uncommitted changes
    let statuses = repo.statuses(None)?;
    if !statuses.is_empty() {
        let has_changes = statuses
            .iter()
            .any(|s| s.status() != git2::Status::IGNORED && s.status() != git2::Status::CURRENT);
        if has_changes {
            return Err(LeviathanError::OperationFailed(
                "Working directory has uncommitted changes. Commit or stash them first."
                    .to_string(),
            ));
        }
    }

    // Parse the commit OID
    let target_oid = git2::Oid::from_str(&commit_oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;

    let target_commit = repo
        .find_commit(target_oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;

    let dropped_message = target_commit
        .message()
        .unwrap_or("")
        .lines()
        .next()
        .unwrap_or("")
        .to_string();

    // Cannot drop root commit (no parent to rebase onto)
    if target_commit.parent_count() == 0 {
        return Err(LeviathanError::OperationFailed(
            "Cannot drop root commit".to_string(),
        ));
    }

    // Get the current HEAD
    let head_commit = repo.head()?.peel_to_commit()?;

    // If the commit to drop IS the HEAD, simply reset to its parent
    if head_commit.id() == target_oid {
        let parent = target_commit.parent(0)?;
        let parent_oid = parent.id();

        // Update HEAD to the parent
        let head_ref = repo.head()?;
        if head_ref.is_branch() {
            let branch_name = head_ref.shorthand().unwrap_or("HEAD");
            let refname = format!("refs/heads/{}", branch_name);
            repo.reference(
                &refname,
                parent_oid,
                true,
                &format!(
                    "drop: remove commit {}",
                    &commit_oid[..8.min(commit_oid.len())]
                ),
            )?;
        } else {
            repo.set_head_detached(parent_oid)?;
        }

        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

        return Ok(DropCommitResult {
            success: true,
            new_tip: parent_oid.to_string(),
            has_conflicts: false,
            dropped_message,
        });
    }

    // Verify that target_commit is an ancestor of HEAD
    if !repo.graph_descendant_of(head_commit.id(), target_commit.id())? {
        return Err(LeviathanError::OperationFailed(
            "Commit to drop is not an ancestor of HEAD".to_string(),
        ));
    }

    // Get the parent of the commit to drop - this is where we rebase onto
    let drop_parent = target_commit.parent(0)?;

    // Collect all commits after the dropped commit up to HEAD (oldest first)
    let mut commits_after_drop = Vec::new();
    let mut revwalk = repo.revwalk()?;
    revwalk.push(head_commit.id())?;
    revwalk.hide(target_oid)?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::REVERSE)?;

    for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        commits_after_drop.push(commit);
    }

    // Replay all commits after the dropped one onto the drop parent
    let mut current_base_oid = drop_parent.id();
    let signature = repo.signature()?;

    for commit in &commits_after_drop {
        let current_base = repo.find_commit(current_base_oid)?;

        let new_tree = {
            let commit_parent = commit.parent(0)?;
            let parent_tree = commit_parent.tree()?;
            let commit_tree = commit.tree()?;
            let base_tree = current_base.tree()?;

            let mut merge_result =
                repo.merge_trees(&parent_tree, &base_tree, &commit_tree, None)?;

            if merge_result.has_conflicts() {
                // Conflicts occurred while replaying
                let tree_oid = merge_result.write_tree_to(&repo)?;
                let _tree = repo.find_tree(tree_oid)?;

                return Ok(DropCommitResult {
                    success: false,
                    new_tip: current_base_oid.to_string(),
                    has_conflicts: true,
                    dropped_message,
                });
            }

            let new_tree_oid = merge_result.write_tree_to(&repo)?;
            repo.find_tree(new_tree_oid)?
        };

        current_base_oid = repo.commit(
            None,
            &commit.author(),
            &signature,
            commit.message().unwrap_or(""),
            &new_tree,
            &[&current_base],
        )?;
    }

    // Update HEAD to point to the final replayed commit
    let head_ref = repo.head()?;
    if head_ref.is_branch() {
        let branch_name = head_ref.shorthand().unwrap_or("HEAD");
        let refname = format!("refs/heads/{}", branch_name);
        repo.reference(
            &refname,
            current_base_oid,
            true,
            &format!(
                "drop: remove commit {}",
                &commit_oid[..8.min(commit_oid.len())]
            ),
        )?;
    } else {
        repo.set_head_detached(current_base_oid)?;
    }

    // Checkout to update working directory
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

    Ok(DropCommitResult {
        success: true,
        new_tip: current_base_oid.to_string(),
        has_conflicts: false,
        dropped_message,
    })
}

/// Result of a commit reorder operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderResult {
    pub success: bool,
    pub new_tip: String,
    pub reordered_count: u32,
    pub has_conflicts: bool,
}

/// Reorder commits by replaying them in a new order
///
/// This performs a non-interactive rebase-like operation that replays commits
/// in a different order. The commits are cherry-picked onto the base commit
/// in the specified order.
///
/// # Arguments
/// * `path` - Repository path
/// * `base_commit` - Parent of the oldest commit to reorder (exclusive base)
/// * `commit_order` - New order of commit OIDs from oldest to newest
#[command]
pub async fn reorder_commits(
    path: String,
    base_commit: String,
    commit_order: Vec<String>,
) -> Result<ReorderResult> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check for existing operations in progress
    if repo.state() != git2::RepositoryState::Clean {
        return Err(LeviathanError::OperationFailed(
            "Another operation is in progress".to_string(),
        ));
    }

    // Verify the repository has no uncommitted changes
    let statuses = repo.statuses(None)?;
    if !statuses.is_empty() {
        let has_changes = statuses
            .iter()
            .any(|s| s.status() != git2::Status::IGNORED && s.status() != git2::Status::CURRENT);
        if has_changes {
            return Err(LeviathanError::OperationFailed(
                "Working directory has uncommitted changes. Commit or stash them first."
                    .to_string(),
            ));
        }
    }

    if commit_order.is_empty() {
        return Err(LeviathanError::OperationFailed(
            "No commits specified for reordering".to_string(),
        ));
    }

    // Parse the base commit
    let base_oid = git2::Oid::from_str(&base_commit)
        .map_err(|_| LeviathanError::CommitNotFound(base_commit.clone()))?;
    let _base = repo
        .find_commit(base_oid)
        .map_err(|_| LeviathanError::CommitNotFound(base_commit.clone()))?;

    // Parse and validate all commit OIDs in the new order
    let mut commits_in_order = Vec::new();
    for oid_str in &commit_order {
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|_| LeviathanError::CommitNotFound(oid_str.clone()))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|_| LeviathanError::CommitNotFound(oid_str.clone()))?;
        commits_in_order.push(commit);
    }

    // Collect the original commits between base and HEAD to validate
    let head_commit = repo.head()?.peel_to_commit()?;
    let mut original_oids = std::collections::HashSet::new();
    let mut revwalk = repo.revwalk()?;
    revwalk.push(head_commit.id())?;
    revwalk.hide(base_oid)?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::REVERSE)?;

    for oid in revwalk {
        let oid = oid?;
        original_oids.insert(oid);
    }

    // Verify that the reorder list contains exactly the same commits
    let reorder_oids: std::collections::HashSet<git2::Oid> =
        commits_in_order.iter().map(|c| c.id()).collect();

    if original_oids != reorder_oids {
        return Err(LeviathanError::OperationFailed(
            "Reorder list must contain exactly the same commits as the original range".to_string(),
        ));
    }

    let reordered_count = commits_in_order.len() as u32;

    // Replay commits in the new order onto the base commit
    let mut current_base_oid = base_oid;
    let signature = repo.signature()?;

    for commit in &commits_in_order {
        let current_base = repo.find_commit(current_base_oid)?;

        // Cherry-pick this commit onto the new base using tree merge
        let commit_parent = commit.parent(0).map_err(|_| {
            LeviathanError::OperationFailed(format!("Cannot reorder root commit {}", commit.id()))
        })?;
        let parent_tree = commit_parent.tree()?;
        let commit_tree = commit.tree()?;
        let base_tree = current_base.tree()?;

        let mut merge_result = repo.merge_trees(&parent_tree, &base_tree, &commit_tree, None)?;

        if merge_result.has_conflicts() {
            // Restore HEAD to original state - abort the reorder
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

            return Ok(ReorderResult {
                success: false,
                new_tip: head_commit.id().to_string(),
                reordered_count: 0,
                has_conflicts: true,
            });
        }

        let new_tree_oid = merge_result.write_tree_to(&repo)?;
        let new_tree = repo.find_tree(new_tree_oid)?;

        // Create the replayed commit preserving original author and message
        current_base_oid = repo.commit(
            None,
            &commit.author(),
            &signature,
            commit.message().unwrap_or(""),
            &new_tree,
            &[&current_base],
        )?;
    }

    // Update HEAD to point to the final commit
    let head = repo.head()?;
    if head.is_branch() {
        let branch_name = head.shorthand().unwrap_or("HEAD");
        let refname = format!("refs/heads/{}", branch_name);
        repo.reference(
            &refname,
            current_base_oid,
            true,
            &format!("reorder: {} commits reordered", reordered_count),
        )?;
    } else {
        repo.set_head_detached(current_base_oid)?;
    }

    // Checkout the new commit to update working directory
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

    Ok(ReorderResult {
        success: true,
        new_tip: current_base_oid.to_string(),
        reordered_count,
        has_conflicts: false,
    })
}

/// Cherry-pick commits from the tip of a branch by name
///
/// Resolves the given branch name to its tip commit and cherry-picks
/// the most recent `count` commits (default 1) onto the current branch.
/// Commits are applied oldest-first.
///
/// # Arguments
/// * `path` - Repository path
/// * `branch` - Branch name to cherry-pick from
/// * `count` - Number of commits from the tip to cherry-pick (default 1)
#[command]
pub async fn cherry_pick_from_branch(
    path: String,
    branch: String,
    count: Option<u32>,
) -> Result<Vec<Commit>> {
    let repo = git2::Repository::open(Path::new(&path))?;

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

    let count = count.unwrap_or(1);
    if count == 0 {
        return Err(LeviathanError::OperationFailed(
            "Count must be at least 1".to_string(),
        ));
    }

    // Resolve the branch name to a commit
    let branch_ref = repo
        .find_branch(&branch, git2::BranchType::Local)
        .or_else(|_| repo.find_branch(&branch, git2::BranchType::Remote))
        .map_err(|_| LeviathanError::BranchNotFound(branch.clone()))?;

    let tip_oid = branch_ref
        .get()
        .target()
        .ok_or_else(|| LeviathanError::BranchNotFound(branch.clone()))?;

    // Walk backwards from the tip to collect `count` commits (oldest first)
    let mut revwalk = repo.revwalk()?;
    revwalk.push(tip_oid)?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL)?;

    let mut commit_oids: Vec<git2::Oid> = Vec::new();
    for oid_result in revwalk {
        if commit_oids.len() >= count as usize {
            break;
        }
        let oid = oid_result?;
        commit_oids.push(oid);
    }

    if commit_oids.is_empty() {
        return Err(LeviathanError::OperationFailed(
            "No commits found on the specified branch".to_string(),
        ));
    }

    // Reverse so we apply oldest first
    commit_oids.reverse();

    // Cherry-pick each commit
    let mut results = Vec::new();

    for oid in &commit_oids {
        let commit = repo.find_commit(*oid)?;

        if commit.parent_count() == 0 {
            return Err(LeviathanError::OperationFailed(format!(
                "Cannot cherry-pick root commit {}",
                oid
            )));
        }

        let mut checkout_builder = git2::build::CheckoutBuilder::new();
        checkout_builder
            .allow_conflicts(true)
            .conflict_style_merge(true);

        let mut opts = git2::CherrypickOptions::new();
        opts.checkout_builder(checkout_builder);

        if commit.parent_count() > 1 {
            opts.mainline(1);
        }

        repo.cherrypick(&commit, Some(&mut opts))?;

        let mut index = repo.index()?;
        if index.has_conflicts() {
            // Write remaining commits to sequence file for continuation
            let remaining: Vec<String> = commit_oids
                .iter()
                .skip(results.len() + 1)
                .map(|o| o.to_string())
                .collect();
            if !remaining.is_empty() {
                let seq_path = Path::new(&path).join(".git/CHERRY_PICK_SEQUENCE");
                std::fs::write(&seq_path, remaining.join("\n"))?;
            }
            return Err(LeviathanError::CherryPickConflict);
        }

        // Create the commit
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

        repo.cleanup_state()?;

        let new_commit = repo.find_commit(new_oid)?;
        results.push(Commit::from_git2(&new_commit));
    }

    // Clean up sequence file if it exists
    let seq_path = Path::new(&path).join(".git/CHERRY_PICK_SEQUENCE");
    if seq_path.exists() {
        let _ = std::fs::remove_file(&seq_path);
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_cherry_pick_single_commit() {
        let repo = TestRepo::with_initial_commit();
        let default_branch = repo.current_branch();

        // Create a feature branch with a commit
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        let feature_oid =
            repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);

        // Go back to default branch and add a commit to diverge
        repo.checkout_branch(&default_branch);
        repo.create_commit("Main branch commit", &[("main.txt", "main content")]);

        // Cherry-pick the feature commit
        let result = cherry_pick(repo.path_str(), feature_oid.to_string()).await;

        assert!(result.is_ok());
        let new_commit = result.unwrap();
        assert_eq!(new_commit.summary, "Feature commit");
        // New commit should have different OID because it has a different parent
        assert_ne!(new_commit.oid, feature_oid.to_string());

        // Verify the file exists
        let content = std::fs::read_to_string(repo.path.join("feature.txt")).unwrap();
        assert_eq!(content, "feature content");
    }

    #[tokio::test]
    async fn test_cherry_pick_invalid_commit() {
        let repo = TestRepo::with_initial_commit();
        let result = cherry_pick(
            repo.path_str(),
            "0000000000000000000000000000000000000000".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cherry_pick_invalid_oid_format() {
        let repo = TestRepo::with_initial_commit();
        let result = cherry_pick(repo.path_str(), "invalid-oid".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cherry_pick_range() {
        let repo = TestRepo::with_initial_commit();
        let default_branch = repo.current_branch();

        // Create commits on feature branch
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        let commit1 = repo.create_commit("Commit 1", &[("file1.txt", "content1")]);
        let commit2 = repo.create_commit("Commit 2", &[("file2.txt", "content2")]);

        // Go back to default branch
        repo.checkout_branch(&default_branch);

        // Cherry-pick range (oldest first)
        let result = cherry_pick_range(
            repo.path_str(),
            vec![commit1.to_string(), commit2.to_string()],
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].summary, "Commit 1");
        assert_eq!(commits[1].summary, "Commit 2");

        // Verify both files exist
        assert!(repo.path.join("file1.txt").exists());
        assert!(repo.path.join("file2.txt").exists());
    }

    #[tokio::test]
    async fn test_cherry_pick_range_empty_fails() {
        let repo = TestRepo::with_initial_commit();
        let result = cherry_pick_range(repo.path_str(), vec![]).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_abort_cherry_pick_no_operation() {
        let repo = TestRepo::with_initial_commit();
        // Aborting when no cherry-pick in progress should still succeed
        let result = abort_cherry_pick(repo.path_str()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_revert_commit() {
        let repo = TestRepo::with_initial_commit();

        // Create a commit to revert
        let commit_oid = repo.create_commit("Add file", &[("to_revert.txt", "content")]);

        // Verify file exists
        assert!(repo.path.join("to_revert.txt").exists());

        // Revert it
        let result = revert(repo.path_str(), commit_oid.to_string()).await;

        assert!(result.is_ok());
        let revert_commit = result.unwrap();
        assert!(revert_commit.summary.starts_with("Revert"));

        // File should be removed
        assert!(!repo.path.join("to_revert.txt").exists());
    }

    #[tokio::test]
    async fn test_revert_invalid_commit() {
        let repo = TestRepo::with_initial_commit();
        let result = revert(
            repo.path_str(),
            "0000000000000000000000000000000000000000".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_abort_revert_no_operation() {
        let repo = TestRepo::with_initial_commit();
        // Aborting when no revert in progress should still succeed
        let result = abort_revert(repo.path_str()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_reset_soft() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create a second commit
        repo.create_commit("Second commit", &[("file.txt", "content")]);

        // Soft reset to initial commit
        let result = reset(repo.path_str(), initial_oid.to_string(), "soft".to_string()).await;
        assert!(result.is_ok());

        // HEAD should be at initial commit
        assert_eq!(repo.head_oid(), initial_oid);

        // File should still exist (soft reset preserves working directory)
        assert!(repo.path.join("file.txt").exists());

        // Changes should be staged
        let git_repo = repo.repo();
        let index = git_repo.index().unwrap();
        assert!(index
            .get_path(std::path::Path::new("file.txt"), 0)
            .is_some());
    }

    #[tokio::test]
    async fn test_reset_mixed() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create a second commit
        repo.create_commit("Second commit", &[("file.txt", "content")]);

        // Mixed reset to initial commit
        let result = reset(
            repo.path_str(),
            initial_oid.to_string(),
            "mixed".to_string(),
        )
        .await;
        assert!(result.is_ok());

        // HEAD should be at initial commit
        assert_eq!(repo.head_oid(), initial_oid);

        // File should still exist but be unstaged
        assert!(repo.path.join("file.txt").exists());
    }

    #[tokio::test]
    async fn test_reset_hard() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create a second commit with a new file
        repo.create_commit("Second commit", &[("newfile.txt", "content")]);

        // Verify file exists
        assert!(repo.path.join("newfile.txt").exists());

        // Hard reset to initial commit
        let result = reset(repo.path_str(), initial_oid.to_string(), "hard".to_string()).await;
        assert!(result.is_ok());

        // HEAD should be at initial commit
        assert_eq!(repo.head_oid(), initial_oid);

        // File should be gone (hard reset removes working directory changes)
        assert!(!repo.path.join("newfile.txt").exists());
    }

    #[tokio::test]
    async fn test_reset_invalid_mode() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result = reset(repo.path_str(), oid.to_string(), "invalid".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_reset_invalid_target() {
        let repo = TestRepo::with_initial_commit();

        let result = reset(
            repo.path_str(),
            "nonexistent-ref".to_string(),
            "soft".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_reset_to_branch_name() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create a branch at current position
        repo.create_branch("marker");

        // Create more commits
        repo.create_commit("Commit 2", &[("file2.txt", "content2")]);
        repo.create_commit("Commit 3", &[("file3.txt", "content3")]);

        // Reset to branch name
        let result = reset(repo.path_str(), "marker".to_string(), "hard".to_string()).await;
        assert!(result.is_ok());
        assert_eq!(repo.head_oid(), initial_oid);
    }

    #[tokio::test]
    async fn test_reset_head_tilde() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create more commits
        repo.create_commit("Commit 2", &[("file2.txt", "content2")]);
        repo.create_commit("Commit 3", &[("file3.txt", "content3")]);

        // Reset to HEAD~2 (2 commits back)
        let result = reset(repo.path_str(), "HEAD~2".to_string(), "hard".to_string()).await;
        assert!(result.is_ok());
        assert_eq!(repo.head_oid(), initial_oid);
    }

    #[tokio::test]
    async fn test_continue_cherry_pick_no_operation() {
        let repo = TestRepo::with_initial_commit();
        // Continuing when no cherry-pick in progress should fail
        let result = continue_cherry_pick(repo.path_str()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_continue_revert_no_operation() {
        let repo = TestRepo::with_initial_commit();
        // Continuing when no revert in progress should fail
        let result = continue_revert(repo.path_str()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cherry_pick_preserves_author() {
        let repo = TestRepo::with_initial_commit();
        let default_branch = repo.current_branch();

        // Create a feature branch with a commit
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        let feature_oid = repo.create_commit("Feature commit", &[("feature.txt", "content")]);

        // Go back to default branch
        repo.checkout_branch(&default_branch);

        // Cherry-pick the feature commit
        let result = cherry_pick(repo.path_str(), feature_oid.to_string()).await;
        assert!(result.is_ok());
        let new_commit = result.unwrap();

        // Author should be preserved from original commit
        assert_eq!(new_commit.author.name, "Test User");
        assert_eq!(new_commit.author.email, "test@example.com");
    }

    #[tokio::test]
    async fn test_revert_message_format() {
        let repo = TestRepo::with_initial_commit();

        let commit_oid = repo.create_commit("Original message", &[("file.txt", "content")]);

        let result = revert(repo.path_str(), commit_oid.to_string()).await;
        assert!(result.is_ok());
        let revert_commit = result.unwrap();

        // Check revert message format
        assert!(revert_commit.summary.contains("Original message"));
        assert!(revert_commit.message.contains(&commit_oid.to_string()));
    }

    #[tokio::test]
    async fn test_get_rebase_state_no_rebase() {
        let repo = TestRepo::with_initial_commit();

        let result = get_rebase_state(repo.path_str()).await;
        assert!(result.is_ok());

        let state = result.unwrap();
        assert!(!state.in_progress);
        assert!(state.head_name.is_none());
        assert!(state.onto.is_none());
        assert!(state.current_commit.is_none());
        assert_eq!(state.done_count, 0);
        assert_eq!(state.total_count, 0);
        assert!(!state.has_conflicts);
    }

    #[tokio::test]
    async fn test_get_rebase_state_serialization() {
        let state = RebaseState {
            in_progress: true,
            head_name: Some("feature".to_string()),
            onto: Some("abc123".to_string()),
            current_commit: Some("def456".to_string()),
            done_count: 2,
            total_count: 5,
            has_conflicts: false,
        };

        let json = serde_json::to_string(&state);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("\"inProgress\":true"));
        assert!(json_str.contains("\"headName\":\"feature\""));
        assert!(json_str.contains("\"onto\":\"abc123\""));
        assert!(json_str.contains("\"currentCommit\":\"def456\""));
        assert!(json_str.contains("\"doneCount\":2"));
        assert!(json_str.contains("\"totalCount\":5"));
        assert!(json_str.contains("\"hasConflicts\":false"));
    }

    #[tokio::test]
    async fn test_rebase_todo_entry_serialization() {
        let entry = RebaseTodoEntry {
            action: "pick".to_string(),
            commit_oid: "abc123def456".to_string(),
            commit_short: "abc123d".to_string(),
            message: "Test commit message".to_string(),
        };

        let json = serde_json::to_string(&entry);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("\"action\":\"pick\""));
        assert!(json_str.contains("\"commitOid\":\"abc123def456\""));
        assert!(json_str.contains("\"commitShort\":\"abc123d\""));
        assert!(json_str.contains("\"message\":\"Test commit message\""));
    }

    #[tokio::test]
    async fn test_rebase_todo_serialization() {
        let todo = RebaseTodo {
            entries: vec![
                RebaseTodoEntry {
                    action: "pick".to_string(),
                    commit_oid: "abc".to_string(),
                    commit_short: "abc".to_string(),
                    message: "First".to_string(),
                },
                RebaseTodoEntry {
                    action: "squash".to_string(),
                    commit_oid: "def".to_string(),
                    commit_short: "def".to_string(),
                    message: "Second".to_string(),
                },
            ],
            done: vec![RebaseTodoEntry {
                action: "pick".to_string(),
                commit_oid: "ghi".to_string(),
                commit_short: "ghi".to_string(),
                message: "Done".to_string(),
            }],
        };

        let json = serde_json::to_string(&todo);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("\"entries\":"));
        assert!(json_str.contains("\"done\":"));
        assert!(json_str.contains("\"action\":\"squash\""));
    }

    #[tokio::test]
    async fn test_get_rebase_todo_no_rebase() {
        let repo = TestRepo::with_initial_commit();

        // Should fail when no rebase in progress
        let result = get_rebase_todo(repo.path_str()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_update_rebase_todo_no_rebase() {
        let repo = TestRepo::with_initial_commit();

        // Should fail when no rebase in progress
        let result = update_rebase_todo(repo.path_str(), vec![]).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_skip_rebase_commit_no_rebase() {
        let repo = TestRepo::with_initial_commit();

        // Should fail when no rebase in progress
        let result = skip_rebase_commit(repo.path_str()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_rebase_todo_entry_deserialization() {
        let json = r#"{"action":"pick","commitOid":"abc123","commitShort":"abc","message":"Test"}"#;
        let entry: RebaseTodoEntry = serde_json::from_str(json).unwrap();

        assert_eq!(entry.action, "pick");
        assert_eq!(entry.commit_oid, "abc123");
        assert_eq!(entry.commit_short, "abc");
        assert_eq!(entry.message, "Test");
    }

    #[tokio::test]
    async fn test_drop_commit_head() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create a commit that we will drop
        let drop_oid = repo.create_commit("Commit to drop", &[("drop.txt", "drop content")]);

        // Verify the file exists before drop
        assert!(repo.path.join("drop.txt").exists());

        // Drop the HEAD commit
        let result = drop_commit(repo.path_str(), drop_oid.to_string()).await;

        assert!(result.is_ok());
        let drop_result = result.unwrap();
        assert!(drop_result.success);
        assert!(!drop_result.has_conflicts);
        assert_eq!(drop_result.new_tip, initial_oid.to_string());
        assert_eq!(drop_result.dropped_message, "Commit to drop");

        // HEAD should be at initial commit
        assert_eq!(repo.head_oid(), initial_oid);

        // File should be gone
        assert!(!repo.path.join("drop.txt").exists());
    }

    #[tokio::test]
    async fn test_drop_commit_middle() {
        let repo = TestRepo::with_initial_commit();

        // Create three commits: keep1 -> drop -> keep2
        repo.create_commit("Keep 1", &[("keep1.txt", "keep1")]);
        let drop_oid = repo.create_commit("Drop this", &[("drop.txt", "drop content")]);
        repo.create_commit("Keep 2", &[("keep2.txt", "keep2")]);

        // Drop the middle commit
        let result = drop_commit(repo.path_str(), drop_oid.to_string()).await;

        assert!(result.is_ok());
        let drop_result = result.unwrap();
        assert!(drop_result.success);
        assert!(!drop_result.has_conflicts);
        assert_eq!(drop_result.dropped_message, "Drop this");

        // Verify the kept files exist
        assert!(repo.path.join("keep1.txt").exists());
        assert!(repo.path.join("keep2.txt").exists());

        // Verify the dropped file no longer exists
        assert!(!repo.path.join("drop.txt").exists());

        // Verify the commit history no longer contains the dropped commit
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), "Keep 2");
        let parent = head.parent(0).unwrap();
        assert_eq!(parent.summary().unwrap(), "Keep 1");
    }

    #[tokio::test]
    async fn test_drop_commit_invalid_oid() {
        let repo = TestRepo::with_initial_commit();
        let result = drop_commit(repo.path_str(), "invalid-oid".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_drop_commit_nonexistent() {
        let repo = TestRepo::with_initial_commit();
        let result = drop_commit(
            repo.path_str(),
            "0000000000000000000000000000000000000000".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_drop_commit_root_fails() {
        let repo = TestRepo::with_initial_commit();
        let root_oid = repo.head_oid();

        // Dropping the root commit should fail
        let result = drop_commit(repo.path_str(), root_oid.to_string()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Cannot drop root commit"));
    }

    #[tokio::test]
    async fn test_drop_commit_not_ancestor_of_head() {
        let repo = TestRepo::with_initial_commit();
        let default_branch = repo.current_branch();

        // Create a commit on a feature branch
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        let feature_oid = repo.create_commit("Feature commit", &[("feature.txt", "content")]);

        // Go back to default branch and create a different commit
        repo.checkout_branch(&default_branch);
        repo.create_commit("Main commit", &[("main.txt", "content")]);

        // Trying to drop the feature commit from default branch should fail
        let result = drop_commit(repo.path_str(), feature_oid.to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_drop_commit_result_serialization() {
        let result = DropCommitResult {
            success: true,
            new_tip: "abc123def456".to_string(),
            has_conflicts: false,
            dropped_message: "Dropped commit message".to_string(),
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"newTip\":\"abc123def456\""));
        assert!(json.contains("\"hasConflicts\":false"));
        assert!(json.contains("\"droppedMessage\":\"Dropped commit message\""));
    }

    #[tokio::test]
    async fn test_drop_commit_preserves_subsequent_commits() {
        let repo = TestRepo::with_initial_commit();

        // Create a chain: initial -> A -> B (drop) -> C -> D
        repo.create_commit("Commit A", &[("a.txt", "a")]);
        let drop_oid = repo.create_commit("Commit B", &[("b.txt", "b")]);
        repo.create_commit("Commit C", &[("c.txt", "c")]);
        repo.create_commit("Commit D", &[("d.txt", "d")]);

        let result = drop_commit(repo.path_str(), drop_oid.to_string()).await;

        assert!(result.is_ok());
        let drop_result = result.unwrap();
        assert!(drop_result.success);

        // Files from non-dropped commits should exist
        assert!(repo.path.join("a.txt").exists());
        assert!(repo.path.join("c.txt").exists());
        assert!(repo.path.join("d.txt").exists());

        // File from dropped commit should not exist
        assert!(!repo.path.join("b.txt").exists());

        // Verify the commit chain: D -> C -> A -> initial
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), "Commit D");
        let c = head.parent(0).unwrap();
        assert_eq!(c.summary().unwrap(), "Commit C");
        let a = c.parent(0).unwrap();
        assert_eq!(a.summary().unwrap(), "Commit A");
    }

    #[tokio::test]
    async fn test_reorder_commits_reverse_two() {
        let repo = TestRepo::with_initial_commit();
        let base_oid = repo.head_oid();

        // Create two commits: A -> B
        let commit_a = repo.create_commit("Commit A", &[("a.txt", "a content")]);
        let commit_b = repo.create_commit("Commit B", &[("b.txt", "b content")]);

        // Reorder to: B -> A (reversed)
        let result = reorder_commits(
            repo.path_str(),
            base_oid.to_string(),
            vec![commit_b.to_string(), commit_a.to_string()],
        )
        .await;

        assert!(result.is_ok());
        let reorder_result = result.unwrap();
        assert!(reorder_result.success);
        assert_eq!(reorder_result.reordered_count, 2);
        assert!(!reorder_result.has_conflicts);

        // Verify both files still exist
        assert!(repo.path.join("a.txt").exists());
        assert!(repo.path.join("b.txt").exists());

        // Verify the commit order is now reversed: A on top, B below
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), "Commit A");
        let parent = head.parent(0).unwrap();
        assert_eq!(parent.summary().unwrap(), "Commit B");
    }

    #[tokio::test]
    async fn test_reorder_commits_three_commits() {
        let repo = TestRepo::with_initial_commit();
        let base_oid = repo.head_oid();

        // Create three commits: A -> B -> C
        let commit_a = repo.create_commit("Commit A", &[("a.txt", "a")]);
        let commit_b = repo.create_commit("Commit B", &[("b.txt", "b")]);
        let commit_c = repo.create_commit("Commit C", &[("c.txt", "c")]);

        // Reorder to: C -> A -> B
        let result = reorder_commits(
            repo.path_str(),
            base_oid.to_string(),
            vec![
                commit_c.to_string(),
                commit_a.to_string(),
                commit_b.to_string(),
            ],
        )
        .await;

        assert!(result.is_ok());
        let reorder_result = result.unwrap();
        assert!(reorder_result.success);
        assert_eq!(reorder_result.reordered_count, 3);

        // Verify all files exist
        assert!(repo.path.join("a.txt").exists());
        assert!(repo.path.join("b.txt").exists());
        assert!(repo.path.join("c.txt").exists());

        // Verify the commit order: B -> A -> C -> base
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), "Commit B");
        let second = head.parent(0).unwrap();
        assert_eq!(second.summary().unwrap(), "Commit A");
        let third = second.parent(0).unwrap();
        assert_eq!(third.summary().unwrap(), "Commit C");
    }

    #[tokio::test]
    async fn test_reorder_commits_empty_list_fails() {
        let repo = TestRepo::with_initial_commit();
        let base_oid = repo.head_oid();

        let result = reorder_commits(repo.path_str(), base_oid.to_string(), vec![]).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("No commits specified"));
    }

    #[tokio::test]
    async fn test_reorder_commits_invalid_base_oid() {
        let repo = TestRepo::with_initial_commit();
        let commit_a = repo.create_commit("Commit A", &[("a.txt", "a")]);

        let result = reorder_commits(
            repo.path_str(),
            "invalid-oid".to_string(),
            vec![commit_a.to_string()],
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_reorder_commits_invalid_commit_oid() {
        let repo = TestRepo::with_initial_commit();
        let base_oid = repo.head_oid();

        let result = reorder_commits(
            repo.path_str(),
            base_oid.to_string(),
            vec!["invalid-oid".to_string()],
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_reorder_commits_mismatched_commits_fails() {
        let repo = TestRepo::with_initial_commit();
        let base_oid = repo.head_oid();

        // Create two commits
        let commit_a = repo.create_commit("Commit A", &[("a.txt", "a")]);
        let _commit_b = repo.create_commit("Commit B", &[("b.txt", "b")]);

        // Try to reorder with only one of the two commits - should fail
        let result = reorder_commits(
            repo.path_str(),
            base_oid.to_string(),
            vec![commit_a.to_string()],
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("exactly the same commits"));
    }

    #[tokio::test]
    async fn test_reorder_commits_preserves_messages() {
        let repo = TestRepo::with_initial_commit();
        let base_oid = repo.head_oid();

        let commit_a = repo.create_commit("Message for A", &[("a.txt", "a")]);
        let commit_b = repo.create_commit("Message for B", &[("b.txt", "b")]);

        // Reverse the order
        let result = reorder_commits(
            repo.path_str(),
            base_oid.to_string(),
            vec![commit_b.to_string(), commit_a.to_string()],
        )
        .await;

        assert!(result.is_ok());

        // Verify commit messages are preserved
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), "Message for A");
        let parent = head.parent(0).unwrap();
        assert_eq!(parent.summary().unwrap(), "Message for B");
    }

    #[tokio::test]
    async fn test_reorder_commits_same_order() {
        let repo = TestRepo::with_initial_commit();
        let base_oid = repo.head_oid();

        // Create commits
        let commit_a = repo.create_commit("Commit A", &[("a.txt", "a")]);
        let commit_b = repo.create_commit("Commit B", &[("b.txt", "b")]);

        // Reorder in the same order (no-op reorder)
        let result = reorder_commits(
            repo.path_str(),
            base_oid.to_string(),
            vec![commit_a.to_string(), commit_b.to_string()],
        )
        .await;

        assert!(result.is_ok());
        let reorder_result = result.unwrap();
        assert!(reorder_result.success);
        assert_eq!(reorder_result.reordered_count, 2);

        // Verify commit order is still A -> B
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), "Commit B");
        let parent = head.parent(0).unwrap();
        assert_eq!(parent.summary().unwrap(), "Commit A");
    }

    #[tokio::test]
    async fn test_reorder_result_serialization() {
        let result = ReorderResult {
            success: true,
            new_tip: "abc123def456".to_string(),
            reordered_count: 3,
            has_conflicts: false,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"newTip\":\"abc123def456\""));
        assert!(json.contains("\"reorderedCount\":3"));
        assert!(json.contains("\"hasConflicts\":false"));
    }

    #[tokio::test]
    async fn test_cherry_pick_from_branch_single_commit() {
        let repo = TestRepo::with_initial_commit();
        let default_branch = repo.current_branch();

        // Create a feature branch with a commit
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);

        // Go back to default branch
        repo.checkout_branch(&default_branch);

        // Cherry-pick from the feature branch (default count = 1)
        let result = cherry_pick_from_branch(repo.path_str(), "feature".to_string(), None).await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].summary, "Feature commit");

        // Verify the file exists
        let content = std::fs::read_to_string(repo.path.join("feature.txt")).unwrap();
        assert_eq!(content, "feature content");
    }

    #[tokio::test]
    async fn test_cherry_pick_from_branch_multiple_commits() {
        let repo = TestRepo::with_initial_commit();
        let default_branch = repo.current_branch();

        // Create a feature branch with multiple commits
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit 1", &[("file1.txt", "content1")]);
        repo.create_commit("Feature commit 2", &[("file2.txt", "content2")]);
        repo.create_commit("Feature commit 3", &[("file3.txt", "content3")]);

        // Go back to default branch
        repo.checkout_branch(&default_branch);

        // Cherry-pick 2 commits from the tip
        let result = cherry_pick_from_branch(repo.path_str(), "feature".to_string(), Some(2)).await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
        // Oldest first: commit 2, then commit 3
        assert_eq!(commits[0].summary, "Feature commit 2");
        assert_eq!(commits[1].summary, "Feature commit 3");

        // Verify both files exist
        assert!(repo.path.join("file2.txt").exists());
        assert!(repo.path.join("file3.txt").exists());
        // file1.txt should NOT exist since we only picked the last 2
        assert!(!repo.path.join("file1.txt").exists());
    }

    #[tokio::test]
    async fn test_cherry_pick_from_branch_not_found() {
        let repo = TestRepo::with_initial_commit();

        let result =
            cherry_pick_from_branch(repo.path_str(), "nonexistent".to_string(), None).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cherry_pick_from_branch_zero_count_fails() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");

        let result = cherry_pick_from_branch(repo.path_str(), "feature".to_string(), Some(0)).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Count must be at least 1"));
    }

    #[tokio::test]
    async fn test_cherry_pick_from_branch_count_exceeds_history() {
        let repo = TestRepo::with_initial_commit();
        let default_branch = repo.current_branch();

        // Create feature branch with 1 commit (plus the initial commit)
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "content")]);

        repo.checkout_branch(&default_branch);

        // Request 100 commits but branch only has 2 total (initial + feature)
        let result =
            cherry_pick_from_branch(repo.path_str(), "feature".to_string(), Some(100)).await;

        // Should succeed, cherry-picking all available commits
        // The initial commit is a root commit so it will fail on root commit check
        // Actually, it will try to cherry-pick root commit which should fail
        assert!(result.is_err());
    }
}
