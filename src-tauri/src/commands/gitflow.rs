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
    // Every gitflow start/finish switches branches (checkout_tree + set_head)
    // without being called checkout, so the hand-placed ensure_checkoutable
    // calls in branch.rs missed all six. Switching out of a paused rebase or
    // an unresolved merge orphans the state on disk: the still-visible Abort
    // then yanks the user back to the original branch, discarding whatever
    // they did on the new one.
    crate::commands::branch::ensure_checkoutable(&repo)?;
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
    repo.set_head(reference.name().map_err(|_| {
        LeviathanError::OperationFailed("Invalid UTF-8 in branch reference name".to_string())
    })?)?;

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

/// Outcome of a git-flow finish.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFlowFinishResult {
    /// True when the source branch was deleted as part of the finish.
    pub branch_deleted: bool,
    /// Set when deletion was requested but skipped, explaining why.
    pub branch_kept_reason: Option<String>,
}

/// Delete the finished branch unless a protection rule forbids it.
///
/// Branch rules are enforced here as well as in `delete_branch` because these
/// finishes delete the branch themselves rather than going through that
/// command — without this, a `preventDeletion` rule the UI displays as active
/// is inert on every git-flow finish.
///
/// NO failure here may fail the whole finish. The merge and (for release and
/// hotfix) the tag have already been committed by the time this runs, so
/// deletion is the optional last step — returning `Err` would report a finish
/// that actually succeeded as failed, leave the item listed as active, and
/// invite a retry. A squash retry is NOT idempotent (a squash commit never
/// makes the feature an ancestor of develop), so each retry mints another
/// duplicate commit. Every path therefore degrades to `branch_kept_reason`.
fn delete_finished_branch(
    repo: &git2::Repository,
    repo_path: &str,
    branch_name: &str,
) -> GitFlowFinishResult {
    let kept = |reason: String| GitFlowFinishResult {
        branch_deleted: false,
        branch_kept_reason: Some(reason),
    };

    // Branch rules are enforced here as well as in `delete_branch` because
    // these finishes delete the branch themselves rather than going through
    // that command — without this, a `preventDeletion` rule the UI displays as
    // active is inert on every git-flow finish.
    let rules = match super::branch_rules::load_rules(Path::new(repo_path)) {
        Ok(rules) => rules,
        // Unreadable rules mean we cannot prove the branch is unprotected.
        // Keep it: the merge is already safe, and deleting past an unverifiable
        // protection is the one irreversible mistake available here.
        Err(e) => {
            return kept(format!(
                "The merge completed, but \"{}\" was kept — its branch rules could not be read: {}",
                branch_name, e
            ))
        }
    };

    if super::branch_rules::is_deletion_prevented(&rules, branch_name) {
        return kept(format!(
            "\"{}\" is protected by a branch rule and was kept. The merge completed.",
            branch_name
        ));
    }

    let mut branch = match repo.find_branch(branch_name, git2::BranchType::Local) {
        Ok(branch) => branch,
        Err(e) => {
            return kept(format!(
                "The merge completed, but \"{}\" could not be opened for deletion: {}",
                branch_name, e
            ))
        }
    };

    if let Err(e) = branch.delete() {
        // e.g. the branch is checked out in a linked worktree.
        return kept(format!(
            "The merge completed, but \"{}\" could not be deleted: {}",
            branch_name, e
        ));
    }

    GitFlowFinishResult {
        branch_deleted: true,
        branch_kept_reason: None,
    }
}

/// Finish a git flow feature branch (merge into develop)
#[command]
pub async fn gitflow_finish_feature(
    path: String,
    name: String,
    delete_branch: Option<bool>,
    squash: Option<bool>,
) -> Result<GitFlowFinishResult> {
    let repo = git2::Repository::open(Path::new(&path))?;
    // Every gitflow start/finish switches branches (checkout_tree + set_head)
    // without being called checkout, so the hand-placed ensure_checkoutable
    // calls in branch.rs missed all six. Switching out of a paused rebase or
    // an unresolved merge orphans the state on disk: the still-visible Abort
    // then yanks the user back to the original branch, discarding whatever
    // they did on the new one.
    crate::commands::branch::ensure_checkoutable(&repo)?;
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
    repo.set_head(develop_branch.get().name().map_err(|_| {
        LeviathanError::OperationFailed("Invalid UTF-8 in branch reference name".to_string())
    })?)?;

    // Merge feature into develop
    let annotated_commit = repo.find_annotated_commit(feature_commit.id())?;

    if squash.unwrap_or(false) {
        // Squash merge: the changes must actually be committed (single
        // parent, no merge commit). Conflicts abort BEFORE any branch
        // deletion so the user can resolve them.
        //
        // Idempotency guard: if develop already contains the feature, skip the
        // merge+commit so a re-run (e.g. after the squash was completed externally
        // via the conflict-resolution flow) doesn't re-merge the same divergence
        // and mint a duplicate commit. It then falls through to branch deletion.
        let (analysis, _) = repo.merge_analysis(&[&annotated_commit])?;
        if !analysis.is_up_to_date() {
            repo.merge(&[&annotated_commit], None, None)?;
            if repo.index()?.has_conflicts() {
                return Err(LeviathanError::MergeConflict);
            }
            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;
            let sig = repo.signature()?;
            let develop_commit = develop_branch.get().peel_to_commit()?;
            let message = format!("Squashed branch '{}' into {}", branch_name, develop);
            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                &message,
                &tree,
                &[&develop_commit],
            )?;
            repo.cleanup_state()?;
        }
    } else {
        // Regular merge (no-ff)
        let (analysis, _) = repo.merge_analysis(&[&annotated_commit])?;
        if analysis.is_fast_forward() || analysis.is_normal() {
            repo.merge(&[&annotated_commit], None, None)?;

            // Conflicts must abort the finish (leaving MERGE_HEAD for the
            // conflict-resolution flow) instead of silently skipping the
            // commit and deleting the branch below.
            if repo.index()?.has_conflicts() {
                return Err(LeviathanError::MergeConflict);
            }

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

    // Delete feature branch if requested
    if delete_branch.unwrap_or(true) {
        return Ok(delete_finished_branch(&repo, &path, &branch_name));
    }

    Ok(GitFlowFinishResult {
        branch_deleted: false,
        branch_kept_reason: None,
    })
}

/// Start a git flow release branch
#[command]
pub async fn gitflow_start_release(path: String, version: String) -> Result<Branch> {
    let repo = git2::Repository::open(Path::new(&path))?;
    // Every gitflow start/finish switches branches (checkout_tree + set_head)
    // without being called checkout, so the hand-placed ensure_checkoutable
    // calls in branch.rs missed all six. Switching out of a paused rebase or
    // an unresolved merge orphans the state on disk: the still-visible Abort
    // then yanks the user back to the original branch, discarding whatever
    // they did on the new one.
    crate::commands::branch::ensure_checkoutable(&repo)?;
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
    repo.set_head(reference.name().map_err(|_| {
        LeviathanError::OperationFailed("Invalid UTF-8 in branch reference name".to_string())
    })?)?;

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
) -> Result<GitFlowFinishResult> {
    finish_release_like(
        path,
        version,
        tag_message,
        delete_branch,
        "gitflow.prefix.release",
        "release/",
    )
    .await
}

/// Shared implementation for release/hotfix finish: merge into master (with
/// tag), merge into develop, delete the branch. The two flows differ only in
/// which branch prefix they use.
async fn finish_release_like(
    path: String,
    version: String,
    tag_message: Option<String>,
    delete_branch: Option<bool>,
    prefix_key: &str,
    prefix_default: &str,
) -> Result<GitFlowFinishResult> {
    let repo = git2::Repository::open(Path::new(&path))?;
    // Backs both gitflow_finish_release and gitflow_finish_hotfix, and switches
    // branches twice — see the comment on the start commands above.
    crate::commands::branch::ensure_checkoutable(&repo)?;
    let config = repo.config()?;

    let master = config
        .get_string("gitflow.branch.master")
        .unwrap_or_else(|_| "main".to_string());
    let develop = config
        .get_string("gitflow.branch.develop")
        .unwrap_or_else(|_| "develop".to_string());
    let prefix = config
        .get_string(prefix_key)
        .unwrap_or_else(|_| prefix_default.to_string());
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
    repo.set_head(master_branch.get().name().map_err(|_| {
        LeviathanError::OperationFailed("Invalid UTF-8 in branch reference name".to_string())
    })?)?;

    let annotated = repo.find_annotated_commit(release_commit.id())?;
    let (master_analysis, _) = repo.merge_analysis(&[&annotated])?;

    // Idempotency: on a re-run after resolving a develop-side conflict, master
    // already contains the release, so the analysis is up-to-date. Skip the
    // merge+commit entirely — re-merging would create a junk merge commit and
    // the subsequent re-tag would fail with "tag already exists", stranding the
    // branch. We still need a tag target for the (already-existing) tag below.
    let master_merge_oid = if master_analysis.is_up_to_date() {
        None
    } else {
        repo.merge(&[&annotated], None, None)?;

        // Conflicts must abort the finish here — proceeding would tag nothing,
        // check out develop over a conflicted tree, and delete the branch.
        if repo.index()?.has_conflicts() {
            return Err(LeviathanError::MergeConflict);
        }

        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = repo.signature()?;
        let master_commit = master_branch.get().peel_to_commit()?;
        let parents = vec![&master_commit, &release_commit];
        let message = format!("Merge branch '{}' into {}", branch_name, master);
        let merge_oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)?;
        repo.cleanup_state()?;
        Some(merge_oid)
    };

    // Create the tag on master. Skip when it already exists (re-run after the
    // develop-side conflict was resolved and tagged on the first pass) so we
    // don't fail with "tag already exists". When it is MISSING we must still
    // tag: on a re-run after a MASTER-side conflict was resolved via the dialog,
    // master is already up-to-date so master_merge_oid is None — tag the current
    // master tip (HEAD is on master here) so the release/hotfix isn't silently
    // completed with no version tag.
    if repo
        .find_reference(&format!("refs/tags/{}", tag_name))
        .is_err()
    {
        let sig = repo.signature()?;
        let target_commit = match master_merge_oid {
            Some(merge_oid) => repo.find_commit(merge_oid)?,
            None => repo.head()?.peel_to_commit()?,
        };
        let tag_msg = tag_message.unwrap_or_else(|| format!("Release {}", version));
        repo.tag(&tag_name, target_commit.as_object(), &sig, &tag_msg, false)?;
    }

    // Merge into develop
    let develop_branch = repo
        .find_branch(&develop, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(develop.clone()))?;
    let develop_obj = develop_branch.get().peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&develop_obj, None)?;
    repo.set_head(develop_branch.get().name().map_err(|_| {
        LeviathanError::OperationFailed("Invalid UTF-8 in branch reference name".to_string())
    })?)?;

    // Re-read release commit from the new HEAD context
    let release_branch2 = repo
        .find_branch(&branch_name, git2::BranchType::Local)
        .map_err(|_| LeviathanError::BranchNotFound(branch_name.clone()))?;
    let release_commit2 = release_branch2.get().peel_to_commit()?;
    let annotated2 = repo.find_annotated_commit(release_commit2.id())?;
    let (develop_analysis, _) = repo.merge_analysis(&[&annotated2])?;

    // Idempotency: on a re-run after the develop conflict was resolved via
    // commit_merge, develop already contains the release, so skip the merge to
    // avoid a duplicate merge commit and let branch deletion proceed.
    if !develop_analysis.is_up_to_date() {
        repo.merge(&[&annotated2], None, None)?;

        // Same as the master merge: a conflicted develop merge must be surfaced
        // (and the branch NOT deleted) so the user can resolve it.
        if repo.index()?.has_conflicts() {
            return Err(LeviathanError::MergeConflict);
        }

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
        return Ok(delete_finished_branch(&repo, &path, &branch_name));
    }

    Ok(GitFlowFinishResult {
        branch_deleted: false,
        branch_kept_reason: None,
    })
}

/// Start a git flow hotfix branch
#[command]
pub async fn gitflow_start_hotfix(path: String, version: String) -> Result<Branch> {
    let repo = git2::Repository::open(Path::new(&path))?;
    // Every gitflow start/finish switches branches (checkout_tree + set_head)
    // without being called checkout, so the hand-placed ensure_checkoutable
    // calls in branch.rs missed all six. Switching out of a paused rebase or
    // an unresolved merge orphans the state on disk: the still-visible Abort
    // then yanks the user back to the original branch, discarding whatever
    // they did on the new one.
    crate::commands::branch::ensure_checkoutable(&repo)?;
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
    repo.set_head(reference.name().map_err(|_| {
        LeviathanError::OperationFailed("Invalid UTF-8 in branch reference name".to_string())
    })?)?;

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
) -> Result<GitFlowFinishResult> {
    // Same flow as release finish, but the branch lives under the hotfix
    // prefix — delegating with the release prefix made every hotfix finish
    // fail with BranchNotFound.
    finish_release_like(
        path,
        version,
        tag_message,
        delete_branch,
        "gitflow.prefix.hotfix",
        "hotfix/",
    )
    .await
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

    /// Every gitflow start/finish switches branches without being called
    /// checkout, so the hand-placed ensure_checkoutable calls in branch.rs
    /// missed all of them. Switching out of a paused rebase orphans the state
    /// on disk; the still-visible Abort then discards the new branch's work.
    #[tokio::test]
    async fn test_gitflow_start_refuses_mid_rebase() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        // Pause an interactive rebase the way an `edit` line does.
        let head = repo.repo().head().unwrap().peel_to_commit().unwrap().id();
        std::fs::create_dir_all(repo.path.join(".git/rebase-merge")).unwrap();
        std::fs::write(repo.path.join(".git/rebase-merge/interactive"), "").unwrap();
        std::fs::write(
            repo.path.join(".git/rebase-merge/head-name"),
            "refs/heads/main\n",
        )
        .unwrap();
        std::fs::write(
            repo.path.join(".git/rebase-merge/onto"),
            format!("{}\n", head),
        )
        .unwrap();
        assert_ne!(repo.repo().state(), git2::RepositoryState::Clean);

        for err in [
            gitflow_start_feature(repo.path_str(), "escape".to_string())
                .await
                .expect_err("start feature must refuse mid-rebase"),
            gitflow_start_release(repo.path_str(), "9.9.9".to_string())
                .await
                .expect_err("start release must refuse mid-rebase"),
            gitflow_start_hotfix(repo.path_str(), "9.9.9".to_string())
                .await
                .expect_err("start hotfix must refuse mid-rebase"),
        ] {
            assert!(
                err.to_string().contains("rebase is in progress"),
                "unexpected error: {}",
                err
            );
        }
    }

    /// A preventDeletion rule must survive a git-flow finish. These finishes
    /// delete the branch themselves rather than going through delete_branch, so
    /// without an explicit check the rule is inert on this surface.
    #[tokio::test]
    async fn test_gitflow_finish_feature_respects_branch_rule() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();
        gitflow_start_feature(repo.path_str(), "protected-work".to_string())
            .await
            .unwrap();

        crate::commands::branch_rules::set_branch_rule(
            repo.path_str(),
            crate::commands::branch_rules::BranchRule {
                pattern: "feature/*".to_string(),
                prevent_deletion: true,
                prevent_force_push: false,
                require_pull_request: false,
                prevent_direct_push: false,
            },
        )
        .await
        .unwrap();

        let result = gitflow_finish_feature(
            repo.path_str(),
            "protected-work".to_string(),
            Some(true),
            None,
        )
        .await;

        // The merge must still succeed — only the optional delete is skipped.
        assert!(result.is_ok(), "finish should complete despite the rule");
        let outcome = result.unwrap();
        assert!(!outcome.branch_deleted, "protected branch must be kept");
        assert!(
            outcome.branch_kept_reason.is_some(),
            "the caller must be told why the branch survived"
        );

        let git_repo = repo.repo();
        assert!(git_repo
            .find_branch("feature/protected-work", git2::BranchType::Local)
            .is_ok());
    }

    /// A delete failure must never fail the whole finish: the merge is already
    /// committed, and a squash retry is not idempotent — it would mint a second
    /// squash commit every time the user retried.
    #[tokio::test]
    async fn test_gitflow_finish_feature_survives_unreadable_branch_rules() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();
        gitflow_start_feature(repo.path_str(), "work".to_string())
            .await
            .unwrap();

        // save_rules is a non-atomic write, so a crash mid-save can leave this
        // truncated.
        let git_repo = repo.repo();
        let rules_dir = git_repo.path().join("leviathan");
        std::fs::create_dir_all(&rules_dir).unwrap();
        std::fs::write(rules_dir.join("branch_rules.json"), "{ not json").unwrap();

        let result =
            gitflow_finish_feature(repo.path_str(), "work".to_string(), Some(true), None).await;

        assert!(
            result.is_ok(),
            "an unreadable rules file must not fail a finish whose merge already landed"
        );
        let outcome = result.unwrap();
        assert!(!outcome.branch_deleted);
        assert!(
            outcome.branch_kept_reason.is_some(),
            "the caller must be told the branch survived and why"
        );
    }

    #[tokio::test]
    async fn test_gitflow_finish_feature_deletes_unprotected_branch() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();
        gitflow_start_feature(repo.path_str(), "ordinary".to_string())
            .await
            .unwrap();

        let outcome =
            gitflow_finish_feature(repo.path_str(), "ordinary".to_string(), Some(true), None)
                .await
                .unwrap();

        assert!(outcome.branch_deleted);
        assert!(outcome.branch_kept_reason.is_none());
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

    #[tokio::test]
    async fn test_finish_feature_with_conflict_errors_and_keeps_branch() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        gitflow_start_feature(repo.path_str(), "conflicting".to_string())
            .await
            .unwrap();
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);

        // Conflicting change on develop
        repo.checkout_branch("develop");
        repo.create_commit("Develop change", &[("shared.txt", "develop content")]);

        let result =
            gitflow_finish_feature(repo.path_str(), "conflicting".to_string(), Some(true), None)
                .await;

        // Must surface the conflict, NOT report success
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        // Branch must NOT have been deleted, and the merge state must be
        // intact for the conflict-resolution flow
        let git_repo = repo.repo();
        assert!(git_repo
            .find_branch("feature/conflicting", git2::BranchType::Local)
            .is_ok());
        assert_eq!(git_repo.state(), git2::RepositoryState::Merge);
    }

    #[tokio::test]
    async fn test_finish_feature_squash_creates_commit() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        gitflow_start_feature(repo.path_str(), "squashed".to_string())
            .await
            .unwrap();
        repo.create_commit("Feature work", &[("squash.txt", "squash content")]);

        let result = gitflow_finish_feature(
            repo.path_str(),
            "squashed".to_string(),
            Some(true),
            Some(true), // squash
        )
        .await;
        assert!(result.is_ok(), "squash finish failed: {:?}", result.err());

        // The squashed changes must actually be committed on develop as a
        // single-parent commit, with no merge state left behind
        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        assert_eq!(repo.current_branch(), "develop");
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 1);
        assert!(repo.path.join("squash.txt").exists());
    }

    #[tokio::test]
    async fn test_finish_feature_squash_up_to_date_skips_merge() {
        // The squash block now guards on merge_analysis: when develop already
        // contains the feature (here the feature has no commits beyond develop, so
        // the merge is up-to-date), the squash finish must SKIP the merge+commit —
        // minting no duplicate commit — and still delete the branch. This prevents
        // a re-run (after the squash was completed externally) from re-merging.
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        gitflow_start_feature(repo.path_str(), "noop".to_string())
            .await
            .unwrap();
        // No commits on the feature — it points at develop's tip (up-to-date).

        let develop_tip_before = repo.repo().refname_to_id("refs/heads/develop").unwrap();

        let result = gitflow_finish_feature(
            repo.path_str(),
            "noop".to_string(),
            Some(true),
            Some(true), // squash
        )
        .await;
        assert!(result.is_ok(), "squash finish failed: {:?}", result.err());

        let git_repo = repo.repo();
        // Develop tip unchanged — no junk squash commit was created.
        let develop_tip_after = git_repo.refname_to_id("refs/heads/develop").unwrap();
        assert_eq!(
            develop_tip_before, develop_tip_after,
            "up-to-date squash finish must not mint a commit"
        );
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        // Branch still deleted.
        assert!(git_repo
            .find_branch("feature/noop", git2::BranchType::Local)
            .is_err());
    }

    #[tokio::test]
    async fn test_finish_hotfix_uses_hotfix_prefix() {
        let repo = TestRepo::with_initial_commit();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        gitflow_start_hotfix(repo.path_str(), "1.0.1".to_string())
            .await
            .unwrap();
        repo.create_commit("Hotfix work", &[("hotfix.txt", "fix")]);

        // Before the fix this failed with BranchNotFound("release/1.0.1")
        let result =
            gitflow_finish_hotfix(repo.path_str(), "1.0.1".to_string(), None, Some(true)).await;
        assert!(result.is_ok(), "hotfix finish failed: {:?}", result.err());

        let git_repo = repo.repo();
        assert!(git_repo.find_reference("refs/tags/v1.0.1").is_ok());
        assert!(git_repo
            .find_branch("hotfix/1.0.1", git2::BranchType::Local)
            .is_err());
    }

    #[tokio::test]
    async fn test_finish_release_with_conflict_keeps_branch() {
        let repo = TestRepo::with_initial_commit();
        let master = repo.current_branch();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        gitflow_start_release(repo.path_str(), "2.0.0".to_string())
            .await
            .unwrap();
        repo.create_commit("Release change", &[("shared.txt", "release content")]);

        // Conflicting change on master
        repo.checkout_branch(&master);
        repo.create_commit("Master change", &[("shared.txt", "master content")]);

        let result =
            gitflow_finish_release(repo.path_str(), "2.0.0".to_string(), None, Some(true)).await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        // Branch kept, no tag created, merge state intact for resolution
        let git_repo = repo.repo();
        assert!(git_repo
            .find_branch("release/2.0.0", git2::BranchType::Local)
            .is_ok());
        assert!(git_repo.find_reference("refs/tags/v2.0.0").is_err());
        assert_eq!(git_repo.state(), git2::RepositoryState::Merge);
    }

    fn count_reachable_commits(repo: &TestRepo, branch: &str) -> usize {
        let git_repo = repo.repo();
        let reference = git_repo
            .find_branch(branch, git2::BranchType::Local)
            .expect("branch should exist");
        let oid = reference.get().target().expect("branch should have a tip");
        let mut revwalk = git_repo.revwalk().unwrap();
        revwalk.push(oid).unwrap();
        revwalk.count()
    }

    #[tokio::test]
    async fn test_finish_release_tags_after_master_conflict_resolved() {
        // A MASTER-side conflict is resolved via the dialog (resolve_conflict +
        // commit_merge). On re-run, master is up-to-date (master_merge_oid=None)
        // but the tag was never created on the first pass — finish must still
        // create it, pointing at the master tip, exactly once. Before the fix
        // the tag block was gated on Some(merge_oid) and silently skipped.
        let repo = TestRepo::with_initial_commit();
        let master = repo.current_branch();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        gitflow_start_release(repo.path_str(), "2.0.0".to_string())
            .await
            .unwrap();
        repo.create_commit("Release change", &[("shared.txt", "release content")]);

        // Conflicting change on master.
        repo.checkout_branch(&master);
        repo.create_commit("Master change", &[("shared.txt", "master content")]);

        // First finish: master merge conflicts, no tag yet.
        let result =
            gitflow_finish_release(repo.path_str(), "2.0.0".to_string(), None, Some(true)).await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));
        assert!(repo.repo().find_reference("refs/tags/v2.0.0").is_err());

        // Resolve the master conflict and complete the merge (HEAD is on master).
        crate::commands::merge::resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();
        crate::commands::merge::commit_merge(repo.path_str(), None, None)
            .await
            .unwrap();

        let master_tip = repo
            .repo()
            .refname_to_id(&format!("refs/heads/{}", master))
            .unwrap();

        // Re-run finish: must succeed AND create the tag on the master tip.
        let result =
            gitflow_finish_release(repo.path_str(), "2.0.0".to_string(), None, Some(true)).await;
        assert!(result.is_ok(), "re-run finish failed: {:?}", result.err());

        let git_repo = repo.repo();
        let tag_ref = git_repo.find_reference("refs/tags/v2.0.0");
        assert!(
            tag_ref.is_ok(),
            "version tag must be created after resolving the master conflict"
        );
        let tag_commit = tag_ref.unwrap().peel_to_commit().unwrap();
        assert_eq!(
            tag_commit.id(),
            master_tip,
            "tag must point at the master tip"
        );

        // Branch deleted.
        assert!(git_repo
            .find_branch("release/2.0.0", git2::BranchType::Local)
            .is_err());
    }

    #[tokio::test]
    async fn test_finish_release_idempotent_after_develop_conflict() {
        // The master merge succeeds and the tag is created, but the develop
        // merge conflicts. After resolving that conflict and completing the
        // develop merge, re-running finish must be a clean no-op on master (no
        // duplicate merge commit, no duplicate/failed tag) and must still
        // delete the branch.
        let repo = TestRepo::with_initial_commit();
        let master = repo.current_branch();
        init_gitflow(repo.path_str(), None, None, None, None, None, None, None)
            .await
            .unwrap();

        // Give develop a base version of shared.txt, branch the release off it,
        // change it on the release, then make a DIVERGENT change on develop so
        // the develop-side merge conflicts (master has no shared.txt so its
        // merge stays clean).
        repo.checkout_branch("develop");
        repo.create_commit("Develop base", &[("shared.txt", "develop base")]);
        gitflow_start_release(repo.path_str(), "3.0.0".to_string())
            .await
            .unwrap();
        repo.create_commit("Release change", &[("shared.txt", "release content")]);
        repo.checkout_branch("develop");
        repo.create_commit("Develop divergent", &[("shared.txt", "develop divergent")]);

        // First finish: master merges + tags cleanly, develop merge conflicts.
        let result =
            gitflow_finish_release(repo.path_str(), "3.0.0".to_string(), None, Some(true)).await;
        assert!(matches!(result, Err(LeviathanError::MergeConflict)));

        {
            let git_repo = repo.repo();
            assert_eq!(git_repo.state(), git2::RepositoryState::Merge);
            assert!(
                git_repo.find_reference("refs/tags/v3.0.0").is_ok(),
                "tag should have been created during the clean master merge"
            );
        }

        let master_commits_before = count_reachable_commits(&repo, &master);

        // Resolve the develop conflict and complete the merge.
        crate::commands::merge::resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();
        crate::commands::merge::commit_merge(repo.path_str(), None, None)
            .await
            .unwrap();

        // Re-run finish: must succeed and be idempotent.
        let result =
            gitflow_finish_release(repo.path_str(), "3.0.0".to_string(), None, Some(true)).await;
        assert!(result.is_ok(), "re-run finish failed: {:?}", result.err());

        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);

        // No duplicate merge commit added to master.
        let master_commits_after = count_reachable_commits(&repo, &master);
        assert_eq!(
            master_commits_before, master_commits_after,
            "re-run must not add a junk master merge commit"
        );

        // Tag still exists (exactly once — creating it twice would have errored).
        assert!(git_repo.find_reference("refs/tags/v3.0.0").is_ok());

        // Branch was deleted.
        assert!(git_repo
            .find_branch("release/3.0.0", git2::BranchType::Local)
            .is_err());
    }
}
