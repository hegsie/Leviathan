//! Commit models

use serde::{Deserialize, Serialize};

/// Commit information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub oid: String,
    pub short_id: String,
    pub message: String,
    pub summary: String,
    pub body: Option<String>,
    pub author: Signature,
    pub committer: Signature,
    pub parent_ids: Vec<String>,
    pub timestamp: i64,
}

/// Git signature (author/committer)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub name: String,
    pub email: String,
    pub timestamp: i64,
}

impl From<git2::Signature<'_>> for Signature {
    fn from(sig: git2::Signature) -> Self {
        Signature {
            name: sig.name().unwrap_or("Unknown").to_string(),
            email: sig.email().unwrap_or("").to_string(),
            timestamp: sig.when().seconds(),
        }
    }
}

/// Convert a git2 Commit to our Commit model
impl Commit {
    pub fn from_git2(commit: &git2::Commit) -> Self {
        let message = commit.message().unwrap_or("").to_string();
        let summary = commit.summary().unwrap_or("").to_string();
        let body = message
            .lines()
            .skip(1)
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();

        Commit {
            oid: commit.id().to_string(),
            short_id: commit.id().to_string()[..7].to_string(),
            message: message.clone(),
            summary,
            body: if body.is_empty() { None } else { Some(body) },
            author: Signature::from(commit.author()),
            committer: Signature::from(commit.committer()),
            parent_ids: commit.parent_ids().map(|id| id.to_string()).collect(),
            // Use the maximum of author/committer timestamps for sorting.
            // For cherry-picks/reverts, one timestamp may be from the original commit
            // while the other is from when the operation was performed. Using the max
            // ensures the commit sorts correctly relative to its parent.
            timestamp: commit
                .author()
                .when()
                .seconds()
                .max(commit.committer().when().seconds()),
        }
    }
}
