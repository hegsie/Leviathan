//! Keyboard Shortcuts command handlers
//! Allow users to view and customize keyboard shortcuts

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::error::{LeviathanError, Result};

/// A keyboard shortcut definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardShortcut {
    pub action: String,
    pub label: String,
    pub shortcut: String,
    pub category: String,
    pub is_custom: bool,
}

/// User customizations stored on disk
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ShortcutCustomizations {
    pub shortcuts: std::collections::HashMap<String, String>,
}

/// Get the shortcuts config file path (app-level)
fn get_shortcuts_path() -> Result<PathBuf> {
    let data_dir = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let app_dir = data_dir.join("leviathan");
    fs::create_dir_all(&app_dir).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to create app directory: {}", e))
    })?;
    Ok(app_dir.join("keyboard_shortcuts.json"))
}

/// Load user customizations from disk
fn load_customizations() -> Result<ShortcutCustomizations> {
    let path = get_shortcuts_path()?;
    if !path.exists() {
        return Ok(ShortcutCustomizations::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to read shortcuts file: {}", e))
    })?;
    serde_json::from_str(&content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to parse shortcuts file: {}", e))
    })
}

/// Save user customizations to disk
fn save_customizations(customizations: &ShortcutCustomizations) -> Result<()> {
    let path = get_shortcuts_path()?;
    let content = serde_json::to_string_pretty(customizations).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to serialize shortcuts: {}", e))
    })?;
    fs::write(&path, content).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to write shortcuts file: {}", e))
    })?;
    Ok(())
}

/// Build the list of default keyboard shortcuts
fn build_default_shortcuts() -> Vec<KeyboardShortcut> {
    vec![
        // General
        KeyboardShortcut {
            action: "refresh".to_string(),
            label: "Refresh repository".to_string(),
            shortcut: "Ctrl+R".to_string(),
            category: "general".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "search".to_string(),
            label: "Search commits".to_string(),
            shortcut: "Ctrl+F".to_string(),
            category: "general".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "settings".to_string(),
            label: "Open settings".to_string(),
            shortcut: "Ctrl+,".to_string(),
            category: "general".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "command-palette".to_string(),
            label: "Open command palette".to_string(),
            shortcut: "Ctrl+P".to_string(),
            category: "general".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "shortcuts".to_string(),
            label: "Show keyboard shortcuts".to_string(),
            shortcut: "Shift+?".to_string(),
            category: "general".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "undo-history".to_string(),
            label: "Open undo history".to_string(),
            shortcut: "Ctrl+Z".to_string(),
            category: "general".to_string(),
            is_custom: false,
        },
        // Git
        KeyboardShortcut {
            action: "fetch".to_string(),
            label: "Fetch from remote".to_string(),
            shortcut: "Ctrl+Shift+F".to_string(),
            category: "git".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "pull".to_string(),
            label: "Pull from remote".to_string(),
            shortcut: "Ctrl+Shift+P".to_string(),
            category: "git".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "push".to_string(),
            label: "Push to remote".to_string(),
            shortcut: "Ctrl+Shift+U".to_string(),
            category: "git".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "commit".to_string(),
            label: "Commit staged changes".to_string(),
            shortcut: "Ctrl+Enter".to_string(),
            category: "git".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "stage-all".to_string(),
            label: "Stage all changes".to_string(),
            shortcut: "S".to_string(),
            category: "git".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "unstage-all".to_string(),
            label: "Unstage all changes".to_string(),
            shortcut: "U".to_string(),
            category: "git".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "new-branch".to_string(),
            label: "Create new branch".to_string(),
            shortcut: "Ctrl+Shift+N".to_string(),
            category: "git".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "stash".to_string(),
            label: "Create stash".to_string(),
            shortcut: "Ctrl+Shift+S".to_string(),
            category: "git".to_string(),
            is_custom: false,
        },
        // Navigation
        KeyboardShortcut {
            action: "nav-up".to_string(),
            label: "Previous commit".to_string(),
            shortcut: "ArrowUp".to_string(),
            category: "navigation".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "nav-down".to_string(),
            label: "Next commit".to_string(),
            shortcut: "ArrowDown".to_string(),
            category: "navigation".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "nav-first".to_string(),
            label: "First commit".to_string(),
            shortcut: "Home".to_string(),
            category: "navigation".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "nav-last".to_string(),
            label: "Last commit".to_string(),
            shortcut: "End".to_string(),
            category: "navigation".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "select".to_string(),
            label: "Select commit".to_string(),
            shortcut: "Enter".to_string(),
            category: "navigation".to_string(),
            is_custom: false,
        },
        // Editor / View
        KeyboardShortcut {
            action: "toggle-left-panel".to_string(),
            label: "Toggle left panel".to_string(),
            shortcut: "Ctrl+B".to_string(),
            category: "editor".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "toggle-right-panel".to_string(),
            label: "Toggle right panel".to_string(),
            shortcut: "Ctrl+J".to_string(),
            category: "editor".to_string(),
            is_custom: false,
        },
        KeyboardShortcut {
            action: "close-diff".to_string(),
            label: "Close diff/panel".to_string(),
            shortcut: "Escape".to_string(),
            category: "editor".to_string(),
            is_custom: false,
        },
    ]
}

/// Merge defaults with user customizations
fn merge_shortcuts(customizations: &ShortcutCustomizations) -> Vec<KeyboardShortcut> {
    let defaults = build_default_shortcuts();
    defaults
        .into_iter()
        .map(|mut s| {
            if let Some(custom_shortcut) = customizations.shortcuts.get(&s.action) {
                s.shortcut = custom_shortcut.clone();
                s.is_custom = true;
            }
            s
        })
        .collect()
}

/// Get all keyboard shortcuts (defaults merged with user customizations)
#[command]
pub async fn get_keyboard_shortcuts(path: Option<String>) -> Result<Vec<KeyboardShortcut>> {
    let _ = path; // Reserved for future repo-specific shortcuts
    let customizations = load_customizations()?;
    Ok(merge_shortcuts(&customizations))
}

/// Set a keyboard shortcut for an action
#[command]
pub async fn set_keyboard_shortcut(
    action: String,
    shortcut: String,
) -> Result<Vec<KeyboardShortcut>> {
    // Validate that action exists in defaults
    let defaults = build_default_shortcuts();
    if !defaults.iter().any(|s| s.action == action) {
        return Err(LeviathanError::OperationFailed(format!(
            "Unknown shortcut action: {}",
            action
        )));
    }

    let mut customizations = load_customizations()?;
    customizations.shortcuts.insert(action, shortcut);
    save_customizations(&customizations)?;
    Ok(merge_shortcuts(&customizations))
}

/// Reset all keyboard shortcuts to defaults
#[command]
pub async fn reset_keyboard_shortcuts() -> Result<Vec<KeyboardShortcut>> {
    let customizations = ShortcutCustomizations::default();
    save_customizations(&customizations)?;
    Ok(merge_shortcuts(&customizations))
}

/// Get default keyboard shortcuts (without any customizations)
#[command]
pub async fn get_default_shortcuts() -> Result<Vec<KeyboardShortcut>> {
    Ok(build_default_shortcuts())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyboard_shortcut_serialization() {
        let shortcut = KeyboardShortcut {
            action: "commit".to_string(),
            label: "Commit staged changes".to_string(),
            shortcut: "Ctrl+Enter".to_string(),
            category: "git".to_string(),
            is_custom: false,
        };

        let json = serde_json::to_string(&shortcut).expect("Failed to serialize");
        assert!(json.contains("isCustom"));
        assert!(!json.contains("is_custom"));

        let deserialized: KeyboardShortcut =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.action, "commit");
        assert_eq!(deserialized.label, "Commit staged changes");
        assert_eq!(deserialized.shortcut, "Ctrl+Enter");
        assert_eq!(deserialized.category, "git");
        assert!(!deserialized.is_custom);
    }

    #[test]
    fn test_default_shortcuts_exist() {
        let defaults = build_default_shortcuts();
        assert!(!defaults.is_empty());

        // Verify key shortcuts are present
        let actions: Vec<&str> = defaults.iter().map(|s| s.action.as_str()).collect();
        assert!(actions.contains(&"refresh"));
        assert!(actions.contains(&"search"));
        assert!(actions.contains(&"commit"));
        assert!(actions.contains(&"fetch"));
        assert!(actions.contains(&"pull"));
        assert!(actions.contains(&"push"));
        assert!(actions.contains(&"nav-up"));
        assert!(actions.contains(&"nav-down"));
        assert!(actions.contains(&"toggle-left-panel"));
    }

    #[test]
    fn test_default_shortcuts_categories() {
        let defaults = build_default_shortcuts();
        let categories: std::collections::HashSet<&str> =
            defaults.iter().map(|s| s.category.as_str()).collect();
        assert!(categories.contains("general"));
        assert!(categories.contains("git"));
        assert!(categories.contains("navigation"));
        assert!(categories.contains("editor"));
    }

    #[test]
    fn test_default_shortcuts_not_custom() {
        let defaults = build_default_shortcuts();
        assert!(defaults.iter().all(|s| !s.is_custom));
    }

    #[test]
    fn test_merge_shortcuts_no_customizations() {
        let customizations = ShortcutCustomizations::default();
        let merged = merge_shortcuts(&customizations);
        let defaults = build_default_shortcuts();
        assert_eq!(merged.len(), defaults.len());
        assert!(merged.iter().all(|s| !s.is_custom));
    }

    #[test]
    fn test_merge_shortcuts_with_customization() {
        let mut customizations = ShortcutCustomizations::default();
        customizations
            .shortcuts
            .insert("commit".to_string(), "Ctrl+Shift+Enter".to_string());

        let merged = merge_shortcuts(&customizations);
        let commit_shortcut = merged.iter().find(|s| s.action == "commit").unwrap();
        assert_eq!(commit_shortcut.shortcut, "Ctrl+Shift+Enter");
        assert!(commit_shortcut.is_custom);

        // Other shortcuts should remain unchanged
        let refresh_shortcut = merged.iter().find(|s| s.action == "refresh").unwrap();
        assert_eq!(refresh_shortcut.shortcut, "Ctrl+R");
        assert!(!refresh_shortcut.is_custom);
    }

    #[test]
    fn test_merge_shortcuts_unknown_customization_ignored() {
        let mut customizations = ShortcutCustomizations::default();
        customizations
            .shortcuts
            .insert("nonexistent-action".to_string(), "Ctrl+X".to_string());

        let merged = merge_shortcuts(&customizations);
        let defaults = build_default_shortcuts();
        // Should have same number of shortcuts (unknown customization doesn't add a new one)
        assert_eq!(merged.len(), defaults.len());
    }

    #[test]
    fn test_shortcut_customizations_serialization() {
        let mut customizations = ShortcutCustomizations::default();
        customizations
            .shortcuts
            .insert("commit".to_string(), "Ctrl+Shift+Enter".to_string());

        let json = serde_json::to_string(&customizations).expect("Failed to serialize");
        let deserialized: ShortcutCustomizations =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(
            deserialized.shortcuts.get("commit"),
            Some(&"Ctrl+Shift+Enter".to_string())
        );
    }

    #[tokio::test]
    async fn test_get_default_shortcuts_command() {
        let result = get_default_shortcuts().await;
        assert!(result.is_ok());
        let shortcuts = result.unwrap();
        assert!(!shortcuts.is_empty());
        assert!(shortcuts.iter().all(|s| !s.is_custom));
    }

    #[tokio::test]
    async fn test_get_keyboard_shortcuts_command() {
        let result = get_keyboard_shortcuts(None).await;
        assert!(result.is_ok());
        let shortcuts = result.unwrap();
        assert!(!shortcuts.is_empty());
    }

    #[tokio::test]
    async fn test_set_keyboard_shortcut_invalid_action() {
        let result =
            set_keyboard_shortcut("nonexistent-action".to_string(), "Ctrl+X".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_reset_keyboard_shortcuts_command() {
        let result = reset_keyboard_shortcuts().await;
        assert!(result.is_ok());
        let shortcuts = result.unwrap();
        assert!(shortcuts.iter().all(|s| !s.is_custom));
    }

    #[test]
    fn test_each_default_has_all_fields() {
        let defaults = build_default_shortcuts();
        for shortcut in &defaults {
            assert!(!shortcut.action.is_empty(), "action should not be empty");
            assert!(!shortcut.label.is_empty(), "label should not be empty");
            assert!(
                !shortcut.shortcut.is_empty(),
                "shortcut should not be empty"
            );
            assert!(
                !shortcut.category.is_empty(),
                "category should not be empty"
            );
        }
    }

    #[test]
    fn test_unique_actions() {
        let defaults = build_default_shortcuts();
        let mut actions = std::collections::HashSet::new();
        for shortcut in &defaults {
            assert!(
                actions.insert(&shortcut.action),
                "Duplicate action: {}",
                shortcut.action
            );
        }
    }
}
