//! Bisect command handlers
//! Binary search through commits to find bug-introducing changes

use std::path::{Path, PathBuf};
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
        // A few bisect outcomes exit non-zero yet are legitimate results the UI
        // must display rather than swallow: skip-exhaustion ("We cannot bisect
        // more!", exit 2) and, on some git versions, the first-bad-commit summary.
        // Everything else (e.g. swapped good/bad: "Some good revs are not
        // ancestors of the bad rev.") is a real failure and must surface as an error.
        let combined = format!("{}\n{}", stdout, stderr);
        if combined.contains("We cannot bisect more")
            || combined.contains("is the first bad commit")
        {
            Ok(stdout.trim().to_string())
        } else {
            let message = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            Err(LeviathanError::OperationFailed(message.to_string()))
        }
    }
}

/// Resolve the real git directory for `repo_path`. In a linked worktree `.git`
/// is a plain file, so per-worktree bisect state lives under
/// `<main>/.git/worktrees/<name>` rather than `<repo>/.git`.
fn git_dir(repo_path: &Path) -> Option<PathBuf> {
    run_git_command(repo_path, &["rev-parse", "--absolute-git-dir"])
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// Read the recorded bisect terms (term for bad/new, term for good/old) from
/// BISECT_TERMS. Defaults to ("bad", "good") when the file is absent.
fn read_bisect_terms(git_dir: &Path) -> (String, String) {
    let default = || ("bad".to_string(), "good".to_string());
    match std::fs::read_to_string(git_dir.join("BISECT_TERMS")) {
        Ok(content) => {
            let mut lines = content.lines();
            let bad = lines.next().map(|s| s.trim().to_string());
            let good = lines.next().map(|s| s.trim().to_string());
            match (bad, good) {
                (Some(b), Some(g)) if !b.is_empty() && !g.is_empty() => (b, g),
                _ => default(),
            }
        }
        Err(_) => default(),
    }
}

/// git's estimate for the number of remaining bisection steps (mirrors
/// `estimate_bisect_steps` in git's bisect.c so the UI shows the same figure).
fn estimate_bisect_steps(all: u32) -> u32 {
    if all < 3 {
        return 0;
    }
    let n = 31 - all.leading_zeros(); // floor(log2(all))
    let e = 1u32 << n;
    let x = all - e;
    if e < 3 * x {
        n
    } else {
        n - 1
    }
}

/// Strip surrounding quotes that `git bisect log` puts around start arguments.
fn unquote(s: &str) -> String {
    s.trim_matches('\'').trim_matches('"').to_string()
}

/// Check if a bisect session is active
fn is_bisect_active(repo_path: &Path) -> bool {
    git_dir(repo_path)
        .map(|d| d.join("BISECT_START").exists())
        .unwrap_or(false)
}

/// Parse the bisect log file
fn parse_bisect_log(repo_path: &Path) -> Vec<BisectLogEntry> {
    let log_path = match git_dir(repo_path) {
        Some(d) => d.join("BISECT_LOG"),
        None => return Vec::new(),
    };
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
            // Format: "git bisect <term|skip> <commit>". Custom terms produce
            // e.g. "git bisect broken <sha>"; the bookkeeping "git bisect start
            // '--term-new=broken' ..." line must be skipped, not shown as history.
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 && parts[0] == "git" && parts[1] == "bisect" {
                let action = unquote(parts[2]);
                let commit = unquote(parts[3]);
                if action == "start" || commit.is_empty() || commit.starts_with('-') {
                    None
                } else {
                    Some(BisectLogEntry {
                        commit_oid: commit,
                        action,
                        message: None,
                    })
                }
            } else {
                None
            }
        })
        .collect()
}

/// The status returned when no bisect session is in progress.
fn inactive_status() -> BisectStatus {
    BisectStatus {
        active: false,
        current_commit: None,
        bad_commit: None,
        good_commit: None,
        remaining: None,
        total_steps: None,
        current_step: None,
        log: Vec::new(),
    }
}

/// Get the current bisect status
#[command]
pub async fn get_bisect_status(path: String) -> Result<BisectStatus> {
    let repo_path = Path::new(&path);

    if !is_bisect_active(repo_path) {
        return Ok(inactive_status());
    }

    let gdir = match git_dir(repo_path) {
        Some(d) => d,
        None => return Ok(inactive_status()),
    };

    // Honor custom terms (git bisect start --term-new/--term-old, or new/old).
    let (term_bad, term_good) = read_bisect_terms(&gdir);

    // Get current HEAD (the commit currently being tested)
    let current_commit = run_git_command(repo_path, &["rev-parse", "HEAD"]).ok();

    // Read the bad/new ref via git so it resolves in linked worktrees and honors
    // packed refs (raw .git/refs/bisect/* file reads break in both cases).
    let bad_ref = format!("refs/bisect/{}", term_bad);
    let bad_commit = run_git_command(repo_path, &["rev-parse", "--verify", "--quiet", &bad_ref])
        .ok()
        .filter(|s| !s.is_empty());

    // Collect all good/old refs (there can be several: <term_good>-<sha>).
    let good_prefix = format!("refs/bisect/{}-", term_good);
    let good_refs: Vec<String> = run_git_command(
        repo_path,
        &["for-each-ref", "--format=%(refname)", "refs/bisect"],
    )
    .map(|out| {
        out.lines()
            .map(|l| l.trim().to_string())
            .filter(|l| l.starts_with(&good_prefix))
            .collect()
    })
    .unwrap_or_default();

    let good_commit = good_refs
        .first()
        .and_then(|r| run_git_command(repo_path, &["rev-parse", r]).ok())
        .filter(|s| !s.is_empty());

    // Parse the log
    let log = parse_bisect_log(repo_path);

    // Estimate remaining work exactly as git prints it:
    //   "Bisecting: N revisions left to test after this (roughly M steps)"
    // where N = all - reaches - 1 (all = candidate commits in the range,
    // reaches = commits reachable from the current midpoint) and
    // M = estimate_bisect_steps(all).
    let remaining_info = if bad_commit.is_some() && !good_refs.is_empty() {
        let count = |start: &str| -> Option<u32> {
            let mut args: Vec<&str> = vec!["rev-list", "--count", start, "--not"];
            for r in &good_refs {
                args.push(r.as_str());
            }
            run_git_command(repo_path, &args)
                .ok()
                .and_then(|s| s.trim().parse::<u32>().ok())
        };
        match (count(&bad_ref), count("HEAD")) {
            (Some(all), Some(reaches)) if all > 0 => {
                let remaining = all.saturating_sub(reaches).saturating_sub(1);
                Some((remaining, estimate_bisect_steps(all)))
            }
            _ => None,
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

    // Finding 94: swapped good/bad must surface an error rather than silently
    // reporting a started session the user is then stuck in.
    #[tokio::test]
    async fn test_bisect_start_rejects_swapped_good_bad() {
        let repo = TestRepo::with_initial_commit();
        for i in 2..=6 {
            repo.create_commit(
                &format!("Commit {}", i),
                &[(format!("f{}.txt", i).as_str(), "x")],
            );
        }
        // Mark an ancestor as "bad" and its descendant HEAD as "good" (swapped).
        let bad_oid = run_git_command(&repo.path, &["rev-parse", "HEAD~4"]).unwrap();
        let good_oid = repo.head_oid().to_string();

        let result = bisect_start(repo.path_str(), Some(bad_oid), Some(good_oid)).await;
        assert!(
            result.is_err(),
            "swapped good/bad must surface an error, not a silent success"
        );

        let _ = run_git_command(&repo.path, &["bisect", "reset"]);
    }

    // Finding 95: remaining / total_steps must be populated (they were always None
    // because `git bisect visualize --oneline --count` never emits a bare count).
    #[tokio::test]
    async fn test_bisect_status_populates_progress() {
        let repo = TestRepo::with_initial_commit();
        let good_oid = repo.head_oid().to_string();
        for i in 2..=9 {
            repo.create_commit(
                &format!("Commit {}", i),
                &[(format!("f{}.txt", i).as_str(), "x")],
            );
        }
        let bad_oid = repo.head_oid().to_string();

        bisect_start(repo.path_str(), Some(bad_oid), Some(good_oid))
            .await
            .unwrap();

        let status = get_bisect_status(repo.path_str()).await.unwrap();
        assert!(status.active);
        assert!(status.remaining.is_some(), "remaining should be populated");
        assert!(
            status.total_steps.is_some(),
            "total_steps should be populated"
        );

        let _ = run_git_command(&repo.path, &["bisect", "reset"]);
    }

    // Finding 96: bisect state must be detected inside a linked worktree, where
    // `.git` is a file and per-worktree state lives under the resolved git dir.
    #[tokio::test]
    async fn test_bisect_status_in_worktree() {
        let repo = TestRepo::with_initial_commit();
        let good_oid = repo.head_oid().to_string();
        for i in 2..=6 {
            repo.create_commit(
                &format!("Commit {}", i),
                &[(format!("f{}.txt", i).as_str(), "x")],
            );
        }
        let bad_oid = repo.head_oid().to_string();

        let wt_parent = tempfile::TempDir::new().unwrap();
        let wt_path = wt_parent.path().join("wt");
        let out = std::process::Command::new("git")
            .current_dir(&repo.path)
            .args([
                "worktree",
                "add",
                "--detach",
                wt_path.to_str().unwrap(),
                "HEAD",
            ])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "worktree add failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        // In a linked worktree `.git` is a file, not a directory.
        assert!(wt_path.join(".git").is_file());

        let wt_str = wt_path.to_string_lossy().to_string();
        bisect_start(wt_str.clone(), Some(bad_oid), Some(good_oid))
            .await
            .unwrap();

        let status = get_bisect_status(wt_str).await.unwrap();
        assert!(
            status.active,
            "bisect must be detected as active in a linked worktree"
        );
        assert!(status.bad_commit.is_some());

        let _ = run_git_command(&wt_path, &["bisect", "reset"]);
    }

    // Finding 97: sessions started with custom terms must resolve bad/good via
    // the recorded terms, and the bookkeeping "start" line must not pollute history.
    #[tokio::test]
    async fn test_bisect_status_custom_terms() {
        let repo = TestRepo::with_initial_commit();
        let good_oid = repo.head_oid().to_string();
        for i in 2..=6 {
            repo.create_commit(
                &format!("Commit {}", i),
                &[(format!("f{}.txt", i).as_str(), "x")],
            );
        }
        let bad_oid = repo.head_oid().to_string();

        run_git_command(
            &repo.path,
            &[
                "bisect",
                "start",
                "--term-new=broken",
                "--term-old=working",
                bad_oid.as_str(),
                good_oid.as_str(),
            ],
        )
        .unwrap();

        let status = get_bisect_status(repo.path_str()).await.unwrap();
        assert!(status.active);
        assert!(
            status.bad_commit.is_some(),
            "bad commit should resolve via custom term refs/bisect/broken"
        );
        assert!(
            status.good_commit.is_some(),
            "good commit should resolve via custom term refs/bisect/working-*"
        );
        assert!(
            status
                .log
                .iter()
                .all(|e| e.action != "start" && !e.commit_oid.starts_with('-')),
            "the start bookkeeping line must not appear as a history entry"
        );

        let _ = run_git_command(&repo.path, &["bisect", "reset"]);
    }
}
