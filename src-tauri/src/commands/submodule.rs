//! Submodule command handlers
//! Manage git submodules

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

/// Information about a submodule
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    /// Name of the submodule
    pub name: String,
    /// Path relative to the repo root
    pub path: String,
    /// URL of the submodule repository
    pub url: Option<String>,
    /// Current HEAD commit of the submodule
    pub head_oid: Option<String>,
    /// Branch being tracked (if any)
    pub branch: Option<String>,
    /// Whether the submodule is initialized
    pub initialized: bool,
    /// Status of the submodule
    pub status: SubmoduleStatus,
}

/// Status of a submodule
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleStatus {
    /// Submodule is up to date
    Current,
    /// Submodule has a different commit checked out than recorded
    Modified,
    /// Submodule is not initialized
    Uninitialized,
    /// Submodule path doesn't exist
    Missing,
    /// Submodule has local changes
    Dirty,
}

/// Helper to run git commands
fn run_git_command(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = create_command("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run git: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        Err(LeviathanError::OperationFailed(
            if stderr.is_empty() { stdout } else { stderr }
                .trim()
                .to_string(),
        ))
    }
}

/// Get list of submodules in the repository
#[command]
pub async fn get_submodules(path: String) -> Result<Vec<Submodule>> {
    let repo_path = Path::new(&path);
    let repo = git2::Repository::open(repo_path)?;

    let mut submodules = Vec::new();

    // Iterate through submodules
    for submodule in repo.submodules()? {
        let name = submodule.name().unwrap_or("").to_string();
        let sm_path = submodule.path().to_string_lossy().to_string();
        let url = submodule.url().map(|s| s.to_string());
        let branch = submodule.branch().map(|s| s.to_string());

        // Determine status
        let status = match submodule.open() {
            Ok(sub_repo) => {
                // Submodule is initialized
                let head_id = sub_repo.head().ok().and_then(|h| h.target());
                let index_id = submodule.index_id();

                if head_id != index_id {
                    SubmoduleStatus::Modified
                } else {
                    // Check for local changes
                    let statuses = sub_repo.statuses(Some(
                        git2::StatusOptions::new()
                            .include_untracked(true)
                            .recurse_untracked_dirs(false),
                    ));

                    if let Ok(statuses) = statuses {
                        if statuses.iter().any(|s| !s.status().is_empty()) {
                            SubmoduleStatus::Dirty
                        } else {
                            SubmoduleStatus::Current
                        }
                    } else {
                        SubmoduleStatus::Current
                    }
                }
            }
            Err(_) => {
                // Check if path exists
                let full_path = repo_path.join(submodule.path());
                if full_path.exists() {
                    SubmoduleStatus::Uninitialized
                } else {
                    SubmoduleStatus::Missing
                }
            }
        };

        let initialized = matches!(
            status,
            SubmoduleStatus::Current | SubmoduleStatus::Modified | SubmoduleStatus::Dirty
        );

        let head_oid = if initialized {
            submodule.open().ok().and_then(|r| {
                r.head()
                    .ok()
                    .and_then(|h| h.target())
                    .map(|id| id.to_string())
            })
        } else {
            None
        };

        submodules.push(Submodule {
            name,
            path: sm_path,
            url,
            head_oid,
            branch,
            initialized,
            status,
        });
    }

    Ok(submodules)
}

/// Add a new submodule
#[command]
pub async fn add_submodule(
    path: String,
    url: String,
    submodule_path: String,
    branch: Option<String>,
) -> Result<Submodule> {
    let repo_path = Path::new(&path);

    let mut args = vec!["submodule", "add"];

    if let Some(ref b) = branch {
        args.push("-b");
        args.push(b);
    }

    args.push(&url);
    args.push(&submodule_path);

    run_git_command(repo_path, &args)?;

    // Get the newly added submodule
    let repo = git2::Repository::open(repo_path)?;
    let submodule = repo.find_submodule(&submodule_path)?;

    Ok(Submodule {
        name: submodule.name().unwrap_or("").to_string(),
        path: submodule.path().to_string_lossy().to_string(),
        url: submodule.url().map(|s| s.to_string()),
        head_oid: None,
        branch,
        initialized: false,
        status: SubmoduleStatus::Uninitialized,
    })
}

/// Initialize submodules
#[command]
pub async fn init_submodules(path: String, submodule_paths: Option<Vec<String>>) -> Result<()> {
    let repo_path = Path::new(&path);

    let mut args = vec!["submodule", "init"];

    let paths_owned: Vec<String>;
    if let Some(ref paths) = submodule_paths {
        paths_owned = paths.clone();
        for p in &paths_owned {
            args.push(p);
        }
    }

    run_git_command(repo_path, &args)?;
    Ok(())
}

/// Update submodules
#[command]
pub async fn update_submodules(
    path: String,
    submodule_paths: Option<Vec<String>>,
    init: Option<bool>,
    recursive: Option<bool>,
    remote: Option<bool>,
    token: Option<String>,
) -> Result<()> {
    // Note: Standard git submodule update command doesn't easily accept a token argument
    // since it shells out to git commands internally for each submodule.
    // However, if we are authenticated via git-credential-manager or similar, it should work.
    // For our specific token injection, it's more complex with submodules as they might reside on different hosts.
    //
    // Ideally, we would configure the credential helper for the duration of this command
    // or pass the token via environment variable if we were using a custom helper.
    //
    // For now, we'll proceed without explicit token injection for submodules,
    // relying on the credential manager/helper being set up correctly,
    // BUT we will log a warning if a token was provided but can't be used easily here.

    if token.is_some() {
        tracing::warn!("Token provided for update_submodules but explicit token injection is not yet fully supported for submodules. Operation may fail if credentials are not in keychain.");
    }

    let repo_path = Path::new(&path);

    let mut args = vec!["submodule", "update"];

    if init.unwrap_or(false) {
        args.push("--init");
    }

    if recursive.unwrap_or(false) {
        args.push("--recursive");
    }

    if remote.unwrap_or(false) {
        args.push("--remote");
    }

    let paths_owned: Vec<String>;
    if let Some(ref paths) = submodule_paths {
        paths_owned = paths.clone();
        args.push("--");
        for p in &paths_owned {
            args.push(p);
        }
    }

    run_git_command(repo_path, &args)?;
    Ok(())
}

/// Sync submodule URLs from .gitmodules to .git/config
#[command]
pub async fn sync_submodules(path: String, submodule_paths: Option<Vec<String>>) -> Result<()> {
    let repo_path = Path::new(&path);

    let mut args = vec!["submodule", "sync"];

    let paths_owned: Vec<String>;
    if let Some(ref paths) = submodule_paths {
        paths_owned = paths.clone();
        for p in &paths_owned {
            args.push(p);
        }
    }

    run_git_command(repo_path, &args)?;
    Ok(())
}

/// Deinitialize a submodule (remove from working tree but keep in .gitmodules)
#[command]
pub async fn deinit_submodule(
    path: String,
    submodule_path: String,
    force: Option<bool>,
) -> Result<()> {
    let repo_path = Path::new(&path);

    let mut args = vec!["submodule", "deinit"];

    if force.unwrap_or(false) {
        args.push("-f");
    }

    args.push(&submodule_path);

    run_git_command(repo_path, &args)?;
    Ok(())
}

/// Remove a submodule completely
#[command]
pub async fn remove_submodule(path: String, submodule_path: String) -> Result<()> {
    let repo_path = Path::new(&path);

    // Step 1: Deinit the submodule
    run_git_command(repo_path, &["submodule", "deinit", "-f", &submodule_path])?;

    // Step 2: Remove from .git/modules
    let git_modules_path = repo_path.join(".git").join("modules").join(&submodule_path);
    if git_modules_path.exists() {
        std::fs::remove_dir_all(&git_modules_path).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to remove .git/modules: {}", e))
        })?;
    }

    // Step 3: Remove from working tree and index
    run_git_command(repo_path, &["rm", "-f", &submodule_path])?;

    Ok(())
}

/// Get the status summary of a specific submodule
#[command]
pub async fn get_submodule_status(path: String, submodule_path: String) -> Result<String> {
    let repo_path = Path::new(&path);

    let output = run_git_command(repo_path, &["submodule", "status", &submodule_path])?;

    Ok(output)
}

/// Foreach - run a command in each submodule
#[command]
pub async fn submodule_foreach(
    path: String,
    command: String,
    recursive: Option<bool>,
) -> Result<String> {
    let repo_path = Path::new(&path);

    let mut args = vec!["submodule", "foreach"];

    if recursive.unwrap_or(false) {
        args.push("--recursive");
    }

    args.push(&command);

    run_git_command(repo_path, &args)
}
