//! Search index command handlers
//!
//! Indexes are kept per repository path so multiple open repositories never
//! share (or corrupt) each other's index.

use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::services::commit_index::{CommitIndex, IndexedCommit, SharedCommitIndex};

/// Build the search index for a repository
#[command]
pub async fn build_search_index(
    index_state: tauri::State<'_, SharedCommitIndex>,
    path: String,
) -> Result<usize> {
    let path_clone = path.clone();
    let index = tokio::task::spawn_blocking(move || CommitIndex::build(&path_clone))
        .await
        .map_err(|e| LeviathanError::Custom(format!("Index build failed: {}", e)))??;

    let count = index.len();
    let mut guard = index_state.write().await;
    guard.insert(path, index);
    Ok(count)
}

/// Search the commit index of a specific repository
#[command]
pub async fn search_index(
    index_state: tauri::State<'_, SharedCommitIndex>,
    path: String,
    query: Option<String>,
    author: Option<String>,
    date_from: Option<i64>,
    date_to: Option<i64>,
    limit: Option<usize>,
) -> Result<Vec<IndexedCommit>> {
    let guard = index_state.read().await;
    let index = guard
        .get(&path)
        .ok_or_else(|| LeviathanError::OperationFailed("Search index not built yet".to_string()))?;

    let results = index.search(
        query.as_deref(),
        author.as_deref(),
        date_from,
        date_to,
        limit,
    );

    Ok(results.into_iter().cloned().collect())
}

/// Refresh the search index of a repository incrementally
#[command]
pub async fn refresh_search_index(
    index_state: tauri::State<'_, SharedCommitIndex>,
    path: String,
) -> Result<usize> {
    // Take this repo's index out for updating so the lock isn't held across
    // the blocking revwalk; other repos' indexes stay available meanwhile.
    let existing = {
        let mut guard = index_state.write().await;
        guard.remove(&path)
    };

    if let Some(mut index) = existing {
        let path_clone = path.clone();
        let updated = tokio::task::spawn_blocking(move || {
            index.update_incremental(&path_clone)?;
            Ok::<_, LeviathanError>(index)
        })
        .await
        .map_err(|e| LeviathanError::Custom(format!("Index refresh failed: {}", e)))??;

        let count = updated.len();
        let mut guard = index_state.write().await;
        guard.insert(path, updated);
        Ok(count)
    } else {
        // No index exists, build from scratch
        build_search_index(index_state, path).await
    }
}

/// Drop the search index of a repository (e.g., when its tab is closed)
#[command]
pub async fn drop_search_index(
    index_state: tauri::State<'_, SharedCommitIndex>,
    path: String,
) -> Result<()> {
    let mut guard = index_state.write().await;
    guard.remove(&path);
    Ok(())
}
