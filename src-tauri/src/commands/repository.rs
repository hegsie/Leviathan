//! Repository command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{Repository, RepositoryState};

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

/// Clone a repository
#[command]
pub async fn clone_repository(
    url: String,
    path: String,
    bare: Option<bool>,
    branch: Option<String>,
) -> Result<Repository> {
    let path = Path::new(&path);

    let mut builder = git2::build::RepoBuilder::new();

    if bare.unwrap_or(false) {
        builder.bare(true);
    }

    if let Some(ref branch) = branch {
        builder.branch(branch);
    }

    let repo = builder.clone(&url, path)?;

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let head_ref = repo
        .head()
        .ok()
        .map(|h| h.shorthand().map(|s| s.to_string()).unwrap_or_default());

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

        let result = init_repository(path.to_string_lossy().to_string(), None).await.unwrap();
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
