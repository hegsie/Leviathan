//! File system watcher commands

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{command, AppHandle, Emitter, State};

use crate::error::Result;
use crate::services::WatcherService;

/// Managed state for the file watcher
pub struct WatcherState {
    pub service: Arc<Mutex<WatcherService>>,
    pub watching_path: Arc<Mutex<Option<String>>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            service: Arc::new(Mutex::new(WatcherService::new())),
            watching_path: Arc::new(Mutex::new(None)),
        }
    }
}

/// Events emitted to the frontend
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    pub event_type: String,
    pub paths: Vec<String>,
}

/// Start watching a repository for file changes
#[command]
pub async fn start_watching(
    app: AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<()> {
    let repo_path = Path::new(&path);

    // Stop any existing watcher
    {
        let mut service = state.service.lock().unwrap();
        let mut watching = state.watching_path.lock().unwrap();

        if let Some(ref old_path) = *watching {
            let _ = service.unwatch(Path::new(old_path));
        }

        // Start watching the new path
        service.watch(repo_path)?;
        *watching = Some(path.clone());
    }

    // Spawn a thread to poll for events and emit them to the frontend
    let service = Arc::clone(&state.service);
    let watching_path = Arc::clone(&state.watching_path);

    thread::spawn(move || {
        loop {
            // Check if we're still watching
            {
                let watching = watching_path.lock().unwrap();
                if watching.is_none() {
                    break;
                }
            }

            // Poll for events
            let events = {
                let service = service.lock().unwrap();
                service.poll_events()
            };

            // Emit events to frontend
            for event in events {
                let (event_type, paths) = match event {
                    crate::services::watcher_service::WatcherEvent::WorkdirChanged(p) => (
                        "workdir-changed",
                        p.iter().map(|p| p.to_string_lossy().to_string()).collect(),
                    ),
                    crate::services::watcher_service::WatcherEvent::IndexChanged => {
                        ("index-changed", vec![])
                    }
                    crate::services::watcher_service::WatcherEvent::RefsChanged => {
                        ("refs-changed", vec![])
                    }
                    crate::services::watcher_service::WatcherEvent::ConfigChanged => {
                        ("config-changed", vec![])
                    }
                };

                let _ = app.emit(
                    "file-change",
                    FileChangeEvent {
                        event_type: event_type.to_string(),
                        paths,
                    },
                );
            }

            // Sleep before next poll
            thread::sleep(Duration::from_millis(500));
        }
    });

    Ok(())
}

/// Stop watching the current repository
#[command]
pub async fn stop_watching(state: State<'_, WatcherState>) -> Result<()> {
    let mut service = state.service.lock().unwrap();
    let mut watching = state.watching_path.lock().unwrap();

    if let Some(ref path) = *watching {
        service.unwatch(Path::new(path))?;
    }

    *watching = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::watcher_service::WatcherEvent;
    use crate::test_utils::TestRepo;

    #[test]
    fn test_watcher_state_default() {
        let state = WatcherState::default();

        // Should have an empty watcher service
        let service = state.service.lock().unwrap();
        assert!(service.poll_events().is_empty());

        // Should have no watching path
        let watching = state.watching_path.lock().unwrap();
        assert!(watching.is_none());
    }

    #[test]
    fn test_watcher_state_new() {
        let state = WatcherState {
            service: Arc::new(Mutex::new(WatcherService::new())),
            watching_path: Arc::new(Mutex::new(None)),
        };

        let watching = state.watching_path.lock().unwrap();
        assert!(watching.is_none());
    }

    #[test]
    fn test_file_change_event_serialization() {
        let event = FileChangeEvent {
            event_type: "workdir-changed".to_string(),
            paths: vec![
                "/path/to/file.txt".to_string(),
                "/path/to/other.rs".to_string(),
            ],
        };

        let json = serde_json::to_string(&event).unwrap();

        // Check camelCase serialization
        assert!(json.contains("eventType"));
        assert!(json.contains("workdir-changed"));
        assert!(json.contains("paths"));
        assert!(json.contains("/path/to/file.txt"));
    }

    #[test]
    fn test_file_change_event_empty_paths() {
        let event = FileChangeEvent {
            event_type: "index-changed".to_string(),
            paths: vec![],
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("index-changed"));
        assert!(json.contains("[]"));
    }

    #[test]
    fn test_watcher_service_watch_valid_path() {
        let repo = TestRepo::with_initial_commit();
        let mut service = WatcherService::new();

        let result = service.watch(&repo.path);
        assert!(result.is_ok());

        // Should be able to unwatch
        let unwatch_result = service.unwatch(&repo.path);
        assert!(unwatch_result.is_ok());
    }

    #[test]
    fn test_watcher_service_watch_invalid_path() {
        let mut service = WatcherService::new();
        let invalid_path = Path::new("/this/path/definitely/does/not/exist");

        let result = service.watch(invalid_path);
        // This might succeed on some systems (notify creates the path)
        // or fail if the path is truly invalid
        // The important thing is it doesn't panic
        let _ = result;
    }

    #[test]
    fn test_watcher_service_poll_events_empty() {
        let service = WatcherService::new();

        // Should return empty events when nothing is being watched
        let events = service.poll_events();
        assert!(events.is_empty());
    }

    #[test]
    fn test_watcher_service_unwatch_when_not_watching() {
        let mut service = WatcherService::new();
        let path = Path::new("/some/path");

        // Unwatching when not watching should work (no-op or error, but not panic)
        let result = service.unwatch(path);
        // Result can be Ok or Err depending on implementation, just ensure no panic
        let _ = result;
    }

    #[test]
    fn test_watcher_service_default() {
        let service = WatcherService::default();
        assert!(service.poll_events().is_empty());
    }

    #[test]
    fn test_watcher_service_multiple_watch_unwatch() {
        let repo = TestRepo::with_initial_commit();
        let mut service = WatcherService::new();

        // Watch
        service.watch(&repo.path).unwrap();

        // Unwatch
        service.unwatch(&repo.path).unwrap();

        // Watch again should work
        service.watch(&repo.path).unwrap();

        // Unwatch again
        service.unwatch(&repo.path).unwrap();
    }

    #[test]
    fn test_watcher_event_workdir_changed() {
        use std::path::PathBuf;

        let paths = vec![
            PathBuf::from("/repo/file1.txt"),
            PathBuf::from("/repo/src/main.rs"),
        ];
        let event = WatcherEvent::WorkdirChanged(paths.clone());

        // Test that we can pattern match the event
        match event {
            WatcherEvent::WorkdirChanged(p) => {
                assert_eq!(p.len(), 2);
                assert_eq!(p[0], PathBuf::from("/repo/file1.txt"));
            }
            _ => panic!("Expected WorkdirChanged event"),
        }
    }

    #[test]
    fn test_watcher_event_index_changed() {
        let event = WatcherEvent::IndexChanged;

        match event {
            WatcherEvent::IndexChanged => {}
            _ => panic!("Expected IndexChanged event"),
        }
    }

    #[test]
    fn test_watcher_event_refs_changed() {
        let event = WatcherEvent::RefsChanged;

        match event {
            WatcherEvent::RefsChanged => {}
            _ => panic!("Expected RefsChanged event"),
        }
    }

    #[test]
    fn test_watcher_event_config_changed() {
        let event = WatcherEvent::ConfigChanged;

        match event {
            WatcherEvent::ConfigChanged => {}
            _ => panic!("Expected ConfigChanged event"),
        }
    }

    #[test]
    fn test_watcher_state_concurrent_access() {
        use std::thread;

        let state = WatcherState::default();
        let service_clone = Arc::clone(&state.service);
        let watching_clone = Arc::clone(&state.watching_path);

        // Spawn a thread that reads the state
        let handle = thread::spawn(move || {
            let service = service_clone.lock().unwrap();
            let _events = service.poll_events();

            let watching = watching_clone.lock().unwrap();
            watching.is_none()
        });

        // Main thread also reads
        {
            let service = state.service.lock().unwrap();
            let _ = service.poll_events();
        }

        let result = handle.join().unwrap();
        assert!(result);
    }

    #[test]
    fn test_watcher_state_set_watching_path() {
        let state = WatcherState::default();

        // Set a watching path
        {
            let mut watching = state.watching_path.lock().unwrap();
            *watching = Some("/test/path".to_string());
        }

        // Verify it was set
        {
            let watching = state.watching_path.lock().unwrap();
            assert_eq!(watching.as_ref().unwrap(), "/test/path");
        }

        // Clear it
        {
            let mut watching = state.watching_path.lock().unwrap();
            *watching = None;
        }

        // Verify it was cleared
        {
            let watching = state.watching_path.lock().unwrap();
            assert!(watching.is_none());
        }
    }

    // Note: Testing the actual start_watching and stop_watching commands requires
    // a Tauri State wrapper which is only available in a running Tauri application context.
    // These functions are better tested through integration tests.
    // However, we can test the underlying WatcherService functionality directly.
}
