//! Tag command handlers

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{Signature, Tag};
use crate::services::credentials_service;

/// Get all tags
#[command]
pub async fn get_tags(path: String) -> Result<Vec<Tag>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut tags = Vec::new();

    repo.tag_foreach(|oid, name| {
        let name_str = String::from_utf8_lossy(name).to_string();
        // Remove refs/tags/ prefix
        let short_name = name_str
            .strip_prefix("refs/tags/")
            .unwrap_or(&name_str)
            .to_string();

        // Try to get tag details if it's an annotated tag
        let (message, tagger, is_annotated, target_oid) = if let Ok(tag) = repo.find_tag(oid) {
            let tagger = tag.tagger().map(|sig| Signature {
                name: sig.name().unwrap_or("").to_string(),
                email: sig.email().unwrap_or("").to_string(),
                timestamp: sig.when().seconds(),
            });
            (
                tag.message().map(|s| s.to_string()),
                tagger,
                true,
                tag.target_id().to_string(),
            )
        } else {
            (None, None, false, oid.to_string())
        };

        tags.push(Tag {
            name: short_name,
            target_oid,
            message,
            tagger,
            is_annotated,
        });
        true
    })?;

    // Sort tags by name
    tags.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(tags)
}

/// Create a new tag
#[command]
pub async fn create_tag(
    path: String,
    name: String,
    target: Option<String>,
    message: Option<String>,
) -> Result<Tag> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Get target commit
    let target_oid = if let Some(ref target_ref) = target {
        repo.revparse_single(target_ref)?.id()
    } else {
        repo.head()?.peel_to_commit()?.id()
    };

    let target_obj = repo.find_object(target_oid, None)?;

    let (is_annotated, tagger) = if let Some(ref msg) = message {
        // Create annotated tag
        let signature = repo.signature()?;
        repo.tag(&name, &target_obj, &signature, msg, false)?;
        (
            true,
            Some(Signature {
                name: signature.name().unwrap_or("").to_string(),
                email: signature.email().unwrap_or("").to_string(),
                timestamp: signature.when().seconds(),
            }),
        )
    } else {
        // Create lightweight tag
        repo.tag_lightweight(&name, &target_obj, false)?;
        (false, None)
    };

    Ok(Tag {
        name: name.clone(),
        target_oid: target_oid.to_string(),
        message,
        tagger,
        is_annotated,
    })
}

/// Delete a tag
#[command]
pub async fn delete_tag(path: String, name: String) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    repo.tag_delete(&name)?;
    Ok(())
}

/// Push a tag to a remote
#[command]
pub async fn push_tag(
    path: String,
    name: String,
    remote: Option<String>,
    force: Option<bool>,
    token: Option<String>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let remote_name = remote.as_deref().unwrap_or("origin");
    let mut remote_obj = repo
        .find_remote(remote_name)
        .map_err(|_| LeviathanError::RemoteNotFound(remote_name.to_string()))?;

    let mut push_opts = credentials_service::get_push_options(token);

    let refspec = if force.unwrap_or(false) {
        format!("+refs/tags/{}:refs/tags/{}", name, name)
    } else {
        format!("refs/tags/{}:refs/tags/{}", name, name)
    };

    remote_obj.push(&[&refspec], Some(&mut push_opts))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_tags_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_tags(repo.path_str()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_create_lightweight_tag() {
        let repo = TestRepo::with_initial_commit();
        let result = create_tag(repo.path_str(), "v1.0.0".to_string(), None, None).await;

        assert!(result.is_ok());
        let tag = result.unwrap();
        assert_eq!(tag.name, "v1.0.0");
        assert!(!tag.is_annotated);
        assert!(tag.message.is_none());
        assert!(tag.tagger.is_none());
    }

    #[tokio::test]
    async fn test_create_annotated_tag() {
        let repo = TestRepo::with_initial_commit();
        let result = create_tag(
            repo.path_str(),
            "v1.0.0".to_string(),
            None,
            Some("Release version 1.0.0".to_string()),
        )
        .await;

        assert!(result.is_ok());
        let tag = result.unwrap();
        assert_eq!(tag.name, "v1.0.0");
        assert!(tag.is_annotated);
        assert_eq!(tag.message, Some("Release version 1.0.0".to_string()));
        assert!(tag.tagger.is_some());
    }

    #[tokio::test]
    async fn test_create_tag_at_specific_commit() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();
        repo.create_commit("Second commit", &[("file.txt", "content")]);

        let result = create_tag(
            repo.path_str(),
            "v0.1.0".to_string(),
            Some(first_oid.to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
        let tag = result.unwrap();
        assert_eq!(tag.target_oid, first_oid.to_string());
    }

    #[tokio::test]
    async fn test_get_tags_returns_created_tags() {
        let repo = TestRepo::with_initial_commit();
        create_tag(repo.path_str(), "v1.0.0".to_string(), None, None)
            .await
            .unwrap();
        create_tag(
            repo.path_str(),
            "v2.0.0".to_string(),
            None,
            Some("Version 2".to_string()),
        )
        .await
        .unwrap();

        let result = get_tags(repo.path_str()).await;
        assert!(result.is_ok());
        let tags = result.unwrap();
        assert_eq!(tags.len(), 2);

        // Tags are sorted by name
        assert_eq!(tags[0].name, "v1.0.0");
        assert_eq!(tags[1].name, "v2.0.0");
    }

    #[tokio::test]
    async fn test_delete_tag() {
        let repo = TestRepo::with_initial_commit();
        create_tag(repo.path_str(), "to-delete".to_string(), None, None)
            .await
            .unwrap();

        let result = delete_tag(repo.path_str(), "to-delete".to_string()).await;
        assert!(result.is_ok());

        // Verify tag is gone
        let tags = get_tags(repo.path_str()).await.unwrap();
        assert!(tags.is_empty());
    }

    #[tokio::test]
    async fn test_delete_tag_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = delete_tag(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_duplicate_tag_fails() {
        let repo = TestRepo::with_initial_commit();
        create_tag(repo.path_str(), "v1.0.0".to_string(), None, None)
            .await
            .unwrap();

        let result = create_tag(repo.path_str(), "v1.0.0".to_string(), None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_tag_tagger_info() {
        let repo = TestRepo::with_initial_commit();
        let result = create_tag(
            repo.path_str(),
            "v1.0.0".to_string(),
            None,
            Some("Test tag".to_string()),
        )
        .await;

        assert!(result.is_ok());
        let tag = result.unwrap();
        let tagger = tag.tagger.unwrap();
        assert_eq!(tagger.name, "Test User");
        assert_eq!(tagger.email, "test@example.com");
    }
}
