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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_lines: Option<usize>,
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

/// Hunks for a file (used by partial staging API)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHunks {
    pub file_path: String,
    pub hunks: Vec<IndexedDiffHunk>,
    pub total_additions: u32,
    pub total_deletions: u32,
}

/// A hunk with index and staging state (used by partial staging API)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedDiffHunk {
    pub index: u32,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<HunkDiffLine>,
    pub is_staged: bool,
}

/// A diff line with string-based type (used by partial staging API)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkDiffLine {
    pub line_type: String,
    pub content: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_image_file_png() {
        assert!(is_image_file("image.png"));
        assert!(is_image_file("path/to/image.PNG"));
    }

    #[test]
    fn test_is_image_file_jpeg() {
        assert!(is_image_file("photo.jpg"));
        assert!(is_image_file("photo.jpeg"));
        assert!(is_image_file("photo.JPEG"));
    }

    #[test]
    fn test_is_image_file_other_formats() {
        assert!(is_image_file("icon.gif"));
        assert!(is_image_file("logo.svg"));
        assert!(is_image_file("image.webp"));
        assert!(is_image_file("favicon.ico"));
        assert!(is_image_file("bitmap.bmp"));
        assert!(is_image_file("scan.tiff"));
        assert!(is_image_file("scan.tif"));
    }

    #[test]
    fn test_is_image_file_non_images() {
        assert!(!is_image_file("script.js"));
        assert!(!is_image_file("style.css"));
        assert!(!is_image_file("data.json"));
        assert!(!is_image_file("readme.md"));
        assert!(!is_image_file("main.rs"));
        assert!(!is_image_file("noextension"));
    }

    #[test]
    fn test_get_image_type_returns_extension() {
        assert_eq!(get_image_type("test.png"), Some("png".to_string()));
        assert_eq!(get_image_type("test.JPG"), Some("jpg".to_string()));
        assert_eq!(get_image_type("test.svg"), Some("svg".to_string()));
    }

    #[test]
    fn test_get_image_type_returns_none_for_non_images() {
        assert_eq!(get_image_type("test.txt"), None);
        assert_eq!(get_image_type("test.rs"), None);
        assert_eq!(get_image_type("noextension"), None);
    }

    #[test]
    fn test_diff_line_origin_from_char() {
        assert!(matches!(DiffLineOrigin::from(' '), DiffLineOrigin::Context));
        assert!(matches!(
            DiffLineOrigin::from('+'),
            DiffLineOrigin::Addition
        ));
        assert!(matches!(
            DiffLineOrigin::from('-'),
            DiffLineOrigin::Deletion
        ));
        assert!(matches!(
            DiffLineOrigin::from('='),
            DiffLineOrigin::ContextEofnl
        ));
        assert!(matches!(
            DiffLineOrigin::from('>'),
            DiffLineOrigin::AddEofnl
        ));
        assert!(matches!(
            DiffLineOrigin::from('<'),
            DiffLineOrigin::DelEofnl
        ));
        assert!(matches!(
            DiffLineOrigin::from('F'),
            DiffLineOrigin::FileHeader
        ));
        assert!(matches!(
            DiffLineOrigin::from('H'),
            DiffLineOrigin::HunkHeader
        ));
        assert!(matches!(DiffLineOrigin::from('B'), DiffLineOrigin::Binary));
    }

    #[test]
    fn test_diff_line_origin_unknown_defaults_to_context() {
        assert!(matches!(DiffLineOrigin::from('X'), DiffLineOrigin::Context));
        assert!(matches!(DiffLineOrigin::from('?'), DiffLineOrigin::Context));
    }
}
