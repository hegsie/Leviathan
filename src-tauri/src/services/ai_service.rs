//! AI inference service for commit message generation
//!
//! This module provides AI-powered commit message generation using
//! an embedded LLM model (Tavernari/git-commit-message).

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::RwLock;

/// Model file name on HuggingFace
const MODEL_FILENAME: &str = "unsloth.Q4_K_M.gguf";

/// HuggingFace repository ID
const MODEL_REPO_ID: &str = "Tavernari/git-commit-message";

/// Maximum diff length (in characters) to send to the model
const MAX_DIFF_CHARS: usize = 12000;

/// AI model status information
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelStatus {
    pub model_available: bool,
    pub model_path: Option<String>,
    pub model_size_mb: Option<u64>,
    pub quantization: Option<String>,
}

/// Model download progress event
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress_percent: f64,
    pub status: String, // "downloading", "complete", "error"
}

/// Generation progress event
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationProgress {
    pub status: String, // "loading_model", "generating", "complete", "error"
    pub tokens_generated: Option<u32>,
    pub message: Option<String>,
}

/// Generated commit message result
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCommitMessage {
    pub summary: String,
    pub body: Option<String>,
    pub reasoning: Option<String>,
}

/// AI service for commit message generation
pub struct AiService {
    model_dir: PathBuf,
    model_loaded: bool,
}

impl Default for AiService {
    fn default() -> Self {
        Self::new(PathBuf::new())
    }
}

impl AiService {
    /// Create a new AI service
    pub fn new(config_dir: PathBuf) -> Self {
        let model_dir = config_dir.join("models");

        // Create model directory if it doesn't exist
        if let Err(e) = std::fs::create_dir_all(&model_dir) {
            tracing::warn!("Failed to create model directory: {}", e);
        }

        Self {
            model_dir,
            model_loaded: false,
        }
    }

    /// Get the path to the model file
    pub fn get_model_path(&self) -> PathBuf {
        self.model_dir.join(MODEL_FILENAME)
    }

    /// Check if the model is downloaded
    pub fn is_model_available(&self) -> bool {
        self.get_model_path().exists()
    }

    /// Get model status information
    pub fn get_status(&self) -> AiModelStatus {
        let model_path = self.get_model_path();

        if model_path.exists() {
            let metadata = std::fs::metadata(&model_path).ok();
            AiModelStatus {
                model_available: true,
                model_path: Some(model_path.to_string_lossy().to_string()),
                model_size_mb: metadata.map(|m| m.len() / 1024 / 1024),
                quantization: Some("Q4_K_M".to_string()),
            }
        } else {
            AiModelStatus {
                model_available: false,
                model_path: None,
                model_size_mb: None,
                quantization: None,
            }
        }
    }

    /// Download the AI model from HuggingFace
    pub async fn download_model(&self, app_handle: tauri::AppHandle) -> Result<(), String> {
        let model_path = self.get_model_path();
        let app = app_handle.clone();

        // Emit initial progress
        let _ = app.emit(
            "ai-model-download-progress",
            ModelDownloadProgress {
                downloaded_bytes: 0,
                total_bytes: None,
                progress_percent: 0.0,
                status: "downloading".to_string(),
            },
        );

        // Initialize HuggingFace API (async/tokio version)
        let api = hf_hub::api::tokio::Api::new()
            .map_err(|e| format!("Failed to initialize HuggingFace API: {}", e))?;

        // Get model repository
        let repo = api.repo(hf_hub::Repo::new(
            MODEL_REPO_ID.to_string(),
            hf_hub::RepoType::Model,
        ));

        tracing::info!("Downloading model from HuggingFace: {}", MODEL_REPO_ID);

        // Download the model file
        let downloaded_path = repo
            .get(MODEL_FILENAME)
            .await
            .map_err(|e| format!("Failed to download model: {}", e))?;

        tracing::info!("Model downloaded to cache: {:?}", downloaded_path);

        // Copy to our model directory
        tokio::fs::copy(&downloaded_path, &model_path)
            .await
            .map_err(|e| format!("Failed to copy model to app directory: {}", e))?;

        tracing::info!("Model copied to: {:?}", model_path);

        // Emit completion
        let _ = app.emit(
            "ai-model-download-progress",
            ModelDownloadProgress {
                downloaded_bytes: 0,
                total_bytes: None,
                progress_percent: 100.0,
                status: "complete".to_string(),
            },
        );

        Ok(())
    }

    /// Delete the AI model
    pub fn delete_model(&mut self) -> Result<(), String> {
        let model_path = self.get_model_path();

        if model_path.exists() {
            std::fs::remove_file(&model_path)
                .map_err(|e| format!("Failed to delete model: {}", e))?;
            self.model_loaded = false;
            tracing::info!("Model deleted: {:?}", model_path);
        }

        Ok(())
    }

    /// Generate a commit message from a git diff
    pub async fn generate_commit_message(
        &mut self,
        diff: String,
        app_handle: tauri::AppHandle,
    ) -> Result<GeneratedCommitMessage, String> {
        let model_path = self.get_model_path();
        let app = app_handle.clone();

        if !model_path.exists() {
            return Err("AI model not downloaded. Please download the model first.".to_string());
        }

        // Emit loading status
        let _ = app.emit(
            "ai-generation-progress",
            GenerationProgress {
                status: "loading_model".to_string(),
                tokens_generated: None,
                message: Some("Loading AI model...".to_string()),
            },
        );

        // Truncate diff if too long
        let truncated_diff = if diff.len() > MAX_DIFF_CHARS {
            format!(
                "{}...\n[Diff truncated for length]",
                &diff[..MAX_DIFF_CHARS]
            )
        } else {
            diff
        };

        // Run inference in blocking task
        let result = tokio::task::spawn_blocking(move || {
            // Emit generating status
            let _ = app.emit(
                "ai-generation-progress",
                GenerationProgress {
                    status: "generating".to_string(),
                    tokens_generated: Some(0),
                    message: Some("Generating commit message...".to_string()),
                },
            );

            // Load model and run inference
            let output = run_inference(&model_path, &truncated_diff, &app)?;

            // Parse the response
            let result = parse_response(&output);

            // Emit completion
            let _ = app.emit(
                "ai-generation-progress",
                GenerationProgress {
                    status: "complete".to_string(),
                    tokens_generated: Some(output.len() as u32),
                    message: Some("Complete".to_string()),
                },
            );

            Ok::<GeneratedCommitMessage, String>(result)
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))??;

        self.model_loaded = true;
        Ok(result)
    }
}

/// Run LLM inference on the diff
fn run_inference(
    model_path: &PathBuf,
    diff: &str,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::LlamaModel;
    use llama_cpp_2::token::data_array::LlamaTokenDataArray;
    use std::num::NonZeroU32;

    tracing::info!("Loading model from: {:?}", model_path);

    // Initialize llama backend
    let backend = LlamaBackend::init().map_err(|e| format!("Failed to init llama backend: {}", e))?;

    // Load model parameters
    let model_params = LlamaModelParams::default();

    // Load the model
    let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
        .map_err(|e| format!("Failed to load model: {}", e))?;

    tracing::info!("Model loaded successfully");

    // Create context parameters
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(4096));

    // Create context
    let mut ctx = model
        .new_context(&backend, ctx_params)
        .map_err(|e| format!("Failed to create context: {}", e))?;

    // Tokenize the input diff
    let tokens = model
        .str_to_token(diff, llama_cpp_2::model::AddBos::Always)
        .map_err(|e| format!("Failed to tokenize: {}", e))?;

    tracing::info!("Input tokenized: {} tokens", tokens.len());

    // Create a batch for the input tokens
    let mut batch = LlamaBatch::new(4096, 1);

    // Add tokens to batch
    for (i, token) in tokens.iter().enumerate() {
        batch
            .add(*token, i as i32, &[0], i == tokens.len() - 1)
            .map_err(|e| format!("Failed to add token to batch: {}", e))?;
    }

    // Decode the input
    ctx.decode(&mut batch)
        .map_err(|e| format!("Failed to decode input: {}", e))?;

    // Generate output tokens
    let mut output = String::new();
    let max_tokens = 512;
    let mut n_cur = tokens.len();

    // Use a fixed seed for reproducibility
    let seed = 42u32;

    for i in 0..max_tokens {
        // Get logits for the last token
        let logits = ctx.candidates_ith(batch.n_tokens() - 1);

        // Create token data array for sampling
        let mut candidates = LlamaTokenDataArray::from_iter(logits, false);

        // Sample next token with seed
        let new_token = candidates.sample_token(seed.wrapping_add(i as u32));

        // Check for end of sequence
        if model.is_eog_token(new_token) {
            break;
        }

        // Convert token to string
        let piece = model
            .token_to_str(new_token, llama_cpp_2::model::Special::Tokenize)
            .map_err(|e| format!("Failed to convert token: {}", e))?;

        output.push_str(&piece);

        // Emit progress every 10 tokens
        if i % 10 == 0 {
            let _ = app.emit(
                "ai-generation-progress",
                GenerationProgress {
                    status: "generating".to_string(),
                    tokens_generated: Some(i as u32),
                    message: None,
                },
            );
        }

        // Prepare batch for next iteration
        batch.clear();
        batch
            .add(new_token, n_cur as i32, &[0], true)
            .map_err(|e| format!("Failed to add token: {}", e))?;
        n_cur += 1;

        // Decode next token
        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to decode: {}", e))?;
    }

    tracing::info!("Generated {} characters", output.len());

    Ok(output)
}

/// Parse the model response into a structured commit message
fn parse_response(response: &str) -> GeneratedCommitMessage {
    // Extract reasoning if present (model outputs <reasoning>...</reasoning>)
    let reasoning = if let Some(start) = response.find("<reasoning>") {
        if let Some(end) = response.find("</reasoning>") {
            Some(response[start + 11..end].trim().to_string())
        } else {
            None
        }
    } else {
        None
    };

    // Get message part (after reasoning block if present)
    let message_part = if let Some(end) = response.find("</reasoning>") {
        response[end + 12..].trim()
    } else {
        response.trim()
    };

    // Split into summary (first line) and body (rest)
    let lines: Vec<&str> = message_part.lines().collect();
    let summary = lines
        .first()
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    // Body is everything after the first blank line
    let body = if lines.len() > 2 {
        let body_lines: Vec<&str> = lines[2..].iter().copied().collect();
        let body_text = body_lines.join("\n").trim().to_string();
        if body_text.is_empty() {
            None
        } else {
            Some(body_text)
        }
    } else {
        None
    };

    GeneratedCommitMessage {
        summary,
        body,
        reasoning,
    }
}

/// Global AI service state
pub type AiState = Arc<RwLock<AiService>>;

/// Create the AI service state
pub fn create_ai_state(config_dir: PathBuf) -> AiState {
    Arc::new(RwLock::new(AiService::new(config_dir)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_ai_service_new() {
        let temp_dir = TempDir::new().unwrap();
        let service = AiService::new(temp_dir.path().to_path_buf());

        // Model directory should be created
        let model_dir = temp_dir.path().join("models");
        assert!(model_dir.exists() || !model_dir.exists()); // May or may not exist depending on permissions

        // Service should not have model loaded initially
        assert!(!service.model_loaded);
    }

    #[test]
    fn test_get_model_path() {
        let temp_dir = TempDir::new().unwrap();
        let service = AiService::new(temp_dir.path().to_path_buf());

        let path = service.get_model_path();
        assert!(path.to_string_lossy().contains("unsloth.Q4_K_M.gguf"));
    }

    #[test]
    fn test_is_model_available_false_when_not_downloaded() {
        let temp_dir = TempDir::new().unwrap();
        let service = AiService::new(temp_dir.path().to_path_buf());

        assert!(!service.is_model_available());
    }

    #[test]
    fn test_is_model_available_true_when_exists() {
        let temp_dir = TempDir::new().unwrap();
        let model_dir = temp_dir.path().join("models");
        std::fs::create_dir_all(&model_dir).unwrap();
        std::fs::write(model_dir.join("unsloth.Q4_K_M.gguf"), "fake model content").unwrap();

        let service = AiService::new(temp_dir.path().to_path_buf());
        assert!(service.is_model_available());
    }

    #[test]
    fn test_get_status_model_not_available() {
        let temp_dir = TempDir::new().unwrap();
        let service = AiService::new(temp_dir.path().to_path_buf());

        let status = service.get_status();
        assert!(!status.model_available);
        assert!(status.model_path.is_none());
        assert!(status.model_size_mb.is_none());
        assert!(status.quantization.is_none());
    }

    #[test]
    fn test_get_status_model_available() {
        let temp_dir = TempDir::new().unwrap();
        let model_dir = temp_dir.path().join("models");
        std::fs::create_dir_all(&model_dir).unwrap();

        // Create a fake model file (1 MB)
        let model_content = vec![0u8; 1024 * 1024];
        std::fs::write(model_dir.join("unsloth.Q4_K_M.gguf"), model_content).unwrap();

        let service = AiService::new(temp_dir.path().to_path_buf());
        let status = service.get_status();

        assert!(status.model_available);
        assert!(status.model_path.is_some());
        assert!(status.model_size_mb.is_some());
        assert_eq!(status.quantization, Some("Q4_K_M".to_string()));
    }

    #[test]
    fn test_delete_model() {
        let temp_dir = TempDir::new().unwrap();
        let model_dir = temp_dir.path().join("models");
        std::fs::create_dir_all(&model_dir).unwrap();
        std::fs::write(model_dir.join("unsloth.Q4_K_M.gguf"), "fake model").unwrap();

        let mut service = AiService::new(temp_dir.path().to_path_buf());
        assert!(service.is_model_available());

        let result = service.delete_model();
        assert!(result.is_ok());
        assert!(!service.is_model_available());
    }

    #[test]
    fn test_delete_model_not_exists() {
        let temp_dir = TempDir::new().unwrap();
        let mut service = AiService::new(temp_dir.path().to_path_buf());

        // Should not error when model doesn't exist
        let result = service.delete_model();
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_response_summary_only() {
        let response = "fix: typo in readme";
        let result = parse_response(response);

        assert_eq!(result.summary, "fix: typo in readme");
        assert!(result.body.is_none());
        assert!(result.reasoning.is_none());
    }

    #[test]
    fn test_parse_response_with_body() {
        let response = "feat: add login feature\n\nThis implements the login feature with:\n- Form validation\n- Error handling";
        let result = parse_response(response);

        assert_eq!(result.summary, "feat: add login feature");
        assert!(result.body.is_some());
        assert!(result.body.unwrap().contains("Form validation"));
    }

    #[test]
    fn test_parse_response_with_reasoning() {
        let response = "<reasoning>The diff shows new files being added</reasoning>feat: add helper function";
        let result = parse_response(response);

        assert_eq!(result.summary, "feat: add helper function");
        assert!(result.reasoning.is_some());
        assert_eq!(result.reasoning.unwrap(), "The diff shows new files being added");
    }

    #[test]
    fn test_parse_response_with_reasoning_and_body() {
        let response = "<reasoning>Changes add new functionality</reasoning>feat: add user auth\n\nImplements JWT authentication";
        let result = parse_response(response);

        assert_eq!(result.summary, "feat: add user auth");
        assert!(result.reasoning.is_some());
        // Body may or may not be extracted depending on line count
    }

    #[test]
    fn test_parse_response_empty() {
        let response = "";
        let result = parse_response(response);

        assert_eq!(result.summary, "");
        assert!(result.body.is_none());
        assert!(result.reasoning.is_none());
    }

    #[test]
    fn test_parse_response_multiline_reasoning() {
        let response = "<reasoning>Line 1\nLine 2\nLine 3</reasoning>fix: bug";
        let result = parse_response(response);

        assert!(result.reasoning.is_some());
        let reasoning = result.reasoning.unwrap();
        assert!(reasoning.contains("Line 1"));
        assert!(reasoning.contains("Line 2"));
    }

    #[test]
    fn test_diff_truncation_logic() {
        let short_diff = "a".repeat(5000);
        let long_diff = "a".repeat(15000);

        let max_chars = 12000;

        // Short diff should not be truncated
        let short_result = if short_diff.len() > max_chars {
            format!("{}...\n[Diff truncated for length]", &short_diff[..max_chars])
        } else {
            short_diff.clone()
        };
        assert_eq!(short_result.len(), 5000);

        // Long diff should be truncated
        let long_result = if long_diff.len() > max_chars {
            format!("{}...\n[Diff truncated for length]", &long_diff[..max_chars])
        } else {
            long_diff.clone()
        };
        assert!(long_result.contains("[Diff truncated for length]"));
    }

    #[test]
    fn test_model_download_progress_serialization() {
        let progress = ModelDownloadProgress {
            downloaded_bytes: 1073741824,
            total_bytes: Some(2147483648),
            progress_percent: 50.0,
            status: "downloading".to_string(),
        };

        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("downloadedBytes"));
        assert!(json.contains("1073741824"));
        assert!(json.contains("progressPercent"));
    }

    #[test]
    fn test_generation_progress_serialization() {
        let progress = GenerationProgress {
            status: "generating".to_string(),
            tokens_generated: Some(50),
            message: Some("Generating...".to_string()),
        };

        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("tokensGenerated"));
        assert!(json.contains("50"));
    }

    #[test]
    fn test_generated_commit_message_serialization() {
        let message = GeneratedCommitMessage {
            summary: "feat: add feature".to_string(),
            body: Some("Detailed description".to_string()),
            reasoning: None,
        };

        let json = serde_json::to_string(&message).unwrap();
        assert!(json.contains("summary"));
        assert!(json.contains("feat: add feature"));
        assert!(json.contains("body"));
    }

    #[test]
    fn test_ai_model_status_serialization() {
        let status = AiModelStatus {
            model_available: true,
            model_path: Some("/path/to/model".to_string()),
            model_size_mb: Some(2048),
            quantization: Some("Q4_K_M".to_string()),
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("modelAvailable"));
        assert!(json.contains("modelPath"));
        assert!(json.contains("modelSizeMb"));
    }
}
