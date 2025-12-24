//! Service layer for Leviathan
//!
//! This module contains services that provide higher-level abstractions
//! over the raw git operations.

pub mod autofetch_service;
pub mod credentials_service;
pub mod git_service;
pub mod watcher_service;

pub use autofetch_service::{create_autofetch_state, AutoFetchState};
pub use credentials_service::CredentialsHelper;
pub use git_service::GitService;
pub use watcher_service::WatcherService;
