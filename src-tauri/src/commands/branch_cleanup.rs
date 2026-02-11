//! Branch cleanup command handlers
//!
//! Provides server-side logic for identifying branches that are candidates
//! for cleanup: merged, stale, or with gone (deleted) upstream tracking branches.
//! Uses `graph_descendant_of` for accurate merge detection instead of the
//! less reliable ahead/behind heuristic.

use std::path::Path;

use serde::Serialize;
use tauri::command;

use crate::error::Result;
use crate::models::AheadBehind;

use super::branch_rules::load_rules;

/// Default stale threshold in days
const DEFAULT_STALE_DAYS: i64 = 90;

/// A branch that is a candidate for cleanup
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCandidate {
    /// Full branch name
    pub name: String,
    /// Short display name
    pub shorthand: String,
    /// Category: "merged", "stale", or "gone"
    pub category: String,
    /// Unix timestamp of the last commit on this branch
    pub last_commit_timestamp: Option<i64>,
    /// Whether the branch is protected by a branch rule
    pub is_protected: bool,
    /// The upstream tracking reference, if any
    pub upstream: Option<String>,
    /// Ahead/behind counts relative to upstream
    pub ahead_behind: Option<AheadBehind>,
}

/// Get all branches that are candidates for cleanup.
///
/// Returns branches categorized as:
/// - **merged**: HEAD is a descendant of the branch (i.e., all branch commits are in HEAD)
/// - **stale**: last commit is older than `stale_days` (default 90)
/// - **gone**: branch has upstream configured but the remote branch no longer exists
///
/// A branch can appear multiple times if it matches more than one category.
/// Protected branches (matching branch rules with `prevent_deletion`) are flagged.
#[command]
pub async fn get_cleanup_candidates(
    path: String,
    stale_days: Option<i64>,
) -> Result<Vec<CleanupCandidate>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut candidates = Vec::new();

    let head = repo.head()?;
    let head_oid = match head.target() {
        Some(oid) => oid,
        None => return Ok(candidates),
    };

    let stale_days = stale_days.unwrap_or(DEFAULT_STALE_DAYS);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let stale_threshold = if stale_days > 0 {
        now - (stale_days * 24 * 60 * 60)
    } else {
        0 // disabled
    };

    // Load branch protection rules
    let rules = load_rules(Path::new(&path)).unwrap_or_default();

    // Helper: check if a branch name matches any protection rule with prevent_deletion
    let is_protected = |branch_name: &str| -> bool {
        rules.iter().any(|rule| {
            if !rule.prevent_deletion {
                return false;
            }
            if rule.pattern.contains('*') {
                // Simple glob matching: "release/*" matches "release/v1"
                let parts: Vec<&str> = rule.pattern.split('*').collect();
                if parts.len() == 2 {
                    branch_name.starts_with(parts[0]) && branch_name.ends_with(parts[1])
                } else {
                    rule.pattern == branch_name
                }
            } else {
                rule.pattern == branch_name
            }
        })
    };

    for branch_result in repo.branches(Some(git2::BranchType::Local))? {
        let (branch, _) = branch_result?;
        let name = branch.name()?.unwrap_or("").to_string();

        // Skip HEAD branch
        let reference = branch.get();
        let is_head = head
            .name()
            .and_then(|h| reference.name().map(|r| h == r))
            .unwrap_or(false);
        if is_head {
            continue;
        }

        let branch_oid = match reference.target() {
            Some(oid) => oid,
            None => continue,
        };

        let last_commit_timestamp = repo
            .find_commit(branch_oid)
            .ok()
            .map(|commit| commit.time().seconds());

        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(|n| n.to_string()));

        let ahead_behind = if let Ok(upstream_branch) = branch.upstream() {
            if let Some(upstream_oid) = upstream_branch.get().target() {
                repo.graph_ahead_behind(branch_oid, upstream_oid)
                    .ok()
                    .map(|(ahead, behind)| AheadBehind { ahead, behind })
            } else {
                None
            }
        } else {
            None
        };

        let protected = is_protected(&name);

        // Check if merged: HEAD is a descendant of the branch commit
        let is_merged = repo
            .graph_descendant_of(head_oid, branch_oid)
            .unwrap_or(false);

        // Check if stale
        let is_stale = stale_days > 0
            && last_commit_timestamp
                .map(|ts| ts < stale_threshold)
                .unwrap_or(false);

        // Check if upstream is gone
        let is_gone = {
            let config = repo.config().ok();
            let has_merge = config
                .as_ref()
                .and_then(|c| c.get_string(&format!("branch.{}.merge", name)).ok())
                .is_some();
            let has_remote = config
                .as_ref()
                .and_then(|c| c.get_string(&format!("branch.{}.remote", name)).ok())
                .is_some();
            // Gone if upstream is configured but branch.upstream() fails
            has_merge && has_remote && branch.upstream().is_err()
        };

        let base = |category: &str| CleanupCandidate {
            name: name.clone(),
            shorthand: name.clone(),
            category: category.to_string(),
            last_commit_timestamp,
            is_protected: protected,
            upstream: upstream.clone(),
            ahead_behind: ahead_behind.clone(),
        };

        if is_merged {
            candidates.push(base("merged"));
        }
        if is_stale {
            candidates.push(base("stale"));
        }
        if is_gone {
            candidates.push(base("gone"));
        }
    }

    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[test]
    fn test_cleanup_candidate_serialization() {
        let candidate = CleanupCandidate {
            name: "feature/old".to_string(),
            shorthand: "feature/old".to_string(),
            category: "merged".to_string(),
            last_commit_timestamp: Some(1700000000),
            is_protected: false,
            upstream: Some("origin/feature/old".to_string()),
            ahead_behind: Some(AheadBehind {
                ahead: 0,
                behind: 2,
            }),
        };

        let json = serde_json::to_string(&candidate).expect("Failed to serialize");
        assert!(json.contains("\"name\""));
        assert!(json.contains("\"shorthand\""));
        assert!(json.contains("\"category\""));
        assert!(json.contains("\"lastCommitTimestamp\""));
        assert!(json.contains("\"isProtected\""));
        assert!(json.contains("\"upstream\""));
        assert!(json.contains("\"aheadBehind\""));
        // Verify camelCase
        assert!(!json.contains("last_commit_timestamp"));
        assert!(!json.contains("is_protected"));
        assert!(!json.contains("ahead_behind"));
    }

    #[tokio::test]
    async fn test_get_cleanup_candidates_empty_repo() {
        let repo = TestRepo::with_initial_commit();
        let result = get_cleanup_candidates(repo.path_str(), None).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_cleanup_candidates_merged_branch() {
        let repo = TestRepo::with_initial_commit();
        // Create a branch at current HEAD, then add a commit on main
        // The branch will be "merged" since HEAD contains all its commits
        repo.create_branch("feature-done");
        repo.create_commit("Another commit", &[("file.txt", "content")]);

        let result = get_cleanup_candidates(repo.path_str(), None).await;
        assert!(result.is_ok());
        let candidates = result.unwrap();
        assert!(
            candidates
                .iter()
                .any(|c| c.name == "feature-done" && c.category == "merged"),
            "Expected feature-done to be a merged candidate"
        );
    }

    #[tokio::test]
    async fn test_get_cleanup_candidates_skips_head() {
        let repo = TestRepo::with_initial_commit();
        let result = get_cleanup_candidates(repo.path_str(), None).await;
        assert!(result.is_ok());
        let candidates = result.unwrap();
        // HEAD branch should never appear
        assert!(
            !candidates.iter().any(|c| c.name == repo.current_branch()),
            "HEAD branch should not be a cleanup candidate"
        );
    }

    #[tokio::test]
    async fn test_get_cleanup_candidates_stale_disabled() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("old-branch");

        // stale_days=0 disables stale detection
        let result = get_cleanup_candidates(repo.path_str(), Some(0)).await;
        assert!(result.is_ok());
        let candidates = result.unwrap();
        assert!(
            !candidates.iter().any(|c| c.category == "stale"),
            "No stale candidates when stale_days=0"
        );
    }

    #[tokio::test]
    async fn test_get_cleanup_candidates_unmerged_branch_not_in_merged() {
        let repo = TestRepo::with_initial_commit();
        // Create a branch and add a commit on it that's NOT in HEAD
        repo.create_branch("feature-wip");
        repo.checkout_branch("feature-wip");
        repo.create_commit("WIP commit", &[("wip.txt", "wip content")]);
        repo.checkout_branch("main");

        let result = get_cleanup_candidates(repo.path_str(), Some(0)).await;
        assert!(result.is_ok());
        let candidates = result.unwrap();
        // feature-wip should NOT appear as merged
        assert!(
            !candidates
                .iter()
                .any(|c| c.name == "feature-wip" && c.category == "merged"),
            "Unmerged branch should not be a merged candidate"
        );
    }
}
