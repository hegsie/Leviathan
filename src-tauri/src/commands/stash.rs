//! Stash command handlers

use std::path::Path;
use tauri::command;

use crate::error::Result;
use crate::models::Stash;

/// Get all stashes
#[command]
pub async fn get_stashes(path: String) -> Result<Vec<Stash>> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    let mut stashes = Vec::new();

    repo.stash_foreach(|index, message, oid| {
        stashes.push(Stash {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
        });
        true
    })?;

    Ok(stashes)
}

/// Create a new stash
#[command]
pub async fn create_stash(
    path: String,
    message: Option<String>,
    include_untracked: Option<bool>,
) -> Result<Stash> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    let signature = repo.signature()?;

    let mut flags = git2::StashFlags::DEFAULT;
    if include_untracked.unwrap_or(false) {
        flags |= git2::StashFlags::INCLUDE_UNTRACKED;
    }

    let oid = repo.stash_save(&signature, message.as_deref().unwrap_or("WIP"), Some(flags))?;

    Ok(Stash {
        index: 0,
        message: message.unwrap_or_else(|| "WIP".to_string()),
        oid: oid.to_string(),
    })
}

/// Apply a stash
#[command]
pub async fn apply_stash(path: String, index: usize, drop_after: Option<bool>) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;

    repo.stash_apply(index, None)?;

    if drop_after.unwrap_or(false) {
        repo.stash_drop(index)?;
    }

    Ok(())
}

/// Drop a stash
#[command]
pub async fn drop_stash(path: String, index: usize) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    repo.stash_drop(index)?;
    Ok(())
}

/// Pop a stash (apply and drop)
#[command]
pub async fn pop_stash(path: String, index: usize) -> Result<()> {
    let mut repo = git2::Repository::open(Path::new(&path))?;
    repo.stash_pop(index, None)?;
    Ok(())
}
