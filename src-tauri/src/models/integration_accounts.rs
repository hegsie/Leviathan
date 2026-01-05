//! Integration account models for managing multiple identities across services
//!
//! Supports GitHub, GitLab, and Azure DevOps with URL-based auto-selection
//! and per-repository account assignments.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Integration service type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum IntegrationType {
    #[serde(rename = "github")]
    GitHub,
    #[serde(rename = "gitlab")]
    GitLab,
    #[serde(rename = "azure-devops")]
    AzureDevOps,
    #[serde(rename = "bitbucket")]
    Bitbucket,
}

impl std::fmt::Display for IntegrationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IntegrationType::GitHub => write!(f, "github"),
            IntegrationType::GitLab => write!(f, "gitlab"),
            IntegrationType::AzureDevOps => write!(f, "azure-devops"),
            IntegrationType::Bitbucket => write!(f, "bitbucket"),
        }
    }
}

/// Integration-specific configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IntegrationConfig {
    /// GitHub configuration (uses api.github.com by default)
    #[serde(rename = "github")]
    GitHub,
    /// GitLab configuration with instance URL
    #[serde(rename = "gitlab")]
    GitLab {
        /// Instance URL (e.g., "https://gitlab.com" or self-hosted)
        #[serde(rename = "instanceUrl")]
        instance_url: String,
    },
    /// Azure DevOps configuration with organization
    #[serde(rename = "azure-devops")]
    AzureDevOps {
        /// Organization name
        organization: String,
    },
    /// Bitbucket configuration with workspace
    #[serde(rename = "bitbucket")]
    Bitbucket {
        /// Workspace (typically the username or organization)
        workspace: String,
    },
}

impl IntegrationConfig {
    /// Get the integration type for this config
    pub fn integration_type(&self) -> IntegrationType {
        match self {
            IntegrationConfig::GitHub => IntegrationType::GitHub,
            IntegrationConfig::GitLab { .. } => IntegrationType::GitLab,
            IntegrationConfig::AzureDevOps { .. } => IntegrationType::AzureDevOps,
            IntegrationConfig::Bitbucket { .. } => IntegrationType::Bitbucket,
        }
    }
}

/// Cached user information for quick display without API calls
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedUser {
    /// Username or login
    pub username: String,
    /// Display name (may be different from username)
    pub display_name: Option<String>,
    /// Avatar URL for display
    pub avatar_url: Option<String>,
    /// Email address
    pub email: Option<String>,
}

/// Legacy integration account for connecting to external services
///
/// @deprecated Use unified_profile::IntegrationAccount instead.
/// This type is kept for backward compatibility with the legacy system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyIntegrationAccount {
    /// Unique identifier (UUID)
    pub id: String,
    /// Display name (e.g., "Work GitHub", "Personal GitLab")
    pub name: String,
    /// Integration type
    pub integration_type: IntegrationType,
    /// URL patterns for auto-detection (e.g., "github.com/mycompany/*")
    pub url_patterns: Vec<String>,
    /// Whether this is the default account for this integration type
    pub is_default: bool,
    /// Optional color for UI display
    pub color: Option<String>,
    /// Integration-specific configuration
    pub config: IntegrationConfig,
    /// Cached user info (updated on connection check)
    pub cached_user: Option<CachedUser>,
}

impl LegacyIntegrationAccount {
    /// Create a new GitHub account
    pub fn new_github(name: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::GitHub,
            url_patterns: Vec::new(),
            is_default: false,
            color: None,
            config: IntegrationConfig::GitHub,
            cached_user: None,
        }
    }

    /// Create a new GitLab account
    pub fn new_gitlab(name: String, instance_url: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::GitLab,
            url_patterns: Vec::new(),
            is_default: false,
            color: None,
            config: IntegrationConfig::GitLab { instance_url },
            cached_user: None,
        }
    }

    /// Create a new Azure DevOps account
    pub fn new_azure_devops(name: String, organization: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::AzureDevOps,
            url_patterns: Vec::new(),
            is_default: false,
            color: None,
            config: IntegrationConfig::AzureDevOps { organization },
            cached_user: None,
        }
    }

    /// Create a new Bitbucket account
    pub fn new_bitbucket(name: String, workspace: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::Bitbucket,
            url_patterns: Vec::new(),
            is_default: false,
            color: None,
            config: IntegrationConfig::Bitbucket { workspace },
            cached_user: None,
        }
    }

    /// Check if this account matches a remote URL
    pub fn matches_url(&self, url: &str) -> bool {
        self.url_patterns
            .iter()
            .any(|pattern| url_matches_pattern(url, pattern))
    }

    /// Update cached user info
    pub fn update_cached_user(&mut self, user: CachedUser) {
        self.cached_user = Some(user);
    }

    /// Clear cached user info
    pub fn clear_cached_user(&mut self) {
        self.cached_user = None;
    }
}

/// Check if a URL matches a glob-like pattern
/// Reuses the same logic as GitProfile URL matching
fn url_matches_pattern(url: &str, pattern: &str) -> bool {
    // Normalize URL: remove protocol and trailing slashes
    let normalized_url = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("git@")
        .replace(':', "/")
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .to_lowercase();

    let normalized_pattern = pattern
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_lowercase();

    // Handle wildcard patterns
    if normalized_pattern.ends_with("/*") {
        let prefix = normalized_pattern.trim_end_matches("/*");
        normalized_url.starts_with(prefix)
    } else if normalized_pattern.contains('*') {
        // Simple glob matching for patterns like "github.com/*/repo"
        let parts: Vec<&str> = normalized_pattern.split('*').collect();
        if parts.len() == 2 {
            normalized_url.starts_with(parts[0]) && normalized_url.ends_with(parts[1])
        } else {
            normalized_url == normalized_pattern
        }
    } else {
        normalized_url == normalized_pattern
            || normalized_url.starts_with(&format!("{}/", normalized_pattern))
    }
}

/// Legacy configuration for storing integration accounts
///
/// @deprecated Use unified_profile::UnifiedProfilesConfig instead.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyIntegrationAccountsConfig {
    /// All saved accounts
    pub accounts: Vec<LegacyIntegrationAccount>,
    /// Repository to account assignments (repo path -> account id)
    pub repository_assignments: HashMap<String, String>,
}

impl LegacyIntegrationAccountsConfig {
    /// Get accounts by integration type
    pub fn get_accounts_by_type(
        &self,
        integration_type: &IntegrationType,
    ) -> Vec<&LegacyIntegrationAccount> {
        self.accounts
            .iter()
            .filter(|a| &a.integration_type == integration_type)
            .collect()
    }

    /// Get the default account for an integration type
    pub fn get_default_account(
        &self,
        integration_type: &IntegrationType,
    ) -> Option<&LegacyIntegrationAccount> {
        self.accounts
            .iter()
            .find(|a| &a.integration_type == integration_type && a.is_default)
    }

    /// Get an account by ID
    pub fn get_account(&self, account_id: &str) -> Option<&LegacyIntegrationAccount> {
        self.accounts.iter().find(|a| a.id == account_id)
    }

    /// Get a mutable account by ID
    pub fn get_account_mut(&mut self, account_id: &str) -> Option<&mut LegacyIntegrationAccount> {
        self.accounts.iter_mut().find(|a| a.id == account_id)
    }

    /// Add or update an account
    pub fn save_account(&mut self, account: LegacyIntegrationAccount) {
        // If this account is being set as default, unset other defaults of same type
        if account.is_default {
            for existing in &mut self.accounts {
                if existing.integration_type == account.integration_type
                    && existing.id != account.id
                {
                    existing.is_default = false;
                }
            }
        }

        // Update existing or add new
        if let Some(existing) = self.accounts.iter_mut().find(|a| a.id == account.id) {
            *existing = account;
        } else {
            self.accounts.push(account);
        }
    }

    /// Delete an account
    pub fn delete_account(&mut self, account_id: &str) {
        self.accounts.retain(|a| a.id != account_id);
        // Also remove any repository assignments for this account
        self.repository_assignments.retain(|_, v| v != account_id);
    }

    /// Find matching account for a repository URL
    pub fn find_matching_account(
        &self,
        url: &str,
        integration_type: &IntegrationType,
    ) -> Option<&LegacyIntegrationAccount> {
        self.accounts
            .iter()
            .filter(|a| &a.integration_type == integration_type)
            .find(|a| a.matches_url(url))
    }

    /// Get the account assigned to a repository
    pub fn get_assigned_account(&self, repo_path: &str) -> Option<&LegacyIntegrationAccount> {
        self.repository_assignments
            .get(repo_path)
            .and_then(|account_id| self.get_account(account_id))
    }

    /// Assign an account to a repository
    pub fn assign_account(&mut self, repo_path: String, account_id: String) {
        self.repository_assignments.insert(repo_path, account_id);
    }

    /// Remove account assignment from a repository
    pub fn unassign_account(&mut self, repo_path: &str) {
        self.repository_assignments.remove(repo_path);
    }
}

// Type aliases for backward compatibility
pub type IntegrationAccountsConfig = LegacyIntegrationAccountsConfig;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_matches_pattern_exact() {
        assert!(url_matches_pattern(
            "https://github.com/mycompany/repo",
            "github.com/mycompany/repo"
        ));
    }

    #[test]
    fn test_url_matches_pattern_wildcard() {
        assert!(url_matches_pattern(
            "https://github.com/mycompany/any-repo",
            "github.com/mycompany/*"
        ));
    }

    #[test]
    fn test_url_matches_pattern_git_protocol() {
        assert!(url_matches_pattern(
            "git@github.com:mycompany/repo.git",
            "github.com/mycompany/*"
        ));
    }

    #[test]
    fn test_account_matches_url() {
        let account = LegacyIntegrationAccount::new_github("Work".to_string());
        let mut account = account;
        account.url_patterns = vec!["github.com/mycompany/*".to_string()];

        assert!(account.matches_url("https://github.com/mycompany/repo"));
        assert!(!account.matches_url("https://github.com/personal/repo"));
    }

    #[test]
    fn test_config_get_accounts_by_type() {
        let mut config = LegacyIntegrationAccountsConfig::default();
        config
            .accounts
            .push(LegacyIntegrationAccount::new_github("Work GH".to_string()));
        config
            .accounts
            .push(LegacyIntegrationAccount::new_github("Personal GH".to_string()));
        config.accounts.push(LegacyIntegrationAccount::new_gitlab(
            "Work GL".to_string(),
            "https://gitlab.com".to_string(),
        ));

        let github_accounts = config.get_accounts_by_type(&IntegrationType::GitHub);
        assert_eq!(github_accounts.len(), 2);

        let gitlab_accounts = config.get_accounts_by_type(&IntegrationType::GitLab);
        assert_eq!(gitlab_accounts.len(), 1);
    }

    #[test]
    fn test_save_account_sets_single_default() {
        let mut config = LegacyIntegrationAccountsConfig::default();

        let mut account1 = LegacyIntegrationAccount::new_github("First".to_string());
        account1.is_default = true;
        config.save_account(account1.clone());

        let mut account2 = LegacyIntegrationAccount::new_github("Second".to_string());
        account2.is_default = true;
        config.save_account(account2.clone());

        // Only account2 should be default now
        let first = config.get_account(&account1.id).unwrap();
        let second = config.get_account(&account2.id).unwrap();

        assert!(!first.is_default);
        assert!(second.is_default);
    }

    #[test]
    fn test_integration_type_display() {
        assert_eq!(IntegrationType::GitHub.to_string(), "github");
        assert_eq!(IntegrationType::GitLab.to_string(), "gitlab");
        assert_eq!(IntegrationType::AzureDevOps.to_string(), "azure-devops");
        assert_eq!(IntegrationType::Bitbucket.to_string(), "bitbucket");
    }
}
