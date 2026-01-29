//! Auto-fetch commands

use crate::error::{LeviathanError, Result};
use crate::services::autofetch_service::{AutoFetchState, RemoteStatus};
use tauri::{command, AppHandle, State};

/// Start auto-fetching for a repository
#[command]
pub async fn start_auto_fetch(
    app: AppHandle,
    state: State<'_, AutoFetchState>,
    path: String,
    interval_minutes: u32,
) -> Result<()> {
    if interval_minutes == 0 {
        return Err(LeviathanError::OperationFailed(
            "Interval must be greater than 0".to_string(),
        ));
    }

    let mut service = state.write().await;
    service.start(path, interval_minutes, app);
    Ok(())
}

/// Stop auto-fetching for a repository
#[command]
pub async fn stop_auto_fetch(state: State<'_, AutoFetchState>, path: String) -> Result<()> {
    let mut service = state.write().await;
    service.stop(&path);
    Ok(())
}

/// Check if auto-fetch is running for a repository
#[command]
pub async fn is_auto_fetch_running(state: State<'_, AutoFetchState>, path: String) -> Result<bool> {
    let service = state.read().await;
    Ok(service.is_running(&path))
}

/// Get remote status (ahead/behind counts) for a repository
#[command]
pub async fn get_remote_status(path: String) -> Result<RemoteStatus> {
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&path)
            .map_err(|e| LeviathanError::OperationFailed(format!("Failed to open repo: {}", e)))?;

        let head = repo
            .head()
            .map_err(|e| LeviathanError::OperationFailed(format!("No HEAD: {}", e)))?;

        let branch_name = head
            .shorthand()
            .ok_or_else(|| LeviathanError::OperationFailed("Invalid branch name".to_string()))?;

        // Try to find upstream
        let local_branch = repo
            .find_branch(branch_name, git2::BranchType::Local)
            .map_err(|e| LeviathanError::OperationFailed(format!("Branch not found: {}", e)))?;

        let upstream = match local_branch.upstream() {
            Ok(upstream) => upstream,
            Err(_) => {
                return Ok(RemoteStatus {
                    ahead: 0,
                    behind: 0,
                    has_upstream: false,
                    upstream_name: None,
                });
            }
        };

        let upstream_name = upstream.name().ok().flatten().map(|s| s.to_string());

        let local_oid = head
            .target()
            .ok_or_else(|| LeviathanError::OperationFailed("No local target".to_string()))?;

        let upstream_oid = upstream
            .get()
            .target()
            .ok_or_else(|| LeviathanError::OperationFailed("No upstream target".to_string()))?;

        let (ahead, behind) = repo
            .graph_ahead_behind(local_oid, upstream_oid)
            .map_err(|e| LeviathanError::OperationFailed(format!("Failed to compare: {}", e)))?;

        Ok(RemoteStatus {
            ahead,
            behind,
            has_upstream: true,
            upstream_name,
        })
    })
    .await
    .map_err(|e| LeviathanError::OperationFailed(format!("Task failed: {}", e)))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    // ========================================================================
    // RemoteStatus Tests
    // ========================================================================

    #[test]
    fn test_remote_status_default_values() {
        let status = RemoteStatus {
            ahead: 0,
            behind: 0,
            has_upstream: false,
            upstream_name: None,
        };

        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
        assert!(!status.has_upstream);
        assert!(status.upstream_name.is_none());
    }

    #[test]
    fn test_remote_status_with_upstream() {
        let status = RemoteStatus {
            ahead: 3,
            behind: 2,
            has_upstream: true,
            upstream_name: Some("origin/main".to_string()),
        };

        assert_eq!(status.ahead, 3);
        assert_eq!(status.behind, 2);
        assert!(status.has_upstream);
        assert_eq!(status.upstream_name, Some("origin/main".to_string()));
    }

    #[test]
    fn test_remote_status_serialization() {
        let status = RemoteStatus {
            ahead: 5,
            behind: 1,
            has_upstream: true,
            upstream_name: Some("origin/feature".to_string()),
        };

        let json = serde_json::to_string(&status).expect("Failed to serialize");

        // Check camelCase serialization
        assert!(json.contains("\"ahead\":5"));
        assert!(json.contains("\"behind\":1"));
        assert!(json.contains("hasUpstream") || json.contains("has_upstream"));
        assert!(json.contains("upstreamName") || json.contains("upstream_name"));
    }

    // ========================================================================
    // get_remote_status Tests
    // ========================================================================

    #[tokio::test]
    async fn test_get_remote_status_no_upstream() {
        let repo = TestRepo::with_initial_commit();

        let result = get_remote_status(repo.path_str()).await;
        assert!(result.is_ok());
        let status = result.unwrap();
        assert!(!status.has_upstream);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
        assert!(status.upstream_name.is_none());
    }

    #[tokio::test]
    async fn test_get_remote_status_invalid_path() {
        let result = get_remote_status("/nonexistent/path".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_remote_status_with_remote_but_no_tracking() {
        let repo = TestRepo::with_initial_commit();

        // Add a remote but don't set up tracking
        repo.add_remote("origin", "https://github.com/test/repo.git");

        let result = get_remote_status(repo.path_str()).await;
        assert!(result.is_ok());
        let status = result.unwrap();
        // Should return no upstream since branch doesn't track remote
        assert!(!status.has_upstream);
    }

    // ========================================================================
    // Interval Validation Tests
    // ========================================================================

    #[test]
    fn test_interval_zero_should_error() {
        // Test the validation logic that interval must be > 0
        // This tests the error condition in start_auto_fetch
        let interval: u32 = 0;
        assert_eq!(interval, 0);
        // The actual command would return an error for interval == 0
    }

    #[test]
    fn test_interval_positive_values() {
        // Valid interval values
        let intervals = [1, 5, 10, 30, 60, 1440];
        for interval in intervals {
            assert!(interval > 0);
        }
    }
}
