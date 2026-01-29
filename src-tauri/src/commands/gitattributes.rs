//! Gitattributes management command handlers
//! Add and manage .gitattributes entries from the UI

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// A single attribute entry (e.g., `text`, `-diff`, `merge=union`, `!export-ignore`)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributeEntry {
    pub name: String,
    pub value: AttributeValue,
}

/// The value of an attribute
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttributeValue {
    /// Attribute is set (e.g., `text`)
    Set,
    /// Attribute is unset (e.g., `-text`)
    Unset,
    /// Attribute has a value (e.g., `diff=lfs`)
    Value(String),
    /// Attribute is unspecified (e.g., `!text`)
    Unspecified,
}

/// A parsed line from a .gitattributes file
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAttribute {
    pub pattern: String,
    pub attributes: Vec<AttributeEntry>,
    pub line_number: u32,
    pub raw_line: String,
}

/// A common git attribute with description
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonAttribute {
    pub name: String,
    pub description: String,
    pub example: String,
}

/// Parse a single attribute token into an AttributeEntry
fn parse_attribute_token(token: &str) -> AttributeEntry {
    if let Some(name) = token.strip_prefix('-') {
        AttributeEntry {
            name: name.to_string(),
            value: AttributeValue::Unset,
        }
    } else if let Some(name) = token.strip_prefix('!') {
        AttributeEntry {
            name: name.to_string(),
            value: AttributeValue::Unspecified,
        }
    } else if let Some((name, val)) = token.split_once('=') {
        AttributeEntry {
            name: name.to_string(),
            value: AttributeValue::Value(val.to_string()),
        }
    } else {
        AttributeEntry {
            name: token.to_string(),
            value: AttributeValue::Set,
        }
    }
}

/// Parse the entire .gitattributes content into structured entries
fn parse_gitattributes(content: &str) -> Vec<GitAttribute> {
    let mut entries = Vec::new();

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        // Skip comments and empty lines
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Split line into pattern and attributes
        // The pattern is the first whitespace-delimited token
        let mut parts = trimmed.split_whitespace();
        let pattern = match parts.next() {
            Some(p) => p.to_string(),
            None => continue,
        };

        let attributes: Vec<AttributeEntry> = parts.map(parse_attribute_token).collect();

        entries.push(GitAttribute {
            pattern,
            attributes,
            line_number: (i + 1) as u32,
            raw_line: line.to_string(),
        });
    }

    entries
}

/// Get the contents of the .gitattributes file
#[command]
pub async fn get_gitattributes(path: String) -> Result<Vec<GitAttribute>> {
    let attrs_path = Path::new(&path).join(".gitattributes");

    if !attrs_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&attrs_path)?;
    Ok(parse_gitattributes(&content))
}

/// Add a new entry to .gitattributes
#[command]
pub async fn add_gitattribute(
    path: String,
    pattern: String,
    attributes: String,
) -> Result<Vec<GitAttribute>> {
    let attrs_path = Path::new(&path).join(".gitattributes");

    let mut content = if attrs_path.exists() {
        std::fs::read_to_string(&attrs_path)?
    } else {
        String::new()
    };

    // Ensure file ends with newline
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }

    // Append the new line
    content.push_str(&format!("{} {}\n", pattern, attributes));

    std::fs::write(&attrs_path, &content)?;
    Ok(parse_gitattributes(&content))
}

/// Remove a line from .gitattributes by line number (1-based)
#[command]
pub async fn remove_gitattribute(path: String, line_number: u32) -> Result<Vec<GitAttribute>> {
    let attrs_path = Path::new(&path).join(".gitattributes");

    if !attrs_path.exists() {
        return Err(LeviathanError::OperationFailed(
            ".gitattributes file does not exist".to_string(),
        ));
    }

    let content = std::fs::read_to_string(&attrs_path)?;
    let lines: Vec<&str> = content.lines().collect();

    if line_number == 0 || line_number as usize > lines.len() {
        return Err(LeviathanError::OperationFailed(format!(
            "Invalid line number: {}",
            line_number
        )));
    }

    let new_lines: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != (line_number as usize - 1))
        .map(|(_, line)| *line)
        .collect();

    let mut result = new_lines.join("\n");
    if !result.is_empty() {
        result.push('\n');
    }

    std::fs::write(&attrs_path, &result)?;
    Ok(parse_gitattributes(&result))
}

/// Update a line in .gitattributes by line number (1-based)
#[command]
pub async fn update_gitattribute(
    path: String,
    line_number: u32,
    pattern: String,
    attributes: String,
) -> Result<Vec<GitAttribute>> {
    let attrs_path = Path::new(&path).join(".gitattributes");

    if !attrs_path.exists() {
        return Err(LeviathanError::OperationFailed(
            ".gitattributes file does not exist".to_string(),
        ));
    }

    let content = std::fs::read_to_string(&attrs_path)?;
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    if line_number == 0 || line_number as usize > lines.len() {
        return Err(LeviathanError::OperationFailed(format!(
            "Invalid line number: {}",
            line_number
        )));
    }

    lines[(line_number as usize) - 1] = format!("{} {}", pattern, attributes);

    let mut result = lines.join("\n");
    if !result.is_empty() {
        result.push('\n');
    }

    std::fs::write(&attrs_path, &result)?;
    Ok(parse_gitattributes(&result))
}

/// Get a list of common git attributes with descriptions
#[command]
pub async fn get_common_attributes() -> Result<Vec<CommonAttribute>> {
    Ok(vec![
        CommonAttribute {
            name: "text".to_string(),
            description: "Text file line ending handling".to_string(),
            example: "*.txt text".to_string(),
        },
        CommonAttribute {
            name: "binary".to_string(),
            description: "Binary file (no diff, no merge)".to_string(),
            example: "*.png binary".to_string(),
        },
        CommonAttribute {
            name: "diff".to_string(),
            description: "Diff driver to use".to_string(),
            example: "*.md diff=markdown".to_string(),
        },
        CommonAttribute {
            name: "merge".to_string(),
            description: "Merge driver to use".to_string(),
            example: "*.lock merge=ours".to_string(),
        },
        CommonAttribute {
            name: "filter".to_string(),
            description: "Content filter (clean/smudge)".to_string(),
            example: "*.large filter=lfs".to_string(),
        },
        CommonAttribute {
            name: "eol".to_string(),
            description: "Line ending style (lf, crlf)".to_string(),
            example: "*.sh eol=lf".to_string(),
        },
        CommonAttribute {
            name: "linguist-language".to_string(),
            description: "Override GitHub language detection".to_string(),
            example: "*.js linguist-language=TypeScript".to_string(),
        },
        CommonAttribute {
            name: "export-ignore".to_string(),
            description: "Exclude from archive".to_string(),
            example: ".gitignore export-ignore".to_string(),
        },
        CommonAttribute {
            name: "export-subst".to_string(),
            description: "Keyword substitution in archive".to_string(),
            example: "VERSION export-subst".to_string(),
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[test]
    fn test_parse_attribute_token_set() {
        let entry = parse_attribute_token("text");
        assert_eq!(entry.name, "text");
        assert!(matches!(entry.value, AttributeValue::Set));
    }

    #[test]
    fn test_parse_attribute_token_unset() {
        let entry = parse_attribute_token("-diff");
        assert_eq!(entry.name, "diff");
        assert!(matches!(entry.value, AttributeValue::Unset));
    }

    #[test]
    fn test_parse_attribute_token_value() {
        let entry = parse_attribute_token("merge=union");
        assert_eq!(entry.name, "merge");
        match &entry.value {
            AttributeValue::Value(v) => assert_eq!(v, "union"),
            _ => panic!("Expected Value variant"),
        }
    }

    #[test]
    fn test_parse_attribute_token_unspecified() {
        let entry = parse_attribute_token("!export-ignore");
        assert_eq!(entry.name, "export-ignore");
        assert!(matches!(entry.value, AttributeValue::Unspecified));
    }

    #[test]
    fn test_parse_gitattributes_basic() {
        let content = "*.txt text\n*.png binary\n";
        let entries = parse_gitattributes(content);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].pattern, "*.txt");
        assert_eq!(entries[0].attributes.len(), 1);
        assert_eq!(entries[0].attributes[0].name, "text");
        assert_eq!(entries[0].line_number, 1);
        assert_eq!(entries[1].pattern, "*.png");
        assert_eq!(entries[1].line_number, 2);
    }

    #[test]
    fn test_parse_gitattributes_skips_comments_and_empty() {
        let content = "# Header comment\n\n*.txt text\n# Another comment\n*.bin binary\n";
        let entries = parse_gitattributes(content);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].pattern, "*.txt");
        assert_eq!(entries[0].line_number, 3);
        assert_eq!(entries[1].pattern, "*.bin");
        assert_eq!(entries[1].line_number, 5);
    }

    #[test]
    fn test_parse_gitattributes_multiple_attrs() {
        let content = "*.cs text diff=csharp eol=crlf\n";
        let entries = parse_gitattributes(content);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].attributes.len(), 3);
        assert_eq!(entries[0].attributes[0].name, "text");
        assert!(matches!(
            entries[0].attributes[0].value,
            AttributeValue::Set
        ));
        assert_eq!(entries[0].attributes[1].name, "diff");
        match &entries[0].attributes[1].value {
            AttributeValue::Value(v) => assert_eq!(v, "csharp"),
            _ => panic!("Expected Value"),
        }
        assert_eq!(entries[0].attributes[2].name, "eol");
        match &entries[0].attributes[2].value {
            AttributeValue::Value(v) => assert_eq!(v, "crlf"),
            _ => panic!("Expected Value"),
        }
    }

    #[test]
    fn test_parse_gitattributes_mixed_attributes() {
        let content = "*.dat -diff -merge binary !export-ignore\n";
        let entries = parse_gitattributes(content);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].attributes.len(), 4);
        assert!(matches!(
            entries[0].attributes[0].value,
            AttributeValue::Unset
        ));
        assert!(matches!(
            entries[0].attributes[1].value,
            AttributeValue::Unset
        ));
        assert!(matches!(
            entries[0].attributes[2].value,
            AttributeValue::Set
        ));
        assert!(matches!(
            entries[0].attributes[3].value,
            AttributeValue::Unspecified
        ));
    }

    #[tokio::test]
    async fn test_get_gitattributes_no_file() {
        let repo = TestRepo::with_initial_commit();
        let result = get_gitattributes(repo.path_str()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_gitattributes_with_entries() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(
            ".gitattributes",
            "# Auto detect text files\n* text=auto\n*.png binary\n",
        );

        let result = get_gitattributes(repo.path_str()).await.unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].pattern, "*");
        assert_eq!(result[1].pattern, "*.png");
    }

    #[tokio::test]
    async fn test_add_gitattribute_creates_file() {
        let repo = TestRepo::with_initial_commit();

        let result =
            add_gitattribute(repo.path_str(), "*.txt".to_string(), "text".to_string()).await;
        assert!(result.is_ok());

        let attrs_path = repo.path.join(".gitattributes");
        assert!(attrs_path.exists());

        let content = std::fs::read_to_string(&attrs_path).unwrap();
        assert!(content.contains("*.txt text"));
    }

    #[tokio::test]
    async fn test_add_gitattribute_appends() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitattributes", "*.txt text\n");

        let result =
            add_gitattribute(repo.path_str(), "*.png".to_string(), "binary".to_string()).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].pattern, "*.txt");
        assert_eq!(entries[1].pattern, "*.png");
    }

    #[tokio::test]
    async fn test_remove_gitattribute() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitattributes", "*.txt text\n*.png binary\n*.sh eol=lf\n");

        let result = remove_gitattribute(repo.path_str(), 2).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].pattern, "*.txt");
        assert_eq!(entries[1].pattern, "*.sh");
    }

    #[tokio::test]
    async fn test_remove_gitattribute_invalid_line() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitattributes", "*.txt text\n");

        let result = remove_gitattribute(repo.path_str(), 0).await;
        assert!(result.is_err());

        let result = remove_gitattribute(repo.path_str(), 99).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_remove_gitattribute_no_file() {
        let repo = TestRepo::with_initial_commit();
        let result = remove_gitattribute(repo.path_str(), 1).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_update_gitattribute() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitattributes", "*.txt text\n*.png binary\n");

        let result = update_gitattribute(
            repo.path_str(),
            1,
            "*.md".to_string(),
            "text diff=markdown".to_string(),
        )
        .await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].pattern, "*.md");
        assert_eq!(entries[0].attributes.len(), 2);
        assert_eq!(entries[1].pattern, "*.png");
    }

    #[tokio::test]
    async fn test_update_gitattribute_invalid_line() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitattributes", "*.txt text\n");

        let result =
            update_gitattribute(repo.path_str(), 0, "*.md".to_string(), "text".to_string()).await;
        assert!(result.is_err());

        let result =
            update_gitattribute(repo.path_str(), 99, "*.md".to_string(), "text".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_update_gitattribute_no_file() {
        let repo = TestRepo::with_initial_commit();
        let result =
            update_gitattribute(repo.path_str(), 1, "*.md".to_string(), "text".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_common_attributes() {
        let result = get_common_attributes().await;
        assert!(result.is_ok());
        let attrs = result.unwrap();
        assert!(!attrs.is_empty());
        assert!(attrs.iter().any(|a| a.name == "text"));
        assert!(attrs.iter().any(|a| a.name == "binary"));
        assert!(attrs.iter().any(|a| a.name == "eol"));
        assert!(attrs.iter().any(|a| a.name == "diff"));
        assert!(attrs.iter().any(|a| a.name == "merge"));
        assert!(attrs.iter().any(|a| a.name == "filter"));
        assert!(attrs.iter().any(|a| a.name == "linguist-language"));
        assert!(attrs.iter().any(|a| a.name == "export-ignore"));
        assert!(attrs.iter().any(|a| a.name == "export-subst"));
    }
}
