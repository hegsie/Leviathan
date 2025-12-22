//! Error types for Leviathan

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

    #[error("Branch not found: {0}")]
    BranchNotFound(String),

    #[error("Commit not found: {0}")]
    CommitNotFound(String),

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

    #[error("Invalid reference")]
    InvalidReference,

    #[error("{0}")]
    Custom(String),
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
            LeviathanError::BranchNotFound(_) => "BRANCH_NOT_FOUND",
            LeviathanError::CommitNotFound(_) => "COMMIT_NOT_FOUND",
            LeviathanError::RemoteNotFound(_) => "REMOTE_NOT_FOUND",
            LeviathanError::OperationFailed(_) => "OPERATION_FAILED",
            LeviathanError::AuthenticationRequired => "AUTH_REQUIRED",
            LeviathanError::MergeConflict => "MERGE_CONFLICT",
            LeviathanError::RebaseInProgress => "REBASE_IN_PROGRESS",
            LeviathanError::RebaseConflict => "REBASE_CONFLICT",
            LeviathanError::InvalidReference => "INVALID_REFERENCE",
            LeviathanError::Custom(_) => "CUSTOM_ERROR",
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
                LeviathanError::BranchNotFound(_) => "BRANCH_NOT_FOUND",
                LeviathanError::CommitNotFound(_) => "COMMIT_NOT_FOUND",
                LeviathanError::RemoteNotFound(_) => "REMOTE_NOT_FOUND",
                LeviathanError::OperationFailed(_) => "OPERATION_FAILED",
                LeviathanError::AuthenticationRequired => "AUTH_REQUIRED",
                LeviathanError::MergeConflict => "MERGE_CONFLICT",
                LeviathanError::RebaseInProgress => "REBASE_IN_PROGRESS",
                LeviathanError::RebaseConflict => "REBASE_CONFLICT",
                LeviathanError::InvalidReference => "INVALID_REFERENCE",
                LeviathanError::Custom(_) => "CUSTOM_ERROR",
            }
            .to_string(),
            message: self.to_string(),
            details: None,
        };
        response.serialize(serializer)
    }
}

/// Result type alias for Leviathan operations
pub type Result<T> = std::result::Result<T, LeviathanError>;
