//! Commit template commands

use crate::error::{LeviathanError, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

/// A saved commit message template
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTemplate {
    pub id: String,
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub is_conventional: bool,
    pub created_at: i64,
}

/// Get the templates file path
fn get_templates_path() -> Result<PathBuf> {
    let data_dir = dirs::data_dir().ok_or_else(|| {
        LeviathanError::OperationFailed("Could not find data directory".to_string())
    })?;

    let app_dir = data_dir.join("leviathan");
    fs::create_dir_all(&app_dir).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to create app directory: {}", e))
    })?;

    Ok(app_dir.join("commit-templates.json"))
}

/// Load templates from file
fn load_templates() -> Result<Vec<CommitTemplate>> {
    let path = get_templates_path()?;

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to read templates file: {}", e))
    })?;

    serde_json::from_str(&content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse templates file: {}", e))
    })
}

/// Save templates to file
fn save_templates(templates: &[CommitTemplate]) -> Result<()> {
    let path = get_templates_path()?;

    let content = serde_json::to_string_pretty(templates).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to serialize templates: {}", e))
    })?;

    fs::write(&path, content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to write templates file: {}", e))
    })?;

    Ok(())
}

/// Get the commit template from git config or .gitmessage file
#[command]
pub async fn get_commit_template(path: String) -> Result<Option<String>> {
    let repo = git2::Repository::open(&path)
        .map_err(|e| LeviathanError::OperationFailed(e.message().to_string()))?;

    let config = repo
        .config()
        .map_err(|e| LeviathanError::OperationFailed(e.message().to_string()))?;

    // Try to get commit.template from git config
    if let Ok(template_path) = config.get_string("commit.template") {
        let template_path = if let Some(stripped) = template_path.strip_prefix("~/") {
            if let Some(home) = dirs::home_dir() {
                home.join(stripped)
            } else {
                PathBuf::from(&template_path)
            }
        } else if template_path.starts_with('/') || template_path.starts_with('\\') {
            PathBuf::from(&template_path)
        } else {
            // Relative to repo root
            PathBuf::from(&path).join(&template_path)
        };

        if template_path.exists() {
            let content = fs::read_to_string(&template_path).map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to read template file: {}", e))
            })?;
            return Ok(Some(content));
        }
    }

    // Try .gitmessage in repo root
    let gitmessage_path = PathBuf::from(&path).join(".gitmessage");
    if gitmessage_path.exists() {
        let content = fs::read_to_string(&gitmessage_path).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to read .gitmessage: {}", e))
        })?;
        return Ok(Some(content));
    }

    // Try global .gitmessage in home directory
    if let Some(home) = dirs::home_dir() {
        let global_gitmessage = home.join(".gitmessage");
        if global_gitmessage.exists() {
            let content = fs::read_to_string(&global_gitmessage).map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to read global .gitmessage: {}", e))
            })?;
            return Ok(Some(content));
        }
    }

    Ok(None)
}

/// List all saved commit templates
#[command]
pub async fn list_templates() -> Result<Vec<CommitTemplate>> {
    load_templates()
}

/// Save a new commit template
#[command]
pub async fn save_template(template: CommitTemplate) -> Result<CommitTemplate> {
    let mut templates = load_templates()?;

    // Check if template with same ID exists
    if let Some(pos) = templates.iter().position(|t| t.id == template.id) {
        templates[pos] = template.clone();
    } else {
        templates.push(template.clone());
    }

    save_templates(&templates)?;
    Ok(template)
}

/// Delete a commit template by ID
#[command]
pub async fn delete_template(id: String) -> Result<()> {
    let mut templates = load_templates()?;
    templates.retain(|t| t.id != id);
    save_templates(&templates)?;
    Ok(())
}

/// Get default conventional commit types
#[command]
pub async fn get_conventional_types() -> Vec<ConventionalType> {
    vec![
        ConventionalType {
            type_name: "feat".to_string(),
            description: "A new feature".to_string(),
            emoji: Some("✨".to_string()),
        },
        ConventionalType {
            type_name: "fix".to_string(),
            description: "A bug fix".to_string(),
            emoji: Some("🐛".to_string()),
        },
        ConventionalType {
            type_name: "docs".to_string(),
            description: "Documentation only changes".to_string(),
            emoji: Some("📚".to_string()),
        },
        ConventionalType {
            type_name: "style".to_string(),
            description: "Code style changes (formatting, semicolons, etc)".to_string(),
            emoji: Some("💎".to_string()),
        },
        ConventionalType {
            type_name: "refactor".to_string(),
            description: "Code change that neither fixes a bug nor adds a feature".to_string(),
            emoji: Some("📦".to_string()),
        },
        ConventionalType {
            type_name: "perf".to_string(),
            description: "A code change that improves performance".to_string(),
            emoji: Some("🚀".to_string()),
        },
        ConventionalType {
            type_name: "test".to_string(),
            description: "Adding missing tests or correcting existing tests".to_string(),
            emoji: Some("🚨".to_string()),
        },
        ConventionalType {
            type_name: "build".to_string(),
            description: "Changes that affect the build system or dependencies".to_string(),
            emoji: Some("🛠".to_string()),
        },
        ConventionalType {
            type_name: "ci".to_string(),
            description: "Changes to CI configuration files and scripts".to_string(),
            emoji: Some("⚙️".to_string()),
        },
        ConventionalType {
            type_name: "chore".to_string(),
            description: "Other changes that don't modify src or test files".to_string(),
            emoji: Some("♻️".to_string()),
        },
        ConventionalType {
            type_name: "revert".to_string(),
            description: "Reverts a previous commit".to_string(),
            emoji: Some("🗑".to_string()),
        },
    ]
}

/// A conventional commit type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConventionalType {
    pub type_name: String,
    pub description: String,
    pub emoji: Option<String>,
}
