//! Stash command handlers

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::Stash;

/// Result of showing stash contents
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashShowResult {
    pub index: u32,
    /// The stash commit this result describes.
    ///
    /// `index` is a POSITION: any create or drop shifts every entry below it,
    /// so a caller that resolved an oid to an index and then asked for that
    /// index can be handed a DIFFERENT stash. Echoing the oid back lets the
    /// caller check it got the entry it asked about before showing a preview
    /// someone is about to Drop on.
    pub oid: String,
    pub message: String,
    pub files: Vec<StashFile>,
    pub total_additions: u32,
    pub total_deletions: u32,
    pub patch: Option<String>,
}

/// A file in a stash
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashFile {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    pub status: String,
}

/// Get all stashes
#[command]
pub async fn get_stashes(path: String) -> Result<Vec<Stash>> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    let mut stashes = Vec::new();

    repo.stash_foreach(|index, message, oid| {
        stashes.push(Stash {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
        });
        true
    })?;

    Ok(stashes)
}

/// Create a new stash
///
/// Returns `Ok(None)` when the working tree is clean and there is nothing to
/// stash. This mirrors `git stash push`, which prints "No local changes to
/// save" and exits 0 — a benign informational no-op, not a failure. libgit2
/// reports nothing-to-stash as `ErrorCode::NotFound`; we translate that into a
/// `None` result so the UI can show an informational toast instead of an error.
#[command]
pub async fn create_stash(
    path: String,
    message: Option<String>,
    include_untracked: Option<bool>,
) -> Result<Option<Stash>> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    let signature = repo.signature()?;

    let mut flags = git2::StashFlags::DEFAULT;
    if include_untracked.unwrap_or(false) {
        flags |= git2::StashFlags::INCLUDE_UNTRACKED;
    }

    let oid = match repo.stash_save(&signature, message.as_deref().unwrap_or("WIP"), Some(flags)) {
        Ok(oid) => oid,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    Ok(Some(Stash {
        index: 0,
        message: message.unwrap_or_else(|| "WIP".to_string()),
        oid: oid.to_string(),
    }))
}

/// Apply a stash
#[command]
pub async fn apply_stash(path: String, index: usize, drop_after: Option<bool>) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;

    repo.stash_apply(index, None)?;

    // git_stash_apply returns success (0) even when the apply lands merge
    // conflicts. Surface the conflict so the UI opens the resolution flow, and
    // keep the stash regardless — `drop_after` is only honoured on a CLEAN apply.
    if repo.index()?.has_conflicts() {
        return Err(LeviathanError::MergeConflict);
    }

    if drop_after.unwrap_or(false) {
        repo.stash_drop(index)?;
    }

    Ok(())
}

/// Drop a stash
#[command]
pub async fn drop_stash(path: String, index: usize) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    repo.stash_drop(index)?;
    Ok(())
}

/// Pop a stash (apply and drop)
#[command]
pub async fn pop_stash(path: String, index: usize) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;

    // Do NOT use stash_pop: git_stash_pop drops the stash even when the apply
    // lands conflicts (git_stash_apply returns 0 on a conflicted apply), which
    // silently loses the stashed changes. Apply first, and only drop when the
    // apply was clean — on a conflict, surface it and keep the stash so the user
    // can resolve (and the entry remains recoverable).
    repo.stash_apply(index, None)?;

    if repo.index()?.has_conflicts() {
        return Err(LeviathanError::MergeConflict);
    }

    repo.stash_drop(index)?;
    Ok(())
}

/// Append `diff`'s per-file entries and stats to `files`, adding its totals.
///
/// Pulled out of `stash_show` because a stash has TWO diffs worth listing: the
/// base→stash diff and, for `--include-untracked`, the untracked-files parent.
fn collect_diff_stats(
    diff: &git2::Diff<'_>,
    files: &mut Vec<StashFile>,
    total_additions: &mut u32,
    total_deletions: &mut u32,
) -> Result<()> {
    let stats = diff.stats()?;
    let start = files.len();

    diff.foreach(
        &mut |delta, _| {
            let file_path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                git2::Delta::Typechange => "typechange",
                _ => "modified",
            };

            files.push(StashFile {
                path: file_path,
                additions: 0, // Will be filled in later
                deletions: 0,
                status: status.to_string(),
            });
            true
        },
        None,
        None,
        None,
    )?;

    // Get per-file stats by iterating through lines
    // Use RefCell to allow mutable borrow inside closures
    let file_stats: std::cell::RefCell<std::collections::HashMap<String, (u32, u32)>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
    diff.foreach(
        &mut |_delta, _| true,
        None,
        None,
        Some(&mut |delta, _hunk, line| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let mut stats = file_stats.borrow_mut();
            let entry = stats.entry(path).or_insert((0, 0));
            match line.origin() {
                '+' => entry.0 += 1,
                '-' => entry.1 += 1,
                _ => {}
            }
            true
        }),
    )?;
    let file_stats = file_stats.into_inner();

    // Only THIS diff's entries: an earlier diff may already have listed a path,
    // and its counts came from a different diff's line walk.
    for file in &mut files[start..] {
        if let Some((adds, dels)) = file_stats.get(&file.path) {
            file.additions = *adds;
            file.deletions = *dels;
        }
    }

    *total_additions += stats.insertions() as u32;
    *total_deletions += stats.deletions() as u32;
    Ok(())
}

/// Append `diff` to `buf` in patch format.
fn append_patch(diff: &git2::Diff<'_>, buf: &mut Vec<u8>) -> Result<()> {
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        // Add the origin character for context/add/delete lines
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            buf.push(origin as u8);
        }
        buf.extend_from_slice(line.content());
        true
    })?;
    Ok(())
}

/// Show stash contents
#[command]
pub async fn stash_show(
    path: String,
    index: u32,
    stat: Option<bool>,
    patch: Option<bool>,
) -> Result<StashShowResult> {
    let mut repo = git2::Repository::open(Path::new(&path))?;

    // Get stash info (message and oid) by iterating through stashes
    let mut stash_info: Option<(String, git2::Oid)> = None;
    repo.stash_foreach(|i, message, oid| {
        if i as u32 == index {
            stash_info = Some((message.to_string(), *oid));
            false // Stop iterating
        } else {
            true // Continue
        }
    })?;

    let (message, stash_oid) = stash_info.ok_or_else(|| {
        crate::error::LeviathanError::Git(git2::Error::from_str(&format!(
            "Stash entry {} not found",
            index
        )))
    })?;

    // Get the stash commit
    let stash_commit = repo.find_commit(stash_oid)?;

    // Get parent commit (the commit the stash was based on)
    let parent_commit = stash_commit.parent(0)?;

    // Get the diff between parent and stash commit
    let parent_tree = parent_commit.tree()?;
    let stash_tree = stash_commit.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&stash_tree), None)?;

    // A stash made with --include-untracked keeps those files in a THIRD parent
    // commit, which the base→stash diff never touches. They have to be listed:
    // this app's own "Stash Changes" button always includes untracked, so a
    // stash whose whole content is untracked files would otherwise preview as
    // empty — right before an irreversible Drop. `git stash show -u` includes
    // them too. Guarded on the parent count: an ordinary stash has 2 parents
    // and `parent(2)` would error.
    let untracked_diff = if stash_commit.parent_count() > 2 {
        let untracked_tree = stash_commit.parent(2)?.tree()?;
        Some(repo.diff_tree_to_tree(None, Some(&untracked_tree), None)?)
    } else {
        None
    };

    // Collect file stats
    let mut files: Vec<StashFile> = Vec::new();
    let mut total_additions: u32 = 0;
    let mut total_deletions: u32 = 0;

    // Get stats if requested (default true)
    if stat.unwrap_or(true) {
        collect_diff_stats(
            &diff,
            &mut files,
            &mut total_additions,
            &mut total_deletions,
        )?;
        if let Some(untracked) = &untracked_diff {
            collect_diff_stats(
                untracked,
                &mut files,
                &mut total_additions,
                &mut total_deletions,
            )?;
        }
    }

    // Generate patch if requested
    let patch_output = if patch.unwrap_or(false) {
        let mut patch_buf = Vec::new();
        append_patch(&diff, &mut patch_buf)?;
        if let Some(untracked) = &untracked_diff {
            append_patch(untracked, &mut patch_buf)?;
        }
        Some(String::from_utf8_lossy(&patch_buf).to_string())
    } else {
        None
    };

    Ok(StashShowResult {
        index,
        oid: stash_oid.to_string(),
        message,
        files,
        total_additions,
        total_deletions,
        patch: patch_output,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    /// Helper to create a commit with a tracked file for stash tests
    fn setup_tracked_file(repo: &TestRepo, filename: &str, content: &str) {
        repo.create_file(filename, content);
        repo.stage_file(filename);
        repo.create_commit(&format!("Add {}", filename), &[]);
    }

    #[tokio::test]
    async fn test_get_stashes_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_stashes(repo.path_str()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_create_stash_with_changes() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "tracked.txt", "original");

        // Modify the tracked file
        repo.create_file("tracked.txt", "modified");

        let result = create_stash(repo.path_str(), Some("Test stash".to_string()), None).await;
        assert!(result.is_ok());
        let stash = result.unwrap().expect("clean tree? expected a stash");
        assert_eq!(stash.index, 0);
        assert_eq!(stash.message, "Test stash");
    }

    #[tokio::test]
    async fn test_create_stash_default_message() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "content");

        // Modify to have something to stash
        repo.create_file("file.txt", "modified");

        let result = create_stash(repo.path_str(), None, None).await;
        assert!(result.is_ok());
        let stash = result.unwrap().expect("expected a stash");
        assert_eq!(stash.message, "WIP");
    }

    #[tokio::test]
    async fn test_create_stash_no_changes_is_noop() {
        let repo = TestRepo::with_initial_commit();
        // No changes to stash. Canonical `git stash push` on a clean tree prints
        // "No local changes to save" and exits 0 — a benign no-op, not a failure.
        let result = create_stash(repo.path_str(), Some("Empty stash".to_string()), None).await;
        assert!(
            matches!(result, Ok(None)),
            "stashing a clean tree must be a successful no-op (Ok(None)), got {:?}",
            result
        );

        // And no stash entry should have been created.
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert!(stashes.is_empty());
    }

    #[tokio::test]
    async fn test_get_stashes_returns_created() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "content");

        // Modify and stash
        repo.create_file("file.txt", "modified");
        create_stash(repo.path_str(), Some("First stash".to_string()), None)
            .await
            .unwrap();

        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 1);
        assert!(stashes[0].message.contains("First stash"));
    }

    #[tokio::test]
    async fn test_drop_stash() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "content");

        // Modify and stash
        repo.create_file("file.txt", "modified");
        create_stash(repo.path_str(), Some("To drop".to_string()), None)
            .await
            .unwrap();

        // Verify stash exists
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 1);

        // Drop it
        let result = drop_stash(repo.path_str(), 0).await;
        assert!(result.is_ok());

        // Verify it's gone
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert!(stashes.is_empty());
    }

    #[tokio::test]
    async fn test_drop_stash_invalid_index() {
        let repo = TestRepo::with_initial_commit();
        let result = drop_stash(repo.path_str(), 999).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_apply_stash() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original");

        // Modify and stash
        repo.create_file("file.txt", "stashed content");
        create_stash(repo.path_str(), Some("Apply test".to_string()), None)
            .await
            .unwrap();

        // File should be back to original
        let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
        assert_eq!(content, "original");

        // Apply stash
        let result = apply_stash(repo.path_str(), 0, Some(false)).await;
        assert!(result.is_ok());

        // File should have stashed content
        let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
        assert_eq!(content, "stashed content");

        // Stash should still exist (we didn't drop it)
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 1);
    }

    #[tokio::test]
    async fn test_apply_stash_with_drop() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original");

        // Modify and stash
        repo.create_file("file.txt", "stashed");
        create_stash(repo.path_str(), Some("Apply and drop".to_string()), None)
            .await
            .unwrap();

        // Apply with drop
        let result = apply_stash(repo.path_str(), 0, Some(true)).await;
        assert!(result.is_ok());

        // Stash should be gone
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert!(stashes.is_empty());
    }

    #[tokio::test]
    async fn test_pop_stash() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original");

        // Modify and stash
        repo.create_file("file.txt", "popped content");
        create_stash(repo.path_str(), Some("Pop test".to_string()), None)
            .await
            .unwrap();

        // Pop stash
        let result = pop_stash(repo.path_str(), 0).await;
        assert!(result.is_ok());

        // File should have stashed content
        let content = std::fs::read_to_string(repo.path.join("file.txt")).unwrap();
        assert_eq!(content, "popped content");

        // Stash should be gone (pop = apply + drop)
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert!(stashes.is_empty());
    }

    #[tokio::test]
    async fn test_pop_stash_conflict_retains_stash() {
        let repo = TestRepo::with_initial_commit();
        setup_tracked_file(&repo, "file.txt", "base");

        // Stash a modification; working tree reverts to "base".
        repo.create_file("file.txt", "stashed content");
        create_stash(repo.path_str(), Some("Conflicting".to_string()), None)
            .await
            .unwrap();

        // Commit a divergent change so applying the stash triggers a 3-way merge
        // conflict (working tree is clean, so stash_apply merges instead of
        // refusing). git_stash_apply returns success even with the conflict.
        repo.create_commit("Diverge", &[("file.txt", "committed change")]);

        let result = pop_stash(repo.path_str(), 0).await;
        assert!(
            matches!(result, Err(LeviathanError::MergeConflict)),
            "conflicted pop must return MergeConflict, got {:?}",
            result
        );

        // Stash must be retained (NOT dropped) on a conflicted pop.
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 1, "stash must survive a conflicted pop");

        // Index must reflect the conflict.
        let git_repo = git2::Repository::open(&repo.path).unwrap();
        assert!(git_repo.index().unwrap().has_conflicts());
    }

    #[tokio::test]
    async fn test_apply_stash_conflict_keeps_stash_even_with_drop() {
        let repo = TestRepo::with_initial_commit();
        setup_tracked_file(&repo, "file.txt", "base");

        repo.create_file("file.txt", "stashed content");
        create_stash(repo.path_str(), Some("Conflicting".to_string()), None)
            .await
            .unwrap();

        repo.create_commit("Diverge", &[("file.txt", "committed change")]);

        // Even with drop_after=true, a conflicted apply must NOT drop the stash.
        let result = apply_stash(repo.path_str(), 0, Some(true)).await;
        assert!(
            matches!(result, Err(LeviathanError::MergeConflict)),
            "conflicted apply must return MergeConflict, got {:?}",
            result
        );
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 1, "stash must survive a conflicted apply");
    }

    #[tokio::test]
    async fn test_multiple_stashes() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original");

        // Create first stash
        repo.create_file("file.txt", "first change");
        create_stash(repo.path_str(), Some("First".to_string()), None)
            .await
            .unwrap();

        // Create second stash
        repo.create_file("file.txt", "second change");
        create_stash(repo.path_str(), Some("Second".to_string()), None)
            .await
            .unwrap();

        // Should have 2 stashes, newest first
        let stashes = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(stashes.len(), 2);
        assert!(stashes[0].message.contains("Second")); // index 0 is newest
        assert!(stashes[1].message.contains("First")); // index 1 is older
    }

    #[tokio::test]
    async fn test_stash_show_basic() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "original content");

        // Modify and stash.
        //
        // The edit must change the file's SIZE. "modified content" is the same
        // 16 bytes as "original content", and the write lands in the same
        // timestamp granularity bucket as the index git just wrote — the
        // racily-clean case, where a same-size edit can be judged unchanged by
        // stat alone. The stash then captured nothing and this test failed on
        // `files.len()` with 0, on CI only and only sometimes.
        repo.create_file("file.txt", "modified content, now a different length");
        create_stash(repo.path_str(), Some("Show test".to_string()), None)
            .await
            .unwrap();

        // Show stash contents
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();
        assert_eq!(show.index, 0);
        assert!(show.message.contains("Show test"));
        assert_eq!(show.files.len(), 1);
        assert_eq!(show.files[0].path, "file.txt");
        assert_eq!(show.files[0].status, "modified");
        assert!(show.patch.is_none());
    }

    /// `index` is a position; the frontend resolves a stash by oid and then
    /// asks for that index, so the result has to say WHICH entry it describes
    /// or a concurrent create/drop can hand back a different stash's diff.
    #[tokio::test]
    async fn test_stash_show_echoes_the_requested_entrys_oid() {
        let repo = TestRepo::with_initial_commit();
        setup_tracked_file(&repo, "file.txt", "original content");

        // See test_stash_show_basic: the edit must change the file's SIZE.
        repo.create_file("file.txt", "first stash content, a different length");
        create_stash(repo.path_str(), Some("older".to_string()), None)
            .await
            .unwrap();

        repo.create_file("file.txt", "second stash content, longer again for stat");
        create_stash(repo.path_str(), Some("newer".to_string()), None)
            .await
            .unwrap();

        // get_stashes is what the frontend matches oids against, so the oid
        // stash_show reports must be the same one from the same listing.
        let listed = get_stashes(repo.path_str()).await.unwrap();
        assert_eq!(listed.len(), 2);

        for entry in &listed {
            let show = stash_show(repo.path_str(), entry.index as u32, Some(true), Some(false))
                .await
                .unwrap();
            assert_eq!(
                show.oid, entry.oid,
                "stash@{{{}}} reported a foreign oid",
                entry.index
            );
            assert_eq!(show.message, entry.message);
        }

        // And the two entries are genuinely distinct, so the check above is not
        // trivially satisfied by both rows carrying the same oid.
        assert_ne!(listed[0].oid, listed[1].oid);
    }

    #[tokio::test]
    async fn test_stash_show_with_patch() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "line1\nline2\nline3");

        // Modify and stash
        repo.create_file("file.txt", "line1\nmodified\nline3");
        create_stash(repo.path_str(), Some("Patch test".to_string()), None)
            .await
            .unwrap();

        // Show stash with patch
        let result = stash_show(repo.path_str(), 0, Some(true), Some(true)).await;
        assert!(result.is_ok());
        let show = result.unwrap();
        assert!(show.patch.is_some());
        let patch = show.patch.unwrap();
        assert!(patch.contains("-line2"));
        assert!(patch.contains("+modified"));
    }

    #[tokio::test]
    async fn test_stash_show_multiple_files() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit multiple files
        setup_tracked_file(&repo, "file1.txt", "content1");
        setup_tracked_file(&repo, "file2.txt", "content2");

        // Modify both files and stash
        repo.create_file("file1.txt", "modified1");
        repo.create_file("file2.txt", "modified2");
        create_stash(repo.path_str(), Some("Multi file".to_string()), None)
            .await
            .unwrap();

        // Show stash
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();
        assert_eq!(show.files.len(), 2);

        // Both files should be present
        let paths: Vec<&str> = show.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"file1.txt"));
        assert!(paths.contains(&"file2.txt"));
    }

    #[tokio::test]
    async fn test_stash_show_invalid_index() {
        let repo = TestRepo::with_initial_commit();
        // Try to show non-existent stash
        let result = stash_show(repo.path_str(), 999, Some(true), Some(false)).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_stash_show_additions_deletions() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "file.txt", "line1\nline2\nline3\nline4");

        // Modify: remove line2, add two new lines
        repo.create_file("file.txt", "line1\nnew1\nnew2\nline3\nline4");
        create_stash(repo.path_str(), Some("Stats test".to_string()), None)
            .await
            .unwrap();

        // Show stash
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();

        // Check total stats
        assert!(show.total_additions > 0);
        assert!(show.total_deletions > 0);

        // Check file stats
        assert_eq!(show.files.len(), 1);
        assert!(show.files[0].additions > 0);
        assert!(show.files[0].deletions > 0);
    }

    #[tokio::test]
    async fn test_stash_show_staged_new_file() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "existing.txt", "content");

        // Create a new file and stage it
        repo.create_file("new_file.txt", "new content");
        repo.stage_file("new_file.txt");

        // Stash the staged new file
        create_stash(repo.path_str(), Some("New file stash".to_string()), None)
            .await
            .unwrap();

        // Show stash
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();

        // Should have the new file
        let new_file = show.files.iter().find(|f| f.path == "new_file.txt");
        assert!(new_file.is_some());
        assert_eq!(new_file.unwrap().status, "added");
    }

    #[tokio::test]
    async fn test_stash_show_deleted_file() {
        let repo = TestRepo::with_initial_commit();
        // Create and commit a tracked file
        setup_tracked_file(&repo, "to_delete.txt", "content");

        // Delete the file and stage the deletion
        std::fs::remove_file(repo.path.join("to_delete.txt")).unwrap();
        let git_repo = git2::Repository::open(&repo.path).unwrap();
        let mut index = git_repo.index().unwrap();
        index
            .remove_path(std::path::Path::new("to_delete.txt"))
            .unwrap();
        index.write().unwrap();

        // Stash the deletion
        create_stash(repo.path_str(), Some("Delete file stash".to_string()), None)
            .await
            .unwrap();

        // Show stash
        let result = stash_show(repo.path_str(), 0, Some(true), Some(false)).await;
        assert!(result.is_ok());
        let show = result.unwrap();

        // Should have the deleted file
        let deleted_file = show.files.iter().find(|f| f.path == "to_delete.txt");
        assert!(deleted_file.is_some());
        assert_eq!(deleted_file.unwrap().status, "deleted");
    }

    #[tokio::test]
    async fn test_stash_show_includes_untracked_only_stash() {
        let repo = TestRepo::with_initial_commit();

        // Nothing tracked changed — the whole stash is one untracked file, which
        // lives in the stash commit's THIRD parent, not the base→stash diff.
        repo.create_file("scratch.txt", "notes that live only in the working tree\n");
        create_stash(repo.path_str(), Some("Untracked".to_string()), Some(true))
            .await
            .unwrap();

        let show = stash_show(repo.path_str(), 0, Some(true), Some(false))
            .await
            .unwrap();

        assert_eq!(
            show.files.len(),
            1,
            "an untracked-only stash must not preview as empty"
        );
        assert_eq!(show.files[0].path, "scratch.txt");
        assert_eq!(show.files[0].status, "added");
        assert!(show.total_additions > 0);
    }

    #[tokio::test]
    async fn test_stash_show_lists_untracked_alongside_tracked() {
        let repo = TestRepo::with_initial_commit();
        setup_tracked_file(&repo, "tracked.txt", "original content");

        // The edit must change the file's SIZE — see test_stash_show_basic.
        repo.create_file("tracked.txt", "changed content, at a different length now");
        repo.create_file("untracked.txt", "brand new\n");
        create_stash(repo.path_str(), Some("Both halves".to_string()), Some(true))
            .await
            .unwrap();

        let show = stash_show(repo.path_str(), 0, Some(true), Some(false))
            .await
            .unwrap();

        let paths: Vec<&str> = show.files.iter().map(|f| f.path.as_str()).collect();
        assert!(
            paths.contains(&"untracked.txt"),
            "untracked half of the stash must be listed, got {:?}",
            paths
        );
        assert!(
            paths.contains(&"tracked.txt"),
            "tracked half of the stash must still be listed, got {:?}",
            paths
        );
    }

    #[tokio::test]
    async fn test_stash_show_patch_includes_untracked() {
        let repo = TestRepo::with_initial_commit();
        setup_tracked_file(&repo, "tracked.txt", "original content");

        repo.create_file("tracked.txt", "changed content, at a different length now");
        repo.create_file("untracked.txt", "brand new\n");
        create_stash(repo.path_str(), Some("Both halves".to_string()), Some(true))
            .await
            .unwrap();

        let show = stash_show(repo.path_str(), 0, Some(true), Some(true))
            .await
            .unwrap();

        let patch = show.patch.expect("patch was requested");
        assert!(
            patch.contains("brand new"),
            "patch must cover the untracked half, got:\n{}",
            patch
        );
    }
}
