//! Update commands for checking and installing application updates

use crate::error::Result;
use crate::services::update_service::{
    check_for_update_manual, install_update, UpdateCheckEvent, UpdateState,
};
use tauri::{command, AppHandle, State};

/// Check for updates manually (does not auto-install)
#[command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateCheckEvent> {
    check_for_update_manual(&app)
        .await
        .map_err(crate::error::LeviathanError::OperationFailed)
}

/// Download and install the available update
#[command]
pub async fn download_and_install_update(app: AppHandle) -> Result<()> {
    install_update(&app)
        .await
        .map_err(crate::error::LeviathanError::OperationFailed)
}

/// Start automatic update checking
#[command]
pub async fn start_auto_update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
    interval_hours: u32,
) -> Result<()> {
    if interval_hours == 0 {
        return Err(crate::error::LeviathanError::OperationFailed(
            "Interval must be greater than 0".to_string(),
        ));
    }

    let mut service = state.write().await;
    service.start_periodic_check(interval_hours, app);
    Ok(())
}

/// Stop automatic update checking
#[command]
pub async fn stop_auto_update_check(state: State<'_, UpdateState>) -> Result<()> {
    let mut service = state.write().await;
    service.stop_periodic_check();
    Ok(())
}

/// Check if auto-update is running
#[command]
pub async fn is_auto_update_running(state: State<'_, UpdateState>) -> Result<bool> {
    let service = state.read().await;
    Ok(service.is_running())
}

/// Get current application version
#[command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
