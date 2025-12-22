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
        return Err(LeviathanError::RepositoryNotFound(path.display().to_string()));
    }

    let repo = git2::Repository::open(path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let head_ref = repo.head().ok().map(|h| {
        h.shorthand()
            .map(|s| s.to_string())
            .unwrap_or_else(|| h.target().map(|t| t.to_string()[..7].to_string()).unwrap_or_default())
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

    let head_ref = repo.head().ok().map(|h| {
        h.shorthand()
            .map(|s| s.to_string())
            .unwrap_or_default()
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
