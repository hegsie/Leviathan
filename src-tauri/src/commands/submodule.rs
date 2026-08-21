//! Submodule command handlers
//! Manage git submodules

use std::path::Path;
use std::process::Command;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::cli_safety::reject_flag_like;
use crate::utils::{apply_token_credential_helper, create_command};

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

/// Build the `git` command for a submodule operation, optionally carrying an
/// auth token.
///
/// The token is fed to git through a credential helper in the environment, so
/// the per-submodule `git clone` / `git fetch` children that `git submodule
/// update` spawns inherit it too.
fn submodule_command(repo_path: &Path, args: &[&str], token: Option<&str>) -> Command {
    let mut cmd = create_command("git");
    cmd.current_dir(repo_path).args(args);
    if let Some(token_value) = token {
        apply_token_credential_helper(&mut cmd, token_value);
    }
    cmd
}

/// Helper to run git commands
fn run_git_command(repo_path: &Path, args: &[&str]) -> Result<String> {
    run_git_command_with_token(repo_path, args, None)
}

/// Helper to run git commands, authenticating with `token` when one is given.
fn run_git_command_with_token(
    repo_path: &Path,
    args: &[&str],
    token: Option<&str>,
) -> Result<String> {
    let output = submodule_command(repo_path, args, token)
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

    reject_flag_like(&url, "Submodule URL")?;
    reject_flag_like(&submodule_path, "Submodule path")?;
    if let Some(ref b) = branch {
        reject_flag_like(b, "Submodule branch")?;
    }

    let mut args = vec!["submodule", "add"];

    if let Some(ref b) = branch {
        args.push("-b");
        args.push(b);
    }

    args.push("--");
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
            reject_flag_like(p, "Submodule path")?;
        }
        args.push("--");
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
    // The token the frontend looked up (git.service.ts updateSubmodules) used
    // to be logged and dropped here, so `git submodule update` ran with
    // GIT_TERMINAL_PROMPT=0 and no credential at all: Init, Update and Update
    // All failed on a private submodule for exactly the users whose fetch and
    // push succeed. It now goes to git as a credential helper in the
    // environment, which the per-submodule clone/fetch children inherit.

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
        for p in &paths_owned {
            reject_flag_like(p, "Submodule path")?;
        }
        args.push("--");
        for p in &paths_owned {
            args.push(p);
        }
    }

    run_git_command_with_token(repo_path, &args, token.as_deref())?;
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
            reject_flag_like(p, "Submodule path")?;
        }
        args.push("--");
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

    reject_flag_like(&submodule_path, "Submodule path")?;

    let mut args = vec!["submodule", "deinit"];

    if force.unwrap_or(false) {
        args.push("-f");
    }

    args.push("--");
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

    // The path comes from .gitmodules, which is repository content — a clone
    // from an untrusted source can declare `path = --all`, and
    // `git submodule deinit -f --all` clears and unregisters EVERY submodule,
    // discarding uncommitted work in each, while the confirm named only one.
    // `--` (plus the rejection) is what every other CLI-shelling command in
    // this codebase does; update_submodules one function away already did.
    reject_flag_like(&submodule_path, "Submodule path")?;

    // Step 1: Deinit the submodule
    run_git_command(
        repo_path,
        &["submodule", "deinit", "-f", "--", &submodule_path],
    )?;

    // Step 2: Remove from working tree and index (keeps .git/modules for recovery)
    run_git_command(repo_path, &["rm", "-f", "--", &submodule_path])?;

    Ok(())
}

/// Get the status summary of a specific submodule
#[command]
pub async fn get_submodule_status(path: String, submodule_path: String) -> Result<String> {
    let repo_path = Path::new(&path);

    reject_flag_like(&submodule_path, "Submodule path")?;

    let output = run_git_command(repo_path, &["submodule", "status", "--", &submodule_path])?;

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
    use std::io::Write;
    use std::process::Stdio;

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

    /// A submodule path comes from .gitmodules, which is repository content.
    /// A clone from an untrusted source can declare `path = --all`, and
    /// `git submodule deinit -f --all` clears and unregisters EVERY submodule
    /// — discarding uncommitted work in each — while the confirm the user saw
    /// named exactly one.
    #[tokio::test]
    async fn test_remove_submodule_rejects_a_flag_like_path() {
        let source = TestRepo::with_initial_commit();
        let super_repo = TestRepo::with_initial_commit();
        let super_path = super_repo.path.clone();
        let source_url = source.path.to_string_lossy().to_string();

        git_in(&super_path, &["submodule", "add", &source_url, "keep/one"]);
        git_in(&super_path, &["submodule", "add", &source_url, "keep/two"]);
        git_in(&super_path, &["commit", "-m", "add submodules"]);

        // Uncommitted work inside one of them, which --all would discard.
        let one = super_path.join("keep").join("one");
        std::fs::write(one.join("scratch.txt"), "unsaved work").unwrap();

        let err = remove_submodule(super_repo.path_str(), "--all".to_string())
            .await
            .expect_err("a flag-like path must never reach git as a positional");
        assert!(
            err.to_string().contains("must not start with '-'"),
            "unexpected error: {}",
            err
        );

        // Both submodules survive, with the uncommitted work intact.
        assert!(
            one.join("scratch.txt").exists(),
            "uncommitted work discarded"
        );
        assert_eq!(
            std::fs::read_to_string(one.join("scratch.txt")).unwrap(),
            "unsaved work"
        );
        assert!(
            super_path
                .join("keep")
                .join("two")
                .join("README.md")
                .exists(),
            "the other submodule's working tree was cleared"
        );
    }

    #[tokio::test]
    async fn test_deinit_and_status_reject_a_flag_like_path() {
        let repo = TestRepo::with_initial_commit();

        for err in [
            deinit_submodule(repo.path_str(), "--all".to_string(), Some(true))
                .await
                .expect_err("deinit must reject a flag-like path"),
            get_submodule_status(repo.path_str(), "--all".to_string())
                .await
                .expect_err("status must reject a flag-like path"),
        ] {
            assert!(
                err.to_string().contains("must not start with '-'"),
                "unexpected error: {}",
                err
            );
        }
    }

    #[tokio::test]
    async fn test_add_submodule_rejects_a_flag_like_url() {
        let repo = TestRepo::with_initial_commit();

        let err = add_submodule(
            repo.path_str(),
            "--upload-pack=touch /tmp/pwned".to_string(),
            "deps/lib".to_string(),
            None,
        )
        .await
        .expect_err("a flag-like URL is the classic RCE vector");
        assert!(
            err.to_string().contains("must not start with '-'"),
            "unexpected error: {}",
            err
        );
    }

    /// The token the frontend sends must actually reach the per-submodule git
    /// process. `git submodule update` clones and fetches each submodule in a
    /// CHILD process, so the credential has to travel in the environment —
    /// this observes what that child was handed via git's own supported
    /// `submodule.<name>.update = !command` hook.
    #[cfg(unix)]
    #[tokio::test]
    async fn test_update_submodules_feeds_the_token_to_the_submodule_git_process() {
        let source = TestRepo::with_initial_commit();
        let super_repo = TestRepo::with_initial_commit();
        let super_path = super_repo.path.clone();

        let source_url = source.path.to_string_lossy().to_string();
        git_in(&super_path, &["submodule", "add", &source_url, "deps/lib"]);
        git_in(&super_path, &["commit", "-m", "add submodule"]);

        // Advance the submodule and record the new pointer in the superproject,
        // so `git submodule update` has work to do.
        let sub_path = super_path.join("deps").join("lib");
        git_in(&sub_path, &["config", "user.email", "test@example.com"]);
        git_in(&sub_path, &["config", "user.name", "Test User"]);
        let old_oid = git_in(&sub_path, &["rev-parse", "HEAD"]);
        std::fs::write(sub_path.join("v2.txt"), "v2").unwrap();
        git_in(&sub_path, &["add", "v2.txt"]);
        git_in(&sub_path, &["commit", "-m", "v2"]);
        git_in(&super_path, &["add", "deps/lib"]);
        git_in(&super_path, &["commit", "-m", "bump submodule"]);

        // Move the submodule back. The recorded commit is already present
        // locally, so git needs no fetch — but the shas differ, which is what
        // makes git run the update command below.
        git_in(&sub_path, &["checkout", "--detach", &old_oid]);

        // `!command` update mode is honoured from .git/config (git refuses it
        // from .gitmodules), and git runs it in a child process — exactly the
        // process the token has to reach.
        let out_dir = tempfile::tempdir().unwrap();
        let seen = out_dir.path().join("token-seen.txt");
        let update_cmd = format!(
            "!sh -c 'printf \"%s\" \"$LEVIATHAN_GIT_TOKEN\" > \"{}\"'",
            seen.display()
        );
        git_in(
            &super_path,
            &["config", "submodule.deps/lib.update", &update_cmd],
        );

        let result = update_submodules(
            super_repo.path_str(),
            Some(vec!["deps/lib".to_string()]),
            None,
            None,
            None,
            Some("ghp_test_token".to_string()),
        )
        .await;
        assert!(
            result.is_ok(),
            "update_submodules failed: {:?}",
            result.err()
        );

        let recorded =
            std::fs::read_to_string(&seen).expect("the submodule update command never ran");
        assert_eq!(
            recorded, "ghp_test_token",
            "update_submodules dropped the token instead of feeding it to the submodule's git process"
        );
    }

    /// Injecting an env var git never reads, or a helper string that does not
    /// expand, would authenticate with garbage just as silently as sending no
    /// credential at all — the exact regression remote.rs documents. Ask git
    /// itself what the injected helper resolves to.
    #[cfg(unix)]
    #[tokio::test]
    async fn test_submodule_command_credential_helper_answers_with_the_token() {
        let repo = TestRepo::with_initial_commit();

        let mut cmd = submodule_command(&repo.path, &["credential", "fill"], Some("ghp_secret"));
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().expect("failed to spawn git credential fill");
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(b"protocol=https\nhost=example.com\n\n")
            .unwrap();
        let output = child.wait_with_output().unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();

        assert!(
            stdout.contains("username=git"),
            "git did not resolve a username from the injected helper: {}",
            stdout
        );
        assert!(
            stdout.contains("password=ghp_secret"),
            "git did not resolve the token from the injected helper: {}",
            stdout
        );
    }

    /// With no token stored — a configuration that works today — nothing may be
    /// injected: an unconditional injection would hand git an empty password
    /// and shadow the user's own credential helper.
    #[tokio::test]
    async fn test_submodule_command_without_a_token_injects_nothing() {
        let repo = TestRepo::with_initial_commit();

        let cmd = submodule_command(&repo.path, &["submodule", "update"], None);
        let keys: Vec<String> = cmd
            .get_envs()
            .map(|(k, _)| k.to_string_lossy().to_string())
            .collect();

        assert!(
            !keys.iter().any(|k| k == "GIT_CONFIG_COUNT"),
            "a tokenless update must not clobber GIT_CONFIG_COUNT or shadow the user's credential helper"
        );
        assert!(
            !keys.iter().any(|k| k == "LEVIATHAN_GIT_TOKEN"),
            "a tokenless update must not export an empty token"
        );
    }

    /// Carrying a token must not bypass argument validation, and must not turn
    /// a git failure into a swallowed success.
    #[tokio::test]
    async fn test_update_submodules_with_a_token_still_reports_errors() {
        let repo = TestRepo::with_initial_commit();

        let err = update_submodules(
            repo.path_str(),
            Some(vec!["--all".to_string()]),
            None,
            None,
            None,
            Some("ghp_test_token".to_string()),
        )
        .await
        .expect_err("a flag-like path must never reach git as a positional");
        assert!(
            err.to_string().contains("must not start with '-'"),
            "unexpected error: {}",
            err
        );

        let tmp = tempfile::tempdir().unwrap();
        assert!(
            update_submodules(
                tmp.path().to_string_lossy().to_string(),
                None,
                None,
                None,
                None,
                Some("ghp_test_token".to_string()),
            )
            .await
            .is_err(),
            "a git failure must still reach the user when a token is present"
        );
    }
}
