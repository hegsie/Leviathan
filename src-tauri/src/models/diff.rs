//! Diff models

use super::FileStatus;
use serde::{Deserialize, Serialize};

/// Diff for a single file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub hunks: Vec<DiffHunk>,
    pub is_binary: bool,
    pub is_image: bool,
    pub image_type: Option<String>,
    pub additions: usize,
    pub deletions: usize,
}

/// Check if a file path is an image based on extension
pub fn is_image_file(path: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "ico" | "bmp" | "tiff" | "tif"
    )
}

/// Get the image type from a file path
pub fn get_image_type(path: &str) -> Option<String> {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    if is_image_file(path) {
        Some(ext)
    } else {
        None
    }
}

/// A hunk in a diff
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

/// A single line in a diff hunk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub content: String,
    pub origin: DiffLineOrigin,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
}

/// Origin type for a diff line
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiffLineOrigin {
    Context,
    Addition,
    Deletion,
    ContextEofnl,
    AddEofnl,
    DelEofnl,
    FileHeader,
    HunkHeader,
    Binary,
}

impl From<char> for DiffLineOrigin {
    fn from(c: char) -> Self {
        match c {
            ' ' => DiffLineOrigin::Context,
            '+' => DiffLineOrigin::Addition,
            '-' => DiffLineOrigin::Deletion,
            '=' => DiffLineOrigin::ContextEofnl,
            '>' => DiffLineOrigin::AddEofnl,
            '<' => DiffLineOrigin::DelEofnl,
            'F' => DiffLineOrigin::FileHeader,
            'H' => DiffLineOrigin::HunkHeader,
            'B' => DiffLineOrigin::Binary,
            _ => DiffLineOrigin::Context,
        }
    }
}
