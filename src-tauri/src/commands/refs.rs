//! Refs command handlers
//! Provides commit-to-refs mapping for graph visualization

use std::collections::HashMap;
use std::path::Path;
use tauri::command;

use crate::error::Result;

/// A reference (branch or tag) pointing to a commit
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    pub name: String,
    pub shorthand: String,
    pub ref_type: RefType,
    pub is_head: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefType {
    LocalBranch,
    RemoteBranch,
    Tag,
}

/// Get all refs mapped by their target commit OID
/// Returns a map of commit OID -> list of refs pointing to it
#[command]
pub async fn get_refs_by_commit(path: String) -> Result<HashMap<String, Vec<RefInfo>>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut refs_map: HashMap<String, Vec<RefInfo>> = HashMap::new();

    let head = repo.head().ok();
    let head_name = head.as_ref().and_then(|h| h.name().map(|s| s.to_string()));

    // Get all references
    for reference in repo.references()? {
        let reference = match reference {
            Ok(r) => r,
            Err(_) => continue,
        };

        let name = match reference.name() {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Skip HEAD and other special refs
        if name == "HEAD" || name.starts_with("refs/stash") {
            continue;
        }

        // Get the target commit OID
        let target_oid = if reference.is_tag() {
            // For annotated tags, peel to the commit
            reference.peel_to_commit().ok().map(|c| c.id().to_string())
        } else {
            reference.target().map(|oid| oid.to_string())
        };

        let target_oid = match target_oid {
            Some(oid) => oid,
            None => continue,
        };

        // Determine ref type and create shorthand
        let (ref_type, shorthand) = if name.starts_with("refs/heads/") {
            (
                RefType::LocalBranch,
                name.strip_prefix("refs/heads/")
                    .unwrap_or(&name)
                    .to_string(),
            )
        } else if name.starts_with("refs/remotes/") {
            (
                RefType::RemoteBranch,
                name.strip_prefix("refs/remotes/")
                    .unwrap_or(&name)
                    .to_string(),
            )
        } else if name.starts_with("refs/tags/") {
            (
                RefType::Tag,
                name.strip_prefix("refs/tags/").unwrap_or(&name).to_string(),
            )
        } else {
            continue; // Skip other ref types
        };

        let is_head = head_name.as_ref().map(|h| h == &name).unwrap_or(false);

        let ref_info = RefInfo {
            name,
            shorthand,
            ref_type,
            is_head,
        };

        refs_map
            .entry(target_oid)
            .or_default()
            .push(ref_info);
    }

    Ok(refs_map)
}
