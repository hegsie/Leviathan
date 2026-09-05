//! Auto-update service for periodic update checking and installation.
//!
//! Everything here reaches the network — `updater.check()` fetches
//! `latest.json` from the configured endpoint and `download_and_install`
//! pulls a signed binary and runs it — so every path through this module goes
//! through the same offline-mode / allowlist gate as the rest of the app
//! (`services/security.rs`). This one is the only gated path that runs
//! unattended, 30 seconds after launch and every interval thereafter, which is
//! why the scheduled loop treats a refusal differently from a failure: see
//! [`classify_tick`].

use crate::error::{LeviathanError, Result};
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

/// The endpoints the updater will contact, as `tauri.conf.json` configures
/// them (`plugins.updater.endpoints`).
///
/// Read back out of the app config rather than restated as a constant here:
/// the updater plugin reads that same field, so there is exactly one place the
/// destination is written down and no way for the guard to end up checking a
/// host the updater no longer uses.
fn configured_update_endpoints(app: &tauri::AppHandle) -> Vec<String> {
    updater_endpoints_in(app.config().plugins.0.get("updater"))
}

/// The endpoint list inside an `updater` plugin-config object.
///
/// Split out from [`configured_update_endpoints`] so it can be pinned against
/// the real `tauri.conf.json` without a running app — a guard that silently
/// resolved to zero endpoints would still refuse in offline mode but would
/// stop distinguishing hosts for the allowlist.
fn updater_endpoints_in(updater: Option<&serde_json::Value>) -> Vec<String> {
    updater
        .and_then(|value| value.get("endpoints"))
        .and_then(|value| value.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Refuse an update check that offline mode or the remote allowlist forbids.
///
/// EVERY configured endpoint has to pass, because the updater walks the list
/// until one answers: allowing the check because the first entry is
/// allowlisted would let it fall through to a host that is not.
///
/// An empty list is handed to the gate as an unresolved target, which is the
/// same fail-closed rule the rest of the gate uses — offline mode refuses
/// regardless, and an allowlist that cannot see a destination refuses too.
pub(crate) fn guard_update_endpoints(endpoints: &[String]) -> Result<()> {
    if endpoints.is_empty() {
        return crate::services::security::check(
            &crate::services::security::global().snapshot(),
            None,
        );
    }
    for endpoint in endpoints {
        crate::services::security::guard_url(endpoint)?;
    }
    Ok(())
}

/// [`guard_update_endpoints`], against whatever this build is configured with.
fn guard_update_network(app: &tauri::AppHandle) -> Result<()> {
    guard_update_endpoints(&configured_update_endpoints(app))
}

/// The one place an updater is built.
///
/// The same one-constructor rule `commands/github.rs` and
/// `services/github_app.rs` use: the updater builder was invoked in two
/// places here, neither of which met a gate, so offline mode did not cover the
/// one outbound path that runs unattended and installs a binary. Building the
/// updater only through here means a path added later inherits the gate
/// instead of having to remember it.
fn gated_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater> {
    use tauri_plugin_updater::UpdaterExt;

    guard_update_network(app)?;
    app.updater_builder().build().map_err(|e| {
        tracing::error!("Failed to build updater: {}", e);
        LeviathanError::OperationFailed(format!("Failed to build updater: {}", e))
    })
}

/// The endpoints the shipped `tauri.conf.json` configures.
///
/// Test-only: `tauri::AppHandle` needs a running app, and the guard is worth
/// pinning against the destination the product actually ships with.
#[cfg(test)]
pub(crate) fn shipped_update_endpoints() -> Vec<String> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
        .expect("tauri.conf.json is valid JSON");
    updater_endpoints_in(config.get("plugins").and_then(|p| p.get("updater")))
}

/// What a scheduled tick does with the outcome of its update check.
///
/// A refusal from the network gate is not a failure to report: the user turned
/// offline mode on, or wrote an allowlist that does not name the update host.
/// Emitting `update-error` for it would put the same toast in front of them
/// every interval forever, and giving up on the loop would mean turning the
/// setting back off did nothing until the next launch. So a refusal is logged,
/// nothing is emitted, and the schedule is kept.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum TickReport {
    /// The check ran. Its own events have already been emitted.
    Silent,
    /// The gate refused. Log it and wait for the next tick.
    Skipped(String),
    /// A genuine failure the user should see.
    Failed(String),
}

pub(crate) fn classify_tick(result: Result<()>) -> TickReport {
    match result {
        Ok(()) => TickReport::Silent,
        Err(LeviathanError::NetworkBlocked(reason)) => TickReport::Skipped(reason),
        Err(e) => TickReport::Failed(e.to_string()),
    }
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

                match classify_tick(check_and_install_update(&app_handle).await) {
                    TickReport::Silent => {}
                    TickReport::Skipped(reason) => {
                        // Offline mode or the allowlist. The timer keeps
                        // running, so turning the setting back off resumes
                        // updates at the next tick without a restart.
                        tracing::info!("Skipping scheduled update check: {}", reason);
                    }
                    TickReport::Failed(message) => {
                        tracing::warn!("Update check failed: {}", message);
                        let _ = app_handle.emit("update-error", UpdateErrorEvent { message });
                    }
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

/// Check for updates and install if available (fully automatic).
///
/// Returns [`crate::error::LeviathanError`] rather than a `String` so a refusal
/// from the network gate keeps its `NetworkBlocked` identity all the way to the
/// frontend, where it reads as `BLOCKED` like every other refusal — and so the
/// scheduled loop can tell a refusal apart from a failure.
async fn check_and_install_update(app: &tauri::AppHandle) -> Result<()> {
    tracing::debug!("check_and_install_update: Starting update check");

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    tracing::debug!(
        "check_and_install_update: Current version is {}",
        current_version
    );

    // Gated inside: this downloads and RUNS a binary, so the refusal has to
    // come before anything reaches the network, not somewhere between the
    // fetch and the install.
    tracing::debug!("check_and_install_update: Building updater...");
    let updater = gated_updater(app)?;
    tracing::debug!("check_and_install_update: Updater built successfully");

    tracing::debug!("check_and_install_update: Calling updater.check()...");
    let check_result = updater.check().await;
    tracing::debug!("check_and_install_update: updater.check() returned");

    match check_result {
        Ok(Some(update)) => {
            tracing::debug!("check_and_install_update: Update found");
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
            let app_clone2 = app.clone();

            // Download and install the update
            let downloaded = std::sync::atomic::AtomicU64::new(0);
            update
                .download_and_install(
                    |chunk_length, content_length| {
                        let prev = downloaded
                            .fetch_add(chunk_length as u64, std::sync::atomic::Ordering::Relaxed);
                        let current = prev + chunk_length as u64;
                        let progress = content_length
                            .map(|total| (current as f64 / total as f64) * 100.0)
                            .unwrap_or(0.0);

                        let _ = app_clone.emit(
                            "update-download-progress",
                            UpdateProgressEvent {
                                downloaded: current,
                                total: content_length,
                                progress_percent: progress,
                            },
                        );
                    },
                    || {
                        tracing::info!("Update downloaded, preparing to install...");
                        let _ = app_clone2.emit("update-ready", ());
                    },
                )
                .await
                .map_err(|e| {
                    LeviathanError::OperationFailed(format!(
                        "Failed to download/install update: {}",
                        e
                    ))
                })?;

            tracing::info!("Update installed successfully, restarting...");

            // The app will restart automatically after installation
            Ok(())
        }
        Ok(None) => {
            tracing::debug!("check_and_install_update: No update available");

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
        Err(e) => {
            tracing::error!(
                "check_and_install_update: Update check failed with error: {}",
                e
            );
            Err(LeviathanError::OperationFailed(format!(
                "Update check failed: {}",
                e
            )))
        }
    }
}

/// Manual check for updates (returns info without auto-installing).
///
/// The Settings button behind this one is a gesture the user just made, so its
/// refusal travels back as `NetworkBlocked` and the dialog renders it. The
/// scheduled loop is the path that must stay quiet, not this one.
pub async fn check_for_update_manual(app: &tauri::AppHandle) -> Result<UpdateCheckEvent> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let updater = gated_updater(app)?;

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
        Err(e) => Err(LeviathanError::OperationFailed(format!(
            "Update check failed: {}",
            e
        ))),
    }
}

/// Download and install update manually
pub async fn install_update(app: &tauri::AppHandle) -> Result<()> {
    check_and_install_update(app).await
}

/// Global update state type
pub type UpdateState = Arc<RwLock<UpdateService>>;

/// Create default update state
pub fn create_update_state() -> UpdateState {
    Arc::new(RwLock::new(UpdateService::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::security::test_support;

    #[test]
    fn the_shipped_config_names_at_least_one_updater_endpoint() {
        // The guard resolves its destination out of `tauri.conf.json`. If that
        // ever stops yielding a URL the guard still refuses in offline mode,
        // but it stops distinguishing hosts for the allowlist — so pin it.
        let endpoints = shipped_update_endpoints();
        assert!(
            !endpoints.is_empty(),
            "plugins.updater.endpoints must be readable from tauri.conf.json"
        );
        assert!(
            endpoints.iter().all(|e| e.contains("://")),
            "every endpoint should be a URL: {:?}",
            endpoints
        );
    }

    #[test]
    fn a_missing_updater_config_yields_no_endpoints() {
        assert!(updater_endpoints_in(None).is_empty());
        assert!(updater_endpoints_in(Some(&serde_json::json!({}))).is_empty());
        assert_eq!(
            updater_endpoints_in(Some(&serde_json::json!({
                "endpoints": ["https://example.test/latest.json"]
            }))),
            vec!["https://example.test/latest.json".to_string()]
        );
    }

    #[test]
    fn every_configured_endpoint_has_to_pass_the_allowlist() {
        let _guard = test_support::allowlist(&["github.com"]);
        // One allowlisted entry does not carry the rest: the updater walks the
        // list until one answers.
        guard_update_endpoints(&["https://github.com/o/r/latest.json".to_string()])
            .expect("the allowlisted host is permitted");
        guard_update_endpoints(&[
            "https://github.com/o/r/latest.json".to_string(),
            "https://mirror.example.test/latest.json".to_string(),
        ])
        .expect_err("a second, unlisted endpoint must refuse the whole check");
    }

    #[test]
    fn an_empty_endpoint_list_fails_closed_under_an_allowlist() {
        let _guard = test_support::allowlist(&["github.com"]);
        guard_update_endpoints(&[]).expect_err("no destination to match means refuse");
    }

    #[test]
    fn nothing_is_refused_when_no_policy_is_in_force() {
        // Through `test_support` rather than reading the ambient default: it
        // is what serializes against the tests that turn offline mode on.
        let _guard = test_support::with(crate::services::security::SecuritySettings::default());
        guard_update_endpoints(&shipped_update_endpoints())
            .expect("no offline mode and no allowlist means updates work as before");
    }

    #[test]
    fn every_updater_is_built_through_the_gate() {
        // `check_and_install_update` and `check_for_update_manual` cannot be
        // called from a unit test — `tauri::AppHandle` needs a running app — so
        // this pins the structural property that makes the guard unmissable:
        // there is exactly one updater-builder call in this file, and it
        // lives inside `gated_updater`, behind the check. Adding a second one
        // fails here, which is what happened last time (two call sites, no
        // gate on either).
        let source = include_str!("update_service.rs");
        // Split so this test's own source does not count as a call site.
        let builder = concat!(".updater_", "builder()");
        assert_eq!(
            source.matches(builder).count(),
            1,
            "the updater must be built in exactly one place, and that place runs the gate"
        );
        let gated = source
            .split_once("fn gated_updater")
            .expect("gated_updater is the one constructor")
            .1;
        let body_end = gated.find("\n}\n").expect("gated_updater has a body");
        let body = &gated[..body_end];
        assert!(
            body.find("guard_update_network").expect("the gate runs")
                < body.find(builder).expect("the updater is built"),
            "the gate has to run BEFORE the updater is built"
        );
    }

    // ---- the scheduled loop ----

    #[test]
    fn a_refused_scheduled_tick_is_skipped_not_reported() {
        // `Skipped` is what keeps the 24-hour timer alive and the toast away:
        // the loop emits `update-error` only for `Failed`.
        assert_eq!(
            classify_tick(Err(LeviathanError::NetworkBlocked("offline".to_string()))),
            TickReport::Skipped("offline".to_string())
        );
    }

    #[test]
    fn a_real_failure_is_still_reported() {
        match classify_tick(Err(LeviathanError::OperationFailed("boom".to_string()))) {
            TickReport::Failed(message) => assert!(message.contains("boom")),
            other => panic!("a real failure must still reach the user, got {:?}", other),
        }
    }

    #[test]
    fn a_successful_tick_says_nothing() {
        assert_eq!(classify_tick(Ok(())), TickReport::Silent);
    }
}
