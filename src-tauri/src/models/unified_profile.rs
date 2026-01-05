//! Unified profile models - combines git identity with global integration accounts
//!
//! Architecture (v3):
//! - Profiles contain git identity (name, email, signing key) + default account preferences
//! - Integration accounts are GLOBAL - available to all profiles, not owned by profiles
//! - Repository assignments map repos to profiles (for git identity)
//! - Any account can be used regardless of active profile
//!
//! This replaces the separate GitProfile and IntegrationAccount systems.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Re-use the integration types from the existing module
pub use super::integration_accounts::{CachedUser, IntegrationConfig, IntegrationType};

/// Current version of the unified profiles config format
/// v3: Global accounts (accounts no longer nested in profiles)
pub const UNIFIED_PROFILES_CONFIG_VERSION: u32 = 3;

/// Default profile colors for UI display
pub const PROFILE_COLORS: &[&str] = &[
    "#3b82f6", // blue
    "#10b981", // green
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#f97316", // orange
];

// =============================================================================
// Global Integration Account (v3)
// =============================================================================

/// Global integration account (v3)
///
/// Accounts are now global - not owned by profiles. Any account can be used
/// regardless of which profile is active. Profiles only reference accounts
/// via their default_accounts preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationAccount {
    /// Unique identifier (UUID)
    pub id: String,
    /// Display name (e.g., "Work GitHub", "GitHub Enterprise SSO")
    pub name: String,
    /// Integration type
    pub integration_type: IntegrationType,
    /// Integration-specific configuration
    pub config: IntegrationConfig,
    /// Optional color for UI display
    pub color: Option<String>,
    /// Cached user info (updated on connection check)
    pub cached_user: Option<CachedUser>,
    /// URL patterns for auto-detection (e.g., "github.com/mycompany/*")
    pub url_patterns: Vec<String>,
    /// Whether this is the default account for this integration type globally
    pub is_default: bool,
}

impl IntegrationAccount {
    /// Create a new GitHub account
    pub fn new_github(name: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::GitHub,
            config: IntegrationConfig::GitHub,
            color: None,
            cached_user: None,
            url_patterns: Vec::new(),
            is_default: false,
        }
    }

    /// Create a new GitLab account
    pub fn new_gitlab(name: String, instance_url: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::GitLab,
            config: IntegrationConfig::GitLab { instance_url },
            color: None,
            cached_user: None,
            url_patterns: Vec::new(),
            is_default: false,
        }
    }

    /// Create a new Azure DevOps account
    pub fn new_azure_devops(name: String, organization: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::AzureDevOps,
            config: IntegrationConfig::AzureDevOps { organization },
            color: None,
            cached_user: None,
            url_patterns: Vec::new(),
            is_default: false,
        }
    }

    /// Create a new Bitbucket account
    pub fn new_bitbucket(name: String, workspace: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::Bitbucket,
            config: IntegrationConfig::Bitbucket { workspace },
            color: None,
            cached_user: None,
            url_patterns: Vec::new(),
            is_default: false,
        }
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

// =============================================================================
// Deprecated V2 Types (for migration only)
// =============================================================================

/// Integration account linked to a unified profile (v2 format)
///
/// Unlike standalone IntegrationAccount, this doesn't have its own URL patterns -
/// it inherits the profile's patterns for auto-detection.
#[allow(deprecated)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileIntegrationAccount {
    /// Unique identifier (UUID)
    pub id: String,
    /// Display name (e.g., "Work GitHub", "GitHub Enterprise SSO")
    pub name: String,
    /// Integration type
    pub integration_type: IntegrationType,
    /// Integration-specific configuration
    pub config: IntegrationConfig,
    /// Optional color for UI display (inherits from profile if null)
    pub color: Option<String>,
    /// Cached user info (updated on connection check)
    pub cached_user: Option<CachedUser>,
    /// Whether this is the default account for this integration type within the profile
    pub is_default_for_type: bool,
}

impl ProfileIntegrationAccount {
    /// Create a new GitHub account
    pub fn new_github(name: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::GitHub,
            config: IntegrationConfig::GitHub,
            color: None,
            cached_user: None,
            is_default_for_type: false,
        }
    }

    /// Create a new GitLab account
    pub fn new_gitlab(name: String, instance_url: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::GitLab,
            config: IntegrationConfig::GitLab { instance_url },
            color: None,
            cached_user: None,
            is_default_for_type: false,
        }
    }

    /// Create a new Azure DevOps account
    pub fn new_azure_devops(name: String, organization: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::AzureDevOps,
            config: IntegrationConfig::AzureDevOps { organization },
            color: None,
            cached_user: None,
            is_default_for_type: false,
        }
    }

    /// Create a new Bitbucket account
    pub fn new_bitbucket(name: String, workspace: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            integration_type: IntegrationType::Bitbucket,
            config: IntegrationConfig::Bitbucket { workspace },
            color: None,
            cached_user: None,
            is_default_for_type: false,
        }
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

// =============================================================================
// Unified Profile (v3)
// =============================================================================

/// Unified profile containing git identity and default account preferences (v3)
///
/// A profile represents a git identity context (e.g., "Work", "Personal").
/// Accounts are now global - profiles only store preferences for which account
/// to use as default for each integration type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedProfile {
    /// Unique identifier
    pub id: String,
    /// Display name (e.g., "Work", "Personal", "Open Source")
    pub name: String,

    // Git Identity
    /// Git user.name value
    pub git_name: String,
    /// Git user.email value
    pub git_email: String,
    /// Optional GPG signing key ID
    pub signing_key: Option<String>,

    // Profile Settings
    /// URL patterns for auto-detection (e.g., "github.com/mycompany/*")
    pub url_patterns: Vec<String>,
    /// Whether this is the default profile
    pub is_default: bool,
    /// Color for UI display
    pub color: String,

    // Default Account Preferences (v3)
    /// Default account ID for each integration type (optional per type)
    #[serde(default)]
    pub default_accounts: HashMap<IntegrationType, String>,
}

/// Unified profile with embedded accounts (v2 format)
///
/// A profile represents a complete "context" (e.g., "Work", "Personal") that includes
/// both the git identity and all associated platform accounts.
#[allow(deprecated)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedProfileV2 {
    /// Unique identifier
    pub id: String,
    /// Display name (e.g., "Work", "Personal", "Open Source")
    pub name: String,

    // Git Identity
    /// Git user.name value
    pub git_name: String,
    /// Git user.email value
    pub git_email: String,
    /// Optional GPG signing key ID
    pub signing_key: Option<String>,

    // Profile Settings
    /// URL patterns for auto-detection (e.g., "github.com/mycompany/*")
    pub url_patterns: Vec<String>,
    /// Whether this is the default profile
    pub is_default: bool,
    /// Color for UI display
    pub color: String,

    // Linked Integration Accounts (v2)
    /// Integration accounts associated with this profile
    pub integration_accounts: Vec<ProfileIntegrationAccount>,
}

impl UnifiedProfile {
    /// Create a new unified profile (v3)
    pub fn new(name: String, git_name: String, git_email: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            git_name,
            git_email,
            signing_key: None,
            url_patterns: Vec::new(),
            is_default: false,
            color: PROFILE_COLORS[0].to_string(),
            default_accounts: HashMap::new(),
        }
    }

    /// Check if this profile matches a remote URL
    pub fn matches_url(&self, url: &str) -> bool {
        self.url_patterns
            .iter()
            .any(|pattern| url_matches_pattern(url, pattern))
    }

    /// Get the default account ID for a specific integration type
    pub fn get_default_account_id(&self, integration_type: &IntegrationType) -> Option<&String> {
        self.default_accounts.get(integration_type)
    }

    /// Set the default account for a specific integration type
    pub fn set_default_account(&mut self, integration_type: IntegrationType, account_id: String) {
        self.default_accounts.insert(integration_type, account_id);
    }

    /// Remove the default account for a specific integration type
    pub fn remove_default_account(&mut self, integration_type: &IntegrationType) {
        self.default_accounts.remove(integration_type);
    }
}

#[allow(deprecated)]
impl UnifiedProfileV2 {
    /// Check if this profile matches a remote URL
    pub fn matches_url(&self, url: &str) -> bool {
        self.url_patterns
            .iter()
            .any(|pattern| url_matches_pattern(url, pattern))
    }

    /// Get the default account for a specific integration type
    pub fn get_default_account(
        &self,
        integration_type: &IntegrationType,
    ) -> Option<&ProfileIntegrationAccount> {
        self.integration_accounts
            .iter()
            .find(|a| &a.integration_type == integration_type && a.is_default_for_type)
            .or_else(|| {
                self.integration_accounts
                    .iter()
                    .find(|a| &a.integration_type == integration_type)
            })
    }

    /// Convert v2 profile to v3 profile (accounts are extracted separately)
    pub fn to_v3(&self) -> UnifiedProfile {
        let mut default_accounts = HashMap::new();
        for account in &self.integration_accounts {
            if account.is_default_for_type {
                default_accounts.insert(account.integration_type.clone(), account.id.clone());
            }
        }
        // If no default was set, use the first account of each type
        for account in &self.integration_accounts {
            default_accounts
                .entry(account.integration_type.clone())
                .or_insert_with(|| account.id.clone());
        }

        UnifiedProfile {
            id: self.id.clone(),
            name: self.name.clone(),
            git_name: self.git_name.clone(),
            git_email: self.git_email.clone(),
            signing_key: self.signing_key.clone(),
            url_patterns: self.url_patterns.clone(),
            is_default: self.is_default,
            color: self.color.clone(),
            default_accounts,
        }
    }

    /// Extract accounts from v2 profile as global IntegrationAccounts
    pub fn extract_accounts(&self) -> Vec<IntegrationAccount> {
        self.integration_accounts
            .iter()
            .map(|a| IntegrationAccount {
                id: a.id.clone(),
                name: a.name.clone(),
                integration_type: a.integration_type.clone(),
                config: a.config.clone(),
                color: a.color.clone(),
                cached_user: a.cached_user.clone(),
                url_patterns: Vec::new(), // v2 accounts didn't have their own patterns
                is_default: a.is_default_for_type,
            })
            .collect()
    }
}

// =============================================================================
// Configuration Types (v3)
// =============================================================================

/// Configuration for storing unified profiles and global accounts (v3)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedProfilesConfig {
    /// Version number for migration support (currently 3)
    pub version: u32,
    /// All saved profiles
    pub profiles: Vec<UnifiedProfile>,
    /// Global integration accounts (available to all profiles)
    #[serde(default)]
    pub accounts: Vec<IntegrationAccount>,
    /// Repository to profile assignments (repo path -> profile id)
    pub repository_assignments: HashMap<String, String>,
}

/// Configuration for storing unified profiles (v2 format - for migration)
#[allow(deprecated)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedProfilesConfigV2 {
    /// Version number
    pub version: u32,
    /// All saved profiles (with embedded accounts)
    pub profiles: Vec<UnifiedProfileV2>,
    /// Repository to profile assignments (repo path -> profile id)
    pub repository_assignments: HashMap<String, String>,
}

impl Default for UnifiedProfilesConfig {
    fn default() -> Self {
        Self {
            version: UNIFIED_PROFILES_CONFIG_VERSION,
            profiles: Vec::new(),
            accounts: Vec::new(),
            repository_assignments: HashMap::new(),
        }
    }
}

impl UnifiedProfilesConfig {
    // =========================================================================
    // Profile Methods
    // =========================================================================

    /// Get a profile by ID
    pub fn get_profile(&self, profile_id: &str) -> Option<&UnifiedProfile> {
        self.profiles.iter().find(|p| p.id == profile_id)
    }

    /// Get a mutable profile by ID
    pub fn get_profile_mut(&mut self, profile_id: &str) -> Option<&mut UnifiedProfile> {
        self.profiles.iter_mut().find(|p| p.id == profile_id)
    }

    /// Get the default profile
    pub fn get_default_profile(&self) -> Option<&UnifiedProfile> {
        self.profiles.iter().find(|p| p.is_default)
    }

    /// Add or update a profile
    pub fn save_profile(&mut self, profile: UnifiedProfile) {
        // If this profile is being set as default, unset other defaults
        if profile.is_default {
            for existing in &mut self.profiles {
                if existing.id != profile.id {
                    existing.is_default = false;
                }
            }
        }

        // Update existing or add new
        if let Some(existing) = self.profiles.iter_mut().find(|p| p.id == profile.id) {
            *existing = profile;
        } else {
            self.profiles.push(profile);
        }
    }

    /// Delete a profile
    pub fn delete_profile(&mut self, profile_id: &str) {
        self.profiles.retain(|p| p.id != profile_id);
        // Also remove any repository assignments for this profile
        self.repository_assignments.retain(|_, v| v != profile_id);
    }

    /// Find matching profile for a repository URL
    pub fn find_matching_profile(&self, url: &str) -> Option<&UnifiedProfile> {
        self.profiles.iter().find(|p| p.matches_url(url))
    }

    /// Get the profile assigned to a repository
    pub fn get_assigned_profile(&self, repo_path: &str) -> Option<&UnifiedProfile> {
        self.repository_assignments
            .get(repo_path)
            .and_then(|profile_id| self.get_profile(profile_id))
    }

    /// Assign a profile to a repository
    pub fn assign_profile(&mut self, repo_path: String, profile_id: String) {
        self.repository_assignments.insert(repo_path, profile_id);
    }

    /// Remove profile assignment from a repository
    pub fn unassign_profile(&mut self, repo_path: &str) {
        self.repository_assignments.remove(repo_path);
    }

    // =========================================================================
    // Global Account Methods (v3)
    // =========================================================================

    /// Get a global account by ID
    pub fn get_account(&self, account_id: &str) -> Option<&IntegrationAccount> {
        self.accounts.iter().find(|a| a.id == account_id)
    }

    /// Get a mutable global account by ID
    pub fn get_account_mut(&mut self, account_id: &str) -> Option<&mut IntegrationAccount> {
        self.accounts.iter_mut().find(|a| a.id == account_id)
    }

    /// Get all accounts of a specific type
    pub fn get_accounts_by_type(&self, integration_type: &IntegrationType) -> Vec<&IntegrationAccount> {
        self.accounts
            .iter()
            .filter(|a| &a.integration_type == integration_type)
            .collect()
    }

    /// Get the default global account for a specific type
    pub fn get_default_account(&self, integration_type: &IntegrationType) -> Option<&IntegrationAccount> {
        self.accounts
            .iter()
            .find(|a| &a.integration_type == integration_type && a.is_default)
            .or_else(|| {
                // Fall back to first account of this type
                self.accounts
                    .iter()
                    .find(|a| &a.integration_type == integration_type)
            })
    }

    /// Add or update a global account
    pub fn save_account(&mut self, account: IntegrationAccount) {
        // If this account is being set as default, unset other defaults of same type
        if account.is_default {
            for existing in &mut self.accounts {
                if existing.integration_type == account.integration_type && existing.id != account.id {
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

    /// Delete a global account
    pub fn delete_account(&mut self, account_id: &str) {
        self.accounts.retain(|a| a.id != account_id);
        // Also remove from any profile's default_accounts
        for profile in &mut self.profiles {
            profile.default_accounts.retain(|_, v| v != account_id);
        }
    }

    /// Set the default global account for a specific type
    pub fn set_default_account(&mut self, integration_type: &IntegrationType, account_id: &str) {
        for account in &mut self.accounts {
            if &account.integration_type == integration_type {
                account.is_default = account.id == account_id;
            }
        }
    }

    /// Get the profile's preferred account for a specific type
    /// Falls back to global default if profile has no preference
    pub fn get_profile_preferred_account(
        &self,
        profile_id: &str,
        integration_type: &IntegrationType,
    ) -> Option<&IntegrationAccount> {
        if let Some(profile) = self.get_profile(profile_id) {
            if let Some(account_id) = profile.get_default_account_id(integration_type) {
                if let Some(account) = self.get_account(account_id) {
                    return Some(account);
                }
            }
        }
        // Fall back to global default
        self.get_default_account(integration_type)
    }

    /// Get count of accounts by type
    pub fn account_count_by_type(&self) -> HashMap<IntegrationType, usize> {
        let mut counts = HashMap::new();
        for account in &self.accounts {
            *counts.entry(account.integration_type.clone()).or_insert(0) += 1;
        }
        counts
    }
}

#[allow(deprecated)]
impl UnifiedProfilesConfigV2 {
    /// Migrate v2 config to v3
    pub fn to_v3(&self) -> UnifiedProfilesConfig {
        let mut accounts = Vec::new();
        let mut profiles = Vec::new();

        // Extract all accounts from profiles
        for v2_profile in &self.profiles {
            // Convert profile to v3
            profiles.push(v2_profile.to_v3());

            // Extract accounts
            for account in v2_profile.extract_accounts() {
                // Only add if not already present (by ID)
                if !accounts.iter().any(|a: &IntegrationAccount| a.id == account.id) {
                    accounts.push(account);
                }
            }
        }

        UnifiedProfilesConfig {
            version: UNIFIED_PROFILES_CONFIG_VERSION,
            profiles,
            accounts,
            repository_assignments: self.repository_assignments.clone(),
        }
    }
}

/// Check if a URL matches a glob-like pattern
pub fn url_matches_pattern(url: &str, pattern: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // Profile Tests (v3)
    // =========================================================================

    #[test]
    fn test_create_profile() {
        let profile = UnifiedProfile::new(
            "Work".to_string(),
            "John Doe".to_string(),
            "john@company.com".to_string(),
        );
        assert_eq!(profile.name, "Work");
        assert_eq!(profile.git_name, "John Doe");
        assert_eq!(profile.git_email, "john@company.com");
        assert!(!profile.is_default);
        assert!(profile.default_accounts.is_empty());
    }

    #[test]
    fn test_profile_url_matching() {
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );
        profile.url_patterns = vec!["github.com/company/*".to_string()];

        assert!(profile.matches_url("https://github.com/company/repo"));
        assert!(profile.matches_url("git@github.com:company/repo.git"));
        assert!(!profile.matches_url("https://github.com/personal/repo"));
    }

    #[test]
    fn test_profile_default_account_preferences() {
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );

        // Set default accounts
        profile.set_default_account(IntegrationType::GitHub, "github-account-id".to_string());
        profile.set_default_account(IntegrationType::GitLab, "gitlab-account-id".to_string());

        // Check preferences
        assert_eq!(
            profile.get_default_account_id(&IntegrationType::GitHub),
            Some(&"github-account-id".to_string())
        );
        assert_eq!(
            profile.get_default_account_id(&IntegrationType::GitLab),
            Some(&"gitlab-account-id".to_string())
        );
        assert_eq!(profile.get_default_account_id(&IntegrationType::AzureDevOps), None);

        // Remove preference
        profile.remove_default_account(&IntegrationType::GitHub);
        assert_eq!(profile.get_default_account_id(&IntegrationType::GitHub), None);
    }

    // =========================================================================
    // Global Account Tests (v3)
    // =========================================================================

    #[test]
    fn test_create_global_account() {
        let github = IntegrationAccount::new_github("My GitHub".to_string());
        assert_eq!(github.integration_type, IntegrationType::GitHub);
        assert!(!github.is_default);
        assert!(matches!(github.config, IntegrationConfig::GitHub));
        assert!(github.url_patterns.is_empty());

        let gitlab = IntegrationAccount::new_gitlab(
            "My GitLab".to_string(),
            "https://gitlab.company.com".to_string(),
        );
        assert_eq!(gitlab.integration_type, IntegrationType::GitLab);
        if let IntegrationConfig::GitLab { instance_url } = &gitlab.config {
            assert_eq!(instance_url, "https://gitlab.company.com");
        } else {
            panic!("Expected GitLab config");
        }

        let azure = IntegrationAccount::new_azure_devops(
            "My Azure".to_string(),
            "my-org".to_string(),
        );
        assert_eq!(azure.integration_type, IntegrationType::AzureDevOps);
        if let IntegrationConfig::AzureDevOps { organization } = &azure.config {
            assert_eq!(organization, "my-org");
        } else {
            panic!("Expected AzureDevOps config");
        }
    }

    #[test]
    fn test_config_global_accounts() {
        let mut config = UnifiedProfilesConfig::default();

        // Add global accounts
        let mut account1 = IntegrationAccount::new_github("GitHub 1".to_string());
        account1.is_default = true;
        let account1_id = account1.id.clone();
        config.save_account(account1);

        let account2 = IntegrationAccount::new_github("GitHub 2".to_string());
        let account2_id = account2.id.clone();
        config.save_account(account2);

        let account3 = IntegrationAccount::new_gitlab(
            "GitLab 1".to_string(),
            "https://gitlab.com".to_string(),
        );
        config.save_account(account3);

        // Check accounts
        assert_eq!(config.accounts.len(), 3);
        assert!(config.get_account(&account1_id).is_some());
        assert!(config.get_account(&account2_id).is_some());

        // Check by type
        let github_accounts = config.get_accounts_by_type(&IntegrationType::GitHub);
        let gitlab_accounts = config.get_accounts_by_type(&IntegrationType::GitLab);
        assert_eq!(github_accounts.len(), 2);
        assert_eq!(gitlab_accounts.len(), 1);

        // Check default
        let default = config.get_default_account(&IntegrationType::GitHub);
        assert!(default.is_some());
        assert_eq!(default.unwrap().id, account1_id);
    }

    #[test]
    fn test_config_default_account_switching() {
        let mut config = UnifiedProfilesConfig::default();

        let mut account1 = IntegrationAccount::new_github("GitHub 1".to_string());
        account1.is_default = true;
        let account1_id = account1.id.clone();
        config.save_account(account1);

        let mut account2 = IntegrationAccount::new_github("GitHub 2".to_string());
        account2.is_default = true;
        let account2_id = account2.id.clone();
        config.save_account(account2);

        // Only account2 should be default now
        let acc1 = config.get_account(&account1_id).unwrap();
        let acc2 = config.get_account(&account2_id).unwrap();
        assert!(!acc1.is_default);
        assert!(acc2.is_default);

        // get_default_account should return account2
        let default = config.get_default_account(&IntegrationType::GitHub).unwrap();
        assert_eq!(default.id, account2_id);
    }

    #[test]
    fn test_delete_global_account() {
        let mut config = UnifiedProfilesConfig::default();

        let account1 = IntegrationAccount::new_github("GitHub 1".to_string());
        let account2 = IntegrationAccount::new_gitlab(
            "GitLab 1".to_string(),
            "https://gitlab.com".to_string(),
        );
        let account1_id = account1.id.clone();
        config.save_account(account1);
        config.save_account(account2);

        // Add a profile with a default account reference
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );
        profile.set_default_account(IntegrationType::GitHub, account1_id.clone());
        config.save_profile(profile);

        assert_eq!(config.accounts.len(), 2);

        // Delete account
        config.delete_account(&account1_id);

        assert_eq!(config.accounts.len(), 1);
        assert!(config.get_account(&account1_id).is_none());

        // Profile's default account reference should also be removed
        let profile = config.profiles.first().unwrap();
        assert!(profile.get_default_account_id(&IntegrationType::GitHub).is_none());
    }

    #[test]
    fn test_profile_preferred_account() {
        let mut config = UnifiedProfilesConfig::default();

        // Add global accounts
        let mut account1 = IntegrationAccount::new_github("GitHub Global Default".to_string());
        account1.is_default = true;
        let account1_id = account1.id.clone();
        config.save_account(account1);

        let account2 = IntegrationAccount::new_github("GitHub Work".to_string());
        let account2_id = account2.id.clone();
        config.save_account(account2);

        // Add profile with preference
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );
        profile.set_default_account(IntegrationType::GitHub, account2_id.clone());
        let profile_id = profile.id.clone();
        config.save_profile(profile);

        // Profile should prefer account2
        let preferred = config.get_profile_preferred_account(&profile_id, &IntegrationType::GitHub);
        assert!(preferred.is_some());
        assert_eq!(preferred.unwrap().id, account2_id);

        // For a type with no preference, should fall back to global default
        let preferred_gitlab = config.get_profile_preferred_account(&profile_id, &IntegrationType::GitLab);
        assert!(preferred_gitlab.is_none()); // No GitLab accounts exist
    }

    // =========================================================================
    // Config Tests
    // =========================================================================

    #[test]
    fn test_config_save_and_get_profile() {
        let mut config = UnifiedProfilesConfig::default();

        let profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );
        let profile_id = profile.id.clone();
        config.save_profile(profile);

        assert_eq!(config.profiles.len(), 1);
        assert!(config.get_profile(&profile_id).is_some());
    }

    #[test]
    fn test_config_default_profile() {
        let mut config = UnifiedProfilesConfig::default();

        let mut profile1 =
            UnifiedProfile::new("Work".to_string(), "J".to_string(), "j@w.com".to_string());
        profile1.is_default = true;
        config.save_profile(profile1.clone());

        let mut profile2 = UnifiedProfile::new(
            "Personal".to_string(),
            "J".to_string(),
            "j@p.com".to_string(),
        );
        profile2.is_default = true;
        config.save_profile(profile2.clone());

        // Only profile2 should be default
        let p1 = config.get_profile(&profile1.id).unwrap();
        let p2 = config.get_profile(&profile2.id).unwrap();

        assert!(!p1.is_default);
        assert!(p2.is_default);
    }

    #[test]
    fn test_repository_assignment() {
        let mut config = UnifiedProfilesConfig::default();

        let profile =
            UnifiedProfile::new("Work".to_string(), "J".to_string(), "j@w.com".to_string());
        let profile_id = profile.id.clone();
        config.save_profile(profile);

        config.assign_profile("/path/to/repo".to_string(), profile_id.clone());

        let assigned = config.get_assigned_profile("/path/to/repo");
        assert!(assigned.is_some());
        assert_eq!(assigned.unwrap().id, profile_id);

        config.unassign_profile("/path/to/repo");
        assert!(config.get_assigned_profile("/path/to/repo").is_none());
    }

    #[test]
    fn test_delete_profile_removes_assignments() {
        let mut config = UnifiedProfilesConfig::default();

        let profile =
            UnifiedProfile::new("Work".to_string(), "J".to_string(), "j@w.com".to_string());
        let profile_id = profile.id.clone();
        config.save_profile(profile);
        config.assign_profile("/path/to/repo".to_string(), profile_id.clone());

        config.delete_profile(&profile_id);

        assert!(config.get_profile(&profile_id).is_none());
        assert!(config.repository_assignments.is_empty());
    }

    #[test]
    fn test_url_matching_various_formats() {
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );
        profile.url_patterns = vec!["github.com/company/*".to_string()];

        // HTTPS format
        assert!(profile.matches_url("https://github.com/company/repo"));

        // Git SSH format
        assert!(profile.matches_url("git@github.com:company/repo"));

        // With .git suffix
        assert!(profile.matches_url("https://github.com/company/repo.git"));
        assert!(profile.matches_url("git@github.com:company/repo.git"));

        // Without protocol
        assert!(profile.matches_url("github.com/company/repo"));

        // Trailing slash
        assert!(profile.matches_url("https://github.com/company/repo/"));

        // Different case (should match case-insensitively)
        assert!(profile.matches_url("https://GitHub.com/Company/repo"));
    }

    #[test]
    fn test_url_matching_no_match() {
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );
        profile.url_patterns = vec!["github.com/company/*".to_string()];

        // Different org
        assert!(!profile.matches_url("https://github.com/personal/repo"));

        // Different domain
        assert!(!profile.matches_url("https://gitlab.com/company/repo"));
    }

    #[test]
    fn test_find_matching_profile() {
        let mut config = UnifiedProfilesConfig::default();

        let mut work_profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );
        work_profile.url_patterns = vec!["github.com/company/*".to_string()];
        let work_id = work_profile.id.clone();
        config.save_profile(work_profile);

        let mut personal_profile = UnifiedProfile::new(
            "Personal".to_string(),
            "John".to_string(),
            "john@gmail.com".to_string(),
        );
        personal_profile.url_patterns = vec!["github.com/personal/*".to_string()];
        config.save_profile(personal_profile);

        // Should detect work profile
        let detected = config.find_matching_profile("https://github.com/company/repo");
        assert!(detected.is_some());
        assert_eq!(detected.unwrap().id, work_id);

        // No match should return None
        let no_match = config.find_matching_profile("https://github.com/other/repo");
        assert!(no_match.is_none());
    }

    #[test]
    fn test_config_version() {
        let config = UnifiedProfilesConfig::default();
        assert_eq!(config.version, 3);
    }

    #[test]
    fn test_profile_colors() {
        let profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );

        // Default color should be set
        assert!(!profile.color.is_empty());
        // Should be a valid hex color
        assert!(profile.color.starts_with('#'));
    }

    // =========================================================================
    // Migration Tests (v2 -> v3)
    // =========================================================================

    #[allow(deprecated)]
    #[test]
    fn test_v2_to_v3_migration() {
        // Create a v2 config
        let mut v2_profile = UnifiedProfileV2 {
            id: "profile-1".to_string(),
            name: "Work".to_string(),
            git_name: "John".to_string(),
            git_email: "john@work.com".to_string(),
            signing_key: None,
            url_patterns: vec!["github.com/company/*".to_string()],
            is_default: true,
            color: "#3b82f6".to_string(),
            integration_accounts: vec![
                ProfileIntegrationAccount {
                    id: "account-1".to_string(),
                    name: "Work GitHub".to_string(),
                    integration_type: IntegrationType::GitHub,
                    config: IntegrationConfig::GitHub,
                    color: None,
                    cached_user: None,
                    is_default_for_type: true,
                },
                ProfileIntegrationAccount {
                    id: "account-2".to_string(),
                    name: "Work GitLab".to_string(),
                    integration_type: IntegrationType::GitLab,
                    config: IntegrationConfig::GitLab {
                        instance_url: "https://gitlab.com".to_string(),
                    },
                    color: None,
                    cached_user: None,
                    is_default_for_type: false,
                },
            ],
        };

        let v2_config = UnifiedProfilesConfigV2 {
            version: 2,
            profiles: vec![v2_profile],
            repository_assignments: HashMap::from([
                ("/path/to/repo".to_string(), "profile-1".to_string()),
            ]),
        };

        // Migrate to v3
        let v3_config = v2_config.to_v3();

        // Check version
        assert_eq!(v3_config.version, 3);

        // Check profiles
        assert_eq!(v3_config.profiles.len(), 1);
        let profile = &v3_config.profiles[0];
        assert_eq!(profile.id, "profile-1");
        assert_eq!(profile.name, "Work");
        assert!(profile.is_default);

        // Check profile's default accounts map
        assert_eq!(
            profile.get_default_account_id(&IntegrationType::GitHub),
            Some(&"account-1".to_string())
        );
        assert_eq!(
            profile.get_default_account_id(&IntegrationType::GitLab),
            Some(&"account-2".to_string())
        );

        // Check global accounts
        assert_eq!(v3_config.accounts.len(), 2);
        let github_account = v3_config.get_account("account-1").unwrap();
        assert_eq!(github_account.name, "Work GitHub");
        assert!(github_account.is_default); // was is_default_for_type in v2

        // Check repository assignments preserved
        assert_eq!(v3_config.repository_assignments.len(), 1);
        assert_eq!(
            v3_config.repository_assignments.get("/path/to/repo"),
            Some(&"profile-1".to_string())
        );
    }
}
