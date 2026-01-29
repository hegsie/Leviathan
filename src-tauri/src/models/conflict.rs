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

/// Represents a file with conflict markers detected in its content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictMarkerFile {
    /// File path relative to repository root
    pub path: String,
    /// Number of conflict regions in the file
    pub conflict_count: u32,
    /// Details of each conflict marker region
    pub markers: Vec<ConflictMarker>,
}

/// Represents a single conflict marker region in a file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictMarker {
    /// Line number where the conflict starts (<<<<<<< marker)
    pub start_line: u32,
    /// Line number of the separator (=======)
    pub separator_line: u32,
    /// Line number where the conflict ends (>>>>>>> marker)
    pub end_line: u32,
    /// Content from our side (between <<<<<<< and =======)
    pub ours_content: String,
    /// Content from their side (between ======= and >>>>>>>)
    pub theirs_content: String,
    /// Content from base version if diff3 style (between ||||||| and =======)
    pub base_content: Option<String>,
}

/// Detailed information about conflicts in a file including ref names
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDetails {
    /// File path relative to repository root
    pub file_path: String,
    /// Name of our ref (current branch or HEAD)
    pub our_ref: String,
    /// Name of their ref (incoming branch)
    pub their_ref: String,
    /// Name of base ref if available
    pub base_ref: Option<String>,
    /// Conflict markers found in the file
    pub markers: Vec<ConflictMarker>,
}
