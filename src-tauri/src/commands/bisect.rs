//! Bisect command handlers
//! Binary search through commits to find bug-introducing changes

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

/// Current state of a bisect session
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BisectStatus {
    /// Whether a bisect session is in progress
    pub active: bool,
    /// Current commit being tested (if active)
    pub current_commit: Option<String>,
    /// The bad (newer) commit
    pub bad_commit: Option<String>,
    /// The good (older) commit
    pub good_commit: Option<String>,
    /// Number of revisions left to test (approximate)
    pub remaining: Option<u32>,
    /// Total steps (approximate)
    pub total_steps: Option<u32>,
    /// Current step number
    pub current_step: Option<u32>,
    /// Log of bisect operations
    pub log: Vec<BisectLogEntry>,
}

/// A single entry in the bisect log
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BisectLogEntry {
    pub commit_oid: String,
    pub action: String,
    pub message: Option<String>,
}

/// Result from a bisect step
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BisectStepResult {
    pub status: BisectStatus,
    /// If bisect is complete, this is the first bad commit
    pub culprit: Option<CulpritCommit>,
    /// Message from git about the current state
    pub message: String,
}

/// The commit that introduced the bug
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CulpritCommit {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub email: String,
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
        // Some bisect commands return non-zero but aren't errors (like bisect visualize)
        // Check if stderr contains actual error
        if stderr.contains("error:") || stderr.contains("fatal:") {
            Err(LeviathanError::OperationFailed(stderr.trim().to_string()))
        } else {
            Ok(stdout.trim().to_string())
        }
    }
}

/// Check if a bisect session is active
fn is_bisect_active(repo_path: &Path) -> bool {
    repo_path.join(".git/BISECT_START").exists()
}

/// Parse the bisect log file
fn parse_bisect_log(repo_path: &Path) -> Vec<BisectLogEntry> {
    let log_path = repo_path.join(".git/BISECT_LOG");
    if !log_path.exists() {
        return Vec::new();
    }

    let content = match std::fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    content
        .lines()
        .filter(|line| !line.starts_with('#') && !line.is_empty())
        .filter_map(|line| {
            // Format: "git bisect good|bad|skip <commit>"
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 && parts[0] == "git" && parts[1] == "bisect" {
                Some(BisectLogEntry {
                    commit_oid: parts[3].to_string(),
                    action: parts[2].to_string(),
                    message: None,
                })
            } else {
                None
            }
        })
        .collect()
}

/// Get the current bisect status
#[command]
pub async fn get_bisect_status(path: String) -> Result<BisectStatus> {
    let repo_path = Path::new(&path);

    if !is_bisect_active(repo_path) {
        return Ok(BisectStatus {
            active: false,
            current_commit: None,
            bad_commit: None,
            good_commit: None,
            remaining: None,
            total_steps: None,
            current_step: None,
            log: Vec::new(),
        });
    }

    // Get current HEAD
    let current_commit = run_git_command(repo_path, &["rev-parse", "HEAD"]).ok();

    // Read bad commit
    let bad_commit = std::fs::read_to_string(repo_path.join(".git/refs/bisect/bad"))
        .ok()
        .map(|s| s.trim().to_string());

    // Find first good commit (there might be multiple)
    let good_commit = std::fs::read_dir(repo_path.join(".git/refs/bisect"))
        .ok()
        .and_then(|entries| {
            entries
                .filter_map(|e| e.ok())
                .find(|e| e.file_name().to_string_lossy().starts_with("good-"))
                .and_then(|e| std::fs::read_to_string(e.path()).ok())
                .map(|s| s.trim().to_string())
        });

    // Parse the log
    let log = parse_bisect_log(repo_path);

    // Estimate remaining steps
    let remaining_info = if bad_commit.is_some() && good_commit.is_some() {
        // Try to get the remaining count from git bisect
        let output = run_git_command(repo_path, &["bisect", "visualize", "--oneline", "--count"]);
        if let Ok(count_str) = output {
            if let Ok(count) = count_str.parse::<u32>() {
                // Approximate steps = log2(count)
                let steps = (count as f64).log2().ceil() as u32;
                Some((count, steps))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    Ok(BisectStatus {
        active: true,
        current_commit,
        bad_commit,
        good_commit,
        remaining: remaining_info.map(|(r, _)| r),
        total_steps: remaining_info.map(|(_, t)| t),
        current_step: Some(log.len() as u32),
        log,
    })
}

/// Start a new bisect session
#[command]
pub async fn bisect_start(
    path: String,
    bad_commit: Option<String>,
    good_commit: Option<String>,
) -> Result<BisectStepResult> {
    let repo_path = Path::new(&path);

    // Start bisect
    run_git_command(repo_path, &["bisect", "start"])?;

    // Mark bad commit if provided
    if let Some(bad) = &bad_commit {
        run_git_command(repo_path, &["bisect", "bad", bad])?;
    }

    // Mark good commit if provided
    if let Some(good) = &good_commit {
        run_git_command(repo_path, &["bisect", "good", good])?;
    }

    let status = get_bisect_status(path.clone()).await?;

    Ok(BisectStepResult {
        status,
        culprit: None,
        message: "Bisect session started".to_string(),
    })
}

/// Mark the current commit (or specified commit) as bad
#[command]
pub async fn bisect_bad(path: String, commit: Option<String>) -> Result<BisectStepResult> {
    let repo_path = Path::new(&path);

    let args: Vec<&str> = match &commit {
        Some(c) => vec!["bisect", "bad", c.as_str()],
        None => vec!["bisect", "bad"],
    };

    let output = run_git_command(repo_path, &args)?;

    // Check if we found the culprit
    let culprit = if output.contains("is the first bad commit") {
        // Parse the culprit commit info
        parse_culprit_from_output(&output)
    } else {
        None
    };

    let status = get_bisect_status(path.clone()).await?;

    Ok(BisectStepResult {
        status,
        culprit,
        message: output,
    })
}

/// Mark the current commit (or specified commit) as good
#[command]
pub async fn bisect_good(path: String, commit: Option<String>) -> Result<BisectStepResult> {
    let repo_path = Path::new(&path);

    let args: Vec<&str> = match &commit {
        Some(c) => vec!["bisect", "good", c.as_str()],
        None => vec!["bisect", "good"],
    };

    let output = run_git_command(repo_path, &args)?;

    // Check if we found the culprit
    let culprit = if output.contains("is the first bad commit") {
        parse_culprit_from_output(&output)
    } else {
        None
    };

    let status = get_bisect_status(path.clone()).await?;

    Ok(BisectStepResult {
        status,
        culprit,
        message: output,
    })
}

/// Skip the current commit (can't be tested)
#[command]
pub async fn bisect_skip(path: String, commit: Option<String>) -> Result<BisectStepResult> {
    let repo_path = Path::new(&path);

    let args: Vec<&str> = match &commit {
        Some(c) => vec!["bisect", "skip", c.as_str()],
        None => vec!["bisect", "skip"],
    };

    let output = run_git_command(repo_path, &args)?;

    let status = get_bisect_status(path.clone()).await?;

    Ok(BisectStepResult {
        status,
        culprit: None,
        message: output,
    })
}

/// Reset/end the bisect session
#[command]
pub async fn bisect_reset(path: String) -> Result<BisectStepResult> {
    let repo_path = Path::new(&path);

    let output = run_git_command(repo_path, &["bisect", "reset"])?;

    let status = get_bisect_status(path.clone()).await?;

    Ok(BisectStepResult {
        status,
        culprit: None,
        message: if output.is_empty() {
            "Bisect session ended".to_string()
        } else {
            output
        },
    })
}

/// Parse culprit commit info from git bisect output
fn parse_culprit_from_output(output: &str) -> Option<CulpritCommit> {
    // Output format:
    // <oid> is the first bad commit
    // commit <oid>
    // Author: Name <email>
    // Date:   ...
    //
    //     commit message

    let lines: Vec<&str> = output.lines().collect();
    if lines.is_empty() {
        return None;
    }

    // First line contains the commit hash
    let first_line = lines[0];
    let oid = first_line.split_whitespace().next()?.to_string();

    // Find Author line
    let author_line = lines.iter().find(|l| l.trim().starts_with("Author:"))?;
    let author_part = author_line.trim().strip_prefix("Author:")?.trim();

    // Parse "Name <email>"
    let (author, email) = if let Some(email_start) = author_part.find('<') {
        let name = author_part[..email_start].trim().to_string();
        let email = author_part[email_start + 1..]
            .trim_end_matches('>')
            .to_string();
        (name, email)
    } else {
        (author_part.to_string(), String::new())
    };

    // Find the commit summary (first non-empty line after empty line)
    let summary = lines
        .iter()
        .skip_while(|l| !l.is_empty())
        .skip(1)
        .find(|l| !l.is_empty())
        .map(|l| l.trim().to_string())
        .unwrap_or_default();

    Some(CulpritCommit {
        oid,
        summary,
        author,
        email,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_bisect_status_inactive() {
        let repo = TestRepo::with_initial_commit();
        let result = get_bisect_status(repo.path_str()).await;

        assert!(result.is_ok());
        let status = result.unwrap();
        assert!(!status.active);
        assert!(status.current_commit.is_none());
        assert!(status.bad_commit.is_none());
        assert!(status.good_commit.is_none());
        assert!(status.log.is_empty());
    }

    #[tokio::test]
    async fn test_bisect_start_simple() {
        let repo = TestRepo::with_initial_commit();

        let result = bisect_start(repo.path_str(), None, None).await;

        assert!(result.is_ok());
        let step_result = result.unwrap();
        assert!(step_result.status.active);
        assert_eq!(step_result.message, "Bisect session started");
        assert!(step_result.culprit.is_none());
    }

    #[tokio::test]
    async fn test_bisect_start_with_commits() {
        let repo = TestRepo::with_initial_commit();
        let good_oid = repo.head_oid().to_string();

        // Create a "bad" commit
        repo.create_commit("Bad commit", &[("bad.txt", "bad content")]);
        let bad_oid = repo.head_oid().to_string();

        let result = bisect_start(
            repo.path_str(),
            Some(bad_oid.clone()),
            Some(good_oid.clone()),
        )
        .await;

        assert!(result.is_ok());
        let step_result = result.unwrap();
        assert!(step_result.status.active);
    }

    #[tokio::test]
    async fn test_bisect_reset() {
        let repo = TestRepo::with_initial_commit();

        // Start bisect session
        bisect_start(repo.path_str(), None, None).await.unwrap();

        // Verify it's active
        let status = get_bisect_status(repo.path_str()).await.unwrap();
        assert!(status.active);

        // Reset bisect
        let result = bisect_reset(repo.path_str()).await;

        assert!(result.is_ok());
        let step_result = result.unwrap();
        assert!(!step_result.status.active);
    }

    #[tokio::test]
    async fn test_bisect_good_and_bad() {
        let repo = TestRepo::with_initial_commit();
        let good_oid = repo.head_oid().to_string();

        // Create more commits for bisect to work with
        repo.create_commit("Commit 2", &[("file2.txt", "content 2")]);
        repo.create_commit("Commit 3", &[("file3.txt", "content 3")]);
        repo.create_commit("Commit 4", &[("file4.txt", "content 4")]);
        let bad_oid = repo.head_oid().to_string();

        // Start bisect with bad and good commits
        bisect_start(repo.path_str(), Some(bad_oid), Some(good_oid))
            .await
            .unwrap();

        // Mark current as bad
        let bad_result = bisect_bad(repo.path_str(), None).await;
        assert!(bad_result.is_ok());

        // Reset for cleanup
        bisect_reset(repo.path_str()).await.unwrap();
    }

    #[tokio::test]
    async fn test_bisect_skip() {
        let repo = TestRepo::with_initial_commit();
        let good_oid = repo.head_oid().to_string();

        // Create more commits
        repo.create_commit("Commit 2", &[("file2.txt", "content 2")]);
        repo.create_commit("Commit 3", &[("file3.txt", "content 3")]);
        let bad_oid = repo.head_oid().to_string();

        // Start bisect
        bisect_start(repo.path_str(), Some(bad_oid), Some(good_oid))
            .await
            .unwrap();

        // Skip current commit
        let skip_result = bisect_skip(repo.path_str(), None).await;
        assert!(skip_result.is_ok());

        // Reset for cleanup
        bisect_reset(repo.path_str()).await.unwrap();
    }

    #[tokio::test]
    async fn test_bisect_full_session() {
        let repo = TestRepo::with_initial_commit();
        let good_oid = repo.head_oid().to_string();

        // Create several commits
        repo.create_commit("Commit 2", &[("file2.txt", "content 2")]);
        repo.create_commit("Bug introduced", &[("bug.txt", "bug")]);
        repo.create_commit("Commit 4", &[("file4.txt", "content 4")]);
        let bad_oid = repo.head_oid().to_string();

        // Start bisect
        let start_result = bisect_start(repo.path_str(), Some(bad_oid), Some(good_oid)).await;
        assert!(start_result.is_ok());

        // Get status - should be active
        let status = get_bisect_status(repo.path_str()).await.unwrap();
        assert!(status.active);
        assert!(status.current_commit.is_some());

        // Reset to clean up
        let reset_result = bisect_reset(repo.path_str()).await;
        assert!(reset_result.is_ok());
        assert!(!reset_result.unwrap().status.active);
    }

    #[tokio::test]
    async fn test_bisect_bad_with_specific_commit() {
        let repo = TestRepo::with_initial_commit();
        let good_oid = repo.head_oid().to_string();

        repo.create_commit("Commit 2", &[("file2.txt", "content 2")]);
        let specific_oid = repo.head_oid().to_string();
        repo.create_commit("Commit 3", &[("file3.txt", "content 3")]);

        // Start bisect
        bisect_start(repo.path_str(), None, None).await.unwrap();

        // Mark specific commit as bad
        let bad_result = bisect_bad(repo.path_str(), Some(specific_oid)).await;
        assert!(bad_result.is_ok());

        // Mark good commit
        let good_result = bisect_good(repo.path_str(), Some(good_oid)).await;
        assert!(good_result.is_ok());

        // Reset for cleanup
        bisect_reset(repo.path_str()).await.unwrap();
    }

    #[test]
    fn test_parse_bisect_log_empty_repo() {
        let repo = TestRepo::with_initial_commit();
        let log = parse_bisect_log(&repo.path);
        assert!(log.is_empty());
    }

    #[test]
    fn test_is_bisect_active_false() {
        let repo = TestRepo::with_initial_commit();
        assert!(!is_bisect_active(&repo.path));
    }

    #[test]
    fn test_parse_culprit_from_output_valid() {
        let output = r#"abc123def456 is the first bad commit
commit abc123def456
Author: Test User <test@example.com>
Date:   Mon Jan 1 12:00:00 2024 +0000

    Bug introduced here

:100644 100644 abc123 def456 M  file.txt"#;

        let culprit = parse_culprit_from_output(output);
        assert!(culprit.is_some());

        let culprit = culprit.unwrap();
        assert_eq!(culprit.oid, "abc123def456");
        assert_eq!(culprit.author, "Test User");
        assert_eq!(culprit.email, "test@example.com");
        assert_eq!(culprit.summary, "Bug introduced here");
    }

    #[test]
    fn test_parse_culprit_from_output_empty() {
        let output = "";
        let culprit = parse_culprit_from_output(output);
        assert!(culprit.is_none());
    }

    #[test]
    fn test_parse_culprit_from_output_no_author() {
        let output = "abc123def456 is the first bad commit\ncommit abc123def456";
        let culprit = parse_culprit_from_output(output);
        assert!(culprit.is_none());
    }
}
