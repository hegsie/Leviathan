//! Git Hooks management command handlers
//! View, edit, enable/disable git hooks

use std::path::Path;
use tauri::command;

use crate::error::Result;

/// A git hook
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHook {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub enabled: bool,
    pub content: Option<String>,
    pub description: String,
}

/// Known hook names and their descriptions
const HOOKS: &[(&str, &str)] = &[
    (
        "pre-commit",
        "Run before a commit is created. Can prevent the commit.",
    ),
    (
        "prepare-commit-msg",
        "Run after the default commit message is created, before the editor.",
    ),
    (
        "commit-msg",
        "Run after the commit message is entered. Can modify or reject it.",
    ),
    (
        "post-commit",
        "Run after a commit is created. Used for notifications.",
    ),
    ("pre-rebase", "Run before rebase. Can prevent the rebase."),
    (
        "post-rewrite",
        "Run after commands that rewrite commits (rebase, amend).",
    ),
    (
        "post-checkout",
        "Run after checkout. Used for environment setup.",
    ),
    (
        "post-merge",
        "Run after a merge. Used for dependency installation.",
    ),
    ("pre-push", "Run before push. Can prevent the push."),
    ("pre-receive", "Server-side. Run before accepting a push."),
    ("update", "Server-side. Run once per branch being pushed."),
    ("post-receive", "Server-side. Run after accepting a push."),
    ("pre-auto-gc", "Run before automatic garbage collection."),
    ("pre-applypatch", "Run before applying a patch with git am."),
    ("post-applypatch", "Run after applying a patch with git am."),
];

/// Get all hooks for a repository
#[command]
pub async fn get_hooks(path: String) -> Result<Vec<GitHook>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let git_dir = repo.path();
    let hooks_dir = git_dir.join("hooks");

    let mut hooks = Vec::new();

    for (name, description) in HOOKS {
        let hook_path = hooks_dir.join(name);
        let sample_path = hooks_dir.join(format!("{}.sample", name));

        let exists = hook_path.exists();
        let content = if exists {
            std::fs::read_to_string(&hook_path).ok()
        } else if sample_path.exists() {
            // Return sample content as reference
            None
        } else {
            None
        };

        let enabled = exists;

        hooks.push(GitHook {
            name: name.to_string(),
            path: hook_path.to_string_lossy().to_string(),
            exists,
            enabled,
            content,
            description: description.to_string(),
        });
    }

    Ok(hooks)
}

/// Get a specific hook
#[command]
pub async fn get_hook(path: String, name: String) -> Result<GitHook> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let git_dir = repo.path();
    let hook_path = git_dir.join("hooks").join(&name);

    let exists = hook_path.exists();
    let content = if exists {
        std::fs::read_to_string(&hook_path).ok()
    } else {
        None
    };

    let description = HOOKS
        .iter()
        .find(|(n, _)| *n == name.as_str())
        .map(|(_, d)| d.to_string())
        .unwrap_or_default();

    let enabled = exists;

    Ok(GitHook {
        name,
        path: hook_path.to_string_lossy().to_string(),
        exists,
        enabled,
        content,
        description,
    })
}

/// Save a hook script
#[command]
pub async fn save_hook(path: String, name: String, content: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let git_dir = repo.path();
    let hooks_dir = git_dir.join("hooks");

    // Ensure hooks directory exists
    std::fs::create_dir_all(&hooks_dir)?;

    let hook_path = hooks_dir.join(&name);
    std::fs::write(&hook_path, &content)?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&hook_path)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&hook_path, perms)?;
    }

    Ok(())
}

/// Delete a hook
#[command]
pub async fn delete_hook(path: String, name: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let git_dir = repo.path();
    let hook_path = git_dir.join("hooks").join(&name);

    if hook_path.exists() {
        std::fs::remove_file(&hook_path)?;
    }

    Ok(())
}

/// Enable or disable a hook (by toggling execute permission or renaming)
#[command]
pub async fn toggle_hook(path: String, name: String, enabled: bool) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let git_dir = repo.path();
    let hook_path = git_dir.join("hooks").join(&name);
    let disabled_path = git_dir.join("hooks").join(format!("{}.disabled", name));

    if enabled {
        // Enable: rename from .disabled if needed
        if disabled_path.exists() && !hook_path.exists() {
            std::fs::rename(&disabled_path, &hook_path)?;
        }

        // Make executable on Unix
        #[cfg(unix)]
        {
            if hook_path.exists() {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&hook_path)?.permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&hook_path, perms)?;
            }
        }
    } else {
        // Disable: rename to .disabled
        if hook_path.exists() {
            std::fs::rename(&hook_path, &disabled_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_hooks() {
        let repo = TestRepo::with_initial_commit();
        let result = get_hooks(repo.path_str()).await;
        assert!(result.is_ok());
        let hooks = result.unwrap();
        assert!(!hooks.is_empty());

        // All known hooks should be listed
        let names: Vec<&str> = hooks.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"pre-commit"));
        assert!(names.contains(&"commit-msg"));
        assert!(names.contains(&"pre-push"));
    }

    #[tokio::test]
    async fn test_save_and_get_hook() {
        let repo = TestRepo::with_initial_commit();
        let script = "#!/bin/sh\necho \"Pre-commit hook\"\nexit 0\n";

        let save_result = save_hook(
            repo.path_str(),
            "pre-commit".to_string(),
            script.to_string(),
        )
        .await;
        assert!(save_result.is_ok());

        let hook = get_hook(repo.path_str(), "pre-commit".to_string())
            .await
            .unwrap();
        assert!(hook.exists);
        assert!(hook.enabled);
        assert_eq!(hook.content.unwrap(), script);
    }

    #[tokio::test]
    async fn test_delete_hook() {
        let repo = TestRepo::with_initial_commit();
        save_hook(
            repo.path_str(),
            "pre-commit".to_string(),
            "#!/bin/sh\nexit 0\n".to_string(),
        )
        .await
        .unwrap();

        let result = delete_hook(repo.path_str(), "pre-commit".to_string()).await;
        assert!(result.is_ok());

        let hook = get_hook(repo.path_str(), "pre-commit".to_string())
            .await
            .unwrap();
        assert!(!hook.exists);
    }

    #[tokio::test]
    async fn test_toggle_hook_disable() {
        let repo = TestRepo::with_initial_commit();
        save_hook(
            repo.path_str(),
            "pre-commit".to_string(),
            "#!/bin/sh\nexit 0\n".to_string(),
        )
        .await
        .unwrap();

        let result = toggle_hook(repo.path_str(), "pre-commit".to_string(), false).await;
        assert!(result.is_ok());

        // Hook should be disabled (renamed to .disabled)
        let git_dir = repo.path.join(".git").join("hooks");
        assert!(!git_dir.join("pre-commit").exists());
        assert!(git_dir.join("pre-commit.disabled").exists());
    }

    #[tokio::test]
    async fn test_toggle_hook_enable() {
        let repo = TestRepo::with_initial_commit();
        save_hook(
            repo.path_str(),
            "pre-commit".to_string(),
            "#!/bin/sh\nexit 0\n".to_string(),
        )
        .await
        .unwrap();

        // Disable first
        toggle_hook(repo.path_str(), "pre-commit".to_string(), false)
            .await
            .unwrap();

        // Enable again
        let result = toggle_hook(repo.path_str(), "pre-commit".to_string(), true).await;
        assert!(result.is_ok());

        let git_dir = repo.path.join(".git").join("hooks");
        assert!(git_dir.join("pre-commit").exists());
        assert!(!git_dir.join("pre-commit.disabled").exists());
    }

    #[tokio::test]
    async fn test_get_hook_nonexistent() {
        let repo = TestRepo::with_initial_commit();
        let hook = get_hook(repo.path_str(), "pre-commit".to_string())
            .await
            .unwrap();
        assert!(!hook.exists);
        assert!(!hook.enabled);
        assert!(hook.content.is_none());
    }

    #[tokio::test]
    async fn test_delete_nonexistent_hook() {
        let repo = TestRepo::with_initial_commit();
        let result = delete_hook(repo.path_str(), "pre-commit".to_string()).await;
        assert!(result.is_ok()); // Should not error
    }
}
