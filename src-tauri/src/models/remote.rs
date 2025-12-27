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
