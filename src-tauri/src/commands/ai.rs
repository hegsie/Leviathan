//! AI commit message generation commands

use crate::error::{LeviathanError, Result};
use crate::services::ai_service::{AiModelStatus, AiState, GeneratedCommitMessage};
use tauri::{command, AppHandle, State};

/// Get AI model status
#[command]
pub async fn get_ai_status(state: State<'_, AiState>) -> Result<AiModelStatus> {
    let service = state.read().await;
    Ok(service.get_status())
}

/// Check if AI features are available (model downloaded)
#[command]
pub async fn is_ai_available(state: State<'_, AiState>) -> Result<bool> {
    let service = state.read().await;
    Ok(service.is_model_available())
}

/// Download the AI model from HuggingFace
#[command]
pub async fn download_ai_model(app: AppHandle, state: State<'_, AiState>) -> Result<()> {
    let service = state.read().await;

    // Check if already downloaded
    if service.is_model_available() {
        return Err(LeviathanError::OperationFailed(
            "Model is already downloaded".to_string(),
        ));
    }

    service
        .download_model(app)
        .await
        .map_err(LeviathanError::OperationFailed)
}

/// Delete the AI model
#[command]
pub async fn delete_ai_model(state: State<'_, AiState>) -> Result<()> {
    let mut service = state.write().await;
    service
        .delete_model()
        .map_err(LeviathanError::OperationFailed)
}

/// Generate a commit message from staged changes
#[command]
pub async fn generate_commit_message(
    app: AppHandle,
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

    // Generate message using AI
    let mut service = state.write().await;
    service
        .generate_commit_message(diff, app)
        .await
        .map_err(LeviathanError::OperationFailed)
}

/// Get the staged diff as a string
fn get_staged_diff(repo_path: &str) -> Result<String> {
    let repo = git2::Repository::open(repo_path)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to open repository: {}", e)))?;

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
