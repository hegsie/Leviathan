//! Tag command handlers

use std::path::Path;
use tauri::command;

use crate::error::Result;
use crate::models::{Tag, Signature};

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
        (true, Some(Signature {
            name: signature.name().unwrap_or("").to_string(),
            email: signature.email().unwrap_or("").to_string(),
            timestamp: signature.when().seconds(),
        }))
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
