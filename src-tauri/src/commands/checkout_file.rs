//! Checkout file from a specific commit or branch
//! Allows users to restore a file to its state at a specific commit,
//! checkout from a branch, or view file contents at a specific commit.

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Result of viewing a file at a specific commit
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAtCommitResult {
    pub file_path: String,
    pub commit_oid: String,
    pub content: String,
    pub is_binary: bool,
    pub size: u64,
}

/// Resolve a commit-ish string (OID, branch name, tag, HEAD~N, etc.) to a commit
fn resolve_commit<'repo>(
    repo: &'repo git2::Repository,
    commit_ish: &str,
) -> Result<git2::Commit<'repo>> {
    let obj = repo.revparse_single(commit_ish).map_err(|_| {
        LeviathanError::CommitNotFound(format!("Cannot resolve reference: {}", commit_ish))
    })?;
    obj.peel_to_commit().map_err(|_| {
        LeviathanError::CommitNotFound(format!("Reference is not a commit: {}", commit_ish))
    })
}

/// Find a blob for a file path in a commit's tree
fn find_blob_in_commit<'repo>(
    repo: &'repo git2::Repository,
    commit: &git2::Commit,
    file_path: &str,
) -> Result<git2::Blob<'repo>> {
    let tree = commit.tree().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to get commit tree: {}", e))
    })?;

    // Normalize path separators to forward slashes for git
    let normalized_path = file_path.replace('\\', "/");

    let entry = tree.get_path(Path::new(&normalized_path)).map_err(|_| {
        LeviathanError::OperationFailed(format!(
            "File '{}' not found in commit {}",
            file_path,
            commit.id()
        ))
    })?;

    let object = entry.to_object(repo).map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to get file object: {}", e))
    })?;

    object.into_blob().map_err(|_| {
        LeviathanError::OperationFailed(format!(
            "'{}' is not a file (might be a directory)",
            file_path
        ))
    })
}

/// Check if content appears to be binary
fn is_binary_content(content: &[u8]) -> bool {
    // Check first 8000 bytes for null bytes (same heuristic as git)
    let check_len = content.len().min(8000);
    content[..check_len].contains(&0)
}

/// Checkout a file from a specific commit, restoring it in the working directory
///
/// This overwrites the file in the working directory with its contents from the specified commit.
#[command]
pub async fn checkout_file_from_commit(
    path: String,
    #[allow(non_snake_case)] filePath: String,
    commit: String,
) -> Result<FileAtCommitResult> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let resolved_commit = resolve_commit(&repo, &commit)?;
    let blob = find_blob_in_commit(&repo, &resolved_commit, &filePath)?;

    let content = blob.content();
    let is_binary = is_binary_content(content);
    let size = content.len() as u64;

    // Write the file content to the working directory
    let abs_path = Path::new(&path).join(&filePath);
    if let Some(parent) = abs_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to create parent directories: {}", e))
        })?;
    }
    std::fs::write(&abs_path, content)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to write file: {}", e)))?;

    // Also update the index to match
    let mut index = repo
        .index()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to get index: {}", e)))?;
    let normalized_path = filePath.replace('\\', "/");
    index
        .add_path(Path::new(&normalized_path))
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to update index: {}", e)))?;
    index
        .write()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to write index: {}", e)))?;

    let content_str = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(content).to_string()
    };

    Ok(FileAtCommitResult {
        file_path: filePath,
        commit_oid: resolved_commit.id().to_string(),
        content: content_str,
        is_binary,
        size,
    })
}

/// Checkout a file from a specific branch, restoring it in the working directory
///
/// This resolves the branch to its tip commit and checks out the file from that commit.
#[command]
pub async fn checkout_file_from_branch(
    path: String,
    #[allow(non_snake_case)] filePath: String,
    branch: String,
) -> Result<FileAtCommitResult> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Try to resolve as a local branch first, then as a remote branch
    let branch_ref = repo
        .find_branch(&branch, git2::BranchType::Local)
        .or_else(|_| repo.find_branch(&branch, git2::BranchType::Remote))
        .map_err(|_| LeviathanError::BranchNotFound(branch.clone()))?;

    let commit = branch_ref.get().peel_to_commit().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to resolve branch to commit: {}", e))
    })?;

    let blob = find_blob_in_commit(&repo, &commit, &filePath)?;

    let content = blob.content();
    let is_binary = is_binary_content(content);
    let size = content.len() as u64;

    // Write the file content to the working directory
    let abs_path = Path::new(&path).join(&filePath);
    if let Some(parent) = abs_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to create parent directories: {}", e))
        })?;
    }
    std::fs::write(&abs_path, content)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to write file: {}", e)))?;

    // Also update the index to match
    let mut index = repo
        .index()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to get index: {}", e)))?;
    let normalized_path = filePath.replace('\\', "/");
    index
        .add_path(Path::new(&normalized_path))
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to update index: {}", e)))?;
    index
        .write()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to write index: {}", e)))?;

    let content_str = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(content).to_string()
    };

    Ok(FileAtCommitResult {
        file_path: filePath,
        commit_oid: commit.id().to_string(),
        content: content_str,
        is_binary,
        size,
    })
}

/// View a file at a specific commit without modifying the working directory
///
/// Returns the file content at the specified commit for display purposes.
#[command]
pub async fn get_file_at_commit(
    path: String,
    #[allow(non_snake_case)] filePath: String,
    commit: String,
) -> Result<FileAtCommitResult> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let resolved_commit = resolve_commit(&repo, &commit)?;
    let blob = find_blob_in_commit(&repo, &resolved_commit, &filePath)?;

    let content = blob.content();
    let is_binary = is_binary_content(content);
    let size = content.len() as u64;

    let content_str = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(content).to_string()
    };

    Ok(FileAtCommitResult {
        file_path: filePath,
        commit_oid: resolved_commit.id().to_string(),
        content: content_str,
        is_binary,
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_file_at_commit() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result =
            get_file_at_commit(repo.path_str(), "README.md".to_string(), oid.to_string()).await;

        assert!(result.is_ok());
        let file_result = result.unwrap();
        assert_eq!(file_result.file_path, "README.md");
        assert_eq!(file_result.commit_oid, oid.to_string());
        assert_eq!(file_result.content, "# Test Repo");
        assert!(!file_result.is_binary);
        assert_eq!(file_result.size, 11); // "# Test Repo" is 11 bytes
    }

    #[tokio::test]
    async fn test_get_file_at_commit_with_ref() {
        let repo = TestRepo::with_initial_commit();

        // Use "HEAD" as a ref instead of an OID
        let result =
            get_file_at_commit(repo.path_str(), "README.md".to_string(), "HEAD".to_string()).await;

        assert!(result.is_ok());
        let file_result = result.unwrap();
        assert_eq!(file_result.content, "# Test Repo");
    }

    #[tokio::test]
    async fn test_get_file_at_commit_file_not_found() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result = get_file_at_commit(
            repo.path_str(),
            "nonexistent.txt".to_string(),
            oid.to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_file_at_commit_invalid_commit() {
        let repo = TestRepo::with_initial_commit();

        let result = get_file_at_commit(
            repo.path_str(),
            "README.md".to_string(),
            "0000000000000000000000000000000000000000".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_file_at_older_commit() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        // Create a second commit that modifies the file
        repo.create_commit("Second commit", &[("README.md", "# Updated Repo")]);

        // Get file at the first commit - should have original content
        let result = get_file_at_commit(
            repo.path_str(),
            "README.md".to_string(),
            first_oid.to_string(),
        )
        .await;

        assert!(result.is_ok());
        let file_result = result.unwrap();
        assert_eq!(file_result.content, "# Test Repo");
        assert_eq!(file_result.commit_oid, first_oid.to_string());
    }

    #[tokio::test]
    async fn test_get_file_at_commit_subdirectory() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add nested file", &[("src/main.rs", "fn main() {}")]);
        let oid = repo.head_oid();

        let result =
            get_file_at_commit(repo.path_str(), "src/main.rs".to_string(), oid.to_string()).await;

        assert!(result.is_ok());
        let file_result = result.unwrap();
        assert_eq!(file_result.content, "fn main() {}");
    }

    #[tokio::test]
    async fn test_checkout_file_from_commit() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        // Modify the file
        repo.create_commit("Update README", &[("README.md", "# Updated Repo")]);

        // Verify working directory has updated content
        let current_content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(current_content, "# Updated Repo");

        // Checkout file from the first commit
        let result = checkout_file_from_commit(
            repo.path_str(),
            "README.md".to_string(),
            first_oid.to_string(),
        )
        .await;

        assert!(result.is_ok());
        let file_result = result.unwrap();
        assert_eq!(file_result.content, "# Test Repo");
        assert_eq!(file_result.commit_oid, first_oid.to_string());

        // Verify working directory was updated
        let restored_content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(restored_content, "# Test Repo");
    }

    #[tokio::test]
    async fn test_checkout_file_from_commit_invalid_commit() {
        let repo = TestRepo::with_initial_commit();

        let result = checkout_file_from_commit(
            repo.path_str(),
            "README.md".to_string(),
            "invalid_ref".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_checkout_file_from_commit_file_not_found() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result = checkout_file_from_commit(
            repo.path_str(),
            "nonexistent.txt".to_string(),
            oid.to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_checkout_file_from_branch() {
        let repo = TestRepo::with_initial_commit();

        // Record the main branch name before switching
        let main = repo.current_branch();

        // Create a feature branch with different file content
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("README.md", "# Feature Branch")]);

        // Switch back to main
        repo.checkout_branch(&main);

        // Verify we're on main with original content
        let current_content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(current_content, "# Test Repo");

        // Checkout file from feature branch
        let result = checkout_file_from_branch(
            repo.path_str(),
            "README.md".to_string(),
            "feature".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let file_result = result.unwrap();
        assert_eq!(file_result.content, "# Feature Branch");

        // Verify working directory was updated
        let restored_content = std::fs::read_to_string(repo.path.join("README.md")).unwrap();
        assert_eq!(restored_content, "# Feature Branch");
    }

    #[tokio::test]
    async fn test_checkout_file_from_branch_not_found() {
        let repo = TestRepo::with_initial_commit();

        let result = checkout_file_from_branch(
            repo.path_str(),
            "README.md".to_string(),
            "nonexistent-branch".to_string(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_checkout_file_from_branch_file_not_found() {
        let repo = TestRepo::with_initial_commit();

        let result = checkout_file_from_branch(
            repo.path_str(),
            "nonexistent.txt".to_string(),
            repo.current_branch(),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_file_at_commit_binary_detection() {
        let repo = TestRepo::with_initial_commit();

        // Create a file with binary content (contains null bytes)
        let mut binary_content = vec![0u8; 100];
        binary_content[0] = 0x89; // PNG header byte
        binary_content[1] = 0x50;
        binary_content[10] = 0x00; // null byte
        std::fs::write(repo.path.join("image.png"), &binary_content).unwrap();
        repo.stage_file("image.png");

        let git_repo = repo.repo();
        let mut index = git_repo.index().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = git_repo.find_tree(tree_oid).unwrap();
        let sig = git_repo.signature().unwrap();
        let parent = git_repo.head().unwrap().peel_to_commit().unwrap();
        git_repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "Add binary file",
                &tree,
                &[&parent],
            )
            .unwrap();

        let oid = repo.head_oid();
        let result =
            get_file_at_commit(repo.path_str(), "image.png".to_string(), oid.to_string()).await;

        assert!(result.is_ok());
        let file_result = result.unwrap();
        assert!(file_result.is_binary);
        assert!(file_result.content.is_empty()); // Binary content is not returned as text
        assert_eq!(file_result.size, 100);
    }

    #[tokio::test]
    async fn test_checkout_file_creates_parent_directories() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit(
            "Add nested file",
            &[("deep/nested/dir/file.txt", "nested content")],
        );
        let oid = repo.head_oid();

        // Remove the directory
        let _ = std::fs::remove_dir_all(repo.path.join("deep"));

        // Checkout should recreate the directories
        let result = checkout_file_from_commit(
            repo.path_str(),
            "deep/nested/dir/file.txt".to_string(),
            oid.to_string(),
        )
        .await;

        assert!(result.is_ok());
        let restored = std::fs::read_to_string(repo.path.join("deep/nested/dir/file.txt")).unwrap();
        assert_eq!(restored, "nested content");
    }

    #[tokio::test]
    async fn test_get_file_at_commit_with_tag() {
        let repo = TestRepo::with_initial_commit();
        repo.create_tag("v1.0.0");

        // Modify the file
        repo.create_commit("Update README", &[("README.md", "# Updated Repo")]);

        // Use tag to get old content
        let result = get_file_at_commit(
            repo.path_str(),
            "README.md".to_string(),
            "v1.0.0".to_string(),
        )
        .await;

        assert!(result.is_ok());
        let file_result = result.unwrap();
        assert_eq!(file_result.content, "# Test Repo");
    }

    #[tokio::test]
    async fn test_checkout_file_from_commit_updates_index() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();

        // Create a second commit
        repo.create_commit("Update README", &[("README.md", "# Updated Repo")]);

        // Checkout file from first commit
        let result = checkout_file_from_commit(
            repo.path_str(),
            "README.md".to_string(),
            first_oid.to_string(),
        )
        .await;
        assert!(result.is_ok());

        // Verify the index was updated (file should be staged)
        let git_repo = repo.repo();
        let index = git_repo.index().unwrap();
        let entry = index.get_path(Path::new("README.md"), 0);
        assert!(entry.is_some());
    }
}
