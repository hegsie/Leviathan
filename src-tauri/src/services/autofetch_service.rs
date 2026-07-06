//! Auto-fetch service for periodic repository fetching

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

/// Auto-fetch state for a single repository
struct RepoFetchState {
    task: JoinHandle<()>,
}

/// Global auto-fetch service state
pub struct AutoFetchService {
    repos: HashMap<String, RepoFetchState>,
}

impl Default for AutoFetchService {
    fn default() -> Self {
        Self::new()
    }
}

impl AutoFetchService {
    pub fn new() -> Self {
        Self {
            repos: HashMap::new(),
        }
    }

    /// Start auto-fetching for a repository
    pub fn start(
        &mut self,
        repo_path: String,
        interval_minutes: u32,
        app_handle: tauri::AppHandle,
    ) {
        // Stop any existing task for this repo
        self.stop(&repo_path);

        let path = repo_path.clone();
        let interval = Duration::from_secs(interval_minutes as u64 * 60);
        let initial_delay = interval + stagger_offset(&repo_path, interval);

        let task = tokio::spawn(async move {
            // The first tick is staggered per repo so that many open repos
            // don't all fetch at the same instant (thundering herd on every
            // interval boundary); afterwards each repo keeps its own cadence.
            tokio::time::sleep(initial_delay).await;
            loop {
                // Perform fetch
                tracing::info!("Auto-fetching repository: {}", path);

                match perform_fetch(&path).await {
                    Ok(status) => {
                        tracing::info!("Auto-fetch complete for {}: {:?}", path, status);

                        // Emit event about remote status
                        let _ = app_handle.emit(
                            "autofetch-completed",
                            AutoFetchEvent {
                                repo_path: path.clone(),
                                success: true,
                                behind: status.behind,
                                ahead: status.ahead,
                                message: None,
                            },
                        );

                        // If there are remote updates, emit a separate event
                        if status.behind > 0 {
                            let _ = app_handle.emit(
                                "remote-updates-available",
                                RemoteUpdatesEvent {
                                    repo_path: path.clone(),
                                    behind: status.behind,
                                    ahead: status.ahead,
                                },
                            );
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Auto-fetch failed for {}: {}", path, e);

                        let _ = app_handle.emit(
                            "autofetch-completed",
                            AutoFetchEvent {
                                repo_path: path.clone(),
                                success: false,
                                behind: 0,
                                ahead: 0,
                                message: Some(e.to_string()),
                            },
                        );
                    }
                }

                tokio::time::sleep(interval).await;
            }
        });

        self.repos.insert(repo_path, RepoFetchState { task });
    }

    /// Stop auto-fetching for a repository
    pub fn stop(&mut self, repo_path: &str) {
        if let Some(state) = self.repos.remove(repo_path) {
            state.task.abort();
        }
    }

    /// Stop all auto-fetch tasks
    pub fn stop_all(&mut self) {
        for (_, state) in self.repos.drain() {
            state.task.abort();
        }
    }

    /// Check if auto-fetch is running for a repository
    pub fn is_running(&self, repo_path: &str) -> bool {
        self.repos.contains_key(repo_path)
    }
}

/// Remote status information
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub ahead: usize,
    pub behind: usize,
    pub has_upstream: bool,
    pub upstream_name: Option<String>,
}

/// Auto-fetch completion event
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoFetchEvent {
    repo_path: String,
    success: bool,
    behind: usize,
    ahead: usize,
    message: Option<String>,
}

/// Remote updates available event
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteUpdatesEvent {
    repo_path: String,
    behind: usize,
    ahead: usize,
}

/// Deterministic per-repo stagger within [0, interval/2), derived from the
/// repo path. Keeps simultaneous fetches for many open repos spread out
/// without needing shared state or randomness.
fn stagger_offset(repo_path: &str, interval: Duration) -> Duration {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let half = interval.as_secs() / 2;
    if half == 0 {
        return Duration::ZERO;
    }
    let mut hasher = DefaultHasher::new();
    repo_path.hash(&mut hasher);
    Duration::from_secs(hasher.finish() % half)
}

/// Perform a fetch operation
async fn perform_fetch(repo_path: &str) -> Result<RemoteStatus, String> {
    let path = repo_path.to_string();

    tokio::task::spawn_blocking(move || {
        let repo =
            git2::Repository::open(&path).map_err(|e| format!("Failed to open repo: {}", e))?;

        // Get the default remote (usually origin)
        let remote_name = "origin";

        let mut remote = repo
            .find_remote(remote_name)
            .map_err(|e| format!("Failed to find remote: {}", e))?;

        // Use the shared credentials helper (reads from OS keyring via `security` CLI
        // on macOS, avoiding Keychain authorization dialogs)
        let mut fetch_opts = crate::services::credentials_service::get_fetch_options(None);

        // Perform fetch
        remote
            .fetch(&[] as &[&str], Some(&mut fetch_opts), None)
            .map_err(|e| format!("Fetch failed: {}", e))?;

        // Get remote status
        get_remote_status_internal(&repo)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Get remote status (ahead/behind counts)
fn get_remote_status_internal(repo: &git2::Repository) -> Result<RemoteStatus, String> {
    let head = repo.head().map_err(|e| format!("No HEAD: {}", e))?;

    let branch_name = head
        .shorthand()
        .map_err(|_| "Invalid branch name".to_string())?;

    // Try to find upstream
    let local_branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .map_err(|e| format!("Branch not found: {}", e))?;

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

    let local_oid = head.target().ok_or_else(|| "No local target".to_string())?;

    let upstream_oid = upstream
        .get()
        .target()
        .ok_or_else(|| "No upstream target".to_string())?;

    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|e| format!("Failed to compare: {}", e))?;

    Ok(RemoteStatus {
        ahead,
        behind,
        has_upstream: true,
        upstream_name,
    })
}

/// Global auto-fetch state
pub type AutoFetchState = Arc<RwLock<AutoFetchService>>;

/// Create default auto-fetch state
pub fn create_autofetch_state() -> AutoFetchState {
    Arc::new(RwLock::new(AutoFetchService::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stagger_offset_is_deterministic() {
        let interval = Duration::from_secs(300);
        assert_eq!(
            stagger_offset("/repo/one", interval),
            stagger_offset("/repo/one", interval)
        );
    }

    #[test]
    fn test_stagger_offset_within_half_interval() {
        let interval = Duration::from_secs(300);
        for path in ["/a", "/b", "/c/deep/path", "/repo with spaces"] {
            let offset = stagger_offset(path, interval);
            assert!(
                offset < Duration::from_secs(150),
                "offset {offset:?} for {path}"
            );
        }
    }

    #[test]
    fn test_stagger_offset_spreads_different_repos() {
        let interval = Duration::from_secs(600);
        let offsets: std::collections::HashSet<u64> = (0..20)
            .map(|i| stagger_offset(&format!("/repo/{i}"), interval).as_secs())
            .collect();
        // 20 repos over a 300s window: requiring at least a few distinct
        // slots keeps the test robust while catching a constant offset.
        assert!(offsets.len() > 5, "expected spread, got {offsets:?}");
    }

    #[test]
    fn test_stagger_offset_zero_interval() {
        assert_eq!(stagger_offset("/repo", Duration::ZERO), Duration::ZERO);
        assert_eq!(
            stagger_offset("/repo", Duration::from_secs(1)),
            Duration::ZERO
        );
    }
}
