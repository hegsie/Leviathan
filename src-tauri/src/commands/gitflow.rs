//! Git Flow command handlers
//! Implements the git-flow branching model

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::Branch;

/// Git Flow configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFlowConfig {
    pub initialized: bool,
    pub master_branch: String,
    pub develop_branch: String,
    pub feature_prefix: String,
    pub release_prefix: String,
    pub hotfix_prefix: String,
    pub support_prefix: String,
    pub version_tag_prefix: String,
}

impl Default for GitFlowConfig {
    fn default() -> Self {
        Self {
            initialized: false,
            master_branch: "main".to_string(),
            develop_branch: "develop".to_string(),
            feature_prefix: "feature/".to_string(),
            release_prefix: "release/".to_string(),
            hotfix_prefix: "hotfix/".to_string(),
            support_prefix: "support/".to_string(),
            version_tag_prefix: "v".to_string(),
        }
    }
}

/// Get the current git flow configuration
#[command]
pub async fn get_gitflow_config(path: String) -> Result<GitFlowConfig> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let config = repo.config()?;

    let initialized = config.get_string("gitflow.branch.master").is_ok();

    if !initialized {
        return Ok(GitFlowConfig::default());
    }

    Ok(GitFlowConfig {
        initialized: true,
        master_branch: config
            .get_string("gitflow.branch.master")
            .unwrap_or_else(|_| "main".to_string()),
        develop_branch: config
            .get_string("gitflow.branch.develop")
            .unwrap_or_else(|_| "develop".to_string()),
        feature_prefix: config
            .get_string("gitflow.prefix.feature")
            .unwrap_or_else(|_| "feature/".to_string()),
        release_prefix: config
            .get_string("gitflow.prefix.release")
            .unwrap_or_else(|_| "release/".to_string()),
        hotfix_prefix: config
            .get_string("gitflow.prefix.hotfix")
            .unwrap_or_else(|_| "hotfix/".to_string()),
        support_prefix: config
            .get_string("gitflow.prefix.support")
            .unwrap_or_else(|_| "support/".to_string()),
        version_tag_prefix: config
            .get_string("gitflow.prefix.versiontag")
            .unwrap_or_else(|_| "v".to_string()),
    })
}

/// Initialize git flow in the repository
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn init_gitflow(
    path: String,
    master_branch: Option<String>,
    develop_branch: Option<String>,
    feature_prefix: Option<String>,
    release_prefix: Option<String>,
    hotfix_prefix: Option<String>,
    support_prefix: Option<String>,
    version_tag_prefix: Option<String>,
) -> Result<GitFlowConfig> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut config = repo.config()?;

    let master = master_branch.unwrap_or_else(|| "main".to_string());
    let develop = develop_branch.unwrap_or_else(|| "develop".to_string());
    let feature = feature_prefix.unwrap_or_else(|| "feature/".to_string());
    let release = release_prefix.unwrap_or_else(|| "release/".to_string());
    let hotfix = hotfix_prefix.unwrap_or_else(|| "hotfix/".to_string());
    let support = support_prefix.unwrap_or_else(|| "support/".to_string());
    let version_tag = version_tag_prefix.unwrap_or_else(|| "v".to_string());

    // Set git flow config values
    config.set_str("gitflow.branch.master", &master)?;
    config.set_str("gitflow.branch.develop", &develop)?;
    config.set_str("gitflow.prefix.feature", &feature)?;
    config.set_str("gitflow.prefix.release", &release)?;
    config.set_str("gitflow.prefix.hotfix", &hotfix)?;
    config.set_str("gitflow.prefix.support", &support)?;
    config.set_str("gitflow.prefix.versiontag", &version_tag)?;

    // Ensure develop branch exists
    let develop_exists = repo.find_branch(&develop, git2::BranchType::Local).is_ok();

    if !develop_exists {
        // Create develop from master/main
        let master_branch = repo
            .find_branch(&master, git2::BranchType::Local)
            .or_else(|_| repo.find_branch("master", git2::BranchType::Local))
            .or_else(|_| repo.find_branch("main", git2::BranchType::Local))
            .map_err(|_| {
                LeviathanError::OperationFailed(
                    "Cannot find master/main branch to create develop from".to_string(),
                )
            })?;

        let commit = master_branch.get().peel_to_commit()?;
        repo.branch(&develop, &commit, false)?;
    }

    Ok(GitFlowConfig {
        initialized: true,
        master_branch: master,
        develop_branch: develop,
        feature_prefix: feature,
        release_prefix: release,
        hotfix_prefix: hotfix,
        support_prefix: support,
        version_tag_prefix: version_tag,
    })
}

/// Start a git flow feature branch
#[command]
pub async fn gitflow_start_feature(path: String, name: String) -> Result<Branch> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let config = repo.config()?;

    let develop = config
        .get_string("gitflow.branch.develop")
        .unwrap_or_else(|_| "develop".to_string());
    let prefix = config
        .get_string("gitflow.prefix.feature")
        .unwrap_or_else(|_| "feature/".to_string());

    let branch_name = format!("{}{}", prefix, name);

    // Create branch from develop
    let develop_branch = repo
        .find_branch(&develop, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(develop.clone()))?;

    let commit = develop_branch.get().peel_to_commit()?;
    let branch = repo.branch(&branch_name, &commit, false)?;
    let reference = branch.get();

    // Checkout the new branch
    let obj = reference.peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&obj, None)?;
    repo.set_head(reference.name().unwrap())?;

    Ok(Branch {
        name: branch_name.clone(),
        shorthand: branch_name,
        is_head: true,
        is_remote: false,
        upstream: None,
        target_oid: commit.id().to_string(),
        ahead_behind: None,
        last_commit_timestamp: Some(commit.time().seconds()),
        is_stale: false,
    })
}

/// Finish a git flow feature branch (merge into develop)
#[command]
pub async fn gitflow_finish_feature(
    path: String,
    name: String,
    delete_branch: Option<bool>,
    squash: Option<bool>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let config = repo.config()?;

    let develop = config
        .get_string("gitflow.branch.develop")
        .unwrap_or_else(|_| "develop".to_string());
    let prefix = config
        .get_string("gitflow.prefix.feature")
        .unwrap_or_else(|_| "feature/".to_string());

    let branch_name = format!("{}{}", prefix, name);

    // Get feature branch commit
    let feature_branch = repo
        .find_branch(&branch_name, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(branch_name.clone()))?;
    let feature_commit = feature_branch.get().peel_to_commit()?;

    // Checkout develop
    let develop_branch = repo
        .find_branch(&develop, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(develop.clone()))?;
    let develop_obj = develop_branch.get().peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&develop_obj, None)?;
    repo.set_head(develop_branch.get().name().unwrap())?;

    // Merge feature into develop
    let annotated_commit = repo.find_annotated_commit(feature_commit.id())?;

    if squash.unwrap_or(false) {
        // Squash merge
        repo.merge(&[&annotated_commit], None, None)?;
    } else {
        // Regular merge (no-ff)
        let (analysis, _) = repo.merge_analysis(&[&annotated_commit])?;
        if analysis.is_fast_forward() || analysis.is_normal() {
            repo.merge(&[&annotated_commit], None, None)?;

            if !repo.index()?.has_conflicts() {
                // Auto-commit merge
                let mut index = repo.index()?;
                let tree_oid = index.write_tree()?;
                let tree = repo.find_tree(tree_oid)?;
                let sig = repo.signature()?;
                let develop_commit = develop_branch.get().peel_to_commit()?;
                let parents = vec![&develop_commit, &feature_commit];
                let message = format!("Merge branch '{}' into {}", branch_name, develop);
                repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)?;
                repo.cleanup_state()?;
            }
        }
    }

    // Delete feature branch if requested
    if delete_branch.unwrap_or(true) {
        let mut branch = repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .map_err(|_| LeviathanError::BranchNotFound(branch_name.clone()))?;
        branch.delete()?;
    }

    Ok(())
}

/// Start a git flow release branch
#[command]
pub async fn gitflow_start_release(path: String, version: String) -> Result<Branch> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let config = repo.config()?;

    let develop = config
        .get_string("gitflow.branch.develop")
        .unwrap_or_else(|_| "develop".to_string());
    let prefix = config
        .get_string("gitflow.prefix.release")
        .unwrap_or_else(|_| "release/".to_string());

    let branch_name = format!("{}{}", prefix, version);

    let develop_branch = repo
        .find_branch(&develop, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(develop))?;

    let commit = develop_branch.get().peel_to_commit()?;
    let branch = repo.branch(&branch_name, &commit, false)?;
    let reference = branch.get();

    let obj = reference.peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&obj, None)?;
    repo.set_head(reference.name().unwrap())?;

    Ok(Branch {
        name: branch_name.clone(),
        shorthand: branch_name,
        is_head: true,
        is_remote: false,
        upstream: None,
        target_oid: commit.id().to_string(),
        ahead_behind: None,
        last_commit_timestamp: Some(commit.time().seconds()),
        is_stale: false,
    })
}

/// Finish a git flow release branch (merge into master and develop, tag)
#[command]
pub async fn gitflow_finish_release(
    path: String,
    version: String,
    tag_message: Option<String>,
    delete_branch: Option<bool>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let config = repo.config()?;

    let master = config
        .get_string("gitflow.branch.master")
        .unwrap_or_else(|_| "main".to_string());
    let develop = config
        .get_string("gitflow.branch.develop")
        .unwrap_or_else(|_| "develop".to_string());
    let prefix = config
        .get_string("gitflow.prefix.release")
        .unwrap_or_else(|_| "release/".to_string());
    let tag_prefix = config
        .get_string("gitflow.prefix.versiontag")
        .unwrap_or_else(|_| "v".to_string());

    let branch_name = format!("{}{}", prefix, version);
    let tag_name = format!("{}{}", tag_prefix, version);

    let release_branch = repo
        .find_branch(&branch_name, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(branch_name.clone()))?;
    let release_commit = release_branch.get().peel_to_commit()?;

    // Merge into master
    let master_branch = repo
        .find_branch(&master, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(master.clone()))?;
    let master_obj = master_branch.get().peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&master_obj, None)?;
    repo.set_head(master_branch.get().name().unwrap())?;

    let annotated = repo.find_annotated_commit(release_commit.id())?;
    repo.merge(&[&annotated], None, None)?;

    if !repo.index()?.has_conflicts() {
        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = repo.signature()?;
        let master_commit = master_branch.get().peel_to_commit()?;
        let parents = vec![&master_commit, &release_commit];
        let message = format!("Merge branch '{}' into {}", branch_name, master);
        let merge_oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)?;
        repo.cleanup_state()?;

        // Create tag on master
        let merge_commit = repo.find_commit(merge_oid)?;
        let tag_msg = tag_message.unwrap_or_else(|| format!("Release {}", version));
        repo.tag(&tag_name, merge_commit.as_object(), &sig, &tag_msg, false)?;
    }

    // Merge into develop
    let develop_branch = repo
        .find_branch(&develop, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(develop.clone()))?;
    let develop_obj = develop_branch.get().peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&develop_obj, None)?;
    repo.set_head(develop_branch.get().name().unwrap())?;

    // Re-read release commit from the new HEAD context
    let release_branch2 = repo
        .find_branch(&branch_name, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(branch_name.clone()))?;
    let release_commit2 = release_branch2.get().peel_to_commit()?;
    let annotated2 = repo.find_annotated_commit(release_commit2.id())?;
    repo.merge(&[&annotated2], None, None)?;

    if !repo.index()?.has_conflicts() {
        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = repo.signature()?;
        let develop_commit = develop_branch.get().peel_to_commit()?;
        let parents = vec![&develop_commit, &release_commit2];
        let message = format!("Merge branch '{}' into {}", branch_name, develop);
        repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)?;
        repo.cleanup_state()?;
    }

    // Delete release branch
    if delete_branch.unwrap_or(true) {
        let mut branch = repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .map_err(|_| LeviathanError::BranchNotFound(branch_name.clone()))?;
        branch.delete()?;
    }

    Ok(())
}

/// Start a git flow hotfix branch
#[command]
pub async fn gitflow_start_hotfix(path: String, version: String) -> Result<Branch> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let config = repo.config()?;

    let master = config
        .get_string("gitflow.branch.master")
        .unwrap_or_else(|_| "main".to_string());
    let prefix = config
        .get_string("gitflow.prefix.hotfix")
        .unwrap_or_else(|_| "hotfix/".to_string());

    let branch_name = format!("{}{}", prefix, version);

    let master_branch = repo
        .find_branch(&master, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(master))?;

    let commit = master_branch.get().peel_to_commit()?;
    let branch = repo.branch(&branch_name, &commit, false)?;
    let reference = branch.get();

    let obj = reference.peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&obj, None)?;
    repo.set_head(reference.name().unwrap())?;

    Ok(Branch {
        name: branch_name.clone(),
        shorthand: branch_name,
        is_head: true,
        is_remote: false,
        upstream: None,
        target_oid: commit.id().to_string(),
        ahead_behind: None,
        last_commit_timestamp: Some(commit.time().seconds()),
        is_stale: false,
    })
}

/// Finish a git flow hotfix branch (merge into master and develop, tag)
#[command]
pub async fn gitflow_finish_hotfix(
    path: String,
    version: String,
    tag_message: Option<String>,
    delete_branch: Option<bool>,
) -> Result<()> {
    // Hotfix finish is similar to release finish
    gitflow_finish_release(path, version, tag_message, delete_branch).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_gitflow_config_not_initialized() {
        let repo = TestRepo::with_initial_commit();
        let result = get_gitflow_config(repo.path_str()).await;
        assert!(result.is_ok());
        let config = result.unwrap();
        assert!(!config.initialized);
    }

    #[tokio::test]
    async fn test_init_gitflow() {
        let repo = TestRepo::with_initial_commit();
        let result = init_gitflow(repo.path_str(), None, None, None, None, None, None, None).await;
        assert!(result.is_ok());
        let config = result.unwrap();
        assert!(config.initialized);
        assert_eq!(config.develop_branch, "develop");

        // Verify develop branch was created
        let git_repo = repo.repo();
        let develop = git_repo.find_branch("develop", git2::BranchType::Local);
        assert!(develop.is_ok());
    }

    #[tokio::test]
    async fn test_init_gitflow_custom_branches() {
        let repo = TestRepo::with_initial_commit();
        let result = init_gitflow(
            repo.path_str(),
            Some("production".to_string()),
            Some("dev".to_string()),
            Some("feat/".to_string()),
            Some("rel/".to_string()),
            Some("fix/".to_string()),
            Some("sup/".to_string()),
            Some("ver".to_string()),
        )
        .await;
        assert!(result.is_ok());
        let config = result.unwrap();
        assert_eq!(config.master_branch, "production");
        assert_eq!(config.develop_branch, "dev");
        assert_eq!(config.feature_prefix, "feat/");
    }

    #[tokio::test]
    async fn test_get_gitflow_config_after_init() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        let config = get_gitflow_config(repo.path_str()).await.unwrap();
        assert!(config.initialized);
        assert_eq!(config.feature_prefix, "feature/");
    }

    #[tokio::test]
    async fn test_start_feature() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        let result = gitflow_start_feature(repo.path_str(), "my-feature".to_string()).await;
        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "feature/my-feature");
        assert!(branch.is_head);
    }

    #[tokio::test]
    async fn test_finish_feature() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        // Start feature
        gitflow_start_feature(repo.path_str(), "test-feature".to_string())
            .await
            .unwrap();

        // Add a commit on the feature branch
        repo.create_commit("Feature work", &[("feature.txt", "feature content")]);

        // Finish feature
        let result = gitflow_finish_feature(
            repo.path_str(),
            "test-feature".to_string(),
            Some(true),
            None,
        )
        .await;
        assert!(result.is_ok());

        // Verify we're back on develop
        assert_eq!(repo.current_branch(), "develop");

        // Verify feature branch was deleted
        let git_repo = repo.repo();
        let feature = git_repo.find_branch("feature/test-feature", git2::BranchType::Local);
        assert!(feature.is_err());
    }

    #[tokio::test]
    async fn test_start_release() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        let result = gitflow_start_release(repo.path_str(), "1.0.0".to_string()).await;
        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "release/1.0.0");
        assert!(branch.is_head);
    }

    #[tokio::test]
    async fn test_start_hotfix() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        let result = gitflow_start_hotfix(repo.path_str(), "1.0.1".to_string()).await;
        assert!(result.is_ok());
        let branch = result.unwrap();
        assert_eq!(branch.name, "hotfix/1.0.1");
        assert!(branch.is_head);
    }

    #[tokio::test]
    async fn test_start_feature_without_init_fails() {
        let repo = TestRepo::with_initial_commit();
        // Don't init gitflow - develop branch doesn't exist
        let result = gitflow_start_feature(repo.path_str(), "my-feature".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_finish_feature_with_squash() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        gitflow_start_feature(repo.path_str(), "squash-feature".to_string())
            .await
            .unwrap();

        repo.create_commit("Commit 1", &[("file1.txt", "content1")]);
        repo.create_commit("Commit 2", &[("file2.txt", "content2")]);

        let result = gitflow_finish_feature(
            repo.path_str(),
            "squash-feature".to_string(),
            Some(true),
            Some(true),
        )
        .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_finish_feature_keep_branch() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        gitflow_start_feature(repo.path_str(), "keep-feature".to_string())
            .await
            .unwrap();
        repo.create_commit("Feature work", &[("feature.txt", "content")]);

        let result = gitflow_finish_feature(
            repo.path_str(),
            "keep-feature".to_string(),
            Some(false), // Don't delete branch
            None,
        )
        .await;
        assert!(result.is_ok());

        // Branch should still exist
        let git_repo = repo.repo();
        let feature = git_repo.find_branch("feature/keep-feature", git2::BranchType::Local);
        assert!(feature.is_ok());
    }
}
