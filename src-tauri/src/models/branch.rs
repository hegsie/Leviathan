//! Branch models

use serde::{Deserialize, Serialize};

/// Branch information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub shorthand: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub target_oid: String,
    pub ahead_behind: Option<AheadBehind>,
}

/// Ahead/behind counts relative to upstream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub ahead: usize,
    pub behind: usize,
}

/// Tag information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    pub target_oid: String,
    pub message: Option<String>,
    pub tagger: Option<super::Signature>,
    pub is_annotated: bool,
}

/// Stash entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: usize,
    pub message: String,
    pub oid: String,
}
