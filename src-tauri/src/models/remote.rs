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
    pub success: bool,
    pub message: String,
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
