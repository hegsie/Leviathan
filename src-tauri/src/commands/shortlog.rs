//! Shortlog command handlers
//! Provides contributor commit summaries similar to `git shortlog`

use std::collections::HashMap;
use std::path::Path;
use tauri::command;

use crate::error::Result;

/// A single entry in the shortlog output
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortlogEntry {
    pub name: String,
    pub email: Option<String>,
    pub count: u32,
    pub commits: Vec<String>, // commit messages (if not summary mode)
}

/// Result of the shortlog command
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortlogResult {
    pub entries: Vec<ShortlogEntry>,
    pub total_commits: u32,
    pub total_contributors: u32,
}

/// Get shortlog output - contributor commit summaries
///
/// # Arguments
/// * `path` - Repository path
/// * `range` - Optional revision range (e.g., "v1.0..HEAD")
/// * `all` - Include all branches (--all)
/// * `numbered` - Sort by number of commits (--numbered)
/// * `summary` - Suppress commit descriptions (--summary)
/// * `email` - Show email instead of name (--email)
/// * `group` - Group by "author" or "committer"
#[command]
pub async fn shortlog(
    path: String,
    range: Option<String>,
    all: Option<bool>,
    numbered: Option<bool>,
    summary: Option<bool>,
    email: Option<bool>,
    group: Option<String>,
) -> Result<ShortlogResult> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let use_all = all.unwrap_or(false);
    let use_numbered = numbered.unwrap_or(false);
    let use_summary = summary.unwrap_or(false);
    let show_email = email.unwrap_or(false);
    let group_by = group.as_deref().unwrap_or("author");

    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    // Handle revision range
    if let Some(ref range_spec) = range {
        if range_spec.contains("..") {
            // Range specification like "v1.0..HEAD"
            let parts: Vec<&str> = range_spec.split("..").collect();
            if parts.len() == 2 {
                let from_spec = parts[0];
                let to_spec = if parts[1].is_empty() {
                    "HEAD"
                } else {
                    parts[1]
                };

                // Resolve the 'to' revision and push it
                let to_obj = repo.revparse_single(to_spec)?;
                revwalk.push(to_obj.id())?;

                // Resolve the 'from' revision and hide it
                if !from_spec.is_empty() {
                    let from_obj = repo.revparse_single(from_spec)?;
                    revwalk.hide(from_obj.id())?;
                }
            } else {
                // Fallback: just parse as single revision
                let obj = repo.revparse_single(range_spec)?;
                revwalk.push(obj.id())?;
            }
        } else {
            // Single revision - walk from that point
            let obj = repo.revparse_single(range_spec)?;
            revwalk.push(obj.id())?;
        }
    } else if use_all {
        // Include all branches
        for r in repo.references()?.flatten() {
            if let Some(oid) = r.target() {
                let _ = revwalk.push(oid);
            }
        }
    } else {
        // Default: just HEAD
        revwalk.push_head()?;
    }

    // Group commits by author/committer
    let mut contributors_map: HashMap<String, (String, Option<String>, Vec<String>)> =
        HashMap::new();
    let mut total_commits: u32 = 0;

    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        total_commits += 1;

        // Get the person based on group_by
        let person = if group_by == "committer" {
            commit.committer()
        } else {
            commit.author()
        };

        let person_name = person.name().unwrap_or("Unknown").to_string();
        let person_email = person.email().map(|s| s.to_string());

        // Use email as key if showing email, otherwise use name
        let key = if show_email {
            person_email.clone().unwrap_or_else(|| person_name.clone())
        } else {
            // Use email as unique key but display name
            person_email.clone().unwrap_or_else(|| person_name.clone())
        };

        let commit_summary = commit.summary().unwrap_or("").to_string();

        let entry = contributors_map
            .entry(key)
            .or_insert_with(|| (person_name.clone(), person_email.clone(), Vec::new()));

        // Update name if we have a better one (non-Unknown)
        if entry.0 == "Unknown" && person_name != "Unknown" {
            entry.0 = person_name;
        }
        // Update email if we don't have one
        if entry.1.is_none() && person_email.is_some() {
            entry.1 = person_email;
        }

        // Add commit message if not in summary mode
        if !use_summary {
            entry.2.push(commit_summary);
        }
    }

    // Build result entries
    let mut entries: Vec<ShortlogEntry> = contributors_map
        .into_iter()
        .map(|(_, (name, email, commits))| ShortlogEntry {
            name: name.clone(),
            email,
            count: commits.len() as u32,
            commits,
        })
        .collect();

    // Sort entries
    if use_numbered {
        // Sort by commit count (descending)
        entries.sort_by(|a, b| b.count.cmp(&a.count));
    } else {
        // Sort alphabetically by name
        entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }

    let total_contributors = entries.len() as u32;

    Ok(ShortlogResult {
        entries,
        total_commits,
        total_contributors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_shortlog_empty_repo() {
        let repo = TestRepo::new();
        let result = shortlog(repo.path_str(), None, None, None, None, None, None).await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        assert_eq!(shortlog_result.total_commits, 0);
        assert_eq!(shortlog_result.total_contributors, 0);
        assert!(shortlog_result.entries.is_empty());
    }

    #[tokio::test]
    async fn test_shortlog_with_commits() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file.txt", "content")]);
        repo.create_commit("Third commit", &[("file2.txt", "content2")]);

        let result = shortlog(repo.path_str(), None, None, None, None, None, None).await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        assert_eq!(shortlog_result.total_commits, 3);
        assert_eq!(shortlog_result.total_contributors, 1);
        assert_eq!(shortlog_result.entries[0].name, "Test User");
        assert_eq!(shortlog_result.entries[0].count, 3);
    }

    #[tokio::test]
    async fn test_shortlog_summary_mode() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file.txt", "content")]);

        let result = shortlog(
            repo.path_str(),
            None,
            None,
            None,
            Some(true), // summary mode
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        assert_eq!(shortlog_result.total_commits, 2);
        // In summary mode, commits list should be empty
        assert!(shortlog_result.entries[0].commits.is_empty());
    }

    #[tokio::test]
    async fn test_shortlog_with_commit_messages() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file.txt", "content")]);

        let result = shortlog(
            repo.path_str(),
            None,
            None,
            None,
            Some(false), // not summary mode
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        // Should have commit messages
        assert_eq!(shortlog_result.entries[0].commits.len(), 2);
        assert!(shortlog_result.entries[0]
            .commits
            .iter()
            .any(|m| m.contains("Initial commit") || m.contains("Second commit")));
    }

    #[tokio::test]
    async fn test_shortlog_numbered() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file.txt", "content")]);

        let result = shortlog(
            repo.path_str(),
            None,
            None,
            Some(true), // numbered
            Some(true),
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        // Should be sorted by count (only one contributor so trivially true)
        assert_eq!(shortlog_result.entries[0].count, 2);
    }

    #[tokio::test]
    async fn test_shortlog_shows_email() {
        let repo = TestRepo::with_initial_commit();

        let result = shortlog(
            repo.path_str(),
            None,
            None,
            None,
            Some(true),
            Some(true), // show email
            None,
        )
        .await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        assert!(shortlog_result.entries[0].email.is_some());
        assert_eq!(
            shortlog_result.entries[0].email.as_ref().unwrap(),
            "test@example.com"
        );
    }

    #[tokio::test]
    async fn test_shortlog_group_by_committer() {
        let repo = TestRepo::with_initial_commit();

        let result = shortlog(
            repo.path_str(),
            None,
            None,
            None,
            Some(true),
            None,
            Some("committer".to_string()),
        )
        .await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        // In test repo, author and committer are the same
        assert_eq!(shortlog_result.total_contributors, 1);
    }

    #[tokio::test]
    async fn test_shortlog_with_range() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid().to_string();
        repo.create_commit("Second commit", &[("file.txt", "content")]);
        repo.create_commit("Third commit", &[("file2.txt", "content2")]);

        // Use range from first commit to HEAD (exclusive of first)
        let range = format!("{}..HEAD", first_oid);
        let result = shortlog(
            repo.path_str(),
            Some(range),
            None,
            None,
            Some(true),
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        // Should only have 2 commits (Second and Third, not Initial)
        assert_eq!(shortlog_result.total_commits, 2);
    }

    #[tokio::test]
    async fn test_shortlog_with_tag_range() {
        let repo = TestRepo::with_initial_commit();
        repo.create_tag("v1.0");
        repo.create_commit("Second commit", &[("file.txt", "content")]);
        repo.create_commit("Third commit", &[("file2.txt", "content2")]);

        // Use range from v1.0 to HEAD
        let result = shortlog(
            repo.path_str(),
            Some("v1.0..HEAD".to_string()),
            None,
            None,
            Some(true),
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        // Should only have 2 commits (after v1.0)
        assert_eq!(shortlog_result.total_commits, 2);
    }

    #[tokio::test]
    async fn test_shortlog_all_branches() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature commit", &[("feature.txt", "feature content")]);

        let result = shortlog(
            repo.path_str(),
            None,
            Some(true), // all branches
            None,
            Some(true),
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();
        // Should include commits from all branches
        assert!(shortlog_result.total_commits >= 2);
    }

    #[tokio::test]
    async fn test_shortlog_invalid_path() {
        let result = shortlog(
            "/nonexistent/path".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_shortlog_entry_fields() {
        let repo = TestRepo::with_initial_commit();

        let result = shortlog(repo.path_str(), None, None, None, None, None, None).await;
        assert!(result.is_ok());
        let shortlog_result = result.unwrap();

        let entry = &shortlog_result.entries[0];
        assert_eq!(entry.name, "Test User");
        assert!(entry.email.is_some());
        assert_eq!(entry.email.as_ref().unwrap(), "test@example.com");
        assert_eq!(entry.count, 1);
        assert_eq!(entry.commits.len(), 1);
    }

    #[tokio::test]
    async fn test_shortlog_alphabetical_sort() {
        // With a single contributor, we can't test multi-contributor sorting
        // but we can verify the code path runs without error
        let repo = TestRepo::with_initial_commit();

        let result = shortlog(
            repo.path_str(),
            None,
            None,
            Some(false), // alphabetical sort
            Some(true),
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
    }
}
