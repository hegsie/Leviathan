//! Leviathan - Git GUI Client
//!
//! A fully-featured, open-source, cross-platform Git GUI client
//! built with Tauri 2.0 and Rust.

pub mod commands;
pub mod error;
pub mod models;
pub mod services;

#[cfg(debug_assertions)]
use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use commands::watcher::WatcherState;
use services::{create_autofetch_state, create_update_state};

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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(WatcherState::default())
        .manage(create_autofetch_state())
        .manage(create_update_state())
        .setup(|app| {
            tracing::info!("Application setup complete");

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Start auto-update checking (every 24 hours)
            let update_state = app.state::<services::UpdateState>().inner().clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut service = update_state.write().await;
                service.start_periodic_check(24, app_handle);
            });

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
            commands::branch::rename_branch,
            commands::branch::checkout,
            commands::commit::get_commit_history,
            commands::commit::get_commit,
            commands::commit::create_commit,
            commands::commit::search_commits,
            commands::commit::get_file_history,
            commands::staging::get_status,
            commands::staging::stage_files,
            commands::staging::unstage_files,
            commands::staging::discard_changes,
            commands::staging::stage_hunk,
            commands::staging::unstage_hunk,
            commands::staging::write_file_content,
            commands::staging::read_file_content,
            commands::remote::get_remotes,
            commands::remote::add_remote,
            commands::remote::remove_remote,
            commands::remote::rename_remote,
            commands::remote::set_remote_url,
            commands::remote::fetch,
            commands::remote::pull,
            commands::remote::push,
            commands::merge::merge,
            commands::merge::abort_merge,
            commands::merge::rebase,
            commands::merge::continue_rebase,
            commands::merge::abort_rebase,
            commands::merge::get_rebase_commits,
            commands::merge::execute_interactive_rebase,
            commands::merge::get_conflicts,
            commands::merge::get_blob_content,
            commands::merge::resolve_conflict,
            commands::stash::get_stashes,
            commands::stash::create_stash,
            commands::stash::apply_stash,
            commands::stash::drop_stash,
            commands::stash::pop_stash,
            commands::tags::get_tags,
            commands::tags::create_tag,
            commands::tags::delete_tag,
            commands::tags::push_tag,
            commands::diff::get_diff,
            commands::diff::get_file_diff,
            commands::diff::get_commit_files,
            commands::diff::get_commit_file_diff,
            commands::diff::get_commits_stats,
            commands::diff::get_file_blame,
            commands::diff::get_image_versions,
            commands::refs::get_refs_by_commit,
            commands::watcher::start_watching,
            commands::watcher::stop_watching,
            commands::rewrite::cherry_pick,
            commands::rewrite::continue_cherry_pick,
            commands::rewrite::abort_cherry_pick,
            commands::rewrite::revert,
            commands::rewrite::continue_revert,
            commands::rewrite::abort_revert,
            commands::rewrite::reset,
            commands::reflog::get_reflog,
            commands::reflog::reset_to_reflog,
            commands::clean::get_cleanable_files,
            commands::clean::clean_files,
            commands::clean::clean_all,
            commands::bisect::get_bisect_status,
            commands::bisect::bisect_start,
            commands::bisect::bisect_bad,
            commands::bisect::bisect_good,
            commands::bisect::bisect_skip,
            commands::bisect::bisect_reset,
            commands::submodule::get_submodules,
            commands::submodule::add_submodule,
            commands::submodule::init_submodules,
            commands::submodule::update_submodules,
            commands::submodule::sync_submodules,
            commands::submodule::deinit_submodule,
            commands::submodule::remove_submodule,
            commands::submodule::get_submodule_status,
            commands::submodule::submodule_foreach,
            commands::worktree::get_worktrees,
            commands::worktree::add_worktree,
            commands::worktree::remove_worktree,
            commands::worktree::prune_worktrees,
            commands::worktree::lock_worktree,
            commands::worktree::unlock_worktree,
            commands::worktree::move_worktree,
            commands::worktree::repair_worktrees,
            commands::lfs::get_lfs_status,
            commands::lfs::init_lfs,
            commands::lfs::lfs_track,
            commands::lfs::lfs_untrack,
            commands::lfs::get_lfs_files,
            commands::lfs::lfs_pull,
            commands::lfs::lfs_fetch,
            commands::lfs::lfs_prune,
            commands::lfs::lfs_migrate,
            commands::gpg::get_gpg_config,
            commands::gpg::get_gpg_keys,
            commands::gpg::set_signing_key,
            commands::gpg::set_commit_signing,
            commands::gpg::set_tag_signing,
            commands::gpg::get_commit_signature,
            commands::gpg::get_commits_signatures,
            commands::ssh::get_ssh_config,
            commands::ssh::get_ssh_keys,
            commands::ssh::generate_ssh_key,
            commands::ssh::test_ssh_connection,
            commands::ssh::add_key_to_agent,
            commands::ssh::list_agent_keys,
            commands::ssh::get_public_key_content,
            commands::ssh::delete_ssh_key,
            commands::config::get_config_value,
            commands::config::set_config_value,
            commands::config::unset_config_value,
            commands::config::get_config_list,
            commands::config::get_user_identity,
            commands::config::set_user_identity,
            commands::config::get_aliases,
            commands::config::set_alias,
            commands::config::delete_alias,
            commands::config::get_common_settings,
            commands::credentials::get_credential_helpers,
            commands::credentials::set_credential_helper,
            commands::credentials::unset_credential_helper,
            commands::credentials::get_available_helpers,
            commands::credentials::test_credentials,
            commands::credentials::erase_credentials,
            // GitHub integration
            commands::github::store_github_token,
            commands::github::get_github_token,
            commands::github::delete_github_token,
            commands::github::check_github_connection,
            commands::github::detect_github_repo,
            commands::github::list_pull_requests,
            commands::github::get_pull_request,
            commands::github::create_pull_request,
            commands::github::get_pull_request_reviews,
            commands::github::get_workflow_runs,
            commands::github::get_check_runs,
            commands::github::get_commit_status,
            // GitHub Issues
            commands::github::list_issues,
            commands::github::get_issue,
            commands::github::create_issue,
            commands::github::update_issue_state,
            commands::github::get_issue_comments,
            commands::github::add_issue_comment,
            commands::github::get_repo_labels,
            // GitHub Releases
            commands::github::list_releases,
            commands::github::get_release_by_tag,
            commands::github::get_latest_release,
            commands::github::create_release,
            commands::github::delete_release,
            // Azure DevOps integration
            commands::azure_devops::store_ado_token,
            commands::azure_devops::get_ado_token,
            commands::azure_devops::delete_ado_token,
            commands::azure_devops::check_ado_connection,
            commands::azure_devops::detect_ado_repo,
            commands::azure_devops::list_ado_pull_requests,
            commands::azure_devops::get_ado_pull_request,
            commands::azure_devops::create_ado_pull_request,
            commands::azure_devops::get_ado_work_items,
            commands::azure_devops::query_ado_work_items,
            commands::azure_devops::list_ado_pipeline_runs,
            // GitLab integration
            commands::gitlab::store_gitlab_token,
            commands::gitlab::get_gitlab_token,
            commands::gitlab::delete_gitlab_token,
            commands::gitlab::check_gitlab_connection,
            commands::gitlab::detect_gitlab_repo,
            commands::gitlab::list_gitlab_merge_requests,
            commands::gitlab::get_gitlab_merge_request,
            commands::gitlab::create_gitlab_merge_request,
            commands::gitlab::list_gitlab_issues,
            commands::gitlab::create_gitlab_issue,
            commands::gitlab::list_gitlab_pipelines,
            commands::gitlab::get_gitlab_labels,
            // Bitbucket integration
            commands::bitbucket::store_bitbucket_credentials,
            commands::bitbucket::get_bitbucket_credentials,
            commands::bitbucket::delete_bitbucket_credentials,
            commands::bitbucket::check_bitbucket_connection,
            commands::bitbucket::detect_bitbucket_repo,
            commands::bitbucket::list_bitbucket_pull_requests,
            commands::bitbucket::get_bitbucket_pull_request,
            commands::bitbucket::create_bitbucket_pull_request,
            commands::bitbucket::list_bitbucket_issues,
            commands::bitbucket::list_bitbucket_pipelines,
            // Commit templates
            commands::templates::get_commit_template,
            commands::templates::list_templates,
            commands::templates::save_template,
            commands::templates::delete_template,
            commands::templates::get_conventional_types,
            // Auto-fetch
            commands::autofetch::start_auto_fetch,
            commands::autofetch::stop_auto_fetch,
            commands::autofetch::is_auto_fetch_running,
            commands::autofetch::get_remote_status,
            // Auto-update
            commands::update::check_for_update,
            commands::update::download_and_install_update,
            commands::update::start_auto_update_check,
            commands::update::stop_auto_update_check,
            commands::update::is_auto_update_running,
            commands::update::get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
