//! Merge and rebase command handlers

use std::path::Path;
use tauri::command;

use super::path_utils::validate_path_within_repo;
use crate::error::{LeviathanError, Result};
use crate::models::{
    ConflictDetails, ConflictEntry, ConflictFile, ConflictHunk, ConflictMarker, ConflictMarkerFile,
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

    // Like git's pre-merge checks: refuse to start a merge while another
    // operation is in progress, with an actionable message (instead of the
    // misleading libgit2 "uncommitted change would be overwritten" error).
    match repo.state() {
        git2::RepositoryState::Clean => {}
        git2::RepositoryState::Merge => {
            return Err(LeviathanError::OperationFailed(
                "You have not concluded your merge (MERGE_HEAD exists). \
                 Resolve the conflicts and commit, or abort the merge, before merging again."
                    .to_string(),
            ));
        }
        state => {
            return Err(LeviathanError::OperationFailed(format!(
                "Cannot merge: another operation is in progress ({:?}). \
                 Complete or abort it first.",
                state
            )));
        }
    }

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
        // Fast-forward merge. Check out the target tree SAFELY first — git
        // aborts a merge that would overwrite local changes or untracked
        // files — and only move the branch ref once the checkout succeeded.
        let target_oid = annotated_commit.id();
        let target_commit = repo.find_commit(target_oid)?;
        let head = repo.head()?;
        let refname = head
            .name()
            .ok()
            .ok_or_else(|| LeviathanError::InvalidReference)?;

        // Collect the conflicting paths so the error can name them, like
        // git's "Your local changes to the following files ..." message.
        let conflict_paths = std::rc::Rc::new(std::cell::RefCell::new(Vec::<String>::new()));
        let notify_paths = std::rc::Rc::clone(&conflict_paths);
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout
            .notify_on(git2::CheckoutNotificationType::CONFLICT)
            .notify(move |_why, path, _baseline, _target, _workdir| {
                if let Some(p) = path {
                    notify_paths.borrow_mut().push(p.display().to_string());
                }
                true
            });

        match repo.checkout_tree(target_commit.as_object(), Some(&mut checkout)) {
            Ok(()) => {}
            Err(e) if e.code() == git2::ErrorCode::Conflict => {
                let files = conflict_paths.borrow().join(", ");
                return Err(LeviathanError::OperationFailed(if files.is_empty() {
                    "Your local changes would be overwritten by merge. \
                     Commit or stash them before you merge."
                        .to_string()
                } else {
                    format!(
                        "Your local changes to the following files would be \
                         overwritten by merge: {}. Commit or stash them before you merge.",
                        files
                    )
                }));
            }
            Err(e) => return Err(e.into()),
        }

        let mut reference = repo.find_reference(refname)?;
        reference.set_target(target_oid, "Fast-forward merge")?;

        // git runs post-merge after a fast-forward merge too (flag 0 = not a
        // squash merge). Non-blocking.
        crate::commands::hooks::run_hook_noblock(&repo, "post-merge", &["0"]);
    } else {
        // Normal or squash merge. Once repo.merge() succeeds the index/working
        // tree is in MERGING state; any subsequent failure must reset that
        // state so the user isn't stuck with a half-merged repo.
        repo.merge(&[&annotated_commit], None, None)?;

        // A conflict is the expected "user must resolve" path; the UI drives a
        // conflict-resolution flow that needs MERGE_HEAD intact (and
        // `abort_merge` to undo), so return before any cleanup.
        if repo.index()?.has_conflicts() {
            return Err(LeviathanError::MergeConflict);
        }

        // git runs pre-merge-commit before creating the automatic merge commit,
        // but a non-zero exit does NOT abort the merge — git leaves
        // MERGE_HEAD/MERGE_MSG in place ("Not committing merge; use 'git commit'
        // to complete the merge"). So on a veto, return WITHOUT cleanup_state,
        // keeping the merge resumable via commit_merge and abortable via
        // abort_merge. (A squash merge records no merge commit, so no hook.)
        if !squash.unwrap_or(false) {
            crate::commands::hooks::run_hook_blocking(&repo, "pre-merge-commit", &[], None)?;
        }

        // Default to the MERGE_MSG libgit2 wrote during repo.merge() — git's
        // canonical auto-message ("Merge branch 'feature'") — with '#' comment
        // lines stripped, like `git commit` does.
        let commit_message = message.unwrap_or_else(|| default_merge_message(&repo, &source_ref));

        // git runs commit-msg for an automatic merge commit (after
        // pre-merge-commit); the hook may rewrite the message or veto it. Like
        // pre-merge-commit, a veto leaves the merge resumable, so run it before
        // the cleanup-guarded commit closure. (A squash merge records no merge
        // commit, so no hook — matching `git merge --squash`.)
        let commit_message = if squash.unwrap_or(false) {
            commit_message
        } else {
            crate::commands::hooks::run_commit_msg_hook(&repo, &commit_message)?
        };

        let result = (|| -> Result<()> {
            let signature = repo.signature()?;
            let head = repo.head()?.peel_to_commit()?;
            let tree_oid = repo.index()?.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;

            if squash.unwrap_or(false) {
                repo.commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    &commit_message,
                    &tree,
                    &[&head],
                )?;
            } else {
                let source_commit = repo.find_commit(annotated_commit.id())?;
                repo.commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    &commit_message,
                    &tree,
                    &[&head, &source_commit],
                )?;

                // post-merge after the merge commit (flag 0 = not a squash).
                crate::commands::hooks::run_hook_noblock(&repo, "post-merge", &["0"]);
            }
            Ok(())
        })();

        // A genuine commit-phase failure (missing signature, disk error) still
        // resets the half-merged state so the user isn't stuck.
        if let Err(e) = result {
            let _ = repo.cleanup_state();
            return Err(e);
        }

        repo.cleanup_state()?;
    }

    Ok(())
}

/// Default merge-commit message: the MERGE_MSG that libgit2 wrote when the
/// merge started (git's canonical wording, e.g. "Merge branch 'feature'"),
/// with '#' comment lines stripped the way `git commit` cleans messages.
/// Falls back to git's canonical subject if MERGE_MSG is missing or empty.
fn default_merge_message(repo: &git2::Repository, source_ref: &str) -> String {
    let base = std::fs::read_to_string(repo.path().join("MERGE_MSG"))
        .ok()
        .map(|m| {
            m.lines()
                .filter(|line| !line.starts_with('#'))
                .collect::<Vec<_>>()
                .join("\n")
                .trim_end()
                .to_string()
        })
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| format!("Merge branch '{}'", source_ref));

    // git appends " into <branch>" to the merge subject unless the current
    // branch is "master" or "main" (see fmt-merge-msg / builtin/merge.c).
    // libgit2's MERGE_MSG never adds this suffix, so apply git's rule here so
    // teams whose integration branch is develop/trunk/release get the canonical
    // subject ("Merge branch 'feature' into develop").
    let current: Option<String> = match repo.head() {
        Ok(h) => h.shorthand().map(|s| s.to_string()).ok(),
        Err(_) => None,
    };
    match current.as_deref() {
        Some(branch) if branch != "master" && branch != "main" && branch != "HEAD" => {
            let mut lines: Vec<String> = base.lines().map(|s| s.to_string()).collect();
            if let Some(first) = lines.first_mut() {
                if !first.contains(" into ") {
                    *first = format!("{first} into {branch}");
                }
            }
            lines.join("\n")
        }
        _ => base,
    }
}

/// Abort an in-progress merge.
///
/// Mirrors `git merge --abort` (implemented as `git reset --merge`): only the
/// paths the merge touched — where the index differs from HEAD, including
/// conflicted and newly-added entries — are restored to HEAD. Uncommitted
/// changes to files the merge did not touch are preserved, exactly like git.
#[command]
pub async fn abort_merge(path: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // git: "fatal: There is no merge to abort (MERGE_HEAD missing)."
    if repo.state() != git2::RepositoryState::Merge {
        return Err(LeviathanError::OperationFailed(
            "There is no merge to abort (MERGE_HEAD missing).".to_string(),
        ));
    }

    // Paths written by the merge: everything where the index (auto-merged,
    // conflicted, or newly added by the merge) differs from HEAD.
    let head_tree = repo.head()?.peel_to_tree()?;
    let index = repo.index()?;
    let diff = repo.diff_tree_to_index(Some(&head_tree), Some(&index), None)?;

    let mut touched: Vec<std::path::PathBuf> = Vec::new();
    for delta in diff.deltas() {
        for file in [delta.old_file(), delta.new_file()] {
            if let Some(p) = file.path() {
                if !touched.iter().any(|t| t == p) {
                    touched.push(p.to_path_buf());
                }
            }
        }
    }

    // Restore ONLY those paths to HEAD (force is scoped to them); everything
    // else in the working tree is left alone.
    if !touched.is_empty() {
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.force();
        for p in &touched {
            checkout.path(p);
        }
        repo.checkout_head(Some(&mut checkout))?;
    }

    repo.cleanup_state()?;
    Ok(())
}

/// Complete an in-progress merge after all conflicts have been resolved.
///
/// Normally creates the merge commit with HEAD + MERGE_HEAD as parents and
/// clears the MERGING state. When `squash` is true, creates a SINGLE-parent
/// commit instead (HEAD only) so a conflicted gitflow *squash* finish completes
/// as the squash the user asked for, not a merge commit.
///
/// Signed commits are routed through the git CLI so the user's GPG/SSH signing
/// configuration is honoured (git2 cannot sign).
#[command]
pub async fn commit_merge(
    path: String,
    message: Option<String>,
    squash: Option<bool>,
) -> Result<()> {
    let is_squash = squash.unwrap_or(false);
    let mut repo = git2::Repository::open(Path::new(&path))?;

    if repo.state() != git2::RepositoryState::Merge {
        return Err(LeviathanError::OperationFailed(
            "No merge in progress".to_string(),
        ));
    }

    // Collect merge heads first: mergehead_foreach needs a unique borrow
    let mut merge_oids: Vec<git2::Oid> = Vec::new();
    repo.mergehead_foreach(|oid| {
        merge_oids.push(*oid);
        true
    })?;
    if merge_oids.is_empty() {
        return Err(LeviathanError::OperationFailed(
            "MERGE_HEAD not found".to_string(),
        ));
    }
    let repo = repo;

    if repo.index()?.has_conflicts() {
        return Err(LeviathanError::MergeConflict);
    }

    // Default to git's own MERGE_MSG (what `git commit` would use mid-merge).
    // MERGE_MSG contains libgit2's '# Conflicts:' / '#\t<path>' comment lines;
    // `git commit` strips '#'-prefixed lines during message cleanup, but git2's
    // commit does not — so we must strip them ourselves, or they get baked into
    // permanent history (in both the git2 and signed -m paths).
    let commit_message = message
        .filter(|m| !m.trim().is_empty())
        .or_else(|| {
            std::fs::read_to_string(repo.path().join("MERGE_MSG"))
                .ok()
                .map(|m| {
                    m.lines()
                        .filter(|line| !line.starts_with('#'))
                        .collect::<Vec<_>>()
                        .join("\n")
                        .trim_end()
                        .to_string()
                })
                .filter(|m| !m.trim().is_empty())
        })
        .unwrap_or_else(|| "Merge".to_string());

    // Route signed commits through the git CLI (git2 cannot sign) — which runs
    // hooks natively.
    if crate::commands::commit::should_sign_commit(&path, None)? {
        return commit_merge_signed(&path, &commit_message, is_squash).await;
    }

    // Concluding a (conflicted) merge via `git commit` runs pre-commit and
    // commit-msg; the git2 path otherwise bypasses them. pre-commit can veto;
    // commit-msg can veto or rewrite the message.
    crate::commands::hooks::run_hook_blocking(&repo, "pre-commit", &[], None)?;
    let commit_message = crate::commands::hooks::run_commit_msg_hook(&repo, &commit_message)?;

    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let signature = repo.signature()?;
    let head_commit = repo.head()?.peel_to_commit()?;

    if is_squash {
        // Squash: a SINGLE parent (HEAD only). The resolved index already holds
        // the full merged tree, so this commits it as an ordinary commit.
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &commit_message,
            &tree,
            &[&head_commit],
        )?;
    } else {
        let mut parents: Vec<git2::Commit> = vec![head_commit];
        for oid in merge_oids {
            parents.push(repo.find_commit(oid)?);
        }
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &commit_message,
            &tree,
            &parent_refs,
        )?;
    }
    repo.cleanup_state()?;

    // post-commit runs after the merge commit is recorded; never blocks.
    crate::commands::hooks::run_hook_noblock(&repo, "post-commit", &[]);

    Ok(())
}

/// Complete an in-progress merge with a SIGNED commit via the git CLI.
///
/// For a normal merge, `git commit` mid-merge creates the 2-parent merge commit
/// and clears the merge state itself. For a squash, that would wrongly produce
/// a 2-parent merge commit, so we clear the merge metadata first (which leaves
/// the resolved index staged) and then commit the staged tree as an ordinary
/// single-parent signed commit.
async fn commit_merge_signed(path: &str, message: &str, is_squash: bool) -> Result<()> {
    // For a squash we clear the merge metadata BEFORE committing (so `git
    // commit` produces a single-parent commit, not a 2-parent merge). But if the
    // CLI commit then fails (missing GPG key, failing pre-commit hook), that
    // cleanup would strand the user: a retry reports "No merge in progress" and
    // `abort_merge` has nothing to abort. Snapshot MERGE_HEAD/MERGE_MSG first and
    // restore them on failure so the merge stays resumable.
    let saved_state = if is_squash {
        let repo = git2::Repository::open(Path::new(path))?;
        let git_dir = repo.path().to_path_buf();
        let merge_head_path = git_dir.join("MERGE_HEAD");
        let merge_msg_path = git_dir.join("MERGE_MSG");
        let merge_head = std::fs::read_to_string(&merge_head_path)?;
        let merge_msg = std::fs::read_to_string(&merge_msg_path).ok();
        repo.cleanup_state()?;
        Some((merge_head_path, merge_head, merge_msg_path, merge_msg))
    } else {
        None
    };

    let output = create_command("git")
        .current_dir(path)
        .args(["commit", "-S", "-m", message])
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run git commit: {}", e)))?;

    if !output.status.success() {
        // Restore the merge metadata we cleared so the user can retry or abort.
        // (The resolved index is untouched by cleanup_state.)
        if let Some((merge_head_path, merge_head, merge_msg_path, merge_msg)) = saved_state {
            let _ = std::fs::write(&merge_head_path, merge_head);
            if let Some(msg) = merge_msg {
                let _ = std::fs::write(&merge_msg_path, msg);
            }
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(LeviathanError::OperationFailed(format!(
            "Git commit failed: {}",
            stderr
        )));
    }

    Ok(())
}

/// Rebase current branch onto another
#[command]
pub async fn rebase(path: String, onto: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Like canonical `git rebase`, refuse up front if another operation is in
    // progress or the working tree is dirty, instead of starting the rebase
    // and failing partway through with a misleading libgit2 error.
    if repo.state() != git2::RepositoryState::Clean {
        return Err(LeviathanError::OperationFailed(
            "Another operation is in progress".to_string(),
        ));
    }
    // Match canonical `git rebase`: staged changes and modifications to tracked
    // files abort the rebase, but untracked (WT_NEW) and ignored files do not.
    let blocking = git2::Status::INDEX_NEW
        | git2::Status::INDEX_MODIFIED
        | git2::Status::INDEX_DELETED
        | git2::Status::INDEX_RENAMED
        | git2::Status::INDEX_TYPECHANGE
        | git2::Status::WT_MODIFIED
        | git2::Status::WT_DELETED
        | git2::Status::WT_TYPECHANGE
        | git2::Status::WT_RENAMED
        | git2::Status::CONFLICTED;
    let has_changes = repo
        .statuses(None)?
        .iter()
        .any(|s| s.status().intersects(blocking));
    if has_changes {
        return Err(LeviathanError::OperationFailed(
            "Working directory has uncommitted changes. Commit or stash them first.".to_string(),
        ));
    }

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

    // git2::Rebase does NOT call abort() on Drop. Without an explicit abort,
    // failures other than the expected RebaseConflict (e.g. missing
    // user.name signature, mid-loop git2 errors) leave the working tree
    // permanently stuck in REBASE state. We do NOT abort on RebaseConflict
    // because the UI surfaces a "resolve conflicts" flow that needs the
    // rebase state intact; the user can call abort_rebase explicitly.
    let result = (|| -> Result<()> {
        while let Some(op) = rebase.next() {
            let _op = op?;

            if repo.index()?.has_conflicts() {
                return Err(LeviathanError::RebaseConflict);
            }

            rebase.commit(None, &signature, None)?;
        }

        rebase.finish(Some(&signature))?;
        Ok(())
    })();

    match result {
        Err(LeviathanError::RebaseConflict) => Err(LeviathanError::RebaseConflict),
        Err(e) => {
            let _ = rebase.abort();
            Err(e)
        }
        Ok(()) => Ok(()),
    }
}

/// Preview a rebase by running it in a temporary worktree (ghost rebase)
#[command]
pub async fn preview_rebase(
    path: String,
    onto: String,
) -> Result<crate::services::ai::RebasePreview> {
    use crate::services::ai::{PredictedConflict, RebasePreview};

    // Reject ref values that could be parsed as a flag, e.g.
    // `--exec=/tmp/payload` would run an arbitrary command via `git rebase`.
    if onto.starts_with('-') {
        return Err(LeviathanError::OperationFailed(
            "Rebase target must not start with '-'".into(),
        ));
    }

    // Create a temp directory for the ghost worktree
    let temp_dir = tempfile::tempdir().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to create temp dir: {}", e))
    })?;
    let temp_path = temp_dir.path().to_string_lossy().to_string();

    // Add a detached worktree at HEAD
    let add_output = std::process::Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("worktree")
        .arg("add")
        .arg("--detach")
        .arg(&temp_path)
        .arg("HEAD")
        .output()
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to create worktree: {}", e))
        })?;

    if !add_output.status.success() {
        return Err(LeviathanError::OperationFailed(format!(
            "Failed to create worktree: {}",
            String::from_utf8_lossy(&add_output.stderr)
        )));
    }

    // Run rebase in the temp worktree. `--` prevents the user-supplied ref
    // from being parsed as a flag.
    let rebase_output = std::process::Command::new("git")
        .arg("-C")
        .arg(&temp_path)
        .arg("rebase")
        .arg("--")
        .arg(&onto)
        .output()
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to run ghost rebase: {}", e))
        })?;

    let mut conflicts = Vec::new();

    if !rebase_output.status.success() {
        let stderr = String::from_utf8_lossy(&rebase_output.stderr);

        // Parse conflict file paths from stderr
        for line in stderr.lines() {
            if line.contains("CONFLICT") {
                // Extract file path from conflict message
                if let Some(path_start) = line.rfind("in ") {
                    let file_path = line[path_start + 3..].trim().to_string();
                    conflicts.push(PredictedConflict {
                        file_path,
                        commit_summary: String::new(),
                    });
                } else if let Some(path_start) = line.rfind("Merge conflict in ") {
                    let file_path = line[path_start + 18..].trim().to_string();
                    conflicts.push(PredictedConflict {
                        file_path,
                        commit_summary: String::new(),
                    });
                }
            }
        }

        // Abort the failed rebase in the worktree
        let _ = std::process::Command::new("git")
            .arg("-C")
            .arg(&temp_path)
            .arg("rebase")
            .arg("--abort")
            .output();
    }

    // Count total commits that would be rebased
    let log_output = std::process::Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("log")
        .arg("--oneline")
        .arg(format!("{}..HEAD", onto))
        .output()
        .ok();

    let total_commits = log_output
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().count())
        .unwrap_or(0);

    // Clean up: remove the temp worktree
    let _ = std::process::Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(&temp_path)
        .output();

    // The temp dir will be cleaned up when temp_dir is dropped

    let conflicting_commits = conflicts.len();
    let clean_commits = total_commits.saturating_sub(conflicting_commits);

    Ok(RebasePreview {
        total_commits,
        clean_commits,
        conflicting_commits,
        conflicts,
    })
}

/// Continue a paused rebase
#[command]
pub async fn continue_rebase(path: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Interactive rebases are driven by the git CLI (`git rebase -i`, see
    // execute_interactive_rebase) and leave a git-rebase-todo file. Those
    // must be continued by the CLI too — its todo lists can contain
    // exec/squash/fixup operations that libgit2's Rebase loop cannot replay.
    // Rebases started through libgit2 (the `rebase` command) have no todo
    // file and are continued through libgit2 below.
    if repo.path().join("rebase-merge/git-rebase-todo").exists() {
        return continue_rebase_cli(&path);
    }

    let signature = repo.signature()?;
    let mut rebase = repo.open_rebase(None)?;

    // Commit the current (just-resolved) operation; a patch that became
    // empty after resolution is skipped like `git rebase --skip` would.
    commit_or_skip_empty(&mut rebase, &signature)?;

    // Continue with remaining operations
    while let Some(op) = rebase.next() {
        let _op = op?;

        if repo.index()?.has_conflicts() {
            return Err(LeviathanError::RebaseConflict);
        }

        commit_or_skip_empty(&mut rebase, &signature)?;
    }

    rebase.finish(Some(&signature))?;

    Ok(())
}

/// Commit the current rebase operation, treating an empty patch
/// (GIT_EAPPLIED) as a skip rather than a failure.
fn commit_or_skip_empty(rebase: &mut git2::Rebase, signature: &git2::Signature) -> Result<()> {
    match rebase.commit(None, signature, None) {
        Ok(_) => Ok(()),
        Err(e) if e.code() == git2::ErrorCode::Applied => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Continue a CLI-initiated (interactive) rebase via `git rebase --continue`,
/// advancing past patches that became empty with `git rebase --skip`.
fn continue_rebase_cli(path: &str) -> Result<()> {
    let mut args: Vec<&str> = vec!["rebase", "--continue"];
    loop {
        let output = create_command("git")
            .current_dir(path)
            // Accept recorded commit messages non-interactively (reword etc.)
            .env("GIT_EDITOR", "true")
            // Force the C locale so our stdout/stderr matching below ("No
            // changes", "nothing to commit", "CONFLICT") works regardless of the
            // user's system language — a localized git would break the
            // empty-patch skip and misclassify conflicts.
            .env("LC_ALL", "C")
            .args(&args)
            .output()
            .map_err(|e| LeviathanError::OperationFailed(e.to_string()))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{stdout}\n{stderr}");

        // Patch became empty after resolution: advance past it the way git
        // itself suggests, then keep going.
        if combined.contains("git rebase --skip")
            && (combined.contains("No changes") || combined.contains("nothing to commit"))
        {
            args = vec!["rebase", "--skip"];
            continue;
        }

        if combined.contains("CONFLICT") || combined.contains("conflict") {
            return Err(LeviathanError::RebaseConflict);
        }
        return Err(LeviathanError::OperationFailed(
            if stderr.trim().is_empty() {
                stdout.to_string()
            } else {
                stderr.to_string()
            },
        ));
    }
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
            summary: commit.summary().ok().flatten().unwrap_or("").to_string(),
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

        // Submodule (gitlink) conflicts have COMMIT OIDs, not blobs — every
        // blob-based affordance (text editor, side panes, verbatim buttons)
        // would dead-end on them. Flag them so the frontend routes to a
        // commit-pointer chooser instead.
        let is_submodule = [&conflict.our, &conflict.their, &conflict.ancestor]
            .iter()
            .filter_map(|e| e.as_ref())
            .any(|e| e.mode == 0o160000);

        // Binary conflicts must not be routed through the text merge editor.
        // SYMLINK conflicts must not either: their blobs are text (the link
        // target path), but resolving them means recreating a LINK, not
        // writing text — the whole-blob chooser (take-side, which is
        // symlink-aware) is the only correct affordance.
        let is_binary = !is_submodule
            && [&conflict.our, &conflict.their, &conflict.ancestor]
                .iter()
                .filter_map(|e| e.as_ref())
                .any(|e| {
                    e.mode == 0o120000
                        || repo.find_blob(e.id).map(|b| b.is_binary()).unwrap_or(false)
                });

        // How this file's conflict hunks were actually written. The
        // conflict-marker-size attribute and merge.conflictStyle config only
        // describe what git's CLI writes — libgit2's own merge/checkout
        // ignores both and always emits 7-char merge-style markers — so the
        // emission must be verified against the working file, not assumed.
        // Binary conflicts have no marker hunks to detect (and libgit2's
        // binary merge result has no content to replay against) — report
        // the defaults; the text merge editor never parses them anyway.
        // Submodule conflicts have no text either (the workdir path is a
        // directory).
        let (marker_size, conflict_style, conflict_hunks) = if is_binary || is_submodule {
            (
                crate::models::conflict::default_marker_size(),
                crate::models::conflict::default_conflict_style(),
                Vec::new(),
            )
        } else {
            detect_conflict_emission(
                &repo,
                Path::new(&path),
                &file_path,
                conflict.ancestor.as_ref(),
                conflict.our.as_ref(),
                conflict.their.as_ref(),
            )
        };

        conflicts.push(ConflictFile {
            path: file_path,
            ancestor: get_entry(conflict.ancestor),
            ours: get_entry(conflict.our),
            theirs: get_entry(conflict.their),
            is_binary,
            is_submodule,
            marker_size,
            conflict_style,
            conflict_hunks,
        });
    }

    tracing::debug!("get_conflicts: returning {} conflicts", conflicts.len());
    Ok(conflicts)
}

/// True when `line` is a marker run of `ch`: EXACTLY `size` characters
/// followed by a space or end-of-line.
fn is_marker_run(line: &str, ch: char, size: usize) -> bool {
    let n = line.chars().take_while(|&c| c == ch).count();
    n == size && matches!(line.chars().nth(n), None | Some(' '))
}

/// The `conflict-marker-size` gitattribute for a path, defaulting to 7.
/// Parsed as u16: real sizes are tiny, and the cap also bounds the
/// separator-string allocations downstream — a hostile
/// `conflict-marker-size=4000000000` in a cloned repo's .gitattributes must
/// not make the backend try to allocate gigabytes.
fn attr_marker_size(repo: &git2::Repository, file_path: &str) -> u32 {
    repo.get_attr(
        Path::new(file_path),
        "conflict-marker-size",
        git2::AttrCheckFlags::default(),
    )
    .ok()
    .flatten()
    .and_then(|v| v.parse::<u16>().ok())
    .map(u32::from)
    .filter(|&n| n >= 1)
    .unwrap_or_else(crate::models::conflict::default_marker_size)
}

/// True when `content` holds a complete conflict written at `size`: a start
/// run, then a separator, then an end run — each exactly `size` marker
/// characters followed by a space or end-of-line, in git's emission order.
/// Fallback signal only — content that QUOTES a complete conflict (docs,
/// fixtures) fools it, which is why detect_conflict_emission replays the
/// merge first.
fn has_complete_conflict(content: &str, size: usize) -> bool {
    let sep: String = "=".repeat(size);
    let mut stage = 0u8; // 0 = want start, 1 = want separator, 2 = want end
    for line in content.lines() {
        match stage {
            0 if is_marker_run(line, '<', size) => stage = 1,
            1 if line == sep => stage = 2,
            2 if is_marker_run(line, '>', size) => return true,
            _ => {}
        }
    }
    false
}

/// A crafted file can demonstrate thousands of distinct sizes (escalating
/// marker runs); each one downstream becomes up to three merge replays, so
/// an uncapped list would let a hostile repo stall get_conflicts for
/// minutes. Real emissions demonstrate one or two sizes; the earliest-seen
/// ones are kept because the first complete conflict is git's own.
const MAX_DETECTED_SIZES: usize = 16;

/// Marker sizes the file's content DEMONSTRATES: distinct start-run lengths
/// (space/EOL-terminated) that form a complete conflict (start, then
/// separator, then end) at their own size. Used when the
/// conflict-marker-size attribute no longer matches what git wrote (it can
/// change mid-operation via .gitattributes' own resolution). Callers pass
/// `min_size` 7 for structural use (avoiding false positives on `< quoted`
/// lines) or 1 for replay candidates (replay rejects wrong sizes safely).
///
/// Single pass: every marker-shaped line advances a per-size completeness
/// state machine. Rescanning the file per distinct size would be
/// O(sizes × lines) — a hostile file with escalating run lengths turns
/// that into a multi-minute hang of get_conflicts.
fn detected_marker_sizes(content: &str, min_size: usize) -> Vec<u32> {
    use std::collections::HashMap;
    // 0 = want start, 1 = want separator, 2 = want end, 3 = complete.
    let mut stage: HashMap<usize, u8> = HashMap::new();
    let mut sizes: Vec<u32> = Vec::new();
    for line in content.lines() {
        let (ch, exact) = match line.chars().next() {
            Some('<') => ('<', false),
            Some('=') => ('=', true),
            Some('>') => ('>', false),
            _ => continue,
        };
        let n = line.chars().take_while(|&c| c == ch).count();
        if n < min_size || n > u16::MAX as usize {
            continue;
        }
        // Start/end markers allow a trailing label; the separator is the
        // bare run only (same shape has_complete_conflict matches).
        if exact {
            if line.chars().nth(n).is_some() {
                continue;
            }
        } else if !matches!(line.chars().nth(n), None | Some(' ')) {
            continue;
        }
        let s = stage.entry(n).or_insert(0);
        match (ch, *s) {
            ('<', 0) => *s = 1,
            ('=', 1) => *s = 2,
            ('>', 2) => {
                *s = 3;
                if sizes.len() < MAX_DETECTED_SIZES {
                    sizes.push(n as u32);
                }
            }
            _ => {}
        }
    }
    sizes.sort_unstable();
    sizes
}

/// True when the FIRST complete conflict at `size` contains a base marker
/// (`|||||||` run of the same size) between its start and separator —
/// the structural signature of diff3 emission. Fallback signal only.
fn diff3_within_first_conflict(content: &str, size: usize) -> bool {
    let sep: String = "=".repeat(size);
    let mut in_ours = false;
    let mut saw_base = false;
    for line in content.lines() {
        if !in_ours {
            if is_marker_run(line, '<', size) {
                in_ours = true;
            }
        } else if line == sep {
            return saw_base;
        } else if is_marker_run(line, '|', size) {
            saw_base = true;
        }
    }
    false
}

/// Line-based comparison of the working file against a replayed merge,
/// tolerant of the two things that legitimately differ between engines:
/// marker LABELS (git's CLI writes branch names/commit subjects, libgit2
/// writes index-entry paths) and CR line endings (checkout filters).
/// Content lines must match exactly.
fn matches_replay(workdir: &str, replay: &str, size: usize) -> bool {
    let marker_kind = |line: &str| -> Option<char> {
        ['<', '>', '|']
            .into_iter()
            .find(|&ch| is_marker_run(line, ch, size))
    };
    let a: Vec<&str> = workdir.lines().collect();
    let b: Vec<&str> = replay.lines().collect();
    a.len() == b.len()
        && a.iter().zip(b.iter()).all(|(x, y)| {
            x == y || matches!((marker_kind(x), marker_kind(y)), (Some(p), Some(q)) if p == q)
        })
}

/// Determine the marker size and conflict style this file's hunks were
/// ACTUALLY written with. The gitattribute/config only describe what git's
/// CLI writes; libgit2 (the in-app merge engine) ignores both and always
/// emits 7-char merge-style markers, and the same bytes can be a real
/// conflict at one size and quoted content at another. So: replay the merge
/// from the index blobs at each candidate size × style and accept a
/// (label/CR tolerant) match as definitive; fall back to structural scans
/// only when replay cannot decide (user-edited file, missing side).
fn detect_conflict_emission(
    repo: &git2::Repository,
    repo_root: &Path,
    file_path: &str,
    ancestor: Option<&git2::IndexEntry>,
    ours: Option<&git2::IndexEntry>,
    theirs: Option<&git2::IndexEntry>,
) -> (u32, String, Vec<ConflictHunk>) {
    let attr_size = attr_marker_size(repo, file_path);
    let content = match std::fs::read_to_string(repo_root.join(file_path)) {
        Ok(c) => c,
        // Unreadable working file (deleted side, binary) — size and style
        // are moot for parsing; report the attribute value.
        Err(_) => {
            return (
                attr_size,
                crate::models::conflict::default_conflict_style(),
                Vec::new(),
            )
        }
    };

    // Sizes actually WRITTEN in the file. The attribute reflects the repo's
    // configuration NOW, not when git wrote the markers — resolving
    // .gitattributes' own conflict mid-operation can change it under the
    // markers' feet, and trusting only the attribute would then report a
    // size the file does not use (the frontend would find zero conflicts
    // and let Mark Resolved stage the raw markers as resolved content).
    // Git emits runs as small as 1, so the REPLAY candidates take every
    // demonstrated size — a wrong size simply fails the replay match, so
    // sub-7 candidates cannot cause false positives there. The structural
    // fallback below stays at the 7+ floor: quoted `< text` / `= text`
    // lines can coincidentally form complete sub-7 structures, and only
    // the replay can certify those sizes safely.
    let detected_all = detected_marker_sizes(&content, 1);
    let mut candidates: Vec<u32> = vec![attr_size];
    if attr_size != 7 {
        candidates.push(7);
    }
    for &d in &detected_all {
        if !candidates.contains(&d) {
            candidates.push(d);
        }
    }

    // Replay from blob CONTENTS (not index entries): a missing ancestor —
    // an add/add conflict — is merged against an empty base, exactly as git
    // does, so those files still get replay verification instead of falling
    // through to the ambiguous structural scan.
    let blob = |e: Option<&git2::IndexEntry>| -> Option<Vec<u8>> {
        e.and_then(|e| repo.find_blob(e.id).ok().map(|b| b.content().to_vec()))
    };
    let anc_bytes = blob(ancestor).unwrap_or_default();
    if let (Some(our_bytes), Some(their_bytes)) = (blob(ours), blob(theirs)) {
        let mut anc_in = git2::MergeFileInput::new();
        anc_in.content(&anc_bytes);
        let mut our_in = git2::MergeFileInput::new();
        our_in.content(&our_bytes);
        let mut their_in = git2::MergeFileInput::new();
        their_in.content(&their_bytes);
        for &size in &candidates {
            for style in ["merge", "diff3", "zdiff3"] {
                let mut opts = git2::MergeFileOptions::new();
                opts.marker_size(size as u16);
                opts.style_diff3(style == "diff3");
                opts.style_zdiff3(style == "zdiff3");
                let Ok(result) = git2::merge_file(&anc_in, &our_in, &their_in, Some(&mut opts))
                else {
                    continue;
                };
                let replay = String::from_utf8_lossy(result.content());
                if matches_replay(&content, &replay, size as usize) {
                    // zdiff3 emits the same structure as diff3 to a parser.
                    let reported = if style == "merge" { "merge" } else { "diff3" };
                    // The replay matched line-for-line, so marker positions
                    // in the replay ARE positions in the working file. But
                    // the replay's own content can quote marker-shaped
                    // lines just like the file — re-replay at a size no
                    // blob line collides with, where marker detection is
                    // unambiguous, and hand the frontend AUTHORITATIVE
                    // hunk positions instead of shape heuristics.
                    let replay_line_count = replay.lines().count();
                    let star =
                        collision_free_size(&[&anc_bytes, &our_bytes, &their_bytes], size as usize);
                    let mut star_opts = git2::MergeFileOptions::new();
                    star_opts.marker_size(star);
                    star_opts.style_diff3(style == "diff3");
                    star_opts.style_zdiff3(style == "zdiff3");
                    let hunks = git2::merge_file(&anc_in, &our_in, &their_in, Some(&mut star_opts))
                        .ok()
                        .and_then(|star_result| {
                            let star_replay =
                                String::from_utf8_lossy(star_result.content()).to_string();
                            // Marker lines are one line each at any
                            // size, so the line counts must agree —
                            // bail to heuristics if they somehow don't.
                            if star_replay.lines().count() != replay_line_count {
                                return None;
                            }
                            replay_hunks(&star_replay, star as usize, style != "merge")
                        })
                        .unwrap_or_default();
                    return (size, reported.to_string(), hunks);
                }
            }
        }
    }

    // Structural fallback (hand-edited files, missing sides). When BOTH
    // the attribute size and 7 show a complete conflict the bytes are
    // genuinely undecidable — prefer 7: it is what this app's own merge
    // engine (libgit2) always writes, and CLI-written files at the raised
    // size are certified by the replay above before any user edit could
    // break its equality. When NEITHER matches, fall back to a size the
    // content itself demonstrates (stale attribute).
    let complete_attr = attr_size != 7 && has_complete_conflict(&content, attr_size as usize);
    let complete_7 = has_complete_conflict(&content, 7);
    let size = if complete_attr && !complete_7 {
        attr_size
    } else if complete_7 {
        7
    } else {
        detected_all.iter().copied().find(|&n| n >= 7).unwrap_or(7)
    };
    let style = if diff3_within_first_conflict(&content, size as usize) {
        "diff3"
    } else {
        "merge"
    };
    // No replay match — the file was hand-edited; positions would be
    // guesses, so the frontend's validated heuristics take over.
    (size, style.to_string(), Vec::new())
}

/// A marker size that cannot collide with any content line: strictly longer
/// than every leading `<`/`=`/`>`/`|` run in any input blob.
fn collision_free_size(blobs: &[&[u8]], at_least: usize) -> u16 {
    let mut max_run = at_least;
    for bytes in blobs {
        // Byte-level scan: merge_file works on raw bytes, so the run count
        // must too (a lossy string decode could in principle diverge).
        for line in bytes.split(|&b| b == b'\n') {
            for ch in *b"<=>|" {
                let n = line.iter().take_while(|&&b| b == ch).count();
                if n > max_run {
                    max_run = n;
                }
            }
        }
    }
    (max_run + 3).min(u16::MAX as usize) as u16
}

/// Extract hunk marker positions from a replay generated at a
/// collision-free size — every marker-shaped line is a REAL marker there.
/// Returns None on any malformed structure (never expected).
fn replay_hunks(replay: &str, size: usize, has_base: bool) -> Option<Vec<ConflictHunk>> {
    let sep: String = "=".repeat(size);
    let mut hunks: Vec<ConflictHunk> = Vec::new();
    let mut cur: Option<(u32, Option<u32>, Option<u32>)> = None; // (start, base, separator)
    for (i, line) in replay.lines().enumerate() {
        let i = i as u32;
        match cur {
            None => {
                if is_marker_run(line, '<', size) {
                    cur = Some((i, None, None));
                }
            }
            Some((start, base, separator)) => {
                if separator.is_none()
                    && has_base
                    && base.is_none()
                    && is_marker_run(line, '|', size)
                {
                    cur = Some((start, Some(i), None));
                } else if separator.is_none() && line == sep {
                    cur = Some((start, base, Some(i)));
                } else if let Some(sep_idx) = separator {
                    if is_marker_run(line, '>', size) {
                        hunks.push(ConflictHunk {
                            start,
                            separator: sep_idx,
                            end: i,
                            base,
                        });
                        cur = None;
                    }
                }
            }
        }
    }
    if cur.is_some() {
        return None;
    }
    Some(hunks)
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

    // STRICT decoding, matching read_file_content: a lossy read would put
    // U+FFFD substitutions on screen, and resolving from such a pane (Use
    // Base on a legacy-encoded ancestor) would silently bake the corrupted
    // text into the resolved file. The caller treats the error like any
    // other unreadable side and offers verbatim (raw-bytes) resolution.
    String::from_utf8(blob.content().to_vec())
        .map_err(|_| LeviathanError::OperationFailed("File content is not valid UTF-8".to_string()))
}

/// Mark a file as resolved with the given content.
/// When `delete_file` is true the resolution is the file's REMOVAL (e.g. the
/// deleted side of a modify/delete conflict): the working file is deleted and
/// the deletion is staged, instead of writing+staging an empty file.
#[command]
pub async fn resolve_conflict(
    path: String,
    file_path: String,
    content: String,
    delete_file: Option<bool>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let full_path = validate_path_within_repo(Path::new(&path), &file_path)?;
    let mut index = repo.index()?;

    if delete_file.unwrap_or(false) {
        // symlink_metadata, not exists(): exists() FOLLOWS symlinks, so a
        // dangling link reports false and would be left on disk while the
        // index stages its deletion — an untracked leftover that blocks
        // later checkouts.
        if std::fs::symlink_metadata(&full_path).is_ok() {
            std::fs::remove_file(&full_path)?;
        }
        index.remove_path(Path::new(&file_path))?;
    } else {
        // Write the resolved content to the working directory. NEVER write
        // THROUGH an existing symlink — fs::write follows it and would
        // corrupt the link's target file (and stage the wrong blob).
        remove_if_symlink(&full_path)?;
        std::fs::write(&full_path, &content)?;
        index.add_path(Path::new(&file_path))?;
    }
    index.write()?;

    Ok(())
}

/// Remove `path` when it is a symlink, so a subsequent write creates a new
/// file instead of following the link into its target.
fn remove_if_symlink(path: &Path) -> Result<()> {
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

/// Resolve a conflict by taking one side's blob verbatim (binary-safe).
/// `side` is "ours" or "theirs". If the chosen side has no entry (the file
/// was deleted on that side), the resolution is the file's removal.
#[command]
pub async fn resolve_conflict_take_side(
    path: String,
    file_path: String,
    side: String,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let full_path = validate_path_within_repo(Path::new(&path), &file_path)?;

    let mut index = repo.index()?;
    let conflict = index
        .conflicts()?
        .filter_map(|c| c.ok())
        .find(|c| {
            c.our
                .as_ref()
                .or(c.their.as_ref())
                .or(c.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path) == file_path.as_str())
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            LeviathanError::OperationFailed(format!("No conflict found for '{}'", file_path))
        })?;

    let entry = match side.as_str() {
        "ours" => conflict.our,
        "theirs" => conflict.their,
        other => {
            return Err(LeviathanError::OperationFailed(format!(
                "Invalid side '{}': expected 'ours' or 'theirs'",
                other
            )));
        }
    };

    match entry {
        Some(e) if e.mode == 0o160000 => {
            // Submodule (gitlink) pointer — there is no blob to write and
            // the path is a directory in the worktree. Stage the chosen
            // COMMIT pointer directly (like `git checkout --ours -- path`
            // followed by `git add`); the submodule's own worktree is left
            // for `git submodule update` to move.
            let resolved = git2::IndexEntry {
                // Clear the stage bits — this is the resolution entry.
                flags: e.flags & !0x3000,
                ..e
            };
            index.remove_path(Path::new(&file_path))?;
            index.add(&resolved)?;
        }
        Some(e) => {
            let blob = repo.find_blob(e.id)?;
            // NEVER write through an existing symlink: fs::write follows
            // it, which would corrupt the link's TARGET file and stage the
            // pre-existing (wrong) link blob instead of the chosen side.
            remove_if_symlink(&full_path)?;
            if e.mode == 0o120000 {
                // The chosen side IS a symlink — its blob content is the
                // link target path; recreate the link rather than writing
                // a regular file containing the target as text.
                #[cfg(unix)]
                {
                    // remove_if_symlink only cleared a symlink; in a
                    // file↔symlink type conflict the workdir holds a REGULAR
                    // file, and symlink() refuses to replace it (EEXIST).
                    if std::fs::symlink_metadata(&full_path).is_ok() {
                        std::fs::remove_file(&full_path)?;
                    }
                    std::os::unix::fs::symlink(
                        String::from_utf8_lossy(blob.content()).as_ref(),
                        &full_path,
                    )?;
                }
                #[cfg(not(unix))]
                std::fs::write(&full_path, blob.content())?;
            } else {
                // Write the chosen side's raw blob bytes (works for binary
                // files).
                std::fs::write(&full_path, blob.content())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    // Apply the chosen side's mode in BOTH directions:
                    // fs::write keeps the existing file's permissions, so
                    // taking a non-executable side over an executable
                    // on-disk file must chmod DOWN too, or the resolved
                    // file is staged with the mode of the side the user
                    // rejected.
                    let mode = if e.mode == 0o100755 { 0o755 } else { 0o644 };
                    std::fs::set_permissions(&full_path, std::fs::Permissions::from_mode(mode))?;
                }
            }
            index.add_path(Path::new(&file_path))?;
        }
        None => {
            // The chosen side deleted the file — the resolution is removal.
            // symlink_metadata, not exists(): a DANGLING symlink (common for
            // links into ignored/generated trees) reports exists()==false
            // and would survive on disk as an untracked leftover while the
            // UI says the file was deleted.
            if let Ok(meta) = std::fs::symlink_metadata(&full_path) {
                // A DIRECTORY here is a submodule worktree (gitlink
                // deletion) — git itself leaves it behind on `git rm`
                // of a submodule; never delete a whole tree from a
                // conflict resolution.
                if !meta.file_type().is_dir() {
                    std::fs::remove_file(&full_path)?;
                }
            }
            index.remove_path(Path::new(&file_path))?;
        }
    }
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
        let full_path = match validate_path_within_repo(Path::new(&path), &file) {
            Ok(p) => p,
            Err(_) => continue,
        };
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
    let full_path = validate_path_within_repo(Path::new(&path), &file_path)?;
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
    async fn test_abort_merge_without_merge_in_progress_errors() {
        // `git merge --abort` fails with "fatal: There is no merge to abort
        // (MERGE_HEAD missing)." and leaves staged work untouched. It must
        // NOT silently hard-reset the index and working tree.
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add file", &[("a.txt", "base")]);
        repo.create_file("a.txt", "staged precious work");
        repo.stage_file("a.txt");

        let result = abort_merge(repo.path_str()).await;
        assert!(
            result.is_err(),
            "abort_merge without a merge in progress must fail like git"
        );
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("no merge to abort"),
            "unexpected message: {msg}"
        );

        // The staged edit is untouched.
        let content = std::fs::read_to_string(repo.path.join("a.txt")).unwrap();
        assert_eq!(content, "staged precious work");
        let git_repo = repo.repo();
        let statuses = git_repo.statuses(None).unwrap();
        let entry = statuses
            .iter()
            .find(|s| s.path().ok() == Some("a.txt"))
            .expect("a.txt should still have a status entry");
        assert!(entry.status().contains(git2::Status::INDEX_MODIFIED));
    }

    #[tokio::test]
    async fn test_abort_merge_preserves_unrelated_uncommitted_changes() {
        // `git merge --abort` (git reset --merge) restores only what the
        // merge touched; uncommitted changes to unrelated files survive.
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        repo.create_commit(
            "Add files",
            &[("shared.txt", "base"), ("notes.txt", "notes\n")],
        );
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);

        // Uncommitted edit to a file the merge does not touch.
        repo.create_file("notes.txt", "notes\nmy uncommitted notes\n");

        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        abort_merge(repo.path_str()).await.unwrap();

        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        assert!(!git_repo.index().unwrap().has_conflicts());
        // The merged file is restored to HEAD...
        let shared = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert_eq!(shared, "main content");
        // ...but the unrelated uncommitted edit is preserved, like git.
        let notes = std::fs::read_to_string(repo.path.join("notes.txt")).unwrap();
        assert_eq!(notes, "notes\nmy uncommitted notes\n");
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

    // Like `git rebase`, a modification to a tracked file must abort the rebase
    // up front, leaving no in-progress rebase state behind.
    #[tokio::test]
    async fn test_rebase_dirty_working_tree_rejected() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Create a feature branch that diverges so a real rebase would run.
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature")]);

        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main commit", &[("main.txt", "main")]);

        repo.checkout_branch("feature");

        // Modify a TRACKED file (feature.txt) — canonical git refuses this.
        repo.create_file("feature.txt", "uncommitted change");

        let result = rebase(repo.path_str(), initial_branch.clone()).await;
        assert!(
            result.is_err(),
            "rebase must be rejected when a tracked file has uncommitted changes"
        );

        // No rebase state should have been created.
        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        assert!(!repo.path.join(".git/rebase-merge").exists());
        assert!(!repo.path.join(".git/rebase-apply").exists());
    }

    // Canonical `git rebase` proceeds when only untracked files are present — the
    // dirty-tree guard must not block on them.
    #[tokio::test]
    async fn test_rebase_allows_untracked_files() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature")]);

        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main commit", &[("main.txt", "main")]);

        repo.checkout_branch("feature");

        // A brand-new untracked file must NOT block the rebase.
        repo.create_file("scratch.txt", "untracked");

        let result = rebase(repo.path_str(), initial_branch.clone()).await;
        assert!(
            result.is_ok(),
            "rebase must not be blocked by an untracked file: {result:?}"
        );
        // The untracked file survives the rebase.
        assert!(repo.path.join("scratch.txt").exists());
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
            None,
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
    async fn test_merge_ff_refuses_to_overwrite_local_changes() {
        // git aborts a fast-forward merge that would overwrite uncommitted
        // local changes ("Your local changes to the following files would be
        // overwritten by merge ... Aborting"), leaving the ref unmoved.
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        repo.create_commit("Add file", &[("file.txt", "base")]);
        let pre_merge_oid = repo.head_oid();

        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("file.txt", "feature")]);
        repo.checkout_branch(&initial_branch);

        // Uncommitted local edit the fast-forward checkout would overwrite.
        repo.create_file("file.txt", "my precious local edit");

        let result = merge(repo.path_str(), "feature".to_string(), None, None, None).await;
        assert!(
            result.is_err(),
            "fast-forward merge over local changes must refuse like git"
        );
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("overwritten by merge"),
            "unexpected message: {msg}"
        );

        // Local edit preserved and ref unmoved.
        let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
        assert_eq!(content, "my precious local edit");
        assert_eq!(repo.head_oid(), pre_merge_oid);
    }

    #[tokio::test]
    async fn test_merge_ff_refuses_to_overwrite_untracked_file() {
        // git: "The following untracked working tree files would be
        // overwritten by merge ... Aborting".
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Add new file", &[("new.txt", "feature version")]);
        repo.checkout_branch(&initial_branch);
        let pre_merge_oid = repo.head_oid();

        // Precious untracked file the fast-forward would overwrite.
        repo.create_file("new.txt", "precious untracked content");

        let result = merge(repo.path_str(), "feature".to_string(), None, None, None).await;
        assert!(
            result.is_err(),
            "fast-forward merge over an untracked file must refuse like git"
        );

        let content = std::fs::read_to_string(repo.path.join("new.txt")).unwrap();
        assert_eq!(content, "precious untracked content");
        assert_eq!(repo.head_oid(), pre_merge_oid);
    }

    #[tokio::test]
    async fn test_merge_refuses_when_merge_already_in_progress() {
        // git: "error: Merging is not possible because you have unmerged
        // files." / "You have not concluded your merge (MERGE_HEAD exists)."
        // — not a misleading "uncommitted change would be overwritten".
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);

        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        let msg = result
            .expect_err("merging while a merge is in progress must fail")
            .to_string();
        assert!(
            msg.contains("not concluded your merge"),
            "unexpected message: {msg}"
        );
        // The original merge state stays intact for resolve/abort.
        assert_eq!(repo.repo().state(), git2::RepositoryState::Merge);
    }

    #[tokio::test]
    async fn test_merge_default_message_is_canonical() {
        // `git merge --no-edit feature` produces the subject
        // "Merge branch 'feature'", not "Merge 'feature' into HEAD".
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);

        merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await
        .unwrap();

        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), Some("Merge branch 'feature'"));
    }

    #[tokio::test]
    async fn test_merge_default_message_into_nondefault_branch() {
        // git appends " into <branch>" to the merge subject for any branch
        // other than master/main. Merging feature into "develop" must yield
        // "Merge branch 'feature' into develop".
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("develop");
        repo.checkout_branch("develop");
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "content")]);
        repo.checkout_branch("develop");

        merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await
        .unwrap();

        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.summary().unwrap(),
            Some("Merge branch 'feature' into develop")
        );
    }

    #[tokio::test]
    async fn test_continue_rebase_without_active_rebase() {
        let repo = TestRepo::with_initial_commit();

        // Should fail without an active rebase
        let result = continue_rebase(repo.path_str()).await;
        assert!(result.is_err());
    }

    /// Set up a merge conflict on shared.txt between the initial branch and
    /// "feature", ending checked out on the initial branch (merge not run).
    fn setup_conflicting_branches(repo: &TestRepo) {
        let initial_branch = repo.current_branch();
        repo.create_commit("Add shared", &[("shared.txt", "base")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);
    }

    #[tokio::test]
    async fn test_commit_merge_completes_conflicted_merge() {
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);

        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();

        let result = commit_merge(repo.path_str(), Some("Merge feature".to_string()), None).await;
        assert!(result.is_ok(), "commit_merge failed: {:?}", result.err());

        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.parent_count(),
            2,
            "merge commit must have both parents"
        );
        assert_eq!(head.summary().unwrap(), Some("Merge feature"));
    }

    #[tokio::test]
    async fn test_commit_merge_squash_produces_single_parent() {
        // A conflicted merge resolved and completed with squash:true must yield
        // a SINGLE-parent commit (the squash the user asked for), not a merge
        // commit, and clear the merge state.
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);

        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();

        let result = commit_merge(repo.path_str(), Some("Squashed".to_string()), Some(true)).await;
        assert!(
            result.is_ok(),
            "squash commit_merge failed: {:?}",
            result.err()
        );

        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.parent_count(),
            1,
            "squash merge commit must have a single parent"
        );
        assert_eq!(head.summary().unwrap(), Some("Squashed"));
    }

    #[tokio::test]
    async fn test_commit_merge_strips_conflict_comments_from_merge_msg() {
        // MERGE_MSG carries libgit2's '# Conflicts:' / '#\t<path>' comment lines.
        // Defaulting to it must NOT bake those comment lines into history.
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);

        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        // Simulate git's MERGE_MSG with conflict comment lines.
        let merge_msg = "Merge branch 'feature'\n\n# Conflicts:\n#\tshared.txt\n";
        std::fs::write(repo.repo().path().join("MERGE_MSG"), merge_msg).unwrap();

        resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();

        // No explicit message → defaults to (cleaned) MERGE_MSG.
        commit_merge(repo.path_str(), None, None).await.unwrap();

        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        let msg = head.message().unwrap();
        assert!(
            !msg.lines().any(|l| l.starts_with('#')),
            "commit message must not contain '#' comment lines: {:?}",
            msg
        );
        assert!(
            !msg.contains("Conflicts"),
            "commit message must not contain the Conflicts block: {:?}",
            msg
        );
        assert_eq!(head.summary().unwrap(), Some("Merge branch 'feature'"));
    }

    #[tokio::test]
    async fn test_commit_merge_signed_squash_restores_state_on_failure() {
        // The squash-signed path clears merge state before running `git commit`.
        // If that CLI commit fails (bogus signing config here), the merge state
        // must be restored so the user can retry or abort.
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);

        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();

        // Force a signed commit whose signing will fail (bogus gpg program).
        {
            let git_repo = repo.repo();
            let mut config = git_repo.config().unwrap();
            config.set_bool("commit.gpgsign", true).unwrap();
            config
                .set_str("gpg.program", "/nonexistent/definitely-not-real-gpg")
                .unwrap();
        }

        let result = commit_merge(repo.path_str(), Some("Squashed".to_string()), Some(true)).await;
        assert!(
            result.is_err(),
            "signed squash commit should fail with a bogus gpg program"
        );

        // Merge state restored so retry/abort still work.
        let git_repo = repo.repo();
        assert_eq!(
            git_repo.state(),
            git2::RepositoryState::Merge,
            "merge state must be restored after a failed signed squash commit"
        );
        assert!(git_repo.path().join("MERGE_HEAD").exists());
    }

    #[tokio::test]
    async fn test_commit_merge_refuses_unresolved_conflicts() {
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        let result = commit_merge(repo.path_str(), None, None).await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));
        // Still mid-merge so the user can keep resolving
        assert_eq!(repo.repo().state(), git2::RepositoryState::Merge);
    }

    #[tokio::test]
    async fn test_commit_merge_without_merge_in_progress() {
        let repo = TestRepo::with_initial_commit();
        let result = commit_merge(repo.path_str(), None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_resolve_conflict_delete_file_stages_removal() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add doomed file", &[("doomed.txt", "contents")]);

        let result = resolve_conflict(
            repo.path_str(),
            "doomed.txt".to_string(),
            String::new(),
            Some(true),
        )
        .await;
        assert!(
            result.is_ok(),
            "delete resolution failed: {:?}",
            result.err()
        );

        assert!(!repo.path.join("doomed.txt").exists());
        let git_repo = repo.repo();
        let statuses = git_repo.statuses(None).unwrap();
        let entry = statuses
            .iter()
            .find(|s| s.path().ok() == Some("doomed.txt"))
            .expect("deletion should be staged");
        assert!(entry.status().contains(git2::Status::INDEX_DELETED));
    }

    #[tokio::test]
    async fn test_resolve_conflict_take_side_theirs() {
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        let result = resolve_conflict_take_side(
            repo.path_str(),
            "shared.txt".to_string(),
            "theirs".to_string(),
        )
        .await;
        assert!(result.is_ok(), "take side failed: {:?}", result.err());

        let content = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert_eq!(content, "feature content");
        assert!(!repo.repo().index().unwrap().has_conflicts());
    }

    #[tokio::test]
    async fn test_resolve_conflict_take_deleted_side_removes_file() {
        // modify/delete conflict: feature deletes the file, main modifies it
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        repo.create_commit("Add shared", &[("shared.txt", "base")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        std::fs::remove_file(repo.path.join("shared.txt")).unwrap();
        {
            let git_repo = repo.repo();
            let mut index = git_repo.index().unwrap();
            index
                .remove_path(std::path::Path::new("shared.txt"))
                .unwrap();
            index.write().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = git_repo.find_tree(tree_oid).unwrap();
            let sig = git_repo.signature().unwrap();
            let parent = git_repo.head().unwrap().peel_to_commit().unwrap();
            git_repo
                .commit(Some("HEAD"), &sig, &sig, "Delete shared", &tree, &[&parent])
                .unwrap();
        }
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Modify shared", &[("shared.txt", "modified")]);

        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        let result = resolve_conflict_take_side(
            repo.path_str(),
            "shared.txt".to_string(),
            "theirs".to_string(),
        )
        .await;
        assert!(
            result.is_ok(),
            "take deleted side failed: {:?}",
            result.err()
        );
        assert!(!repo.path.join("shared.txt").exists());
        assert!(!repo.repo().index().unwrap().has_conflicts());
    }

    #[tokio::test]
    async fn test_get_conflicts_flags_binary() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        std::fs::write(repo.path.join("blob.bin"), [0u8, 1, 2, 3]).unwrap();
        repo.stage_file("blob.bin");
        repo.create_commit("Add binary", &[]);

        repo.create_branch("feature");
        repo.checkout_branch("feature");
        std::fs::write(repo.path.join("blob.bin"), [0u8, 9, 9, 9]).unwrap();
        repo.stage_file("blob.bin");
        repo.create_commit("Feature binary", &[]);

        repo.checkout_branch(&initial_branch);
        std::fs::write(repo.path.join("blob.bin"), [0u8, 7, 7, 7]).unwrap();
        repo.stage_file("blob.bin");
        repo.create_commit("Main binary", &[]);

        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let bin = conflicts
            .iter()
            .find(|c| c.path == "blob.bin")
            .expect("binary conflict should be listed");
        assert!(bin.is_binary, "binary conflict must be flagged");
    }

    #[tokio::test]
    async fn test_get_conflicts_reports_marker_size() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Raise the marker size for .txt files via gitattributes, committed
        // on all branches so it is in effect during the merge.
        repo.create_commit(
            "Add attrs and shared",
            &[
                (".gitattributes", "*.txt conflict-marker-size=12\n"),
                ("shared.txt", "base"),
                ("other.md", "base"),
            ],
        );
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit(
            "Feature change",
            &[("shared.txt", "feature content"), ("other.md", "feature")],
        );
        repo.checkout_branch(&initial_branch);
        repo.create_commit(
            "Main change",
            &[("shared.txt", "main content"), ("other.md", "main")],
        );

        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        // libgit2's merge ignores conflict-marker-size and writes 7-char
        // markers, so the raised attribute must NOT be reported for this
        // file — the frontend would parse the real markers as content.
        let written = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert!(
            written.lines().any(|l| l.starts_with("<<<<<<<")),
            "precondition: libgit2 wrote default-size markers; got:\n{written}"
        );
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("txt conflict should be listed");
        assert_eq!(
            txt.marker_size, 7,
            "raised attribute must fall back to 7 when the file was written with 7-char markers"
        );
        assert_eq!(txt.conflict_style, "merge");
        let md = conflicts
            .iter()
            .find(|c| c.path == "other.md")
            .expect("md conflict should be listed");
        assert_eq!(md.marker_size, 7, "unset attribute must default to 7");

        // Git's CLI (rebase/cherry-pick shell-outs, external git) DOES honor
        // the attribute. Simulate its emission: with real 12-char markers on
        // disk the raised size must be reported. (The extra content line is
        // not in the blobs, so this exercises the structural fallback.)
        std::fs::write(
            repo.path.join("shared.txt"),
            "<<<<<<<<<<<< HEAD\nmain content\n<<<<<<< a 7-char sample in content\n============\nfeature content\n>>>>>>>>>>>> feature\n",
        )
        .unwrap();
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("txt conflict should be listed");
        assert_eq!(
            txt.marker_size, 12,
            "raised attribute must be reported when the file really uses raised markers"
        );
    }

    /// Replays a merge of the conflicted index entries for `path` with the
    /// given options and writes the result to the working directory —
    /// simulating what a different engine (git's CLI) would have written.
    fn replay_conflict_to_workdir(repo: &TestRepo, path: &str, opts: &mut git2::MergeFileOptions) {
        let git_repo = repo.repo();
        let index = git_repo.index().unwrap();
        let conflict = index
            .conflicts()
            .unwrap()
            .flatten()
            .find(|c| {
                c.our
                    .as_ref()
                    .map(|e| String::from_utf8_lossy(&e.path) == path)
                    .unwrap_or(false)
            })
            .expect("conflict should exist");
        let result = git_repo
            .merge_file_from_index(
                conflict.ancestor.as_ref().unwrap(),
                conflict.our.as_ref().unwrap(),
                conflict.their.as_ref().unwrap(),
                Some(opts),
            )
            .unwrap();
        std::fs::write(repo.path.join(path), result.content()).unwrap();
    }

    #[tokio::test]
    async fn test_get_conflicts_replay_detects_cli_written_raised_markers() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        repo.create_commit(
            "Add attrs and shared",
            &[
                (".gitattributes", "*.txt conflict-marker-size=12\n"),
                ("shared.txt", "base"),
            ],
        );
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        // Rewrite the conflict exactly as git's CLI would: raised size, with
        // labels DIFFERENT from libgit2's index-entry paths — the replay
        // comparison must tolerate label differences.
        let mut opts = git2::MergeFileOptions::new();
        opts.marker_size(12);
        opts.our_label("HEAD");
        opts.their_label("feature");
        replay_conflict_to_workdir(&repo, "shared.txt", &mut opts);

        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("txt conflict should be listed");
        assert_eq!(txt.marker_size, 12);
        assert_eq!(txt.conflict_style, "merge");
    }

    #[tokio::test]
    async fn test_get_conflicts_quoted_raised_sample_does_not_fool_size_detection() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        // The OURS side's CONTENT quotes a complete 12-char conflict — the
        // very kind of file conflict-marker-size gets raised for. A purely
        // structural scan reports 12 here; only the merge replay can tell
        // that libgit2 actually wrote the real markers at 7.
        let quoted = "docs:\n<<<<<<<<<<<< sample\none\n============\ntwo\n>>>>>>>>>>>> sample\n";
        repo.create_commit(
            "Add attrs and shared",
            &[
                (".gitattributes", "*.txt conflict-marker-size=12\n"),
                ("shared.txt", "base"),
            ],
        );
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", quoted)]);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        let written = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert!(
            written.contains("<<<<<<<<<<<< sample") && written.contains("<<<<<<< "),
            "precondition: quoted 12-sample AND real 7-char markers coexist; got:\n{written}"
        );
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("txt conflict should be listed");
        assert_eq!(
            txt.marker_size, 7,
            "the quoted sample must not defeat the replay verification"
        );
    }

    #[tokio::test]
    async fn test_get_conflicts_add_add_conflict_replays_against_empty_base() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        // An add/add conflict has NO ancestor entry, so index-based replay
        // is impossible — the empty-base replay must still certify the size.
        // One side quotes a complete 12-char conflict (the docs case the
        // attribute was raised for); the real markers are libgit2's 7.
        let quoted = "docs:\n<<<<<<<<<<<< sample\none\n============\ntwo\n>>>>>>>>>>>> sample\n";
        repo.create_commit(
            "Add attrs",
            &[(".gitattributes", "*.md conflict-marker-size=12\n")],
        );
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature adds doc", &[("new.md", quoted)]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main adds doc", &[("new.md", "unrelated text\n")]);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        let written = std::fs::read_to_string(repo.path.join("new.md")).unwrap();
        assert!(
            written.contains("<<<<<<< ") && written.contains("<<<<<<<<<<<< sample"),
            "precondition: real 7-char markers AND the quoted 12-sample coexist; got:\n{written}"
        );
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let md = conflicts
            .iter()
            .find(|c| c.path == "new.md")
            .expect("add/add conflict should be listed");
        assert!(md.ancestor.is_none(), "precondition: no ancestor entry");
        assert_eq!(
            md.marker_size, 7,
            "empty-base replay must certify the real size for add/add conflicts"
        );
    }

    #[tokio::test]
    async fn test_get_conflicts_add_add_pipe_content_is_not_diff3() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        // Ours content contains a 7-pipe run (Markdown table art). With no
        // ancestor entry the replay must still run (empty base) and report
        // merge style — a diff3 misreport would make the frontend discard
        // every ours line after the pipe run as a "base section".
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature adds", &[("new.txt", "THEIRS\n")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main adds", &[("new.txt", "a\n|||||||\nz\n")]);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "new.txt")
            .expect("add/add conflict should be listed");
        assert!(txt.ancestor.is_none(), "precondition: no ancestor entry");
        assert_eq!(txt.marker_size, 7);
        assert_eq!(
            txt.conflict_style, "merge",
            "pipe-run content must not misreport diff3 for add/add conflicts"
        );
    }

    #[tokio::test]
    async fn test_get_conflicts_undecidable_fallback_prefers_default_size() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        repo.create_commit(
            "Add attrs and shared",
            &[
                (".gitattributes", "*.txt conflict-marker-size=12\n"),
                ("shared.txt", "base"),
            ],
        );
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        // Hand-edit the file so no replay matches, with COMPLETE conflict
        // structures at BOTH sizes. Undecidable from bytes — the fallback
        // must prefer 7 (this app's own engine) so the real markers written
        // by libgit2 stay parseable rather than leaking as resolved text.
        std::fs::write(
            repo.path.join("shared.txt"),
            "<<<<<<<<<<<< quoted\nq1\n============\nq2\n>>>>>>>>>>>> quoted\nedited by hand\n<<<<<<< HEAD\nmain content\n=======\nfeature content\n>>>>>>> feature\n",
        )
        .unwrap();
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("conflict should be listed");
        assert_eq!(txt.marker_size, 7);
    }

    #[tokio::test]
    async fn test_get_conflicts_detects_size_when_attribute_went_stale() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        // NO conflict-marker-size attribute — but the file's markers were
        // written at 12 (the attribute was dropped mid-operation, e.g. by
        // resolving .gitattributes' own conflict). The size must be
        // detected from the content, or the frontend would find zero
        // conflicts and Mark Resolved would stage the raw markers.
        repo.create_commit("Add shared", &[("shared.txt", "base")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        // Simulate CLI-written raised markers (with a hand edit so replay
        // cannot match and the structural fallback must decide).
        std::fs::write(
            repo.path.join("shared.txt"),
            "<<<<<<<<<<<< HEAD\nmain content\nhand edit\n============\nfeature content\n>>>>>>>>>>>> feature\n",
        )
        .unwrap();
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("conflict should be listed");
        assert_eq!(
            txt.marker_size, 12,
            "the written size must be detected from content when no size matches the attribute"
        );
    }

    #[tokio::test]
    async fn test_get_conflicts_reports_authoritative_hunk_positions() {
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("conflict should be listed");
        // Workdir: <<<<<<< ours / main content / ======= / feature content
        // / >>>>>>> theirs — the replay matched, so positions are exact.
        assert_eq!(txt.conflict_hunks.len(), 1);
        let h = &txt.conflict_hunks[0];
        assert_eq!((h.start, h.separator, h.end, h.base), (0, 2, 4, None));

        // The positions must actually point at the marker lines on disk.
        let written = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        let lines: Vec<&str> = written.lines().collect();
        assert!(lines[h.start as usize].starts_with("<<<<<<<"));
        assert!(lines[h.separator as usize].starts_with("======="));
        assert!(lines[h.end as usize].starts_with(">>>>>>>"));
    }

    #[tokio::test]
    async fn test_hand_edited_file_reports_no_hunk_positions() {
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        // A hand edit breaks the replay match — positions would be guesses,
        // so none may be reported (the frontend heuristics take over).
        let mut content = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        content.push_str("hand edit\n");
        std::fs::write(repo.path.join("shared.txt"), content).unwrap();

        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("conflict should be listed");
        assert!(txt.conflict_hunks.is_empty());
    }

    #[test]
    fn test_replay_hunks_and_collision_free_size() {
        let replay = "ctx\n<<<<<<<<<< ours\na\n==========\nb\n>>>>>>>>>> theirs\ntail\n";
        let hunks = replay_hunks(replay, 10, false).unwrap();
        assert_eq!(hunks.len(), 1);
        assert_eq!(
            (
                hunks[0].start,
                hunks[0].separator,
                hunks[0].end,
                hunks[0].base
            ),
            (1, 3, 5, None)
        );

        let diff3 = "<<<<<<<<<< o\na\n||||||||||\nbase\n==========\nb\n>>>>>>>>>> t\n";
        let hunks = replay_hunks(diff3, 10, true).unwrap();
        assert_eq!(hunks[0].base, Some(2));

        // Collision-free size must exceed every marker-shaped run in blobs.
        let blob = b"content\n<<<<<<<<<<<<<<< quoted long run\n" as &[u8];
        let star = collision_free_size(&[blob], 7);
        assert!(star as usize > 15);
    }

    #[test]
    fn test_detected_marker_sizes() {
        let raised = "ctx\n<<<<<<<<<<<< HEAD\nours\n============\ntheirs\n>>>>>>>>>>>> f\n";
        assert_eq!(detected_marker_sizes(raised, 7), vec![12]);

        let none = "just\nplain\ntext\n< quoted line\n";
        assert!(detected_marker_sizes(none, 7).is_empty());

        // An incomplete start-shaped line demonstrates nothing.
        let incomplete = "<<<<<<< HEAD\nno separator or end\n";
        assert!(detected_marker_sizes(incomplete, 7).is_empty());

        // Git emits runs as small as 1 — sub-7 sizes are demonstrable when
        // the floor allows them (used for replay candidates only).
        let tiny = "<<<< HEAD\nours\n====\ntheirs\n>>>> f\n";
        assert_eq!(detected_marker_sizes(tiny, 1), vec![4]);
        assert!(detected_marker_sizes(tiny, 7).is_empty());

        // The separator must be the bare run — a trailing label makes it
        // content, exactly like has_complete_conflict treats it.
        let labeled_sep = "<<<<<<< HEAD\nours\n======= label\ntheirs\n>>>>>>> f\n";
        assert!(detected_marker_sizes(labeled_sep, 7).is_empty());

        // Out-of-order marker lines (end before separator) demonstrate
        // nothing at that size.
        let out_of_order = "<<<<<<< HEAD\nours\n>>>>>>> f\n=======\n";
        assert!(detected_marker_sizes(out_of_order, 7).is_empty());
    }

    #[test]
    fn test_detected_marker_sizes_caps_hostile_escalating_runs() {
        // A crafted file demonstrating thousands of distinct sizes must
        // neither hang the scan (it is single-pass) nor hand thousands of
        // replay candidates downstream — each candidate costs up to three
        // merge replays in detect_conflict_emission.
        let mut content = String::new();
        for n in 1..=2000usize {
            content.push_str(&"<".repeat(n));
            content.push('\n');
            content.push_str(&"=".repeat(n));
            content.push('\n');
            content.push_str(&">".repeat(n));
            content.push('\n');
        }
        let sizes = detected_marker_sizes(&content, 1);
        assert_eq!(sizes.len(), MAX_DETECTED_SIZES);
        // The earliest-completed sizes are the ones kept — the first
        // complete conflict in a real file is git's own emission.
        assert_eq!(sizes, (1..=MAX_DETECTED_SIZES as u32).collect::<Vec<u32>>());
    }

    #[tokio::test]
    async fn test_get_conflicts_recovers_sub7_size_when_attribute_went_stale() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        // The file's markers were written at size 4 (git honors sub-7
        // attribute values), but the attribute has since changed to 8 —
        // e.g. by resolving .gitattributes' own conflict mid-operation.
        // The replay must still certify the true size via the
        // content-demonstrated candidates.
        repo.create_commit(
            "Add attrs and shared",
            &[
                (".gitattributes", "*.txt conflict-marker-size=8\n"),
                ("shared.txt", "base"),
            ],
        );
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        // Rewrite the conflict as size-4 emission (what git wrote before
        // the attribute changed).
        let mut opts = git2::MergeFileOptions::new();
        opts.marker_size(4);
        replay_conflict_to_workdir(&repo, "shared.txt", &mut opts);
        let written = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert!(
            written.lines().any(|l| l.starts_with("<<<< ")),
            "precondition: size-4 markers on disk; got:\n{written}"
        );

        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("conflict should be listed");
        assert_eq!(
            txt.marker_size, 4,
            "the replay must certify the sub-7 size the content demonstrates"
        );
        assert!(
            !txt.conflict_hunks.is_empty(),
            "replay-certified files get authoritative hunks"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_take_side_recreates_symlinks_without_corrupting_targets() {
        use std::os::unix::fs::symlink;
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Tracked target files the link may point at.
        repo.create_commit(
            "Add targets",
            &[("target-a", "A CONTENT\n"), ("target-b", "B CONTENT\n")],
        );
        // Base: link -> target-a
        let link = repo.path.join("link");
        symlink("target-a", &link).unwrap();
        repo.stage_file("link");
        repo.create_commit("Add link", &[]);

        repo.create_branch("feature");
        repo.checkout_branch("feature");
        std::fs::remove_file(&link).unwrap();
        symlink("target-b", &link).unwrap();
        repo.stage_file("link");
        repo.create_commit("Feature retargets link", &[]);

        repo.checkout_branch(&initial_branch);
        std::fs::remove_file(&link).unwrap();
        symlink("target-a-changed", &link).unwrap();
        repo.stage_file("link");
        repo.create_commit("Main retargets link", &[]);

        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let entry = conflicts
            .iter()
            .find(|c| c.path == "link")
            .expect("symlink conflict should be listed");
        // Routed to the whole-blob chooser, never the text editor.
        assert!(entry.is_binary, "symlink conflicts must use the chooser");

        resolve_conflict_take_side(repo.path_str(), "link".to_string(), "theirs".to_string())
            .await
            .unwrap();

        // The resolution is a real symlink to theirs' target...
        let meta = std::fs::symlink_metadata(&link).unwrap();
        assert!(meta.file_type().is_symlink(), "a LINK, not a text file");
        assert_eq!(
            std::fs::read_link(&link).unwrap().to_string_lossy(),
            "target-b"
        );
        // ...the tracked target files are untouched...
        assert_eq!(
            std::fs::read_to_string(repo.path.join("target-a")).unwrap(),
            "A CONTENT\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.path.join("target-b")).unwrap(),
            "B CONTENT\n"
        );
        // ...and the index stages the CHOSEN side's blob at link mode.
        let git_repo = repo.repo();
        let index = git_repo.index().unwrap();
        assert!(!index.has_conflicts());
        let staged = index.get_path(Path::new("link"), 0).expect("stage-0 entry");
        assert_eq!(staged.mode, 0o120000, "staged as a symlink");
        let staged_blob = git_repo.find_blob(staged.id).unwrap();
        assert_eq!(staged_blob.content(), b"target-b");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_take_side_replaces_a_regular_file_with_the_chosen_symlink() {
        use std::os::unix::fs::symlink;
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        repo.create_commit(
            "Add target and thing",
            &[("target-a", "A CONTENT\n"), ("thing", "base thing\n")],
        );

        // Feature turns `thing` into a symlink; main keeps editing it as a
        // regular file — a file<->symlink TYPE conflict.
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        let thing = repo.path.join("thing");
        std::fs::remove_file(&thing).unwrap();
        symlink("target-a", &thing).unwrap();
        repo.stage_file("thing");
        repo.create_commit("Feature turns thing into a link", &[]);

        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main edits thing", &[("thing", "ours thing\n")]);

        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let entry = conflicts
            .iter()
            .find(|c| c.path == "thing")
            .expect("type conflict should be listed");
        assert!(entry.is_binary, "file<->symlink conflicts use the chooser");
        // The workdir holds ours' REGULAR file — exactly the shape a bare
        // symlink() call refuses to overwrite (EEXIST).
        let meta = std::fs::symlink_metadata(&thing).unwrap();
        assert!(
            meta.file_type().is_file(),
            "precondition: a regular file is on disk"
        );

        resolve_conflict_take_side(repo.path_str(), "thing".to_string(), "theirs".to_string())
            .await
            .expect("taking the symlink side over a regular file must succeed");

        let meta = std::fs::symlink_metadata(&thing).unwrap();
        assert!(meta.file_type().is_symlink(), "resolved as a real symlink");
        assert_eq!(
            std::fs::read_link(&thing).unwrap().to_string_lossy(),
            "target-a"
        );
        // The link's tracked target file is untouched.
        assert_eq!(
            std::fs::read_to_string(repo.path.join("target-a")).unwrap(),
            "A CONTENT\n"
        );
        let git_repo = repo.repo();
        let index = git_repo.index().unwrap();
        assert!(!index.has_conflicts());
        let staged = index
            .get_path(Path::new("thing"), 0)
            .expect("stage-0 entry");
        assert_eq!(staged.mode, 0o120000, "staged as a symlink");
    }

    /// Stage a gitlink (submodule pointer) entry at `path` pointing at
    /// `commit_oid`. Gitlink OIDs reference the SUBMODULE's history, so
    /// libgit2 does not require them in this repo's object database.
    fn stage_gitlink(repo: &git2::Repository, path: &str, commit_oid: git2::Oid) {
        let mut index = repo.index().unwrap();
        let entry = git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: 0o160000,
            uid: 0,
            gid: 0,
            file_size: 0,
            id: commit_oid,
            flags: 0,
            flags_extended: 0,
            path: path.as_bytes().to_vec(),
        };
        index.add(&entry).unwrap();
        index.write().unwrap();
    }

    #[tokio::test]
    async fn test_submodule_conflicts_are_flagged_and_take_side_stages_the_pointer() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Three distinct commit OIDs to use as submodule pointers.
        let ptr_base = repo.create_commit("ptr base", &[("a.txt", "1")]);
        let ptr_ours = repo.create_commit("ptr ours", &[("a.txt", "2")]);
        let ptr_theirs = repo.create_commit("ptr theirs", &[("a.txt", "3")]);

        let git_repo = repo.repo();
        // The worktree presence of a gitlink is just a directory.
        std::fs::create_dir(repo.path.join("sub")).unwrap();
        stage_gitlink(&git_repo, "sub", ptr_base);
        repo.create_commit("Add submodule", &[]);

        repo.create_branch("feature");
        repo.checkout_branch("feature");
        stage_gitlink(&git_repo, "sub", ptr_theirs);
        repo.create_commit("Feature moves submodule", &[]);

        repo.checkout_branch(&initial_branch);
        stage_gitlink(&git_repo, "sub", ptr_ours);
        repo.create_commit("Main moves submodule", &[]);

        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let entry = conflicts
            .iter()
            .find(|c| c.path == "sub")
            .expect("submodule conflict should be listed");
        // Routed to the submodule chooser: NOT binary (its OIDs are
        // commits, not blobs) and never the text editor.
        assert!(entry.is_submodule, "gitlink conflicts must be flagged");
        assert!(!entry.is_binary);
        assert!(entry.conflict_hunks.is_empty());

        resolve_conflict_take_side(repo.path_str(), "sub".to_string(), "theirs".to_string())
            .await
            .expect("taking a side of a submodule conflict must not dead-end");

        // Fresh handle: the earlier Repository caches its in-memory index
        // and would not see the command's on-disk write.
        let git_repo = repo.repo();
        let index = git_repo.index().unwrap();
        assert!(!index.has_conflicts());
        let staged = index.get_path(Path::new("sub"), 0).expect("stage-0 entry");
        assert_eq!(staged.mode, 0o160000, "still a gitlink");
        assert_eq!(staged.id, ptr_theirs, "the CHOSEN side's commit pointer");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_take_side_delete_removes_a_dangling_symlink_from_disk() {
        use std::os::unix::fs::symlink;
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Base: a DANGLING symlink (its target is not tracked and does not
        // exist — common for links into ignored/generated trees).
        let link = repo.path.join("link");
        symlink("missing-target", &link).unwrap();
        repo.stage_file("link");
        repo.create_commit("Add dangling link", &[]);

        // Feature deletes the link; main retargets it — modify/delete.
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        std::fs::remove_file(&link).unwrap();
        let git_repo = repo.repo();
        let mut index = git_repo.index().unwrap();
        index.remove_path(Path::new("link")).unwrap();
        index.write().unwrap();
        repo.create_commit("Feature deletes link", &[]);

        repo.checkout_branch(&initial_branch);
        std::fs::remove_file(&link).unwrap();
        symlink("missing-target-2", &link).unwrap();
        repo.stage_file("link");
        repo.create_commit("Main retargets link", &[]);

        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        assert!(
            conflicts.iter().any(|c| c.path == "link"),
            "modify/delete on the link should conflict"
        );
        // Precondition: the dangling link IS on disk — the exact shape
        // Path::exists() lies about (it follows the link).
        assert!(
            std::fs::symlink_metadata(&link).is_ok(),
            "precondition: the dangling link is in the worktree"
        );
        assert!(!link.exists(), "precondition: exists() follows the link");

        resolve_conflict_take_side(repo.path_str(), "link".to_string(), "theirs".to_string())
            .await
            .unwrap();

        // The deletion is real: gone from BOTH the index and the disk — a
        // leftover link would resurface as untracked and block checkouts.
        assert!(
            std::fs::symlink_metadata(&link).is_err(),
            "the dangling link must be removed from disk"
        );
        let index = git_repo.index().unwrap();
        assert!(!index.has_conflicts());
        assert!(index.get_path(Path::new("link"), 0).is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_take_side_applies_the_chosen_sides_mode_downward() {
        use std::os::unix::fs::PermissionsExt;
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Base + theirs: non-executable. Ours: executable.
        repo.create_commit("Add script", &[("script.sh", "#!/bin/sh\nbase\n")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("script.sh", "#!/bin/sh\ntheirs\n")]);
        repo.checkout_branch(&initial_branch);
        let script = repo.path.join("script.sh");
        std::fs::write(&script, "#!/bin/sh\nours\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        repo.stage_file("script.sh");
        repo.create_commit("Main change makes executable", &[]);

        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        // The conflicted on-disk file carries ours' executable bit.
        assert_ne!(
            std::fs::metadata(&script).unwrap().permissions().mode() & 0o111,
            0,
            "precondition: conflicted file is executable"
        );

        // Taking THEIRS (non-executable) must chmod DOWN, not keep ours' bit.
        resolve_conflict_take_side(
            repo.path_str(),
            "script.sh".to_string(),
            "theirs".to_string(),
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::metadata(&script).unwrap().permissions().mode() & 0o111,
            0,
            "the resolved file must carry the CHOSEN side's mode"
        );
    }

    #[tokio::test]
    async fn test_get_conflicts_hostile_marker_size_attribute_is_rejected() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        // A hostile/typo attribute value must not force a multi-gigabyte
        // allocation — it is rejected at parse time and falls back to 7.
        repo.create_commit(
            "Add attrs and shared",
            &[
                (".gitattributes", "*.txt conflict-marker-size=4000000000\n"),
                ("shared.txt", "base"),
            ],
        );
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("txt conflict should be listed");
        assert_eq!(txt.marker_size, 7);
    }

    #[tokio::test]
    async fn test_get_conflicts_reports_diff3_style() {
        let repo = TestRepo::with_initial_commit();
        setup_conflicting_branches(&repo);
        let _ = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;

        // Rewrite the conflict as diff3 emission (merge.conflictStyle=diff3
        // via git's CLI) — the style must be detected and reported so the
        // frontend knows a ||||||| line is a base section, not ours content.
        let mut opts = git2::MergeFileOptions::new();
        opts.style_diff3(true);
        replay_conflict_to_workdir(&repo, "shared.txt", &mut opts);
        let written = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert!(
            written.contains("|||||||"),
            "precondition: diff3 emission has a base marker; got:\n{written}"
        );

        let conflicts = get_conflicts(repo.path_str()).await.unwrap();
        let txt = conflicts
            .iter()
            .find(|c| c.path == "shared.txt")
            .expect("conflict should be listed");
        assert_eq!(txt.marker_size, 7);
        assert_eq!(txt.conflict_style, "diff3");
    }

    #[test]
    fn test_diff3_within_first_conflict() {
        let diff3 = "<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> f\n";
        assert!(diff3_within_first_conflict(diff3, 7));

        let merge_style = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> f\n";
        assert!(!diff3_within_first_conflict(merge_style, 7));

        // A pipe run in the THEIRS section is content, not a diff3 signal.
        let pipes_in_theirs = "<<<<<<< HEAD\nours\n=======\n||||||| x\ntheirs\n>>>>>>> f\n";
        assert!(!diff3_within_first_conflict(pipes_in_theirs, 7));
    }

    #[test]
    fn test_has_complete_conflict() {
        let raised = "<<<<<<<<<<<< HEAD\nours\n============\ntheirs\n>>>>>>>>>>>> feature\n";
        assert!(has_complete_conflict(raised, 12));
        assert!(
            !has_complete_conflict(raised, 7),
            "runs longer than the size must not match"
        );

        let default = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\n";
        assert!(!has_complete_conflict(default, 12));

        // Emission order is required: an end marker before the separator
        // (quoted docs) does not complete a conflict.
        let out_of_order = "<<<<<<<<<<<< HEAD\n>>>>>>>>>>>> nope\n============\n";
        assert!(!has_complete_conflict(out_of_order, 12));

        // CRLF-terminated lines still match.
        let crlf =
            "<<<<<<<<<<<< HEAD\r\nours\r\n============\r\ntheirs\r\n>>>>>>>>>>>> feature\r\n";
        assert!(has_complete_conflict(crlf, 12));

        // A separator with trailing label text is not git's separator.
        let labeled_sep = "<<<<<<<<<<<< HEAD\n============ x\n>>>>>>>>>>>> f\n";
        assert!(!has_complete_conflict(labeled_sep, 12));
    }

    #[tokio::test]
    async fn test_continue_rebase_after_resolution() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        setup_conflicting_branches(&repo);

        repo.checkout_branch("feature");
        let result = rebase(repo.path_str(), initial_branch.clone()).await;
        assert!(matches!(result, Err(LeviathanError::RebaseConflict)));

        resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();

        let result = continue_rebase(repo.path_str()).await;
        assert!(result.is_ok(), "continue_rebase failed: {:?}", result.err());
        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        let content = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert_eq!(content, "resolved");
    }

    #[tokio::test]
    async fn test_continue_rebase_skips_empty_commit() {
        // Resolving to exactly the onto side's content leaves an empty patch;
        // continuing must skip it (like `git rebase --skip`), not fail.
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        setup_conflicting_branches(&repo);

        repo.checkout_branch("feature");
        let result = rebase(repo.path_str(), initial_branch.clone()).await;
        assert!(matches!(result, Err(LeviathanError::RebaseConflict)));

        resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "main content".to_string(),
            None,
        )
        .await
        .unwrap();

        let result = continue_rebase(repo.path_str()).await;
        assert!(
            result.is_ok(),
            "continue_rebase should skip the empty commit: {:?}",
            result.err()
        );
        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        let content = std::fs::read_to_string(repo.path.join("shared.txt")).unwrap();
        assert_eq!(content, "main content");
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

    // ---- merge hook parity ----

    #[cfg(unix)]
    #[tokio::test]
    async fn test_merge_pre_merge_commit_hook_aborts() {
        let repo = TestRepo::with_initial_commit();
        let initial = repo.current_branch();
        let head_before = repo.head_oid();

        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature", &[("feature.txt", "content")]);
        repo.checkout_branch(&initial);

        repo.install_hook("pre-merge-commit", "#!/bin/sh\necho denied 1>&2\nexit 1\n");

        // no_ff forces an actual merge commit, so pre-merge-commit must run.
        let result = merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(
            result.is_err(),
            "pre-merge-commit exit 1 must stop the automatic merge commit"
        );
        assert!(result.unwrap_err().to_string().contains("denied"));

        // git does NOT abort on a pre-merge-commit veto: it leaves the merge
        // resumable ("use 'git commit' to complete the merge"). So MERGE_HEAD
        // must survive (state == Merge) and HEAD must not have moved yet.
        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Merge);
        assert_eq!(repo.head_oid(), head_before);

        // The merge must remain completable via commit_merge (hooks aside).
        commit_merge(repo.path_str(), None, None).await.unwrap();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.parent_count(),
            2,
            "completing the merge yields a merge commit"
        );
        assert_eq!(repo.repo().state(), git2::RepositoryState::Clean);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_merge_runs_commit_msg_hook() {
        // git runs commit-msg for an automatic (non-conflict) merge commit; the
        // hook may rewrite the message. Verify it fires and its edit lands.
        let repo = TestRepo::with_initial_commit();
        let initial = repo.current_branch();
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature", &[("feature.txt", "content")]);
        repo.checkout_branch(&initial);

        repo.install_hook(
            "commit-msg",
            "#!/bin/sh\necho 'Reviewed-by: hook' >> \"$1\"\n",
        );

        merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await
        .unwrap();

        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert!(
            head.message().unwrap().contains("Reviewed-by: hook"),
            "commit-msg hook must run and rewrite the auto-merge message, got: {:?}",
            head.message()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_merge_runs_post_merge_hook() {
        let repo = TestRepo::with_initial_commit();
        let initial = repo.current_branch();
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature", &[("feature.txt", "content")]);
        repo.checkout_branch(&initial);

        let marker = repo.path.join("post-merge.log");
        repo.install_hook(
            "post-merge",
            &format!("#!/bin/sh\necho \"$1\" > \"{}\"\n", marker.display()),
        );

        merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await
        .unwrap();

        let logged = std::fs::read_to_string(&marker).expect("post-merge must run");
        assert_eq!(logged.trim(), "0", "post-merge flag must be 0 (not squash)");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_fast_forward_merge_runs_post_merge_hook() {
        let repo = TestRepo::with_initial_commit();
        let initial = repo.current_branch();
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature", &[("feature.txt", "content")]);
        repo.checkout_branch(&initial);

        let marker = repo.path.join("post-merge.log");
        repo.install_hook(
            "post-merge",
            &format!("#!/bin/sh\ntouch \"{}\"\n", marker.display()),
        );

        // Plain fast-forward merge.
        merge(repo.path_str(), "feature".to_string(), None, None, None)
            .await
            .unwrap();

        assert!(
            marker.exists(),
            "post-merge must run after fast-forward too"
        );
    }
}
