//! Azure DevOps Integration Commands
//!
//! Provides integration with Azure DevOps for pull requests, work items, and pipelines.

use crate::error::{LeviathanError, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use tauri::command;

const AZURE_DEVOPS_API_VERSION: &str = "7.1";

// ============================================================================
// Token Management
// ============================================================================

const ADO_SERVICE: &str = "leviathan-azure-devops";
const ADO_ACCOUNT: &str = "pat";

/// Store Azure DevOps PAT in system keyring
#[command]
pub async fn store_ado_token(token: String) -> Result<()> {
    let entry = keyring::Entry::new(ADO_SERVICE, ADO_ACCOUNT)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to access keyring: {}", e)))?;

    entry
        .set_password(&token)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to store token: {}", e)))?;

    Ok(())
}

/// Get Azure DevOps PAT from system keyring
#[command]
pub async fn get_ado_token() -> Result<Option<String>> {
    let entry = keyring::Entry::new(ADO_SERVICE, ADO_ACCOUNT)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to access keyring: {}", e)))?;

    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(LeviathanError::OperationFailed(format!(
            "Failed to retrieve token: {}",
            e
        ))),
    }
}

/// Delete Azure DevOps PAT from system keyring
#[command]
pub async fn delete_ado_token() -> Result<()> {
    let entry = keyring::Entry::new(ADO_SERVICE, ADO_ACCOUNT)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to access keyring: {}", e)))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(LeviathanError::OperationFailed(format!(
            "Failed to delete token: {}",
            e
        ))),
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
pub async fn check_ado_connection(organization: String) -> Result<AdoConnectionStatus> {
    let token = match get_ado_token().await? {
        Some(t) => t,
        None => {
            return Ok(AdoConnectionStatus {
                connected: false,
                user: None,
                organization: None,
            })
        }
    };

    let client = reqwest::Client::new();

    // Get the current user's profile
    let response = client
        .get(format!(
            "https://dev.azure.com/{}/_apis/connectionData?api-version={}",
            organization, AZURE_DEVOPS_API_VERSION
        ))
        .header("Authorization", get_auth_header(&token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to check connection: {}", e))
        })?;

    if !response.status().is_success() {
        return Ok(AdoConnectionStatus {
            connected: false,
            user: None,
            organization: None,
        });
    }

    #[derive(Deserialize)]
    struct ConnectionData {
        #[serde(rename = "authenticatedUser")]
        authenticated_user: AuthenticatedUser,
    }

    #[derive(Deserialize)]
    struct AuthenticatedUser {
        id: String,
        #[serde(rename = "providerDisplayName")]
        provider_display_name: String,
        #[serde(rename = "customDisplayName")]
        custom_display_name: Option<String>,
    }

    let data: ConnectionData = response.json().await.map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse connection data: {}", e))
    })?;

    Ok(AdoConnectionStatus {
        connected: true,
        user: Some(AdoUser {
            id: data.authenticated_user.id,
            display_name: data
                .authenticated_user
                .custom_display_name
                .unwrap_or(data.authenticated_user.provider_display_name.clone()),
            unique_name: data.authenticated_user.provider_display_name,
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
) -> Result<AdoPullRequest> {
    let token = get_ado_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("Azure DevOps token not configured".to_string())
    })?;

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
        url: String,
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
    } else if url.starts_with("git@ssh.dev.azure.com:v3/") {
        // SSH format: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
        let path = url.trim_start_matches("git@ssh.dev.azure.com:v3/");
        let parts: Vec<&str> = path.split('/').collect();
        if parts.len() >= 3 {
            let org = parts[0].to_string();
            let project = parts[1].to_string();
            let repo = parts[2].trim_end_matches(".git").to_string();
            return Some((org, project, repo));
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
) -> Result<Vec<AdoPullRequest>> {
    let token = get_ado_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("Azure DevOps token not configured".to_string())
    })?;

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
        url: String,
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
) -> Result<AdoPullRequest> {
    let token = get_ado_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("Azure DevOps token not configured".to_string())
    })?;

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
        url: String,
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
) -> Result<Vec<AdoWorkItem>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let token = get_ado_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("Azure DevOps token not configured".to_string())
    })?;

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
        url: String,
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
) -> Result<Vec<AdoWorkItem>> {
    let token = get_ado_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("Azure DevOps token not configured".to_string())
    })?;

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

    get_ado_work_items(organization, project, ids).await
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
) -> Result<Vec<AdoPipelineRun>> {
    let token = get_ado_token().await?.ok_or_else(|| {
        LeviathanError::OperationFailed("Azure DevOps token not configured".to_string())
    })?;

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
