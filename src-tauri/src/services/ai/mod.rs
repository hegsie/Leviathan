//! AI Provider System for commit message generation
//!
//! This module provides a flexible, provider-based AI system that supports
//! multiple backends including local (Ollama, LM Studio) and cloud
//! (OpenAI, Anthropic) providers.

pub mod config;
pub mod local;
pub mod mcp;
pub mod providers;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

pub use config::{AiConfig, ProviderSettings};
pub use providers::{
    AnthropicProvider, GeminiProvider, GithubCopilotProvider, LoadedModelMeta,
    LocalInferenceProvider, OllamaProvider, OpenAiCompatibleProvider,
};

use crate::commands::local_ai::SharedLocalAiState;

/// AI provider types supported by the system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderType {
    Ollama,
    LmStudio,
    OpenAi,
    Anthropic,
    GithubCopilot,
    GoogleGemini,
    LocalInference,
}

impl AiProviderType {
    pub fn display_name(&self) -> &'static str {
        match self {
            AiProviderType::Ollama => "Ollama",
            AiProviderType::LmStudio => "LM Studio",
            AiProviderType::OpenAi => "OpenAI",
            AiProviderType::Anthropic => "Anthropic Claude",
            AiProviderType::GithubCopilot => "GitHub Models",
            AiProviderType::GoogleGemini => "Google Gemini",
            AiProviderType::LocalInference => "Local AI (Embedded)",
        }
    }

    pub fn default_endpoint(&self) -> &'static str {
        match self {
            AiProviderType::Ollama => "http://localhost:11434",
            AiProviderType::LmStudio => "http://localhost:1234/v1",
            AiProviderType::OpenAi => "https://api.openai.com/v1",
            AiProviderType::Anthropic => "https://api.anthropic.com",
            AiProviderType::GithubCopilot => "https://models.inference.ai.azure.com",
            AiProviderType::GoogleGemini => "https://generativelanguage.googleapis.com",
            AiProviderType::LocalInference => "",
        }
    }

    pub fn requires_api_key(&self) -> bool {
        match self {
            AiProviderType::Ollama | AiProviderType::LmStudio | AiProviderType::LocalInference => {
                false
            }
            AiProviderType::OpenAi
            | AiProviderType::Anthropic
            | AiProviderType::GithubCopilot
            | AiProviderType::GoogleGemini => true,
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            AiProviderType::Ollama => "llama3.2",
            AiProviderType::LmStudio => "local-model",
            AiProviderType::OpenAi => "gpt-4o-mini",
            AiProviderType::Anthropic => "claude-sonnet-4-20250514",
            AiProviderType::GithubCopilot => "gpt-4o",
            AiProviderType::GoogleGemini => "gemini-2.0-flash",
            AiProviderType::LocalInference => "local",
        }
    }

    pub fn all() -> Vec<AiProviderType> {
        vec![
            AiProviderType::Ollama,
            AiProviderType::LmStudio,
            AiProviderType::OpenAi,
            AiProviderType::Anthropic,
            AiProviderType::GithubCopilot,
            AiProviderType::GoogleGemini,
            AiProviderType::LocalInference,
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

/// AI-generated conflict resolution suggestion
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictResolutionSuggestion {
    pub resolved_content: String,
    pub explanation: String,
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

    /// Generate free-form text from a system prompt and user prompt
    async fn generate_text(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        model: Option<&str>,
        max_tokens: Option<u32>,
    ) -> Result<String, String>;
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

/// Maximum conflict context length to send to the AI provider
pub const MAX_CONFLICT_CONTEXT_CHARS: usize = 16000;

/// Maximum commit text length to send for changelog generation
pub const MAX_CHANGELOG_CHARS: usize = 24000;

/// Generated changelog result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedChangelog {
    pub content: String,
}

/// System prompt for AI-powered changelog generation
pub const CHANGELOG_PROMPT: &str = r#"Analyze the following git commits and generate structured release notes in Markdown.

Group changes into these sections (omit empty sections):
## Features
## Bug Fixes
## Performance
## Documentation
## Internal

Rules:
- Write from a user's perspective (what changed for them)
- Use past tense ("Added", "Fixed", "Improved")
- One bullet per logical change (merge related commits into a single bullet)
- Skip merge commits and trivial dependency bumps unless significant
- Include commit short hash in parentheses at end of each bullet, e.g. (abc1234)
- Keep each bullet to one concise sentence
- Do NOT include a title or version header — just the sections

Commits:
"#;

/// System prompt for AI-powered conflict resolution
pub const CONFLICT_RESOLUTION_PROMPT: &str = r#"You are a merge conflict resolution assistant. You will be given the "ours" (current branch) and "theirs" (incoming branch) versions of a conflicting code section, optionally with a common ancestor "base" version and surrounding context.

Your task is to produce a single, correct, merged version that:
1. Preserves the intent of both changes when possible
2. Resolves any contradictions intelligently based on code context
3. Maintains correct syntax, indentation, and style consistent with the file

Respond with ONLY a JSON object (no markdown code fences) in this format:
{"resolvedContent": "the merged code here", "explanation": "brief explanation of how you resolved the conflict"}

Do NOT include conflict markers (<<<<<<, =======, >>>>>>>) in the resolved content."#;

/// AI Service managing providers and configuration
pub struct AiService {
    config_dir: PathBuf,
    config: AiConfig,
    providers: HashMap<AiProviderType, Box<dyn AiProvider>>,
    /// Shared reference to the local inference provider (for loading models)
    local_provider: LocalInferenceProvider,
    /// Shared local AI state for lazy model loading
    local_ai_state: Option<SharedLocalAiState>,
}

impl AiService {
    /// Create a new AI service
    pub fn new(config_dir: PathBuf) -> Self {
        let config = AiConfig::load(&config_dir).unwrap_or_default();

        let mut service = Self {
            config_dir,
            config,
            providers: HashMap::new(),
            local_provider: LocalInferenceProvider::new(),
            local_ai_state: None,
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

        // Google Gemini provider
        let gemini_settings = self
            .config
            .providers
            .get(&AiProviderType::GoogleGemini)
            .cloned()
            .unwrap_or_default();
        let gemini = GeminiProvider::new(
            gemini_settings
                .endpoint
                .unwrap_or_else(|| AiProviderType::GoogleGemini.default_endpoint().to_string()),
            gemini_settings.api_key,
        );
        self.providers
            .insert(AiProviderType::GoogleGemini, Box::new(gemini));

        // Local inference provider — reuse shared instance to preserve loaded engine
        self.providers.insert(
            AiProviderType::LocalInference,
            Box::new(self.local_provider.clone()),
        );
    }

    /// Get the local model status
    pub async fn get_local_model_status(&self) -> providers::LocalModelStatus {
        self.local_provider.get_status().await
    }

    /// Get the display name of the currently loaded local model, if any.
    pub async fn get_loaded_model_name(&self) -> Option<String> {
        self.local_provider.get_model_name().await
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
        let has_key = api_key.is_some();
        let settings = self.config.providers.entry(provider_type).or_default();
        settings.api_key = api_key;

        // Auto-select this provider if none is active and a key was provided
        if has_key && self.config.active_provider.is_none() {
            self.config.active_provider = Some(provider_type);
        }

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
        let settings = self.config.providers.entry(provider_type).or_default();
        settings.model = model;
        self.save_config()
    }

    /// Set custom endpoint for a provider
    pub fn set_endpoint(
        &mut self,
        provider_type: AiProviderType,
        endpoint: Option<String>,
    ) -> Result<(), String> {
        let settings = self.config.providers.entry(provider_type).or_default();
        settings.endpoint = endpoint;

        // Reinitialize providers to use new endpoint
        self.init_providers();
        self.save_config()
    }

    /// Set the shared local AI state reference for lazy model loading.
    /// Must be called after both AiState and SharedLocalAiState are created.
    pub fn set_local_ai_state(&mut self, state: SharedLocalAiState) {
        self.local_ai_state = Some(state);
    }

    /// Lazily load a local GGUF model if one is downloaded but not yet loaded.
    ///
    /// This defers model loading to avoid startup race conditions:
    /// instead of loading the model at startup (which could race with other
    /// initialization), we defer loading until the first inference request.
    pub async fn ensure_local_model_loaded(&self) -> Result<(), String> {
        // Already loaded or loading — nothing to do
        let status = self.local_provider.get_status().await;
        if status == providers::LocalModelStatus::Ready
            || status == providers::LocalModelStatus::Loading
        {
            return Ok(());
        }

        let local_state = match &self.local_ai_state {
            Some(s) => s.clone(),
            None => return Err("Local AI state not available".to_string()),
        };

        let local = local_state.read().await;
        let downloaded = local.model_manager.list_downloaded().unwrap_or_default();

        if downloaded.is_empty() {
            return Ok(()); // No models downloaded — nothing to load
        }

        // Pick the first (best) downloaded model and look up its registry entry
        let model = &downloaded[0];
        let meta = local
            .registry
            .get_by_id(&model.id)
            .map(|entry| providers::LoadedModelMeta {
                tier: entry.tier,
                architecture: entry.architecture.clone(),
                context_length: entry.context_length,
            });
        let model_path = model.path.clone();
        let display_name = model.display_name.clone();
        drop(local);

        tracing::info!("Lazy-loading local model: {}", display_name);
        self.load_local_model(&model_path, display_name, meta).await
    }

    /// Find the first available provider, preferring the active one
    pub async fn find_available_provider(&self) -> Option<(&dyn AiProvider, AiProviderType)> {
        // Try the active provider first
        if let Some(pt) = self.config.active_provider {
            if let Some(provider) = self.providers.get(&pt) {
                if provider.is_available().await {
                    return Some((provider.as_ref(), pt));
                }
            }
        }

        // Check local inference (only if already loaded — no lazy load here,
        // as loading the model into GPU memory is expensive and should be deferred)
        if let Some(provider) = self.providers.get(&AiProviderType::LocalInference) {
            if provider.is_available().await {
                return Some((provider.as_ref(), AiProviderType::LocalInference));
            }
        }

        // Fall back to any other available provider
        for (pt, provider) in &self.providers {
            if *pt == AiProviderType::LocalInference {
                continue; // Already checked above
            }
            if provider.is_available().await {
                return Some((provider.as_ref(), *pt));
            }
        }

        None
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
        // Lazy-load local model on first actual generation request
        if let Err(e) = self.ensure_local_model_loaded().await {
            tracing::debug!("Lazy model load skipped: {}", e);
        }

        let (provider, provider_type) = self
            .find_available_provider()
            .await
            .ok_or("No AI provider available. Please configure a provider in Settings.")?;

        // Truncate diff if too long (skip for local inference — it handles
        // per-file truncation internally and needs all files for good summaries)
        let truncated_diff = if provider_type == AiProviderType::LocalInference {
            diff
        } else if diff.len() > MAX_DIFF_CHARS {
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

    /// Generate free-form text using the active provider
    pub async fn generate_text(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        // Lazy-load local model on first actual generation request
        if let Err(e) = self.ensure_local_model_loaded().await {
            tracing::debug!("Lazy model load skipped: {}", e);
        }

        let (provider, provider_type) = self
            .find_available_provider()
            .await
            .ok_or("No AI provider available. Please configure a provider in Settings.")?;

        // Get the selected model for this provider
        let model = self
            .config
            .providers
            .get(&provider_type)
            .and_then(|s| s.model.as_deref());

        provider
            .generate_text(system_prompt, user_prompt, model, max_tokens)
            .await
    }

    /// Load a GGUF model into the local inference engine.
    ///
    /// After loading, the local inference provider will report as available
    /// and can be used for commit message generation and conflict resolution.
    pub async fn load_local_model(
        &self,
        model_path: &std::path::Path,
        model_name: String,
        meta: Option<providers::LoadedModelMeta>,
    ) -> Result<(), String> {
        // Guard: skip if a model is already loading or ready
        let status = self.local_provider.get_status().await;
        if status == providers::LocalModelStatus::Loading {
            return Err("A model is already being loaded".to_string());
        }
        if status == providers::LocalModelStatus::Ready {
            tracing::info!("Replacing currently loaded model with '{}'", model_name);
        }

        self.local_provider.set_loading().await;

        let model_path = model_path.to_path_buf();

        // Run the heavy GGUF loading on a blocking thread to avoid freezing the async runtime
        let result = tokio::task::spawn_blocking(move || {
            local::GgufEngine::load(&model_path, model_name, meta)
        })
        .await
        .map_err(|e| format!("Model loading task failed: {e}"))?;

        match result {
            Ok(engine) => {
                self.local_provider.set_engine(Box::new(engine)).await;
                tracing::info!("Local inference engine loaded and ready");
                Ok(())
            }
            Err(e) => {
                self.local_provider.set_error().await;
                Err(e)
            }
        }
    }

    /// Unload the current local model
    pub async fn unload_local_model(&self) {
        self.local_provider.clear_engine().await;
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
        assert!(!AiProviderType::LocalInference.requires_api_key());
        assert!(AiProviderType::OpenAi.requires_api_key());
        assert!(AiProviderType::Anthropic.requires_api_key());
        assert!(AiProviderType::GoogleGemini.requires_api_key());
    }

    #[test]
    fn test_local_inference_provider_type() {
        assert_eq!(
            AiProviderType::LocalInference.display_name(),
            "Local AI (Embedded)"
        );
        assert_eq!(AiProviderType::LocalInference.default_model(), "local");
        assert_eq!(AiProviderType::LocalInference.default_endpoint(), "");
    }

    #[test]
    fn test_all_providers_includes_local() {
        let all = AiProviderType::all();
        assert!(all.contains(&AiProviderType::LocalInference));
        assert_eq!(all.len(), 7);
    }
}
