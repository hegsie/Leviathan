//! JIRA Integration Commands
//!
//! Provides integration with Atlassian JIRA for issue tracking, transitions,
//! and branch creation from issues.

use crate::error::{LeviathanError, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::command;
use tracing::{debug, error, info};

// ============================================================================
// Types
// ============================================================================

/// JIRA connection configuration
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
    pub project_key: Option<String>,
}

/// JIRA issue summary
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub issue_type: String,
    pub assignee: Option<String>,
    pub priority: Option<String>,
    pub url: String,
}

/// JIRA status transition
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JiraTransition {
    pub id: String,
    pub name: String,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Build Basic auth header from email and API token
fn get_jira_auth_header(email: &str, api_token: &str) -> String {
    let credentials = format!("{}:{}", email, api_token);
    format!("Basic {}", BASE64.encode(credentials.as_bytes()))
}

/// Build a JIRA REST API URL
fn build_jira_api_url(base_url: &str, path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    format!("{}/rest/api/3/{}", base, path)
}

/// Load JIRA config from the repository's .git/leviathan/jira.json
fn load_jira_config(repo_path: &str) -> Result<JiraConfig> {
    let config_path = Path::new(repo_path)
        .join(".git")
        .join("leviathan")
        .join("jira.json");

    if !config_path.exists() {
        return Err(LeviathanError::OperationFailed(
            "JIRA not configured. Save a JIRA configuration first.".to_string(),
        ));
    }

    let content = std::fs::read_to_string(&config_path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to read JIRA config: {}", e))
    })?;

    serde_json::from_str(&content)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse JIRA config: {}", e)))
}

/// Generate a branch-safe name from an issue key and summary
fn generate_branch_name(issue_key: &str, summary: &str, branch_type: Option<&str>) -> String {
    let prefix = branch_type.unwrap_or("feature");

    // Sanitize the summary for use in a branch name
    let sanitized: String = summary
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else if c == ' ' || c == '-' || c == '_' {
                '-'
            } else {
                // Skip other characters
                '\0'
            }
        })
        .filter(|c| *c != '\0')
        .collect();

    // Remove consecutive dashes and trim
    let mut result = String::new();
    let mut last_was_dash = false;
    for c in sanitized.chars() {
        if c == '-' {
            if !last_was_dash {
                result.push(c);
            }
            last_was_dash = true;
        } else {
            result.push(c);
            last_was_dash = false;
        }
    }
    let result = result.trim_matches('-');

    // Truncate to reasonable length
    let max_summary_len = 50;
    let truncated = if result.len() > max_summary_len {
        // Try to cut at a dash boundary
        match result[..max_summary_len].rfind('-') {
            Some(pos) if pos > 10 => &result[..pos],
            _ => &result[..max_summary_len],
        }
    } else {
        result
    };

    format!("{}/{}-{}", prefix, issue_key, truncated)
}

// ============================================================================
// Commands
// ============================================================================

/// Get JIRA configuration for a repository
#[command]
pub async fn get_jira_config(path: String) -> Result<Option<JiraConfig>> {
    debug!("Getting JIRA config for: {}", path);

    match load_jira_config(&path) {
        Ok(config) => Ok(Some(config)),
        Err(_) => Ok(None),
    }
}

/// Save JIRA configuration for a repository
#[command]
pub async fn save_jira_config(path: String, config: JiraConfig) -> Result<()> {
    debug!("Saving JIRA config for: {}", path);

    let leviathan_dir = Path::new(&path).join(".git").join("leviathan");

    // Create the leviathan directory if it doesn't exist
    if !leviathan_dir.exists() {
        std::fs::create_dir_all(&leviathan_dir).map_err(|e| {
            LeviathanError::OperationFailed(format!(
                "Failed to create leviathan config directory: {}",
                e
            ))
        })?;
    }

    let config_path = leviathan_dir.join("jira.json");
    let content = serde_json::to_string_pretty(&config).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to serialize JIRA config: {}", e))
    })?;

    std::fs::write(&config_path, content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to write JIRA config: {}", e))
    })?;

    info!("JIRA config saved to {:?}", config_path);
    Ok(())
}

/// Fetch JIRA issues via JQL search
#[command]
pub async fn get_jira_issues(
    path: String,
    jql: Option<String>,
    max_results: Option<u32>,
) -> Result<Vec<JiraIssue>> {
    debug!("Fetching JIRA issues for: {}", path);

    let config = load_jira_config(&path)?;
    let max_results = max_results.unwrap_or(50);

    // Build default JQL if none provided
    let jql = jql.unwrap_or_else(|| {
        if let Some(ref project_key) = config.project_key {
            format!(
                "project = {} AND statusCategory != Done ORDER BY updated DESC",
                project_key
            )
        } else {
            "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC".to_string()
        }
    });

    let url = build_jira_api_url(&config.base_url, "search");

    #[derive(Serialize)]
    struct SearchRequest {
        jql: String,
        #[serde(rename = "maxResults")]
        max_results: u32,
        fields: Vec<String>,
    }

    let body = SearchRequest {
        jql,
        max_results,
        fields: vec![
            "summary".to_string(),
            "status".to_string(),
            "issuetype".to_string(),
            "assignee".to_string(),
            "priority".to_string(),
        ],
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header(
            "Authorization",
            get_jira_auth_header(&config.email, &config.api_token),
        )
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!("JIRA API request failed: {}", e);
            LeviathanError::OperationFailed(format!("Failed to fetch JIRA issues: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "JIRA API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct SearchResponse {
        issues: Vec<ApiIssue>,
    }

    #[derive(Deserialize)]
    struct ApiIssue {
        key: String,
        fields: ApiFields,
    }

    #[derive(Deserialize)]
    struct ApiFields {
        summary: String,
        status: ApiStatus,
        issuetype: ApiIssueType,
        assignee: Option<ApiAssignee>,
        priority: Option<ApiPriority>,
    }

    #[derive(Deserialize)]
    struct ApiStatus {
        name: String,
    }

    #[derive(Deserialize)]
    struct ApiIssueType {
        name: String,
    }

    #[derive(Deserialize)]
    struct ApiAssignee {
        #[serde(rename = "displayName")]
        display_name: String,
    }

    #[derive(Deserialize)]
    struct ApiPriority {
        name: String,
    }

    let data: SearchResponse = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse JIRA response: {}", e))
    })?;

    let base_url = config.base_url.trim_end_matches('/');

    Ok(data
        .issues
        .into_iter()
        .map(|issue| JiraIssue {
            url: format!("{}/browse/{}", base_url, issue.key),
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status.name,
            issue_type: issue.fields.issuetype.name,
            assignee: issue.fields.assignee.map(|a| a.display_name),
            priority: issue.fields.priority.map(|p| p.name),
        })
        .collect())
}

/// Fetch a single JIRA issue by key
#[command]
pub async fn get_jira_issue(path: String, issue_key: String) -> Result<JiraIssue> {
    debug!("Fetching JIRA issue: {}", issue_key);

    let config = load_jira_config(&path)?;
    let url = build_jira_api_url(
        &config.base_url,
        &format!(
            "issue/{}?fields=summary,status,issuetype,assignee,priority",
            issue_key
        ),
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header(
            "Authorization",
            get_jira_auth_header(&config.email, &config.api_token),
        )
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            error!("JIRA API request failed: {}", e);
            LeviathanError::OperationFailed(format!("Failed to fetch JIRA issue: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "JIRA API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiIssue {
        key: String,
        fields: ApiFields,
    }

    #[derive(Deserialize)]
    struct ApiFields {
        summary: String,
        status: ApiStatus,
        issuetype: ApiIssueType,
        assignee: Option<ApiAssignee>,
        priority: Option<ApiPriority>,
    }

    #[derive(Deserialize)]
    struct ApiStatus {
        name: String,
    }

    #[derive(Deserialize)]
    struct ApiIssueType {
        name: String,
    }

    #[derive(Deserialize)]
    struct ApiAssignee {
        #[serde(rename = "displayName")]
        display_name: String,
    }

    #[derive(Deserialize)]
    struct ApiPriority {
        name: String,
    }

    let issue: ApiIssue = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse JIRA issue: {}", e))
    })?;

    let base_url = config.base_url.trim_end_matches('/');

    Ok(JiraIssue {
        url: format!("{}/browse/{}", base_url, issue.key),
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        issue_type: issue.fields.issuetype.name,
        assignee: issue.fields.assignee.map(|a| a.display_name),
        priority: issue.fields.priority.map(|p| p.name),
    })
}

/// Get available transitions for a JIRA issue
#[command]
pub async fn get_jira_transitions(path: String, issue_key: String) -> Result<Vec<JiraTransition>> {
    debug!("Fetching transitions for JIRA issue: {}", issue_key);

    let config = load_jira_config(&path)?;
    let url = build_jira_api_url(
        &config.base_url,
        &format!("issue/{}/transitions", issue_key),
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header(
            "Authorization",
            get_jira_auth_header(&config.email, &config.api_token),
        )
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            error!("JIRA API request failed: {}", e);
            LeviathanError::OperationFailed(format!("Failed to fetch JIRA transitions: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "JIRA API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct TransitionsResponse {
        transitions: Vec<ApiTransition>,
    }

    #[derive(Deserialize)]
    struct ApiTransition {
        id: String,
        name: String,
    }

    let data: TransitionsResponse = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse JIRA transitions: {}", e))
    })?;

    Ok(data
        .transitions
        .into_iter()
        .map(|t| JiraTransition {
            id: t.id,
            name: t.name,
        })
        .collect())
}

/// Transition a JIRA issue to a new status
#[command]
pub async fn transition_jira_issue(
    path: String,
    issue_key: String,
    transition_id: String,
) -> Result<()> {
    debug!(
        "Transitioning JIRA issue {} with transition {}",
        issue_key, transition_id
    );

    let config = load_jira_config(&path)?;
    let url = build_jira_api_url(
        &config.base_url,
        &format!("issue/{}/transitions", issue_key),
    );

    #[derive(Serialize)]
    struct TransitionRequest {
        transition: TransitionId,
    }

    #[derive(Serialize)]
    struct TransitionId {
        id: String,
    }

    let body = TransitionRequest {
        transition: TransitionId {
            id: transition_id.clone(),
        },
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header(
            "Authorization",
            get_jira_auth_header(&config.email, &config.api_token),
        )
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            error!("JIRA API request failed: {}", e);
            LeviathanError::OperationFailed(format!("Failed to transition JIRA issue: {}", e))
        })?;

    // JIRA returns 204 No Content on successful transition
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "JIRA API error {}: {}",
            status, body
        )));
    }

    info!(
        "Successfully transitioned JIRA issue {} with transition {}",
        issue_key, transition_id
    );
    Ok(())
}

/// Create a git branch named after a JIRA issue
#[command]
pub async fn create_branch_from_jira(
    path: String,
    issue_key: String,
    branch_type: Option<String>,
) -> Result<String> {
    debug!("Creating branch from JIRA issue {} in {}", issue_key, path);

    // First, fetch the issue to get its summary
    let config = load_jira_config(&path)?;
    let url = build_jira_api_url(
        &config.base_url,
        &format!("issue/{}?fields=summary", issue_key),
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header(
            "Authorization",
            get_jira_auth_header(&config.email, &config.api_token),
        )
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch JIRA issue: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "JIRA API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiIssue {
        key: String,
        fields: ApiFields,
    }

    #[derive(Deserialize)]
    struct ApiFields {
        summary: String,
    }

    let issue: ApiIssue = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse JIRA issue: {}", e))
    })?;

    let branch_name =
        generate_branch_name(&issue.key, &issue.fields.summary, branch_type.as_deref());

    // Create the branch using git2
    let repo = git2::Repository::open(&path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to open repository: {}", e))
    })?;

    let head = repo
        .head()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to get HEAD: {}", e)))?;

    let commit = head.peel_to_commit().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to get HEAD commit: {}", e))
    })?;

    repo.branch(&branch_name, &commit, false).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to create branch '{}': {}", branch_name, e))
    })?;

    info!(
        "Created branch '{}' from JIRA issue {}",
        branch_name, issue_key
    );

    Ok(branch_name)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_jira_auth_header() {
        let header = get_jira_auth_header("user@example.com", "my-api-token");

        assert!(header.starts_with("Basic "));
        let encoded = header.trim_start_matches("Basic ");
        let decoded = String::from_utf8(base64::Engine::decode(&BASE64, encoded).unwrap()).unwrap();
        assert_eq!(decoded, "user@example.com:my-api-token");
    }

    #[test]
    fn test_build_jira_api_url() {
        let url = build_jira_api_url("https://mycompany.atlassian.net", "search");
        assert_eq!(url, "https://mycompany.atlassian.net/rest/api/3/search");
    }

    #[test]
    fn test_build_jira_api_url_trailing_slash() {
        let url = build_jira_api_url("https://mycompany.atlassian.net/", "issue/PROJ-123");
        assert_eq!(
            url,
            "https://mycompany.atlassian.net/rest/api/3/issue/PROJ-123"
        );
    }

    #[test]
    fn test_generate_branch_name_basic() {
        let name = generate_branch_name("PROJ-123", "Add user authentication", None);
        assert_eq!(name, "feature/PROJ-123-add-user-authentication");
    }

    #[test]
    fn test_generate_branch_name_with_type() {
        let name = generate_branch_name("BUG-456", "Fix login crash", Some("bugfix"));
        assert_eq!(name, "bugfix/BUG-456-fix-login-crash");
    }

    #[test]
    fn test_generate_branch_name_special_characters() {
        let name = generate_branch_name(
            "PROJ-789",
            "Handle special chars: @#$%^&*() in input!",
            None,
        );
        assert_eq!(name, "feature/PROJ-789-handle-special-chars-in-input");
    }

    #[test]
    fn test_generate_branch_name_long_summary() {
        let name = generate_branch_name(
            "PROJ-100",
            "This is a very long summary that should be truncated because it exceeds the maximum allowed length for a branch name",
            None,
        );
        assert!(name.starts_with("feature/PROJ-100-"));
        // Total length should be reasonable (prefix + key + truncated summary)
        assert!(name.len() < 80);
    }

    #[test]
    fn test_generate_branch_name_consecutive_dashes() {
        let name = generate_branch_name("PROJ-200", "Fix -- multiple   spaces---and dashes", None);
        assert_eq!(name, "feature/PROJ-200-fix-multiple-spaces-and-dashes");
    }

    #[test]
    fn test_jira_config_serialization() {
        let config = JiraConfig {
            base_url: "https://mycompany.atlassian.net".to_string(),
            email: "user@example.com".to_string(),
            api_token: "secret-token".to_string(),
            project_key: Some("PROJ".to_string()),
        };

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("baseUrl"));
        assert!(json.contains("mycompany.atlassian.net"));
        assert!(json.contains("apiToken"));
        assert!(json.contains("projectKey"));
    }

    #[test]
    fn test_jira_config_deserialization() {
        let json = r#"{
            "baseUrl": "https://mycompany.atlassian.net",
            "email": "user@example.com",
            "apiToken": "secret-token",
            "projectKey": "PROJ"
        }"#;

        let config: JiraConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.base_url, "https://mycompany.atlassian.net");
        assert_eq!(config.email, "user@example.com");
        assert_eq!(config.api_token, "secret-token");
        assert_eq!(config.project_key, Some("PROJ".to_string()));
    }

    #[test]
    fn test_jira_config_deserialization_no_project() {
        let json = r#"{
            "baseUrl": "https://mycompany.atlassian.net",
            "email": "user@example.com",
            "apiToken": "secret-token"
        }"#;

        let config: JiraConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.project_key, None);
    }

    #[test]
    fn test_jira_config_roundtrip() {
        let config = JiraConfig {
            base_url: "https://mycompany.atlassian.net".to_string(),
            email: "user@example.com".to_string(),
            api_token: "secret-token".to_string(),
            project_key: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: JiraConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(config.base_url, deserialized.base_url);
        assert_eq!(config.email, deserialized.email);
        assert_eq!(config.api_token, deserialized.api_token);
        assert_eq!(config.project_key, deserialized.project_key);
    }

    #[test]
    fn test_jira_issue_serialization() {
        let issue = JiraIssue {
            key: "PROJ-123".to_string(),
            summary: "Add authentication".to_string(),
            status: "In Progress".to_string(),
            issue_type: "Story".to_string(),
            assignee: Some("John Doe".to_string()),
            priority: Some("High".to_string()),
            url: "https://mycompany.atlassian.net/browse/PROJ-123".to_string(),
        };

        let json = serde_json::to_string(&issue).unwrap();
        assert!(json.contains("issueType"));
        assert!(json.contains("PROJ-123"));
        assert!(json.contains("In Progress"));
    }

    #[test]
    fn test_jira_issue_no_assignee() {
        let issue = JiraIssue {
            key: "PROJ-456".to_string(),
            summary: "Unassigned task".to_string(),
            status: "To Do".to_string(),
            issue_type: "Task".to_string(),
            assignee: None,
            priority: None,
            url: "https://mycompany.atlassian.net/browse/PROJ-456".to_string(),
        };

        let json = serde_json::to_string(&issue).unwrap();
        assert!(json.contains("\"assignee\":null"));
        assert!(json.contains("\"priority\":null"));
    }

    #[test]
    fn test_jira_transition_serialization() {
        let transition = JiraTransition {
            id: "31".to_string(),
            name: "In Progress".to_string(),
        };

        let json = serde_json::to_string(&transition).unwrap();
        assert!(json.contains("\"id\":\"31\""));
        assert!(json.contains("\"name\":\"In Progress\""));
    }

    #[test]
    fn test_load_jira_config_missing_file() {
        let result = load_jira_config("/nonexistent/path");
        assert!(result.is_err());
    }

    #[test]
    fn test_save_and_load_config() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        // Create .git directory structure
        std::fs::create_dir_all(repo_path.join(".git").join("leviathan")).unwrap();

        let config = JiraConfig {
            base_url: "https://test.atlassian.net".to_string(),
            email: "test@example.com".to_string(),
            api_token: "test-token".to_string(),
            project_key: Some("TEST".to_string()),
        };

        // Save
        let config_path = repo_path.join(".git").join("leviathan").join("jira.json");
        let content = serde_json::to_string_pretty(&config).unwrap();
        std::fs::write(&config_path, content).unwrap();

        // Load
        let loaded = load_jira_config(repo_path.to_str().unwrap()).unwrap();
        assert_eq!(loaded.base_url, "https://test.atlassian.net");
        assert_eq!(loaded.email, "test@example.com");
        assert_eq!(loaded.api_token, "test-token");
        assert_eq!(loaded.project_key, Some("TEST".to_string()));
    }
}
