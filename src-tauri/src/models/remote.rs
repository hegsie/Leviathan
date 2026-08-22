//! Remote models

use serde::{Deserialize, Serialize};

/// Remote repository information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub url: String,
    pub push_url: Option<String>,
}

/// Result of a remote operation (fetch/pull/push) for event emission
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteOperationResult {
    pub operation: String,
    pub remote: String,
    /// The repository the operation ran on, so a late completion can refresh
    /// the right tab rather than whichever one happens to be active.
    pub repo_path: String,
    pub success: bool,
    pub message: String,
    /// The IPC error code of a FAILED completion, when there is one — the same
    /// code the command would have returned to its caller.
    ///
    /// A late pull that ends in conflicts is not just "a pull that failed":
    /// MERGE_HEAD (or the rebase state) is on disk and the user needs the
    /// conflict dialog. The frontend keys that flow off `MERGE_CONFLICT` /
    /// `REBASE_CONFLICT`, so flattening the error to a message string alone
    /// left a conflicted repository with nothing but a red toast.
    pub error_code: Option<String>,
    /// This completion arrived AFTER the command had already reported a
    /// timeout to its caller, so nothing on the frontend is waiting to
    /// refresh. See `await_remote_task` in commands/remote.rs.
    pub late: bool,
}

/// Result of fetching all remotes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchAllResult {
    pub remotes: Vec<RemoteFetchResult>,
    pub success: bool,
    pub total_fetched: u32,
    pub total_failed: u32,
}

/// Result of fetching a single remote
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFetchResult {
    pub remote: String,
    pub success: bool,
    pub message: Option<String>,
    pub refs_updated: u32,
}

/// Status of a remote for fetch operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFetchStatus {
    pub remote: String,
    pub url: String,
    pub last_fetch: Option<i64>,
    pub branches: Vec<String>,
}

/// Result of pushing to multiple remotes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiPushResult {
    pub results: Vec<RemotePushResult>,
    pub total_success: u32,
    pub total_failed: u32,
}

/// Result of pushing to a single remote (used in multi-push)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePushResult {
    pub remote: String,
    pub success: bool,
    pub message: Option<String>,
}
