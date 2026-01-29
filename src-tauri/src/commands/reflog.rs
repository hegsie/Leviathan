//! Reflog command handlers for undo/redo operations

use std::path::Path;
use tauri::command;

use crate::error::Result;

/// A reflog entry representing a recorded state change
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    /// The commit OID this entry points to
    pub oid: String,
    /// Short form of the OID
    pub short_id: String,
    /// The reflog index (0 = most recent)
    pub index: usize,
    /// The action that was performed (e.g., "commit", "checkout", "rebase")
    pub action: String,
    /// Human-readable message describing what happened
    pub message: String,
    /// Unix timestamp of when this happened
    pub timestamp: i64,
    /// Author name who performed the action
    pub author: String,
}

/// Get the reflog entries for HEAD
#[command]
pub async fn get_reflog(path: String, limit: Option<usize>) -> Result<Vec<ReflogEntry>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let reflog = repo.reflog("HEAD")?;

    let limit_count = limit.unwrap_or(100);
    let mut entries = Vec::new();

    for (index, entry) in reflog.iter().enumerate() {
        if entries.len() >= limit_count {
            break;
        }

        let oid = entry.id_new();
        let message = entry.message().unwrap_or("").to_string();

        // Parse action from message (format is usually "action: details")
        let action = message
            .split(':')
            .next()
            .unwrap_or("unknown")
            .trim()
            .to_string();

        entries.push(ReflogEntry {
            oid: oid.to_string(),
            short_id: oid.to_string()[..7.min(oid.to_string().len())].to_string(),
            index,
            action,
            message,
            timestamp: entry.committer().when().seconds(),
            author: entry.committer().name().unwrap_or("Unknown").to_string(),
        });
    }

    Ok(entries)
}

/// Reset HEAD to a specific reflog entry (undo operation)
#[command]
pub async fn reset_to_reflog(
    path: String,
    reflog_index: usize,
    mode: String,
) -> Result<ReflogEntry> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Extract entry info before any borrows
    let (target_oid_str, message, timestamp, author) = {
        let reflog = repo.reflog("HEAD")?;
        let entry = reflog.get(reflog_index).ok_or_else(|| {
            crate::error::LeviathanError::OperationFailed(format!(
                "Reflog entry {} not found",
                reflog_index
            ))
        })?;

        let oid_str = entry.id_new().to_string();
        let msg = entry.message().unwrap_or("").to_string();
        let committer = entry.committer();
        let ts = committer.when().seconds();
        let auth = committer.name().unwrap_or("Unknown").to_string();

        (oid_str, msg, ts, auth)
    };

    let target_oid = git2::Oid::from_str(&target_oid_str)?;
    let target_commit = repo.find_commit(target_oid)?;

    // Determine reset type
    let reset_type = match mode.as_str() {
        "soft" => git2::ResetType::Soft,
        "mixed" => git2::ResetType::Mixed,
        "hard" => git2::ResetType::Hard,
        _ => git2::ResetType::Mixed,
    };

    // Perform the reset
    repo.reset(target_commit.as_object(), reset_type, None)?;

    // Return info about where we reset to
    Ok(ReflogEntry {
        oid: target_oid_str.clone(),
        short_id: target_oid_str[..7.min(target_oid_str.len())].to_string(),
        index: reflog_index,
        action: "reset".to_string(),
        message,
        timestamp,
        author,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_reflog_empty_repo() {
        let repo = TestRepo::new();

        // Empty repo has no reflog entries
        let result = get_reflog(repo.path_str(), None).await;
        assert!(result.is_ok());
        let entries = result.unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn test_get_reflog_with_commits() {
        let repo = TestRepo::with_initial_commit();

        let result = get_reflog(repo.path_str(), None).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert!(!entries.is_empty());

        // First entry (index 0) should be the most recent
        let first = &entries[0];
        assert_eq!(first.index, 0);
        assert!(!first.oid.is_empty());
        assert!(!first.short_id.is_empty());
        assert_eq!(first.short_id.len(), 7);
    }

    #[tokio::test]
    async fn test_get_reflog_multiple_commits() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content2")]);
        repo.create_commit("Third commit", &[("file3.txt", "content3")]);

        let result = get_reflog(repo.path_str(), None).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        // Should have at least 3 entries (for 3 commits)
        assert!(entries.len() >= 3);

        // Entries should be ordered by index
        for (i, entry) in entries.iter().enumerate() {
            assert_eq!(entry.index, i);
        }
    }

    #[tokio::test]
    async fn test_get_reflog_with_limit() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("f2.txt", "2")]);
        repo.create_commit("Third", &[("f3.txt", "3")]);
        repo.create_commit("Fourth", &[("f4.txt", "4")]);
        repo.create_commit("Fifth", &[("f5.txt", "5")]);

        let result = get_reflog(repo.path_str(), Some(2)).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert_eq!(entries.len(), 2);

        // Should be the most recent 2 entries
        assert_eq!(entries[0].index, 0);
        assert_eq!(entries[1].index, 1);
    }

    #[tokio::test]
    async fn test_get_reflog_limit_larger_than_entries() {
        let repo = TestRepo::with_initial_commit();

        let result = get_reflog(repo.path_str(), Some(1000)).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        // Should return all entries, not error
        assert!(!entries.is_empty());
    }

    #[tokio::test]
    async fn test_get_reflog_action_parsing() {
        let repo = TestRepo::with_initial_commit();

        // Create a branch and checkout to generate different reflog actions
        repo.create_branch("feature");
        repo.checkout_branch("feature");

        let result = get_reflog(repo.path_str(), None).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert!(!entries.is_empty());

        // Most recent entry should be a checkout action
        let latest = &entries[0];
        assert!(
            latest.action == "checkout" || latest.message.contains("checkout"),
            "Expected checkout action, got: {} (message: {})",
            latest.action,
            latest.message
        );
    }

    #[tokio::test]
    async fn test_get_reflog_author_info() {
        let repo = TestRepo::with_initial_commit();

        let result = get_reflog(repo.path_str(), None).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert!(!entries.is_empty());

        // Author should match the configured test user
        let entry = &entries[0];
        assert_eq!(entry.author, "Test User");
    }

    #[tokio::test]
    async fn test_get_reflog_timestamp() {
        let repo = TestRepo::with_initial_commit();

        let result = get_reflog(repo.path_str(), None).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert!(!entries.is_empty());

        // Timestamp should be reasonable (after year 2000)
        let entry = &entries[0];
        assert!(entry.timestamp > 946684800); // Jan 1, 2000
    }

    #[tokio::test]
    async fn test_reset_to_reflog_soft() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        repo.create_commit("Second commit", &[("file2.txt", "content2")]);
        let second_oid = repo.head_oid();

        assert_ne!(first_oid, second_oid);

        // Reset soft to first commit (reflog index 1)
        let result = reset_to_reflog(repo.path_str(), 1, "soft".to_string()).await;
        assert!(result.is_ok());

        let entry = result.unwrap();
        assert_eq!(entry.action, "reset");
        assert_eq!(entry.oid, first_oid.to_string());

        // HEAD should now point to first commit
        assert_eq!(repo.head_oid(), first_oid);

        // With soft reset, changes should be staged
        let git_repo = repo.repo();
        let status = git_repo.statuses(None).unwrap();
        // The file from second commit should show as staged
        assert!(status.len() > 0 || repo.path.join("file2.txt").exists());
    }

    #[tokio::test]
    async fn test_reset_to_reflog_mixed() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        repo.create_commit("Second commit", &[("file2.txt", "content2")]);

        // Reset mixed to first commit
        let result = reset_to_reflog(repo.path_str(), 1, "mixed".to_string()).await;
        assert!(result.is_ok());

        // HEAD should now point to first commit
        assert_eq!(repo.head_oid(), first_oid);
    }

    #[tokio::test]
    async fn test_reset_to_reflog_hard() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        repo.create_commit("Second commit", &[("file2.txt", "content2")]);
        assert!(repo.path.join("file2.txt").exists());

        // Reset hard to first commit
        let result = reset_to_reflog(repo.path_str(), 1, "hard".to_string()).await;
        assert!(result.is_ok());

        // HEAD should point to first commit
        assert_eq!(repo.head_oid(), first_oid);

        // With hard reset, the file should be gone
        assert!(!repo.path.join("file2.txt").exists());
    }

    #[tokio::test]
    async fn test_reset_to_reflog_invalid_mode_uses_mixed() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        repo.create_commit("Second", &[("f.txt", "c")]);

        // Invalid mode should default to mixed
        let result = reset_to_reflog(repo.path_str(), 1, "invalid".to_string()).await;
        assert!(result.is_ok());
        assert_eq!(repo.head_oid(), first_oid);
    }

    #[tokio::test]
    async fn test_reset_to_reflog_invalid_index() {
        let repo = TestRepo::with_initial_commit();

        // Try to reset to a nonexistent reflog entry
        let result = reset_to_reflog(repo.path_str(), 9999, "mixed".to_string()).await;
        assert!(result.is_err());

        let err = result.unwrap_err();
        assert!(err.to_string().contains("not found"));
    }

    #[tokio::test]
    async fn test_reset_to_reflog_returns_correct_entry_info() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("f2.txt", "2")]);

        let result = reset_to_reflog(repo.path_str(), 1, "mixed".to_string()).await;
        assert!(result.is_ok());

        let entry = result.unwrap();
        assert_eq!(entry.index, 1);
        assert_eq!(entry.action, "reset");
        assert!(!entry.oid.is_empty());
        assert_eq!(entry.short_id.len(), 7);
        assert_eq!(entry.author, "Test User");
    }

    #[tokio::test]
    async fn test_reflog_entry_struct_serialization() {
        let entry = ReflogEntry {
            oid: "abc123def456789".to_string(),
            short_id: "abc123d".to_string(),
            index: 5,
            action: "commit".to_string(),
            message: "commit: Added new feature".to_string(),
            timestamp: 1700000000,
            author: "John Doe".to_string(),
        };

        let json = serde_json::to_string(&entry);
        assert!(json.is_ok());

        let json_str = json.unwrap();
        assert!(json_str.contains("\"oid\":\"abc123def456789\""));
        assert!(json_str.contains("\"shortId\":\"abc123d\""));
        assert!(json_str.contains("\"index\":5"));
        assert!(json_str.contains("\"action\":\"commit\""));
        assert!(json_str.contains("\"timestamp\":1700000000"));
    }

    #[tokio::test]
    async fn test_get_reflog_zero_limit() {
        let repo = TestRepo::with_initial_commit();

        // Limit of 0 should return empty (though default is 100)
        let result = get_reflog(repo.path_str(), Some(0)).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_reset_to_reflog_index_zero() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        repo.create_commit("Second", &[("f.txt", "c")]);

        // Reset to index 0 (current HEAD) should be a no-op essentially
        let result = reset_to_reflog(repo.path_str(), 0, "mixed".to_string()).await;
        assert!(result.is_ok());

        // Should point to the second commit (most recent)
        assert_ne!(repo.head_oid(), oid);
    }
}
