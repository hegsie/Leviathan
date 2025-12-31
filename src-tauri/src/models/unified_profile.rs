//! Unified profile models - combines git identity with integration accounts
//!
//! A unified profile is the top-level entity containing:
//! - Git identity (name, email, signing key)
//! - Multiple integration accounts (GitHub, GitLab, Azure DevOps)
//! - URL patterns for auto-detection
//! - Repository assignments
//!
//! This replaces the separate GitProfile and IntegrationAccount systems.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Re-use the integration types from the existing module
pub use super::integration_accounts::{CachedUser, IntegrationConfig, IntegrationType};

/// Current version of the unified profiles config format
pub const UNIFIED_PROFILES_CONFIG_VERSION: u32 = 2;

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

/// Integration account linked to a unified profile
///
/// Unlike standalone IntegrationAccount, this doesn't have its own URL patterns -
/// it inherits the profile's patterns for auto-detection.
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

    /// Update cached user info
    pub fn update_cached_user(&mut self, user: CachedUser) {
        self.cached_user = Some(user);
    }

    /// Clear cached user info
    pub fn clear_cached_user(&mut self) {
        self.cached_user = None;
    }
}

/// Unified profile containing git identity and integration accounts
///
/// A profile represents a complete "context" (e.g., "Work", "Personal") that includes
/// both the git identity and all associated platform accounts.
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

    // Linked Integration Accounts
    /// Integration accounts associated with this profile
    pub integration_accounts: Vec<ProfileIntegrationAccount>,
}

impl UnifiedProfile {
    /// Create a new unified profile
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
            integration_accounts: Vec::new(),
        }
    }

    /// Check if this profile matches a remote URL
    pub fn matches_url(&self, url: &str) -> bool {
        self.url_patterns
            .iter()
            .any(|pattern| url_matches_pattern(url, pattern))
    }

    /// Get accounts of a specific integration type
    pub fn get_accounts_by_type(
        &self,
        integration_type: &IntegrationType,
    ) -> Vec<&ProfileIntegrationAccount> {
        self.integration_accounts
            .iter()
            .filter(|a| &a.integration_type == integration_type)
            .collect()
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
                // Fall back to first account of this type
                self.integration_accounts
                    .iter()
                    .find(|a| &a.integration_type == integration_type)
            })
    }

    /// Get an account by ID
    pub fn get_account(&self, account_id: &str) -> Option<&ProfileIntegrationAccount> {
        self.integration_accounts.iter().find(|a| a.id == account_id)
    }

    /// Get a mutable account by ID
    pub fn get_account_mut(&mut self, account_id: &str) -> Option<&mut ProfileIntegrationAccount> {
        self.integration_accounts
            .iter_mut()
            .find(|a| a.id == account_id)
    }

    /// Add or update an account within this profile
    pub fn save_account(&mut self, account: ProfileIntegrationAccount) {
        // If this account is being set as default, unset other defaults of same type
        if account.is_default_for_type {
            for existing in &mut self.integration_accounts {
                if existing.integration_type == account.integration_type
                    && existing.id != account.id
                {
                    existing.is_default_for_type = false;
                }
            }
        }

        // Update existing or add new
        if let Some(existing) = self
            .integration_accounts
            .iter_mut()
            .find(|a| a.id == account.id)
        {
            *existing = account;
        } else {
            self.integration_accounts.push(account);
        }
    }

    /// Delete an account from this profile
    pub fn delete_account(&mut self, account_id: &str) {
        self.integration_accounts.retain(|a| a.id != account_id);
    }

    /// Get count of accounts by type
    pub fn account_count_by_type(&self) -> HashMap<IntegrationType, usize> {
        let mut counts = HashMap::new();
        for account in &self.integration_accounts {
            *counts.entry(account.integration_type.clone()).or_insert(0) += 1;
        }
        counts
    }

    /// Get total account count
    pub fn account_count(&self) -> usize {
        self.integration_accounts.len()
    }
}

/// Configuration for storing unified profiles
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedProfilesConfig {
    /// Version number for migration support
    pub version: u32,
    /// All saved profiles
    pub profiles: Vec<UnifiedProfile>,
    /// Repository to profile assignments (repo path -> profile id)
    pub repository_assignments: HashMap<String, String>,
}

impl Default for UnifiedProfilesConfig {
    fn default() -> Self {
        Self {
            version: UNIFIED_PROFILES_CONFIG_VERSION,
            profiles: Vec::new(),
            repository_assignments: HashMap::new(),
        }
    }
}

impl UnifiedProfilesConfig {
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

    /// Find an account across all profiles by ID
    pub fn find_account(&self, account_id: &str) -> Option<(&UnifiedProfile, &ProfileIntegrationAccount)> {
        for profile in &self.profiles {
            if let Some(account) = profile.get_account(account_id) {
                return Some((profile, account));
            }
        }
        None
    }

    /// Get the profile containing a specific account
    pub fn get_profile_for_account(&self, account_id: &str) -> Option<&UnifiedProfile> {
        self.profiles
            .iter()
            .find(|p| p.integration_accounts.iter().any(|a| a.id == account_id))
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
        assert!(profile.integration_accounts.is_empty());
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
    fn test_add_account_to_profile() {
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );

        let mut account = ProfileIntegrationAccount::new_github("Work GitHub".to_string());
        account.is_default_for_type = true;
        profile.save_account(account.clone());

        assert_eq!(profile.integration_accounts.len(), 1);
        assert!(profile.get_account(&account.id).is_some());
    }

    #[test]
    fn test_default_account_per_type() {
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );

        let mut account1 = ProfileIntegrationAccount::new_github("GitHub 1".to_string());
        account1.is_default_for_type = true;
        profile.save_account(account1.clone());

        let mut account2 = ProfileIntegrationAccount::new_github("GitHub 2".to_string());
        account2.is_default_for_type = true;
        profile.save_account(account2.clone());

        // Only account2 should be default now
        let acc1 = profile.get_account(&account1.id).unwrap();
        let acc2 = profile.get_account(&account2.id).unwrap();

        assert!(!acc1.is_default_for_type);
        assert!(acc2.is_default_for_type);

        // get_default_account should return account2
        let default = profile.get_default_account(&IntegrationType::GitHub).unwrap();
        assert_eq!(default.id, account2.id);
    }

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

        let mut profile1 = UnifiedProfile::new("Work".to_string(), "J".to_string(), "j@w.com".to_string());
        profile1.is_default = true;
        config.save_profile(profile1.clone());

        let mut profile2 = UnifiedProfile::new("Personal".to_string(), "J".to_string(), "j@p.com".to_string());
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

        let profile = UnifiedProfile::new("Work".to_string(), "J".to_string(), "j@w.com".to_string());
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

        let profile = UnifiedProfile::new("Work".to_string(), "J".to_string(), "j@w.com".to_string());
        let profile_id = profile.id.clone();
        config.save_profile(profile);
        config.assign_profile("/path/to/repo".to_string(), profile_id.clone());

        config.delete_profile(&profile_id);

        assert!(config.get_profile(&profile_id).is_none());
        assert!(config.repository_assignments.is_empty());
    }

    #[test]
    fn test_delete_account_from_profile() {
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );

        let account1 = ProfileIntegrationAccount::new_github("GitHub 1".to_string());
        let account2 = ProfileIntegrationAccount::new_gitlab("GitLab 1".to_string(), "https://gitlab.com".to_string());
        let account1_id = account1.id.clone();

        profile.save_account(account1);
        profile.save_account(account2);

        assert_eq!(profile.integration_accounts.len(), 2);

        profile.delete_account(&account1_id);

        assert_eq!(profile.integration_accounts.len(), 1);
        assert!(profile.get_account(&account1_id).is_none());
    }

    #[test]
    fn test_get_accounts_by_type() {
        let mut profile = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );

        profile.save_account(ProfileIntegrationAccount::new_github("GitHub 1".to_string()));
        profile.save_account(ProfileIntegrationAccount::new_github("GitHub 2".to_string()));
        profile.save_account(ProfileIntegrationAccount::new_gitlab("GitLab 1".to_string(), "https://gitlab.com".to_string()));

        let github_accounts = profile.get_accounts_by_type(&IntegrationType::GitHub);
        let gitlab_accounts = profile.get_accounts_by_type(&IntegrationType::GitLab);
        let azure_accounts = profile.get_accounts_by_type(&IntegrationType::AzureDevOps);

        assert_eq!(github_accounts.len(), 2);
        assert_eq!(gitlab_accounts.len(), 1);
        assert_eq!(azure_accounts.len(), 0);
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
    fn test_profile_integration_account_creation() {
        let github = ProfileIntegrationAccount::new_github("My GitHub".to_string());
        assert_eq!(github.integration_type, IntegrationType::GitHub);
        assert!(!github.is_default_for_type);
        assert!(matches!(github.config, IntegrationConfig::GitHub));

        let gitlab = ProfileIntegrationAccount::new_gitlab(
            "My GitLab".to_string(),
            "https://gitlab.company.com".to_string(),
        );
        assert_eq!(gitlab.integration_type, IntegrationType::GitLab);
        if let IntegrationConfig::GitLab { instance_url } = &gitlab.config {
            assert_eq!(instance_url, "https://gitlab.company.com");
        } else {
            panic!("Expected GitLab config");
        }

        let azure = ProfileIntegrationAccount::new_azure_devops(
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
    fn test_find_account_across_profiles() {
        let mut config = UnifiedProfilesConfig::default();

        let mut profile1 = UnifiedProfile::new(
            "Work".to_string(),
            "John".to_string(),
            "john@work.com".to_string(),
        );
        let account = ProfileIntegrationAccount::new_github("Work GitHub".to_string());
        let account_id = account.id.clone();
        profile1.save_account(account);
        let profile1_id = profile1.id.clone();
        config.save_profile(profile1);

        let profile2 = UnifiedProfile::new(
            "Personal".to_string(),
            "John".to_string(),
            "john@gmail.com".to_string(),
        );
        config.save_profile(profile2);

        // Should find the account in profile1
        let profile = config.get_profile(&profile1_id).unwrap();
        let found_account = profile.get_account(&account_id);
        assert!(found_account.is_some());
        assert_eq!(found_account.unwrap().id, account_id);
    }

    #[test]
    fn test_config_version() {
        let config = UnifiedProfilesConfig::default();
        assert_eq!(config.version, 2);
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
}
