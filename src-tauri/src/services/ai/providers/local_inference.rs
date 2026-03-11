//! Local inference AI provider
//!
//! Provides AI capabilities using a locally loaded model via candle.
//! No external services or API keys required.

use crate::services::ai::{
    AiProvider, AiProviderType, GeneratedCommitMessage, COMMIT_MESSAGE_PROMPT,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Status of the local model
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalModelStatus {
    Unloaded,
    Loading,
    Ready,
    Error,
}

/// Trait for the inference engine (allows mocking in tests)
#[async_trait]
pub trait InferenceEngine: Send + Sync {
    /// Generate text given a prompt
    async fn generate(&self, prompt: &str, max_tokens: u32) -> Result<String, String>;
    /// Get the name of the loaded model
    fn model_name(&self) -> &str;
    /// Check if a model is loaded and ready
    fn is_ready(&self) -> bool;
}

/// Local inference provider implementation
pub struct LocalInferenceProvider {
    engine: Arc<RwLock<Option<Box<dyn InferenceEngine>>>>,
    status: Arc<RwLock<LocalModelStatus>>,
    model_name: Arc<RwLock<Option<String>>>,
}

impl Default for LocalInferenceProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalInferenceProvider {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(RwLock::new(None)),
            status: Arc::new(RwLock::new(LocalModelStatus::Unloaded)),
            model_name: Arc::new(RwLock::new(None)),
        }
    }

    /// Set the inference engine (called when a model is loaded)
    pub async fn set_engine(&self, engine: Box<dyn InferenceEngine>) {
        let name = engine.model_name().to_string();
        *self.engine.write().await = Some(engine);
        *self.status.write().await = LocalModelStatus::Ready;
        *self.model_name.write().await = Some(name);
    }

    /// Clear the engine (called when model is unloaded)
    pub async fn clear_engine(&self) {
        *self.engine.write().await = None;
        *self.status.write().await = LocalModelStatus::Unloaded;
        *self.model_name.write().await = None;
    }

    /// Get the current model status
    pub async fn get_status(&self) -> LocalModelStatus {
        *self.status.read().await
    }

    /// Set status to loading (called during model load)
    pub async fn set_loading(&self) {
        *self.status.write().await = LocalModelStatus::Loading;
    }

    /// Set status to error
    pub async fn set_error(&self) {
        *self.status.write().await = LocalModelStatus::Error;
    }

    /// Get the loaded model name
    pub async fn get_model_name(&self) -> Option<String> {
        self.model_name.read().await.clone()
    }
}

#[async_trait]
impl AiProvider for LocalInferenceProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::LocalInference
    }

    fn name(&self) -> &str {
        "Local AI (Embedded)"
    }

    async fn is_available(&self) -> bool {
        let engine = self.engine.read().await;
        engine.as_ref().is_some_and(|e| e.is_ready())
    }

    async fn list_models(&self) -> Result<Vec<String>, String> {
        let name = self.model_name.read().await;
        match name.as_ref() {
            Some(n) => Ok(vec![n.clone()]),
            None => Ok(vec![]),
        }
    }

    async fn generate_commit_message(
        &self,
        diff: &str,
        _model: Option<&str>,
    ) -> Result<GeneratedCommitMessage, String> {
        let engine = self.engine.read().await;
        let engine = engine
            .as_ref()
            .ok_or("No model loaded. Please download and load a model in Settings > Local AI.")?;

        let prompt = format!("{}{}\n\nCommit message:", COMMIT_MESSAGE_PROMPT, diff);
        let response = engine.generate(&prompt, 256).await?;

        parse_commit_message(&response)
    }

    async fn generate_text(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        _model: Option<&str>,
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        let engine = self.engine.read().await;
        let engine = engine
            .as_ref()
            .ok_or("No model loaded. Please download and load a model in Settings > Local AI.")?;

        let prompt = format!("{}\n\n{}", system_prompt, user_prompt);
        engine.generate(&prompt, max_tokens.unwrap_or(512)).await
    }
}

/// Parse a raw AI response into a structured commit message.
///
/// First non-empty line becomes the summary. Any content after the first
/// blank line becomes the body.
fn parse_commit_message(text: &str) -> Result<GeneratedCommitMessage, String> {
    let lines: Vec<&str> = text.lines().collect();

    if lines.is_empty() {
        return Err("Empty response from AI".to_string());
    }

    // First non-empty line is the summary
    let summary = lines
        .iter()
        .find(|l| !l.trim().is_empty())
        .map(|s| s.trim().to_string())
        .ok_or("No commit message generated")?;

    // Rest becomes the body (if there's content after a blank line)
    let body = if lines.len() > 2 {
        let body_start = lines
            .iter()
            .position(|l| l.trim().is_empty())
            .map(|i| i + 1)
            .unwrap_or(lines.len());

        if body_start < lines.len() {
            let body_text: String = lines[body_start..]
                .iter()
                .map(|s| s.trim())
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();

            if !body_text.is_empty() {
                Some(body_text)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    Ok(GeneratedCommitMessage { summary, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockEngine {
        response: String,
    }

    #[async_trait]
    impl InferenceEngine for MockEngine {
        async fn generate(&self, _prompt: &str, _max_tokens: u32) -> Result<String, String> {
            Ok(self.response.clone())
        }
        fn model_name(&self) -> &str {
            "mock-model"
        }
        fn is_ready(&self) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn test_provider_not_available_without_engine() {
        let provider = LocalInferenceProvider::new();
        assert!(!provider.is_available().await);
    }

    #[tokio::test]
    async fn test_provider_available_with_engine() {
        let provider = LocalInferenceProvider::new();
        let engine = MockEngine {
            response: "test".to_string(),
        };
        provider.set_engine(Box::new(engine)).await;
        assert!(provider.is_available().await);
    }

    #[tokio::test]
    async fn test_generate_commit_message() {
        let provider = LocalInferenceProvider::new();
        let engine = MockEngine {
            response: "feat: add new feature\n\nDetailed description here".to_string(),
        };
        provider.set_engine(Box::new(engine)).await;

        let result = provider.generate_commit_message("some diff", None).await;
        assert!(result.is_ok());
        let msg = result.unwrap();
        assert_eq!(msg.summary, "feat: add new feature");
        assert!(msg.body.is_some());
    }

    #[tokio::test]
    async fn test_generate_without_engine_fails() {
        let provider = LocalInferenceProvider::new();
        let result = provider.generate_commit_message("diff", None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_clear_engine() {
        let provider = LocalInferenceProvider::new();
        let engine = MockEngine {
            response: "test".to_string(),
        };
        provider.set_engine(Box::new(engine)).await;
        assert!(provider.is_available().await);

        provider.clear_engine().await;
        assert!(!provider.is_available().await);
        assert_eq!(provider.get_status().await, LocalModelStatus::Unloaded);
    }

    #[tokio::test]
    async fn test_list_models_empty() {
        let provider = LocalInferenceProvider::new();
        let models = provider.list_models().await.unwrap();
        assert!(models.is_empty());
    }

    #[tokio::test]
    async fn test_list_models_with_engine() {
        let provider = LocalInferenceProvider::new();
        let engine = MockEngine {
            response: "test".to_string(),
        };
        provider.set_engine(Box::new(engine)).await;
        let models = provider.list_models().await.unwrap();
        assert_eq!(models, vec!["mock-model"]);
    }

    #[tokio::test]
    async fn test_status_transitions() {
        let provider = LocalInferenceProvider::new();
        assert_eq!(provider.get_status().await, LocalModelStatus::Unloaded);

        provider.set_loading().await;
        assert_eq!(provider.get_status().await, LocalModelStatus::Loading);

        provider.set_error().await;
        assert_eq!(provider.get_status().await, LocalModelStatus::Error);

        let engine = MockEngine {
            response: "test".to_string(),
        };
        provider.set_engine(Box::new(engine)).await;
        assert_eq!(provider.get_status().await, LocalModelStatus::Ready);
    }

    #[tokio::test]
    async fn test_get_model_name() {
        let provider = LocalInferenceProvider::new();
        assert!(provider.get_model_name().await.is_none());

        let engine = MockEngine {
            response: "test".to_string(),
        };
        provider.set_engine(Box::new(engine)).await;
        assert_eq!(
            provider.get_model_name().await,
            Some("mock-model".to_string())
        );
    }

    #[tokio::test]
    async fn test_provider_type() {
        let provider = LocalInferenceProvider::new();
        assert_eq!(provider.provider_type(), AiProviderType::LocalInference);
    }

    #[tokio::test]
    async fn test_provider_name() {
        let provider = LocalInferenceProvider::new();
        assert_eq!(provider.name(), "Local AI (Embedded)");
    }

    #[tokio::test]
    async fn test_generate_text_without_engine_fails() {
        let provider = LocalInferenceProvider::new();
        let result = provider.generate_text("system", "user", None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_generate_text_with_engine() {
        let provider = LocalInferenceProvider::new();
        let engine = MockEngine {
            response: "generated text".to_string(),
        };
        provider.set_engine(Box::new(engine)).await;

        let result = provider
            .generate_text("system prompt", "user prompt", None, Some(100))
            .await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "generated text");
    }

    #[test]
    fn test_parse_commit_message_summary_only() {
        let result = parse_commit_message("fix: resolve crash on startup").unwrap();
        assert_eq!(result.summary, "fix: resolve crash on startup");
        assert!(result.body.is_none());
    }

    #[test]
    fn test_parse_commit_message_with_body() {
        let result =
            parse_commit_message("feat: add new feature\n\nDetailed description here").unwrap();
        assert_eq!(result.summary, "feat: add new feature");
        assert_eq!(result.body, Some("Detailed description here".to_string()));
    }

    #[test]
    fn test_parse_commit_message_empty() {
        let result = parse_commit_message("");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_commit_message_whitespace_only() {
        let result = parse_commit_message("   \n  \n  ");
        assert!(result.is_err());
    }
}
