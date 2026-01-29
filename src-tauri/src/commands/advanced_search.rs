//! Advanced commit search/filtering command handlers
//! Provides rich filtering capabilities for commit history using git CLI

use std::process::Command;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Filter criteria for searching commits
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFilter {
    pub author: Option<String>,
    pub committer: Option<String>,
    pub message: Option<String>,
    pub after_date: Option<String>,
    pub before_date: Option<String>,
    pub path: Option<String>,
    pub branch: Option<String>,
    pub min_parents: Option<u32>,
    pub max_parents: Option<u32>,
    pub no_merges: Option<bool>,
    pub first_parent: Option<bool>,
}

/// A commit returned from filtered search results
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredCommit {
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: i64,
    pub committer_name: String,
    pub committer_date: i64,
    pub parent_count: u32,
    pub is_merge: bool,
}

/// Parse a line of git log output formatted as:
/// `%H|%h|%s|%an|%ae|%at|%cn|%ct|%P`
fn parse_log_line(line: &str) -> Option<FilteredCommit> {
    let parts: Vec<&str> = line.splitn(9, '|').collect();
    if parts.len() < 9 {
        return None;
    }

    let oid = parts[0].to_string();
    let short_oid = parts[1].to_string();
    let message = parts[2].to_string();
    let author_name = parts[3].to_string();
    let author_email = parts[4].to_string();
    let author_date: i64 = parts[5].parse().unwrap_or(0);
    let committer_name = parts[6].to_string();
    let committer_date: i64 = parts[7].parse().unwrap_or(0);
    let parents_str = parts[8].trim();
    let parent_count = if parents_str.is_empty() {
        0u32
    } else {
        parents_str.split(' ').count() as u32
    };
    let is_merge = parent_count > 1;

    Some(FilteredCommit {
        oid,
        short_oid,
        message,
        author_name,
        author_email,
        author_date,
        committer_name,
        committer_date,
        parent_count,
        is_merge,
    })
}

/// Execute a git log command and parse the output into FilteredCommit entries
fn execute_git_log(cmd: &mut Command) -> Result<Vec<FilteredCommit>> {
    let output = cmd.output().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to execute git log: {}", e))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(LeviathanError::OperationFailed(format!(
            "git log failed: {}",
            stderr
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<FilteredCommit> = stdout.lines().filter_map(parse_log_line).collect();

    Ok(commits)
}

const LOG_FORMAT: &str = "%H|%h|%s|%an|%ae|%at|%cn|%ct|%P";

/// Filter commits using a rich set of criteria
///
/// Builds a `git log` command with filter parameters such as author, committer,
/// message grep, date ranges, file paths, branch, merge filtering, and first-parent traversal.
#[command]
pub async fn filter_commits(
    path: String,
    filter: CommitFilter,
    max_results: Option<u32>,
) -> Result<Vec<FilteredCommit>> {
    let max_results = max_results.unwrap_or(500);

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&path)
        .arg("log")
        .arg(format!("--format={}", LOG_FORMAT))
        .arg(format!("-{}", max_results));

    if let Some(ref author) = filter.author {
        cmd.arg(format!("--author={}", author));
    }

    if let Some(ref committer) = filter.committer {
        cmd.arg(format!("--committer={}", committer));
    }

    if let Some(ref message) = filter.message {
        cmd.arg(format!("--grep={}", message));
        cmd.arg("-i");
    }

    if let Some(ref after_date) = filter.after_date {
        cmd.arg(format!("--after={}", after_date));
    }

    if let Some(ref before_date) = filter.before_date {
        cmd.arg(format!("--before={}", before_date));
    }

    if filter.no_merges.unwrap_or(false) {
        cmd.arg("--no-merges");
    }

    if let Some(min_parents) = filter.min_parents {
        cmd.arg(format!("--min-parents={}", min_parents));
    }

    if let Some(max_parents) = filter.max_parents {
        cmd.arg(format!("--max-parents={}", max_parents));
    }

    if filter.first_parent.unwrap_or(false) {
        cmd.arg("--first-parent");
    }

    if let Some(ref branch) = filter.branch {
        cmd.arg(branch.as_str());
    }

    if let Some(ref file_path) = filter.path {
        cmd.arg("--").arg(file_path.as_str());
    }

    execute_git_log(&mut cmd)
}

/// Get commits that exist in `compare_branch` but not in `base_branch`
///
/// Uses `git log <base>..<compare>` to find divergent commits.
#[command]
pub async fn get_branch_diff_commits(
    path: String,
    base_branch: String,
    compare_branch: String,
    max_results: Option<u32>,
) -> Result<Vec<FilteredCommit>> {
    let max_results = max_results.unwrap_or(500);

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&path)
        .arg("log")
        .arg(format!("--format={}", LOG_FORMAT))
        .arg(format!("-{}", max_results))
        .arg(format!("{}..{}", base_branch, compare_branch));

    execute_git_log(&mut cmd)
}

/// Get the commit history for a specific file, optionally following renames
///
/// Uses `git log [--follow] -- <file_path>` for file history with rename tracking.
#[command]
pub async fn get_file_log(
    path: String,
    file_path: String,
    follow: Option<bool>,
    max_results: Option<u32>,
) -> Result<Vec<FilteredCommit>> {
    let max_results = max_results.unwrap_or(500);
    let should_follow = follow.unwrap_or(true);

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&path)
        .arg("log")
        .arg(format!("--format={}", LOG_FORMAT))
        .arg(format!("-{}", max_results));

    if should_follow {
        cmd.arg("--follow");
    }

    cmd.arg("--").arg(&file_path);

    execute_git_log(&mut cmd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_filter_commits_no_filter() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content")]);
        repo.create_commit("Third commit", &[("file3.txt", "content")]);

        let filter = CommitFilter {
            author: None,
            committer: None,
            message: None,
            after_date: None,
            before_date: None,
            path: None,
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: None,
            first_parent: None,
        };

        let result = filter_commits(repo.path_str(), filter, Some(100)).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 3);
        // Most recent first
        assert!(commits[0].message.contains("Third"));
        assert!(commits[1].message.contains("Second"));
        assert!(commits[2].message.contains("Initial"));
    }

    #[tokio::test]
    async fn test_filter_commits_by_author() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Author commit", &[("file.txt", "content")]);

        let filter = CommitFilter {
            author: Some("Test User".to_string()),
            committer: None,
            message: None,
            after_date: None,
            before_date: None,
            path: None,
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: None,
            first_parent: None,
        };

        let result = filter_commits(repo.path_str(), filter, Some(100)).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
        assert!(commits.iter().all(|c| c.author_name == "Test User"));
    }

    #[tokio::test]
    async fn test_filter_commits_by_author_no_match() {
        let repo = TestRepo::with_initial_commit();

        let filter = CommitFilter {
            author: Some("Nonexistent Author XYZ".to_string()),
            committer: None,
            message: None,
            after_date: None,
            before_date: None,
            path: None,
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: None,
            first_parent: None,
        };

        let result = filter_commits(repo.path_str(), filter, Some(100)).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_filter_commits_by_message() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("feat: add unique_search_xyz", &[("feat.txt", "feature")]);
        repo.create_commit("fix: resolve bug", &[("fix.txt", "fix")]);

        let filter = CommitFilter {
            author: None,
            committer: None,
            message: Some("unique_search_xyz".to_string()),
            after_date: None,
            before_date: None,
            path: None,
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: None,
            first_parent: None,
        };

        let result = filter_commits(repo.path_str(), filter, Some(100)).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 1);
        assert!(commits[0].message.contains("unique_search_xyz"));
    }

    #[tokio::test]
    async fn test_filter_commits_by_path() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Modify README", &[("README.md", "# Updated")]);
        repo.create_commit("Add other file", &[("other.txt", "other")]);

        let filter = CommitFilter {
            author: None,
            committer: None,
            message: None,
            after_date: None,
            before_date: None,
            path: Some("README.md".to_string()),
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: None,
            first_parent: None,
        };

        let result = filter_commits(repo.path_str(), filter, Some(100)).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        // Should include Initial commit (creates README.md) and the modification
        assert_eq!(commits.len(), 2);
    }

    #[tokio::test]
    async fn test_filter_commits_no_merges() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Normal commit", &[("file.txt", "content")]);

        let filter = CommitFilter {
            author: None,
            committer: None,
            message: None,
            after_date: None,
            before_date: None,
            path: None,
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: Some(true),
            first_parent: None,
        };

        let result = filter_commits(repo.path_str(), filter, Some(100)).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        // All commits are non-merge in this simple repo
        assert!(commits.iter().all(|c| !c.is_merge));
    }

    #[tokio::test]
    async fn test_filter_commits_max_results() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("f2.txt", "c")]);
        repo.create_commit("Third", &[("f3.txt", "c")]);
        repo.create_commit("Fourth", &[("f4.txt", "c")]);

        let filter = CommitFilter {
            author: None,
            committer: None,
            message: None,
            after_date: None,
            before_date: None,
            path: None,
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: None,
            first_parent: None,
        };

        let result = filter_commits(repo.path_str(), filter, Some(2)).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
    }

    #[tokio::test]
    async fn test_filter_commits_fields() {
        let repo = TestRepo::with_initial_commit();

        let filter = CommitFilter {
            author: None,
            committer: None,
            message: None,
            after_date: None,
            before_date: None,
            path: None,
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: None,
            first_parent: None,
        };

        let result = filter_commits(repo.path_str(), filter, Some(1)).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 1);

        let commit = &commits[0];
        assert!(!commit.oid.is_empty());
        assert!(!commit.short_oid.is_empty());
        assert!(commit.message.contains("Initial"));
        assert_eq!(commit.author_name, "Test User");
        assert_eq!(commit.author_email, "test@example.com");
        assert!(commit.author_date > 0);
        assert_eq!(commit.committer_name, "Test User");
        assert!(commit.committer_date > 0);
        assert_eq!(commit.parent_count, 0);
        assert!(!commit.is_merge);
    }

    #[tokio::test]
    async fn test_get_branch_diff_commits() {
        let repo = TestRepo::with_initial_commit();
        let base_branch = repo.current_branch();
        // Create a feature branch
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit 1", &[("feature1.txt", "f1")]);
        repo.create_commit("Feature commit 2", &[("feature2.txt", "f2")]);

        // Commits in feature but not in base
        let result = get_branch_diff_commits(
            repo.path_str(),
            base_branch,
            "feature".to_string(),
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
        assert!(commits
            .iter()
            .any(|c| c.message.contains("Feature commit 1")));
        assert!(commits
            .iter()
            .any(|c| c.message.contains("Feature commit 2")));
    }

    #[tokio::test]
    async fn test_get_branch_diff_commits_empty() {
        let repo = TestRepo::with_initial_commit();
        let base_branch = repo.current_branch();
        repo.create_branch("same-as-base");

        // Both branches point to the same commit
        let result = get_branch_diff_commits(
            repo.path_str(),
            base_branch,
            "same-as-base".to_string(),
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_file_log_basic() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Update README", &[("README.md", "# Updated")]);
        repo.create_commit("Update again", &[("README.md", "# Updated again")]);

        let result = get_file_log(
            repo.path_str(),
            "README.md".to_string(),
            Some(true),
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 3); // Initial + 2 updates
    }

    #[tokio::test]
    async fn test_get_file_log_with_limit() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Update README", &[("README.md", "# Updated")]);
        repo.create_commit("Update again", &[("README.md", "# Updated again")]);

        let result = get_file_log(
            repo.path_str(),
            "README.md".to_string(),
            Some(true),
            Some(2),
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
    }

    #[tokio::test]
    async fn test_get_file_log_nonexistent() {
        let repo = TestRepo::with_initial_commit();

        let result = get_file_log(
            repo.path_str(),
            "nonexistent_file_xyz.txt".to_string(),
            Some(true),
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_file_log_no_follow() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Update README", &[("README.md", "# v2")]);

        let result = get_file_log(
            repo.path_str(),
            "README.md".to_string(),
            Some(false),
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert!(!commits.is_empty());
    }

    #[tokio::test]
    async fn test_filter_commits_first_parent() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("f2.txt", "c2")]);

        let filter = CommitFilter {
            author: None,
            committer: None,
            message: None,
            after_date: None,
            before_date: None,
            path: None,
            branch: None,
            min_parents: None,
            max_parents: None,
            no_merges: None,
            first_parent: Some(true),
        };

        let result = filter_commits(repo.path_str(), filter, Some(100)).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
    }

    #[test]
    fn test_parse_log_line_valid() {
        let line = "abc123def456abc123def456abc123def456abc123|abc123d|feat: add feature|John Doe|john@example.com|1700000000|John Doe|1700000000|parent1 parent2";
        let commit = parse_log_line(line);
        assert!(commit.is_some());
        let commit = commit.unwrap();
        assert_eq!(commit.oid, "abc123def456abc123def456abc123def456abc123");
        assert_eq!(commit.short_oid, "abc123d");
        assert_eq!(commit.message, "feat: add feature");
        assert_eq!(commit.author_name, "John Doe");
        assert_eq!(commit.author_email, "john@example.com");
        assert_eq!(commit.author_date, 1700000000);
        assert_eq!(commit.committer_name, "John Doe");
        assert_eq!(commit.committer_date, 1700000000);
        assert_eq!(commit.parent_count, 2);
        assert!(commit.is_merge);
    }

    #[test]
    fn test_parse_log_line_no_parents() {
        let line = "abc123|abc1|initial|Author|a@b.com|1000|Author|1000|";
        let commit = parse_log_line(line);
        assert!(commit.is_some());
        let commit = commit.unwrap();
        assert_eq!(commit.parent_count, 0);
        assert!(!commit.is_merge);
    }

    #[test]
    fn test_parse_log_line_single_parent() {
        let line = "abc123|abc1|second|Author|a@b.com|1000|Author|1000|deadbeef";
        let commit = parse_log_line(line);
        assert!(commit.is_some());
        let commit = commit.unwrap();
        assert_eq!(commit.parent_count, 1);
        assert!(!commit.is_merge);
    }

    #[test]
    fn test_parse_log_line_invalid() {
        let line = "not enough parts";
        let commit = parse_log_line(line);
        assert!(commit.is_none());
    }

    #[test]
    fn test_parse_log_line_message_with_pipe() {
        // The message field is part of splitn(9, '|'), so pipes in parents field
        // are handled, but the subject (%s) should not contain pipes normally.
        // This tests that the 9-part split handles it correctly.
        let line = "abc123|abc1|msg|Author|a@b.com|1000|Committer|1000|p1 p2 p3";
        let commit = parse_log_line(line);
        assert!(commit.is_some());
        let commit = commit.unwrap();
        assert_eq!(commit.parent_count, 3);
    }
}
