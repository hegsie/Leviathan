//! File system watcher service
//!
//! Watches any number of repositories at once. Every event is tagged with the
//! repository path it came from so consumers can route it to the right repo.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
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

/// Service for watching file system changes across open repositories
pub struct WatcherService {
    watchers: HashMap<String, RecommendedWatcher>,
    event_tx: Sender<(String, Result<Event>)>,
    event_rx: Receiver<(String, Result<Event>)>,
}

impl WatcherService {
    /// Create a new WatcherService
    pub fn new() -> Self {
        let (event_tx, event_rx) = channel();
        Self {
            watchers: HashMap::new(),
            event_tx,
            event_rx,
        }
    }

    /// Start watching a repository. Watching the same path again is a no-op;
    /// other repositories already being watched are unaffected.
    pub fn watch(&mut self, repo_path: &Path) -> Result<()> {
        let key = repo_path.to_string_lossy().to_string();
        if self.watchers.contains_key(&key) {
            return Ok(());
        }

        let config = Config::default().with_poll_interval(Duration::from_secs(1));

        let tx = self.event_tx.clone();
        let event_key = key.clone();
        let mut watcher = RecommendedWatcher::new(
            move |result: std::result::Result<Event, notify::Error>| {
                let event = result
                    .map_err(|e| LeviathanError::OperationFailed(format!("Watch error: {}", e)));
                let _ = tx.send((event_key.clone(), event));
            },
            config,
        )
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to create watcher: {}", e)))?;

        watcher
            .watch(repo_path, RecursiveMode::Recursive)
            .map_err(|e| LeviathanError::OperationFailed(format!("Failed to watch: {}", e)))?;

        self.watchers.insert(key, watcher);
        Ok(())
    }

    /// Stop watching a repository. Other repositories keep their watchers.
    pub fn unwatch(&mut self, repo_path: &Path) -> Result<()> {
        let key = repo_path.to_string_lossy().to_string();
        if let Some(mut watcher) = self.watchers.remove(&key) {
            let _ = watcher.unwatch(repo_path);
        }
        Ok(())
    }

    /// Stop watching all repositories
    pub fn unwatch_all(&mut self) {
        self.watchers.clear();
    }

    /// Number of repositories currently being watched
    pub fn watcher_count(&self) -> usize {
        self.watchers.len()
    }

    /// Get pending events (non-blocking), each tagged with the repository
    /// path the event came from
    pub fn poll_events(&self) -> Vec<(String, WatcherEvent)> {
        let mut events = Vec::new();

        while let Ok((repo_path, result)) = self.event_rx.try_recv() {
            if let Ok(event) = result {
                if let Some(watcher_event) = Self::classify_event(&event) {
                    events.push((repo_path, watcher_event));
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
