//! Error types for Gitnado

use serde::Serialize;
use thiserror::Error;

/// Application error types
#[derive(Error, Debug)]
pub enum LeviathanError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Repository not found: {0}")]
    RepositoryNotFound(String),

    #[error("Repository not open")]
    RepositoryNotOpen,

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    /// The requested file does not exist on disk. Distinct from other read
    /// failures (permissions, invalid encoding) so callers can tell "the
    /// file is GONE" from "the file exists but could not be decoded".
    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Branch not found: {0}")]
    BranchNotFound(String),

    #[error("Commit not found: {0}")]
    CommitNotFound(String),

    #[error("Tag not found: {0}")]
    TagNotFound(String),

    #[error("Remote not found: {0}")]
    RemoteNotFound(String),

    #[error("Operation failed: {0}")]
    OperationFailed(String),

    #[error("Authentication required")]
    AuthenticationRequired,

    #[error("Merge conflict")]
    MergeConflict,

    #[error("Rebase in progress")]
    RebaseInProgress,

    #[error("Rebase conflict")]
    RebaseConflict,

    /// The rebase advanced but stopped again at the next `edit`/`break` line.
    ///
    /// Distinct from RebaseConflict: nothing needs resolving, and distinct
    /// from a plain failure, because the remedy (amend the commit) lives
    /// outside the conflict dialog — so the dialog must CLOSE rather than stay
    /// open offering a retry it cannot help with.
    #[error("Rebase paused")]
    RebasePaused,

    #[error("Cherry-pick conflict")]
    CherryPickConflict,

    #[error("Cherry-pick in progress")]
    CherryPickInProgress,

    #[error("Revert conflict")]
    RevertConflict,

    #[error("Revert in progress")]
    RevertInProgress,

    #[error("Invalid reference")]
    InvalidReference,

    /// `git describe` ran fine but found no tag reachable from the target.
    ///
    /// Distinct from OperationFailed: in a repository that has not been
    /// tagged yet this is the ordinary answer for every commit in it, not a
    /// fault, so the UI shows an empty state instead of an error.
    #[error("No tags reachable from {0}")]
    NoTagsReachable(String),

    #[error("{0}")]
    Custom(String),

    #[error("OAuth error: {0}")]
    OAuth(String),

    #[error("Operation timed out: {0}")]
    OperationTimeout(String),

    /// Timed out AFTER the operation had already changed the repository — a
    /// pull whose fetch succeeded (remote-tracking refs and FETCH_HEAD are
    /// written) and only then hit its deadline guard.
    ///
    /// Reported to the frontend exactly like `OperationTimeout` (same code,
    /// same message). It exists only so `await_remote_task` can tell it from a
    /// transfer the deadline aborted before anything was written: the aborted
    /// transfer is the outcome the caller was already told about and is
    /// suppressed, while this one changed the repository and must still reach
    /// the late reporter so the UI refreshes.
    #[error("Operation timed out: {0}")]
    OperationTimeoutAfterChange(String),

    #[error("Operation cancelled")]
    OperationCancelled,

    /// A fetch/pull/push is already running against this repository.
    ///
    /// Distinct from OperationFailed so the UI can present it as "wait and
    /// retry" rather than as a git failure: nothing went wrong, the work
    /// simply has not finished yet. It is reachable specifically AFTER a
    /// network timeout, when the abandoned blocking task is still live —
    /// see services/remote_ops.rs.
    #[error("{0}")]
    RemoteOperationInFlight(String),
}

/// Serializable error response for IPC
#[derive(Serialize, Debug)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl From<LeviathanError> for ErrorResponse {
    fn from(error: LeviathanError) -> Self {
        let code = match &error {
            LeviathanError::Git(_) => "GIT_ERROR",
            LeviathanError::Io(_) => "IO_ERROR",
            LeviathanError::Database(_) => "DB_ERROR",
            LeviathanError::Serialization(_) => "SERIALIZATION_ERROR",
            LeviathanError::RepositoryNotFound(_) => "REPO_NOT_FOUND",
            LeviathanError::RepositoryNotOpen => "REPO_NOT_OPEN",
            LeviathanError::InvalidPath(_) => "INVALID_PATH",
            LeviathanError::FileNotFound(_) => "FILE_NOT_FOUND",
            LeviathanError::BranchNotFound(_) => "BRANCH_NOT_FOUND",
            LeviathanError::CommitNotFound(_) => "COMMIT_NOT_FOUND",
            LeviathanError::TagNotFound(_) => "TAG_NOT_FOUND",
            LeviathanError::RemoteNotFound(_) => "REMOTE_NOT_FOUND",
            LeviathanError::OperationFailed(_) => "OPERATION_FAILED",
            LeviathanError::AuthenticationRequired => "AUTH_REQUIRED",
            LeviathanError::MergeConflict => "MERGE_CONFLICT",
            LeviathanError::RebaseInProgress => "REBASE_IN_PROGRESS",
            LeviathanError::RebaseConflict => "REBASE_CONFLICT",
            LeviathanError::RebasePaused => "REBASE_PAUSED",
            LeviathanError::CherryPickConflict => "CHERRY_PICK_CONFLICT",
            LeviathanError::CherryPickInProgress => "CHERRY_PICK_IN_PROGRESS",
            LeviathanError::RevertConflict => "REVERT_CONFLICT",
            LeviathanError::RevertInProgress => "REVERT_IN_PROGRESS",
            LeviathanError::InvalidReference => "INVALID_REFERENCE",
            LeviathanError::NoTagsReachable(_) => "NO_TAGS_REACHABLE",
            LeviathanError::Custom(_) => "CUSTOM_ERROR",
            LeviathanError::OAuth(_) => "OAUTH_ERROR",
            LeviathanError::OperationTimeout(_) => "OPERATION_TIMEOUT",
            // Deliberately the SAME code: to the frontend this is a timeout
            // like any other. The distinction is internal to await_remote_task.
            LeviathanError::OperationTimeoutAfterChange(_) => "OPERATION_TIMEOUT",
            LeviathanError::OperationCancelled => "OPERATION_CANCELLED",
            LeviathanError::RemoteOperationInFlight(_) => "REMOTE_OPERATION_IN_FLIGHT",
        };

        ErrorResponse {
            code: code.to_string(),
            message: error.to_string(),
            details: None,
        }
    }
}

// Implement conversion to make errors work with Tauri commands
impl serde::Serialize for LeviathanError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let response = ErrorResponse {
            code: match self {
                LeviathanError::Git(_) => "GIT_ERROR",
                LeviathanError::Io(_) => "IO_ERROR",
                LeviathanError::Database(_) => "DB_ERROR",
                LeviathanError::Serialization(_) => "SERIALIZATION_ERROR",
                LeviathanError::RepositoryNotFound(_) => "REPO_NOT_FOUND",
                LeviathanError::RepositoryNotOpen => "REPO_NOT_OPEN",
                LeviathanError::InvalidPath(_) => "INVALID_PATH",
                LeviathanError::FileNotFound(_) => "FILE_NOT_FOUND",
                LeviathanError::BranchNotFound(_) => "BRANCH_NOT_FOUND",
                LeviathanError::CommitNotFound(_) => "COMMIT_NOT_FOUND",
                LeviathanError::TagNotFound(_) => "TAG_NOT_FOUND",
                LeviathanError::RemoteNotFound(_) => "REMOTE_NOT_FOUND",
                LeviathanError::OperationFailed(_) => "OPERATION_FAILED",
                LeviathanError::AuthenticationRequired => "AUTH_REQUIRED",
                LeviathanError::MergeConflict => "MERGE_CONFLICT",
                LeviathanError::RebaseInProgress => "REBASE_IN_PROGRESS",
                LeviathanError::RebaseConflict => "REBASE_CONFLICT",
                LeviathanError::RebasePaused => "REBASE_PAUSED",
                LeviathanError::CherryPickConflict => "CHERRY_PICK_CONFLICT",
                LeviathanError::CherryPickInProgress => "CHERRY_PICK_IN_PROGRESS",
                LeviathanError::RevertConflict => "REVERT_CONFLICT",
                LeviathanError::RevertInProgress => "REVERT_IN_PROGRESS",
                LeviathanError::InvalidReference => "INVALID_REFERENCE",
                LeviathanError::NoTagsReachable(_) => "NO_TAGS_REACHABLE",
                LeviathanError::Custom(_) => "CUSTOM_ERROR",
                LeviathanError::OAuth(_) => "OAUTH_ERROR",
                LeviathanError::OperationTimeout(_) => "OPERATION_TIMEOUT",
                LeviathanError::OperationTimeoutAfterChange(_) => "OPERATION_TIMEOUT",
                LeviathanError::OperationCancelled => "OPERATION_CANCELLED",
                LeviathanError::RemoteOperationInFlight(_) => "REMOTE_OPERATION_IN_FLIGHT",
            }
            .to_string(),
            message: self.to_string(),
            details: None,
        };
        response.serialize(serializer)
    }
}

/// Result type alias for Gitnado operations
pub type Result<T> = std::result::Result<T, LeviathanError>;
