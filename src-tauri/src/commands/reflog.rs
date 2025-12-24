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
