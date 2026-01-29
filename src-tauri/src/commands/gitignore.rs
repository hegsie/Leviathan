//! Gitignore management command handlers
//! Add files/patterns to .gitignore from the UI

use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::utils::create_command;

/// Entry in a .gitignore file
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitignoreEntry {
    pub pattern: String,
    pub line_number: usize,
    pub is_comment: bool,
    pub is_negation: bool,
    pub is_empty: bool,
}

/// Get the contents of the .gitignore file
#[command]
pub async fn get_gitignore(path: String) -> Result<Vec<GitignoreEntry>> {
    let gitignore_path = Path::new(&path).join(".gitignore");
    let mut entries = Vec::new();

    if !gitignore_path.exists() {
        return Ok(entries);
    }

    let content = std::fs::read_to_string(&gitignore_path)?;

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        entries.push(GitignoreEntry {
            pattern: line.to_string(),
            line_number: i + 1,
            is_comment: trimmed.starts_with('#'),
            is_negation: trimmed.starts_with('!'),
            is_empty: trimmed.is_empty(),
        });
    }

    Ok(entries)
}

/// Add patterns to .gitignore
#[command]
pub async fn add_to_gitignore(path: String, patterns: Vec<String>) -> Result<()> {
    let gitignore_path = Path::new(&path).join(".gitignore");

    let mut content = if gitignore_path.exists() {
        std::fs::read_to_string(&gitignore_path)?
    } else {
        String::new()
    };

    // Ensure file ends with newline
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }

    for pattern in &patterns {
        // Check if pattern already exists
        let already_exists = content.lines().any(|line| line.trim() == pattern.trim());

        if !already_exists {
            content.push_str(pattern);
            content.push('\n');
        }
    }

    std::fs::write(&gitignore_path, &content)?;
    Ok(())
}

/// Remove a pattern from .gitignore
#[command]
pub async fn remove_from_gitignore(path: String, pattern: String) -> Result<()> {
    let gitignore_path = Path::new(&path).join(".gitignore");

    if !gitignore_path.exists() {
        return Err(LeviathanError::OperationFailed(
            ".gitignore file does not exist".to_string(),
        ));
    }

    let content = std::fs::read_to_string(&gitignore_path)?;
    let new_content: Vec<&str> = content
        .lines()
        .filter(|line| line.trim() != pattern.trim())
        .collect();

    let mut result = new_content.join("\n");
    if !result.is_empty() {
        result.push('\n');
    }

    std::fs::write(&gitignore_path, &result)?;
    Ok(())
}

/// Check if a file path matches any gitignore pattern
#[command]
pub async fn is_ignored(path: String, file_path: String) -> Result<bool> {
    let repo = git2::Repository::open(Path::new(&path))?;
    Ok(repo.is_path_ignored(Path::new(&file_path))?)
}

/// Result of checking whether a file is ignored by gitignore rules
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreCheckResult {
    pub path: String,
    pub is_ignored: bool,
}

/// Verbose result of checking whether a file is ignored, including rule details
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreCheckVerboseResult {
    pub path: String,
    pub is_ignored: bool,
    /// Which .gitignore file contains the matching rule
    pub source_file: Option<String>,
    /// Line number in the .gitignore file
    pub source_line: Option<u32>,
    /// The matching pattern
    pub pattern: Option<String>,
    /// Whether the matching pattern is negated (! prefix)
    pub is_negated: bool,
}

/// Check if files are ignored by gitignore rules
#[command]
pub async fn check_ignore(path: String, file_paths: Vec<String>) -> Result<Vec<IgnoreCheckResult>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut results = Vec::with_capacity(file_paths.len());
    for file_path in &file_paths {
        let is_ignored = repo.is_path_ignored(Path::new(file_path)).unwrap_or(false);
        results.push(IgnoreCheckResult {
            path: file_path.clone(),
            is_ignored,
        });
    }

    Ok(results)
}

/// Check if files are ignored by gitignore rules, with verbose rule details.
///
/// Uses `git check-ignore -v --no-index` to get the source file, line number,
/// and pattern that matches each path.
#[command]
pub async fn check_ignore_verbose(
    path: String,
    file_paths: Vec<String>,
) -> Result<Vec<IgnoreCheckVerboseResult>> {
    if file_paths.is_empty() {
        return Ok(Vec::new());
    }

    // Use git check-ignore -v --no-index -n to get verbose output for all paths.
    // -v gives source:linenum:pattern\tpath
    // --no-index checks against gitignore rules without requiring the file to exist
    // -n (--non-matching) also shows paths that are NOT ignored
    let output = create_command("git")
        .arg("-C")
        .arg(&path)
        .arg("check-ignore")
        .arg("-v")
        .arg("--no-index")
        .arg("-n")
        .args(&file_paths)
        .output()
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to run git check-ignore: {}", e))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse the output. Each line has the format:
    // source:linenum:pattern\tpathname    (for matched paths)
    // ::\t pathname                        (for non-matched paths with -n)
    let mut results: Vec<IgnoreCheckVerboseResult> = Vec::with_capacity(file_paths.len());
    let mut seen_paths = std::collections::HashSet::new();

    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }

        if let Some(result) = parse_check_ignore_verbose_line(line) {
            seen_paths.insert(result.path.clone());
            results.push(result);
        }
    }

    // For any paths not in the output (shouldn't happen with -n, but be safe),
    // fall back to git2 is_path_ignored
    let repo = git2::Repository::open(Path::new(&path))?;
    for file_path in &file_paths {
        if !seen_paths.contains(file_path.as_str()) {
            let is_ignored = repo.is_path_ignored(Path::new(file_path)).unwrap_or(false);
            results.push(IgnoreCheckVerboseResult {
                path: file_path.clone(),
                is_ignored,
                source_file: None,
                source_line: None,
                pattern: None,
                is_negated: false,
            });
        }
    }

    Ok(results)
}

/// Parse a single line of `git check-ignore -v --no-index -n` output.
///
/// Format: `source:linenum:pattern\tpathname`
/// For non-matching (with -n): `::\t pathname`
fn parse_check_ignore_verbose_line(line: &str) -> Option<IgnoreCheckVerboseResult> {
    // Split on tab to separate the rule info from the path
    let tab_pos = line.find('\t')?;
    let rule_part = &line[..tab_pos];
    let path_part = line[tab_pos + 1..].trim().to_string();

    if path_part.is_empty() {
        return None;
    }

    // Parse rule_part which is "source:linenum:pattern"
    // For non-matching lines: "::"
    // We need to split on ':' but be careful - source paths on Windows can contain ':'
    // The format is: source_file:line_number:pattern
    // Non-matching: ::

    if rule_part == "::" {
        // Non-matching path
        return Some(IgnoreCheckVerboseResult {
            path: path_part,
            is_ignored: false,
            source_file: None,
            source_line: None,
            pattern: None,
            is_negated: false,
        });
    }

    // Find the pattern by splitting from the right on ':'
    // Pattern is after the last ':', line number is between second-to-last and last ':'
    // Source file is everything before the second-to-last ':'
    let mut colon_positions: Vec<usize> = Vec::new();
    for (i, ch) in rule_part.char_indices() {
        if ch == ':' {
            colon_positions.push(i);
        }
    }

    if colon_positions.len() < 2 {
        return None;
    }

    let last_colon = colon_positions[colon_positions.len() - 1];
    let second_last_colon = colon_positions[colon_positions.len() - 2];

    let source_file = &rule_part[..second_last_colon];
    let line_num_str = &rule_part[second_last_colon + 1..last_colon];
    let pattern_str = &rule_part[last_colon + 1..];

    let source_line = line_num_str.parse::<u32>().ok();
    let is_negated = pattern_str.starts_with('!');
    let is_ignored = !is_negated;

    Some(IgnoreCheckVerboseResult {
        path: path_part,
        is_ignored,
        source_file: if source_file.is_empty() {
            None
        } else {
            Some(source_file.to_string())
        },
        source_line,
        pattern: if pattern_str.is_empty() {
            None
        } else {
            Some(pattern_str.to_string())
        },
        is_negated,
    })
}

/// Get common gitignore templates
#[command]
pub async fn get_gitignore_templates() -> Result<Vec<GitignoreTemplate>> {
    Ok(vec![
        GitignoreTemplate {
            name: "Node.js".to_string(),
            patterns: vec![
                "node_modules/".to_string(),
                "dist/".to_string(),
                ".env".to_string(),
                ".env.local".to_string(),
                "npm-debug.log*".to_string(),
                "yarn-debug.log*".to_string(),
                "yarn-error.log*".to_string(),
                ".npm".to_string(),
                "coverage/".to_string(),
            ],
        },
        GitignoreTemplate {
            name: "Rust".to_string(),
            patterns: vec![
                "/target/".to_string(),
                "Cargo.lock".to_string(),
                "**/*.rs.bk".to_string(),
            ],
        },
        GitignoreTemplate {
            name: "Python".to_string(),
            patterns: vec![
                "__pycache__/".to_string(),
                "*.py[cod]".to_string(),
                "*$py.class".to_string(),
                "*.so".to_string(),
                ".Python".to_string(),
                "build/".to_string(),
                "develop-eggs/".to_string(),
                "dist/".to_string(),
                "eggs/".to_string(),
                ".eggs/".to_string(),
                "*.egg-info/".to_string(),
                "*.egg".to_string(),
                ".venv/".to_string(),
                "venv/".to_string(),
            ],
        },
        GitignoreTemplate {
            name: "Java".to_string(),
            patterns: vec![
                "*.class".to_string(),
                "*.jar".to_string(),
                "*.war".to_string(),
                "*.ear".to_string(),
                "target/".to_string(),
                ".gradle/".to_string(),
                "build/".to_string(),
            ],
        },
        GitignoreTemplate {
            name: "IDE".to_string(),
            patterns: vec![
                ".idea/".to_string(),
                ".vscode/".to_string(),
                "*.swp".to_string(),
                "*.swo".to_string(),
                "*~".to_string(),
                ".DS_Store".to_string(),
                "Thumbs.db".to_string(),
            ],
        },
    ])
}

/// Gitignore template with common patterns
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitignoreTemplate {
    pub name: String,
    pub patterns: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_get_gitignore_no_file() {
        let repo = TestRepo::with_initial_commit();
        let result = get_gitignore(repo.path_str()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_add_to_gitignore_creates_file() {
        let repo = TestRepo::with_initial_commit();

        let result = add_to_gitignore(
            repo.path_str(),
            vec!["node_modules/".to_string(), ".env".to_string()],
        )
        .await;
        assert!(result.is_ok());

        let gitignore_path = repo.path.join(".gitignore");
        assert!(gitignore_path.exists());

        let content = std::fs::read_to_string(&gitignore_path).unwrap();
        assert!(content.contains("node_modules/"));
        assert!(content.contains(".env"));
    }

    #[tokio::test]
    async fn test_add_to_gitignore_no_duplicates() {
        let repo = TestRepo::with_initial_commit();

        add_to_gitignore(repo.path_str(), vec!["node_modules/".to_string()])
            .await
            .unwrap();

        // Add again
        add_to_gitignore(repo.path_str(), vec!["node_modules/".to_string()])
            .await
            .unwrap();

        let content = std::fs::read_to_string(repo.path.join(".gitignore")).unwrap();
        let count = content
            .lines()
            .filter(|l| l.trim() == "node_modules/")
            .count();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn test_get_gitignore_entries() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitignore", "# Comment\nnode_modules/\n\n!important.txt\n");

        let result = get_gitignore(repo.path_str()).await.unwrap();
        assert_eq!(result.len(), 4);
        assert!(result[0].is_comment);
        assert!(!result[1].is_comment);
        assert_eq!(result[1].pattern, "node_modules/");
        assert!(result[2].is_empty);
        assert!(result[3].is_negation);
    }

    #[tokio::test]
    async fn test_remove_from_gitignore() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitignore", "node_modules/\n.env\ndist/\n");

        let result = remove_from_gitignore(repo.path_str(), ".env".to_string()).await;
        assert!(result.is_ok());

        let content = std::fs::read_to_string(repo.path.join(".gitignore")).unwrap();
        assert!(!content.contains(".env"));
        assert!(content.contains("node_modules/"));
        assert!(content.contains("dist/"));
    }

    #[tokio::test]
    async fn test_remove_from_nonexistent_gitignore() {
        let repo = TestRepo::with_initial_commit();
        let result = remove_from_gitignore(repo.path_str(), "pattern".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_is_ignored() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitignore", "*.log\n");
        repo.stage_file(".gitignore");
        repo.create_commit("Add gitignore", &[(".gitignore", "*.log\n")]);

        let result = is_ignored(repo.path_str(), "test.log".to_string()).await;
        assert!(result.is_ok());
        assert!(result.unwrap());

        let result2 = is_ignored(repo.path_str(), "test.txt".to_string()).await;
        assert!(result2.is_ok());
        assert!(!result2.unwrap());
    }

    #[tokio::test]
    async fn test_get_gitignore_templates() {
        let result = get_gitignore_templates().await;
        assert!(result.is_ok());
        let templates = result.unwrap();
        assert!(!templates.is_empty());
        assert!(templates.iter().any(|t| t.name == "Node.js"));
        assert!(templates.iter().any(|t| t.name == "Rust"));
    }

    #[tokio::test]
    async fn test_check_ignore_multiple_files() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitignore", "*.log\nbuild/\n");
        repo.stage_file(".gitignore");
        repo.create_commit("Add gitignore", &[(".gitignore", "*.log\nbuild/\n")]);

        let results = check_ignore(
            repo.path_str(),
            vec![
                "test.log".to_string(),
                "src/main.rs".to_string(),
                "build/output.js".to_string(),
            ],
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 3);
        assert!(results[0].is_ignored); // test.log matches *.log
        assert_eq!(results[0].path, "test.log");
        assert!(!results[1].is_ignored); // src/main.rs not ignored
        assert_eq!(results[1].path, "src/main.rs");
        assert!(results[2].is_ignored); // build/output.js matches build/
        assert_eq!(results[2].path, "build/output.js");
    }

    #[tokio::test]
    async fn test_check_ignore_empty_list() {
        let repo = TestRepo::with_initial_commit();

        let results = check_ignore(repo.path_str(), vec![]).await.unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_check_ignore_no_gitignore() {
        let repo = TestRepo::with_initial_commit();

        let results = check_ignore(
            repo.path_str(),
            vec!["test.log".to_string(), "src/main.rs".to_string()],
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 2);
        assert!(!results[0].is_ignored);
        assert!(!results[1].is_ignored);
    }

    #[tokio::test]
    async fn test_check_ignore_verbose_ignored_file() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file(".gitignore", "*.log\nbuild/\n");
        repo.stage_file(".gitignore");
        repo.create_commit("Add gitignore", &[(".gitignore", "*.log\nbuild/\n")]);

        let results = check_ignore_verbose(
            repo.path_str(),
            vec!["test.log".to_string(), "src/main.rs".to_string()],
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 2);

        // test.log should be ignored with pattern details
        let log_result = results.iter().find(|r| r.path == "test.log").unwrap();
        assert!(log_result.is_ignored);
        assert!(log_result.source_file.is_some());
        assert!(log_result.source_line.is_some());
        assert_eq!(log_result.pattern.as_deref(), Some("*.log"));
        assert!(!log_result.is_negated);

        // src/main.rs should not be ignored
        let rs_result = results.iter().find(|r| r.path == "src/main.rs").unwrap();
        assert!(!rs_result.is_ignored);
    }

    #[tokio::test]
    async fn test_check_ignore_verbose_empty_list() {
        let repo = TestRepo::with_initial_commit();

        let results = check_ignore_verbose(repo.path_str(), vec![]).await.unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_parse_check_ignore_verbose_line_matching() {
        let line = ".gitignore:1:*.log\ttest.log";
        let result = parse_check_ignore_verbose_line(line).unwrap();
        assert_eq!(result.path, "test.log");
        assert!(result.is_ignored);
        assert_eq!(result.source_file.as_deref(), Some(".gitignore"));
        assert_eq!(result.source_line, Some(1));
        assert_eq!(result.pattern.as_deref(), Some("*.log"));
        assert!(!result.is_negated);
    }

    #[test]
    fn test_parse_check_ignore_verbose_line_non_matching() {
        let line = "::\tsrc/main.rs";
        let result = parse_check_ignore_verbose_line(line).unwrap();
        assert_eq!(result.path, "src/main.rs");
        assert!(!result.is_ignored);
        assert!(result.source_file.is_none());
        assert!(result.source_line.is_none());
        assert!(result.pattern.is_none());
        assert!(!result.is_negated);
    }

    #[test]
    fn test_parse_check_ignore_verbose_line_negated() {
        let line = ".gitignore:3:!important.log\timportant.log";
        let result = parse_check_ignore_verbose_line(line).unwrap();
        assert_eq!(result.path, "important.log");
        assert!(!result.is_ignored);
        assert!(result.is_negated);
        assert_eq!(result.pattern.as_deref(), Some("!important.log"));
    }

    #[test]
    fn test_parse_check_ignore_verbose_line_subdirectory_gitignore() {
        let line = "src/.gitignore:2:*.tmp\tsrc/data.tmp";
        let result = parse_check_ignore_verbose_line(line).unwrap();
        assert_eq!(result.path, "src/data.tmp");
        assert!(result.is_ignored);
        assert_eq!(result.source_file.as_deref(), Some("src/.gitignore"));
        assert_eq!(result.source_line, Some(2));
        assert_eq!(result.pattern.as_deref(), Some("*.tmp"));
    }
}
