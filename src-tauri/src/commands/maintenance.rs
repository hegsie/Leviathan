//! Repository maintenance command handlers
//!
//! Provides functionality for repository cleanup and maintenance operations
//! similar to GitKraken and SourceTree.

use std::fs;
use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

// ──────────────────────────────────────────────────────────────────────────────
// Structs from HEAD (feature branch)
// ──────────────────────────────────────────────────────────────────────────────

/// Result of a garbage collection operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GcResult {
    /// Whether the operation completed successfully
    pub success: bool,
    /// Human-readable message about the operation
    pub message: String,
    /// Number of objects before GC (if available)
    pub objects_before: Option<u64>,
    /// Number of objects after GC (if available)
    pub objects_after: Option<u64>,
}

/// Result of a prune operation for remote tracking branches
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    /// Whether the operation completed successfully
    pub success: bool,
    /// List of branches that were pruned
    pub branches_pruned: Vec<String>,
}

/// Result of a repository integrity check (fsck)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsckResult {
    /// Whether the repository is valid (no errors)
    pub is_valid: bool,
    /// List of errors found
    pub errors: Vec<String>,
    /// List of warnings found
    pub warnings: Vec<String>,
}

/// Information about repository size and storage
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSizeInfo {
    /// Total size of the .git directory in bytes
    pub total_size_bytes: u64,
    /// Size of object storage in bytes
    pub objects_size_bytes: u64,
    /// Number of pack files
    pub pack_files_count: u32,
    /// Number of loose objects
    pub loose_objects_count: u32,
}

// ──────────────────────────────────────────────────────────────────────────────
// Structs from origin/main
// ──────────────────────────────────────────────────────────────────────────────

/// Result of a repository maintenance operation
#[derive(Clone, serde::Serialize)]
pub struct MaintenanceResult {
    /// Whether the operation succeeded
    pub success: bool,
    /// Output message from the maintenance command
    pub message: String,
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

// ──────────────────────────────────────────────────────────────────────────────
// Helper functions (from HEAD)
// ──────────────────────────────────────────────────────────────────────────────

/// Count loose objects in the repository
fn count_loose_objects(git_dir: &Path) -> u32 {
    let objects_dir = git_dir.join("objects");
    let mut count = 0u32;

    // Loose objects are stored in subdirectories named 00-ff
    for i in 0..=255 {
        let subdir = objects_dir.join(format!("{:02x}", i));
        if subdir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&subdir) {
                count += entries.filter(|e| e.is_ok()).count() as u32;
            }
        }
    }

    count
}

/// Count pack files in the repository
fn count_pack_files(git_dir: &Path) -> u32 {
    let pack_dir = git_dir.join("objects").join("pack");
    if !pack_dir.is_dir() {
        return 0;
    }

    if let Ok(entries) = std::fs::read_dir(&pack_dir) {
        entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "pack")
                    .unwrap_or(false)
            })
            .count() as u32
    } else {
        0
    }
}

/// Calculate directory size recursively
fn calculate_dir_size(path: &Path) -> u64 {
    if !path.is_dir() {
        return 0;
    }

    let mut size = 0u64;

    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_file() {
                if let Ok(metadata) = entry.metadata() {
                    size += metadata.len();
                }
            } else if entry_path.is_dir() {
                size += calculate_dir_size(&entry_path);
            }
        }
    }

    size
}

// ──────────────────────────────────────────────────────────────────────────────
// Commands from HEAD (feature branch)
// ──────────────────────────────────────────────────────────────────────────────

/// Run garbage collection on a repository
///
/// This runs `git gc` to clean up unnecessary files and optimize the repository.
#[command]
pub async fn run_garbage_collection(
    path: String,
    aggressive: bool,
    prune: Option<String>,
) -> Result<GcResult> {
    let repo_path = Path::new(&path);

    // Verify the repository exists
    if !repo_path.join(".git").exists() && !repo_path.join("HEAD").exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Get objects count before GC
    let git_dir = if repo_path.join(".git").exists() {
        repo_path.join(".git")
    } else {
        repo_path.to_path_buf() // bare repository
    };
    let objects_before = Some(count_loose_objects(&git_dir) as u64);

    // Build the git gc command
    let mut cmd = create_command("git");
    cmd.current_dir(&path);
    cmd.arg("gc");

    if aggressive {
        cmd.arg("--aggressive");
    }

    if let Some(ref prune_date) = prune {
        cmd.arg(format!("--prune={}", prune_date));
    }

    // Execute the command
    let output = cmd
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to execute git gc: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Get objects count after GC
    let objects_after = Some(count_loose_objects(&git_dir) as u64);

    if output.status.success() {
        let message = if stdout.trim().is_empty() && stderr.trim().is_empty() {
            "Garbage collection completed successfully".to_string()
        } else {
            format!("{}{}", stdout.trim(), stderr.trim())
        };

        Ok(GcResult {
            success: true,
            message,
            objects_before,
            objects_after,
        })
    } else {
        Ok(GcResult {
            success: false,
            message: format!("Garbage collection failed: {}", stderr.trim()),
            objects_before,
            objects_after: None,
        })
    }
}

/// Prune remote tracking branches that no longer exist on the remote
///
/// This runs `git remote prune` to remove stale remote tracking branches.
#[command]
pub async fn prune_remote_tracking_branches(
    path: String,
    remote: Option<String>,
) -> Result<PruneResult> {
    let repo_path = Path::new(&path);

    // Verify the repository exists
    if !repo_path.join(".git").exists() && !repo_path.join("HEAD").exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Get list of remotes to prune
    let remotes_to_prune = if let Some(ref remote_name) = remote {
        vec![remote_name.clone()]
    } else {
        // Get all remotes
        let output = create_command("git")
            .current_dir(&path)
            .args(["remote"])
            .output()
            .map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to list remotes: {}", e))
            })?;

        if !output.status.success() {
            return Err(LeviathanError::OperationFailed(
                "Failed to list remotes".to_string(),
            ));
        }

        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    };

    let mut all_pruned_branches = Vec::new();

    for remote_name in remotes_to_prune {
        // First, do a dry-run to see what would be pruned
        let dry_run_output = create_command("git")
            .current_dir(&path)
            .args(["remote", "prune", "--dry-run", &remote_name])
            .output()
            .map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to prune remote: {}", e))
            })?;

        // Parse dry-run output to get branch names
        let dry_run_text = String::from_utf8_lossy(&dry_run_output.stdout);
        let stderr_text = String::from_utf8_lossy(&dry_run_output.stderr);

        // Combine stdout and stderr as git may output to either
        let combined = format!("{}{}", dry_run_text, stderr_text);

        // Parse branches that will be pruned
        // Format: " * [would prune] origin/branch-name" or " * [pruned] origin/branch-name"
        for line in combined.lines() {
            if line.contains("[would prune]") || line.contains("[pruned]") {
                // Extract the branch name after the last ]
                if let Some(branch_part) = line.split(']').next_back() {
                    let branch = branch_part.trim().to_string();
                    if !branch.is_empty() {
                        all_pruned_branches.push(branch);
                    }
                }
            }
        }

        // Actually perform the prune
        let output = create_command("git")
            .current_dir(&path)
            .args(["remote", "prune", &remote_name])
            .output()
            .map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to prune remote: {}", e))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(LeviathanError::OperationFailed(format!(
                "Failed to prune remote {}: {}",
                remote_name,
                stderr.trim()
            )));
        }
    }

    Ok(PruneResult {
        success: true,
        branches_pruned: all_pruned_branches,
    })
}

/// Verify repository integrity using fsck
///
/// This runs `git fsck` to check the connectivity and validity of objects.
#[command]
pub async fn verify_repository(path: String, full: bool) -> Result<FsckResult> {
    let repo_path = Path::new(&path);

    // Verify the repository exists
    if !repo_path.join(".git").exists() && !repo_path.join("HEAD").exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    // Build the git fsck command
    let mut cmd = create_command("git");
    cmd.current_dir(&path);
    cmd.arg("fsck");

    if full {
        cmd.arg("--full");
    }

    // Execute the command
    let output = cmd.output().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to execute git fsck: {}", e))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Parse output for errors and warnings
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    // Combine stdout and stderr for parsing
    let combined = format!("{}{}", stdout, stderr);

    for line in combined.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Classify the message
        let lower = line.to_lowercase();
        if lower.contains("error")
            || lower.contains("missing")
            || lower.contains("broken")
            || lower.contains("corrupt")
            || lower.contains("invalid")
        {
            errors.push(line.to_string());
        } else if lower.contains("warning") || lower.contains("dangling") {
            warnings.push(line.to_string());
        } else if !lower.contains("checking") && !lower.contains("verifying") {
            // Other messages that aren't status updates
            if lower.contains("notice") {
                warnings.push(line.to_string());
            } else {
                // Could be informational or an issue
                warnings.push(line.to_string());
            }
        }
    }

    // Repository is valid if there are no errors (warnings are acceptable)
    let is_valid = errors.is_empty() && output.status.success();

    Ok(FsckResult {
        is_valid,
        errors,
        warnings,
    })
}

/// Get repository size information
///
/// Returns information about the repository's storage usage.
#[command]
pub async fn get_repo_size_info(path: String) -> Result<RepoSizeInfo> {
    let repo_path = Path::new(&path);

    // Verify the repository exists
    if !repo_path.join(".git").exists() && !repo_path.join("HEAD").exists() {
        return Err(LeviathanError::RepositoryNotFound(path));
    }

    let git_dir = if repo_path.join(".git").exists() {
        repo_path.join(".git")
    } else {
        repo_path.to_path_buf() // bare repository
    };

    // Calculate total .git directory size
    let total_size_bytes = calculate_dir_size(&git_dir);

    // Calculate objects directory size
    let objects_dir = git_dir.join("objects");
    let objects_size_bytes = calculate_dir_size(&objects_dir);

    // Count pack files
    let pack_files_count = count_pack_files(&git_dir);

    // Count loose objects
    let loose_objects_count = count_loose_objects(&git_dir);

    Ok(RepoSizeInfo {
        total_size_bytes,
        objects_size_bytes,
        pack_files_count,
        loose_objects_count,
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// Commands from origin/main
// ──────────────────────────────────────────────────────────────────────────────

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

    // ── Tests from HEAD (feature branch) ─────────────────────────────────

    #[tokio::test]
    async fn test_run_garbage_collection_basic() {
        let repo = TestRepo::with_initial_commit();

        let result = run_garbage_collection(repo.path_str(), false, None).await;

        assert!(result.is_ok());
        let gc_result = result.unwrap();
        assert!(gc_result.success);
    }

    #[tokio::test]
    async fn test_run_garbage_collection_aggressive() {
        let repo = TestRepo::with_initial_commit();

        let result = run_garbage_collection(repo.path_str(), true, None).await;

        assert!(result.is_ok());
        let gc_result = result.unwrap();
        assert!(gc_result.success);
    }

    #[tokio::test]
    async fn test_run_garbage_collection_with_prune() {
        let repo = TestRepo::with_initial_commit();

        let result =
            run_garbage_collection(repo.path_str(), false, Some("2.weeks.ago".to_string())).await;

        assert!(result.is_ok());
        let gc_result = result.unwrap();
        assert!(gc_result.success);
    }

    #[tokio::test]
    async fn test_run_garbage_collection_invalid_path() {
        let result = run_garbage_collection("/nonexistent/path".to_string(), false, None).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_prune_remote_tracking_branches_no_remotes() {
        let repo = TestRepo::with_initial_commit();

        // A repo without remotes should succeed but prune nothing
        let result = prune_remote_tracking_branches(repo.path_str(), None).await;

        assert!(result.is_ok());
        let prune_result = result.unwrap();
        assert!(prune_result.success);
        assert!(prune_result.branches_pruned.is_empty());
    }

    #[tokio::test]
    async fn test_prune_remote_tracking_branches_specific_remote() {
        let repo = TestRepo::with_initial_commit();

        // Create a second local repo to act as the remote (avoids network calls)
        let remote_repo = TestRepo::with_initial_commit();
        repo.add_remote("origin", &remote_repo.path_str());

        // Pruning a specific remote should work (though there's nothing to prune)
        let result =
            prune_remote_tracking_branches(repo.path_str(), Some("origin".to_string())).await;

        assert!(result.is_ok());
        let prune_result = result.unwrap();
        assert!(prune_result.success);
    }

    #[tokio::test]
    async fn test_prune_remote_tracking_branches_invalid_path() {
        let result = prune_remote_tracking_branches("/nonexistent/path".to_string(), None).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_verify_repository_basic() {
        let repo = TestRepo::with_initial_commit();

        let result = verify_repository(repo.path_str(), false).await;

        assert!(result.is_ok());
        let fsck_result = result.unwrap();
        assert!(fsck_result.is_valid);
        assert!(fsck_result.errors.is_empty());
    }

    #[tokio::test]
    async fn test_verify_repository_full() {
        let repo = TestRepo::with_initial_commit();

        let result = verify_repository(repo.path_str(), true).await;

        assert!(result.is_ok());
        let fsck_result = result.unwrap();
        assert!(fsck_result.is_valid);
        assert!(fsck_result.errors.is_empty());
    }

    #[tokio::test]
    async fn test_verify_repository_invalid_path() {
        let result = verify_repository("/nonexistent/path".to_string(), false).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_repo_size_info_basic() {
        let repo = TestRepo::with_initial_commit();

        let result = get_repo_size_info(repo.path_str()).await;

        assert!(result.is_ok());
        let size_info = result.unwrap();
        // A fresh repo should have some size
        assert!(size_info.total_size_bytes > 0);
        assert!(size_info.objects_size_bytes > 0);
        // Fresh repos will have some loose objects or possibly zero after packing
    }

    #[tokio::test]
    async fn test_get_repo_size_info_with_multiple_commits() {
        let repo = TestRepo::with_initial_commit();

        // Add some more commits
        repo.create_commit("Second commit", &[("file1.txt", "content1")]);
        repo.create_commit("Third commit", &[("file2.txt", "content2")]);

        let result = get_repo_size_info(repo.path_str()).await;

        assert!(result.is_ok());
        let size_info = result.unwrap();
        assert!(size_info.total_size_bytes > 0);
        // Multiple commits should create more objects
        assert!(size_info.loose_objects_count > 0);
    }

    #[tokio::test]
    async fn test_get_repo_size_info_invalid_path() {
        let result = get_repo_size_info("/nonexistent/path".to_string()).await;

        assert!(result.is_err());
    }

    #[test]
    fn test_count_loose_objects() {
        let repo = TestRepo::with_initial_commit();
        let git_dir = repo.path.join(".git");

        let count = count_loose_objects(&git_dir);
        // A fresh repo with one commit should have some loose objects
        assert!(count > 0);
    }

    #[test]
    fn test_count_pack_files_empty() {
        let repo = TestRepo::with_initial_commit();
        let git_dir = repo.path.join(".git");

        let count = count_pack_files(&git_dir);
        // A fresh repo typically has no pack files
        assert_eq!(count, 0);
    }

    #[test]
    fn test_calculate_dir_size() {
        let repo = TestRepo::with_initial_commit();
        let git_dir = repo.path.join(".git");

        let size = calculate_dir_size(&git_dir);
        // Should have some size
        assert!(size > 0);
    }

    #[test]
    fn test_calculate_dir_size_nonexistent() {
        let size = calculate_dir_size(Path::new("/nonexistent/path"));
        assert_eq!(size, 0);
    }

    // ── Tests from origin/main ───────────────────────────────────────────

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
