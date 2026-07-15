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
    /// Whether any side of the conflict is binary content. Binary conflicts
    /// must not go through the text merge editor — resolving them writes
    /// whole blobs (see resolve_conflict_take_side).
    #[serde(default)]
    pub is_binary: bool,
    /// Marker size the conflict hunks in this file were actually written
    /// with (git's default is 7; the conflict-marker-size gitattribute
    /// raises it). The backend verifies the attribute against the file's
    /// real emission — the frontend parser must use this exact size, since
    /// the same byte pattern is a real conflict at one size and plain
    /// content at another.
    #[serde(default = "default_marker_size")]
    pub marker_size: u32,
    /// Conflict style the hunks were written with: "merge" (default) or
    /// "diff3" (has `|||||||` base sections; zdiff3 is reported as diff3 —
    /// the emitted structure is the same to a parser). Without this the
    /// frontend cannot tell a base section from ours content that happens
    /// to start with a pipe run.
    #[serde(default = "default_conflict_style")]
    pub conflict_style: String,
    /// AUTHORITATIVE marker positions in the working file (0-based line
    /// indices), derived from a collision-free re-replay when the merge
    /// replay matched the file. When present the frontend parses by these
    /// positions instead of shape heuristics — content that quotes marker
    /// lines (even byte-identical to the real ones) can never confuse
    /// them. Empty when the file was hand-edited (no replay match).
    #[serde(default)]
    pub conflict_hunks: Vec<ConflictHunk>,
}

/// One conflict hunk's marker line positions in the working file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictHunk {
    /// `<<<<<<<` line index
    pub start: u32,
    /// `=======` line index
    pub separator: u32,
    /// `>>>>>>>` line index
    pub end: u32,
    /// `|||||||` line index for diff3-style emission
    pub base: Option<u32>,
}

pub(crate) fn default_marker_size() -> u32 {
    7
}

pub(crate) fn default_conflict_style() -> String {
    "merge".to_string()
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
