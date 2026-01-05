//! Bitbucket Integration Commands
//!
//! Provides integration with Bitbucket Cloud for pull requests, issues, and pipelines.
//! Credential storage is handled by the frontend using Stronghold.
//! All API functions accept optional credentials from the frontend.

use crate::error::{LeviathanError, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use tauri::command;

const BITBUCKET_API_BASE: &str = "https://api.bitbucket.org/2.0";

// ============================================================================
// Credential Management (handled by frontend Stronghold - these are stubs)
// ============================================================================

/// Store Bitbucket credentials - handled by frontend Stronghold
#[command]
pub async fn store_bitbucket_credentials(_username: String, _app_password: String) -> Result<()> {
    // Credential storage is now handled by frontend Stronghold
    Ok(())
}

/// Get Bitbucket credentials - handled by frontend Stronghold
#[command]
pub async fn get_bitbucket_credentials() -> Result<Option<(String, String)>> {
    // Credential storage is now handled by frontend Stronghold
    // Return None - credentials should be passed from frontend
    Ok(None)
}

/// Delete Bitbucket credentials - handled by frontend Stronghold
#[command]
pub async fn delete_bitbucket_credentials() -> Result<()> {
    // Credential storage is now handled by frontend Stronghold
    Ok(())
}

// ============================================================================
// Types
// ============================================================================

/// Bitbucket user info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketUser {
    pub uuid: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

/// Bitbucket connection status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketConnectionStatus {
    pub connected: bool,
    pub user: Option<BitbucketUser>,
}

/// Detected Bitbucket repository info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBitbucketRepo {
    pub workspace: String,
    pub repo_slug: String,
    pub remote_name: String,
}

/// Pull request summary
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketPullRequest {
    pub id: u64,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub author: BitbucketUser,
    pub created_on: String,
    pub source_branch: String,
    pub destination_branch: String,
    pub url: String,
}

/// Create pull request input
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBitbucketPullRequestInput {
    pub title: String,
    pub description: Option<String>,
    pub source_branch: String,
    pub destination_branch: String,
    pub close_source_branch: Option<bool>,
}

/// Issue summary
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketIssue {
    pub id: u64,
    pub title: String,
    pub content: Option<String>,
    pub state: String,
    pub priority: String,
    pub kind: String,
    pub reporter: Option<BitbucketUser>,
    pub assignee: Option<BitbucketUser>,
    pub created_on: String,
    pub url: String,
}

/// Pipeline summary
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketPipeline {
    pub uuid: String,
    pub build_number: u64,
    pub state_name: String,
    pub result_name: Option<String>,
    pub target_branch: String,
    pub created_on: String,
    pub completed_on: Option<String>,
    pub url: String,
}

// ============================================================================
// Helper Functions
// ============================================================================

fn get_auth_header(username: &str, password: &str) -> String {
    let credentials = format!("{}:{}", username, password);
    format!("Basic {}", BASE64.encode(credentials.as_bytes()))
}

/// Get auth header - prefer OAuth token if provided, otherwise use username/password
fn get_auth_header_with_token(
    token: Option<&str>,
    username: Option<&str>,
    app_password: Option<&str>,
) -> Result<String> {
    // Prefer OAuth token if provided
    if let Some(t) = token {
        if !t.is_empty() {
            return Ok(format!("Bearer {}", t));
        }
    }

    // Fall back to username/password
    match (username, app_password) {
        (Some(u), Some(p)) if !u.is_empty() && !p.is_empty() => Ok(get_auth_header(u, p)),
        _ => Err(LeviathanError::OperationFailed(
            "Bitbucket credentials not configured".to_string(),
        )),
    }
}

// ============================================================================
// Connection Commands
// ============================================================================

/// Check Bitbucket connection status
#[command]
pub async fn check_bitbucket_connection(
    username: Option<String>,
    app_password: Option<String>,
) -> Result<BitbucketConnectionStatus> {
    // Use provided credentials, or fall back to stored credentials
    let credentials = match (username, app_password) {
        (Some(u), Some(p)) if !u.is_empty() && !p.is_empty() => (u, p),
        _ => match get_bitbucket_credentials().await? {
            Some(c) => c,
            None => {
                return Ok(BitbucketConnectionStatus {
                    connected: false,
                    user: None,
                })
            }
        },
    };

    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/user", BITBUCKET_API_BASE))
        .header(
            "Authorization",
            get_auth_header(&credentials.0, &credentials.1),
        )
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to check connection: {}", e))
        })?;

    if !response.status().is_success() {
        return Ok(BitbucketConnectionStatus {
            connected: false,
            user: None,
        });
    }

    #[derive(Deserialize)]
    struct ApiUser {
        uuid: String,
        username: String,
        display_name: String,
        links: ApiLinks,
    }

    #[derive(Deserialize)]
    struct ApiLinks {
        avatar: Option<ApiLink>,
    }

    #[derive(Deserialize)]
    struct ApiLink {
        href: String,
    }

    let api_user: ApiUser = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse user data: {}", e))
    })?;

    Ok(BitbucketConnectionStatus {
        connected: true,
        user: Some(BitbucketUser {
            uuid: api_user.uuid,
            username: api_user.username,
            display_name: api_user.display_name,
            avatar_url: api_user.links.avatar.map(|a| a.href),
        }),
    })
}

/// Check Bitbucket connection status using OAuth token
#[command]
pub async fn check_bitbucket_connection_with_token(
    token: Option<String>,
) -> Result<BitbucketConnectionStatus> {
    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Ok(BitbucketConnectionStatus {
                connected: false,
                user: None,
            })
        }
    };

    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/user", BITBUCKET_API_BASE))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to check connection: {}", e))
        })?;

    if !response.status().is_success() {
        return Ok(BitbucketConnectionStatus {
            connected: false,
            user: None,
        });
    }

    #[derive(Deserialize)]
    struct ApiUser {
        uuid: String,
        username: String,
        display_name: String,
        links: ApiLinks,
    }

    #[derive(Deserialize)]
    struct ApiLinks {
        avatar: Option<ApiLink>,
    }

    #[derive(Deserialize)]
    struct ApiLink {
        href: String,
    }

    let api_user: ApiUser = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse user data: {}", e))
    })?;

    Ok(BitbucketConnectionStatus {
        connected: true,
        user: Some(BitbucketUser {
            uuid: api_user.uuid,
            username: api_user.username,
            display_name: api_user.display_name,
            avatar_url: api_user.links.avatar.map(|a| a.href),
        }),
    })
}

/// Detect Bitbucket repository from git remotes
#[command]
pub async fn detect_bitbucket_repo(path: String) -> Result<Option<DetectedBitbucketRepo>> {
    let repo = git2::Repository::open(&path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to open repository: {}", e))
    })?;

    let remotes = repo
        .remotes()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to get remotes: {}", e)))?;

    for remote_name in remotes.iter().flatten() {
        if let Ok(remote) = repo.find_remote(remote_name) {
            if let Some(url) = remote.url() {
                if let Some(repo_info) = parse_bitbucket_url(url) {
                    return Ok(Some(DetectedBitbucketRepo {
                        workspace: repo_info.0,
                        repo_slug: repo_info.1,
                        remote_name: remote_name.to_string(),
                    }));
                }
            }
        }
    }

    Ok(None)
}

fn parse_bitbucket_url(url: &str) -> Option<(String, String)> {
    // Bitbucket URLs can be:
    // https://bitbucket.org/{workspace}/{repo}.git
    // https://username@bitbucket.org/{workspace}/{repo}.git
    // git@bitbucket.org:{workspace}/{repo}.git

    // SSH format
    if url.starts_with("git@bitbucket.org:") {
        let path = url.trim_start_matches("git@bitbucket.org:");
        let path = path.trim_end_matches(".git");
        let parts: Vec<&str> = path.split('/').collect();
        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    // HTTPS format (with or without username@)
    if url.contains("bitbucket.org") {
        let url = url
            .trim_start_matches("https://")
            .trim_start_matches("http://");

        // Handle username@bitbucket.org format - strip everything before bitbucket.org
        let url = if let Some(pos) = url.find("bitbucket.org") {
            &url[pos..]
        } else {
            url
        };

        let url = url.trim_start_matches("bitbucket.org/");
        let path = url.trim_end_matches(".git");
        let parts: Vec<&str> = path.split('/').collect();
        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    None
}

// ============================================================================
// Pull Request Commands
// ============================================================================

/// List pull requests for a repository
#[command]
pub async fn list_bitbucket_pull_requests(
    workspace: String,
    repo_slug: String,
    state: Option<String>,
    token: Option<String>,
    username: Option<String>,
    app_password: Option<String>,
) -> Result<Vec<BitbucketPullRequest>> {
    let auth_header = get_auth_header_with_token(
        token.as_deref(),
        username.as_deref(),
        app_password.as_deref(),
    )?;

    let state_param = state.unwrap_or_else(|| "OPEN".to_string());
    let url = format!(
        "{}/repositories/{}/{}/pullrequests?state={}&pagelen=30",
        BITBUCKET_API_BASE, workspace, repo_slug, state_param
    );

    tracing::debug!(
        "Fetching Bitbucket PRs: url={}, has_token={}",
        url,
        token.is_some()
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", auth_header)
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch pull requests: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "Bitbucket API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiResponse {
        values: Vec<ApiPullRequest>,
    }

    #[derive(Deserialize)]
    struct ApiPullRequest {
        id: u64,
        title: String,
        description: Option<String>,
        state: String,
        author: ApiUser,
        created_on: String,
        source: ApiBranch,
        destination: ApiBranch,
        links: ApiPrLinks,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        uuid: String,
        username: Option<String>,
        display_name: String,
        links: ApiLinks,
    }

    #[derive(Deserialize)]
    struct ApiLinks {
        avatar: Option<ApiLink>,
    }

    #[derive(Deserialize)]
    struct ApiLink {
        href: String,
    }

    #[derive(Deserialize)]
    struct ApiBranch {
        branch: ApiBranchName,
    }

    #[derive(Deserialize)]
    struct ApiBranchName {
        name: String,
    }

    #[derive(Deserialize)]
    struct ApiPrLinks {
        html: ApiLink,
    }

    let data: ApiResponse = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse pull requests: {}", e))
    })?;

    Ok(data
        .values
        .into_iter()
        .map(|pr| BitbucketPullRequest {
            id: pr.id,
            title: pr.title,
            description: pr.description,
            state: pr.state,
            author: BitbucketUser {
                uuid: pr.author.uuid,
                username: pr.author.username.unwrap_or_default(),
                display_name: pr.author.display_name,
                avatar_url: pr.author.links.avatar.map(|a| a.href),
            },
            created_on: pr.created_on,
            source_branch: pr.source.branch.name,
            destination_branch: pr.destination.branch.name,
            url: pr.links.html.href,
        })
        .collect())
}

/// Get a single pull request
#[command]
pub async fn get_bitbucket_pull_request(
    workspace: String,
    repo_slug: String,
    pr_id: u64,
    token: Option<String>,
    username: Option<String>,
    app_password: Option<String>,
) -> Result<BitbucketPullRequest> {
    let auth_header = get_auth_header_with_token(
        token.as_deref(),
        username.as_deref(),
        app_password.as_deref(),
    )?;

    let url = format!(
        "{}/repositories/{}/{}/pullrequests/{}",
        BITBUCKET_API_BASE, workspace, repo_slug, pr_id
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", auth_header)
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch pull request: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "Bitbucket API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiPullRequest {
        id: u64,
        title: String,
        description: Option<String>,
        state: String,
        author: ApiUser,
        created_on: String,
        source: ApiBranch,
        destination: ApiBranch,
        links: ApiPrLinks,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        uuid: String,
        username: Option<String>,
        display_name: String,
        links: ApiLinks,
    }

    #[derive(Deserialize)]
    struct ApiLinks {
        avatar: Option<ApiLink>,
    }

    #[derive(Deserialize)]
    struct ApiLink {
        href: String,
    }

    #[derive(Deserialize)]
    struct ApiBranch {
        branch: ApiBranchName,
    }

    #[derive(Deserialize)]
    struct ApiBranchName {
        name: String,
    }

    #[derive(Deserialize)]
    struct ApiPrLinks {
        html: ApiLink,
    }

    let pr: ApiPullRequest = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse pull request: {}", e))
    })?;

    Ok(BitbucketPullRequest {
        id: pr.id,
        title: pr.title,
        description: pr.description,
        state: pr.state,
        author: BitbucketUser {
            uuid: pr.author.uuid,
            username: pr.author.username.unwrap_or_default(),
            display_name: pr.author.display_name,
            avatar_url: pr.author.links.avatar.map(|a| a.href),
        },
        created_on: pr.created_on,
        source_branch: pr.source.branch.name,
        destination_branch: pr.destination.branch.name,
        url: pr.links.html.href,
    })
}

/// Create a pull request
#[command]
pub async fn create_bitbucket_pull_request(
    workspace: String,
    repo_slug: String,
    input: CreateBitbucketPullRequestInput,
    token: Option<String>,
    username: Option<String>,
    app_password: Option<String>,
) -> Result<BitbucketPullRequest> {
    let auth_header = get_auth_header_with_token(
        token.as_deref(),
        username.as_deref(),
        app_password.as_deref(),
    )?;

    let url = format!(
        "{}/repositories/{}/{}/pullrequests",
        BITBUCKET_API_BASE, workspace, repo_slug
    );

    #[derive(Serialize)]
    struct CreatePrBody {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        source: BranchSpec,
        destination: BranchSpec,
        #[serde(skip_serializing_if = "Option::is_none")]
        close_source_branch: Option<bool>,
    }

    #[derive(Serialize)]
    struct BranchSpec {
        branch: BranchName,
    }

    #[derive(Serialize)]
    struct BranchName {
        name: String,
    }

    let body = CreatePrBody {
        title: input.title,
        description: input.description,
        source: BranchSpec {
            branch: BranchName {
                name: input.source_branch,
            },
        },
        destination: BranchSpec {
            branch: BranchName {
                name: input.destination_branch,
            },
        },
        close_source_branch: input.close_source_branch,
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", auth_header)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to create pull request: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "Bitbucket API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiPullRequest {
        id: u64,
        title: String,
        description: Option<String>,
        state: String,
        author: ApiUser,
        created_on: String,
        source: ApiBranch,
        destination: ApiBranch,
        links: ApiPrLinks,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        uuid: String,
        username: Option<String>,
        display_name: String,
        links: ApiLinks,
    }

    #[derive(Deserialize)]
    struct ApiLinks {
        avatar: Option<ApiLink>,
    }

    #[derive(Deserialize)]
    struct ApiLink {
        href: String,
    }

    #[derive(Deserialize)]
    struct ApiBranch {
        branch: ApiBranchName,
    }

    #[derive(Deserialize)]
    struct ApiBranchName {
        name: String,
    }

    #[derive(Deserialize)]
    struct ApiPrLinks {
        html: ApiLink,
    }

    let pr: ApiPullRequest = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse pull request: {}", e))
    })?;

    Ok(BitbucketPullRequest {
        id: pr.id,
        title: pr.title,
        description: pr.description,
        state: pr.state,
        author: BitbucketUser {
            uuid: pr.author.uuid,
            username: pr.author.username.unwrap_or_default(),
            display_name: pr.author.display_name,
            avatar_url: pr.author.links.avatar.map(|a| a.href),
        },
        created_on: pr.created_on,
        source_branch: pr.source.branch.name,
        destination_branch: pr.destination.branch.name,
        url: pr.links.html.href,
    })
}

// ============================================================================
// Issue Commands (Note: Issues must be enabled on the repository)
// ============================================================================

/// List issues for a repository
#[command]
pub async fn list_bitbucket_issues(
    workspace: String,
    repo_slug: String,
    state: Option<String>,
    token: Option<String>,
    username: Option<String>,
    app_password: Option<String>,
) -> Result<Vec<BitbucketIssue>> {
    let auth_header = get_auth_header_with_token(
        token.as_deref(),
        username.as_deref(),
        app_password.as_deref(),
    )?;

    let mut url = format!(
        "{}/repositories/{}/{}/issues?pagelen=30",
        BITBUCKET_API_BASE, workspace, repo_slug
    );

    if let Some(state_str) = state {
        url.push_str(&format!("&q=state=\"{}\"", state_str));
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", auth_header)
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch issues: {}", e)))?;

    if !response.status().is_success() {
        // Issues might not be enabled, return empty list
        return Ok(vec![]);
    }

    #[derive(Deserialize)]
    struct ApiResponse {
        values: Vec<ApiIssue>,
    }

    #[derive(Deserialize)]
    struct ApiIssue {
        id: u64,
        title: String,
        content: Option<ApiContent>,
        state: String,
        priority: String,
        kind: String,
        reporter: Option<ApiUser>,
        assignee: Option<ApiUser>,
        created_on: String,
        links: ApiIssueLinks,
    }

    #[derive(Deserialize)]
    struct ApiContent {
        raw: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        uuid: String,
        username: Option<String>,
        display_name: String,
        links: ApiLinks,
    }

    #[derive(Deserialize)]
    struct ApiLinks {
        avatar: Option<ApiLink>,
    }

    #[derive(Deserialize)]
    struct ApiLink {
        href: String,
    }

    #[derive(Deserialize)]
    struct ApiIssueLinks {
        html: ApiLink,
    }

    let data: ApiResponse = response
        .json()
        .await
        .unwrap_or(ApiResponse { values: vec![] });

    Ok(data
        .values
        .into_iter()
        .map(|issue| BitbucketIssue {
            id: issue.id,
            title: issue.title,
            content: issue.content.and_then(|c| c.raw),
            state: issue.state,
            priority: issue.priority,
            kind: issue.kind,
            reporter: issue.reporter.map(|u| BitbucketUser {
                uuid: u.uuid,
                username: u.username.unwrap_or_default(),
                display_name: u.display_name,
                avatar_url: u.links.avatar.map(|a| a.href),
            }),
            assignee: issue.assignee.map(|u| BitbucketUser {
                uuid: u.uuid,
                username: u.username.unwrap_or_default(),
                display_name: u.display_name,
                avatar_url: u.links.avatar.map(|a| a.href),
            }),
            created_on: issue.created_on,
            url: issue.links.html.href,
        })
        .collect())
}

// ============================================================================
// Pipeline Commands
// ============================================================================

/// List pipelines for a repository
#[command]
pub async fn list_bitbucket_pipelines(
    workspace: String,
    repo_slug: String,
    token: Option<String>,
    username: Option<String>,
    app_password: Option<String>,
) -> Result<Vec<BitbucketPipeline>> {
    let auth_header = get_auth_header_with_token(
        token.as_deref(),
        username.as_deref(),
        app_password.as_deref(),
    )?;

    let url = format!(
        "{}/repositories/{}/{}/pipelines/?pagelen=20&sort=-created_on",
        BITBUCKET_API_BASE, workspace, repo_slug
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", auth_header)
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch pipelines: {}", e))
        })?;

    if !response.status().is_success() {
        // Pipelines might not be enabled
        return Ok(vec![]);
    }

    #[derive(Deserialize)]
    struct ApiResponse {
        values: Vec<ApiPipeline>,
    }

    #[derive(Deserialize)]
    struct ApiPipeline {
        uuid: String,
        build_number: u64,
        state: ApiState,
        target: ApiTarget,
        created_on: String,
        completed_on: Option<String>,
        links: ApiPipelineLinks,
    }

    #[derive(Deserialize)]
    struct ApiState {
        name: String,
        result: Option<ApiResult>,
    }

    #[derive(Deserialize)]
    struct ApiResult {
        name: String,
    }

    #[derive(Deserialize)]
    struct ApiTarget {
        ref_name: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiPipelineLinks {
        html: Option<ApiLink>,
    }

    #[derive(Deserialize)]
    struct ApiLink {
        href: String,
    }

    let data: ApiResponse = response
        .json()
        .await
        .unwrap_or(ApiResponse { values: vec![] });

    Ok(data
        .values
        .into_iter()
        .map(|p| BitbucketPipeline {
            uuid: p.uuid,
            build_number: p.build_number,
            state_name: p.state.name,
            result_name: p.state.result.map(|r| r.name),
            target_branch: p.target.ref_name.unwrap_or_else(|| "unknown".to_string()),
            created_on: p.created_on,
            completed_on: p.completed_on,
            url: p.links.html.map(|l| l.href).unwrap_or_else(|| {
                format!(
                    "https://bitbucket.org/{}/{}/pipelines",
                    workspace, repo_slug
                )
            }),
        })
        .collect())
}
