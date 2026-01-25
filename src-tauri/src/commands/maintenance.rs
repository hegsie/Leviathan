//! Repository maintenance command handlers

use std::path::Path;
use std::process::Command;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Result of a garbage collection operation
#[derive(Clone, serde::Serialize)]
pub struct GcResult {
    /// Whether the operation succeeded
    pub success: bool,
    /// Output message from git gc
    pub message: String,
}

/// Run garbage collection on a repository
///
/// This cleans up unnecessary files and optimizes the local repository.
#[command]
pub async fn run_gc(
    path: String,
    aggressive: Option<bool>,
    prune: Option<String>,
    auto: Option<bool>,
) -> Result<GcResult> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Verify it's a git repository
    git2::Repository::open(repo_path)?;

    // Build the git gc command
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path);
    cmd.arg("gc");

    // Add options
    if auto.unwrap_or(false) {
        cmd.arg("--auto");
    } else if aggressive.unwrap_or(false) {
        cmd.arg("--aggressive");
    }

    if let Some(prune_date) = prune {
        cmd.arg("--prune").arg(prune_date);
    }

    // Run the command
    let output = cmd
        .output()
        .map_err(|e| LeviathanError::Custom(format!("Failed to run git gc: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        let message = if stdout.is_empty() && stderr.is_empty() {
            "Garbage collection completed successfully".to_string()
        } else {
            format!("{}{}", stdout, stderr).trim().to_string()
        };

        Ok(GcResult {
            success: true,
            message,
        })
    } else {
        Err(LeviathanError::Custom(format!(
            "Garbage collection failed: {}",
            stderr
        )))
    }
}

/// Run fsck (file system check) on a repository
///
/// This verifies the connectivity and validity of objects in the repository.
#[command]
pub async fn run_fsck(path: String, full: Option<bool>) -> Result<GcResult> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Verify it's a git repository
    git2::Repository::open(repo_path)?;

    // Build the git fsck command
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path);
    cmd.arg("fsck");

    if full.unwrap_or(false) {
        cmd.arg("--full");
    }

    // Run the command
    let output = cmd
        .output()
        .map_err(|e| LeviathanError::Custom(format!("Failed to run git fsck: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // fsck outputs to stderr even for informational messages
    let combined_output = format!("{}{}", stdout, stderr).trim().to_string();

    if output.status.success() {
        let message = if combined_output.is_empty() {
            "Repository is healthy - no issues found".to_string()
        } else {
            combined_output
        };

        Ok(GcResult {
            success: true,
            message,
        })
    } else {
        Err(LeviathanError::Custom(format!(
            "Repository check failed: {}",
            combined_output
        )))
    }
}

/// Prune unreachable objects from the repository
#[command]
pub async fn run_prune(path: String, dry_run: Option<bool>) -> Result<GcResult> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Verify it's a git repository
    git2::Repository::open(repo_path)?;

    // Build the git prune command
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path);
    cmd.arg("prune");

    if dry_run.unwrap_or(false) {
        cmd.arg("--dry-run");
    }

    // Run the command
    let output = cmd
        .output()
        .map_err(|e| LeviathanError::Custom(format!("Failed to run git prune: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        let message = if stdout.is_empty() && stderr.is_empty() {
            "Prune completed - no unreachable objects found".to_string()
        } else {
            format!("{}{}", stdout, stderr).trim().to_string()
        };

        Ok(GcResult {
            success: true,
            message,
        })
    } else {
        Err(LeviathanError::Custom(format!("Prune failed: {}", stderr)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_run_gc_basic() {
        let repo = TestRepo::with_initial_commit();
        let result = run_gc(repo.path_str(), None, None, None).await;
        assert!(result.is_ok());
        let gc_result = result.unwrap();
        assert!(gc_result.success);
    }

    #[tokio::test]
    async fn test_run_gc_auto() {
        let repo = TestRepo::with_initial_commit();
        let result = run_gc(repo.path_str(), None, None, Some(true)).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_run_gc_nonexistent_path() {
        let result = run_gc("/nonexistent/path".to_string(), None, None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_run_fsck_basic() {
        let repo = TestRepo::with_initial_commit();
        let result = run_fsck(repo.path_str(), None).await;
        assert!(result.is_ok());
        let fsck_result = result.unwrap();
        assert!(fsck_result.success);
    }

    #[tokio::test]
    async fn test_run_prune_basic() {
        let repo = TestRepo::with_initial_commit();
        let result = run_prune(repo.path_str(), None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_run_prune_dry_run() {
        let repo = TestRepo::with_initial_commit();
        let result = run_prune(repo.path_str(), Some(true)).await;
        assert!(result.is_ok());
    }
}
