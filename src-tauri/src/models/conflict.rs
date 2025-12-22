//! Conflict-related model types

use serde::{Deserialize, Serialize};

/// Represents a file with merge conflicts
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    /// File path relative to repository root
    pub path: String,
    /// Base (ancestor) version
    pub ancestor: Option<ConflictEntry>,
    /// Our (current branch) version
    pub ours: Option<ConflictEntry>,
    /// Their (incoming) version
    pub theirs: Option<ConflictEntry>,
}

/// Represents one side of a conflict
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictEntry {
    /// Object ID (blob hash)
    pub oid: String,
    /// File path
    pub path: String,
    /// File mode
    pub mode: u32,
}
