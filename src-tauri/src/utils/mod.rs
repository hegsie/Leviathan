//! Utility modules

pub mod cli_safety;
mod command;

pub use cli_safety::reject_flag_like;
pub use command::{apply_token_credentials, create_command};

/// True when `dir`, or ANY directory beneath it, holds a `.git` entry.
///
/// `git clean -fd` skips a nested repository at any depth — it needs a second
/// `-f` to cross that line. Checking only `dir/.git` matched the selected
/// directory alone, so an untracked `build/` containing `build/vendor/lib/.git`
/// was reported as an ordinary directory, included in Select-all, and
/// `remove_dir_all`'d — destroying a repository's objects, refs and unpushed
/// commits with no confirmation naming it and nothing recoverable anywhere.
///
/// Does not descend INTO a nested repo once found, and stops at the first hit.
pub fn contains_nested_repo(dir: &std::path::Path) -> bool {
    if dir.join(".git").exists() {
        return true;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        // symlink_metadata: never follow a symlink out of the tree.
        let Ok(meta) = entry.path().symlink_metadata() else {
            continue;
        };
        if meta.is_dir() && contains_nested_repo(&entry.path()) {
            return true;
        }
    }
    false
}
