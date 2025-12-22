//! Repository models

use serde::{Deserialize, Serialize};

/// Repository information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub path: String,
    pub name: String,
    pub is_valid: bool,
    pub is_bare: bool,
    pub head_ref: Option<String>,
    pub state: RepositoryState,
}

/// Repository state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepositoryState {
    Clean,
    Merge,
    Revert,
    Cherrypick,
    Bisect,
    Rebase,
    RebaseInteractive,
    RebaseMerge,
    ApplyMailbox,
    ApplyMailboxOrRebase,
}

impl From<git2::RepositoryState> for RepositoryState {
    fn from(state: git2::RepositoryState) -> Self {
        match state {
            git2::RepositoryState::Clean => RepositoryState::Clean,
            git2::RepositoryState::Merge => RepositoryState::Merge,
            git2::RepositoryState::Revert | git2::RepositoryState::RevertSequence => {
                RepositoryState::Revert
            }
            git2::RepositoryState::CherryPick | git2::RepositoryState::CherryPickSequence => {
                RepositoryState::Cherrypick
            }
            git2::RepositoryState::Bisect => RepositoryState::Bisect,
            git2::RepositoryState::Rebase => RepositoryState::Rebase,
            git2::RepositoryState::RebaseInteractive => RepositoryState::RebaseInteractive,
            git2::RepositoryState::RebaseMerge => RepositoryState::RebaseMerge,
            git2::RepositoryState::ApplyMailbox => RepositoryState::ApplyMailbox,
            git2::RepositoryState::ApplyMailboxOrRebase => RepositoryState::ApplyMailboxOrRebase,
        }
    }
}

/// Status entry for a file in the working directory
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub status: FileStatus,
    pub is_staged: bool,
    pub is_conflicted: bool,
}

/// File status in the working directory
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileStatus {
    New,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Ignored,
    Untracked,
    Typechange,
    Conflicted,
}
