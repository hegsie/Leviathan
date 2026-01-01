//! GitHub Models AI provider
//!
//! Uses the GitHub Models API (models.inference.ai.azure.com) which provides
//! access to various AI models through a GitHub token.

use crate::services::ai::{
    AiProvider, AiProviderType, GeneratedCommitMessage, COMMIT_MESSAGE_PROMPT,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// OpenAI-style chat completion request
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

/// Chat completion response
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

/// GitHub Models available models (subset of what's available)
const COPILOT_MODELS: &[&str] = &["gpt-4o", "gpt-4o-mini", "o1-mini", "o1-preview"];

/// GitHub Models provider implementation
pub struct GithubCopilotProvider {
    endpoint: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl GithubCopilotProvider {
    /// Create a new GitHub Models provider
    pub fn new(endpoint: String, api_key: Option<String>) -> Self {
        Self {
            endpoint,
            api_key,
            client: reqwest::Client::new(),
        }
    }

    /// Build the chat completions endpoint URL
    fn chat_url(&self) -> String {
        format!("{}/chat/completions", self.endpoint.trim_end_matches('/'))
    }
}

#[async_trait]
impl AiProvider for GithubCopilotProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::GithubCopilot
    }

    fn name(&self) -> &str {
        "GitHub Models"
    }

    async fn is_available(&self) -> bool {
        // GitHub Models requires a token
        self.api_key.is_some()
    }

    async fn list_models(&self) -> Result<Vec<String>, String> {
        // Return static list of known models
        Ok(COPILOT_MODELS.iter().map(|s| s.to_string()).collect())
    }

    async fn generate_commit_message(
        &self,
        diff: &str,
        model: Option<&str>,
    ) -> Result<GeneratedCommitMessage, String> {
        let api_key = self
            .api_key
            .as_ref()
            .ok_or("GitHub token not configured. Create a token at github.com/settings/tokens")?;

        let model_name = model.unwrap_or(AiProviderType::GithubCopilot.default_model());

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

        let response = self
            .client
            .post(&self.chat_url())
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to GitHub Models: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("GitHub Models API error ({}): {}", status, body));
        }

        let result: ChatCompletionResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse GitHub Models response: {}", e))?;

        let content = result
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or("No response from GitHub Models")?;

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
    fn test_copilot_models() {
        assert!(COPILOT_MODELS.contains(&"gpt-4o"));
        assert!(COPILOT_MODELS.contains(&"gpt-4o-mini"));
    }

    #[test]
    fn test_parse_commit_message() {
        let result = parse_commit_message("fix: correct typo").unwrap();
        assert_eq!(result.summary, "fix: correct typo");
        assert!(result.body.is_none());
    }
}
