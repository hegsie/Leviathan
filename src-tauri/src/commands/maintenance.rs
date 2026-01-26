//! Repository maintenance command handlers

use std::fs;
use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

/// Result of a repository maintenance operation
#[derive(Clone, serde::Serialize)]
pub struct MaintenanceResult {
    /// Whether the operation succeeded
    pub success: bool,
    /// Output message from the maintenance command
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
) -> Result<MaintenanceResult> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Verify it's a git repository
    git2::Repository::open(repo_path)?;

    // Build the git gc command
    let mut cmd = create_command("git");
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

        Ok(MaintenanceResult {
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
pub async fn run_fsck(path: String, full: Option<bool>) -> Result<MaintenanceResult> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Verify it's a git repository
    git2::Repository::open(repo_path)?;

    // Build the git fsck command
    let mut cmd = create_command("git");
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

        Ok(MaintenanceResult {
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
pub async fn run_prune(path: String, dry_run: Option<bool>) -> Result<MaintenanceResult> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Verify it's a git repository
    git2::Repository::open(repo_path)?;

    // Build the git prune command
    let mut cmd = create_command("git");
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

        Ok(MaintenanceResult {
            success: true,
            message,
        })
    } else {
        Err(LeviathanError::Custom(format!("Prune failed: {}", stderr)))
    }
}

/// Repository statistics result
#[derive(Clone, serde::Serialize)]
pub struct RepositoryStats {
    /// Total number of objects (commits, trees, blobs, tags)
    pub count: usize,
    /// Number of loose objects
    pub loose: usize,
    /// Size in KB
    pub size_kb: usize,
}

/// Pack file information result
#[derive(Clone, serde::Serialize)]
pub struct PackInfo {
    /// Number of pack files
    pub pack_count: usize,
    /// Total size of pack files in KB
    pub pack_size_kb: usize,
}

/// Get repository statistics (object counts, size)
#[command]
pub async fn get_repository_stats(path: String) -> Result<RepositoryStats> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Verify it's a git repository
    let repo = git2::Repository::open(repo_path)?;
    let git_dir = repo.path();

    // Try git count-objects first (more accurate)
    let mut cmd = create_command("git");
    cmd.current_dir(repo_path);
    cmd.args(["count-objects", "-v"]);

    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut loose_count = 0usize;
            let mut total_count = 0usize;
            let mut size_kb = 0usize;

            for line in stdout.lines() {
                if let Some(value) = line.strip_prefix("count: ") {
                    if let Ok(count) = value.trim().parse::<usize>() {
                        loose_count = count;
                        total_count = count; // Start with loose count
                    }
                } else if let Some(value) = line.strip_prefix("size: ") {
                    if let Ok(s) = value.trim().parse::<usize>() {
                        size_kb = s;
                    }
                } else if let Some(value) = line.strip_prefix("in-pack: ") {
                    if let Ok(packed) = value.trim().parse::<usize>() {
                        total_count = loose_count + packed;
                    }
                } else if let Some(value) = line.strip_prefix("size-pack: ") {
                    if let Ok(pack_size) = value.trim().parse::<usize>() {
                        size_kb += pack_size;
                    }
                }
            }

            return Ok(RepositoryStats {
                count: total_count,
                loose: loose_count,
                size_kb,
            });
        }
    }

    // Fallback: manually count loose objects if git command fails
    let objects_dir = git_dir.join("objects");
    let mut loose_count = 0usize;
    let mut loose_size: u64 = 0;

    if objects_dir.exists() {
        for entry in fs::read_dir(&objects_dir).into_iter().flatten().flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();

            // Check if it's a 2-character hex directory (loose object directory)
            if name_str.len() == 2 && name_str.chars().all(|c| c.is_ascii_hexdigit()) {
                if let Ok(subdir) = fs::read_dir(entry.path()) {
                    for obj_entry in subdir.flatten() {
                        if let Ok(metadata) = obj_entry.metadata() {
                            if metadata.is_file() {
                                loose_count += 1;
                                loose_size += metadata.len();
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(RepositoryStats {
        count: loose_count,
        loose: loose_count,
        size_kb: (loose_size / 1024) as usize,
    })
}

/// Get pack file information
#[command]
pub async fn get_pack_info(path: String) -> Result<PackInfo> {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Open the repository
    let repo = git2::Repository::open(repo_path)?;
    let git_dir = repo.path();

    // Count pack files in objects/pack/
    let pack_dir = git_dir.join("objects").join("pack");
    let mut pack_count = 0;
    let mut pack_size: u64 = 0;

    if pack_dir.exists() {
        if let Ok(entries) = fs::read_dir(&pack_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();

                // Count .pack files
                if name_str.ends_with(".pack") {
                    pack_count += 1;
                    if let Ok(metadata) = entry.metadata() {
                        pack_size += metadata.len();
                    }
                }
            }
        }
    }

    Ok(PackInfo {
        pack_count,
        pack_size_kb: (pack_size / 1024) as usize,
    })
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
    async fn test_run_gc_aggressive() {
        let repo = TestRepo::with_initial_commit();
        let result = run_gc(repo.path_str(), Some(true), None, None).await;
        assert!(result.is_ok());
        let gc_result = result.unwrap();
        assert!(gc_result.success);
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
