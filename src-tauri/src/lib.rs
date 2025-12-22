//! Leviathan - Git GUI Client
//!
//! A fully-featured, open-source, cross-platform Git GUI client
//! built with Tauri 2.0 and Rust.

pub mod commands;
pub mod models;
pub mod services;
pub mod error;

#[cfg(debug_assertions)]
use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use commands::watcher::WatcherState;

/// Initialize the application
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "leviathan=debug,git2=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Leviathan");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(WatcherState::default())
        .setup(|_app| {
            tracing::info!("Application setup complete");

            #[cfg(debug_assertions)]
            {
                let window = _app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::repository::open_repository,
            commands::repository::clone_repository,
            commands::repository::init_repository,
            commands::repository::get_repository_info,
            commands::branch::get_branches,
            commands::branch::create_branch,
            commands::branch::delete_branch,
            commands::branch::checkout,
            commands::commit::get_commit_history,
            commands::commit::get_commit,
            commands::commit::create_commit,
            commands::staging::get_status,
            commands::staging::stage_files,
            commands::staging::unstage_files,
            commands::staging::discard_changes,
            commands::staging::stage_hunk,
            commands::staging::unstage_hunk,
            commands::remote::get_remotes,
            commands::remote::fetch,
            commands::remote::pull,
            commands::remote::push,
            commands::merge::merge,
            commands::merge::abort_merge,
            commands::merge::rebase,
            commands::merge::continue_rebase,
            commands::merge::abort_rebase,
            commands::stash::get_stashes,
            commands::stash::create_stash,
            commands::stash::apply_stash,
            commands::stash::drop_stash,
            commands::stash::pop_stash,
            commands::tags::get_tags,
            commands::tags::create_tag,
            commands::tags::delete_tag,
            commands::diff::get_diff,
            commands::diff::get_file_diff,
            commands::diff::get_commit_files,
            commands::diff::get_commit_file_diff,
            commands::diff::get_commits_stats,
            commands::diff::get_file_blame,
            commands::refs::get_refs_by_commit,
            commands::watcher::start_watching,
            commands::watcher::stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
