//! AI Provider System for commit message generation
//!
//! This module provides a flexible, provider-based AI system that supports
//! multiple backends including local (Ollama, LM Studio) and cloud
//! (OpenAI, Anthropic) providers.

pub mod config;
pub mod providers;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

pub use config::{AiConfig, ProviderSettings};
pub use providers::{AnthropicProvider, GithubCopilotProvider, OllamaProvider, OpenAiCompatibleProvider};

/// AI provider types supported by the system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderType {
    Ollama,
    LmStudio,
    OpenAi,
    Anthropic,
    GithubCopilot,
}

impl AiProviderType {
    pub fn display_name(&self) -> &'static str {
        match self {
            AiProviderType::Ollama => "Ollama",
            AiProviderType::LmStudio => "LM Studio",
            AiProviderType::OpenAi => "OpenAI",
            AiProviderType::Anthropic => "Anthropic Claude",
            AiProviderType::GithubCopilot => "GitHub Models",
        }
    }

    pub fn default_endpoint(&self) -> &'static str {
        match self {
            AiProviderType::Ollama => "http://localhost:11434",
            AiProviderType::LmStudio => "http://localhost:1234/v1",
            AiProviderType::OpenAi => "https://api.openai.com/v1",
            AiProviderType::Anthropic => "https://api.anthropic.com",
            AiProviderType::GithubCopilot => "https://models.inference.ai.azure.com",
        }
    }

    pub fn requires_api_key(&self) -> bool {
        match self {
            AiProviderType::Ollama | AiProviderType::LmStudio => false,
            AiProviderType::OpenAi | AiProviderType::Anthropic | AiProviderType::GithubCopilot => {
                true
            }
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            AiProviderType::Ollama => "llama3.2",
            AiProviderType::LmStudio => "local-model",
            AiProviderType::OpenAi => "gpt-4o-mini",
            AiProviderType::Anthropic => "claude-sonnet-4-20250514",
            AiProviderType::GithubCopilot => "gpt-4o",
        }
    }

    pub fn all() -> Vec<AiProviderType> {
        vec![
            AiProviderType::Ollama,
            AiProviderType::LmStudio,
            AiProviderType::OpenAi,
            AiProviderType::Anthropic,
            AiProviderType::GithubCopilot,
        ]
    }
}

/// Generated commit message result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCommitMessage {
    pub summary: String,
    pub body: Option<String>,
}

/// Information about an AI provider
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderInfo {
    pub provider_type: AiProviderType,
    pub name: String,
    pub available: bool,
    pub requires_api_key: bool,
    pub has_api_key: bool,
    pub endpoint: String,
    pub models: Vec<String>,
    pub selected_model: Option<String>,
}

/// Trait for AI providers
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Get the provider type
    fn provider_type(&self) -> AiProviderType;

    /// Get the display name
    fn name(&self) -> &str;

    /// Check if the provider is available (e.g., service is running)
    async fn is_available(&self) -> bool;

    /// List available models from the provider
    async fn list_models(&self) -> Result<Vec<String>, String>;

    /// Generate a commit message from a diff
    async fn generate_commit_message(
        &self,
        diff: &str,
        model: Option<&str>,
    ) -> Result<GeneratedCommitMessage, String>;
}

/// The commit message generation prompt
pub const COMMIT_MESSAGE_PROMPT: &str = r#"Generate a concise git commit message for the following diff.
Use conventional commit format: type(scope): description
Types: feat, fix, docs, style, refactor, test, chore

Rules:
- Summary line should be 50 characters or less
- Use imperative mood ("add" not "added")
- Do not end summary with a period
- If the change is simple, just provide the summary
- Only add a body if the change needs explanation

Diff:
"#;

/// Maximum diff length to send to the AI provider
pub const MAX_DIFF_CHARS: usize = 12000;

/// AI Service managing providers and configuration
pub struct AiService {
    config_dir: PathBuf,
    config: AiConfig,
    providers: HashMap<AiProviderType, Box<dyn AiProvider>>,
}

impl AiService {
    /// Create a new AI service
    pub fn new(config_dir: PathBuf) -> Self {
        let config = AiConfig::load(&config_dir).unwrap_or_default();

        let mut service = Self {
            config_dir,
            config,
            providers: HashMap::new(),
        };

        // Initialize providers
        service.init_providers();

        service
    }

    /// Initialize all providers
    fn init_providers(&mut self) {
        // Ollama provider
        let ollama_settings = self
            .config
            .providers
            .get(&AiProviderType::Ollama)
            .cloned()
            .unwrap_or_default();
        let ollama = OllamaProvider::new(
            ollama_settings
                .endpoint
                .unwrap_or_else(|| AiProviderType::Ollama.default_endpoint().to_string()),
        );
        self.providers
            .insert(AiProviderType::Ollama, Box::new(ollama));

        // LM Studio provider (OpenAI compatible)
        let lm_settings = self
            .config
            .providers
            .get(&AiProviderType::LmStudio)
            .cloned()
            .unwrap_or_default();
        let lm_studio = OpenAiCompatibleProvider::new(
            AiProviderType::LmStudio,
            "LM Studio".to_string(),
            lm_settings
                .endpoint
                .unwrap_or_else(|| AiProviderType::LmStudio.default_endpoint().to_string()),
            None, // No API key for local
        );
        self.providers
            .insert(AiProviderType::LmStudio, Box::new(lm_studio));

        // OpenAI provider
        let openai_settings = self
            .config
            .providers
            .get(&AiProviderType::OpenAi)
            .cloned()
            .unwrap_or_default();
        let openai = OpenAiCompatibleProvider::new(
            AiProviderType::OpenAi,
            "OpenAI".to_string(),
            openai_settings
                .endpoint
                .unwrap_or_else(|| AiProviderType::OpenAi.default_endpoint().to_string()),
            openai_settings.api_key,
        );
        self.providers
            .insert(AiProviderType::OpenAi, Box::new(openai));

        // Anthropic provider
        let anthropic_settings = self
            .config
            .providers
            .get(&AiProviderType::Anthropic)
            .cloned()
            .unwrap_or_default();
        let anthropic = AnthropicProvider::new(
            anthropic_settings
                .endpoint
                .unwrap_or_else(|| AiProviderType::Anthropic.default_endpoint().to_string()),
            anthropic_settings.api_key,
        );
        self.providers
            .insert(AiProviderType::Anthropic, Box::new(anthropic));

        // GitHub Copilot provider
        let copilot_settings = self
            .config
            .providers
            .get(&AiProviderType::GithubCopilot)
            .cloned()
            .unwrap_or_default();
        let copilot = GithubCopilotProvider::new(
            copilot_settings
                .endpoint
                .unwrap_or_else(|| AiProviderType::GithubCopilot.default_endpoint().to_string()),
            copilot_settings.api_key,
        );
        self.providers
            .insert(AiProviderType::GithubCopilot, Box::new(copilot));
    }

    /// Get the current configuration
    pub fn get_config(&self) -> &AiConfig {
        &self.config
    }

    /// Get information about all providers
    pub async fn get_providers_info(&self) -> Vec<AiProviderInfo> {
        let mut infos = Vec::new();

        for provider_type in AiProviderType::all() {
            if let Some(provider) = self.providers.get(&provider_type) {
                let settings = self.config.providers.get(&provider_type);
                let available = provider.is_available().await;
                let models = provider.list_models().await.unwrap_or_default();

                infos.push(AiProviderInfo {
                    provider_type,
                    name: provider.name().to_string(),
                    available,
                    requires_api_key: provider_type.requires_api_key(),
                    has_api_key: settings.and_then(|s| s.api_key.as_ref()).is_some(),
                    endpoint: settings
                        .and_then(|s| s.endpoint.clone())
                        .unwrap_or_else(|| provider_type.default_endpoint().to_string()),
                    models,
                    selected_model: settings.and_then(|s| s.model.clone()),
                });
            }
        }

        infos
    }

    /// Set the active provider
    pub fn set_active_provider(&mut self, provider_type: AiProviderType) -> Result<(), String> {
        self.config.active_provider = Some(provider_type);
        self.save_config()
    }

    /// Set API key for a provider
    pub fn set_api_key(
        &mut self,
        provider_type: AiProviderType,
        api_key: Option<String>,
    ) -> Result<(), String> {
        let settings = self
            .config
            .providers
            .entry(provider_type)
            .or_insert_with(ProviderSettings::default);
        settings.api_key = api_key;

        // Reinitialize providers to pick up new key
        self.init_providers();
        self.save_config()
    }

    /// Set the model for a provider
    pub fn set_model(
        &mut self,
        provider_type: AiProviderType,
        model: Option<String>,
    ) -> Result<(), String> {
        let settings = self
            .config
            .providers
            .entry(provider_type)
            .or_insert_with(ProviderSettings::default);
        settings.model = model;
        self.save_config()
    }

    /// Set custom endpoint for a provider
    pub fn set_endpoint(
        &mut self,
        provider_type: AiProviderType,
        endpoint: Option<String>,
    ) -> Result<(), String> {
        let settings = self
            .config
            .providers
            .entry(provider_type)
            .or_insert_with(ProviderSettings::default);
        settings.endpoint = endpoint;

        // Reinitialize providers to use new endpoint
        self.init_providers();
        self.save_config()
    }

    /// Save configuration to disk
    fn save_config(&self) -> Result<(), String> {
        self.config.save(&self.config_dir)
    }

    /// Test if a provider is available
    pub async fn test_provider(&self, provider_type: AiProviderType) -> Result<bool, String> {
        let provider = self
            .providers
            .get(&provider_type)
            .ok_or_else(|| format!("Provider {:?} not found", provider_type))?;

        Ok(provider.is_available().await)
    }

    /// Generate a commit message using the active provider
    pub async fn generate_commit_message(
        &self,
        diff: String,
    ) -> Result<GeneratedCommitMessage, String> {
        let provider_type = self
            .config
            .active_provider
            .ok_or("No AI provider configured. Please select a provider in Settings.")?;

        let provider = self
            .providers
            .get(&provider_type)
            .ok_or_else(|| format!("Provider {:?} not found", provider_type))?;

        if !provider.is_available().await {
            return Err(format!(
                "{} is not available. Please check that the service is running.",
                provider.name()
            ));
        }

        // Truncate diff if too long
        let truncated_diff = if diff.len() > MAX_DIFF_CHARS {
            format!(
                "{}...\n[Diff truncated for length]",
                &diff[..MAX_DIFF_CHARS]
            )
        } else {
            diff
        };

        // Get the selected model for this provider
        let model = self
            .config
            .providers
            .get(&provider_type)
            .and_then(|s| s.model.as_deref());

        provider
            .generate_commit_message(&truncated_diff, model)
            .await
    }

    /// Auto-detect available local providers
    pub async fn auto_detect_providers(&self) -> Vec<AiProviderType> {
        let mut available = Vec::new();

        for provider_type in [AiProviderType::Ollama, AiProviderType::LmStudio] {
            if let Some(provider) = self.providers.get(&provider_type) {
                if provider.is_available().await {
                    available.push(provider_type);
                }
            }
        }

        available
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

    #[test]
    fn test_provider_type_display_name() {
        assert_eq!(AiProviderType::Ollama.display_name(), "Ollama");
        assert_eq!(AiProviderType::OpenAi.display_name(), "OpenAI");
        assert_eq!(AiProviderType::Anthropic.display_name(), "Anthropic Claude");
    }

    #[test]
    fn test_provider_type_requires_api_key() {
        assert!(!AiProviderType::Ollama.requires_api_key());
        assert!(!AiProviderType::LmStudio.requires_api_key());
        assert!(AiProviderType::OpenAi.requires_api_key());
        assert!(AiProviderType::Anthropic.requires_api_key());
    }
}
