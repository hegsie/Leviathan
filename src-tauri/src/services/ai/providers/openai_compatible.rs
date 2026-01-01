//! OpenAI-compatible AI provider
//!
//! This provider works with OpenAI API and compatible services like LM Studio

use crate::services::ai::{
    AiProvider, AiProviderType, GeneratedCommitMessage, COMMIT_MESSAGE_PROMPT,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// OpenAI chat completion request
#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    temperature: f32,
}

/// Chat message
#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// OpenAI chat completion response
#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

/// Chat choice
#[derive(Deserialize)]
struct ChatChoice {
    message: ResponseMessage,
}

/// Response message
#[derive(Deserialize)]
struct ResponseMessage {
    content: String,
}

/// OpenAI models list response
#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

/// Model info
#[derive(Deserialize)]
struct ModelInfo {
    id: String,
}

/// OpenAI-compatible provider implementation
pub struct OpenAiCompatibleProvider {
    provider_type: AiProviderType,
    name: String,
    endpoint: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl OpenAiCompatibleProvider {
    /// Create a new OpenAI-compatible provider
    pub fn new(
        provider_type: AiProviderType,
        name: String,
        endpoint: String,
        api_key: Option<String>,
    ) -> Self {
        Self {
            provider_type,
            name,
            endpoint,
            api_key,
            client: reqwest::Client::new(),
        }
    }

    /// Build the models endpoint URL
    fn models_url(&self) -> String {
        format!("{}/models", self.endpoint.trim_end_matches('/'))
    }

    /// Build the chat completions endpoint URL
    fn chat_url(&self) -> String {
        format!("{}/chat/completions", self.endpoint.trim_end_matches('/'))
    }
}

#[async_trait]
impl AiProvider for OpenAiCompatibleProvider {
    fn provider_type(&self) -> AiProviderType {
        self.provider_type
    }

    fn name(&self) -> &str {
        &self.name
    }

    async fn is_available(&self) -> bool {
        // For cloud providers, check if API key is set
        if self.provider_type.requires_api_key() && self.api_key.is_none() {
            return false;
        }

        // Try to list models
        let mut request = self
            .client
            .get(&self.models_url())
            .timeout(std::time::Duration::from_secs(5));

        if let Some(key) = &self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        match request.send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    async fn list_models(&self) -> Result<Vec<String>, String> {
        let mut request = self
            .client
            .get(&self.models_url())
            .timeout(std::time::Duration::from_secs(10));

        if let Some(key) = &self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned error: {}", response.status()));
        }

        let models: ModelsResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Filter and sort models - for OpenAI, prefer GPT models
        let mut model_ids: Vec<String> = models.data.into_iter().map(|m| m.id).collect();

        // Sort with preferred models first
        model_ids.sort_by(|a, b| {
            let a_preferred = a.contains("gpt-4") || a.contains("gpt-3.5");
            let b_preferred = b.contains("gpt-4") || b.contains("gpt-3.5");
            b_preferred.cmp(&a_preferred).then(a.cmp(b))
        });

        Ok(model_ids)
    }

    async fn generate_commit_message(
        &self,
        diff: &str,
        model: Option<&str>,
    ) -> Result<GeneratedCommitMessage, String> {
        let model_name = model.unwrap_or(self.provider_type.default_model());

        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: "You are a helpful assistant that generates concise git commit messages. Follow conventional commit format.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: format!("{}{}", COMMIT_MESSAGE_PROMPT, diff),
            },
        ];

        let request_body = ChatCompletionRequest {
            model: model_name.to_string(),
            messages,
            max_tokens: 256,
            temperature: 0.3,
        };

        let mut request = self
            .client
            .post(&self.chat_url())
            .json(&request_body)
            .timeout(std::time::Duration::from_secs(60));

        if let Some(key) = &self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("API error ({}): {}", status, body));
        }

        let result: ChatCompletionResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let content = result
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or("No response from AI")?;

        // Parse the response
        parse_commit_message(&content)
    }
}

/// Parse raw AI response into structured commit message
fn parse_commit_message(text: &str) -> Result<GeneratedCommitMessage, String> {
    let text = text.trim();

    // Remove any markdown code blocks if present
    let text = text
        .strip_prefix("```")
        .and_then(|s| s.strip_suffix("```"))
        .unwrap_or(text)
        .trim();

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

    #[test]
    fn test_parse_commit_message_simple() {
        let result = parse_commit_message("fix: resolve login issue").unwrap();
        assert_eq!(result.summary, "fix: resolve login issue");
        assert!(result.body.is_none());
    }

    #[test]
    fn test_parse_commit_message_with_code_blocks() {
        let text = "```\nfeat: add new feature\n```";
        let result = parse_commit_message(text).unwrap();
        assert_eq!(result.summary, "feat: add new feature");
    }

    #[test]
    fn test_parse_commit_message_with_body() {
        let text = "feat: add authentication\n\nImplements OAuth2 flow";
        let result = parse_commit_message(text).unwrap();
        assert_eq!(result.summary, "feat: add authentication");
        assert!(result.body.is_some());
    }
}
