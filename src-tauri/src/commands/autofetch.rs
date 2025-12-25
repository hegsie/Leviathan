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
