//! Tag command handlers

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{Signature, Tag};
use crate::services::credentials_service;

/// Detailed tag information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDetails {
    pub name: String,
    pub oid: String,
    pub target_oid: String,
    pub is_annotated: bool,
    pub message: Option<String>,
    pub tagger_name: Option<String>,
    pub tagger_email: Option<String>,
    pub tagger_date: Option<i64>,
    pub is_signed: bool,
}

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

/// Get detailed information about a specific tag
#[command]
pub async fn get_tag_details(path: String, name: String) -> Result<TagDetails> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Find the reference for the tag
    let refname = format!("refs/tags/{}", name);
    let reference = repo
        .find_reference(&refname)
        .map_err(|_| LeviathanError::TagNotFound(name.clone()))?;

    let ref_oid = reference.target().ok_or(LeviathanError::InvalidReference)?;

    // Try to get tag details if it's an annotated tag
    let details = if let Ok(tag) = repo.find_tag(ref_oid) {
        // Check if tag is signed by looking for PGP signature in the raw message
        let is_signed = tag
            .message_bytes()
            .map(|bytes| {
                let msg = String::from_utf8_lossy(bytes);
                msg.contains("-----BEGIN PGP SIGNATURE-----")
            })
            .unwrap_or(false);

        TagDetails {
            name,
            oid: ref_oid.to_string(),
            target_oid: tag.target_id().to_string(),
            is_annotated: true,
            message: tag.message().map(|s| s.to_string()),
            tagger_name: tag.tagger().and_then(|s| s.name().map(|n| n.to_string())),
            tagger_email: tag.tagger().and_then(|s| s.email().map(|e| e.to_string())),
            tagger_date: tag.tagger().map(|s| s.when().seconds()),
            is_signed,
        }
    } else {
        // Lightweight tag
        TagDetails {
            name,
            oid: ref_oid.to_string(),
            target_oid: ref_oid.to_string(),
            is_annotated: false,
            message: None,
            tagger_name: None,
            tagger_email: None,
            tagger_date: None,
            is_signed: false,
        }
    };

    Ok(details)
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

/// Edit an annotated tag's message
/// This works by deleting the old tag and creating a new one with the updated message
#[command]
pub async fn edit_tag_message(path: String, name: String, message: String) -> Result<TagDetails> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Find the existing tag
    let refname = format!("refs/tags/{}", name);
    let reference = repo
        .find_reference(&refname)
        .map_err(|_| LeviathanError::TagNotFound(name.clone()))?;

    let ref_oid = reference.target().ok_or(LeviathanError::InvalidReference)?;

    // Get tag details - we need the target commit
    let tag = repo.find_tag(ref_oid).map_err(|_| {
        LeviathanError::OperationFailed("Cannot edit a lightweight tag".to_string())
    })?;

    let target_oid = tag.target_id();
    let target_obj = repo.find_object(target_oid, None)?;

    // Delete the old tag
    repo.tag_delete(&name)?;

    // Create new tag with updated message
    let signature = repo.signature()?;
    let new_tag_oid = repo.tag(&name, &target_obj, &signature, &message, false)?;

    // Return the updated tag details
    let new_tag = repo.find_tag(new_tag_oid)?;
    let is_signed = new_tag
        .message_bytes()
        .map(|bytes| {
            let msg = String::from_utf8_lossy(bytes);
            msg.contains("-----BEGIN PGP SIGNATURE-----")
        })
        .unwrap_or(false);

    Ok(TagDetails {
        name,
        oid: new_tag_oid.to_string(),
        target_oid: target_oid.to_string(),
        is_annotated: true,
        message: Some(message),
        tagger_name: signature.name().map(|s| s.to_string()),
        tagger_email: signature.email().map(|e| e.to_string()),
        tagger_date: Some(signature.when().seconds()),
        is_signed,
    })
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

    #[tokio::test]
    async fn test_get_tag_details_annotated() {
        let repo = TestRepo::with_initial_commit();
        create_tag(
            repo.path_str(),
            "v1.0.0".to_string(),
            None,
            Some("Release 1.0.0".to_string()),
        )
        .await
        .unwrap();

        let result = get_tag_details(repo.path_str(), "v1.0.0".to_string()).await;
        assert!(result.is_ok());
        let details = result.unwrap();
        assert_eq!(details.name, "v1.0.0");
        assert!(details.is_annotated);
        assert_eq!(details.message, Some("Release 1.0.0".to_string()));
        assert_eq!(details.tagger_name, Some("Test User".to_string()));
        assert_eq!(details.tagger_email, Some("test@example.com".to_string()));
        assert!(details.tagger_date.is_some());
        assert!(!details.is_signed);
        // Annotated tag oid differs from target oid
        assert_ne!(details.oid, details.target_oid);
    }

    #[tokio::test]
    async fn test_get_tag_details_lightweight() {
        let repo = TestRepo::with_initial_commit();
        create_tag(repo.path_str(), "v0.1.0".to_string(), None, None)
            .await
            .unwrap();

        let result = get_tag_details(repo.path_str(), "v0.1.0".to_string()).await;
        assert!(result.is_ok());
        let details = result.unwrap();
        assert_eq!(details.name, "v0.1.0");
        assert!(!details.is_annotated);
        assert!(details.message.is_none());
        assert!(details.tagger_name.is_none());
        assert!(details.tagger_email.is_none());
        assert!(details.tagger_date.is_none());
        assert!(!details.is_signed);
        // Lightweight tag oid equals target oid
        assert_eq!(details.oid, details.target_oid);
    }

    #[tokio::test]
    async fn test_get_tag_details_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = get_tag_details(repo.path_str(), "nonexistent".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_tag_message() {
        let repo = TestRepo::with_initial_commit();
        create_tag(
            repo.path_str(),
            "v1.0.0".to_string(),
            None,
            Some("Original message".to_string()),
        )
        .await
        .unwrap();

        let result = edit_tag_message(
            repo.path_str(),
            "v1.0.0".to_string(),
            "Updated message".to_string(),
        )
        .await;
        assert!(result.is_ok());
        let details = result.unwrap();
        assert_eq!(details.name, "v1.0.0");
        assert!(details.is_annotated);
        assert_eq!(details.message, Some("Updated message".to_string()));
        assert_eq!(details.tagger_name, Some("Test User".to_string()));

        // Verify by fetching again
        let fetched = get_tag_details(repo.path_str(), "v1.0.0".to_string())
            .await
            .unwrap();
        assert_eq!(fetched.message, Some("Updated message".to_string()));
    }

    #[tokio::test]
    async fn test_edit_tag_message_lightweight_fails() {
        let repo = TestRepo::with_initial_commit();
        create_tag(repo.path_str(), "v0.1.0".to_string(), None, None)
            .await
            .unwrap();

        let result = edit_tag_message(
            repo.path_str(),
            "v0.1.0".to_string(),
            "Should fail".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_tag_message_not_found() {
        let repo = TestRepo::with_initial_commit();
        let result = edit_tag_message(
            repo.path_str(),
            "nonexistent".to_string(),
            "Should fail".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_tag_message_preserves_target() {
        let repo = TestRepo::with_initial_commit();
        let head_oid = repo.head_oid();

        create_tag(
            repo.path_str(),
            "v1.0.0".to_string(),
            None,
            Some("Original".to_string()),
        )
        .await
        .unwrap();

        let result = edit_tag_message(
            repo.path_str(),
            "v1.0.0".to_string(),
            "New message".to_string(),
        )
        .await
        .unwrap();

        // Target should still point to the same commit
        assert_eq!(result.target_oid, head_oid.to_string());
    }
}
