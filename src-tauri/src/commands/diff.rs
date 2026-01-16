//! Diff command handlers

use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;
use tauri::command;

use crate::error::Result;
use crate::models::diff::{get_image_type, is_image_file};
use crate::models::{DiffFile, DiffHunk, DiffLine, DiffLineOrigin, FileStatus};

/// Check if a file extension indicates a known text file type.
/// This is used to override git's binary detection for common text formats
/// that may be incorrectly flagged as binary (e.g., UTF-16 encoded JSON).
fn is_known_text_extension(path: &str) -> bool {
    let path_lower = path.to_lowercase();
    let text_extensions = [
        ".json", ".txt", ".md", ".markdown", ".xml", ".yaml", ".yml", ".toml",
        ".html", ".htm", ".css", ".scss", ".sass", ".less",
        ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
        ".rs", ".py", ".rb", ".java", ".kt", ".scala", ".go", ".c", ".cpp", ".h", ".hpp",
        ".cs", ".fs", ".vb", ".swift", ".m", ".mm",
        ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
        ".sql", ".graphql", ".gql",
        ".env", ".ini", ".cfg", ".conf", ".config",
        ".gitignore", ".gitattributes", ".editorconfig",
        ".dockerfile", ".containerfile",
        ".tf", ".tfvars", ".hcl",
        ".vue", ".svelte", ".astro",
        ".csv", ".tsv", ".log",
    ];
    text_extensions.iter().any(|ext| path_lower.ends_with(ext))
}

/// Get diff for all changed files
#[command]
pub async fn get_diff(
    path: String,
    staged: Option<bool>,
    commit: Option<String>,
    compare_with: Option<String>,
) -> Result<Vec<DiffFile>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let diff = if let Some(ref commit_oid) = commit {
        // Diff between two commits or commit and parent
        let commit = repo.find_commit(git2::Oid::from_str(commit_oid)?)?;

        if let Some(ref compare_oid) = compare_with {
            let compare_commit = repo.find_commit(git2::Oid::from_str(compare_oid)?)?;
            repo.diff_tree_to_tree(Some(&compare_commit.tree()?), Some(&commit.tree()?), None)?
        } else {
            let parent = commit.parent(0).ok();
            let parent_tree = parent.as_ref().map(|p| p.tree()).transpose()?;
            repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit.tree()?), None)?
        }
    } else if staged.unwrap_or(false) {
        // Staged changes (index vs HEAD)
        let head = repo.head()?.peel_to_tree()?;
        repo.diff_tree_to_index(Some(&head), None, None)?
    } else {
        // Unstaged changes (working directory vs index)
        repo.diff_index_to_workdir(None, None)?
    };

    parse_diff(&diff)
}

/// Get diff for a specific file
#[command]
pub async fn get_file_diff(
    path: String,
    file_path: String,
    staged: Option<bool>,
) -> Result<DiffFile> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(&file_path);
    // Include untracked files so we can show diff for new files
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    opts.show_untracked_content(true);

    let is_staged = staged.unwrap_or(false);

    let diff = if is_staged {
        // Staged changes: compare HEAD to index
        let head = repo.head()?.peel_to_tree()?;
        repo.diff_tree_to_index(Some(&head), None, Some(&mut opts))?
    } else {
        // Unstaged changes: compare index to workdir
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };

    let files = parse_diff(&diff)?;

    // If we found the file, return it
    if let Some(file) = files.into_iter().next() {
        return Ok(file);
    }

    // File not found in diff - it might be untracked or have no changes
    // Try to read the file and generate a synthetic diff for new/untracked files
    let full_path = Path::new(&path).join(&file_path);
    if full_path.exists() {
        // Check if file is untracked
        let statuses = repo.statuses(Some(
            git2::StatusOptions::new()
                .pathspec(&file_path)
                .include_untracked(true)
                .recurse_untracked_dirs(true),
        ))?;

        for entry in statuses.iter() {
            if let Some(entry_path) = entry.path() {
                if entry_path == file_path {
                    let status = entry.status();
                    if status.is_wt_new() || status.is_index_new() {
                        // It's a new/untracked file - generate diff from file content
                        return generate_new_file_diff(&full_path, &file_path);
                    }
                }
            }
        }
    }

    Err(crate::error::LeviathanError::OperationFailed(format!(
        "File '{}' not found in diff",
        file_path
    )))
}

/// Generate a diff for a new/untracked file (entire content as additions)
fn generate_new_file_diff(full_path: &Path, file_path: &str) -> Result<DiffFile> {
    let content = std::fs::read_to_string(full_path).map_err(|e| {
        crate::error::LeviathanError::OperationFailed(format!("Failed to read file: {}", e))
    })?;

    let lines: Vec<DiffLine> = content
        .lines()
        .enumerate()
        .map(|(i, line)| DiffLine {
            origin: DiffLineOrigin::Addition,
            content: line.to_string(),
            old_line_no: None,
            new_line_no: Some((i + 1) as u32),
        })
        .collect();

    let additions = lines.len();

    let hunk = DiffHunk {
        header: format!("@@ -0,0 +1,{} @@", additions),
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: additions as u32,
        lines,
    };

    let is_image = is_image_file(file_path);
    let image_type = get_image_type(file_path);

    Ok(DiffFile {
        path: file_path.to_string(),
        old_path: None,
        status: FileStatus::New,
        hunks: vec![hunk],
        is_binary: false,
        is_image,
        image_type,
        additions,
        deletions: 0,
    })
}

fn parse_diff(diff: &git2::Diff) -> Result<Vec<DiffFile>> {
    let mut files: Vec<DiffFile> = Vec::new();

    diff.print(git2::DiffFormat::Patch, |delta, hunk, line| {
        let file_path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        // Find or create file entry
        let file_entry = if let Some(entry) = files.iter_mut().find(|f| f.path == file_path) {
            entry
        } else {
            let status = match delta.status() {
                git2::Delta::Added => FileStatus::New,
                git2::Delta::Deleted => FileStatus::Deleted,
                git2::Delta::Modified => FileStatus::Modified,
                git2::Delta::Renamed => FileStatus::Renamed,
                git2::Delta::Copied => FileStatus::Copied,
                git2::Delta::Typechange => FileStatus::Typechange,
                _ => FileStatus::Modified,
            };

            let is_image = is_image_file(&file_path);
            let image_type = get_image_type(&file_path);
            // Override binary detection for known text file extensions
            // (git may flag UTF-16 or files with long lines as binary)
            let is_binary = delta.flags().is_binary() && !is_known_text_extension(&file_path);

            files.push(DiffFile {
                path: file_path.clone(),
                old_path: delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().to_string()),
                status,
                hunks: Vec::new(),
                is_binary,
                is_image,
                image_type,
                additions: 0,
                deletions: 0,
            });

            files.last_mut().unwrap()
        };

        // Handle hunk header
        if let Some(hunk) = hunk {
            let header = String::from_utf8_lossy(hunk.header()).to_string();

            // Check if this hunk already exists
            let hunk_exists = file_entry.hunks.iter().any(|h| h.header == header);

            if !hunk_exists {
                file_entry.hunks.push(DiffHunk {
                    header,
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    lines: Vec::new(),
                });
            }
        }

        // Handle line
        let origin = line.origin();
        let content = String::from_utf8_lossy(line.content()).to_string();

        let line_origin = DiffLineOrigin::from(origin);

        match origin {
            '+' => file_entry.additions += 1,
            '-' => file_entry.deletions += 1,
            _ => {}
        }

        if let Some(hunk) = file_entry.hunks.last_mut() {
            hunk.lines.push(DiffLine {
                content,
                origin: line_origin,
                old_line_no: line.old_lineno(),
                new_line_no: line.new_lineno(),
            });
        }

        true
    })?;

    Ok(files)
}

/// A file entry in a commit (simplified, without diff hunks)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileEntry {
    pub path: String,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
}

/// Get list of files changed in a commit
#[command]
pub async fn get_commit_files(path: String, commit_oid: String) -> Result<Vec<CommitFileEntry>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let commit = repo.find_commit(git2::Oid::from_str(&commit_oid)?)?;

    let parent = commit.parent(0).ok();
    let parent_tree = parent.as_ref().map(|p| p.tree()).transpose()?;
    let commit_tree = commit.tree()?;

    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None)?;

    // First pass: collect file info
    let mut files: Vec<CommitFileEntry> = Vec::new();
    for delta in diff.deltas() {
        let file_path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            git2::Delta::Added => FileStatus::New,
            git2::Delta::Deleted => FileStatus::Deleted,
            git2::Delta::Modified => FileStatus::Modified,
            git2::Delta::Renamed => FileStatus::Renamed,
            git2::Delta::Copied => FileStatus::Copied,
            git2::Delta::Typechange => FileStatus::Typechange,
            _ => FileStatus::Modified,
        };

        files.push(CommitFileEntry {
            path: file_path,
            status,
            additions: 0,
            deletions: 0,
        });
    }

    // Second pass: count additions/deletions
    let stats = diff.stats()?;
    for i in 0..stats.files_changed() {
        if i < files.len() {
            // Get stats for this file from the diff
            if let Some(patch) = git2::Patch::from_diff(&diff, i).ok().flatten() {
                let (_, additions, deletions) = patch.line_stats()?;
                files[i].additions = additions;
                files[i].deletions = deletions;
            }
        }
    }

    Ok(files)
}

/// Stats for a single commit
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitStats {
    pub oid: String,
    pub additions: usize,
    pub deletions: usize,
    pub files_changed: usize,
}

/// Get stats (additions/deletions) for multiple commits in bulk
/// This is optimized for the graph view to show commit sizes
#[command]
pub async fn get_commits_stats(path: String, commit_oids: Vec<String>) -> Result<Vec<CommitStats>> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let mut results = Vec::with_capacity(commit_oids.len());
    let mut skipped_oid_parse = 0;
    let mut skipped_commit_find = 0;
    let mut skipped_tree = 0;
    let mut skipped_diff = 0;
    let mut skipped_stats = 0;
    let mut zero_stats = 0;

    for oid_str in &commit_oids {
        let oid = match git2::Oid::from_str(oid_str) {
            Ok(o) => o,
            Err(_) => {
                skipped_oid_parse += 1;
                continue;
            }
        };

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => {
                skipped_commit_find += 1;
                continue;
            }
        };

        let parent = commit.parent(0).ok();
        let parent_tree = parent.as_ref().and_then(|p| p.tree().ok());
        let commit_tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => {
                skipped_tree += 1;
                continue;
            }
        };

        let diff = match repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None) {
            Ok(d) => d,
            Err(_) => {
                skipped_diff += 1;
                continue;
            }
        };

        let (additions, deletions, files_changed) = match diff.stats() {
            Ok(s) => (s.insertions(), s.deletions(), s.files_changed()),
            Err(e) => {
                // Stats can fail for binary-only diffs or very large diffs
                // Return 0/0/0 instead of skipping to avoid missing commits
                tracing::debug!("get_commits_stats: stats failed for {}: {}", oid_str, e);
                skipped_stats += 1;
                (0, 0, 0)
            }
        };

        // Track commits with zero stats (may be merge commits or empty commits)
        if additions == 0 && deletions == 0 && files_changed == 0 {
            zero_stats += 1;
        }

        results.push(CommitStats {
            oid: oid_str.clone(),
            additions,
            deletions,
            files_changed,
        });
    }

    let total_skipped = skipped_oid_parse + skipped_commit_find + skipped_tree + skipped_diff + skipped_stats;
    if total_skipped > 0 || zero_stats > 0 {
        tracing::warn!(
            "get_commits_stats: processed {}/{} commits for {}. Skipped: oid_parse={}, commit_find={}, tree={}, diff={}, stats={}. Zero stats: {}",
            results.len(),
            commit_oids.len(),
            path,
            skipped_oid_parse,
            skipped_commit_find,
            skipped_tree,
            skipped_diff,
            skipped_stats,
            zero_stats
        );
    }

    Ok(results)
}

/// Get diff for a specific file in a commit
#[command]
pub async fn get_commit_file_diff(
    path: String,
    commit_oid: String,
    file_path: String,
) -> Result<DiffFile> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let commit = repo.find_commit(git2::Oid::from_str(&commit_oid)?)?;

    let parent = commit.parent(0).ok();
    let parent_tree = parent.as_ref().map(|p| p.tree()).transpose()?;
    let commit_tree = commit.tree()?;

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(&file_path);

    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), Some(&mut opts))?;

    let files = parse_diff(&diff)?;
    files.into_iter().next().ok_or_else(|| {
        crate::error::LeviathanError::OperationFailed("File not found in commit".to_string())
    })
}

/// A single line of blame output
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line_number: usize,
    pub content: String,
    pub commit_oid: String,
    pub commit_short_id: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub summary: String,
    pub is_boundary: bool,
}

/// Blame result for a file
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameResult {
    pub path: String,
    pub lines: Vec<BlameLine>,
}

/// Get blame information for a file
#[command]
pub async fn get_file_blame(
    path: String,
    file_path: String,
    commit_oid: Option<String>,
) -> Result<BlameResult> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut blame_opts = git2::BlameOptions::new();

    // If a specific commit is provided, blame up to that commit
    if let Some(ref oid_str) = commit_oid {
        let oid = git2::Oid::from_str(oid_str)?;
        blame_opts.newest_commit(oid);
    }

    let blame = repo.blame_file(Path::new(&file_path), Some(&mut blame_opts))?;

    // Read the file content
    let file_content = if let Some(ref oid_str) = commit_oid {
        // Read from specific commit
        let commit = repo.find_commit(git2::Oid::from_str(oid_str)?)?;
        let tree = commit.tree()?;
        let entry = tree.get_path(Path::new(&file_path))?;
        let blob = repo.find_blob(entry.id())?;
        String::from_utf8_lossy(blob.content()).to_string()
    } else {
        // Read from working directory
        let full_path = Path::new(&path).join(&file_path);
        std::fs::read_to_string(full_path).unwrap_or_default()
    };

    let content_lines: Vec<&str> = file_content.lines().collect();
    let mut lines = Vec::new();

    for (i, line_content) in content_lines.iter().enumerate() {
        let line_num = i + 1;

        if let Some(hunk) = blame.get_line(line_num) {
            let commit_id = hunk.final_commit_id();
            let short_id = commit_id.to_string()[..7].to_string();

            // Get commit details
            let (author_name, author_email, timestamp, summary) =
                if let Ok(commit) = repo.find_commit(commit_id) {
                    let author = commit.author();
                    (
                        author.name().unwrap_or("Unknown").to_string(),
                        author.email().unwrap_or("").to_string(),
                        author.when().seconds(),
                        commit.summary().unwrap_or("").to_string(),
                    )
                } else {
                    ("Unknown".to_string(), "".to_string(), 0, "".to_string())
                };

            lines.push(BlameLine {
                line_number: line_num,
                content: line_content.to_string(),
                commit_oid: commit_id.to_string(),
                commit_short_id: short_id,
                author_name,
                author_email,
                timestamp,
                summary,
                is_boundary: hunk.is_boundary(),
            });
        }
    }

    Ok(BlameResult {
        path: file_path,
        lines,
    })
}

/// Image version data for comparison
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageVersions {
    pub path: String,
    pub old_data: Option<String>,
    pub new_data: Option<String>,
    pub old_size: Option<(u32, u32)>,
    pub new_size: Option<(u32, u32)>,
    pub image_type: Option<String>,
}

/// Get base64-encoded image data for old and new versions of a file
#[command]
pub async fn get_image_versions(
    path: String,
    file_path: String,
    staged: Option<bool>,
    commit_oid: Option<String>,
) -> Result<ImageVersions> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let is_staged = staged.unwrap_or(false);

    let image_type = get_image_type(&file_path);

    // Get old version (from HEAD or parent commit)
    let old_data = if let Some(ref oid_str) = commit_oid {
        // For commit diff, get from parent
        let commit = repo.find_commit(git2::Oid::from_str(oid_str)?)?;
        if let Ok(parent) = commit.parent(0) {
            get_blob_base64(&repo, &parent.tree()?, &file_path)
        } else {
            None
        }
    } else if is_staged {
        // For staged changes, old is from HEAD
        if let Ok(head) = repo.head() {
            if let Ok(tree) = head.peel_to_tree() {
                get_blob_base64(&repo, &tree, &file_path)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        // For unstaged changes, old is from index
        if let Ok(index) = repo.index() {
            if let Some(entry) = index.get_path(Path::new(&file_path), 0) {
                if let Ok(blob) = repo.find_blob(entry.id) {
                    Some(STANDARD.encode(blob.content()))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    // Get new version
    let new_data = if let Some(ref oid_str) = commit_oid {
        // For commit diff, get from commit tree
        let commit = repo.find_commit(git2::Oid::from_str(oid_str)?)?;
        get_blob_base64(&repo, &commit.tree()?, &file_path)
    } else {
        // For working directory changes, read from disk
        let full_path = Path::new(&path).join(&file_path);
        if full_path.exists() {
            std::fs::read(&full_path)
                .ok()
                .map(|data| STANDARD.encode(&data))
        } else {
            None
        }
    };

    Ok(ImageVersions {
        path: file_path,
        old_data,
        new_data,
        old_size: None, // Size detection would require image parsing
        new_size: None,
        image_type,
    })
}

/// Get base64-encoded blob content from a tree
fn get_blob_base64(repo: &git2::Repository, tree: &git2::Tree, file_path: &str) -> Option<String> {
    let entry = tree.get_path(Path::new(file_path)).ok()?;
    let blob = repo.find_blob(entry.id()).ok()?;
    Some(STANDARD.encode(blob.content()))
}
