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
