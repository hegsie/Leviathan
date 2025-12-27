//! Test utilities for creating temporary git repositories

#![cfg(test)]

use std::path::PathBuf;
use tempfile::TempDir;

/// A temporary git repository for testing
pub struct TestRepo {
    pub dir: TempDir,
    pub path: PathBuf,
}

impl TestRepo {
    /// Create a new empty git repository
    pub fn new() -> Self {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().to_path_buf();

        let repo = git2::Repository::init(&path).expect("Failed to init repo");

        // Configure user for commits
        let mut config = repo.config().expect("Failed to get config");
        config
            .set_str("user.name", "Test User")
            .expect("Failed to set user.name");
        config
            .set_str("user.email", "test@example.com")
            .expect("Failed to set user.email");

        Self { dir, path }
    }

    /// Create a repository with an initial commit
    pub fn with_initial_commit() -> Self {
        let test_repo = Self::new();
        test_repo.create_commit("Initial commit", &[("README.md", "# Test Repo")]);
        test_repo
    }

    /// Get the repository path as a string
    pub fn path_str(&self) -> String {
        self.path.to_string_lossy().to_string()
    }

    /// Get the git2 repository
    pub fn repo(&self) -> git2::Repository {
        git2::Repository::open(&self.path).expect("Failed to open repo")
    }

    /// Create a file with content
    pub fn create_file(&self, name: &str, content: &str) {
        let file_path = self.path.join(name);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).expect("Failed to create parent dirs");
        }
        std::fs::write(&file_path, content).expect("Failed to write file");
    }

    /// Stage a file
    pub fn stage_file(&self, name: &str) {
        let repo = self.repo();
        let mut index = repo.index().expect("Failed to get index");
        index
            .add_path(std::path::Path::new(name))
            .expect("Failed to stage file");
        index.write().expect("Failed to write index");
    }

    /// Create a commit with the given files
    pub fn create_commit(&self, message: &str, files: &[(&str, &str)]) -> git2::Oid {
        let repo = self.repo();

        // Create and stage files
        for (name, content) in files {
            self.create_file(name, content);
            self.stage_file(name);
        }

        // Create commit
        let mut index = repo.index().expect("Failed to get index");
        let tree_oid = index.write_tree().expect("Failed to write tree");
        let tree = repo.find_tree(tree_oid).expect("Failed to find tree");
        let sig = repo.signature().expect("Failed to get signature");

        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.as_ref().into_iter().collect();

        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
            .expect("Failed to create commit")
    }

    /// Create a branch at the current HEAD
    pub fn create_branch(&self, name: &str) -> git2::Oid {
        let repo = self.repo();
        let head = repo.head().expect("Failed to get HEAD");
        let commit = head.peel_to_commit().expect("Failed to get commit");
        repo.branch(name, &commit, false)
            .expect("Failed to create branch");
        commit.id()
    }

    /// Checkout a branch
    pub fn checkout_branch(&self, name: &str) {
        let repo = self.repo();
        let branch = repo
            .find_branch(name, git2::BranchType::Local)
            .expect("Failed to find branch");
        let obj = branch
            .get()
            .peel(git2::ObjectType::Commit)
            .expect("Failed to peel");
        repo.checkout_tree(&obj, None).expect("Failed to checkout");
        repo.set_head(branch.get().name().unwrap())
            .expect("Failed to set HEAD");
    }

    /// Get the current branch name
    pub fn current_branch(&self) -> String {
        let repo = self.repo();
        let head = repo.head().expect("Failed to get HEAD");
        head.shorthand().unwrap_or("").to_string()
    }

    /// Get the HEAD commit OID
    pub fn head_oid(&self) -> git2::Oid {
        let repo = self.repo();
        let head = repo.head().expect("Failed to get HEAD");
        head.target().expect("Failed to get target")
    }

    /// Add a remote
    pub fn add_remote(&self, name: &str, url: &str) {
        let repo = self.repo();
        repo.remote(name, url).expect("Failed to add remote");
    }

    /// Create a tag
    pub fn create_tag(&self, name: &str) -> git2::Oid {
        let repo = self.repo();
        let head = repo.head().expect("Failed to get HEAD");
        let commit = head.peel_to_commit().expect("Failed to get commit");
        let sig = repo.signature().expect("Failed to get signature");
        repo.tag(name, commit.as_object(), &sig, &format!("Tag {}", name), false)
            .expect("Failed to create tag")
    }

    /// Create a lightweight tag
    pub fn create_lightweight_tag(&self, name: &str) {
        let repo = self.repo();
        let head = repo.head().expect("Failed to get HEAD");
        let commit = head.peel_to_commit().expect("Failed to get commit");
        repo.tag_lightweight(name, commit.as_object(), false)
            .expect("Failed to create lightweight tag");
    }
}

impl Default for TestRepo {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_repo() {
        let repo = TestRepo::new();
        assert!(repo.path.exists());
        assert!(repo.path.join(".git").exists());
    }

    #[test]
    fn test_create_commit() {
        let repo = TestRepo::with_initial_commit();
        let git_repo = repo.repo();
        let head = git_repo.head().expect("No HEAD");
        assert!(head.target().is_some());
    }

    #[test]
    fn test_create_branch() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");
        let git_repo = repo.repo();
        let branch = git_repo.find_branch("feature", git2::BranchType::Local);
        assert!(branch.is_ok());
    }

    #[test]
    fn test_checkout_branch() {
        let repo = TestRepo::with_initial_commit();
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        assert_eq!(repo.current_branch(), "feature");
    }
}
