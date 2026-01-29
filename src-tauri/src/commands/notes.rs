//! Git Notes command handlers
//! Add, view, edit, and remove notes on commits

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// A git note attached to a commit
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitNote {
    pub commit_oid: String,
    pub message: String,
    pub notes_ref: String,
}

/// Get the note for a specific commit
#[command]
pub async fn get_note(
    path: String,
    commit_oid: String,
    notes_ref: Option<String>,
) -> Result<Option<GitNote>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let notes_ref = notes_ref.as_deref().unwrap_or("refs/notes/commits");

    let oid = git2::Oid::from_str(&commit_oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;

    let result = match repo.find_note(Some(notes_ref), oid) {
        Ok(note) => Some(GitNote {
            commit_oid,
            message: note.message().unwrap_or("").to_string(),
            notes_ref: notes_ref.to_string(),
        }),
        Err(_) => None,
    };
    Ok(result)
}

/// Get all notes in the repository
#[command]
pub async fn get_notes(path: String, notes_ref: Option<String>) -> Result<Vec<GitNote>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let notes_ref_str = notes_ref.as_deref().unwrap_or("refs/notes/commits");
    let mut notes = Vec::new();

    let result = repo.notes(Some(notes_ref_str));
    if let Ok(note_iter) = result {
        for (note_oid, annotated_oid) in note_iter.flatten() {
            if let Ok(note) = repo.find_note(Some(notes_ref_str), annotated_oid) {
                notes.push(GitNote {
                    commit_oid: annotated_oid.to_string(),
                    message: note.message().unwrap_or("").to_string(),
                    notes_ref: notes_ref_str.to_string(),
                });
            } else {
                // Try reading from the note blob directly
                if let Ok(blob) = repo.find_blob(note_oid) {
                    let content = std::str::from_utf8(blob.content()).unwrap_or("");
                    notes.push(GitNote {
                        commit_oid: annotated_oid.to_string(),
                        message: content.to_string(),
                        notes_ref: notes_ref_str.to_string(),
                    });
                }
            }
        }
    }

    Ok(notes)
}

/// Add or update a note on a commit
#[command]
pub async fn set_note(
    path: String,
    commit_oid: String,
    message: String,
    notes_ref: Option<String>,
    force: Option<bool>,
) -> Result<GitNote> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let notes_ref = notes_ref.as_deref().unwrap_or("refs/notes/commits");
    let force = force.unwrap_or(true);

    let oid = git2::Oid::from_str(&commit_oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;

    let sig = repo.signature()?;

    repo.note(&sig, &sig, Some(notes_ref), oid, &message, force)?;

    Ok(GitNote {
        commit_oid,
        message,
        notes_ref: notes_ref.to_string(),
    })
}

/// Remove a note from a commit
#[command]
pub async fn remove_note(
    path: String,
    commit_oid: String,
    notes_ref: Option<String>,
) -> Result<()> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let notes_ref = notes_ref.as_deref().unwrap_or("refs/notes/commits");

    let oid = git2::Oid::from_str(&commit_oid)
        .map_err(|_| LeviathanError::CommitNotFound(commit_oid.clone()))?;

    let sig = repo.signature()?;

    repo.note_delete(oid, Some(notes_ref), &sig, &sig)
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to remove note: {}", e)))?;

    Ok(())
}

/// Get list of available notes refs
#[command]
pub async fn get_notes_refs(path: String) -> Result<Vec<String>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut refs = Vec::new();

    for r in (repo.references_glob("refs/notes/*")?).flatten() {
        if let Some(name) = r.name() {
            refs.push(name.to_string());
        }
    }

    if refs.is_empty() {
        refs.push("refs/notes/commits".to_string());
    }

    Ok(refs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_note_none() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result = get_note(repo.path_str(), oid.to_string(), None).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_set_and_get_note() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let set_result = set_note(
            repo.path_str(),
            oid.to_string(),
            "This is a test note".to_string(),
            None,
            None,
        )
        .await;
        assert!(set_result.is_ok());

        let get_result = get_note(repo.path_str(), oid.to_string(), None).await;
        assert!(get_result.is_ok());
        let note = get_result.unwrap();
        assert!(note.is_some());
        assert_eq!(note.unwrap().message, "This is a test note");
    }

    #[tokio::test]
    async fn test_update_note() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        set_note(
            repo.path_str(),
            oid.to_string(),
            "First note".to_string(),
            None,
            None,
        )
        .await
        .unwrap();

        set_note(
            repo.path_str(),
            oid.to_string(),
            "Updated note".to_string(),
            None,
            Some(true),
        )
        .await
        .unwrap();

        let note = get_note(repo.path_str(), oid.to_string(), None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(note.message, "Updated note");
    }

    #[tokio::test]
    async fn test_remove_note() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        set_note(
            repo.path_str(),
            oid.to_string(),
            "To be removed".to_string(),
            None,
            None,
        )
        .await
        .unwrap();

        let result = remove_note(repo.path_str(), oid.to_string(), None).await;
        assert!(result.is_ok());

        let note = get_note(repo.path_str(), oid.to_string(), None)
            .await
            .unwrap();
        assert!(note.is_none());
    }

    #[tokio::test]
    async fn test_remove_nonexistent_note() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result = remove_note(repo.path_str(), oid.to_string(), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_notes_empty() {
        let repo = TestRepo::with_initial_commit();
        let result = get_notes(repo.path_str(), None).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_notes_with_data() {
        let repo = TestRepo::with_initial_commit();
        let oid1 = repo.head_oid();
        let oid2 = repo.create_commit("Second", &[("f.txt", "c")]);

        set_note(
            repo.path_str(),
            oid1.to_string(),
            "Note 1".to_string(),
            None,
            None,
        )
        .await
        .unwrap();

        set_note(
            repo.path_str(),
            oid2.to_string(),
            "Note 2".to_string(),
            None,
            None,
        )
        .await
        .unwrap();

        let result = get_notes(repo.path_str(), None).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_get_notes_refs_default() {
        let repo = TestRepo::with_initial_commit();
        let result = get_notes_refs(repo.path_str()).await;
        assert!(result.is_ok());
        let refs = result.unwrap();
        assert!(!refs.is_empty());
        assert!(refs.contains(&"refs/notes/commits".to_string()));
    }

    #[tokio::test]
    async fn test_custom_notes_ref() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let set_result = set_note(
            repo.path_str(),
            oid.to_string(),
            "Custom ref note".to_string(),
            Some("refs/notes/custom".to_string()),
            None,
        )
        .await;
        assert!(set_result.is_ok());

        let note = get_note(
            repo.path_str(),
            oid.to_string(),
            Some("refs/notes/custom".to_string()),
        )
        .await
        .unwrap();
        assert!(note.is_some());
        assert_eq!(note.unwrap().notes_ref, "refs/notes/custom");
    }

    #[tokio::test]
    async fn test_set_note_invalid_commit() {
        let repo = TestRepo::with_initial_commit();
        let result = set_note(
            repo.path_str(),
            "invalid-oid".to_string(),
            "Note".to_string(),
            None,
            None,
        )
        .await;
        assert!(result.is_err());
    }
}
