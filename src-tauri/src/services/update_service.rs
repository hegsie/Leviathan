//! Auto-update service for periodic update checking and installation

use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

/// Update check event payload
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckEvent {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_notes: Option<String>,
}

/// Update download progress event
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub progress_percent: f64,
}

/// Update error event
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateErrorEvent {
    pub message: String,
}

/// Global update service state
pub struct UpdateService {
    check_task: Option<JoinHandle<()>>,
}

impl Default for UpdateService {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateService {
    pub fn new() -> Self {
        Self { check_task: None }
    }

    /// Start periodic update checking
    pub fn start_periodic_check(&mut self, interval_hours: u32, app_handle: tauri::AppHandle) {
        // Stop any existing task
        self.stop_periodic_check();

        let interval = Duration::from_secs(interval_hours as u64 * 3600);

        let task = tokio::spawn(async move {
            // Initial delay before first check (30 seconds after launch)
            tokio::time::sleep(Duration::from_secs(30)).await;

            loop {
                tracing::info!("Checking for updates...");

                if let Err(e) = check_and_install_update(&app_handle).await {
                    tracing::warn!("Update check failed: {}", e);
                    let _ = app_handle.emit(
                        "update-error",
                        UpdateErrorEvent {
                            message: e.to_string(),
                        },
                    );
                }

                tokio::time::sleep(interval).await;
            }
        });

        self.check_task = Some(task);
        tracing::info!(
            "Started periodic update checking (interval: {} hours)",
            interval_hours
        );
    }

    /// Stop periodic update checking
    pub fn stop_periodic_check(&mut self) {
        if let Some(task) = self.check_task.take() {
            task.abort();
            tracing::info!("Stopped periodic update checking");
        }
    }

    /// Check if periodic update checking is running
    pub fn is_running(&self) -> bool {
        self.check_task
            .as_ref()
            .map(|t| !t.is_finished())
            .unwrap_or(false)
    }
}

/// Check for updates and install if available (fully automatic)
async fn check_and_install_update(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            let latest_version = update.version.clone();
            let release_notes = update.body.clone();

            tracing::info!(
                "Update available: {} -> {}",
                current_version,
                latest_version
            );

            // Emit update available event
            let _ = app.emit(
                "update-available",
                UpdateCheckEvent {
                    update_available: true,
                    current_version: current_version.clone(),
                    latest_version: Some(latest_version.clone()),
                    release_notes: release_notes.clone(),
                },
            );

            // Emit downloading event
            let _ = app.emit("update-downloading", ());

            tracing::info!("Downloading update...");

            let app_clone = app.clone();
            let mut downloaded: u64 = 0;

            // Download and install the update
            update
                .download_and_install(
                    |chunk_length, content_length| {
                        downloaded += chunk_length as u64;
                        let progress = content_length
                            .map(|total| (downloaded as f64 / total as f64) * 100.0)
                            .unwrap_or(0.0);

                        let _ = app_clone.emit(
                            "update-download-progress",
                            UpdateProgressEvent {
                                downloaded,
                                total: content_length,
                                progress_percent: progress,
                            },
                        );
                    },
                    || {
                        tracing::info!("Update downloaded, preparing to install...");
                        let _ = app_clone.emit("update-ready", ());
                    },
                )
                .await
                .map_err(|e| format!("Failed to download/install update: {}", e))?;

            tracing::info!("Update installed successfully, restarting...");

            // The app will restart automatically after installation
            Ok(())
        }
        Ok(None) => {
            tracing::debug!("No update available");

            let _ = app.emit(
                "update-checked",
                UpdateCheckEvent {
                    update_available: false,
                    current_version,
                    latest_version: None,
                    release_notes: None,
                },
            );

            Ok(())
        }
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

/// Manual check for updates (returns info without auto-installing)
pub async fn check_for_update_manual(
    app: &tauri::AppHandle,
) -> Result<UpdateCheckEvent, String> {
    use tauri_plugin_updater::UpdaterExt;

    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckEvent {
            update_available: true,
            current_version,
            latest_version: Some(update.version.clone()),
            release_notes: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateCheckEvent {
            update_available: false,
            current_version,
            latest_version: None,
            release_notes: None,
        }),
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

/// Download and install update manually
pub async fn install_update(app: &tauri::AppHandle) -> Result<(), String> {
    check_and_install_update(app).await
}

/// Global update state type
pub type UpdateState = Arc<RwLock<UpdateService>>;

/// Create default update state
pub fn create_update_state() -> UpdateState {
    Arc::new(RwLock::new(UpdateService::new()))
}
