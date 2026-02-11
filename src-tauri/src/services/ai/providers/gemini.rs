//! Google Gemini AI provider

use crate::services::ai::{
    AiProvider, AiProviderType, GeneratedCommitMessage, COMMIT_MESSAGE_PROMPT,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Gemini generateContent request
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentRequest {
    contents: Vec<Content>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<Content>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation_config: Option<GenerationConfig>,
}

/// Content block
#[derive(Serialize)]
struct Content {
    parts: Vec<Part>,
}

/// Part within content
#[derive(Serialize, Deserialize)]
struct Part {
    text: String,
}

/// Generation configuration
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationConfig {
    max_output_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

/// Gemini generateContent response
#[derive(Deserialize)]
struct GenerateContentResponse {
    candidates: Option<Vec<Candidate>>,
}

/// Candidate in response
#[derive(Deserialize)]
struct Candidate {
    content: Option<CandidateContent>,
}

/// Content within a candidate
#[derive(Deserialize)]
struct CandidateContent {
    parts: Option<Vec<Part>>,
}

/// Available Gemini models
const GEMINI_MODELS: &[&str] = &[
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
];

/// Google Gemini provider implementation
pub struct GeminiProvider {
    endpoint: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl GeminiProvider {
    /// Create a new Gemini provider
    pub fn new(endpoint: String, api_key: Option<String>) -> Self {
        Self {
            endpoint,
            api_key,
            client: reqwest::Client::new(),
        }
    }

    /// Build the generateContent endpoint URL for a given model
    fn generate_url(&self, model: &str) -> String {
        let base = self.endpoint.trim_end_matches('/');
        let key = self.api_key.as_deref().unwrap_or("");
        format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            base, model, key
        )
    }
}

#[async_trait]
impl AiProvider for GeminiProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::GoogleGemini
    }

    fn name(&self) -> &str {
        "Google Gemini"
    }

    async fn is_available(&self) -> bool {
        self.api_key.is_some()
    }

    async fn list_models(&self) -> Result<Vec<String>, String> {
        Ok(GEMINI_MODELS.iter().map(|s| s.to_string()).collect())
    }

    async fn generate_commit_message(
        &self,
        diff: &str,
        model: Option<&str>,
    ) -> Result<GeneratedCommitMessage, String> {
        let model_name = model.unwrap_or(AiProviderType::GoogleGemini.default_model());

        let request_body = GenerateContentRequest {
            contents: vec![Content {
                parts: vec![Part {
                    text: format!("{}{}", COMMIT_MESSAGE_PROMPT, diff),
                }],
            }],
            system_instruction: None,
            generation_config: Some(GenerationConfig {
                max_output_tokens: 256,
                temperature: None,
            }),
        };

        let response = self
            .client
            .post(self.generate_url(model_name))
            .header("content-type", "application/json")
            .json(&request_body)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Gemini: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Gemini API error ({}): {}", status, body));
        }

        let result: GenerateContentResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

        let content = result
            .candidates
            .as_ref()
            .and_then(|c| c.first())
            .and_then(|c| c.content.as_ref())
            .and_then(|c| c.parts.as_ref())
            .and_then(|p| p.first())
            .map(|p| p.text.clone())
            .ok_or("No response from Gemini")?;

        parse_commit_message(&content)
    }

    async fn generate_text(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        model: Option<&str>,
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        let model_name = model.unwrap_or(AiProviderType::GoogleGemini.default_model());

        let request_body = GenerateContentRequest {
            contents: vec![Content {
                parts: vec![Part {
                    text: user_prompt.to_string(),
                }],
            }],
            system_instruction: Some(Content {
                parts: vec![Part {
                    text: system_prompt.to_string(),
                }],
            }),
            generation_config: Some(GenerationConfig {
                max_output_tokens: max_tokens.unwrap_or(2048),
                temperature: None,
            }),
        };

        let response = self
            .client
            .post(self.generate_url(model_name))
            .header("content-type", "application/json")
            .json(&request_body)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Gemini: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Gemini API error ({}): {}", status, body));
        }

        let result: GenerateContentResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

        result
            .candidates
            .as_ref()
            .and_then(|c| c.first())
            .and_then(|c| c.content.as_ref())
            .and_then(|c| c.parts.as_ref())
            .and_then(|p| p.first())
            .map(|p| p.text.trim().to_string())
            .ok_or_else(|| "No response from Gemini".to_string())
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
    fn test_gemini_models() {
        assert!(GEMINI_MODELS.contains(&"gemini-2.0-flash"));
        assert!(GEMINI_MODELS.contains(&"gemini-1.5-pro"));
        assert!(GEMINI_MODELS.contains(&"gemini-2.0-flash-lite"));
        assert!(GEMINI_MODELS.contains(&"gemini-1.5-flash"));
    }

    #[test]
    fn test_parse_commit_message_simple() {
        let result = parse_commit_message("fix: correct typo in readme").unwrap();
        assert_eq!(result.summary, "fix: correct typo in readme");
        assert!(result.body.is_none());
    }

    #[test]
    fn test_parse_commit_message_with_body() {
        let result =
            parse_commit_message("feat: add user auth\n\nImplements JWT-based auth").unwrap();
        assert_eq!(result.summary, "feat: add user auth");
        assert_eq!(result.body.as_deref(), Some("Implements JWT-based auth"));
    }

    #[test]
    fn test_parse_commit_message_with_code_block() {
        let result = parse_commit_message("```\nfix: remove unused import\n```").unwrap();
        assert_eq!(result.summary, "fix: remove unused import");
    }

    #[test]
    fn test_parse_commit_message_empty() {
        let result = parse_commit_message("");
        assert!(result.is_err());
    }
}
