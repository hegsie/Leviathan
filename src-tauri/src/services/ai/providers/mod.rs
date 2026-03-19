//! AI provider implementations

mod anthropic;
mod gemini;
mod github_copilot;
mod local_inference;
mod ollama;
mod openai_compatible;

pub use anthropic::AnthropicProvider;
pub use gemini::GeminiProvider;
pub use github_copilot::GithubCopilotProvider;
pub use local_inference::{
    InferenceEngine, LoadedModelMeta, LocalInferenceProvider, LocalModelStatus,
};
pub use ollama::OllamaProvider;
pub use openai_compatible::OpenAiCompatibleProvider;
