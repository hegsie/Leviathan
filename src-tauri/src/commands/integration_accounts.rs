//! Integration accounts command handlers
//!
//! Manage multiple accounts for GitHub, GitLab, and Azure DevOps integrations
//! with URL-based auto-selection and per-repository assignments.

use std::fs;
use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{
    CachedUser, IntegrationAccount, IntegrationAccountsConfig, IntegrationConfig, IntegrationType,
};
use crate::utils::create_command;

/// Get the path to the integration accounts config file
fn get_accounts_path() -> Result<std::path::PathBuf> {
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

    Ok(app_config_dir.join("integration_accounts.json"))
}

/// Load integration accounts config from disk
fn load_accounts_config() -> Result<IntegrationAccountsConfig> {
    let path = get_accounts_path()?;

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

/// Save integration accounts config to disk
fn save_accounts_config(config: &IntegrationAccountsConfig) -> Result<()> {
    let path = get_accounts_path()?;

    let content = serde_json::to_string_pretty(config).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to serialize integration accounts: {}", e))
    })?;

    fs::write(&path, content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to write integration accounts: {}", e))
    })?;

    Ok(())
}

/// Run git config command to get remote URL
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
// Account CRUD Commands
// =============================================================================

/// Get all saved integration accounts
#[command]
pub async fn get_integration_accounts() -> Result<Vec<IntegrationAccount>> {
    let config = load_accounts_config()?;
    Ok(config.accounts)
}

/// Get integration accounts config including repository assignments
#[command]
pub async fn get_integration_accounts_config() -> Result<IntegrationAccountsConfig> {
    load_accounts_config()
}

/// Get accounts filtered by integration type
#[command]
pub async fn get_accounts_by_type(integration_type: IntegrationType) -> Result<Vec<IntegrationAccount>> {
    let config = load_accounts_config()?;
    Ok(config
        .accounts
        .into_iter()
        .filter(|a| a.integration_type == integration_type)
        .collect())
}

/// Get a single account by ID
#[command]
pub async fn get_integration_account(account_id: String) -> Result<Option<IntegrationAccount>> {
    let config = load_accounts_config()?;
    Ok(config.accounts.into_iter().find(|a| a.id == account_id))
}

/// Save an integration account (create or update)
#[command]
pub async fn save_integration_account(account: IntegrationAccount) -> Result<IntegrationAccount> {
    let mut config = load_accounts_config()?;
    config.save_account(account.clone());
    save_accounts_config(&config)?;
    Ok(account)
}

/// Delete an integration account
#[command]
pub async fn delete_integration_account(account_id: String) -> Result<()> {
    let mut config = load_accounts_config()?;
    config.delete_account(&account_id);
    save_accounts_config(&config)?;
    Ok(())
}

/// Set an account as the default for its integration type
#[command]
pub async fn set_default_account(account_id: String) -> Result<()> {
    let mut config = load_accounts_config()?;

    // Find the account to get its type
    let account = config
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| LeviathanError::OperationFailed("Account not found".to_string()))?;
    let integration_type = account.integration_type.clone();

    // Unset other defaults of the same type
    for acc in &mut config.accounts {
        if acc.integration_type == integration_type {
            acc.is_default = acc.id == account_id;
        }
    }

    save_accounts_config(&config)?;
    Ok(())
}

// =============================================================================
// Account Detection and Assignment Commands
// =============================================================================

/// Detect which account should be used for a repository based on URL patterns
#[command]
pub async fn detect_account_for_repository(
    path: String,
    integration_type: IntegrationType,
) -> Result<Option<IntegrationAccount>> {
    let config = load_accounts_config()?;
    let repo_path = Path::new(&path);

    // First check for manual assignment
    if let Some(account_id) = config.repository_assignments.get(&path) {
        if let Some(account) = config.accounts.iter().find(|a| &a.id == account_id) {
            if account.integration_type == integration_type {
                return Ok(Some(account.clone()));
            }
        }
    }

    // Get the remote URL
    if let Some(remote_url) = get_remote_url(repo_path) {
        // Find matching account by URL pattern
        if let Some(account) = config.find_matching_account(&remote_url, &integration_type) {
            return Ok(Some(account.clone()));
        }
    }

    // Return default account for this type if no match
    Ok(config.get_default_account(&integration_type).cloned())
}

/// Get the assigned account for a repository (checking assignment first, then auto-detect)
#[command]
pub async fn get_assigned_account(
    path: String,
    integration_type: IntegrationType,
) -> Result<Option<IntegrationAccount>> {
    detect_account_for_repository(path, integration_type).await
}

/// Manually assign an account to a repository
#[command]
pub async fn assign_account_to_repository(path: String, account_id: String) -> Result<()> {
    let mut config = load_accounts_config()?;

    // Verify the account exists
    if !config.accounts.iter().any(|a| a.id == account_id) {
        return Err(LeviathanError::OperationFailed(
            "Account not found".to_string(),
        ));
    }

    config.assign_account(path, account_id);
    save_accounts_config(&config)?;
    Ok(())
}

/// Remove account assignment from a repository
#[command]
pub async fn unassign_account_from_repository(path: String) -> Result<()> {
    let mut config = load_accounts_config()?;
    config.unassign_account(&path);
    save_accounts_config(&config)?;
    Ok(())
}

// =============================================================================
// Account User Cache Commands
// =============================================================================

/// Update the cached user info for an account
#[command]
pub async fn update_account_cached_user(account_id: String, user: CachedUser) -> Result<()> {
    let mut config = load_accounts_config()?;

    if let Some(account) = config.get_account_mut(&account_id) {
        account.update_cached_user(user);
        save_accounts_config(&config)?;
        Ok(())
    } else {
        Err(LeviathanError::OperationFailed(
            "Account not found".to_string(),
        ))
    }
}

/// Clear the cached user info for an account
#[command]
pub async fn clear_account_cached_user(account_id: String) -> Result<()> {
    let mut config = load_accounts_config()?;

    if let Some(account) = config.get_account_mut(&account_id) {
        account.clear_cached_user();
        save_accounts_config(&config)?;
        Ok(())
    } else {
        Err(LeviathanError::OperationFailed(
            "Account not found".to_string(),
        ))
    }
}

// =============================================================================
// Migration Commands
// =============================================================================

/// Result of migrating legacy tokens
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    /// Number of accounts migrated
    pub migrated_count: usize,
    /// Account IDs that were created
    pub created_accounts: Vec<String>,
    /// Any errors that occurred
    pub errors: Vec<String>,
}

/// Migrate legacy single tokens to the new multi-account system
/// This should be called once on app startup or when integration dialogs open
#[command]
pub async fn migrate_legacy_tokens() -> Result<MigrationResult> {
    let config = load_accounts_config()?;
    let result = MigrationResult {
        migrated_count: 0,
        created_accounts: Vec::new(),
        errors: Vec::new(),
    };

    // If there are already accounts, migration has been done or user has added accounts
    if !config.accounts.is_empty() {
        return Ok(result);
    }

    // Note: The actual token migration happens in the frontend because:
    // 1. Stronghold (secure storage) is managed by the frontend
    // 2. We need to check for legacy tokens in both file-based storage (ADO) and Stronghold
    // 3. The frontend will call this command after migrating tokens to create the accounts

    // This command is more of a marker/helper - the actual work is done client-side

    Ok(result)
}

/// Create a default account during migration (called from frontend after token migration)
#[command]
pub async fn create_migrated_account(
    name: String,
    integration_type: IntegrationType,
    config: IntegrationConfig,
    cached_user: Option<CachedUser>,
) -> Result<IntegrationAccount> {
    let mut accounts_config = load_accounts_config()?;

    let mut account = match integration_type {
        IntegrationType::GitHub => IntegrationAccount::new_github(name),
        IntegrationType::GitLab => {
            if let IntegrationConfig::GitLab { instance_url } = config {
                IntegrationAccount::new_gitlab(name, instance_url)
            } else {
                IntegrationAccount::new_gitlab(name, "https://gitlab.com".to_string())
            }
        }
        IntegrationType::AzureDevOps => {
            if let IntegrationConfig::AzureDevOps { organization } = config {
                IntegrationAccount::new_azure_devops(name, organization)
            } else {
                return Err(LeviathanError::OperationFailed(
                    "Organization required for Azure DevOps account".to_string(),
                ));
            }
        }
    };

    // Mark as default since it's the first account of this type
    account.is_default = true;

    // Set cached user if provided
    if let Some(user) = cached_user {
        account.cached_user = Some(user);
    }

    accounts_config.save_account(account.clone());
    save_accounts_config(&accounts_config)?;

    Ok(account)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account_creation() {
        let account = IntegrationAccount::new_github("Test".to_string());
        assert_eq!(account.name, "Test");
        assert_eq!(account.integration_type, IntegrationType::GitHub);
        assert!(!account.is_default);
    }

    #[test]
    fn test_gitlab_account_with_instance() {
        let account =
            IntegrationAccount::new_gitlab("Work".to_string(), "https://gitlab.mycompany.com".to_string());
        assert_eq!(account.integration_type, IntegrationType::GitLab);
        if let IntegrationConfig::GitLab { instance_url } = account.config {
            assert_eq!(instance_url, "https://gitlab.mycompany.com");
        } else {
            panic!("Expected GitLab config");
        }
    }

    #[test]
    fn test_ado_account_with_org() {
        let account = IntegrationAccount::new_azure_devops("Work".to_string(), "myorg".to_string());
        assert_eq!(account.integration_type, IntegrationType::AzureDevOps);
        if let IntegrationConfig::AzureDevOps { organization } = account.config {
            assert_eq!(organization, "myorg");
        } else {
            panic!("Expected Azure DevOps config");
        }
    }
}
