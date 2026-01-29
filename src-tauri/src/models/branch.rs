//! Branch models

use serde::{Deserialize, Serialize};

/// Branch information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub shorthand: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub target_oid: String,
    pub ahead_behind: Option<AheadBehind>,
    /// Unix timestamp of the last commit on this branch
    pub last_commit_timestamp: Option<i64>,
    /// Whether this branch is considered stale (no commits in threshold days)
    pub is_stale: bool,
}

/// Ahead/behind counts relative to upstream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub ahead: usize,
    pub behind: usize,
}

/// Tag information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    pub target_oid: String,
    pub message: Option<String>,
    pub tagger: Option<super::Signature>,
    pub is_annotated: bool,
}

/// Stash entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

/// Branch tracking information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchTrackingInfo {
    /// The local branch name
    pub local_branch: String,
    /// The full upstream reference (e.g., "refs/remotes/origin/main")
    pub upstream: Option<String>,
    /// Number of commits ahead of upstream
    pub ahead: u32,
    /// Number of commits behind upstream
    pub behind: u32,
    /// The remote name (e.g., "origin")
    pub remote: Option<String>,
    /// The remote branch name (e.g., "main")
    pub remote_branch: Option<String>,
    /// Whether the upstream branch was deleted
    pub is_gone: bool,
}
