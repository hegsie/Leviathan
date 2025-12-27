//! Workflow models for Git identity profiles and workflow support

use serde::{Deserialize, Serialize};

/// Git identity profile for switching between different identities
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProfile {
    /// Unique identifier for the profile
    pub id: String,
    /// Display name (e.g., "Work", "Personal")
    pub name: String,
    /// Git user.name value
    pub git_name: String,
    /// Git user.email value
    pub git_email: String,
    /// Optional GPG signing key ID
    pub signing_key: Option<String>,
    /// URL patterns for auto-detection (e.g., "github.com/mycompany/*")
    pub url_patterns: Vec<String>,
    /// Whether this is the default profile
    pub is_default: bool,
    /// Optional color for UI display
    pub color: Option<String>,
}

impl GitProfile {
    /// Create a new profile with the given details
    pub fn new(name: String, git_name: String, git_email: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            git_name,
            git_email,
            signing_key: None,
            url_patterns: Vec::new(),
            is_default: false,
            color: None,
        }
    }

    /// Check if this profile matches a remote URL
    pub fn matches_url(&self, url: &str) -> bool {
        self.url_patterns
            .iter()
            .any(|pattern| url_matches_pattern(url, pattern))
    }
}

/// Check if a URL matches a glob-like pattern
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

/// Configuration for storing profiles
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesConfig {
    /// All saved profiles
    pub profiles: Vec<GitProfile>,
    /// Repository to profile assignments (repo path -> profile id)
    pub repository_assignments: std::collections::HashMap<String, String>,
}

/// Git Flow configuration for a repository
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFlowConfig {
    /// Whether Git Flow is initialized
    pub initialized: bool,
    /// Main branch name (e.g., "main" or "master")
    pub main_branch: String,
    /// Development branch name (e.g., "develop")
    pub develop_branch: String,
    /// Feature branch prefix (e.g., "feature/")
    pub feature_prefix: String,
    /// Release branch prefix (e.g., "release/")
    pub release_prefix: String,
    /// Hotfix branch prefix (e.g., "hotfix/")
    pub hotfix_prefix: String,
    /// Version tag prefix (e.g., "v")
    pub version_tag_prefix: String,
}

impl Default for GitFlowConfig {
    fn default() -> Self {
        Self {
            initialized: false,
            main_branch: "main".to_string(),
            develop_branch: "develop".to_string(),
            feature_prefix: "feature/".to_string(),
            release_prefix: "release/".to_string(),
            hotfix_prefix: "hotfix/".to_string(),
            version_tag_prefix: "v".to_string(),
        }
    }
}

/// Git Flow branch type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum GitFlowBranchType {
    Main,
    Develop,
    Feature,
    Release,
    Hotfix,
    Other,
}

/// A step in a Git Flow operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFlowOperationStep {
    /// Description of the step
    pub description: String,
    /// Git command that will be executed
    pub command: String,
    /// Whether this step is optional
    pub optional: bool,
}

/// Preview of a Git Flow operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFlowOperationPlan {
    /// Operation type (e.g., "start_feature", "finish_release")
    pub operation: String,
    /// Branch name involved
    pub branch_name: String,
    /// Steps that will be executed
    pub steps: Vec<GitFlowOperationStep>,
    /// Warnings about the operation
    pub warnings: Vec<String>,
}

/// Branch age information for trunk-based development
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchAgeInfo {
    /// Branch name
    pub branch_name: String,
    /// Age in hours since creation/last commit
    pub age_hours: f64,
    /// Status based on age ("ok", "warning", "critical")
    pub status: BranchAgeStatus,
}

/// Status of branch age
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum BranchAgeStatus {
    Ok,
    Warning,
    Critical,
}

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
        assert!(url_matches_pattern(
            "https://github.com/mycompany/another-repo",
            "github.com/mycompany/*"
        ));
    }

    #[test]
    fn test_url_matches_pattern_no_match() {
        assert!(!url_matches_pattern(
            "https://github.com/othercompany/repo",
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
    fn test_profile_matches_url() {
        let profile = GitProfile {
            id: "test".to_string(),
            name: "Work".to_string(),
            git_name: "John Doe".to_string(),
            git_email: "john@work.com".to_string(),
            signing_key: None,
            url_patterns: vec!["github.com/mycompany/*".to_string()],
            is_default: false,
            color: None,
        };

        assert!(profile.matches_url("https://github.com/mycompany/repo"));
        assert!(!profile.matches_url("https://github.com/personal/repo"));
    }

    #[test]
    fn test_gitflow_config_default() {
        let config = GitFlowConfig::default();
        assert_eq!(config.main_branch, "main");
        assert_eq!(config.develop_branch, "develop");
        assert_eq!(config.feature_prefix, "feature/");
    }
}
