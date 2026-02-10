//! Background commit index for fast searching

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::Result;

/// An indexed commit for fast search
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedCommit {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub message_lower: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: i64,
    pub parent_count: usize,
}

/// In-memory commit index for a repository
pub struct CommitIndex {
    commits: Vec<IndexedCommit>,
    oid_map: HashMap<String, usize>,
    repo_path: String,
}

impl CommitIndex {
    /// Build an index from a repository path
    pub fn build(repo_path: &str) -> Result<Self> {
        let repo = git2::Repository::open(repo_path)?;
        let mut revwalk = repo.revwalk()?;

        // Walk all refs
        revwalk.push_glob("refs/*")?;
        revwalk.set_sorting(git2::Sort::TIME)?;

        let mut commits = Vec::new();
        let mut oid_map = HashMap::new();
        let max_commits = 100_000;

        for oid_result in revwalk {
            if commits.len() >= max_commits {
                break;
            }

            let oid = match oid_result {
                Ok(o) => o,
                Err(_) => continue,
            };

            let commit = match repo.find_commit(oid) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let oid_str = oid.to_string();
            let short_oid = oid_str[..7.min(oid_str.len())].to_string();
            let summary = commit.summary().unwrap_or("").to_string();
            let message = commit.message().unwrap_or("").to_lowercase();
            let author = commit.author();

            let indexed = IndexedCommit {
                oid: oid_str.clone(),
                short_oid,
                summary,
                message_lower: message,
                author_name: author.name().unwrap_or("").to_string(),
                author_email: author.email().unwrap_or("").to_string(),
                author_date: author.when().seconds(),
                parent_count: commit.parent_count(),
            };

            oid_map.insert(oid_str, commits.len());
            commits.push(indexed);
        }

        Ok(Self {
            commits,
            oid_map,
            repo_path: repo_path.to_string(),
        })
    }

    /// Search the index with filters
    pub fn search(
        &self,
        query: Option<&str>,
        author: Option<&str>,
        date_from: Option<i64>,
        date_to: Option<i64>,
        limit: Option<usize>,
    ) -> Vec<&IndexedCommit> {
        let query_lower = query.map(|q| q.to_lowercase());
        let author_lower = author.map(|a| a.to_lowercase());
        let limit = limit.unwrap_or(500);

        self.commits
            .iter()
            .filter(|c| {
                // Query filter: search in message and short_oid
                if let Some(ref q) = query_lower {
                    if !c.message_lower.contains(q.as_str())
                        && !c.short_oid.starts_with(q.as_str())
                        && !c.oid.starts_with(q.as_str())
                    {
                        return false;
                    }
                }

                // Author filter
                if let Some(ref a) = author_lower {
                    if !c.author_name.to_lowercase().contains(a.as_str())
                        && !c.author_email.to_lowercase().contains(a.as_str())
                    {
                        return false;
                    }
                }

                // Date filters
                if let Some(from) = date_from {
                    if c.author_date < from {
                        return false;
                    }
                }
                if let Some(to) = date_to {
                    if c.author_date > to {
                        return false;
                    }
                }

                true
            })
            .take(limit)
            .collect()
    }

    /// Incrementally update the index with new commits
    pub fn update_incremental(&mut self, repo_path: &str) -> Result<usize> {
        let repo = git2::Repository::open(repo_path)?;
        let mut revwalk = repo.revwalk()?;

        revwalk.push_glob("refs/*")?;
        revwalk.set_sorting(git2::Sort::TIME)?;

        let mut new_commits = Vec::new();

        for oid_result in revwalk {
            let oid = match oid_result {
                Ok(o) => o,
                Err(_) => continue,
            };

            let oid_str = oid.to_string();

            // Stop when we hit a known commit
            if self.oid_map.contains_key(&oid_str) {
                break;
            }

            let commit = match repo.find_commit(oid) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let short_oid = oid_str[..7.min(oid_str.len())].to_string();
            let summary = commit.summary().unwrap_or("").to_string();
            let message = commit.message().unwrap_or("").to_lowercase();
            let author = commit.author();

            new_commits.push(IndexedCommit {
                oid: oid_str,
                short_oid,
                summary,
                message_lower: message,
                author_name: author.name().unwrap_or("").to_string(),
                author_email: author.email().unwrap_or("").to_string(),
                author_date: author.when().seconds(),
                parent_count: commit.parent_count(),
            });
        }

        let count = new_commits.len();

        if count > 0 {
            // Update oid_map indices for existing commits (shift by count)
            for value in self.oid_map.values_mut() {
                *value += count;
            }

            // Add new commits to the front
            for (i, commit) in new_commits.iter().enumerate() {
                self.oid_map.insert(commit.oid.clone(), i);
            }

            // Prepend new commits
            new_commits.append(&mut self.commits);
            self.commits = new_commits;
        }

        self.repo_path = repo_path.to_string();
        Ok(count)
    }

    /// Number of indexed commits
    pub fn len(&self) -> usize {
        self.commits.len()
    }

    /// Whether the index is empty
    pub fn is_empty(&self) -> bool {
        self.commits.is_empty()
    }
}

/// Shared commit index state
pub type SharedCommitIndex = Arc<RwLock<Option<CommitIndex>>>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[test]
    fn test_build_index() {
        let repo = TestRepo::with_initial_commit();
        let index = CommitIndex::build(&repo.path_str()).unwrap();
        assert!(index.len() >= 1);
    }

    #[test]
    fn test_search_by_message() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add feature X", &[("feature.txt", "content")]);

        let index = CommitIndex::build(&repo.path_str()).unwrap();
        let results = index.search(Some("feature X"), None, None, None, None);
        assert!(!results.is_empty());
        assert!(results[0].summary.contains("feature X"));
    }

    #[test]
    fn test_search_by_author() {
        let repo = TestRepo::with_initial_commit();
        let index = CommitIndex::build(&repo.path_str()).unwrap();
        let results = index.search(None, Some("Test User"), None, None, None);
        assert!(!results.is_empty());
    }

    #[test]
    fn test_search_no_match() {
        let repo = TestRepo::with_initial_commit();
        let index = CommitIndex::build(&repo.path_str()).unwrap();
        let results = index.search(Some("nonexistent_query_12345"), None, None, None, None);
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_with_limit() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("a.txt", "a")]);
        repo.create_commit("Third", &[("b.txt", "b")]);

        let index = CommitIndex::build(&repo.path_str()).unwrap();
        let results = index.search(None, None, None, None, Some(1));
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_incremental_update() {
        let repo = TestRepo::with_initial_commit();
        let mut index = CommitIndex::build(&repo.path_str()).unwrap();
        let initial_count = index.len();

        // Add a new commit
        repo.create_commit("New commit", &[("new.txt", "new")]);

        let new_count = index.update_incremental(&repo.path_str()).unwrap();
        assert_eq!(new_count, 1);
        assert_eq!(index.len(), initial_count + 1);
    }

    #[test]
    fn test_incremental_update_no_new() {
        let repo = TestRepo::with_initial_commit();
        let mut index = CommitIndex::build(&repo.path_str()).unwrap();

        let new_count = index.update_incremental(&repo.path_str()).unwrap();
        assert_eq!(new_count, 0);
    }

    #[test]
    fn test_search_by_oid_prefix() {
        let repo = TestRepo::with_initial_commit();
        let index = CommitIndex::build(&repo.path_str()).unwrap();

        // Get the first commit's short oid
        let short_oid = &index.commits[0].short_oid;
        let results = index.search(Some(short_oid), None, None, None, None);
        assert!(!results.is_empty());
    }
}
