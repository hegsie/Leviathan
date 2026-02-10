//! Anthropic Claude AI provider

use crate::services::ai::{
    AiProvider, AiProviderType, GeneratedCommitMessage, COMMIT_MESSAGE_PROMPT,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Anthropic messages API request
#[derive(Serialize)]
struct MessagesRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
}

/// Message in the conversation
#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

/// Anthropic messages API response
#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

/// Content block in response
#[derive(Deserialize)]
struct ContentBlock {
    text: Option<String>,
}

/// Available Anthropic models
const ANTHROPIC_MODELS: &[&str] = &[
    "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
];

/// Anthropic Claude provider implementation
pub struct AnthropicProvider {
    endpoint: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl AnthropicProvider {
    /// Create a new Anthropic provider
    pub fn new(endpoint: String, api_key: Option<String>) -> Self {
        Self {
            endpoint,
            api_key,
            client: reqwest::Client::new(),
        }
    }

    /// Build the messages endpoint URL
    fn messages_url(&self) -> String {
        format!("{}/v1/messages", self.endpoint.trim_end_matches('/'))
    }
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::Anthropic
    }

    fn name(&self) -> &str {
        "Anthropic Claude"
    }

    async fn is_available(&self) -> bool {
        // Anthropic requires an API key
        self.api_key.is_some()
    }

    async fn list_models(&self) -> Result<Vec<String>, String> {
        // Anthropic doesn't have a models list endpoint, return static list
        Ok(ANTHROPIC_MODELS.iter().map(|s| s.to_string()).collect())
    }

    async fn generate_commit_message(
        &self,
        diff: &str,
        model: Option<&str>,
    ) -> Result<GeneratedCommitMessage, String> {
        let api_key = self
            .api_key
            .as_ref()
            .ok_or("Anthropic API key not configured")?;

        let model_name = model.unwrap_or(AiProviderType::Anthropic.default_model());

        let request_body = MessagesRequest {
            model: model_name.to_string(),
            max_tokens: 256,
            messages: vec![Message {
                role: "user".to_string(),
                content: format!("{}{}", COMMIT_MESSAGE_PROMPT, diff),
            }],
            system: None,
        };

        let response = self
            .client
            .post(self.messages_url())
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request_body)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Anthropic: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error ({}): {}", status, body));
        }

        let result: MessagesResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

        let content = result
            .content
            .first()
            .and_then(|c| c.text.clone())
            .ok_or("No response from Claude")?;

        // Parse the response
        parse_commit_message(&content)
    }

    async fn generate_text(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        model: Option<&str>,
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        let api_key = self
            .api_key
            .as_ref()
            .ok_or("Anthropic API key not configured")?;

        let model_name = model.unwrap_or(AiProviderType::Anthropic.default_model());

        let request_body = MessagesRequest {
            model: model_name.to_string(),
            max_tokens: max_tokens.unwrap_or(2048),
            messages: vec![Message {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            }],
            system: Some(system_prompt.to_string()),
        };

        let response = self
            .client
            .post(self.messages_url())
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request_body)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Anthropic: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error ({}): {}", status, body));
        }

        let result: MessagesResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

        result
            .content
            .first()
            .and_then(|c| c.text.clone())
            .map(|t| t.trim().to_string())
            .ok_or_else(|| "No response from Claude".to_string())
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
    fn test_anthropic_models() {
        assert!(ANTHROPIC_MODELS.contains(&"claude-sonnet-4-20250514"));
        assert!(ANTHROPIC_MODELS.contains(&"claude-3-5-sonnet-20241022"));
    }

    #[test]
    fn test_parse_commit_message() {
        let result = parse_commit_message("fix: correct typo in readme").unwrap();
        assert_eq!(result.summary, "fix: correct typo in readme");
        assert!(result.body.is_none());
    }
}
