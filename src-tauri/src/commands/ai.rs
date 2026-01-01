//! AI commit message generation commands
//!
//! Provides commands for managing AI providers and generating commit messages.

use crate::error::{LeviathanError, Result};
use crate::services::ai::{AiProviderInfo, AiProviderType, AiState, GeneratedCommitMessage};
use tauri::{command, State};

/// Get list of all AI providers with their status
#[command]
pub async fn get_ai_providers(state: State<'_, AiState>) -> Result<Vec<AiProviderInfo>> {
    let service = state.read().await;
    Ok(service.get_providers_info().await)
}

/// Get the currently active AI provider
#[command]
pub async fn get_active_ai_provider(state: State<'_, AiState>) -> Result<Option<AiProviderType>> {
    let service = state.read().await;
    Ok(service.get_config().active_provider)
}

/// Set the active AI provider
#[command]
pub async fn set_ai_provider(
    state: State<'_, AiState>,
    provider_type: AiProviderType,
) -> Result<()> {
    let mut service = state.write().await;
    service
        .set_active_provider(provider_type)
        .map_err(LeviathanError::OperationFailed)
}

/// Set API key for a provider
#[command]
pub async fn set_ai_api_key(
    state: State<'_, AiState>,
    provider_type: AiProviderType,
    api_key: Option<String>,
) -> Result<()> {
    let mut service = state.write().await;
    service
        .set_api_key(provider_type, api_key)
        .map_err(LeviathanError::OperationFailed)
}

/// Set the model for a provider
#[command]
pub async fn set_ai_model(
    state: State<'_, AiState>,
    provider_type: AiProviderType,
    model: Option<String>,
) -> Result<()> {
    let mut service = state.write().await;
    service
        .set_model(provider_type, model)
        .map_err(LeviathanError::OperationFailed)
}

/// Test if a provider is available
#[command]
pub async fn test_ai_provider(
    state: State<'_, AiState>,
    provider_type: AiProviderType,
) -> Result<bool> {
    let service = state.read().await;
    service
        .test_provider(provider_type)
        .await
        .map_err(LeviathanError::OperationFailed)
}

/// Auto-detect available local AI providers (Ollama, LM Studio)
#[command]
pub async fn auto_detect_ai_providers(state: State<'_, AiState>) -> Result<Vec<AiProviderType>> {
    let service = state.read().await;
    Ok(service.auto_detect_providers().await)
}

/// Generate a commit message from staged changes
#[command]
pub async fn generate_commit_message(
    state: State<'_, AiState>,
    repo_path: String,
) -> Result<GeneratedCommitMessage> {
    // Get staged diff
    let diff = get_staged_diff(&repo_path)?;

    if diff.is_empty() {
        return Err(LeviathanError::OperationFailed(
            "No staged changes to generate commit message for".to_string(),
        ));
    }

    // Generate message using the active provider
    let service = state.read().await;
    service
        .generate_commit_message(diff)
        .await
        .map_err(LeviathanError::OperationFailed)
}

/// Check if AI is available (any provider is configured and available)
#[command]
pub async fn is_ai_available(state: State<'_, AiState>) -> Result<bool> {
    let service = state.read().await;

    // Check if there's an active provider
    let config = service.get_config();
    if config.active_provider.is_none() {
        return Ok(false);
    }

    // Check if the active provider is available
    if let Some(provider_type) = config.active_provider {
        return service
            .test_provider(provider_type)
            .await
            .map_err(LeviathanError::OperationFailed);
    }

    Ok(false)
}

/// Get the staged diff as a string
fn get_staged_diff(repo_path: &str) -> Result<String> {
    let repo = git2::Repository::open(repo_path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to open repository: {}", e))
    })?;

    // Get HEAD tree (for comparing staged changes)
    let head = repo.head().ok();
    let head_tree = head.and_then(|h| h.peel_to_tree().ok());

    // Get the index
    let index = repo
        .index()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to get index: {}", e)))?;

    // Get diff between HEAD and index (staged changes)
    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), Some(&index), None)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to get diff: {}", e)))?;

    // Convert diff to string
    let mut diff_str = String::new();

    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        if let Ok(content) = std::str::from_utf8(line.content()) {
            let prefix = match line.origin() {
                '+' => "+",
                '-' => "-",
                ' ' => " ",
                'H' => "", // File header
                'F' => "", // File header
                'B' => "", // Binary file
                _ => "",
            };
            diff_str.push_str(prefix);
            diff_str.push_str(content);
        }
        true
    })
    .map_err(|e| LeviathanError::OperationFailed(format!("Failed to print diff: {}", e)))?;

    Ok(diff_str)
}
