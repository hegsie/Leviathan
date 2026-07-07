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
        let name = submodule.name().ok().unwrap_or("").to_string();
        let sm_path = submodule.path().to_string_lossy().to_string();
        let url = submodule.url().ok().flatten().map(|s| s.to_string());
        let branch = submodule.branch().ok().flatten().map(|s| s.to_string());

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
        name: submodule.name().ok().unwrap_or("").to_string(),
        path: submodule.path().to_string_lossy().to_string(),
        url: submodule.url().ok().flatten().map(|s| s.to_string()),
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

    // Mirror canonical git submodule removal: `git submodule deinit -f <path>`
    // followed by `git rm -f <path>`. This removes the working tree, the
    // .gitmodules entry, and the index entry, but intentionally LEAVES the
    // submodule's object store under `.git/modules/<name>` intact so that any
    // local commits made inside the submodule that were never pushed remain
    // recoverable. Deleting `.git/modules/<name>` here (as a previous version
    // did) permanently destroyed those commits with no reflog and no recovery
    // path — a data-loss bug that canonical git never inflicts.

    // Step 1: Deinit the submodule
    run_git_command(repo_path, &["submodule", "deinit", "-f", &submodule_path])?;

    // Step 2: Remove from working tree and index (keeps .git/modules for recovery)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_submodules_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_submodules(repo.path_str()).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_init_submodules_no_submodules() {
        let repo = TestRepo::with_initial_commit();
        // Init on repo with no submodules should succeed
        let result = init_submodules(repo.path_str(), None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_update_submodules_no_submodules() {
        let repo = TestRepo::with_initial_commit();
        // Update on repo with no submodules should succeed
        let result = update_submodules(repo.path_str(), None, None, None, None, None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_deinit_submodule_not_found() {
        let repo = TestRepo::with_initial_commit();
        // Deinit on nonexistent submodule should fail
        let result = deinit_submodule(repo.path_str(), "nonexistent".to_string(), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_submodule_status_not_found() {
        let repo = TestRepo::with_initial_commit();
        // Status on nonexistent submodule should fail
        let result = get_submodule_status(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_sync_submodules_no_submodules() {
        let repo = TestRepo::with_initial_commit();
        // Sync on repo with no submodules should succeed
        let result = sync_submodules(repo.path_str(), None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_submodule_foreach_no_submodules() {
        let repo = TestRepo::with_initial_commit();
        // Foreach with no submodules should succeed (just do nothing)
        let result = submodule_foreach(repo.path_str(), "pwd".to_string(), None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_add_submodule_invalid_url() {
        let repo = TestRepo::with_initial_commit();

        let result = add_submodule(
            repo.path_str(),
            "/nonexistent/path/to/repo".to_string(),
            "deps/invalid".to_string(),
            None,
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_submodule_status_enum_variants() {
        // Test that SubmoduleStatus serializes correctly
        let current = SubmoduleStatus::Current;
        let modified = SubmoduleStatus::Modified;
        let uninitialized = SubmoduleStatus::Uninitialized;
        let missing = SubmoduleStatus::Missing;
        let dirty = SubmoduleStatus::Dirty;

        // These should all be distinct debug representations
        assert_ne!(format!("{:?}", current), format!("{:?}", modified));
        assert_ne!(format!("{:?}", modified), format!("{:?}", uninitialized));
        assert_ne!(format!("{:?}", uninitialized), format!("{:?}", missing));
        assert_ne!(format!("{:?}", missing), format!("{:?}", dirty));
    }

    #[tokio::test]
    async fn test_submodule_struct_fields() {
        let submodule = Submodule {
            name: "test-submodule".to_string(),
            path: "libs/test".to_string(),
            url: Some("https://github.com/test/repo.git".to_string()),
            head_oid: Some("abc123".to_string()),
            branch: Some("main".to_string()),
            initialized: true,
            status: SubmoduleStatus::Current,
        };

        assert_eq!(submodule.name, "test-submodule");
        assert_eq!(submodule.path, "libs/test");
        assert_eq!(
            submodule.url,
            Some("https://github.com/test/repo.git".to_string())
        );
        assert!(submodule.initialized);
    }

    #[tokio::test]
    async fn test_init_submodules_with_paths() {
        let repo = TestRepo::with_initial_commit();
        // Init with specific paths on repo with no submodules should succeed
        let result =
            init_submodules(repo.path_str(), Some(vec!["nonexistent-path".to_string()])).await;
        // This may succeed or fail depending on git version
        // The important thing is it doesn't panic
        let _ = result;
    }

    #[tokio::test]
    async fn test_update_submodules_with_init() {
        let repo = TestRepo::with_initial_commit();
        // Update with init flag on repo with no submodules should succeed
        let result = update_submodules(
            repo.path_str(),
            None,
            Some(true), // init
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_update_submodules_with_recursive() {
        let repo = TestRepo::with_initial_commit();
        // Update with recursive flag on repo with no submodules should succeed
        let result = update_submodules(
            repo.path_str(),
            None,
            None,
            Some(true), // recursive
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_submodule_foreach_recursive() {
        let repo = TestRepo::with_initial_commit();
        // Foreach with recursive flag and no submodules should succeed
        let result = submodule_foreach(repo.path_str(), "echo test".to_string(), Some(true)).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_deinit_submodule_with_force() {
        let repo = TestRepo::with_initial_commit();
        // Deinit with force on nonexistent submodule should still fail
        let result = deinit_submodule(repo.path_str(), "nonexistent".to_string(), Some(true)).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_remove_submodule_not_found() {
        let repo = TestRepo::with_initial_commit();
        // Remove on nonexistent submodule should fail
        let result = remove_submodule(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    /// Run a git command in `dir`, panicking on failure. Enables local-file
    /// protocol so `submodule add ../path` works in the sandbox.
    fn git_in(dir: &Path, args: &[&str]) -> String {
        let output = create_command("git")
            .current_dir(dir)
            .arg("-c")
            .arg("protocol.file.allow=always")
            .args(args)
            .output()
            .expect("failed to spawn git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    /// Canonical `git rm`-based submodule removal preserves the submodule's
    /// object store under `.git/modules/<name>`, so unpushed commits made
    /// inside the submodule remain recoverable. remove_submodule must NOT
    /// destroy that object store.
    #[tokio::test]
    async fn test_remove_submodule_preserves_unpushed_commits() {
        // Source repository that will be used as the submodule.
        let source = TestRepo::with_initial_commit();

        // Superproject.
        let super_repo = TestRepo::with_initial_commit();
        let super_path = super_repo.path.clone();

        // Add the submodule at deps/lib and commit.
        let source_url = source.path.to_string_lossy().to_string();
        git_in(&super_path, &["submodule", "add", &source_url, "deps/lib"]);
        git_in(&super_path, &["commit", "-m", "add submodule"]);

        // Make a commit inside the submodule that is never pushed.
        let sub_path = super_path.join("deps").join("lib");
        git_in(&sub_path, &["config", "user.email", "test@example.com"]);
        git_in(&sub_path, &["config", "user.name", "Test User"]);
        std::fs::write(sub_path.join("local.txt"), "local work").unwrap();
        git_in(&sub_path, &["add", "local.txt"]);
        git_in(&sub_path, &["commit", "-m", "unpushed local work"]);
        let unpushed_oid = git_in(&sub_path, &["rev-parse", "HEAD"]);

        // Sanity: the object store exists before removal.
        let modules_dir = super_path.join(".git").join("modules").join("deps/lib");
        assert!(
            modules_dir.exists(),
            "submodule gitdir should exist before removal"
        );

        // Remove the submodule.
        let result = remove_submodule(super_repo.path_str(), "deps/lib".to_string()).await;
        assert!(
            result.is_ok(),
            "remove_submodule failed: {:?}",
            result.err()
        );

        // Working tree entry is gone...
        assert!(
            !super_path.join("deps").join("lib").exists(),
            "submodule working tree should be removed"
        );

        // ...but the object store is preserved and the unpushed commit is
        // still recoverable (matching canonical `git rm`).
        assert!(
            modules_dir.exists(),
            "remove_submodule destroyed .git/modules — unpushed commits are unrecoverable"
        );
        let obj_type = git_in(&modules_dir, &["cat-file", "-t", &unpushed_oid]);
        assert_eq!(
            obj_type, "commit",
            "unpushed submodule commit should remain recoverable after removal"
        );
    }
}
