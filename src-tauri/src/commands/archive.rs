//! Archive command handlers
//! Export repository snapshots as zip/tar archives

use std::io::Write;
use std::path::Path;
use tauri::command;

use crate::error::{LeviathanError, Result};

/// Supported archive formats
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveFormat {
    Zip,
    Tar,
    TarGz,
}

/// Create an archive of the repository at a given commit/ref
#[command]
pub async fn create_archive(
    path: String,
    output_path: String,
    tree_ref: Option<String>,
    format: Option<String>,
    prefix: Option<String>,
) -> Result<String> {
    let repo = git2::Repository::open(Path::new(&path))?;

    // Resolve the reference to a tree
    let ref_str = tree_ref.as_deref().unwrap_or("HEAD");
    let obj = repo.revparse_single(ref_str)?;
    let tree = obj.peel_to_tree().map_err(|_| {
        LeviathanError::OperationFailed(format!("Cannot resolve '{}' to a tree", ref_str))
    })?;

    let format_str = format.as_deref().unwrap_or("zip");
    let archive_format = match format_str {
        "zip" => ArchiveFormat::Zip,
        "tar" => ArchiveFormat::Tar,
        "tar.gz" | "tgz" => ArchiveFormat::TarGz,
        _ => {
            return Err(LeviathanError::OperationFailed(format!(
                "Unsupported archive format: {}",
                format_str
            )))
        }
    };

    let prefix_str = prefix.unwrap_or_default();

    match archive_format {
        ArchiveFormat::Zip => create_zip_archive(&repo, &tree, &output_path, &prefix_str)?,
        ArchiveFormat::Tar => create_tar_archive(&repo, &tree, &output_path, &prefix_str, false)?,
        ArchiveFormat::TarGz => create_tar_archive(&repo, &tree, &output_path, &prefix_str, true)?,
    }

    Ok(output_path)
}

fn create_zip_archive(
    repo: &git2::Repository,
    tree: &git2::Tree,
    output_path: &str,
    prefix: &str,
) -> Result<()> {
    let file = std::fs::File::create(output_path)?;
    let mut zip = zip::ZipWriter::new(file);

    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            let file_path = if dir.is_empty() {
                entry.name().unwrap_or("").to_string()
            } else {
                format!("{}{}", dir, entry.name().unwrap_or(""))
            };

            let archive_path = if prefix.is_empty() {
                file_path
            } else {
                format!("{}/{}", prefix, file_path)
            };

            if let Ok(blob) = repo.find_blob(entry.id()) {
                let _ = zip.start_file(&archive_path, options);
                let _ = zip.write_all(blob.content());
            }
        }
        git2::TreeWalkResult::Ok
    })?;

    zip.finish()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to finalize zip: {}", e)))?;

    Ok(())
}

fn create_tar_archive(
    repo: &git2::Repository,
    tree: &git2::Tree,
    output_path: &str,
    prefix: &str,
    gzip: bool,
) -> Result<()> {
    let file = std::fs::File::create(output_path)?;

    if gzip {
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut tar = tar::Builder::new(encoder);
        write_tree_to_tar(repo, tree, &mut tar, prefix)?;
        let encoder = tar.into_inner()?;
        encoder.finish()?;
    } else {
        let mut tar = tar::Builder::new(file);
        write_tree_to_tar(repo, tree, &mut tar, prefix)?;
        tar.finish()?;
    }

    Ok(())
}

fn write_tree_to_tar<W: Write>(
    repo: &git2::Repository,
    tree: &git2::Tree,
    tar: &mut tar::Builder<W>,
    prefix: &str,
) -> Result<()> {
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            let file_path = if dir.is_empty() {
                entry.name().unwrap_or("").to_string()
            } else {
                format!("{}{}", dir, entry.name().unwrap_or(""))
            };

            let archive_path = if prefix.is_empty() {
                file_path
            } else {
                format!("{}/{}", prefix, file_path)
            };

            if let Ok(blob) = repo.find_blob(entry.id()) {
                let content = blob.content();
                let mut header = tar::Header::new_gnu();
                header.set_size(content.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();

                let _ = tar.append_data(&mut header, &archive_path, content);
            }
        }
        git2::TreeWalkResult::Ok
    })?;

    Ok(())
}

/// Get list of files that would be included in the archive
#[command]
pub async fn get_archive_files(path: String, tree_ref: Option<String>) -> Result<Vec<String>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let ref_str = tree_ref.as_deref().unwrap_or("HEAD");
    let obj = repo.revparse_single(ref_str)?;
    let tree = obj.peel_to_tree().map_err(|_| {
        LeviathanError::OperationFailed(format!("Cannot resolve '{}' to a tree", ref_str))
    })?;

    let mut files = Vec::new();

    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            let file_path = if dir.is_empty() {
                entry.name().unwrap_or("").to_string()
            } else {
                format!("{}{}", dir, entry.name().unwrap_or(""))
            };
            files.push(file_path);
        }
        git2::TreeWalkResult::Ok
    })?;

    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    #[tokio::test]
    async fn test_create_zip_archive() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit(
            "Add files",
            &[
                ("src/main.rs", "fn main() {}"),
                ("Cargo.toml", "[package]\nname = \"test\""),
            ],
        );

        let output = repo.path.join("archive.zip");
        let result = create_archive(
            repo.path_str(),
            output.to_string_lossy().to_string(),
            None,
            Some("zip".to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
        assert!(output.exists());
        assert!(std::fs::metadata(&output).unwrap().len() > 0);
    }

    #[tokio::test]
    async fn test_create_tar_archive() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add files", &[("file.txt", "content")]);

        let output = repo.path.join("archive.tar");
        let result = create_archive(
            repo.path_str(),
            output.to_string_lossy().to_string(),
            None,
            Some("tar".to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
        assert!(output.exists());
    }

    #[tokio::test]
    async fn test_create_tar_gz_archive() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add files", &[("file.txt", "content")]);

        let output = repo.path.join("archive.tar.gz");
        let result = create_archive(
            repo.path_str(),
            output.to_string_lossy().to_string(),
            None,
            Some("tar.gz".to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
        assert!(output.exists());
    }

    #[tokio::test]
    async fn test_create_archive_with_prefix() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add file", &[("file.txt", "content")]);

        let output = repo.path.join("prefixed.zip");
        let result = create_archive(
            repo.path_str(),
            output.to_string_lossy().to_string(),
            None,
            Some("zip".to_string()),
            Some("myproject-v1.0".to_string()),
        )
        .await;

        assert!(result.is_ok());
        assert!(output.exists());
    }

    #[tokio::test]
    async fn test_create_archive_at_specific_ref() {
        let repo = TestRepo::with_initial_commit();
        let first_oid = repo.head_oid();
        repo.create_commit("Second commit", &[("new.txt", "new content")]);

        let output = repo.path.join("at-ref.zip");
        let result = create_archive(
            repo.path_str(),
            output.to_string_lossy().to_string(),
            Some(first_oid.to_string()),
            Some("zip".to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_archive_files() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit(
            "Add files",
            &[("src/main.rs", "fn main() {}"), ("README.md", "# Hello")],
        );

        let result = get_archive_files(repo.path_str(), None).await;
        assert!(result.is_ok());
        let files = result.unwrap();
        assert!(files.len() >= 3); // README.md, src/main.rs, + initial
    }

    #[tokio::test]
    async fn test_create_archive_invalid_format() {
        let repo = TestRepo::with_initial_commit();
        let output = repo.path.join("bad.format");

        let result = create_archive(
            repo.path_str(),
            output.to_string_lossy().to_string(),
            None,
            Some("invalid".to_string()),
            None,
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_archive_invalid_ref() {
        let repo = TestRepo::with_initial_commit();
        let output = repo.path.join("bad-ref.zip");

        let result = create_archive(
            repo.path_str(),
            output.to_string_lossy().to_string(),
            Some("nonexistent-ref".to_string()),
            Some("zip".to_string()),
            None,
        )
        .await;

        assert!(result.is_err());
    }
}
