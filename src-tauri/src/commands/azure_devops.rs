//! Azure DevOps Integration Commands
//!
//! Provides integration with Azure DevOps for pull requests, work items, and pipelines.

use crate::error::{LeviathanError, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use tauri::command;
use tracing::{debug, error, info};

const AZURE_DEVOPS_API_VERSION: &str = "7.1";

/// Helper to resolve token from parameter
/// Returns an error if no token is provided
fn resolve_ado_token(token: Option<String>) -> Result<String> {
    match token {
        Some(t) if !t.is_empty() => Ok(t),
        _ => Err(LeviathanError::OperationFailed(
            "Azure DevOps token not configured".to_string(),
        )),
    }
}

// ============================================================================
// Types
// ============================================================================

/// Azure DevOps user info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoUser {
    pub id: String,
    pub display_name: String,
    pub unique_name: String,
    pub image_url: Option<String>,
}

/// Azure DevOps connection status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoConnectionStatus {
    pub connected: bool,
    pub user: Option<AdoUser>,
    pub organization: Option<String>,
}

/// Detected Azure DevOps repository info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedAdoRepo {
    pub organization: String,
    pub project: String,
    pub repository: String,
    pub remote_name: String,
}

/// Pull request summary
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoPullRequest {
    pub pull_request_id: u32,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub created_by: AdoUser,
    pub creation_date: String,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub is_draft: bool,
    pub url: String,
    pub repository_id: String,
}

/// Create pull request input
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAdoPullRequestInput {
    pub title: String,
    pub description: Option<String>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub is_draft: Option<bool>,
}

/// Work item summary
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoWorkItem {
    pub id: u32,
    pub title: String,
    pub work_item_type: String,
    pub state: String,
    pub assigned_to: Option<AdoUser>,
    pub created_date: String,
    pub url: String,
}

/// Pipeline run summary
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoPipelineRun {
    pub id: u32,
    pub name: String,
    pub state: String,
    pub result: Option<String>,
    pub created_date: String,
    pub finished_date: Option<String>,
    pub source_branch: String,
    pub url: String,
}

// ============================================================================
// Helper Functions
// ============================================================================

fn get_auth_header(token: &str) -> String {
    // Azure DevOps uses Basic auth with empty username and PAT as password
    let credentials = format!(":{}", token);
    format!("Basic {}", BASE64.encode(credentials.as_bytes()))
}

fn build_api_url(organization: &str, project: &str, path: &str) -> String {
    format!(
        "https://dev.azure.com/{}/{}/_apis/{}?api-version={}",
        organization, project, path, AZURE_DEVOPS_API_VERSION
    )
}

fn build_api_url_with_params(
    organization: &str,
    project: &str,
    path: &str,
    params: &str,
) -> String {
    format!(
        "https://dev.azure.com/{}/{}/_apis/{}?api-version={}&{}",
        organization, project, path, AZURE_DEVOPS_API_VERSION, params
    )
}

// ============================================================================
// Connection Commands
// ============================================================================

/// Check Azure DevOps connection status
#[command]
pub async fn check_ado_connection(
    organization: String,
    token: Option<String>,
) -> Result<AdoConnectionStatus> {
    debug!("Checking Azure DevOps connection for org: {}", organization);

    // Use provided token - no fallback to file storage
    let token = match token {
        Some(t) if !t.is_empty() => {
            debug!("Using provided token (length: {})", t.len());
            t
        }
        _ => {
            debug!("No Azure DevOps token provided");
            return Ok(AdoConnectionStatus {
                connected: false,
                user: None,
                organization: Some(organization),
            });
        }
    };

    let client = reqwest::Client::new();

    // Use the profile endpoint to verify connection and get user info
    let url = format!(
        "https://vssps.dev.azure.com/{}/_apis/profile/profiles/me?api-version={}",
        organization, AZURE_DEVOPS_API_VERSION
    );
    debug!("Requesting: {}", url);

    let response = client
        .get(&url)
        .header("Authorization", get_auth_header(&token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            error!("HTTP request failed: {}", e);
            LeviathanError::OperationFailed(format!("Failed to check connection: {}", e))
        })?;

    debug!("Response status: {}", response.status());

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let error_msg = if body.is_empty() {
            match status.as_u16() {
                401 => "Invalid or expired token. Please check your PAT.".to_string(),
                403 => "Access denied. Ensure your PAT has the required scopes.".to_string(),
                404 => "Organization not found. Please check the organization name.".to_string(),
                _ => "Unknown error".to_string(),
            }
        } else {
            body.clone()
        };
        error!(
            "Azure DevOps API error: status={}, body={}",
            status,
            if body.is_empty() { "<empty>" } else { &body }
        );
        return Err(LeviathanError::OperationFailed(format!(
            "Azure DevOps connection failed ({}): {}",
            status, error_msg
        )));
    }

    #[derive(Deserialize)]
    struct ProfileData {
        id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "emailAddress")]
        email_address: Option<String>,
    }

    let data: ProfileData = response.json().await.map_err(|e| {
        error!("Failed to parse profile data: {}", e);
        LeviathanError::OperationFailed(format!("Failed to parse profile data: {}", e))
    })?;

    info!(
        "Successfully connected to Azure DevOps as: {}",
        data.display_name
    );

    Ok(AdoConnectionStatus {
        connected: true,
        user: Some(AdoUser {
            id: data.id.clone(),
            display_name: data.display_name.clone(),
            unique_name: data
                .email_address
                .unwrap_or_else(|| data.display_name.clone()),
            image_url: None,
        }),
        organization: Some(organization),
    })
}

/// Detect Azure DevOps repository from git remotes
#[command]
pub async fn detect_ado_repo(path: String) -> Result<Option<DetectedAdoRepo>> {
    let repo = git2::Repository::open(&path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to open repository: {}", e))
    })?;

    let remotes = repo
        .remotes()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to get remotes: {}", e)))?;

    for remote_name in remotes.iter().flatten() {
        if let Ok(remote) = repo.find_remote(remote_name) {
            if let Some(url) = remote.url() {
                if let Some(repo_info) = parse_ado_url(url) {
                    return Ok(Some(DetectedAdoRepo {
                        organization: repo_info.0,
                        project: repo_info.1,
                        repository: repo_info.2,
                        remote_name: remote_name.to_string(),
                    }));
                }
            }
        }
    }

    Ok(None)
}

/// Get a single pull request by ID
#[command]
pub async fn get_ado_pull_request(
    organization: String,
    project: String,
    repository: String,
    pull_request_id: u32,
    token: Option<String>,
) -> Result<AdoPullRequest> {
    let token = resolve_ado_token(token)?;

    let url = build_api_url(
        &organization,
        &project,
        &format!(
            "git/repositories/{}/pullrequests/{}",
            repository, pull_request_id
        ),
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", get_auth_header(&token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch pull request: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "Azure DevOps API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiPullRequest {
        #[serde(rename = "pullRequestId")]
        pull_request_id: u32,
        title: String,
        description: Option<String>,
        status: String,
        #[serde(rename = "createdBy")]
        created_by: ApiUser,
        #[serde(rename = "creationDate")]
        creation_date: String,
        #[serde(rename = "sourceRefName")]
        source_ref_name: String,
        #[serde(rename = "targetRefName")]
        target_ref_name: String,
        #[serde(rename = "isDraft")]
        is_draft: Option<bool>,
        repository: ApiRepository,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "uniqueName")]
        unique_name: String,
        #[serde(rename = "imageUrl")]
        image_url: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiRepository {
        id: String,
    }

    let pr: ApiPullRequest = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse pull request: {}", e))
    })?;

    Ok(AdoPullRequest {
        pull_request_id: pr.pull_request_id,
        title: pr.title,
        description: pr.description,
        status: pr.status,
        created_by: AdoUser {
            id: pr.created_by.id,
            display_name: pr.created_by.display_name,
            unique_name: pr.created_by.unique_name,
            image_url: pr.created_by.image_url,
        },
        creation_date: pr.creation_date,
        source_ref_name: pr.source_ref_name.replace("refs/heads/", ""),
        target_ref_name: pr.target_ref_name.replace("refs/heads/", ""),
        is_draft: pr.is_draft.unwrap_or(false),
        url: format!(
            "https://dev.azure.com/{}/{}/_git/{}/pullrequest/{}",
            organization, project, repository, pr.pull_request_id
        ),
        repository_id: pr.repository.id,
    })
}

fn parse_ado_url(url: &str) -> Option<(String, String, String)> {
    // Azure DevOps URLs can be in multiple formats:
    // https://dev.azure.com/{org}/{project}/_git/{repo}
    // https://{org}@dev.azure.com/{org}/{project}/_git/{repo}
    // https://{org}.visualstudio.com/{project}/_git/{repo}
    // git@ssh.dev.azure.com:v3/{org}/{project}/{repo}

    // Check SSH format first (before HTTPS check since it also contains dev.azure.com)
    if url.starts_with("git@ssh.dev.azure.com:v3/") {
        let path = url.trim_start_matches("git@ssh.dev.azure.com:v3/");
        let parts: Vec<&str> = path.split('/').collect();
        if parts.len() >= 3 {
            let org = parts[0].to_string();
            let project = parts[1].to_string();
            let repo = parts[2].trim_end_matches(".git").to_string();
            return Some((org, project, repo));
        }
    }

    if url.contains("dev.azure.com") || url.contains("visualstudio.com") {
        // HTTPS format
        let url = url
            .trim_start_matches("https://")
            .trim_start_matches("http://");

        // Remove username@ prefix if present
        let url = if let Some(at_pos) = url.find('@') {
            &url[at_pos + 1..]
        } else {
            url
        };

        // dev.azure.com/{org}/{project}/_git/{repo}
        if url.starts_with("dev.azure.com/") {
            let parts: Vec<&str> = url.split('/').collect();
            if parts.len() >= 5 && parts[3] == "_git" {
                let org = parts[1].to_string();
                let project = parts[2].to_string();
                let repo = parts[4].trim_end_matches(".git").to_string();
                return Some((org, project, repo));
            }
        }

        // {org}.visualstudio.com/{project}/_git/{repo}
        if url.contains(".visualstudio.com/") {
            let parts: Vec<&str> = url.split('/').collect();
            if parts.len() >= 4 && parts[2] == "_git" {
                let org = parts[0].split('.').next().unwrap_or("").to_string();
                let project = parts[1].to_string();
                let repo = parts[3].trim_end_matches(".git").to_string();
                return Some((org, project, repo));
            }
        }
    }

    None
}

// ============================================================================
// Pull Request Commands
// ============================================================================

/// List pull requests for a repository
#[command]
pub async fn list_ado_pull_requests(
    organization: String,
    project: String,
    repository: String,
    status: Option<String>,
    token: Option<String>,
) -> Result<Vec<AdoPullRequest>> {
    let token = resolve_ado_token(token)?;

    let status_param = status.unwrap_or_else(|| "active".to_string());
    let url = build_api_url_with_params(
        &organization,
        &project,
        &format!("git/repositories/{}/pullrequests", repository),
        &format!("searchCriteria.status={}", status_param),
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", get_auth_header(&token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch pull requests: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "Azure DevOps API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiResponse {
        value: Vec<ApiPullRequest>,
    }

    #[derive(Deserialize)]
    struct ApiPullRequest {
        #[serde(rename = "pullRequestId")]
        pull_request_id: u32,
        title: String,
        description: Option<String>,
        status: String,
        #[serde(rename = "createdBy")]
        created_by: ApiUser,
        #[serde(rename = "creationDate")]
        creation_date: String,
        #[serde(rename = "sourceRefName")]
        source_ref_name: String,
        #[serde(rename = "targetRefName")]
        target_ref_name: String,
        #[serde(rename = "isDraft")]
        is_draft: Option<bool>,
        repository: ApiRepository,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "uniqueName")]
        unique_name: String,
        #[serde(rename = "imageUrl")]
        image_url: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiRepository {
        id: String,
    }

    let data: ApiResponse = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse pull requests: {}", e))
    })?;

    Ok(data
        .value
        .into_iter()
        .map(|pr| AdoPullRequest {
            pull_request_id: pr.pull_request_id,
            title: pr.title,
            description: pr.description,
            status: pr.status,
            created_by: AdoUser {
                id: pr.created_by.id,
                display_name: pr.created_by.display_name,
                unique_name: pr.created_by.unique_name,
                image_url: pr.created_by.image_url,
            },
            creation_date: pr.creation_date,
            source_ref_name: pr.source_ref_name.replace("refs/heads/", ""),
            target_ref_name: pr.target_ref_name.replace("refs/heads/", ""),
            is_draft: pr.is_draft.unwrap_or(false),
            url: format!(
                "https://dev.azure.com/{}/{}/_git/{}/pullrequest/{}",
                organization, project, repository, pr.pull_request_id
            ),
            repository_id: pr.repository.id,
        })
        .collect())
}

/// Create a pull request
#[command]
pub async fn create_ado_pull_request(
    organization: String,
    project: String,
    repository: String,
    input: CreateAdoPullRequestInput,
    token: Option<String>,
) -> Result<AdoPullRequest> {
    let token = resolve_ado_token(token)?;

    let url = build_api_url(
        &organization,
        &project,
        &format!("git/repositories/{}/pullrequests", repository),
    );

    #[derive(Serialize)]
    struct CreatePrBody {
        #[serde(rename = "sourceRefName")]
        source_ref_name: String,
        #[serde(rename = "targetRefName")]
        target_ref_name: String,
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(rename = "isDraft", skip_serializing_if = "Option::is_none")]
        is_draft: Option<bool>,
    }

    let body = CreatePrBody {
        source_ref_name: format!("refs/heads/{}", input.source_ref_name),
        target_ref_name: format!("refs/heads/{}", input.target_ref_name),
        title: input.title,
        description: input.description,
        is_draft: input.is_draft,
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", get_auth_header(&token))
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
            "Azure DevOps API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiPullRequest {
        #[serde(rename = "pullRequestId")]
        pull_request_id: u32,
        title: String,
        description: Option<String>,
        status: String,
        #[serde(rename = "createdBy")]
        created_by: ApiUser,
        #[serde(rename = "creationDate")]
        creation_date: String,
        #[serde(rename = "sourceRefName")]
        source_ref_name: String,
        #[serde(rename = "targetRefName")]
        target_ref_name: String,
        #[serde(rename = "isDraft")]
        is_draft: Option<bool>,
        repository: ApiRepository,
    }

    #[derive(Deserialize)]
    struct ApiUser {
        id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "uniqueName")]
        unique_name: String,
        #[serde(rename = "imageUrl")]
        image_url: Option<String>,
    }

    #[derive(Deserialize)]
    struct ApiRepository {
        id: String,
    }

    let pr: ApiPullRequest = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse pull request: {}", e))
    })?;

    Ok(AdoPullRequest {
        pull_request_id: pr.pull_request_id,
        title: pr.title,
        description: pr.description,
        status: pr.status,
        created_by: AdoUser {
            id: pr.created_by.id,
            display_name: pr.created_by.display_name,
            unique_name: pr.created_by.unique_name,
            image_url: pr.created_by.image_url,
        },
        creation_date: pr.creation_date,
        source_ref_name: pr.source_ref_name.replace("refs/heads/", ""),
        target_ref_name: pr.target_ref_name.replace("refs/heads/", ""),
        is_draft: pr.is_draft.unwrap_or(false),
        url: format!(
            "https://dev.azure.com/{}/{}/_git/{}/pullrequest/{}",
            organization, project, repository, pr.pull_request_id
        ),
        repository_id: pr.repository.id,
    })
}

// ============================================================================
// Work Item Commands
// ============================================================================

/// Get work items by IDs
#[command]
pub async fn get_ado_work_items(
    organization: String,
    project: String,
    ids: Vec<u32>,
    token: Option<String>,
) -> Result<Vec<AdoWorkItem>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let token = resolve_ado_token(token)?;

    let ids_str = ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let url = build_api_url_with_params(
        &organization,
        &project,
        "wit/workitems",
        &format!("ids={}&fields=System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo,System.CreatedDate", ids_str),
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", get_auth_header(&token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch work items: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "Azure DevOps API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiResponse {
        value: Vec<ApiWorkItem>,
    }

    #[derive(Deserialize)]
    struct ApiWorkItem {
        id: u32,
        fields: ApiFields,
    }

    #[derive(Deserialize)]
    struct ApiFields {
        #[serde(rename = "System.Title")]
        title: String,
        #[serde(rename = "System.WorkItemType")]
        work_item_type: String,
        #[serde(rename = "System.State")]
        state: String,
        #[serde(rename = "System.AssignedTo")]
        assigned_to: Option<ApiIdentity>,
        #[serde(rename = "System.CreatedDate")]
        created_date: String,
    }

    #[derive(Deserialize)]
    struct ApiIdentity {
        id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "uniqueName")]
        unique_name: String,
        #[serde(rename = "imageUrl")]
        image_url: Option<String>,
    }

    let data: ApiResponse = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse work items: {}", e))
    })?;

    Ok(data
        .value
        .into_iter()
        .map(|wi| AdoWorkItem {
            id: wi.id,
            title: wi.fields.title,
            work_item_type: wi.fields.work_item_type,
            state: wi.fields.state,
            assigned_to: wi.fields.assigned_to.map(|u| AdoUser {
                id: u.id,
                display_name: u.display_name,
                unique_name: u.unique_name,
                image_url: u.image_url,
            }),
            created_date: wi.fields.created_date,
            url: format!(
                "https://dev.azure.com/{}/_workitems/edit/{}",
                organization, wi.id
            ),
        })
        .collect())
}

/// Query work items assigned to current user
#[command]
pub async fn query_ado_work_items(
    organization: String,
    project: String,
    state: Option<String>,
    token: Option<String>,
) -> Result<Vec<AdoWorkItem>> {
    let token = resolve_ado_token(token)?;

    let state_clause = state
        .map(|s| format!(" AND [System.State] = '{}'", s))
        .unwrap_or_default();

    let wiql = format!(
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project{} ORDER BY [System.CreatedDate] DESC",
        state_clause
    );

    let url = build_api_url(&organization, &project, "wit/wiql");

    #[derive(Serialize)]
    struct WiqlQuery {
        query: String,
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", get_auth_header(&token))
        .header("Content-Type", "application/json")
        .json(&WiqlQuery { query: wiql })
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to query work items: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "Azure DevOps API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct WiqlResponse {
        #[serde(rename = "workItems")]
        work_items: Vec<WorkItemRef>,
    }

    #[derive(Deserialize)]
    struct WorkItemRef {
        id: u32,
    }

    let data: WiqlResponse = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse WIQL response: {}", e))
    })?;

    // Get first 50 work items
    let ids: Vec<u32> = data.work_items.into_iter().take(50).map(|w| w.id).collect();

    if ids.is_empty() {
        return Ok(vec![]);
    }

    get_ado_work_items(organization, project, ids, Some(token)).await
}

// ============================================================================
// Pipeline Commands
// ============================================================================

/// List pipeline runs
#[command]
pub async fn list_ado_pipeline_runs(
    organization: String,
    project: String,
    top: Option<u32>,
    token: Option<String>,
) -> Result<Vec<AdoPipelineRun>> {
    let token = resolve_ado_token(token)?;

    let top = top.unwrap_or(20);
    let url = build_api_url_with_params(
        &organization,
        &project,
        "build/builds",
        &format!("$top={}&queryOrder=queueTimeDescending", top),
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", get_auth_header(&token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to fetch pipeline runs: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(LeviathanError::OperationFailed(format!(
            "Azure DevOps API error {}: {}",
            status, body
        )));
    }

    #[derive(Deserialize)]
    struct ApiResponse {
        value: Vec<ApiBuild>,
    }

    #[derive(Deserialize)]
    struct ApiBuild {
        id: u32,
        #[serde(rename = "buildNumber")]
        build_number: String,
        status: String,
        result: Option<String>,
        #[serde(rename = "queueTime")]
        queue_time: String,
        #[serde(rename = "finishTime")]
        finish_time: Option<String>,
        #[serde(rename = "sourceBranch")]
        source_branch: String,
        #[serde(rename = "_links")]
        links: ApiLinks,
        definition: ApiDefinition,
    }

    #[derive(Deserialize)]
    struct ApiLinks {
        web: ApiLink,
    }

    #[derive(Deserialize)]
    struct ApiLink {
        href: String,
    }

    #[derive(Deserialize)]
    struct ApiDefinition {
        name: String,
    }

    let data: ApiResponse = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse pipeline runs: {}", e))
    })?;

    Ok(data
        .value
        .into_iter()
        .map(|b| AdoPipelineRun {
            id: b.id,
            name: format!("{} #{}", b.definition.name, b.build_number),
            state: b.status,
            result: b.result,
            created_date: b.queue_time,
            finished_date: b.finish_time,
            source_branch: b.source_branch.replace("refs/heads/", ""),
            url: b.links.web.href,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ado_url_https_standard() {
        let url = "https://dev.azure.com/mycompany/MyProject/_git/frontend";
        let result = parse_ado_url(url);

        assert!(result.is_some());
        let (org, project, repo) = result.unwrap();
        assert_eq!(org, "mycompany");
        assert_eq!(project, "MyProject");
        assert_eq!(repo, "frontend");
    }

    #[test]
    fn test_parse_ado_url_https_with_username() {
        let url = "https://mycompany@dev.azure.com/mycompany/MyProject/_git/backend";
        let result = parse_ado_url(url);

        assert!(result.is_some());
        let (org, project, repo) = result.unwrap();
        assert_eq!(org, "mycompany");
        assert_eq!(project, "MyProject");
        assert_eq!(repo, "backend");
    }

    #[test]
    fn test_parse_ado_url_https_with_git_suffix() {
        let url = "https://dev.azure.com/mycompany/MyProject/_git/repo.git";
        let result = parse_ado_url(url);

        assert!(result.is_some());
        let (_, _, repo) = result.unwrap();
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_ado_url_visualstudio() {
        let url = "https://mycompany.visualstudio.com/MyProject/_git/repo";
        let result = parse_ado_url(url);

        assert!(result.is_some());
        let (org, project, repo) = result.unwrap();
        assert_eq!(org, "mycompany");
        assert_eq!(project, "MyProject");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_ado_url_ssh() {
        let url = "git@ssh.dev.azure.com:v3/mycompany/MyProject/repo";
        let result = parse_ado_url(url);

        assert!(result.is_some());
        let (org, project, repo) = result.unwrap();
        assert_eq!(org, "mycompany");
        assert_eq!(project, "MyProject");
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_ado_url_ssh_with_git_suffix() {
        let url = "git@ssh.dev.azure.com:v3/mycompany/MyProject/repo.git";
        let result = parse_ado_url(url);

        assert!(result.is_some());
        let (_, _, repo) = result.unwrap();
        assert_eq!(repo, "repo");
    }

    #[test]
    fn test_parse_ado_url_github_returns_none() {
        let url = "https://github.com/user/repo";
        let result = parse_ado_url(url);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_ado_url_gitlab_returns_none() {
        let url = "https://gitlab.com/user/repo";
        let result = parse_ado_url(url);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_ado_url_malformed_returns_none() {
        let url = "https://dev.azure.com/org/project";
        let result = parse_ado_url(url);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_ado_url_empty_returns_none() {
        let url = "";
        let result = parse_ado_url(url);
        assert!(result.is_none());
    }

    #[test]
    fn test_get_auth_header() {
        let token = "myToken123";
        let header = get_auth_header(token);

        assert!(header.starts_with("Basic "));
        // Decode and verify format
        let encoded = header.trim_start_matches("Basic ");
        let decoded = String::from_utf8(base64::Engine::decode(&BASE64, encoded).unwrap()).unwrap();
        assert_eq!(decoded, ":myToken123");
    }

    #[test]
    fn test_build_api_url() {
        let url = build_api_url("myorg", "myproject", "git/repositories");

        assert!(url.contains("dev.azure.com/myorg/myproject"));
        assert!(url.contains("_apis/git/repositories"));
        assert!(url.contains("api-version=7.1"));
    }

    #[test]
    fn test_build_api_url_with_params() {
        let url = build_api_url_with_params(
            "myorg",
            "myproject",
            "git/pullrequests",
            "status=active&top=10",
        );

        assert!(url.contains("api-version=7.1"));
        assert!(url.contains("status=active"));
        assert!(url.contains("top=10"));
    }

    #[test]
    fn test_resolve_ado_token_valid() {
        let result = resolve_ado_token(Some("valid-token".to_string()));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "valid-token");
    }

    #[test]
    fn test_resolve_ado_token_empty() {
        let result = resolve_ado_token(Some("".to_string()));
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_ado_token_none() {
        let result = resolve_ado_token(None);
        assert!(result.is_err());
    }

    #[test]
    fn test_ado_user_serialization() {
        let user = AdoUser {
            id: "user-123".to_string(),
            display_name: "John Doe".to_string(),
            unique_name: "john@company.com".to_string(),
            image_url: Some("https://example.com/avatar.png".to_string()),
        };

        let json = serde_json::to_string(&user).unwrap();
        assert!(json.contains("displayName"));
        assert!(json.contains("John Doe"));
        assert!(json.contains("uniqueName"));
    }

    #[test]
    fn test_ado_connection_status_connected() {
        let status = AdoConnectionStatus {
            connected: true,
            user: Some(AdoUser {
                id: "1".to_string(),
                display_name: "User".to_string(),
                unique_name: "user@test.com".to_string(),
                image_url: None,
            }),
            organization: Some("myorg".to_string()),
        };

        assert!(status.connected);
        assert!(status.user.is_some());
    }

    #[test]
    fn test_ado_connection_status_disconnected() {
        let status = AdoConnectionStatus {
            connected: false,
            user: None,
            organization: Some("myorg".to_string()),
        };

        assert!(!status.connected);
        assert!(status.user.is_none());
    }

    #[test]
    fn test_detected_ado_repo_serialization() {
        let repo = DetectedAdoRepo {
            organization: "mycompany".to_string(),
            project: "MyProject".to_string(),
            repository: "frontend".to_string(),
            remote_name: "origin".to_string(),
        };

        let json = serde_json::to_string(&repo).unwrap();
        assert!(json.contains("organization"));
        assert!(json.contains("mycompany"));
        assert!(json.contains("remoteName"));
    }

    #[test]
    fn test_ado_pull_request_serialization() {
        let pr = AdoPullRequest {
            pull_request_id: 123,
            title: "Test PR".to_string(),
            description: Some("Description".to_string()),
            status: "active".to_string(),
            created_by: AdoUser {
                id: "1".to_string(),
                display_name: "User".to_string(),
                unique_name: "user@test.com".to_string(),
                image_url: None,
            },
            creation_date: "2024-01-15T10:00:00Z".to_string(),
            source_ref_name: "feature/test".to_string(),
            target_ref_name: "main".to_string(),
            is_draft: false,
            url: "https://dev.azure.com/org/proj/_git/repo/pullrequest/123".to_string(),
            repository_id: "repo-id".to_string(),
        };

        let json = serde_json::to_string(&pr).unwrap();
        assert!(json.contains("pullRequestId"));
        assert!(json.contains("123"));
        assert!(json.contains("sourceRefName"));
        assert!(json.contains("isDraft"));
    }

    #[test]
    fn test_create_ado_pull_request_input_serialization() {
        let input = CreateAdoPullRequestInput {
            title: "New Feature".to_string(),
            description: Some("Adds a new feature".to_string()),
            source_ref_name: "feature/new".to_string(),
            target_ref_name: "main".to_string(),
            is_draft: Some(true),
        };

        let json = serde_json::to_string(&input).unwrap();
        assert!(json.contains("title"));
        assert!(json.contains("sourceRefName"));
    }

    #[test]
    fn test_ado_work_item_serialization() {
        let work_item = AdoWorkItem {
            id: 456,
            title: "Implement feature".to_string(),
            work_item_type: "User Story".to_string(),
            state: "Active".to_string(),
            assigned_to: None,
            created_date: "2024-01-10T08:00:00Z".to_string(),
            url: "https://dev.azure.com/org/_workitems/edit/456".to_string(),
        };

        let json = serde_json::to_string(&work_item).unwrap();
        assert!(json.contains("workItemType"));
        assert!(json.contains("User Story"));
    }

    #[test]
    fn test_ado_pipeline_run_serialization() {
        let run = AdoPipelineRun {
            id: 1234,
            name: "Build #1234".to_string(),
            state: "completed".to_string(),
            result: Some("succeeded".to_string()),
            created_date: "2024-01-15T10:00:00Z".to_string(),
            finished_date: Some("2024-01-15T10:15:00Z".to_string()),
            source_branch: "main".to_string(),
            url: "https://dev.azure.com/org/proj/_build/results?buildId=1234".to_string(),
        };

        let json = serde_json::to_string(&run).unwrap();
        assert!(json.contains("sourceBranch"));
        assert!(json.contains("finishedDate"));
    }
}
