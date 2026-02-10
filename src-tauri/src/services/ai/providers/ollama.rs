//! Ollama AI provider
//!
//! Supports locally running Ollama at localhost:11434

use crate::services::ai::{
    AiProvider, AiProviderType, GeneratedCommitMessage, COMMIT_MESSAGE_PROMPT,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Ollama API request for generation
#[derive(Serialize)]
struct OllamaGenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
}

/// Ollama API response for generation
#[derive(Deserialize)]
struct OllamaGenerateResponse {
    response: String,
}

/// Ollama API response for listing models
#[derive(Deserialize)]
struct OllamaModelsResponse {
    models: Vec<OllamaModel>,
}

/// Ollama model info
#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

/// Ollama provider implementation
pub struct OllamaProvider {
    endpoint: String,
    client: reqwest::Client,
}

impl OllamaProvider {
    /// Create a new Ollama provider
    pub fn new(endpoint: String) -> Self {
        Self {
            endpoint,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl AiProvider for OllamaProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::Ollama
    }

    fn name(&self) -> &str {
        "Ollama"
    }

    async fn is_available(&self) -> bool {
        // Try to list models - if we get a response, Ollama is running
        let url = format!("{}/api/tags", self.endpoint);

        match self
            .client
            .get(&url)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    async fn list_models(&self) -> Result<Vec<String>, String> {
        let url = format!("{}/api/tags", self.endpoint);

        let response = self
            .client
            .get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Ollama returned error: {}", response.status()));
        }

        let models: OllamaModelsResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        Ok(models.models.into_iter().map(|m| m.name).collect())
    }

    async fn generate_commit_message(
        &self,
        diff: &str,
        model: Option<&str>,
    ) -> Result<GeneratedCommitMessage, String> {
        let model_name = model.unwrap_or(AiProviderType::Ollama.default_model());
        let url = format!("{}/api/generate", self.endpoint);

        let prompt = format!("{}{}\n\nCommit message:", COMMIT_MESSAGE_PROMPT, diff);

        let request = OllamaGenerateRequest {
            model: model_name.to_string(),
            prompt,
            stream: false,
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama error ({}): {}", status, body));
        }

        let result: OllamaGenerateResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        // Parse the response into summary and optional body
        let text = result.response.trim();
        parse_commit_message(text)
    }

    async fn generate_text(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        model: Option<&str>,
        _max_tokens: Option<u32>,
    ) -> Result<String, String> {
        let model_name = model.unwrap_or(AiProviderType::Ollama.default_model());
        let url = format!("{}/api/generate", self.endpoint);

        let prompt = format!("{}\n\n{}", system_prompt, user_prompt);

        let request = OllamaGenerateRequest {
            model: model_name.to_string(),
            prompt,
            stream: false,
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama error ({}): {}", status, body));
        }

        let result: OllamaGenerateResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        Ok(result.response.trim().to_string())
    }
}

/// Parse raw AI response into structured commit message
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

    #[test]
    fn test_parse_commit_message_simple() {
        let result = parse_commit_message("fix: resolve login issue").unwrap();
        assert_eq!(result.summary, "fix: resolve login issue");
        assert!(result.body.is_none());
    }

    #[test]
    fn test_parse_commit_message_with_body() {
        let text =
            "feat: add user authentication\n\nThis implements JWT-based auth\nwith refresh tokens.";
        let result = parse_commit_message(text).unwrap();
        assert_eq!(result.summary, "feat: add user authentication");
        assert!(result.body.is_some());
        assert!(result.body.unwrap().contains("JWT-based"));
    }

    #[test]
    fn test_parse_commit_message_empty() {
        let result = parse_commit_message("");
        assert!(result.is_err());
    }
}
