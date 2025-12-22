//! File system watcher service

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};

use crate::error::{LeviathanError, Result};

/// Events emitted by the watcher
#[derive(Debug, Clone)]
pub enum WatcherEvent {
    /// Files in the working directory changed
    WorkdirChanged(Vec<PathBuf>),
    /// The git index changed
    IndexChanged,
    /// References (branches, tags) changed
    RefsChanged,
    /// Configuration changed
    ConfigChanged,
}

/// Service for watching file system changes in a repository
pub struct WatcherService {
    watcher: Option<RecommendedWatcher>,
    event_rx: Option<Receiver<Result<Event>>>,
}

impl WatcherService {
    /// Create a new WatcherService
    pub fn new() -> Self {
        Self {
            watcher: None,
            event_rx: None,
        }
    }

    /// Start watching a repository
    pub fn watch(&mut self, repo_path: &Path) -> Result<()> {
        let (tx, rx) = channel();

        let config = Config::default().with_poll_interval(Duration::from_secs(1));

        let tx_clone = tx.clone();
        let watcher = RecommendedWatcher::new(
            move |result: std::result::Result<Event, notify::Error>| {
                let event = result
                    .map_err(|e| LeviathanError::OperationFailed(format!("Watch error: {}", e)));
                let _ = tx_clone.send(event);
            },
            config,
        )
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to create watcher: {}", e)))?;

        self.watcher = Some(watcher);
        self.event_rx = Some(rx);

        // Watch the repository directory
        if let Some(ref mut w) = self.watcher {
            w.watch(repo_path, RecursiveMode::Recursive)
                .map_err(|e| LeviathanError::OperationFailed(format!("Failed to watch: {}", e)))?;
        }

        Ok(())
    }

    /// Stop watching
    pub fn unwatch(&mut self, repo_path: &Path) -> Result<()> {
        if let Some(ref mut w) = self.watcher {
            w.unwatch(repo_path).map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to unwatch: {}", e))
            })?;
        }
        self.watcher = None;
        self.event_rx = None;
        Ok(())
    }

    /// Get pending events (non-blocking)
    pub fn poll_events(&self) -> Vec<WatcherEvent> {
        let mut events = Vec::new();

        if let Some(ref rx) = self.event_rx {
            while let Ok(result) = rx.try_recv() {
                if let Ok(event) = result {
                    if let Some(watcher_event) = Self::classify_event(&event) {
                        events.push(watcher_event);
                    }
                }
            }
        }

        events
    }

    /// Classify a notify event into our event types
    fn classify_event(event: &Event) -> Option<WatcherEvent> {
        let paths: Vec<PathBuf> = event.paths.clone();

        if paths.is_empty() {
            return None;
        }

        // Check if any path is in .git directory
        let git_paths: Vec<&PathBuf> = paths
            .iter()
            .filter(|p| p.components().any(|c| c.as_os_str() == ".git"))
            .collect();

        if !git_paths.is_empty() {
            // Check for specific git files
            for path in &git_paths {
                let path_str = path.to_string_lossy();

                if path_str.contains("index") {
                    return Some(WatcherEvent::IndexChanged);
                }

                if path_str.contains("refs") || path_str.contains("HEAD") {
                    return Some(WatcherEvent::RefsChanged);
                }

                if path_str.contains("config") {
                    return Some(WatcherEvent::ConfigChanged);
                }
            }
        }

        // Working directory changes
        let workdir_paths: Vec<PathBuf> = paths
            .into_iter()
            .filter(|p| !p.components().any(|c| c.as_os_str() == ".git"))
            .collect();

        if !workdir_paths.is_empty() {
            return Some(WatcherEvent::WorkdirChanged(workdir_paths));
        }

        None
    }
}

impl Default for WatcherService {
    fn default() -> Self {
        Self::new()
    }
}
