//! Git LFS command handlers
//! Manage large files with Git Large File Storage

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::{apply_token_credentials, create_command};

/// LFS file tracking pattern
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsPattern {
    /// The file pattern (e.g., "*.psd")
    pub pattern: String,
}

/// LFS file information
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsFile {
    /// File path
    pub path: String,
    /// LFS object ID (OID)
    pub oid: Option<String>,
    /// File size in bytes
    pub size: Option<u64>,
    /// Whether the file is downloaded (pointer vs actual)
    pub downloaded: bool,
}

/// LFS status information
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsStatus {
    /// Whether Git LFS is installed
    pub installed: bool,
    /// Git LFS version
    pub version: Option<String>,
    /// Whether LFS is enabled for this repo
    pub enabled: bool,
    /// Tracked patterns
    pub patterns: Vec<LfsPattern>,
    /// Number of LFS files
    pub file_count: u32,
    /// Total size of LFS files
    pub total_size: u64,
}

/// Build the `git lfs <args>` invocation, optionally authenticated.
///
/// `git lfs` resolves credentials by shelling out to `git credential`, which
/// inherits this process's environment — so the helper installed here reaches
/// the LFS API endpoint as well as the transfer itself.
fn build_lfs_command(
    repo_path: &Path,
    args: &[&str],
    token: Option<&str>,
) -> std::process::Command {
    let mut cmd = create_command("git");
    cmd.current_dir(repo_path).arg("lfs").args(args);

    if let Some(token_value) = token {
        apply_token_credentials(&mut cmd, token_value);
    }

    cmd
}

/// Helper to run git-lfs commands
fn run_lfs_command(repo_path: &Path, args: &[&str]) -> Result<String> {
    run_lfs_command_with_token(repo_path, args, None)
}

/// Helper to run git-lfs commands against an authenticated remote
fn run_lfs_command_with_token(
    repo_path: &Path,
    args: &[&str],
    token: Option<&str>,
) -> Result<String> {
    let output = build_lfs_command(repo_path, args, token)
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run git-lfs: {}", e)))?;

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

/// Check if Git LFS is installed
fn is_lfs_installed() -> bool {
    create_command("git")
        .arg("lfs")
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get LFS version
fn get_lfs_version() -> Option<String> {
    create_command("git")
        .arg("lfs")
        .arg("version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .lines()
                .next()
                .unwrap_or("")
                .to_string()
        })
}

/// Get LFS status for the repository
#[command]
pub async fn get_lfs_status(path: String) -> Result<LfsStatus> {
    let repo_path = Path::new(&path);
    let installed = is_lfs_installed();
    let version = get_lfs_version();

    if !installed {
        return Ok(LfsStatus {
            installed: false,
            version: None,
            enabled: false,
            patterns: Vec::new(),
            file_count: 0,
            total_size: 0,
        });
    }

    // Check if LFS is enabled (has .gitattributes with lfs filter)
    let gitattributes = repo_path.join(".gitattributes");
    let enabled = gitattributes.exists()
        && std::fs::read_to_string(&gitattributes)
            .map(|c| c.contains("filter=lfs"))
            .unwrap_or(false);

    // Get tracked patterns
    let patterns = if enabled {
        run_lfs_command(repo_path, &["track"])
            .ok()
            .map(|output| {
                output
                    .lines()
                    .filter_map(|line| {
                        // Lines like "    *.psd (.gitattributes)"
                        let line = line.trim();
                        if line.starts_with('*') || line.contains('.') {
                            Some(LfsPattern {
                                pattern: line.split_whitespace().next().unwrap_or(line).to_string(),
                            })
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    // Get file count and size
    let (file_count, total_size) = if enabled {
        run_lfs_command(repo_path, &["ls-files", "-s"])
            .ok()
            .map(|output| {
                let mut count = 0u32;
                let mut size = 0u64;
                for line in output.lines() {
                    // Format: "oid - path (size)"
                    count += 1;
                    // Try to extract size from parentheses
                    if let Some(size_start) = line.rfind('(') {
                        if let Some(size_str) = line[size_start + 1..].strip_suffix(')') {
                            size += parse_size(size_str);
                        }
                    }
                }
                (count, size)
            })
            .unwrap_or((0, 0))
    } else {
        (0, 0)
    };

    Ok(LfsStatus {
        installed,
        version,
        enabled,
        patterns,
        file_count,
        total_size,
    })
}

/// Parse size string like "1.5 MB" or "500 KB"
fn parse_size(s: &str) -> u64 {
    let s = s.trim();
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() < 2 {
        return 0;
    }

    let num: f64 = parts[0].parse().unwrap_or(0.0);
    let unit = parts[1].to_uppercase();

    let multiplier = match unit.as_str() {
        "B" => 1,
        "KB" => 1024,
        "MB" => 1024 * 1024,
        "GB" => 1024 * 1024 * 1024,
        _ => 1,
    };

    (num * multiplier as f64) as u64
}

/// Initialize Git LFS in the repository
#[command]
pub async fn init_lfs(path: String) -> Result<()> {
    let repo_path = Path::new(&path);

    if !is_lfs_installed() {
        return Err(LeviathanError::OperationFailed(
            "Git LFS is not installed. Please install it first.".to_string(),
        ));
    }

    run_lfs_command(repo_path, &["install"])?;
    Ok(())
}

/// Track files matching a pattern with LFS
#[command]
pub async fn lfs_track(path: String, pattern: String) -> Result<()> {
    let repo_path = Path::new(&path);
    run_lfs_command(repo_path, &["track", &pattern])?;
    Ok(())
}

/// Untrack a file pattern from LFS
#[command]
pub async fn lfs_untrack(path: String, pattern: String) -> Result<()> {
    let repo_path = Path::new(&path);
    run_lfs_command(repo_path, &["untrack", &pattern])?;
    Ok(())
}

/// Get list of LFS files in the repository
#[command]
pub async fn get_lfs_files(path: String) -> Result<Vec<LfsFile>> {
    let repo_path = Path::new(&path);

    let output = run_lfs_command(repo_path, &["ls-files", "-l"])?;

    let files = output
        .lines()
        .filter_map(|line| {
            // Format: "oid * path" or "oid - path"
            let parts: Vec<&str> = line.splitn(3, ' ').collect();
            if parts.len() >= 3 {
                let oid = parts[0].to_string();
                let downloaded = parts[1] == "*";
                let file_path = parts[2].to_string();

                Some(LfsFile {
                    path: file_path,
                    oid: Some(oid),
                    size: None,
                    downloaded,
                })
            } else {
                None
            }
        })
        .collect();

    Ok(files)
}

/// Pull (download) LFS files
#[command]
pub async fn lfs_pull(path: String, token: Option<String>) -> Result<String> {
    let repo_path = Path::new(&path);

    run_lfs_command_with_token(repo_path, &["pull"], token.as_deref())
}

/// Fetch LFS files from remote
#[command]
pub async fn lfs_fetch(
    path: String,
    refs: Option<Vec<String>>,
    token: Option<String>,
) -> Result<String> {
    let repo_path = Path::new(&path);
    let token = token.as_deref();

    let mut args = vec!["fetch"];

    let refs_owned: Vec<String>;
    if let Some(r) = refs {
        refs_owned = r;
        for ref_name in &refs_owned {
            args.push(ref_name);
        }
    }

    run_lfs_command_with_token(repo_path, &args, token)
}

/// Prune old LFS files
#[command]
pub async fn lfs_prune(path: String, dry_run: Option<bool>) -> Result<String> {
    let repo_path = Path::new(&path);

    let mut args = vec!["prune"];

    if dry_run.unwrap_or(false) {
        args.push("--dry-run");
    }

    run_lfs_command(repo_path, &args)
}

/// Migrate existing files to LFS
#[command]
pub async fn lfs_migrate(
    path: String,
    pattern: String,
    include_refs: Option<Vec<String>>,
) -> Result<String> {
    let repo_path = Path::new(&path);

    let include_arg = format!("--include={}", pattern);
    let mut args = vec!["migrate", "import", &include_arg];

    // Add refs if specified
    let refs_owned: Vec<String>;
    if let Some(refs) = include_refs {
        refs_owned = refs;
        for r in &refs_owned {
            args.push(r);
        }
    }

    run_lfs_command(repo_path, &args)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[test]
    fn test_parse_size_bytes() {
        assert_eq!(parse_size("100 B"), 100);
    }

    #[test]
    fn test_parse_size_kilobytes() {
        assert_eq!(parse_size("1 KB"), 1024);
        assert_eq!(parse_size("2 KB"), 2048);
    }

    #[test]
    fn test_parse_size_megabytes() {
        assert_eq!(parse_size("1 MB"), 1024 * 1024);
        assert_eq!(parse_size("1.5 MB"), (1.5 * 1024.0 * 1024.0) as u64);
    }

    #[test]
    fn test_parse_size_gigabytes() {
        assert_eq!(parse_size("1 GB"), 1024 * 1024 * 1024);
    }

    #[test]
    fn test_parse_size_invalid() {
        assert_eq!(parse_size("invalid"), 0);
        assert_eq!(parse_size(""), 0);
        assert_eq!(parse_size("100"), 0); // Missing unit
    }

    #[test]
    fn test_parse_size_whitespace() {
        assert_eq!(parse_size("  100 KB  "), 100 * 1024);
    }

    #[tokio::test]
    async fn test_get_lfs_status_no_lfs() {
        let repo = TestRepo::with_initial_commit();

        let result = get_lfs_status(repo.path_str()).await;
        assert!(result.is_ok());

        let status = result.unwrap();
        // LFS might or might not be installed on the test system
        // but the function should not fail
        if !status.installed {
            assert!(!status.enabled);
            assert!(status.patterns.is_empty());
            assert_eq!(status.file_count, 0);
            assert_eq!(status.total_size, 0);
        }
    }

    #[tokio::test]
    async fn test_get_lfs_status_with_gitattributes() {
        let repo = TestRepo::with_initial_commit();

        // Create a .gitattributes file with LFS filter
        repo.create_file(
            ".gitattributes",
            "*.bin filter=lfs diff=lfs merge=lfs -text\n",
        );

        let result = get_lfs_status(repo.path_str()).await;
        assert!(result.is_ok());

        let status = result.unwrap();
        if status.installed {
            assert!(status.enabled);
        }
    }

    #[tokio::test]
    async fn test_get_lfs_status_invalid_path() {
        let result = get_lfs_status("/nonexistent/path".to_string()).await;
        // Should return status with installed info but not crash
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_init_lfs_when_not_installed() {
        let repo = TestRepo::with_initial_commit();

        let result = init_lfs(repo.path_str()).await;
        // Result depends on whether LFS is installed on the system
        // If not installed, should return error
        if !is_lfs_installed() {
            assert!(result.is_err());
            let err = result.unwrap_err();
            assert!(err.to_string().contains("not installed"));
        }
    }

    #[tokio::test]
    async fn test_lfs_track_pattern() {
        let repo = TestRepo::with_initial_commit();

        // Skip if LFS is not installed
        if !is_lfs_installed() {
            return;
        }

        // Initialize LFS first
        let _ = init_lfs(repo.path_str()).await;

        let result = lfs_track(repo.path_str(), "*.bin".to_string()).await;
        assert!(result.is_ok());

        // Verify the pattern was added to .gitattributes
        let gitattributes = std::fs::read_to_string(repo.path.join(".gitattributes"));
        assert!(gitattributes.is_ok());
        assert!(gitattributes.unwrap().contains("*.bin filter=lfs"));
    }

    #[tokio::test]
    async fn test_lfs_untrack_pattern() {
        let repo = TestRepo::with_initial_commit();

        // Skip if LFS is not installed
        if !is_lfs_installed() {
            return;
        }

        // Initialize and track a pattern first
        let _ = init_lfs(repo.path_str()).await;
        let _ = lfs_track(repo.path_str(), "*.bin".to_string()).await;

        let result = lfs_untrack(repo.path_str(), "*.bin".to_string()).await;
        assert!(result.is_ok());

        // Verify the pattern was removed from .gitattributes
        let gitattributes = std::fs::read_to_string(repo.path.join(".gitattributes"));
        assert!(gitattributes.is_ok());
        assert!(!gitattributes.unwrap().contains("*.bin filter=lfs"));
    }

    #[tokio::test]
    async fn test_get_lfs_files_empty_repo() {
        let repo = TestRepo::with_initial_commit();

        // Skip if LFS is not installed
        if !is_lfs_installed() {
            return;
        }

        let result = get_lfs_files(repo.path_str()).await;
        // Should either succeed with empty list or fail gracefully
        if let Ok(files) = result {
            assert!(files.is_empty());
        }
    }

    #[tokio::test]
    async fn test_lfs_prune_dry_run() {
        let repo = TestRepo::with_initial_commit();

        // Skip if LFS is not installed
        if !is_lfs_installed() {
            return;
        }

        let _ = init_lfs(repo.path_str()).await;

        let result = lfs_prune(repo.path_str(), Some(true)).await;
        // Should succeed or fail gracefully (no LFS files to prune)
        // The command itself should not crash
        let _ = result;
    }

    #[tokio::test]
    async fn test_lfs_status_struct_serialization() {
        let status = LfsStatus {
            installed: true,
            version: Some("git-lfs/3.0.0".to_string()),
            enabled: true,
            patterns: vec![LfsPattern {
                pattern: "*.bin".to_string(),
            }],
            file_count: 5,
            total_size: 1024 * 1024,
        };

        let json = serde_json::to_string(&status);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("\"installed\":true"));
        assert!(json_str.contains("\"enabled\":true"));
        assert!(json_str.contains("\"fileCount\":5"));
        assert!(json_str.contains("\"totalSize\":1048576"));
    }

    #[tokio::test]
    async fn test_lfs_file_struct_serialization() {
        let file = LfsFile {
            path: "large-file.bin".to_string(),
            oid: Some("abc123".to_string()),
            size: Some(1024),
            downloaded: true,
        };

        let json = serde_json::to_string(&file);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("\"path\":\"large-file.bin\""));
        assert!(json_str.contains("\"downloaded\":true"));
    }

    #[tokio::test]
    async fn test_lfs_pattern_struct_serialization() {
        let pattern = LfsPattern {
            pattern: "*.psd".to_string(),
        };

        let json = serde_json::to_string(&pattern);
        assert!(json.is_ok());
        assert!(json.unwrap().contains("\"pattern\":\"*.psd\""));
    }

    /// Value of `key` in the env `cmd` will spawn with, as a String.
    fn env_of(cmd: &std::process::Command, key: &str) -> Option<String> {
        cmd.get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new(key))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().to_string())
    }

    #[test]
    fn test_lfs_pull_command_carries_the_token_credential_helper() {
        // The frontend looks the repo's credential up and sends it, so a pull
        // that drops it dead-ends on every private LFS remote: the child runs
        // unauthenticated with GIT_TERMINAL_PROMPT=0 and the dialog shows a raw
        // "could not read Username" in a repo the app can otherwise push.
        let repo = TestRepo::with_initial_commit();
        let cmd = build_lfs_command(&repo.path, &["pull"], Some("s3cr3t"));

        assert_eq!(
            env_of(&cmd, "GIT_CONFIG_COUNT").as_deref(),
            Some("1"),
            "a token must install exactly one config override"
        );
        assert_eq!(
            env_of(&cmd, "GIT_CONFIG_KEY_0").as_deref(),
            Some("credential.helper"),
            "the override must be the credential helper git asks for auth"
        );
        assert_eq!(
            env_of(&cmd, "LEVIATHAN_GIT_TOKEN").as_deref(),
            Some("s3cr3t"),
            "the helper reads the token from this env var"
        );

        // The token must reach git ONLY through the env var: argv is readable
        // by every other user on the machine.
        let helper = env_of(&cmd, "GIT_CONFIG_VALUE_0").expect("helper must be set");
        assert!(helper.contains("LEVIATHAN_GIT_TOKEN"));
        assert!(!helper.contains("s3cr3t"));
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(args, vec!["lfs", "pull"]);
    }

    #[cfg(unix)]
    #[test]
    fn test_injected_helper_answers_git_with_the_token() {
        // Env vars being present proves nothing if the helper string is not one
        // real git honours. Ask git itself.
        let repo = TestRepo::with_initial_commit();
        let built = build_lfs_command(&repo.path, &["pull"], Some("s3cr3t"));

        let mut probe = create_command("git");
        probe.current_dir(&repo.path);
        for (key, value) in built.get_envs() {
            if let Some(value) = value {
                probe.env(key, value);
            }
        }

        let mut child = probe
            .arg("credential")
            .arg("fill")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("git credential fill must start");
        {
            use std::io::Write;
            child
                .stdin
                .as_mut()
                .expect("stdin is piped")
                .write_all(b"protocol=https\nhost=example.com\n\n")
                .expect("the request must be writable");
        }
        let out = child.wait_with_output().expect("git must terminate");
        let stdout = String::from_utf8_lossy(&out.stdout);

        assert!(
            stdout.contains("password=s3cr3t"),
            "git must resolve the token as the password, got: {}",
            stdout
        );
        assert!(stdout.contains("username=git"), "got: {}", stdout);
    }

    #[test]
    fn test_lfs_fetch_with_refs_still_authenticates() {
        let repo = TestRepo::with_initial_commit();
        let cmd = build_lfs_command(&repo.path, &["fetch", "main"], Some("tok"));

        assert_eq!(
            env_of(&cmd, "GIT_CONFIG_KEY_0").as_deref(),
            Some("credential.helper"),
            "fetch shares the runner, so it must authenticate too"
        );

        // Authenticating must not disturb ref assembly.
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(args, vec!["lfs", "fetch", "main"]);
    }

    #[test]
    fn test_lfs_command_without_a_token_installs_no_helper() {
        // Local-only commands (prune, track, ls-files) must never override the
        // user's own credential helper.
        let repo = TestRepo::with_initial_commit();
        let cmd = build_lfs_command(&repo.path, &["prune"], None);

        for key in [
            "GIT_CONFIG_COUNT",
            "GIT_CONFIG_KEY_0",
            "GIT_CONFIG_VALUE_0",
            "LEVIATHAN_GIT_TOKEN",
        ] {
            assert_eq!(env_of(&cmd, key), None, "{} must not be set", key);
        }
    }

    #[test]
    fn test_blank_token_installs_no_helper() {
        // A helper answering with an empty password turns "no credentials" into
        // "login rejected" — a wronger error than no token at all.
        let repo = TestRepo::with_initial_commit();
        let cmd = build_lfs_command(&repo.path, &["pull"], Some("   "));

        for key in [
            "GIT_CONFIG_COUNT",
            "GIT_CONFIG_KEY_0",
            "GIT_CONFIG_VALUE_0",
            "LEVIATHAN_GIT_TOKEN",
        ] {
            assert_eq!(env_of(&cmd, key), None, "{} must not be set", key);
        }
    }

    #[tokio::test]
    async fn test_lfs_pull_error_does_not_leak_the_token() {
        // No remote is configured, so this pull fails (with git's "not a git
        // command" where LFS is absent). Either way the text goes straight to
        // the dialog's error banner, so it must never carry the token.
        //
        // Deliberately not gated on is_lfs_installed(): the leak guard is worth
        // more when it actually runs, and both failure modes exercise it.
        let repo = TestRepo::with_initial_commit();

        let result = lfs_pull(repo.path_str(), Some("s3cr3t".to_string())).await;

        let text = match result {
            Ok(output) => output,
            Err(err) => {
                let message = err.to_string();
                assert!(!message.is_empty(), "the failure must say something");
                message
            }
        };
        assert!(
            !text.contains("s3cr3t"),
            "the token must not reach a user-visible message: {}",
            text
        );
    }
}
