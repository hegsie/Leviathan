//! Undo/redo history tracking commands
//!
//! Provides GitKraken-style undo/redo by using the git reflog as a backing store.
//! Actions are parsed from reflog entries and can be undone/redone via reset operations.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::error::Result;

/// Represents a single undoable git action parsed from the reflog
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoAction {
    /// The type of action: "commit", "checkout", "merge", "rebase", "reset", "stash", "branch_delete", "pull", "cherry_pick", "revert", "amend"
    pub action_type: String,
    /// Human-readable description of what happened
    pub description: String,
    /// Unix timestamp of when this action occurred
    pub timestamp: i64,
    /// The ref (OID) state before this action
    pub before_ref: String,
    /// The ref (OID) state after this action
    pub after_ref: String,
    /// Optional JSON string with additional details
    pub details: Option<String>,
}

/// The full undo/redo history state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoHistory {
    /// List of undoable actions, newest first
    pub actions: Vec<UndoAction>,
    /// Current position in the undo stack (-1 means at latest state)
    pub current_index: i32,
    /// Whether there is an action that can be undone
    pub can_undo: bool,
    /// Whether there is an action that can be redone
    pub can_redo: bool,
}

/// Parse a reflog message into an action type and human-readable description
fn parse_reflog_action(message: &str) -> (String, String) {
    // Reflog messages follow the format "action: details"
    // e.g. "commit: Add new feature"
    //      "checkout: moving from main to feature"
    //      "merge feature: Fast-forward"
    //      "rebase (finish): refs/heads/main onto abc123"
    //      "reset: moving to HEAD~1"
    //      "pull: Fast-forward"
    //      "cherry-pick: Added feature X"
    //      "revert: Revert \"Some commit\""
    //      "commit (amend): Updated message"
    //      "commit (initial): Initial commit"

    let lower = message.to_lowercase();

    if lower.starts_with("commit (amend)") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Amended commit");
        return ("amend".to_string(), format!("Amend commit: {}", desc));
    }

    if lower.starts_with("commit (initial)") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Initial commit");
        return ("commit".to_string(), format!("Initial commit: {}", desc));
    }

    if lower.starts_with("commit") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Commit");
        return ("commit".to_string(), format!("Commit: {}", desc));
    }

    if lower.starts_with("checkout") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Checkout");
        return ("checkout".to_string(), format!("Checkout: {}", desc));
    }

    if lower.starts_with("merge") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Merge");
        return ("merge".to_string(), format!("Merge: {}", desc));
    }

    if lower.starts_with("rebase") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Rebase");
        return ("rebase".to_string(), format!("Rebase: {}", desc));
    }

    if lower.starts_with("reset") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Reset");
        return ("reset".to_string(), format!("Reset: {}", desc));
    }

    if lower.starts_with("pull") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Pull");
        return ("pull".to_string(), format!("Pull: {}", desc));
    }

    if lower.starts_with("cherry-pick") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Cherry-pick");
        return ("cherry_pick".to_string(), format!("Cherry-pick: {}", desc));
    }

    if lower.starts_with("revert") {
        let desc = message
            .split_once(':')
            .map(|x| x.1.trim())
            .unwrap_or("Revert");
        return ("revert".to_string(), format!("Revert: {}", desc));
    }

    // Branch delete is not in reflog directly, but we handle it for record_action
    if lower.starts_with("branch") {
        return ("branch_delete".to_string(), message.to_string());
    }

    // Fallback: use the raw message
    let action = message
        .split(':')
        .next()
        .unwrap_or("unknown")
        .trim()
        .to_lowercase();
    (action, message.to_string())
}

/// Find the current undo position by scanning the reflog for the most recent
/// reset that was performed as an undo/redo operation.
/// Returns the index in the actions list that represents the current state.
/// -1 means we're at the latest state (no undo has been performed).
fn find_current_index(actions: &[UndoAction]) -> i32 {
    // The current index is always -1 (at latest) because the reflog
    // itself records undo operations as new entries. Each undo/redo
    // creates a new reflog entry, so the "current" state is always the top.
    // The UI can track undo position separately if needed.
    if actions.is_empty() {
        return -1;
    }
    -1
}

/// Get the undo/redo history for a repository by parsing the reflog
#[command]
pub async fn get_undo_history(path: String, max_count: Option<u32>) -> Result<UndoHistory> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let reflog = repo.reflog("HEAD")?;

    let limit = max_count.unwrap_or(50) as usize;
    let mut actions = Vec::new();

    for (index, entry) in reflog.iter().enumerate() {
        if actions.len() >= limit {
            break;
        }

        let message = entry.message().unwrap_or("").to_string();
        let (action_type, description) = parse_reflog_action(&message);

        let after_ref = entry.id_new().to_string();
        let before_ref = entry.id_old().to_string();
        let timestamp = entry.committer().when().seconds();

        // Build details JSON with extra context
        let details = serde_json::json!({
            "reflogIndex": index,
            "rawMessage": message,
            "author": entry.committer().name().unwrap_or("Unknown"),
        });

        actions.push(UndoAction {
            action_type,
            description,
            timestamp,
            before_ref,
            after_ref,
            details: Some(details.to_string()),
        });
    }

    let current_index = find_current_index(&actions);

    // can_undo: there is at least one action to undo (go back in history)
    let can_undo = !actions.is_empty();
    // can_redo: only meaningful when tracking undo position client-side
    let can_redo = false;

    Ok(UndoHistory {
        actions,
        current_index,
        can_undo,
        can_redo,
    })
}

/// Undo the last action by resetting HEAD to the previous reflog state
#[command]
pub async fn undo_last_action(path: String) -> Result<UndoAction> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Get the reflog to find the previous state
    let (before_oid_str, target_oid_str, message, timestamp, author) = {
        let reflog = repo.reflog("HEAD")?;

        // We need at least 2 entries to undo (current + previous)
        if reflog.len() < 2 {
            return Err(crate::error::LeviathanError::OperationFailed(
                "Nothing to undo: not enough reflog history".to_string(),
            ));
        }

        // Entry 0 is the current state, entry 1 is the state before
        let current_entry = reflog.get(0).ok_or_else(|| {
            crate::error::LeviathanError::OperationFailed(
                "Failed to read current reflog entry".to_string(),
            )
        })?;

        let previous_entry = reflog.get(1).ok_or_else(|| {
            crate::error::LeviathanError::OperationFailed(
                "Failed to read previous reflog entry".to_string(),
            )
        })?;

        let current_oid = current_entry.id_new().to_string();
        let target_oid = previous_entry.id_new().to_string();
        let msg = current_entry.message().unwrap_or("").to_string();
        let ts = current_entry.committer().when().seconds();
        let auth = current_entry
            .committer()
            .name()
            .unwrap_or("Unknown")
            .to_string();

        (current_oid, target_oid, msg, ts, auth)
    };

    // Parse the action we're undoing
    let (action_type, description) = parse_reflog_action(&message);

    // Perform a mixed reset to the previous state
    let target_oid = git2::Oid::from_str(&target_oid_str)?;
    let target_commit = repo.find_commit(target_oid)?;
    repo.reset(target_commit.as_object(), git2::ResetType::Mixed, None)?;

    let details = serde_json::json!({
        "undoneAction": action_type,
        "undoneDescription": description,
        "author": author,
    });

    Ok(UndoAction {
        action_type: "undo".to_string(),
        description: format!("Undo: {}", description),
        timestamp,
        before_ref: before_oid_str,
        after_ref: target_oid_str,
        details: Some(details.to_string()),
    })
}

/// Redo the last undone action by moving HEAD forward in the reflog
#[command]
pub async fn redo_last_action(path: String) -> Result<UndoAction> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // To redo, we look for the reflog entry that was created by our undo
    // (which is a reset). The entry before that reset is our redo target.
    let (before_oid_str, target_oid_str, timestamp, author) = {
        let reflog = repo.reflog("HEAD")?;

        if reflog.len() < 2 {
            return Err(crate::error::LeviathanError::OperationFailed(
                "Nothing to redo: not enough reflog history".to_string(),
            ));
        }

        // The most recent entry (index 0) should be the reset from an undo.
        // Its id_old (before_ref) is the state we want to redo to.
        let current_entry = reflog.get(0).ok_or_else(|| {
            crate::error::LeviathanError::OperationFailed(
                "Failed to read current reflog entry".to_string(),
            )
        })?;

        let msg = current_entry.message().unwrap_or("").to_string();
        if !msg.to_lowercase().contains("reset") {
            return Err(crate::error::LeviathanError::OperationFailed(
                "Nothing to redo: last action was not an undo".to_string(),
            ));
        }

        // The old id of the current entry is where we were before the undo
        let current_oid = current_entry.id_new().to_string();
        let redo_target = current_entry.id_old().to_string();
        let ts = current_entry.committer().when().seconds();
        let auth = current_entry
            .committer()
            .name()
            .unwrap_or("Unknown")
            .to_string();

        (current_oid, redo_target, ts, auth)
    };

    // Perform a mixed reset to the redo target
    let target_oid = git2::Oid::from_str(&target_oid_str)?;
    let target_commit = repo.find_commit(target_oid)?;
    repo.reset(target_commit.as_object(), git2::ResetType::Mixed, None)?;

    let details = serde_json::json!({
        "author": author,
    });

    Ok(UndoAction {
        action_type: "redo".to_string(),
        description: "Redo: restored previous state".to_string(),
        timestamp,
        before_ref: before_oid_str,
        after_ref: target_oid_str,
        details: Some(details.to_string()),
    })
}

/// Record a custom action to the undo history.
/// This writes a synthetic reflog entry that can be used for undo/redo tracking.
#[command]
pub async fn record_action(path: String, action: UndoAction) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Write a reflog entry for the current HEAD with the action description
    let head_ref = repo.head()?;
    let head_oid = head_ref.target().ok_or_else(|| {
        crate::error::LeviathanError::OperationFailed(
            "HEAD does not point to a valid commit".to_string(),
        )
    })?;

    let sig = repo.signature()?;
    let reflog_message = format!("{}: {}", action.action_type, action.description);

    // Append to the HEAD reflog
    let mut reflog = repo.reflog("HEAD")?;
    reflog.append(head_oid, &sig, Some(&reflog_message))?;
    reflog.write()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_undo_history_empty_repo() {
        let repo = TestRepo::new();

        let result = get_undo_history(repo.path_str(), None).await;
        assert!(result.is_ok());

        let history = result.unwrap();
        assert!(history.actions.is_empty());
        assert_eq!(history.current_index, -1);
        assert!(!history.can_undo);
        assert!(!history.can_redo);
    }

    #[tokio::test]
    async fn test_get_undo_history_with_commits() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content2")]);

        let result = get_undo_history(repo.path_str(), None).await;
        assert!(result.is_ok());

        let history = result.unwrap();
        assert!(!history.actions.is_empty());
        assert!(history.can_undo);
        assert_eq!(history.current_index, -1);

        // Most recent action should be a commit
        let latest = &history.actions[0];
        assert_eq!(latest.action_type, "commit");
        assert!(latest.description.contains("Second commit"));
    }

    #[tokio::test]
    async fn test_get_undo_history_with_max_count() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("f2.txt", "2")]);
        repo.create_commit("Third", &[("f3.txt", "3")]);
        repo.create_commit("Fourth", &[("f4.txt", "4")]);
        repo.create_commit("Fifth", &[("f5.txt", "5")]);

        let result = get_undo_history(repo.path_str(), Some(2)).await;
        assert!(result.is_ok());

        let history = result.unwrap();
        assert_eq!(history.actions.len(), 2);
    }

    #[tokio::test]
    async fn test_get_undo_history_default_limit() {
        let repo = TestRepo::with_initial_commit();

        let result = get_undo_history(repo.path_str(), None).await;
        assert!(result.is_ok());
        // Default limit is 50, should not exceed it
        assert!(result.unwrap().actions.len() <= 50);
    }

    #[tokio::test]
    async fn test_get_undo_history_action_types() {
        let repo = TestRepo::with_initial_commit();

        // Create various operations to generate different reflog entries
        repo.create_commit("Feature commit", &[("feature.txt", "feature")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");

        let result = get_undo_history(repo.path_str(), None).await;
        assert!(result.is_ok());

        let history = result.unwrap();
        assert!(history.actions.len() >= 2);

        // Most recent should be a checkout
        let latest = &history.actions[0];
        assert_eq!(latest.action_type, "checkout");
    }

    #[tokio::test]
    async fn test_get_undo_history_has_timestamps() {
        let repo = TestRepo::with_initial_commit();

        let result = get_undo_history(repo.path_str(), None).await;
        assert!(result.is_ok());

        let history = result.unwrap();
        for action in &history.actions {
            // Timestamp should be after year 2000
            assert!(action.timestamp > 946684800);
        }
    }

    #[tokio::test]
    async fn test_get_undo_history_has_refs() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("f.txt", "c")]);

        let result = get_undo_history(repo.path_str(), None).await;
        assert!(result.is_ok());

        let history = result.unwrap();
        for action in &history.actions {
            assert!(!action.after_ref.is_empty());
            // before_ref can be all-zeros for the first entry
        }
    }

    #[tokio::test]
    async fn test_get_undo_history_has_details() {
        let repo = TestRepo::with_initial_commit();

        let result = get_undo_history(repo.path_str(), None).await;
        assert!(result.is_ok());

        let history = result.unwrap();
        for action in &history.actions {
            assert!(action.details.is_some());
            let details: serde_json::Value =
                serde_json::from_str(action.details.as_ref().unwrap()).unwrap();
            assert!(details.get("reflogIndex").is_some());
            assert!(details.get("rawMessage").is_some());
            assert!(details.get("author").is_some());
        }
    }

    #[tokio::test]
    async fn test_undo_last_action() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        repo.create_commit("Second commit", &[("file2.txt", "content2")]);
        let second_oid = repo.head_oid();
        assert_ne!(first_oid, second_oid);

        // Undo the last action (the second commit)
        let result = undo_last_action(repo.path_str()).await;
        assert!(result.is_ok());

        let undo_action = result.unwrap();
        assert_eq!(undo_action.action_type, "undo");
        assert!(undo_action.description.contains("Undo"));

        // HEAD should now point back to first commit
        assert_eq!(repo.head_oid(), first_oid);
    }

    #[tokio::test]
    async fn test_undo_last_action_insufficient_history() {
        // A repo with only one commit has only one reflog entry
        let repo = TestRepo::new();

        let result = undo_last_action(repo.path_str()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Nothing to undo"));
    }

    #[tokio::test]
    async fn test_undo_preserves_reflog() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("f.txt", "c")]);

        undo_last_action(repo.path_str()).await.unwrap();

        // After undo, the reflog should have more entries (the undo itself creates a new entry)
        let history = get_undo_history(repo.path_str(), None).await.unwrap();
        // At least: initial commit + second commit + reset (undo)
        assert!(history.actions.len() >= 3);
    }

    #[tokio::test]
    async fn test_redo_last_action() {
        let repo = TestRepo::with_initial_commit();
        let _first_oid = repo.head_oid();

        repo.create_commit("Second commit", &[("file2.txt", "content2")]);
        let second_oid = repo.head_oid();

        // Undo
        undo_last_action(repo.path_str()).await.unwrap();
        assert_ne!(repo.head_oid(), second_oid);

        // Redo
        let result = redo_last_action(repo.path_str()).await;
        assert!(result.is_ok());

        let redo_action = result.unwrap();
        assert_eq!(redo_action.action_type, "redo");

        // HEAD should now point back to second commit
        assert_eq!(repo.head_oid(), second_oid);
    }

    #[tokio::test]
    async fn test_redo_without_prior_undo() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("f.txt", "c")]);

        // Try to redo without having undone anything
        let result = redo_last_action(repo.path_str()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Nothing to redo"));
    }

    #[tokio::test]
    async fn test_record_action() {
        let repo = TestRepo::with_initial_commit();

        let action = UndoAction {
            action_type: "branch_delete".to_string(),
            description: "Deleted branch feature".to_string(),
            timestamp: 1706400000,
            before_ref: "abc123".to_string(),
            after_ref: "def456".to_string(),
            details: None,
        };

        let result = record_action(repo.path_str(), action).await;
        assert!(result.is_ok());

        // Verify the action was recorded in the reflog
        let history = get_undo_history(repo.path_str(), None).await.unwrap();
        assert!(history.actions.len() >= 2); // initial commit + recorded action
    }

    #[tokio::test]
    async fn test_parse_reflog_action_commit() {
        let (action_type, desc) = parse_reflog_action("commit: Add new feature");
        assert_eq!(action_type, "commit");
        assert!(desc.contains("Add new feature"));
    }

    #[tokio::test]
    async fn test_parse_reflog_action_checkout() {
        let (action_type, desc) = parse_reflog_action("checkout: moving from main to feature");
        assert_eq!(action_type, "checkout");
        assert!(desc.contains("moving from main to feature"));
    }

    #[tokio::test]
    async fn test_parse_reflog_action_merge() {
        let (action_type, desc) = parse_reflog_action("merge feature: Fast-forward");
        assert_eq!(action_type, "merge");
        assert!(desc.contains("Fast-forward"));
    }

    #[tokio::test]
    async fn test_parse_reflog_action_rebase() {
        let (action_type, desc) =
            parse_reflog_action("rebase (finish): refs/heads/main onto abc123");
        assert_eq!(action_type, "rebase");
        assert!(desc.contains("refs/heads/main"));
    }

    #[tokio::test]
    async fn test_parse_reflog_action_reset() {
        let (action_type, desc) = parse_reflog_action("reset: moving to HEAD~1");
        assert_eq!(action_type, "reset");
        assert!(desc.contains("moving to HEAD~1"));
    }

    #[tokio::test]
    async fn test_parse_reflog_action_pull() {
        let (action_type, _desc) = parse_reflog_action("pull: Fast-forward");
        assert_eq!(action_type, "pull");
    }

    #[tokio::test]
    async fn test_parse_reflog_action_cherry_pick() {
        let (action_type, _desc) = parse_reflog_action("cherry-pick: Added feature X");
        assert_eq!(action_type, "cherry_pick");
    }

    #[tokio::test]
    async fn test_parse_reflog_action_revert() {
        let (action_type, _desc) = parse_reflog_action("revert: Revert \"Some commit\"");
        assert_eq!(action_type, "revert");
    }

    #[tokio::test]
    async fn test_parse_reflog_action_amend() {
        let (action_type, desc) = parse_reflog_action("commit (amend): Updated message");
        assert_eq!(action_type, "amend");
        assert!(desc.contains("Updated message"));
    }

    #[tokio::test]
    async fn test_parse_reflog_action_initial_commit() {
        let (action_type, desc) = parse_reflog_action("commit (initial): Initial commit");
        assert_eq!(action_type, "commit");
        assert!(desc.contains("Initial commit"));
    }

    #[tokio::test]
    async fn test_parse_reflog_action_unknown() {
        let (action_type, desc) = parse_reflog_action("something_unexpected: details");
        assert_eq!(action_type, "something_unexpected");
        assert!(desc.contains("details"));
    }

    #[tokio::test]
    async fn test_undo_action_serialization() {
        let action = UndoAction {
            action_type: "commit".to_string(),
            description: "Commit: Add feature".to_string(),
            timestamp: 1706400000,
            before_ref: "abc123".to_string(),
            after_ref: "def456".to_string(),
            details: Some("{\"key\": \"value\"}".to_string()),
        };

        let json = serde_json::to_string(&action);
        assert!(json.is_ok());

        let json_str = json.unwrap();
        assert!(json_str.contains("\"actionType\":\"commit\""));
        assert!(json_str.contains("\"description\":\"Commit: Add feature\""));
        assert!(json_str.contains("\"timestamp\":1706400000"));
        assert!(json_str.contains("\"beforeRef\":\"abc123\""));
        assert!(json_str.contains("\"afterRef\":\"def456\""));
    }

    #[tokio::test]
    async fn test_undo_history_serialization() {
        let history = UndoHistory {
            actions: vec![],
            current_index: -1,
            can_undo: false,
            can_redo: false,
        };

        let json = serde_json::to_string(&history);
        assert!(json.is_ok());

        let json_str = json.unwrap();
        assert!(json_str.contains("\"currentIndex\":-1"));
        assert!(json_str.contains("\"canUndo\":false"));
        assert!(json_str.contains("\"canRedo\":false"));
    }

    #[tokio::test]
    async fn test_undo_action_deserialization() {
        let json = r#"{
            "actionType": "checkout",
            "description": "Checkout: moving from main to feature",
            "timestamp": 1706400000,
            "beforeRef": "abc123",
            "afterRef": "def456",
            "details": null
        }"#;

        let action: UndoAction = serde_json::from_str(json).unwrap();
        assert_eq!(action.action_type, "checkout");
        assert_eq!(action.description, "Checkout: moving from main to feature");
        assert_eq!(action.timestamp, 1706400000);
        assert!(action.details.is_none());
    }

    #[tokio::test]
    async fn test_undo_then_redo_cycle() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        repo.create_commit("Second", &[("f2.txt", "2")]);
        let second_oid = repo.head_oid();

        // Undo second commit -> should be at first
        undo_last_action(repo.path_str()).await.unwrap();
        assert_eq!(repo.head_oid(), first_oid);

        // Redo -> should be back at second
        redo_last_action(repo.path_str()).await.unwrap();
        assert_eq!(repo.head_oid(), second_oid);

        // Undo again -> should be at first again
        undo_last_action(repo.path_str()).await.unwrap();
        assert_eq!(repo.head_oid(), first_oid);
    }

    #[tokio::test]
    async fn test_undo_checkout() {
        let repo = TestRepo::with_initial_commit();
        // Determine the default branch name
        let default_branch = repo.current_branch();
        repo.create_branch("feature");

        // Record the OID before checkout
        let before_checkout_oid = repo.head_oid();

        // Create a commit on feature branch with different tree
        repo.checkout_branch("feature");
        repo.create_commit("Feature work", &[("feature.txt", "work")]);
        let feature_oid = repo.head_oid();

        // Checkout back to default branch
        repo.checkout_branch(&default_branch);
        assert_eq!(repo.head_oid(), before_checkout_oid);

        // Undo the checkout (should go back to feature branch HEAD)
        let result = undo_last_action(repo.path_str()).await;
        assert!(result.is_ok());
        assert_eq!(repo.head_oid(), feature_oid);
    }

    #[tokio::test]
    async fn test_get_undo_history_invalid_path() {
        let result = get_undo_history("/nonexistent/path".to_string(), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_undo_last_action_invalid_path() {
        let result = undo_last_action("/nonexistent/path".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_redo_last_action_invalid_path() {
        let result = redo_last_action("/nonexistent/path".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_record_action_invalid_path() {
        let action = UndoAction {
            action_type: "commit".to_string(),
            description: "test".to_string(),
            timestamp: 0,
            before_ref: "".to_string(),
            after_ref: "".to_string(),
            details: None,
        };
        let result = record_action("/nonexistent/path".to_string(), action).await;
        assert!(result.is_err());
    }
}
