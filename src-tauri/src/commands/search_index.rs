//! Search index command handlers

use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::services::commit_index::{IndexedCommit, SharedCommitIndex};

/// Build the search index for a repository
#[command]
pub async fn build_search_index(
    index_state: tauri::State<'_, SharedCommitIndex>,
    path: String,
) -> Result<usize> {
    let path_clone = path.clone();
    let index = tokio::task::spawn_blocking(move || {
        crate::services::commit_index::CommitIndex::build(&path_clone)
    })
    .await
    .map_err(|e| LeviathanError::Custom(format!("Index build failed: {}", e)))??;

    let count = index.len();
    let mut guard = index_state.write().await;
    *guard = Some(index);
    Ok(count)
}

/// Search the commit index
#[command]
pub async fn search_index(
    index_state: tauri::State<'_, SharedCommitIndex>,
    query: Option<String>,
    author: Option<String>,
    date_from: Option<i64>,
    date_to: Option<i64>,
    limit: Option<usize>,
) -> Result<Vec<IndexedCommit>> {
    let guard = index_state.read().await;
    let index = guard
        .as_ref()
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

/// Refresh the search index incrementally
#[command]
pub async fn refresh_search_index(
    index_state: tauri::State<'_, SharedCommitIndex>,
    path: String,
) -> Result<usize> {
    // Take the index out for updating
    let existing = {
        let mut guard = index_state.write().await;
        guard.take()
    };

    if let Some(mut index) = existing {
        let path_clone = path.clone();
        let updated = tokio::task::spawn_blocking(move || {
            let new_count = index.update_incremental(&path_clone)?;
            Ok::<_, LeviathanError>((index, new_count))
        })
        .await
        .map_err(|e| LeviathanError::Custom(format!("Index refresh failed: {}", e)))??;

        let count = updated.0.len();
        let mut guard = index_state.write().await;
        *guard = Some(updated.0);
        Ok(count)
    } else {
        // No index exists, build from scratch
        build_search_index(index_state, path).await
    }
}
