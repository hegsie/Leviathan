//! Shared path validation utilities for Tauri command handlers.
//!
//! Prevents directory traversal attacks (CWE-22) by ensuring
//! user-provided file paths stay within the repository directory.

use std::path::{Path, PathBuf};

use crate::error::{LeviathanError, Result};

/// Validate that a file path stays within the repository directory.
///
/// Rejects absolute paths and paths containing `..` components.
/// Canonicalizes the deepest existing ancestor to detect symlink-based escapes.
/// Works for both existing files and paths where the file may not exist yet.
pub fn validate_path_within_repo(repo_path: &Path, file_path: &str) -> Result<PathBuf> {
    let rel = Path::new(file_path);
    if rel.is_absolute() || file_path.contains("..") {
        return Err(LeviathanError::InvalidPath(
            "File path must be relative and cannot contain '..'".to_string(),
        ));
    }

    let abs_path = repo_path.join(rel);

    // Canonicalize the repo path as our trust boundary
    let canonical_repo = repo_path.canonicalize().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to resolve repo path: {}", e))
    })?;

    // Walk up until we find an existing ancestor we can canonicalize
    let mut check = abs_path.clone();
    loop {
        if check.exists() {
            let canonical = check.canonicalize().map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to resolve path: {}", e))
            })?;
            if !canonical.starts_with(&canonical_repo) {
                return Err(LeviathanError::InvalidPath(
                    "File path resolves to outside the repository".to_string(),
                ));
            }
            break;
        }
        if !check.pop() {
            return Err(LeviathanError::InvalidPath(
                "Cannot resolve file path".to_string(),
            ));
        }
    }

    Ok(abs_path)
}
