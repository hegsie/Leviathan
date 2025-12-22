//! Commit command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::Commit;

/// Get commit history
#[command]
pub async fn get_commit_history(
    path: String,
    start_oid: Option<String>,
    limit: Option<usize>,
    skip: Option<usize>,
    all_branches: Option<bool>,
) -> Result<Vec<Commit>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;

    if all_branches.unwrap_or(false) {
        // Push all branch heads for complete graph
        for reference in repo.references()?.flatten() {
            if let Some(oid) = reference.target() {
                let _ = revwalk.push(oid);
            }
        }
    } else if let Some(ref oid_str) = start_oid {
        let start = git2::Oid::from_str(oid_str)?;
        revwalk.push(start)?;
    } else {
        let start = repo
            .head()?
            .target()
            .ok_or(LeviathanError::RepositoryNotOpen)?;
        revwalk.push(start)?;
    }

    let skip_count = skip.unwrap_or(0);
    let limit_count = limit.unwrap_or(100);

    let commits: Vec<Commit> = revwalk
        .skip(skip_count)
        .take(limit_count)
        .filter_map(|oid_result| {
            oid_result
                .ok()
                .and_then(|oid| repo.find_commit(oid).ok().map(|c| Commit::from_git2(&c)))
        })
        .collect();

    Ok(commits)
}

/// Get a single commit by OID
#[command]
pub async fn get_commit(path: String, oid: String) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let oid = git2::Oid::from_str(&oid)?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| LeviathanError::CommitNotFound(oid.to_string()))?;

    Ok(Commit::from_git2(&commit))
}

/// Create a new commit
#[command]
pub async fn create_commit(path: String, message: String, amend: Option<bool>) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let signature = repo.signature()?;
    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    let commit_oid = if amend.unwrap_or(false) {
        let head_commit = repo.head()?.peel_to_commit()?;
        let parent_ids: Vec<git2::Oid> = head_commit.parent_ids().collect();
        let parents: Vec<git2::Commit> = parent_ids
            .iter()
            .filter_map(|id| repo.find_commit(*id).ok())
            .collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parent_refs,
        )?
    } else {
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.as_ref().into_iter().collect();

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parents,
        )?
    };

    let commit = repo.find_commit(commit_oid)?;
    Ok(Commit::from_git2(&commit))
}
