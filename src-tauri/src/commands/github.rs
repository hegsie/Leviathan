//! GitHub integration command handlers
//! Provides GitHub API integration for PRs, issues, and Actions

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

use crate::error::{LeviathanError, Result};

const GITHUB_API_BASE: &str = "https://api.github.com";
const TOKEN_FILE_NAME: &str = "github-token";

/// Get the path to the token file in app data directory
fn get_token_file_path() -> Result<PathBuf> {
    let data_dir = dirs::data_dir().ok_or_else(|| {
        LeviathanError::OperationFailed("Could not find data directory".to_string())
    })?;
    let app_dir = data_dir.join("leviathan");
    fs::create_dir_all(&app_dir).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to create app directory: {}", e))
    })?;
    Ok(app_dir.join(TOKEN_FILE_NAME))
}

/// GitHub user information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUser {
    pub login: String,
    pub id: u64,
    #[serde(alias = "avatar_url", rename = "avatarUrl")]
    pub avatar_url: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

/// GitHub repository information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub html_url: String,
    pub description: Option<String>,
    pub default_branch: String,
    pub open_issues_count: u32,
    pub has_issues: bool,
    pub has_projects: bool,
    pub has_wiki: bool,
}

/// Pull request state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestState {
    Open,
    Closed,
    Merged,
}

/// Pull request summary for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub user: GitHubUser,
    pub created_at: String,
    pub updated_at: String,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    pub draft: bool,
    pub mergeable: Option<bool>,
    pub merged_at: Option<String>,
    pub html_url: String,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub changed_files: Option<u32>,
}

/// Pull request details
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetails {
    pub number: u32,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub user: GitHubUser,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub merged_at: Option<String>,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    pub base_sha: String,
    pub draft: bool,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub html_url: String,
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
    pub commits: u32,
    pub comments: u32,
    pub review_comments: u32,
    pub labels: Vec<Label>,
    pub assignees: Vec<GitHubUser>,
    pub reviewers: Vec<GitHubUser>,
}

/// GitHub label
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: u64,
    pub name: String,
    pub color: String,
    pub description: Option<String>,
}

/// Pull request review
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReview {
    pub id: u64,
    pub user: GitHubUser,
    pub body: Option<String>,
    pub state: String,
    pub submitted_at: Option<String>,
    pub html_url: String,
}

/// PR comment
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestComment {
    pub id: u64,
    pub user: GitHubUser,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

/// GitHub Actions workflow run
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub id: u64,
    pub name: String,
    pub head_branch: String,
    pub head_sha: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub workflow_id: u64,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub run_number: u32,
    pub event: String,
}

/// GitHub Actions check run
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub html_url: Option<String>,
}

/// Create pull request input
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePullRequestInput {
    pub title: String,
    pub body: Option<String>,
    pub head: String,
    pub base: String,
    pub draft: Option<bool>,
}

/// GitHub connection status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubConnectionStatus {
    pub connected: bool,
    pub user: Option<GitHubUser>,
    pub scopes: Vec<String>,
}

/// Detected GitHub repository info from remote URL
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedGitHubRepo {
    pub owner: String,
    pub repo: String,
    pub remote_name: String,
}

// ============================================================================
// Authentication Commands
// ============================================================================

/// Store GitHub personal access token
#[command]
pub async fn store_github_token(token: String) -> Result<()> {
    let token_path = get_token_file_path()?;

    fs::write(&token_path, &token)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to store token: {}", e)))?;

    Ok(())
}

/// Get stored GitHub token (returns None if not set)
#[command]
pub async fn get_github_token() -> Result<Option<String>> {
    let token_path = get_token_file_path()?;

    if !token_path.exists() {
        return Ok(None);
    }

    match fs::read_to_string(&token_path) {
        Ok(token) => {
            let token = token.trim().to_string();
            if token.is_empty() {
                Ok(None)
            } else {
                Ok(Some(token))
            }
        }
        Err(e) => Err(LeviathanError::OperationFailed(format!(
            "Failed to read token: {}",
            e
        ))),
    }
}

/// Delete stored GitHub token
#[command]
pub async fn delete_github_token() -> Result<()> {
    let token_path = get_token_file_path()?;

    if token_path.exists() {
        fs::remove_file(&token_path).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to delete token: {}", e))
        })?;
    }

    Ok(())
}

/// Check GitHub connection and get user info
#[command]
pub async fn check_github_connection() -> Result<GitHubConnectionStatus> {
    let token = match get_github_token().await? {
        Some(t) => t,
        None => {
            return Ok(GitHubConnectionStatus {
                connected: false,
                user: None,
                scopes: vec![],
            })
        }
    };

    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/user", GITHUB_API_BASE))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to connect to GitHub: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error ({}): {}",
            status, error_body
        )));
    }

    // Get scopes from header
    let scopes: Vec<String> = response
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(", ").map(|s| s.to_string()).collect())
        .unwrap_or_default();

    let user: GitHubUser = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse user: {}", e)))?;

    Ok(GitHubConnectionStatus {
        connected: true,
        user: Some(user),
        scopes,
    })
}

// ============================================================================
// Repository Detection
// ============================================================================

/// Detect GitHub repository from git remotes
#[command]
pub async fn detect_github_repo(path: String) -> Result<Option<DetectedGitHubRepo>> {
    let repo = git2::Repository::open(&path)
        .map_err(|e| LeviathanError::RepositoryNotFound(e.to_string()))?;

    // Check all remotes for GitHub URLs
    for remote_name in repo.remotes()?.iter().flatten() {
        if let Ok(remote) = repo.find_remote(remote_name) {
            if let Some(url) = remote.url() {
                if let Some(parsed) = parse_github_url(url) {
                    return Ok(Some(DetectedGitHubRepo {
                        owner: parsed.0,
                        repo: parsed.1,
                        remote_name: remote_name.to_string(),
                    }));
                }
            }
        }
    }

    Ok(None)
}

/// Parse GitHub URL to extract owner and repo
fn parse_github_url(url: &str) -> Option<(String, String)> {
    // Handle SSH format: git@github.com:owner/repo.git
    if url.starts_with("git@github.com:") {
        let path = url.strip_prefix("git@github.com:")?;
        let path = path.strip_suffix(".git").unwrap_or(path);
        let parts: Vec<&str> = path.split('/').collect();
        if parts.len() == 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    // Handle HTTPS format: https://github.com/owner/repo.git
    if url.contains("github.com") {
        let url = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))?;
        let url = url.strip_prefix("github.com/")?;
        let url = url.strip_suffix(".git").unwrap_or(url);
        let parts: Vec<&str> = url.split('/').collect();
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
pub async fn list_pull_requests(
    owner: String,
    repo: String,
    state: Option<String>,
    per_page: Option<u32>,
) -> Result<Vec<PullRequestSummary>> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let state = state.unwrap_or_else(|| "open".to_string());
    let per_page = per_page.unwrap_or(30);

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/pulls",
            GITHUB_API_BASE, owner, repo
        ))
        .query(&[("state", &state), ("per_page", &per_page.to_string())])
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch PRs: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiPR {
        number: u32,
        title: String,
        state: String,
        user: ApiUser,
        created_at: String,
        updated_at: String,
        merged_at: Option<String>,
        head: ApiRef,
        base: ApiRef,
        draft: Option<bool>,
        mergeable: Option<bool>,
        html_url: String,
        additions: Option<u32>,
        deletions: Option<u32>,
        changed_files: Option<u32>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiRef {
        #[serde(rename = "ref")]
        ref_name: String,
        sha: String,
    }

    let prs: Vec<ApiPR> = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse PRs: {}", e)))?;

    Ok(prs
        .into_iter()
        .map(|pr| PullRequestSummary {
            number: pr.number,
            title: pr.title,
            state: pr.state,
            user: GitHubUser {
                login: pr.user.login,
                id: pr.user.id,
                avatar_url: pr.user.avatar_url,
                name: pr.user.name,
                email: pr.user.email,
            },
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            merged_at: pr.merged_at,
            head_ref: pr.head.ref_name,
            head_sha: pr.head.sha,
            base_ref: pr.base.ref_name,
            draft: pr.draft.unwrap_or(false),
            mergeable: pr.mergeable,
            html_url: pr.html_url,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
        })
        .collect())
}

/// Get pull request details
#[command]
pub async fn get_pull_request(
    owner: String,
    repo: String,
    number: u32,
) -> Result<PullRequestDetails> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/pulls/{}",
            GITHUB_API_BASE, owner, repo, number
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch PR: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiPRDetail {
        number: u32,
        title: String,
        body: Option<String>,
        state: String,
        user: ApiUser,
        created_at: String,
        updated_at: String,
        closed_at: Option<String>,
        merged_at: Option<String>,
        head: ApiRefDetail,
        base: ApiRefDetail,
        draft: Option<bool>,
        mergeable: Option<bool>,
        mergeable_state: Option<String>,
        html_url: String,
        additions: u32,
        deletions: u32,
        changed_files: u32,
        commits: u32,
        comments: u32,
        review_comments: u32,
        labels: Vec<ApiLabel>,
        assignees: Vec<ApiUser>,
        requested_reviewers: Vec<ApiUser>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiRefDetail {
        #[serde(rename = "ref")]
        ref_name: String,
        sha: String,
    }

    #[derive(Deserialize)]
    struct ApiLabel {
        id: u64,
        name: String,
        color: String,
        description: Option<String>,
    }

    let pr: ApiPRDetail = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse PR: {}", e)))?;

    Ok(PullRequestDetails {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        user: GitHubUser {
            login: pr.user.login,
            id: pr.user.id,
            avatar_url: pr.user.avatar_url,
            name: pr.user.name,
            email: pr.user.email,
        },
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        closed_at: pr.closed_at,
        merged_at: pr.merged_at,
        head_ref: pr.head.ref_name,
        head_sha: pr.head.sha,
        base_ref: pr.base.ref_name,
        base_sha: pr.base.sha,
        draft: pr.draft.unwrap_or(false),
        mergeable: pr.mergeable,
        mergeable_state: pr.mergeable_state,
        html_url: pr.html_url,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        commits: pr.commits,
        comments: pr.comments,
        review_comments: pr.review_comments,
        labels: pr
            .labels
            .into_iter()
            .map(|l| Label {
                id: l.id,
                name: l.name,
                color: l.color,
                description: l.description,
            })
            .collect(),
        assignees: pr
            .assignees
            .into_iter()
            .map(|u| GitHubUser {
                login: u.login,
                id: u.id,
                avatar_url: u.avatar_url,
                name: u.name,
                email: u.email,
            })
            .collect(),
        reviewers: pr
            .requested_reviewers
            .into_iter()
            .map(|u| GitHubUser {
                login: u.login,
                id: u.id,
                avatar_url: u.avatar_url,
                name: u.name,
                email: u.email,
            })
            .collect(),
    })
}

/// Create a new pull request
#[command]
pub async fn create_pull_request(
    owner: String,
    repo: String,
    input: CreatePullRequestInput,
) -> Result<PullRequestSummary> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    #[derive(Serialize)]
    struct CreatePRBody {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        body: Option<String>,
        head: String,
        base: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        draft: Option<bool>,
    }

    let body = CreatePRBody {
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft,
    };

    let client = reqwest::Client::new();
    let response = client
        .post(format!(
            "{}/repos/{}/{}/pulls",
            GITHUB_API_BASE, owner, repo
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&body)
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to create PR: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiPR {
        number: u32,
        title: String,
        state: String,
        user: ApiUser,
        created_at: String,
        updated_at: String,
        head: ApiRef,
        base: ApiRef,
        draft: Option<bool>,
        html_url: String,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiRef {
        #[serde(rename = "ref")]
        ref_name: String,
        sha: String,
    }

    let pr: ApiPR = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse PR: {}", e)))?;

    Ok(PullRequestSummary {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        user: GitHubUser {
            login: pr.user.login,
            id: pr.user.id,
            avatar_url: pr.user.avatar_url,
            name: pr.user.name,
            email: pr.user.email,
        },
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        merged_at: None,
        head_ref: pr.head.ref_name,
        head_sha: pr.head.sha,
        base_ref: pr.base.ref_name,
        draft: pr.draft.unwrap_or(false),
        mergeable: None,
        html_url: pr.html_url,
        additions: None,
        deletions: None,
        changed_files: None,
    })
}

/// Get pull request reviews
#[command]
pub async fn get_pull_request_reviews(
    owner: String,
    repo: String,
    number: u32,
) -> Result<Vec<PullRequestReview>> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/pulls/{}/reviews",
            GITHUB_API_BASE, owner, repo, number
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch reviews: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiReview {
        id: u64,
        user: ApiUser,
        body: Option<String>,
        state: String,
        submitted_at: Option<String>,
        html_url: String,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    let reviews: Vec<ApiReview> = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse reviews: {}", e)))?;

    Ok(reviews
        .into_iter()
        .map(|r| PullRequestReview {
            id: r.id,
            user: GitHubUser {
                login: r.user.login,
                id: r.user.id,
                avatar_url: r.user.avatar_url,
                name: r.user.name,
                email: r.user.email,
            },
            body: r.body,
            state: r.state,
            submitted_at: r.submitted_at,
            html_url: r.html_url,
        })
        .collect())
}

// ============================================================================
// GitHub Actions Commands
// ============================================================================

/// Get workflow runs for a repository
#[command]
pub async fn get_workflow_runs(
    owner: String,
    repo: String,
    branch: Option<String>,
    per_page: Option<u32>,
) -> Result<Vec<WorkflowRun>> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let per_page = per_page.unwrap_or(20);

    let client = reqwest::Client::new();
    let mut request = client
        .get(format!(
            "{}/repos/{}/{}/actions/runs",
            GITHUB_API_BASE, owner, repo
        ))
        .query(&[("per_page", per_page.to_string())])
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    if let Some(branch) = branch {
        request = request.query(&[("branch", branch)]);
    }

    let response = request.send().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to fetch workflow runs: {}", e))
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiWorkflowRuns {
        workflow_runs: Vec<ApiWorkflowRun>,
    }

    #[derive(Deserialize)]
    struct ApiWorkflowRun {
        id: u64,
        name: Option<String>,
        head_branch: Option<String>,
        head_sha: String,
        status: String,
        conclusion: Option<String>,
        workflow_id: u64,
        html_url: String,
        created_at: String,
        updated_at: String,
        run_number: u32,
        event: String,
    }

    let runs: ApiWorkflowRuns = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse workflow runs: {}", e))
    })?;

    Ok(runs
        .workflow_runs
        .into_iter()
        .map(|r| WorkflowRun {
            id: r.id,
            name: r.name.unwrap_or_else(|| "Unknown".to_string()),
            head_branch: r.head_branch.unwrap_or_default(),
            head_sha: r.head_sha,
            status: r.status,
            conclusion: r.conclusion,
            workflow_id: r.workflow_id,
            html_url: r.html_url,
            created_at: r.created_at,
            updated_at: r.updated_at,
            run_number: r.run_number,
            event: r.event,
        })
        .collect())
}

/// Get check runs for a specific commit
#[command]
pub async fn get_check_runs(
    owner: String,
    repo: String,
    commit_sha: String,
) -> Result<Vec<CheckRun>> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/commits/{}/check-runs",
            GITHUB_API_BASE, owner, repo, commit_sha
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch check runs: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiCheckRuns {
        check_runs: Vec<ApiCheckRun>,
    }

    #[derive(Deserialize)]
    struct ApiCheckRun {
        id: u64,
        name: String,
        status: String,
        conclusion: Option<String>,
        started_at: Option<String>,
        completed_at: Option<String>,
        html_url: Option<String>,
    }

    let runs: ApiCheckRuns = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse check runs: {}", e))
    })?;

    Ok(runs
        .check_runs
        .into_iter()
        .map(|r| CheckRun {
            id: r.id,
            name: r.name,
            status: r.status,
            conclusion: r.conclusion,
            started_at: r.started_at,
            completed_at: r.completed_at,
            html_url: r.html_url,
        })
        .collect())
}

/// Get combined status for a commit (legacy status API + checks)
#[command]
pub async fn get_commit_status(owner: String, repo: String, commit_sha: String) -> Result<String> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/commits/{}/status",
            GITHUB_API_BASE, owner, repo, commit_sha
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch commit status: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiStatus {
        state: String,
    }

    let status: ApiStatus = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse status: {}", e)))?;

    Ok(status.state)
}

// ============================================================================
// Issue Types
// ============================================================================

/// Issue summary for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub user: GitHubUser,
    pub labels: Vec<Label>,
    pub assignees: Vec<GitHubUser>,
    pub comments: u32,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub html_url: String,
    pub body: Option<String>,
}

/// Issue comment
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueComment {
    pub id: u64,
    pub user: GitHubUser,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

/// Create issue input
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIssueInput {
    pub title: String,
    pub body: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignees: Option<Vec<String>>,
}

// ============================================================================
// Issue Commands
// ============================================================================

/// List issues for a repository
#[command]
pub async fn list_issues(
    owner: String,
    repo: String,
    state: Option<String>,
    labels: Option<String>,
    per_page: Option<u32>,
) -> Result<Vec<IssueSummary>> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let state = state.unwrap_or_else(|| "open".to_string());
    let per_page = per_page.unwrap_or(30);

    let client = reqwest::Client::new();
    let mut request = client
        .get(format!(
            "{}/repos/{}/{}/issues",
            GITHUB_API_BASE, owner, repo
        ))
        .query(&[("state", &state), ("per_page", &per_page.to_string())])
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    if let Some(labels) = labels {
        request = request.query(&[("labels", labels)]);
    }

    let response = request
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch issues: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiIssue {
        number: u32,
        title: String,
        state: String,
        user: ApiUser,
        labels: Vec<ApiLabel>,
        assignees: Vec<ApiUser>,
        comments: u32,
        created_at: String,
        updated_at: String,
        closed_at: Option<String>,
        html_url: String,
        body: Option<String>,
        pull_request: Option<serde_json::Value>, // Present if this is a PR
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiLabel {
        id: u64,
        name: String,
        color: String,
        description: Option<String>,
    }

    let issues: Vec<ApiIssue> = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse issues: {}", e)))?;

    // Filter out pull requests (they appear in issues API)
    Ok(issues
        .into_iter()
        .filter(|i| i.pull_request.is_none())
        .map(|issue| IssueSummary {
            number: issue.number,
            title: issue.title,
            state: issue.state,
            user: GitHubUser {
                login: issue.user.login,
                id: issue.user.id,
                avatar_url: issue.user.avatar_url,
                name: issue.user.name,
                email: issue.user.email,
            },
            labels: issue
                .labels
                .into_iter()
                .map(|l| Label {
                    id: l.id,
                    name: l.name,
                    color: l.color,
                    description: l.description,
                })
                .collect(),
            assignees: issue
                .assignees
                .into_iter()
                .map(|u| GitHubUser {
                    login: u.login,
                    id: u.id,
                    avatar_url: u.avatar_url,
                    name: u.name,
                    email: u.email,
                })
                .collect(),
            comments: issue.comments,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            closed_at: issue.closed_at,
            html_url: issue.html_url,
            body: issue.body,
        })
        .collect())
}

/// Get issue details
#[command]
pub async fn get_issue(owner: String, repo: String, number: u32) -> Result<IssueSummary> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/issues/{}",
            GITHUB_API_BASE, owner, repo, number
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch issue: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiIssue {
        number: u32,
        title: String,
        state: String,
        user: ApiUser,
        labels: Vec<ApiLabel>,
        assignees: Vec<ApiUser>,
        comments: u32,
        created_at: String,
        updated_at: String,
        closed_at: Option<String>,
        html_url: String,
        body: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiLabel {
        id: u64,
        name: String,
        color: String,
        description: Option<String>,
    }

    let issue: ApiIssue = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse issue: {}", e)))?;

    Ok(IssueSummary {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        user: GitHubUser {
            login: issue.user.login,
            id: issue.user.id,
            avatar_url: issue.user.avatar_url,
            name: issue.user.name,
            email: issue.user.email,
        },
        labels: issue
            .labels
            .into_iter()
            .map(|l| Label {
                id: l.id,
                name: l.name,
                color: l.color,
                description: l.description,
            })
            .collect(),
        assignees: issue
            .assignees
            .into_iter()
            .map(|u| GitHubUser {
                login: u.login,
                id: u.id,
                avatar_url: u.avatar_url,
                name: u.name,
                email: u.email,
            })
            .collect(),
        comments: issue.comments,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        html_url: issue.html_url,
        body: issue.body,
    })
}

/// Create a new issue
#[command]
pub async fn create_issue(
    owner: String,
    repo: String,
    input: CreateIssueInput,
) -> Result<IssueSummary> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    #[derive(Serialize)]
    struct CreateIssueBody {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        body: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        labels: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        assignees: Option<Vec<String>>,
    }

    let body = CreateIssueBody {
        title: input.title,
        body: input.body,
        labels: input.labels,
        assignees: input.assignees,
    };

    let client = reqwest::Client::new();
    let response = client
        .post(format!(
            "{}/repos/{}/{}/issues",
            GITHUB_API_BASE, owner, repo
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&body)
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to create issue: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiIssue {
        number: u32,
        title: String,
        state: String,
        user: ApiUser,
        labels: Vec<ApiLabel>,
        assignees: Vec<ApiUser>,
        comments: u32,
        created_at: String,
        updated_at: String,
        closed_at: Option<String>,
        html_url: String,
        body: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiLabel {
        id: u64,
        name: String,
        color: String,
        description: Option<String>,
    }

    let issue: ApiIssue = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse issue: {}", e)))?;

    Ok(IssueSummary {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        user: GitHubUser {
            login: issue.user.login,
            id: issue.user.id,
            avatar_url: issue.user.avatar_url,
            name: issue.user.name,
            email: issue.user.email,
        },
        labels: issue
            .labels
            .into_iter()
            .map(|l| Label {
                id: l.id,
                name: l.name,
                color: l.color,
                description: l.description,
            })
            .collect(),
        assignees: issue
            .assignees
            .into_iter()
            .map(|u| GitHubUser {
                login: u.login,
                id: u.id,
                avatar_url: u.avatar_url,
                name: u.name,
                email: u.email,
            })
            .collect(),
        comments: issue.comments,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        html_url: issue.html_url,
        body: issue.body,
    })
}

/// Update issue state (open/close)
#[command]
pub async fn update_issue_state(
    owner: String,
    repo: String,
    number: u32,
    state: String,
) -> Result<IssueSummary> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    #[derive(Serialize)]
    struct UpdateBody {
        state: String,
    }

    let client = reqwest::Client::new();
    let response = client
        .patch(format!(
            "{}/repos/{}/{}/issues/{}",
            GITHUB_API_BASE, owner, repo, number
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&UpdateBody { state })
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to update issue: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiIssue {
        number: u32,
        title: String,
        state: String,
        user: ApiUser,
        labels: Vec<ApiLabel>,
        assignees: Vec<ApiUser>,
        comments: u32,
        created_at: String,
        updated_at: String,
        closed_at: Option<String>,
        html_url: String,
        body: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiLabel {
        id: u64,
        name: String,
        color: String,
        description: Option<String>,
    }

    let issue: ApiIssue = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse issue: {}", e)))?;

    Ok(IssueSummary {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        user: GitHubUser {
            login: issue.user.login,
            id: issue.user.id,
            avatar_url: issue.user.avatar_url,
            name: issue.user.name,
            email: issue.user.email,
        },
        labels: issue
            .labels
            .into_iter()
            .map(|l| Label {
                id: l.id,
                name: l.name,
                color: l.color,
                description: l.description,
            })
            .collect(),
        assignees: issue
            .assignees
            .into_iter()
            .map(|u| GitHubUser {
                login: u.login,
                id: u.id,
                avatar_url: u.avatar_url,
                name: u.name,
                email: u.email,
            })
            .collect(),
        comments: issue.comments,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        html_url: issue.html_url,
        body: issue.body,
    })
}

/// Get issue comments
#[command]
pub async fn get_issue_comments(
    owner: String,
    repo: String,
    number: u32,
    per_page: Option<u32>,
) -> Result<Vec<IssueComment>> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let per_page = per_page.unwrap_or(30);

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/issues/{}/comments",
            GITHUB_API_BASE, owner, repo, number
        ))
        .query(&[("per_page", per_page.to_string())])
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch comments: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiComment {
        id: u64,
        user: ApiUser,
        body: String,
        created_at: String,
        updated_at: String,
        html_url: String,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    let comments: Vec<ApiComment> = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse comments: {}", e)))?;

    Ok(comments
        .into_iter()
        .map(|c| IssueComment {
            id: c.id,
            user: GitHubUser {
                login: c.user.login,
                id: c.user.id,
                avatar_url: c.user.avatar_url,
                name: c.user.name,
                email: c.user.email,
            },
            body: c.body,
            created_at: c.created_at,
            updated_at: c.updated_at,
            html_url: c.html_url,
        })
        .collect())
}

/// Add a comment to an issue
#[command]
pub async fn add_issue_comment(
    owner: String,
    repo: String,
    number: u32,
    body: String,
) -> Result<IssueComment> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    #[derive(Serialize)]
    struct CommentBody {
        body: String,
    }

    let client = reqwest::Client::new();
    let response = client
        .post(format!(
            "{}/repos/{}/{}/issues/{}/comments",
            GITHUB_API_BASE, owner, repo, number
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&CommentBody { body })
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to add comment: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiComment {
        id: u64,
        user: ApiUser,
        body: String,
        created_at: String,
        updated_at: String,
        html_url: String,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    let comment: ApiComment = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse comment: {}", e)))?;

    Ok(IssueComment {
        id: comment.id,
        user: GitHubUser {
            login: comment.user.login,
            id: comment.user.id,
            avatar_url: comment.user.avatar_url,
            name: comment.user.name,
            email: comment.user.email,
        },
        body: comment.body,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        html_url: comment.html_url,
    })
}

/// Get repository labels
#[command]
pub async fn get_repo_labels(
    owner: String,
    repo: String,
    per_page: Option<u32>,
) -> Result<Vec<Label>> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let per_page = per_page.unwrap_or(100);

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/labels",
            GITHUB_API_BASE, owner, repo
        ))
        .query(&[("per_page", per_page.to_string())])
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch labels: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiLabel {
        id: u64,
        name: String,
        color: String,
        description: Option<String>,
    }

    let labels: Vec<ApiLabel> = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse labels: {}", e)))?;

    Ok(labels
        .into_iter()
        .map(|l| Label {
            id: l.id,
            name: l.name,
            color: l.color,
            description: l.description,
        })
        .collect())
}

// ============================================================================
// Release Types
// ============================================================================

/// GitHub release summary
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseSummary {
    pub id: u64,
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub draft: bool,
    pub prerelease: bool,
    pub created_at: String,
    pub published_at: Option<String>,
    pub html_url: String,
    pub author: GitHubUser,
    pub assets_count: usize,
}

/// Release asset
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub id: u64,
    pub name: String,
    pub label: Option<String>,
    pub content_type: String,
    pub size: u64,
    pub download_count: u64,
    pub browser_download_url: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Create release input
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReleaseInput {
    pub tag_name: String,
    pub target_commitish: Option<String>,
    pub name: Option<String>,
    pub body: Option<String>,
    pub draft: Option<bool>,
    pub prerelease: Option<bool>,
    pub generate_release_notes: Option<bool>,
}

// ============================================================================
// Release Commands
// ============================================================================

/// List releases for a repository
#[command]
pub async fn list_releases(
    owner: String,
    repo: String,
    per_page: Option<u32>,
) -> Result<Vec<ReleaseSummary>> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let per_page = per_page.unwrap_or(30);

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/releases",
            GITHUB_API_BASE, owner, repo
        ))
        .query(&[("per_page", per_page.to_string())])
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch releases: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiRelease {
        id: u64,
        tag_name: String,
        name: Option<String>,
        body: Option<String>,
        draft: bool,
        prerelease: bool,
        created_at: String,
        published_at: Option<String>,
        html_url: String,
        author: ApiUser,
        assets: Vec<serde_json::Value>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    let releases: Vec<ApiRelease> = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse releases: {}", e)))?;

    Ok(releases
        .into_iter()
        .map(|r| ReleaseSummary {
            id: r.id,
            tag_name: r.tag_name,
            name: r.name,
            body: r.body,
            draft: r.draft,
            prerelease: r.prerelease,
            created_at: r.created_at,
            published_at: r.published_at,
            html_url: r.html_url,
            author: GitHubUser {
                login: r.author.login,
                id: r.author.id,
                avatar_url: r.author.avatar_url,
                name: r.author.name,
                email: r.author.email,
            },
            assets_count: r.assets.len(),
        })
        .collect())
}

/// Get release by tag
#[command]
pub async fn get_release_by_tag(
    owner: String,
    repo: String,
    tag: String,
) -> Result<ReleaseSummary> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/releases/tags/{}",
            GITHUB_API_BASE, owner, repo, tag
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to fetch release: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiRelease {
        id: u64,
        tag_name: String,
        name: Option<String>,
        body: Option<String>,
        draft: bool,
        prerelease: bool,
        created_at: String,
        published_at: Option<String>,
        html_url: String,
        author: ApiUser,
        assets: Vec<serde_json::Value>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    let release: ApiRelease = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse release: {}", e)))?;

    Ok(ReleaseSummary {
        id: release.id,
        tag_name: release.tag_name,
        name: release.name,
        body: release.body,
        draft: release.draft,
        prerelease: release.prerelease,
        created_at: release.created_at,
        published_at: release.published_at,
        html_url: release.html_url,
        author: GitHubUser {
            login: release.author.login,
            id: release.author.id,
            avatar_url: release.author.avatar_url,
            name: release.author.name,
            email: release.author.email,
        },
        assets_count: release.assets.len(),
    })
}

/// Get latest release
#[command]
pub async fn get_latest_release(owner: String, repo: String) -> Result<ReleaseSummary> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "{}/repos/{}/{}/releases/latest",
            GITHUB_API_BASE, owner, repo
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch latest release: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiRelease {
        id: u64,
        tag_name: String,
        name: Option<String>,
        body: Option<String>,
        draft: bool,
        prerelease: bool,
        created_at: String,
        published_at: Option<String>,
        html_url: String,
        author: ApiUser,
        assets: Vec<serde_json::Value>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    let release: ApiRelease = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse latest release: {}", e))
    })?;

    Ok(ReleaseSummary {
        id: release.id,
        tag_name: release.tag_name,
        name: release.name,
        body: release.body,
        draft: release.draft,
        prerelease: release.prerelease,
        created_at: release.created_at,
        published_at: release.published_at,
        html_url: release.html_url,
        author: GitHubUser {
            login: release.author.login,
            id: release.author.id,
            avatar_url: release.author.avatar_url,
            name: release.author.name,
            email: release.author.email,
        },
        assets_count: release.assets.len(),
    })
}

/// Create a new release
#[command]
pub async fn create_release(
    owner: String,
    repo: String,
    input: CreateReleaseInput,
) -> Result<ReleaseSummary> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    #[derive(Serialize)]
    struct CreateReleaseBody {
        tag_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_commitish: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        body: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        draft: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        prerelease: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        generate_release_notes: Option<bool>,
    }

    let body = CreateReleaseBody {
        tag_name: input.tag_name,
        target_commitish: input.target_commitish,
        name: input.name,
        body: input.body,
        draft: input.draft,
        prerelease: input.prerelease,
        generate_release_notes: input.generate_release_notes,
    };

    let client = reqwest::Client::new();
    let response = client
        .post(format!(
            "{}/repos/{}/{}/releases",
            GITHUB_API_BASE, owner, repo
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&body)
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to create release: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiRelease {
        id: u64,
        tag_name: String,
        name: Option<String>,
        body: Option<String>,
        draft: bool,
        prerelease: bool,
        created_at: String,
        published_at: Option<String>,
        html_url: String,
        author: ApiUser,
        assets: Vec<serde_json::Value>,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        login: String,
        id: u64,
        avatar_url: String,
        name: Option<String>,
        email: Option<String>,
    }

    let release: ApiRelease = response
        .json()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to parse release: {}", e)))?;

    Ok(ReleaseSummary {
        id: release.id,
        tag_name: release.tag_name,
        name: release.name,
        body: release.body,
        draft: release.draft,
        prerelease: release.prerelease,
        created_at: release.created_at,
        published_at: release.published_at,
        html_url: release.html_url,
        author: GitHubUser {
            login: release.author.login,
            id: release.author.id,
            avatar_url: release.author.avatar_url,
            name: release.author.name,
            email: release.author.email,
        },
        assets_count: release.assets.len(),
    })
}

/// Delete a release
#[command]
pub async fn delete_release(owner: String, repo: String, release_id: u64) -> Result<()> {
    let token = get_github_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("GitHub token not configured".to_string())
    })?;

    let client = reqwest::Client::new();
    let response = client
        .delete(format!(
            "{}/repos/{}/{}/releases/{}",
            GITHUB_API_BASE, owner, repo, release_id
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Leviathan-Git-Client")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to delete release: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Helper to set up a temporary token file for testing
    fn setup_test_token_dir() -> (tempfile::TempDir, PathBuf) {
        let temp_dir = tempdir().expect("Failed to create temp dir");
        let token_path = temp_dir.path().join("github-token");
        (temp_dir, token_path)
    }

    // ========================================================================
    // Token Storage Tests
    // ========================================================================

    #[test]
    fn test_token_file_write_and_read() {
        let (_temp_dir, token_path) = setup_test_token_dir();
        let test_token = "ghp_test1234567890abcdef";

        // Write token
        fs::write(&token_path, test_token).expect("Failed to write token");

        // Read token back
        let read_token = fs::read_to_string(&token_path).expect("Failed to read token");
        assert_eq!(read_token.trim(), test_token);
    }

    #[test]
    fn test_token_file_delete() {
        let (_temp_dir, token_path) = setup_test_token_dir();
        let test_token = "ghp_test1234567890abcdef";

        // Write token
        fs::write(&token_path, test_token).expect("Failed to write token");
        assert!(token_path.exists());

        // Delete token
        fs::remove_file(&token_path).expect("Failed to delete token");
        assert!(!token_path.exists());
    }

    #[test]
    fn test_token_file_not_found_returns_none() {
        let (_temp_dir, token_path) = setup_test_token_dir();

        // File doesn't exist
        assert!(!token_path.exists());
    }

    #[test]
    fn test_empty_token_file() {
        let (_temp_dir, token_path) = setup_test_token_dir();

        // Write empty token
        fs::write(&token_path, "").expect("Failed to write empty token");

        let read_token = fs::read_to_string(&token_path).expect("Failed to read token");
        assert!(read_token.trim().is_empty());
    }

    #[test]
    fn test_token_with_whitespace_trimmed() {
        let (_temp_dir, token_path) = setup_test_token_dir();
        let test_token = "  ghp_test1234567890abcdef  \n";

        fs::write(&token_path, test_token).expect("Failed to write token");

        let read_token = fs::read_to_string(&token_path).expect("Failed to read token");
        assert_eq!(read_token.trim(), "ghp_test1234567890abcdef");
    }

    // ========================================================================
    // GitHubUser Parsing Tests
    // ========================================================================

    #[test]
    fn test_parse_github_user_full() {
        let json = r#"{
            "login": "octocat",
            "id": 12345,
            "avatar_url": "https://avatars.githubusercontent.com/u/12345",
            "name": "The Octocat",
            "email": "octocat@github.com"
        }"#;

        let user: GitHubUser = serde_json::from_str(json).expect("Failed to parse user");

        assert_eq!(user.login, "octocat");
        assert_eq!(user.id, 12345);
        assert_eq!(
            user.avatar_url,
            "https://avatars.githubusercontent.com/u/12345"
        );
        assert_eq!(user.name, Some("The Octocat".to_string()));
        assert_eq!(user.email, Some("octocat@github.com".to_string()));
    }

    #[test]
    fn test_parse_github_user_minimal() {
        let json = r#"{
            "login": "octocat",
            "id": 12345,
            "avatar_url": "https://avatars.githubusercontent.com/u/12345"
        }"#;

        let user: GitHubUser = serde_json::from_str(json).expect("Failed to parse user");

        assert_eq!(user.login, "octocat");
        assert_eq!(user.id, 12345);
        assert_eq!(
            user.avatar_url,
            "https://avatars.githubusercontent.com/u/12345"
        );
        assert_eq!(user.name, None);
        assert_eq!(user.email, None);
    }

    #[test]
    fn test_parse_github_user_null_optionals() {
        let json = r#"{
            "login": "octocat",
            "id": 12345,
            "avatar_url": "https://avatars.githubusercontent.com/u/12345",
            "name": null,
            "email": null
        }"#;

        let user: GitHubUser = serde_json::from_str(json).expect("Failed to parse user");

        assert_eq!(user.login, "octocat");
        assert_eq!(user.name, None);
        assert_eq!(user.email, None);
    }

    #[test]
    fn test_github_user_serializes_avatar_url_as_camel_case() {
        let user = GitHubUser {
            login: "octocat".to_string(),
            id: 12345,
            avatar_url: "https://example.com/avatar.png".to_string(),
            name: Some("Test User".to_string()),
            email: None,
        };

        let json = serde_json::to_string(&user).expect("Failed to serialize user");

        // Should serialize as avatarUrl for frontend
        assert!(json.contains("avatarUrl"));
        assert!(!json.contains("avatar_url"));
    }

    // ========================================================================
    // GitHubConnectionStatus Tests
    // ========================================================================

    #[test]
    fn test_connection_status_connected() {
        let status = GitHubConnectionStatus {
            connected: true,
            user: Some(GitHubUser {
                login: "octocat".to_string(),
                id: 12345,
                avatar_url: "https://example.com/avatar.png".to_string(),
                name: Some("The Octocat".to_string()),
                email: None,
            }),
            scopes: vec!["repo".to_string(), "read:user".to_string()],
        };

        assert!(status.connected);
        assert!(status.user.is_some());
        assert_eq!(status.scopes.len(), 2);
    }

    #[test]
    fn test_connection_status_disconnected() {
        let status = GitHubConnectionStatus {
            connected: false,
            user: None,
            scopes: vec![],
        };

        assert!(!status.connected);
        assert!(status.user.is_none());
        assert!(status.scopes.is_empty());
    }

    // ========================================================================
    // GitHub URL Parsing Tests
    // ========================================================================

    #[test]
    fn test_parse_github_url_https() {
        let result = parse_github_url("https://github.com/owner/repo.git");
        assert!(result.is_some());
        let (owner, repo) = result.unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_github_url_https_no_git_suffix() {
        let result = parse_github_url("https://github.com/owner/repo");
        assert!(result.is_some());
        let (owner, repo) = result.unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_github_url_ssh() {
        let result = parse_github_url("git@github.com:owner/repo.git");
        assert!(result.is_some());
        let (owner, repo) = result.unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_github_url_ssh_no_git_suffix() {
        let result = parse_github_url("git@github.com:owner/repo");
        assert!(result.is_some());
        let (owner, repo) = result.unwrap();
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_github_url_not_github() {
        let result = parse_github_url("https://gitlab.com/owner/repo.git");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_github_url_invalid() {
        let result = parse_github_url("not-a-valid-url");
        assert!(result.is_none());
    }
}
