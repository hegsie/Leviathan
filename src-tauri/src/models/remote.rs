//! Remote models

use serde::{Deserialize, Serialize};

/// Remote repository information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub url: String,
    pub push_url: Option<String>,
}
