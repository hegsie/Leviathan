//! Patch command handlers
//! Create and apply patch files

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Create a patch from commits
#[command]
pub async fn create_patch(
    path: String,
    commit_oids: Vec<String>,
    output_path: String,
) -> Result<Vec<String>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut patch_files = Vec::new();

    for (i, oid_str) in commit_oids.iter().enumerate() {
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|_| LeviathanError::CommitNotFound(oid_str.clone()))?;
        let commit = repo.find_commit(oid)?;

        // Get the diff for this commit
        let parent = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };

        let diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&commit.tree()?), None)?;

        // Format patch
        let mut patch_content = String::new();

        // Email header format
        let sig = commit.author();
        let time = commit.time();
        let message = commit.message().unwrap_or("");

        // RFC 2822 date format
        let epoch = time.seconds();
        let offset = time.offset_minutes();
        let offset_hours = offset / 60;
        let offset_mins = (offset % 60).abs();
        let sign = if offset >= 0 { "+" } else { "-" };

        patch_content.push_str(&format!("From {} Mon Sep 17 00:00:00 2001\n", oid_str));
        patch_content.push_str(&format!(
            "From: {} <{}>\n",
            sig.name().unwrap_or("Unknown"),
            sig.email().unwrap_or("unknown@unknown.com")
        ));
        patch_content.push_str(&format!(
            "Date: {}{}{:02}{:02}\n",
            epoch,
            sign,
            offset_hours.abs(),
            offset_mins
        ));

        // Subject from first line of message
        let first_line = message.lines().next().unwrap_or("");
        patch_content.push_str(&format!(
            "Subject: [PATCH {}/{}] {}\n\n",
            i + 1,
            commit_oids.len(),
            first_line
        ));

        // Remaining message lines
        let remaining: Vec<&str> = message.lines().skip(1).collect();
        if !remaining.is_empty() {
            for line in &remaining {
                patch_content.push_str(line);
                patch_content.push('\n');
            }
            patch_content.push('\n');
        }

        patch_content.push_str("---\n");

        // Diff stats
        let stats = diff.stats()?;
        let stats_buf = stats.to_buf(git2::DiffStatsFormat::FULL, 80)?;
        patch_content.push_str(stats_buf.as_str().unwrap_or(""));
        patch_content.push('\n');

        // Actual diff
        diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
            let origin = line.origin();
            if origin == '+' || origin == '-' || origin == ' ' {
                patch_content.push(origin);
            }
            if let Ok(content) = std::str::from_utf8(line.content()) {
                patch_content.push_str(content);
            }
            true
        })?;

        patch_content.push_str("\n-- \n");

        // Write patch file
        let short_id = &oid_str[..8.min(oid_str.len())];
        let sanitized_subject = first_line
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let filename = format!("{:04}-{}-{}.patch", i + 1, short_id, sanitized_subject);
        let patch_path = Path::new(&output_path).join(&filename);

        if let Some(parent_dir) = patch_path.parent() {
            std::fs::create_dir_all(parent_dir)?;
        }
        std::fs::write(&patch_path, &patch_content)?;
        patch_files.push(patch_path.to_string_lossy().to_string());
    }

    Ok(patch_files)
}

/// Apply a patch file to the working directory
#[command]
pub async fn apply_patch(path: String, patch_path: String, check_only: Option<bool>) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let patch_content = std::fs::read(&patch_path)?;

    let diff = git2::Diff::from_buffer(&patch_content)?;

    if check_only.unwrap_or(false) {
        // Dry run - just check if patch applies cleanly
        repo.apply(&diff, git2::ApplyLocation::WorkDir, None)
            .map_err(|e| {
                LeviathanError::OperationFailed(format!("Patch would not apply cleanly: {}", e))
            })?;
    } else {
        repo.apply(&diff, git2::ApplyLocation::WorkDir, None)?;
    }

    Ok(())
}

/// Apply a patch to the index (staging area)
#[command]
pub async fn apply_patch_to_index(path: String, patch_path: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let patch_content = std::fs::read(&patch_path)?;

    let diff = git2::Diff::from_buffer(&patch_content)?;
    repo.apply(&diff, git2::ApplyLocation::Index, None)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_create_patch_single_commit() {
        let test_repo = TestRepo::with_initial_commit();
        let oid = test_repo.create_commit("Add feature", &[("feature.txt", "feature content")]);

        let output_dir = test_repo.path.join("patches");
        std::fs::create_dir_all(&output_dir).unwrap();

        let result = create_patch(
            test_repo.path_str(),
            vec![oid.to_string()],
            output_dir.to_string_lossy().to_string(),
        )
        .await;

        assert!(result.is_ok());
        let files = result.unwrap();
        assert_eq!(files.len(), 1);
        assert!(Path::new(&files[0]).exists());
    }

    #[tokio::test]
    async fn test_create_patch_multiple_commits() {
        let test_repo = TestRepo::with_initial_commit();
        let oid1 = test_repo.create_commit("First change", &[("file1.txt", "content1")]);
        let oid2 = test_repo.create_commit("Second change", &[("file2.txt", "content2")]);

        let output_dir = test_repo.path.join("patches");
        std::fs::create_dir_all(&output_dir).unwrap();

        let result = create_patch(
            test_repo.path_str(),
            vec![oid1.to_string(), oid2.to_string()],
            output_dir.to_string_lossy().to_string(),
        )
        .await;

        assert!(result.is_ok());
        let files = result.unwrap();
        assert_eq!(files.len(), 2);
    }

    #[tokio::test]
    async fn test_create_and_apply_patch() {
        // Create a repo with a commit
        let source_repo = TestRepo::with_initial_commit();
        let oid = source_repo.create_commit("Add file", &[("new.txt", "hello world")]);

        let output_dir = source_repo.path.join("patches");
        std::fs::create_dir_all(&output_dir).unwrap();

        let files = create_patch(
            source_repo.path_str(),
            vec![oid.to_string()],
            output_dir.to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        // Apply to a different repo
        let target_repo = TestRepo::with_initial_commit();
        let result = apply_patch(target_repo.path_str(), files[0].clone(), None).await;

        assert!(result.is_ok());

        // Verify the file exists in the target
        let target_file = target_repo.path.join("new.txt");
        assert!(target_file.exists());
    }

    #[tokio::test]
    async fn test_apply_patch_check_only() {
        let source_repo = TestRepo::with_initial_commit();
        let oid = source_repo.create_commit("Add file", &[("check.txt", "check content")]);

        let output_dir = source_repo.path.join("patches");
        std::fs::create_dir_all(&output_dir).unwrap();

        let files = create_patch(
            source_repo.path_str(),
            vec![oid.to_string()],
            output_dir.to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        let target_repo = TestRepo::with_initial_commit();
        let result = apply_patch(
            target_repo.path_str(),
            files[0].clone(),
            Some(true), // Check only
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_create_patch_invalid_commit() {
        let test_repo = TestRepo::with_initial_commit();
        let output_dir = test_repo.path.join("patches");
        std::fs::create_dir_all(&output_dir).unwrap();

        let result = create_patch(
            test_repo.path_str(),
            vec!["0000000000000000000000000000000000000000".to_string()],
            output_dir.to_string_lossy().to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_apply_patch_to_index() {
        let source_repo = TestRepo::with_initial_commit();
        let oid = source_repo.create_commit("Add file", &[("indexed.txt", "indexed content")]);

        let output_dir = source_repo.path.join("patches");
        std::fs::create_dir_all(&output_dir).unwrap();

        let files = create_patch(
            source_repo.path_str(),
            vec![oid.to_string()],
            output_dir.to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        let target_repo = TestRepo::with_initial_commit();
        let result = apply_patch_to_index(target_repo.path_str(), files[0].clone()).await;

        assert!(result.is_ok());
    }
}
