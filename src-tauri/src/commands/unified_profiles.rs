//! Unified profiles command handlers
//!
//! Manage unified profiles that combine git identity with integration accounts.
//! This replaces the separate profiles and integration_accounts commands.

use std::fs;
use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{
    CachedUser, IntegrationAccountsConfig, IntegrationType, ProfileIntegrationAccount,
    ProfilesConfig, UnifiedProfile, UnifiedProfilesConfig, UNIFIED_PROFILES_CONFIG_VERSION,
};
use crate::utils::create_command;

// =============================================================================
// File Path Helpers
// =============================================================================

/// Get the path to the unified profiles config file
fn get_unified_profiles_path() -> Result<std::path::PathBuf> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        LeviathanError::OperationFailed("Could not find config directory".to_string())
    })?;

    let app_config_dir = config_dir.join("leviathan");

    // Create directory if it doesn't exist
    if !app_config_dir.exists() {
        fs::create_dir_all(&app_config_dir).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to create config directory: {}", e))
        })?;
    }

    Ok(app_config_dir.join("unified_profiles.json"))
}

/// Get the path to the legacy profiles config file
fn get_legacy_profiles_path() -> Result<std::path::PathBuf> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        LeviathanError::OperationFailed("Could not find config directory".to_string())
    })?;
    Ok(config_dir.join("leviathan").join("profiles.json"))
}

/// Get the path to the legacy integration accounts config file
fn get_legacy_accounts_path() -> Result<std::path::PathBuf> {
    let config_dir = dirs::config_dir().ok_or_else(|| {
        LeviathanError::OperationFailed("Could not find config directory".to_string())
    })?;
    Ok(config_dir
        .join("leviathan")
        .join("integration_accounts.json"))
}

// =============================================================================
// Config Loading/Saving
// =============================================================================

/// Load unified profiles config from disk
fn load_unified_profiles_config() -> Result<UnifiedProfilesConfig> {
    let path = get_unified_profiles_path()?;

    if !path.exists() {
        return Ok(UnifiedProfilesConfig::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to read unified profiles: {}", e))
    })?;

    let config: UnifiedProfilesConfig = serde_json::from_str(&content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse unified profiles: {}", e))
    })?;

    Ok(config)
}

/// Save unified profiles config to disk
fn save_unified_profiles_config(config: &UnifiedProfilesConfig) -> Result<()> {
    let path = get_unified_profiles_path()?;

    let content = serde_json::to_string_pretty(config).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to serialize unified profiles: {}", e))
    })?;

    fs::write(&path, content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to write unified profiles: {}", e))
    })?;

    Ok(())
}

/// Load legacy profiles config (for migration)
fn load_legacy_profiles_config() -> Result<ProfilesConfig> {
    let path = get_legacy_profiles_path()?;

    if !path.exists() {
        return Ok(ProfilesConfig::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to read profiles: {}", e)))?;

    let config: ProfilesConfig = serde_json::from_str(&content)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse profiles: {}", e)))?;

    Ok(config)
}

/// Load legacy integration accounts config (for migration)
fn load_legacy_accounts_config() -> Result<IntegrationAccountsConfig> {
    let path = get_legacy_accounts_path()?;

    if !path.exists() {
        return Ok(IntegrationAccountsConfig::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to read integration accounts: {}", e))
    })?;

    let config: IntegrationAccountsConfig = serde_json::from_str(&content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse integration accounts: {}", e))
    })?;

    Ok(config)
}

// =============================================================================
// Git Helpers
// =============================================================================

/// Run git config command
fn run_git_config(repo_path: Option<&Path>, args: &[&str]) -> Result<String> {
    let mut cmd = create_command("git");

    if let Some(path) = repo_path {
        cmd.current_dir(path);
    }

    cmd.arg("config");
    cmd.args(args);

    let output = cmd
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run git config: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(stdout)
    } else if output.status.code() == Some(1) && stderr.is_empty() && stdout.is_empty() {
        Ok(String::new())
    } else {
        Err(LeviathanError::OperationFailed(if stderr.is_empty() {
            stdout
        } else {
            stderr
        }))
    }
}

/// Get the remote URL for a repository
fn get_remote_url(repo_path: &Path) -> Option<String> {
    let mut cmd = create_command("git");
    cmd.current_dir(repo_path);
    cmd.args(["config", "--get", "remote.origin.url"]);

    let output = cmd.output().ok()?;
    if output.status.success() {
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !url.is_empty() {
            return Some(url);
        }
    }

    // Try to get any remote URL
    let mut cmd = create_command("git");
    cmd.current_dir(repo_path);
    cmd.args(["config", "--get-regexp", "^remote\\..*\\.url"]);

    let output = cmd.output().ok()?;
    if output.status.success() {
        let remotes = String::from_utf8_lossy(&output.stdout);
        if let Some(line) = remotes.lines().next() {
            let parts: Vec<&str> = line.splitn(2, ' ').collect();
            if parts.len() == 2 {
                return Some(parts[1].to_string());
            }
        }
    }

    None
}

// =============================================================================
// Profile CRUD Commands
// =============================================================================

/// Get the unified profiles config
#[command]
pub async fn get_unified_profiles_config() -> Result<UnifiedProfilesConfig> {
    load_unified_profiles_config()
}

/// Get all unified profiles
#[command]
pub async fn get_unified_profiles() -> Result<Vec<UnifiedProfile>> {
    let config = load_unified_profiles_config()?;
    Ok(config.profiles)
}

/// Get a single unified profile by ID
#[command]
pub async fn get_unified_profile(profile_id: String) -> Result<Option<UnifiedProfile>> {
    let config = load_unified_profiles_config()?;
    Ok(config.profiles.into_iter().find(|p| p.id == profile_id))
}

/// Save a unified profile (create or update)
#[command]
pub async fn save_unified_profile(profile: UnifiedProfile) -> Result<UnifiedProfile> {
    let mut config = load_unified_profiles_config()?;
    config.save_profile(profile.clone());
    save_unified_profiles_config(&config)?;
    Ok(profile)
}

/// Delete a unified profile
#[command]
pub async fn delete_unified_profile(profile_id: String) -> Result<()> {
    let mut config = load_unified_profiles_config()?;
    config.delete_profile(&profile_id);
    save_unified_profiles_config(&config)?;
    Ok(())
}

/// Set a profile as the default
#[command]
pub async fn set_default_unified_profile(profile_id: String) -> Result<()> {
    let mut config = load_unified_profiles_config()?;

    for profile in &mut config.profiles {
        profile.is_default = profile.id == profile_id;
    }

    save_unified_profiles_config(&config)?;
    Ok(())
}

// =============================================================================
// Account Within Profile Commands
// =============================================================================

/// Add an integration account to a profile
#[command]
pub async fn add_account_to_profile(
    profile_id: String,
    account: ProfileIntegrationAccount,
) -> Result<ProfileIntegrationAccount> {
    let mut config = load_unified_profiles_config()?;

    let profile = config
        .get_profile_mut(&profile_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Profile not found".to_string()))?;

    profile.save_account(account.clone());
    save_unified_profiles_config(&config)?;
    Ok(account)
}

/// Update an integration account within a profile
#[command]
pub async fn update_account_in_profile(
    profile_id: String,
    account: ProfileIntegrationAccount,
) -> Result<ProfileIntegrationAccount> {
    let mut config = load_unified_profiles_config()?;

    let profile = config
        .get_profile_mut(&profile_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Profile not found".to_string()))?;

    if profile.get_account(&account.id).is_none() {
        return Err(LeviathanError::OperationFailed(
            "Account not found in profile".to_string(),
        ));
    }

    profile.save_account(account.clone());
    save_unified_profiles_config(&config)?;
    Ok(account)
}

/// Remove an integration account from a profile
#[command]
pub async fn remove_account_from_profile(profile_id: String, account_id: String) -> Result<()> {
    let mut config = load_unified_profiles_config()?;

    let profile = config
        .get_profile_mut(&profile_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Profile not found".to_string()))?;

    profile.delete_account(&account_id);
    save_unified_profiles_config(&config)?;
    Ok(())
}

/// Set an account as the default for its type within a profile
#[command]
pub async fn set_default_account_in_profile(profile_id: String, account_id: String) -> Result<()> {
    let mut config = load_unified_profiles_config()?;

    let profile = config
        .get_profile_mut(&profile_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Profile not found".to_string()))?;

    // Find the account to get its type
    let integration_type = profile
        .get_account(&account_id)
        .map(|a| a.integration_type.clone())
        .ok_or_else(|| LeviathanError::OperationFailed("Account not found".to_string()))?;

    // Update defaults
    for acc in &mut profile.integration_accounts {
        if acc.integration_type == integration_type {
            acc.is_default_for_type = acc.id == account_id;
        }
    }

    save_unified_profiles_config(&config)?;
    Ok(())
}

/// Update cached user info for an account within a profile
#[command]
pub async fn update_profile_account_cached_user(
    profile_id: String,
    account_id: String,
    user: CachedUser,
) -> Result<()> {
    let mut config = load_unified_profiles_config()?;

    let profile = config
        .get_profile_mut(&profile_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Profile not found".to_string()))?;

    let account = profile
        .get_account_mut(&account_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Account not found".to_string()))?;

    account.update_cached_user(user);
    save_unified_profiles_config(&config)?;
    Ok(())
}

// =============================================================================
// Profile Detection and Assignment Commands
// =============================================================================

/// Detect which profile should be used for a repository based on URL patterns
#[command]
pub async fn detect_unified_profile_for_repository(path: String) -> Result<Option<UnifiedProfile>> {
    let config = load_unified_profiles_config()?;
    let repo_path = Path::new(&path);

    // First check for manual assignment
    if let Some(profile) = config.get_assigned_profile(&path) {
        return Ok(Some(profile.clone()));
    }

    // Get the remote URL and try to match
    if let Some(remote_url) = get_remote_url(repo_path) {
        if let Some(profile) = config.find_matching_profile(&remote_url) {
            return Ok(Some(profile.clone()));
        }
    }

    // Return default profile if no match
    Ok(config.get_default_profile().cloned())
}

/// Get the assigned profile for a repository (checking assignment first, then auto-detect)
#[command]
pub async fn get_assigned_unified_profile(path: String) -> Result<Option<UnifiedProfile>> {
    detect_unified_profile_for_repository(path).await
}

/// Manually assign a profile to a repository
#[command]
pub async fn assign_unified_profile_to_repository(path: String, profile_id: String) -> Result<()> {
    let mut config = load_unified_profiles_config()?;

    // Verify the profile exists
    if config.get_profile(&profile_id).is_none() {
        return Err(LeviathanError::OperationFailed(
            "Profile not found".to_string(),
        ));
    }

    config.assign_profile(path, profile_id);
    save_unified_profiles_config(&config)?;
    Ok(())
}

/// Remove profile assignment from a repository
#[command]
pub async fn unassign_unified_profile_from_repository(path: String) -> Result<()> {
    let mut config = load_unified_profiles_config()?;
    config.unassign_profile(&path);
    save_unified_profiles_config(&config)?;
    Ok(())
}

/// Apply a profile to a repository (set git config)
#[command]
pub async fn apply_unified_profile(path: String, profile_id: String) -> Result<()> {
    let mut config = load_unified_profiles_config()?;

    let profile = config
        .get_profile(&profile_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Profile not found".to_string()))?
        .clone();

    let repo_path = Path::new(&path);

    // Set user.name
    run_git_config(
        Some(repo_path),
        &["--local", "user.name", &profile.git_name],
    )?;

    // Set user.email
    run_git_config(
        Some(repo_path),
        &["--local", "user.email", &profile.git_email],
    )?;

    // Set signing key if specified
    if let Some(ref signing_key) = profile.signing_key {
        if !signing_key.is_empty() {
            run_git_config(
                Some(repo_path),
                &["--local", "user.signingkey", signing_key],
            )?;
            run_git_config(Some(repo_path), &["--local", "commit.gpgsign", "true"])?;
        }
    } else {
        // Unset signing key if not specified
        let _ = run_git_config(Some(repo_path), &["--local", "--unset", "user.signingkey"]);
        let _ = run_git_config(Some(repo_path), &["--local", "--unset", "commit.gpgsign"]);
    }

    // Save the assignment
    config.assign_profile(path, profile_id);
    save_unified_profiles_config(&config)?;

    Ok(())
}

/// Get the current git identity for a repository
#[command]
pub async fn get_current_git_identity(path: String) -> Result<CurrentGitIdentity> {
    let repo_path = Path::new(&path);

    let name = run_git_config(Some(repo_path), &["--get", "user.name"]).ok();
    let email = run_git_config(Some(repo_path), &["--get", "user.email"]).ok();
    let signing_key = run_git_config(Some(repo_path), &["--get", "user.signingkey"]).ok();

    Ok(CurrentGitIdentity {
        name: name.filter(|s| !s.is_empty()),
        email: email.filter(|s| !s.is_empty()),
        signing_key: signing_key.filter(|s| !s.is_empty()),
    })
}

/// Current git identity for a repository
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentGitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
    pub signing_key: Option<String>,
}

// =============================================================================
// Migration Commands
// =============================================================================

/// Result of migrating to unified profiles
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedMigrationResult {
    pub success: bool,
    pub profiles_migrated: usize,
    pub accounts_migrated: usize,
    pub unmatched_accounts: Vec<UnmatchedAccount>,
    pub errors: Vec<String>,
}

/// An account that couldn't be automatically matched to a profile
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmatchedAccount {
    pub account_id: String,
    pub account_name: String,
    pub integration_type: IntegrationType,
    pub suggested_profile_id: Option<String>,
}

/// Check if migration to unified profiles is needed
#[command]
pub async fn needs_unified_profiles_migration() -> Result<bool> {
    let unified_path = get_unified_profiles_path()?;
    let legacy_profiles_path = get_legacy_profiles_path()?;
    let legacy_accounts_path = get_legacy_accounts_path()?;

    // Migration is needed if:
    // 1. Unified profiles config doesn't exist
    // 2. Either legacy profiles or accounts exist
    let unified_exists = unified_path.exists();
    let legacy_exists = legacy_profiles_path.exists() || legacy_accounts_path.exists();

    Ok(!unified_exists && legacy_exists)
}

/// Preview migration - shows how accounts would be matched to profiles
#[command]
pub async fn preview_unified_profiles_migration() -> Result<MigrationPreview> {
    let legacy_profiles = load_legacy_profiles_config()?;
    let legacy_accounts = load_legacy_accounts_config()?;

    let mut preview = MigrationPreview {
        profiles: Vec::new(),
        unmatched_accounts: Vec::new(),
    };

    // Convert legacy profiles
    for profile in &legacy_profiles.profiles {
        let mut preview_profile = MigrationPreviewProfile {
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            git_email: profile.git_email.clone(),
            matched_accounts: Vec::new(),
        };

        // Try to match accounts by URL pattern overlap
        for account in &legacy_accounts.accounts {
            if has_pattern_overlap(&profile.url_patterns, &account.url_patterns) {
                preview_profile
                    .matched_accounts
                    .push(MigrationPreviewAccount {
                        account_id: account.id.clone(),
                        account_name: account.name.clone(),
                        integration_type: account.integration_type.clone(),
                    });
            }
        }

        preview.profiles.push(preview_profile);
    }

    // Find unmatched accounts
    for account in &legacy_accounts.accounts {
        let is_matched = preview.profiles.iter().any(|p| {
            p.matched_accounts
                .iter()
                .any(|a| a.account_id == account.id)
        });

        if !is_matched {
            // Suggest the default profile
            let suggested = legacy_profiles.profiles.iter().find(|p| p.is_default);

            preview.unmatched_accounts.push(UnmatchedAccount {
                account_id: account.id.clone(),
                account_name: account.name.clone(),
                integration_type: account.integration_type.clone(),
                suggested_profile_id: suggested.map(|p| p.id.clone()),
            });
        }
    }

    Ok(preview)
}

/// Migration preview data
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPreview {
    pub profiles: Vec<MigrationPreviewProfile>,
    pub unmatched_accounts: Vec<UnmatchedAccount>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPreviewProfile {
    pub profile_id: String,
    pub profile_name: String,
    pub git_email: String,
    pub matched_accounts: Vec<MigrationPreviewAccount>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPreviewAccount {
    pub account_id: String,
    pub account_name: String,
    pub integration_type: IntegrationType,
}

/// Execute migration with custom account-to-profile assignments
#[command]
pub async fn execute_unified_profiles_migration(
    account_assignments: std::collections::HashMap<String, String>, // account_id -> profile_id
) -> Result<UnifiedMigrationResult> {
    let legacy_profiles = load_legacy_profiles_config()?;
    let legacy_accounts = load_legacy_accounts_config()?;

    let mut result = UnifiedMigrationResult {
        success: true,
        profiles_migrated: 0,
        accounts_migrated: 0,
        unmatched_accounts: Vec::new(),
        errors: Vec::new(),
    };

    // Create unified profiles from legacy profiles
    let mut unified_profiles: Vec<UnifiedProfile> = legacy_profiles
        .profiles
        .iter()
        .map(|p| UnifiedProfile {
            id: p.id.clone(),
            name: p.name.clone(),
            git_name: p.git_name.clone(),
            git_email: p.git_email.clone(),
            signing_key: p.signing_key.clone(),
            url_patterns: p.url_patterns.clone(),
            is_default: p.is_default,
            color: p.color.clone().unwrap_or_else(|| "#3b82f6".to_string()),
            integration_accounts: Vec::new(),
        })
        .collect();

    result.profiles_migrated = unified_profiles.len();

    // Assign accounts to profiles based on the provided assignments
    for account in &legacy_accounts.accounts {
        let profile_id = account_assignments.get(&account.id);

        if let Some(profile_id) = profile_id {
            if let Some(profile) = unified_profiles.iter_mut().find(|p| &p.id == profile_id) {
                profile
                    .integration_accounts
                    .push(ProfileIntegrationAccount {
                        id: account.id.clone(),
                        name: account.name.clone(),
                        integration_type: account.integration_type.clone(),
                        config: account.config.clone(),
                        color: account.color.clone(),
                        cached_user: account.cached_user.clone(),
                        is_default_for_type: account.is_default,
                    });
                result.accounts_migrated += 1;
            } else {
                result.unmatched_accounts.push(UnmatchedAccount {
                    account_id: account.id.clone(),
                    account_name: account.name.clone(),
                    integration_type: account.integration_type.clone(),
                    suggested_profile_id: None,
                });
            }
        } else {
            // No assignment provided - try to match by URL patterns or use default
            let mut assigned = false;

            // Try URL pattern matching
            for profile in &mut unified_profiles {
                if has_pattern_overlap(&profile.url_patterns, &account.url_patterns) {
                    profile
                        .integration_accounts
                        .push(ProfileIntegrationAccount {
                            id: account.id.clone(),
                            name: account.name.clone(),
                            integration_type: account.integration_type.clone(),
                            config: account.config.clone(),
                            color: account.color.clone(),
                            cached_user: account.cached_user.clone(),
                            is_default_for_type: account.is_default,
                        });
                    result.accounts_migrated += 1;
                    assigned = true;
                    break;
                }
            }

            // Fall back to default profile
            if !assigned {
                if let Some(profile) = unified_profiles.iter_mut().find(|p| p.is_default) {
                    profile
                        .integration_accounts
                        .push(ProfileIntegrationAccount {
                            id: account.id.clone(),
                            name: account.name.clone(),
                            integration_type: account.integration_type.clone(),
                            config: account.config.clone(),
                            color: account.color.clone(),
                            cached_user: account.cached_user.clone(),
                            is_default_for_type: account.is_default,
                        });
                    result.accounts_migrated += 1;
                } else if let Some(profile) = unified_profiles.first_mut() {
                    // Use first profile as fallback
                    profile
                        .integration_accounts
                        .push(ProfileIntegrationAccount {
                            id: account.id.clone(),
                            name: account.name.clone(),
                            integration_type: account.integration_type.clone(),
                            config: account.config.clone(),
                            color: account.color.clone(),
                            cached_user: account.cached_user.clone(),
                            is_default_for_type: account.is_default,
                        });
                    result.accounts_migrated += 1;
                } else {
                    result.unmatched_accounts.push(UnmatchedAccount {
                        account_id: account.id.clone(),
                        account_name: account.name.clone(),
                        integration_type: account.integration_type.clone(),
                        suggested_profile_id: None,
                    });
                }
            }
        }
    }

    // Use profile repository assignments (account assignments become implicit via profile)
    let repository_assignments = legacy_profiles.repository_assignments.clone();

    // Save the unified config
    let unified_config = UnifiedProfilesConfig {
        version: UNIFIED_PROFILES_CONFIG_VERSION,
        profiles: unified_profiles,
        repository_assignments,
    };

    save_unified_profiles_config(&unified_config)?;

    // Backup legacy files
    backup_legacy_configs()?;

    Ok(result)
}

/// Check if two sets of URL patterns have any overlap
fn has_pattern_overlap(patterns1: &[String], patterns2: &[String]) -> bool {
    for p1 in patterns1 {
        for p2 in patterns2 {
            let norm1 = normalize_pattern(p1);
            let norm2 = normalize_pattern(p2);

            // Check if patterns share a common domain prefix
            if norm1.starts_with(&norm2) || norm2.starts_with(&norm1) {
                return true;
            }

            // Also check if they target the same domain
            let domain1 = get_domain(&norm1);
            let domain2 = get_domain(&norm2);
            if domain1 == domain2 && !domain1.is_empty() {
                return true;
            }
        }
    }
    false
}

fn normalize_pattern(pattern: &str) -> String {
    pattern
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches("/*")
        .trim_end_matches('/')
        .to_lowercase()
}

fn get_domain(pattern: &str) -> String {
    pattern.split('/').next().unwrap_or("").to_string()
}

/// Backup legacy config files
fn backup_legacy_configs() -> Result<()> {
    let profiles_path = get_legacy_profiles_path()?;
    let accounts_path = get_legacy_accounts_path()?;

    if profiles_path.exists() {
        let backup_path = profiles_path.with_extension("json.bak");
        fs::copy(&profiles_path, &backup_path).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to backup profiles: {}", e))
        })?;
    }

    if accounts_path.exists() {
        let backup_path = accounts_path.with_extension("json.bak");
        fs::copy(&accounts_path, &backup_path).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to backup integration accounts: {}", e))
        })?;
    }

    Ok(())
}

/// Get an account from any profile (for compatibility during transition)
#[command]
pub async fn get_account_from_any_profile(
    account_id: String,
) -> Result<Option<(String, ProfileIntegrationAccount)>> {
    let config = load_unified_profiles_config()?;

    for profile in &config.profiles {
        if let Some(account) = profile.get_account(&account_id) {
            return Ok(Some((profile.id.clone(), account.clone())));
        }
    }

    Ok(None)
}

/// Get account for a repository by integration type (from the assigned/detected profile)
#[command]
pub async fn get_repository_account(
    path: String,
    integration_type: IntegrationType,
) -> Result<Option<ProfileIntegrationAccount>> {
    let profile = detect_unified_profile_for_repository(path).await?;

    if let Some(profile) = profile {
        Ok(profile.get_default_account(&integration_type).cloned())
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_pattern_overlap() {
        // Same domain
        assert!(has_pattern_overlap(
            &["github.com/company/*".to_string()],
            &["github.com/company/repo".to_string()]
        ));

        // Same domain, different paths
        assert!(has_pattern_overlap(
            &["github.com/company/*".to_string()],
            &["github.com/other/*".to_string()]
        ));

        // Different domains
        assert!(!has_pattern_overlap(
            &["github.com/company/*".to_string()],
            &["gitlab.com/company/*".to_string()]
        ));
    }

    #[test]
    fn test_normalize_pattern() {
        assert_eq!(
            normalize_pattern("https://github.com/company/*"),
            "github.com/company"
        );
        assert_eq!(
            normalize_pattern("github.com/company/"),
            "github.com/company"
        );
    }
}
