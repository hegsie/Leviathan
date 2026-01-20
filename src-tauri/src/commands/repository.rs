//! Repository command handlers

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter};

use crate::error::{LeviathanError, Result};
use crate::models::{Repository, RepositoryState};

/// Progress event payload for clone operations
#[derive(Clone, serde::Serialize)]
pub struct CloneProgress {
    pub stage: String,
    pub received_objects: usize,
    pub total_objects: usize,
    pub indexed_objects: usize,
    pub received_bytes: usize,
    pub percent: u8,
}

/// Open an existing repository
#[command]
pub async fn open_repository(path: String) -> Result<Repository> {
    let path = Path::new(&path);

    if !path.exists() {
        return Err(LeviathanError::RepositoryNotFound(
            path.display().to_string(),
        ));
    }

    let repo = git2::Repository::open(path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let head_ref = repo.head().ok().map(|h| {
        h.shorthand().map(|s| s.to_string()).unwrap_or_else(|| {
            h.target()
                .map(|t| t.to_string()[..7].to_string())
                .unwrap_or_default()
        })
    });

    Ok(Repository {
        path: path.display().to_string(),
        name,
        is_valid: true,
        is_bare: repo.is_bare(),
        head_ref,
        state: RepositoryState::from(repo.state()),
    })
}

/// Clone a repository with progress reporting
#[command]
pub async fn clone_repository(
    app: AppHandle,
    url: String,
    path: String,
    bare: Option<bool>,
    branch: Option<String>,
    token: Option<String>,
) -> Result<Repository> {
    let dest_path = std::path::PathBuf::from(&path);
    let url_clone = url.clone();
    let bare = bare.unwrap_or(false);
    let app_for_progress = app.clone();
    let token_clone = token.clone();

    // Run the blocking clone operation in a separate thread
    let result = tokio::task::spawn_blocking(move || {
        let mut builder = git2::build::RepoBuilder::new();

        if bare {
            builder.bare(true);
        }

        if let Some(ref branch) = branch {
            builder.branch(branch);
        }

        // Set up fetch options with credentials and progress callbacks
        let mut fetch_opts = git2::FetchOptions::new();

        // Use CredentialsHelper to get callbacks with authentication support
        let mut callbacks =
            crate::services::CredentialsHelper::new_with_token(token_clone).get_callbacks();

        // Track last emitted percent to avoid spamming events
        let last_percent = Arc::new(AtomicUsize::new(0));
        let last_percent_clone = Arc::clone(&last_percent);
        let app_clone = app_for_progress;

        callbacks.transfer_progress(move |stats| {
            let total = stats.total_objects();
            let received = stats.received_objects();
            let indexed = stats.indexed_objects();

            // Calculate percent (receiving is 0-80%, indexing is 80-100%)
            let percent = if total == 0 {
                0
            } else if received < total {
                // Receiving phase: 0-80%
                (received * 80 / total) as u8
            } else {
                // Indexing phase: 80-100%
                80 + (indexed * 20 / total) as u8
            };

            // Only emit if percent changed
            let prev = last_percent_clone.swap(percent as usize, Ordering::Relaxed);
            if prev != percent as usize {
                let stage = if received < total {
                    "Receiving objects"
                } else {
                    "Indexing objects"
                };

                let progress = CloneProgress {
                    stage: stage.to_string(),
                    received_objects: received,
                    total_objects: total,
                    indexed_objects: indexed,
                    received_bytes: stats.received_bytes(),
                    percent,
                };

                let _ = app_clone.emit("clone-progress", progress);
            }

            true
        });

        fetch_opts.remote_callbacks(callbacks);
        builder.fetch_options(fetch_opts);

        builder.clone(&url_clone, &dest_path)
    })
    .await
    .map_err(|e| LeviathanError::Custom(format!("Clone task failed: {}", e)))?;

    let repo = result?;
    let path = Path::new(&path);

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let head_ref = repo
        .head()
        .ok()
        .map(|h| h.shorthand().map(|s| s.to_string()).unwrap_or_default());

    // Emit completion
    let _ = app.emit(
        "clone-progress",
        CloneProgress {
            stage: "Complete".to_string(),
            received_objects: 0,
            total_objects: 0,
            indexed_objects: 0,
            received_bytes: 0,
            percent: 100,
        },
    );

    Ok(Repository {
        path: path.display().to_string(),
        name,
        is_valid: true,
        is_bare: repo.is_bare(),
        head_ref,
        state: RepositoryState::from(repo.state()),
    })
}

/// Initialize a new repository
#[command]
pub async fn init_repository(path: String, bare: Option<bool>) -> Result<Repository> {
    let path = Path::new(&path);

    let repo = if bare.unwrap_or(false) {
        git2::Repository::init_bare(path)?
    } else {
        git2::Repository::init(path)?
    };

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    Ok(Repository {
        path: path.display().to_string(),
        name,
        is_valid: true,
        is_bare: repo.is_bare(),
        head_ref: None,
        state: RepositoryState::Clean,
    })
}

/// Get information about the current repository
#[command]
pub async fn get_repository_info(path: String) -> Result<Repository> {
    open_repository(path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_open_repository_valid() {
        let repo = TestRepo::with_initial_commit();
        let result = open_repository(repo.path_str()).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
        assert!(!repo_info.is_bare);
    }

    #[tokio::test]
    async fn test_open_repository_gets_name() {
        let repo = TestRepo::with_initial_commit();
        let result = open_repository(repo.path_str()).await.unwrap();
        // The name should be the directory name
        assert!(!result.name.is_empty());
        assert_ne!(result.name, "Unknown");
    }

    #[tokio::test]
    async fn test_open_repository_gets_head_ref() {
        let repo = TestRepo::with_initial_commit();
        let result = open_repository(repo.path_str()).await.unwrap();
        // Should have a head ref after initial commit
        assert!(result.head_ref.is_some());
    }

    #[tokio::test]
    async fn test_open_repository_nonexistent() {
        let result = open_repository("/nonexistent/path/to/repo".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_open_repository_not_a_repo() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let result = open_repository(dir.path().to_string_lossy().to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_init_repository() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("new-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        let result = init_repository(path.to_string_lossy().to_string(), None).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
        assert!(!repo_info.is_bare);
        assert_eq!(repo_info.name, "new-repo");

        // Verify .git directory exists
        assert!(path.join(".git").exists());
    }

    #[tokio::test]
    async fn test_init_repository_bare() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("bare-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        let result = init_repository(path.to_string_lossy().to_string(), Some(true)).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
        assert!(repo_info.is_bare);

        // Bare repos have HEAD directly in the path, no .git directory
        assert!(path.join("HEAD").exists());
    }

    #[tokio::test]
    async fn test_init_repository_state_is_clean() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("clean-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        let result = init_repository(path.to_string_lossy().to_string(), None)
            .await
            .unwrap();
        assert!(matches!(result.state, RepositoryState::Clean));
    }

    #[tokio::test]
    async fn test_get_repository_info() {
        let repo = TestRepo::with_initial_commit();
        let result = get_repository_info(repo.path_str()).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
    }

    #[tokio::test]
    async fn test_open_repository_state_clean() {
        let repo = TestRepo::with_initial_commit();
        let result = open_repository(repo.path_str()).await.unwrap();
        assert!(matches!(result.state, RepositoryState::Clean));
    }

    #[tokio::test]
    async fn test_open_empty_repository() {
        let repo = TestRepo::new(); // No initial commit
        let result = open_repository(repo.path_str()).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
        // Empty repo has no head_ref
        assert!(repo_info.head_ref.is_none());
    }
}
