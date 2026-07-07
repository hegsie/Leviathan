//! Squash and fixup commit command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Result of a squash operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashResult {
    pub new_oid: String,
    pub squashed_count: u32,
    pub success: bool,
}

/// Squash a range of commits into one
///
/// Takes commits between from_oid (exclusive) and to_oid (inclusive) and squashes them
/// into a single commit with the given message.
///
/// # Arguments
/// * `path` - Repository path
/// * `from_oid` - The parent commit (exclusive - commits after this are squashed)
/// * `to_oid` - The newest commit to squash (inclusive)
/// * `message` - The new commit message for the squashed commit
#[command]
pub async fn squash_commits(
    path: String,
    from_oid: String,
    to_oid: String,
    message: String,
) -> Result<SquashResult> {
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

    // Parse the OIDs
    let from = git2::Oid::from_str(&from_oid)
        .map_err(|_| LeviathanError::CommitNotFound(from_oid.clone()))?;
    let to =
        git2::Oid::from_str(&to_oid).map_err(|_| LeviathanError::CommitNotFound(to_oid.clone()))?;

    // Find the commits
    let from_commit = repo
        .find_commit(from)
        .map_err(|_| LeviathanError::CommitNotFound(from_oid.clone()))?;
    let to_commit = repo
        .find_commit(to)
        .map_err(|_| LeviathanError::CommitNotFound(to_oid.clone()))?;

    // Collect commits to squash (from oldest to newest, exclusive of from_commit)
    let mut commits_to_squash = Vec::new();
    let mut revwalk = repo.revwalk()?;
    revwalk.push(to)?;
    revwalk.hide(from)?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::REVERSE)?;

    for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        commits_to_squash.push(commit);
    }

    if commits_to_squash.is_empty() {
        return Err(LeviathanError::OperationFailed(
            "No commits found in the specified range".to_string(),
        ));
    }

    let squashed_count = commits_to_squash.len() as u32;

    // The squashed range must be part of the current branch history: the
    // branch ref is force-moved below, so an unrelated `to` would rewrite
    // the branch to foreign history.
    let head_commit = repo.head()?.peel_to_commit()?;
    if head_commit.id() != to && !repo.graph_descendant_of(head_commit.id(), to)? {
        return Err(LeviathanError::OperationFailed(
            "The commits to squash must be part of the current branch history.".to_string(),
        ));
    }

    // Get the tree from the newest commit (to_commit) - this contains the final state
    let tree = to_commit.tree()?;

    // Create a new commit with the same tree but with from_commit as the parent
    let signature = repo.signature()?;

    // Get the author from the first commit in the range (oldest commit being squashed)
    let author = commits_to_squash
        .first()
        .map(|c| c.author())
        .unwrap_or_else(|| signature.clone());

    let new_oid = repo.commit(
        None, // Don't update any reference yet
        &author,
        &signature,
        &message,
        &tree,
        &[&from_commit],
    )?;

    // Replay every commit after to_commit (to..HEAD) onto the squashed
    // commit, like `git rebase -i` does when a mid-history range is
    // squashed. Without this, moving the branch ref to the squashed commit
    // would silently discard all descendants of to_commit.
    let mut commits_after = Vec::new();
    let mut revwalk = repo.revwalk()?;
    revwalk.push(head_commit.id())?;
    revwalk.hide(to)?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::REVERSE)?;
    for oid in revwalk {
        commits_after.push(repo.find_commit(oid?)?);
    }

    let mut new_head_oid = new_oid;
    for commit in &commits_after {
        let current_base = repo.find_commit(new_head_oid)?;
        let parent_tree = commit.parent(0)?.tree()?;
        let commit_tree = commit.tree()?;
        let base_tree = current_base.tree()?;

        let mut merge_result = repo.merge_trees(&parent_tree, &base_tree, &commit_tree, None)?;
        if merge_result.has_conflicts() {
            // Nothing has been moved yet — the repository is untouched.
            return Err(LeviathanError::OperationFailed(format!(
                "Cannot squash: replaying the later commit {} onto the squashed \
                 commit produced a conflict. Use an interactive rebase instead.",
                commit.id()
            )));
        }
        let new_tree = repo.find_tree(merge_result.write_tree_to(&repo)?)?;
        new_head_oid = repo.commit(
            None,
            &commit.author(),
            &signature,
            commit.message().unwrap_or(""),
            &new_tree,
            &[&current_base],
        )?;
    }

    // Now we need to update HEAD to point to the new commit
    // First check if we're on a branch or in detached HEAD state
    let head = repo.head()?;
    if head.is_branch() {
        // Update the branch reference
        let branch_name = head.shorthand().unwrap_or("HEAD");
        let refname = format!("refs/heads/{}", branch_name);
        repo.reference(
            &refname,
            new_head_oid,
            true,
            &format!("squash: {} commits into one", squashed_count),
        )?;
    } else {
        // Detached HEAD - just update HEAD
        repo.set_head_detached(new_head_oid)?;
    }

    // Checkout the new commit to update working directory
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

    // git's rebase sequencer fires post-commit per replayed commit as HEAD
    // advances. This app replays as an ATOMIC batch — nothing is moved until
    // the whole sequence succeeds, so a mid-replay conflict leaves the repo
    // untouched. Advancing HEAD per commit to fire the hook accurately would
    // break that atomicity, and firing N times with HEAD already at the final
    // commit would feed every invocation the same (wrong) SHA. So fire
    // post-commit once, for the final rewritten HEAD.
    crate::commands::hooks::run_hook_noblock(&repo, "post-commit", &[]);

    Ok(SquashResult {
        new_oid: new_head_oid.to_string(),
        squashed_count,
        success: true,
    })
}

/// Fixup the current staged changes into a specific commit
///
/// This is similar to `git commit --fixup` followed by `git rebase --autosquash`.
/// It takes the currently staged changes and amends them into the specified target commit.
///
/// # Arguments
/// * `path` - Repository path
/// * `target_oid` - The commit to fixup (amend changes into)
/// * `amend_message` - If true, also amend the commit message; if false, keep original message
#[command]
pub async fn fixup_commit(
    path: String,
    target_oid: String,
    amend_message: Option<String>,
) -> Result<SquashResult> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Check for existing operations in progress
    if repo.state() != git2::RepositoryState::Clean {
        return Err(LeviathanError::OperationFailed(
            "Another operation is in progress".to_string(),
        ));
    }

    // Refuse on unstaged working-tree changes, like the canonical flow
    // (`git commit --fixup` + `git rebase --autosquash`), which errors with
    // "cannot rebase: You have unstaged changes." The final checkout below
    // would otherwise silently overwrite them. Untracked files are fine.
    let statuses = repo.statuses(None)?;
    let has_unstaged = statuses.iter().any(|s| {
        s.status().intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_TYPECHANGE
                | git2::Status::WT_RENAMED,
        )
    });
    if has_unstaged {
        return Err(LeviathanError::OperationFailed(
            "Cannot fixup: you have unstaged changes. Commit or stash them first.".to_string(),
        ));
    }

    // Check if there are staged changes
    let mut index = repo.index()?;
    let head_tree = repo.head()?.peel_to_tree()?;

    // Check for staged changes by comparing index to HEAD
    let diff = repo.diff_tree_to_index(Some(&head_tree), Some(&index), None)?;
    if diff.deltas().len() == 0 {
        return Err(LeviathanError::OperationFailed(
            "No staged changes to fixup".to_string(),
        ));
    }

    // Parse the target OID
    let target = git2::Oid::from_str(&target_oid)
        .map_err(|_| LeviathanError::CommitNotFound(target_oid.clone()))?;

    let target_commit = repo
        .find_commit(target)
        .map_err(|_| LeviathanError::CommitNotFound(target_oid.clone()))?;

    // Get the current HEAD
    let head_commit = repo.head()?.peel_to_commit()?;

    // Verify that target_commit is an ancestor of HEAD
    if !repo.graph_descendant_of(head_commit.id(), target_commit.id())? {
        return Err(LeviathanError::OperationFailed(
            "Target commit is not an ancestor of HEAD".to_string(),
        ));
    }

    // Collect all commits from target (exclusive) to HEAD (inclusive)
    let mut commits_after_target = Vec::new();
    let mut revwalk = repo.revwalk()?;
    revwalk.push(head_commit.id())?;
    revwalk.hide(target_commit.id())?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::REVERSE)?;

    for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        commits_after_target.push(commit);
    }

    // Create the new tree by applying staged changes to target commit's tree
    // First, we need to merge the current index changes with the target tree
    let target_tree = target_commit.tree()?;

    // Write the current index as a tree
    let staged_tree_oid = index.write_tree()?;
    let staged_tree = repo.find_tree(staged_tree_oid)?;

    // Merge the staged tree with the target tree
    // We need to create a tree that has target's content + our staged changes
    // The simplest approach: use the current staged tree as the new content for the target

    // Get the diff between HEAD tree and staged tree (our staged changes)
    let changes_diff = repo.diff_tree_to_tree(Some(&head_tree), Some(&staged_tree), None)?;

    // Apply these changes to the target tree
    let mut treebuilder = repo.treebuilder(Some(&target_tree))?;

    for delta in changes_diff.deltas() {
        let new_path = delta.new_file().path().unwrap();

        match delta.status() {
            git2::Delta::Added | git2::Delta::Modified => {
                // Get the blob from the staged tree
                let entry = staged_tree.get_path(new_path)?;
                treebuilder.insert(new_path, entry.id(), entry.filemode())?;
            }
            git2::Delta::Deleted => {
                treebuilder.remove(new_path)?;
            }
            _ => {}
        }
    }

    let new_target_tree_oid = treebuilder.write()?;
    let new_target_tree = repo.find_tree(new_target_tree_oid)?;

    // Create the new target commit with the merged tree
    let signature = repo.signature()?;
    let commit_message =
        amend_message.unwrap_or_else(|| target_commit.message().unwrap_or("").to_string());

    // Get parent of target commit
    let target_parent = target_commit.parent(0).ok();

    let new_target_oid = if let Some(ref parent) = target_parent {
        repo.commit(
            None,
            &target_commit.author(),
            &signature,
            &commit_message,
            &new_target_tree,
            &[parent],
        )?
    } else {
        // Root commit
        repo.commit(
            None,
            &target_commit.author(),
            &signature,
            &commit_message,
            &new_target_tree,
            &[],
        )?
    };

    // Now replay all commits after target onto the new target
    let mut current_base_oid = new_target_oid;

    for commit in &commits_after_target {
        let current_base = repo.find_commit(current_base_oid)?;

        // Cherry-pick this commit onto the new base
        let new_tree = {
            // Get the changes this commit introduced
            let commit_parent = commit.parent(0)?;
            let parent_tree = commit_parent.tree()?;
            let commit_tree = commit.tree()?;

            // Merge the commit's changes onto the new base
            let base_tree = current_base.tree()?;
            let mut merge_result =
                repo.merge_trees(&parent_tree, &base_tree, &commit_tree, None)?;

            if merge_result.has_conflicts() {
                // Write the conflicted index
                merge_result.write_tree_to(&repo)?;
                return Err(LeviathanError::OperationFailed(format!(
                    "Conflict while replaying commit {}. Manual resolution required.",
                    commit.id()
                )));
            }

            let new_tree_oid = merge_result.write_tree_to(&repo)?;
            repo.find_tree(new_tree_oid)?
        };

        // Create the replayed commit
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
            "fixup: amend changes into earlier commit",
        )?;
    } else {
        repo.set_head_detached(current_base_oid)?;
    }

    // Reset the index to remove staged changes (they're now in the fixup)
    index.read_tree(&repo.find_commit(current_base_oid)?.tree()?)?;
    index.write()?;

    // Checkout the new commit to update working directory
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

    Ok(SquashResult {
        new_oid: current_base_oid.to_string(),
        squashed_count: 1,
        success: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_squash_commits_basic() {
        let repo = TestRepo::with_initial_commit();

        // Create multiple commits to squash
        let _commit1 = repo.create_commit("Commit 1", &[("file1.txt", "content1")]);
        let _commit2 = repo.create_commit("Commit 2", &[("file2.txt", "content2")]);
        let commit3 = repo.create_commit("Commit 3", &[("file3.txt", "content3")]);

        // Get the initial commit (parent of commit1)
        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        let initial_oid = head
            .parent(0)
            .unwrap()
            .parent(0)
            .unwrap()
            .parent(0)
            .unwrap()
            .id();

        // Squash all three commits into one
        let result = squash_commits(
            repo.path_str(),
            initial_oid.to_string(),
            commit3.to_string(),
            "Squashed commit".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let squash_result = result.unwrap();
        assert!(squash_result.success);
        assert_eq!(squash_result.squashed_count, 3);

        // Verify all files exist
        assert!(repo.path.join("file1.txt").exists());
        assert!(repo.path.join("file2.txt").exists());
        assert!(repo.path.join("file3.txt").exists());

        // Verify we have the new commit
        let binding = repo.repo();
        let new_head = binding.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(new_head.summary().unwrap(), Some("Squashed commit"));

        // Verify the parent is the initial commit
        assert_eq!(new_head.parent(0).unwrap().id(), initial_oid);
    }

    #[tokio::test]
    async fn test_squash_commits_two_commits() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create two commits
        let _commit1 = repo.create_commit("First", &[("a.txt", "a")]);
        let commit2 = repo.create_commit("Second", &[("b.txt", "b")]);

        let result = squash_commits(
            repo.path_str(),
            initial_oid.to_string(),
            commit2.to_string(),
            "Combined commit".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let squash_result = result.unwrap();
        assert_eq!(squash_result.squashed_count, 2);

        // Verify files exist
        assert!(repo.path.join("a.txt").exists());
        assert!(repo.path.join("b.txt").exists());
    }

    #[tokio::test]
    async fn test_squash_commits_invalid_from_oid() {
        let repo = TestRepo::with_initial_commit();
        let head = repo.head_oid();

        let result = squash_commits(
            repo.path_str(),
            "invalid-oid".to_string(),
            head.to_string(),
            "Test".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_squash_commits_invalid_to_oid() {
        let repo = TestRepo::with_initial_commit();
        let head = repo.head_oid();

        let result = squash_commits(
            repo.path_str(),
            head.to_string(),
            "invalid-oid".to_string(),
            "Test".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_squash_commits_empty_range() {
        let repo = TestRepo::with_initial_commit();
        let head = repo.head_oid();

        // Try to squash with the same from and to (empty range)
        let result = squash_commits(
            repo.path_str(),
            head.to_string(),
            head.to_string(),
            "Test".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_squash_commits_preserves_content() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create commits that modify the same file
        repo.create_commit("Add file", &[("test.txt", "line1\n")]);
        repo.create_commit("Modify file", &[("test.txt", "line1\nline2\n")]);
        let final_commit =
            repo.create_commit("Final modify", &[("test.txt", "line1\nline2\nline3\n")]);

        let result = squash_commits(
            repo.path_str(),
            initial_oid.to_string(),
            final_commit.to_string(),
            "All changes".to_string(),
        )
        .await;

        assert!(result.is_ok());

        // Verify final content is preserved
        let content = std::fs::read_to_string(repo.path.join("test.txt")).unwrap();
        assert_eq!(content, "line1\nline2\nline3\n");
    }

    #[tokio::test]
    async fn test_squash_commits_mid_history_preserves_descendants() {
        // `git rebase -i` squashing C1+C2 in C0-C1-C2-C3 yields
        // C0-(C1+C2)-C3': the later commit C3 and its file are preserved,
        // not silently discarded.
        let repo = TestRepo::with_initial_commit();
        let c0 = repo.head_oid();
        let _c1 = repo.create_commit("Commit 1", &[("f1.txt", "1")]);
        let c2 = repo.create_commit("Commit 2", &[("f2.txt", "2")]);
        let _c3 = repo.create_commit("Commit 3", &[("f3.txt", "3")]);

        let result = squash_commits(
            repo.path_str(),
            c0.to_string(),
            c2.to_string(),
            "Squashed".to_string(),
        )
        .await;
        assert!(
            result.is_ok(),
            "mid-history squash failed: {:?}",
            result.err()
        );
        let squash_result = result.unwrap();
        assert_eq!(squash_result.squashed_count, 2);

        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        // HEAD is the replayed C3, on top of the squashed commit, on top of C0.
        assert_eq!(head.summary().unwrap(), Some("Commit 3"));
        assert_eq!(head.id().to_string(), squash_result.new_oid);
        let squashed = head.parent(0).unwrap();
        assert_eq!(squashed.summary().unwrap(), Some("Squashed"));
        assert_eq!(squashed.parent(0).unwrap().id(), c0);

        // All files, including C3's, survive in the working tree.
        assert!(repo.path.join("f1.txt").exists());
        assert!(repo.path.join("f2.txt").exists());
        assert!(repo.path.join("f3.txt").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_squash_runs_post_commit_hook() {
        // The squash replays history as an atomic batch (nothing is moved until
        // the whole sequence succeeds), so post-commit fires once for the final
        // rewritten HEAD — firing per replayed commit would either break that
        // atomicity or feed every invocation the same, already-final SHA.
        let repo = TestRepo::with_initial_commit();
        let counter = repo.path.join("pc-count");
        repo.install_hook(
            "post-commit",
            &format!("#!/bin/sh\necho x >> \"{}\"\n", counter.display()),
        );

        let c0 = repo.head_oid();
        let _c1 = repo.create_commit("Commit 1", &[("f1.txt", "1")]);
        let c2 = repo.create_commit("Commit 2", &[("f2.txt", "2")]);
        let _c3 = repo.create_commit("Commit 3", &[("f3.txt", "3")]);

        squash_commits(
            repo.path_str(),
            c0.to_string(),
            c2.to_string(),
            "Squashed".to_string(),
        )
        .await
        .unwrap();

        let count = std::fs::read_to_string(&counter)
            .unwrap_or_default()
            .lines()
            .count();
        assert_eq!(count, 1, "post-commit fires once for the rewritten HEAD");
    }

    #[tokio::test]
    async fn test_fixup_commit_refuses_unstaged_changes() {
        // The canonical flow (`git commit --fixup` + `git rebase -i
        // --autosquash`) refuses with "cannot rebase: You have unstaged
        // changes." — the unstaged edit must survive untouched.
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add b", &[("b.txt", "base\n")]);
        let target_oid = repo.create_commit("Target commit", &[("target.txt", "original")]);
        repo.create_commit("After commit", &[("after.txt", "after content")]);

        // Staged fix for the target commit.
        repo.create_file("target.txt", "modified");
        repo.stage_file("target.txt");
        // Unstaged precious edit to an unrelated file.
        repo.create_file("b.txt", "base\nprecious unstaged\n");

        let head_before = repo.head_oid();
        let result = fixup_commit(repo.path_str(), target_oid.to_string(), None).await;
        assert!(
            result.is_err(),
            "fixup with unstaged changes must refuse like git rebase"
        );
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("unstaged"), "unexpected message: {msg}");

        // Nothing was rewritten and the unstaged edit is preserved.
        assert_eq!(repo.head_oid(), head_before);
        let content = std::fs::read_to_string(repo.path.join("b.txt")).unwrap();
        assert_eq!(content, "base\nprecious unstaged\n");
    }

    #[tokio::test]
    async fn test_fixup_commit_no_staged_changes() {
        let repo = TestRepo::with_initial_commit();
        let head = repo.head_oid();

        let result = fixup_commit(repo.path_str(), head.to_string(), None).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("No staged changes"));
    }

    #[tokio::test]
    async fn test_fixup_commit_basic() {
        let repo = TestRepo::with_initial_commit();

        // Create a commit that we want to fixup
        let target_oid = repo.create_commit("Target commit", &[("target.txt", "original")]);

        // Create another commit after it
        repo.create_commit("After commit", &[("after.txt", "after content")]);

        // Stage some changes to fixup into the target commit
        repo.create_file("target.txt", "modified");
        repo.stage_file("target.txt");

        let result = fixup_commit(repo.path_str(), target_oid.to_string(), None).await;

        assert!(result.is_ok());
        let fixup_result = result.unwrap();
        assert!(fixup_result.success);

        // Verify the target file has the new content
        let content = std::fs::read_to_string(repo.path.join("target.txt")).unwrap();
        assert_eq!(content, "modified");

        // Verify both files exist
        assert!(repo.path.join("target.txt").exists());
        assert!(repo.path.join("after.txt").exists());
    }

    #[tokio::test]
    async fn test_fixup_commit_with_message() {
        let repo = TestRepo::with_initial_commit();

        // Create a commit that we want to fixup
        let target_oid = repo.create_commit("Original message", &[("file.txt", "content")]);

        // Create another commit after it (fixup requires target to be an ancestor of HEAD)
        repo.create_commit("After commit", &[("after.txt", "after content")]);

        // Stage some changes
        repo.create_file("file.txt", "new content");
        repo.stage_file("file.txt");

        let result = fixup_commit(
            repo.path_str(),
            target_oid.to_string(),
            Some("Updated message".to_string()),
        )
        .await;

        assert!(result.is_ok());

        // Verify the content was updated
        let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
        assert_eq!(content, "new content");

        // Verify both files exist
        assert!(repo.path.join("file.txt").exists());
        assert!(repo.path.join("after.txt").exists());
    }

    #[tokio::test]
    async fn test_fixup_commit_invalid_target() {
        let repo = TestRepo::with_initial_commit();

        // Stage some changes
        repo.create_file("new.txt", "content");
        repo.stage_file("new.txt");

        let result = fixup_commit(repo.path_str(), "invalid-oid".to_string(), None).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_squash_result_serialization() {
        let result = SquashResult {
            new_oid: "abc123".to_string(),
            squashed_count: 3,
            success: true,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"newOid\":\"abc123\""));
        assert!(json.contains("\"squashedCount\":3"));
        assert!(json.contains("\"success\":true"));
    }
}
