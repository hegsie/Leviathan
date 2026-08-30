//! Commands handed to git through `GIT_SEQUENCE_EDITOR` and `GIT_EDITOR`.
//!
//! Git evaluates both variables through a shell — the POSIX shell bundled with
//! Git for Windows, never cmd.exe — and appends the file it wants edited as the
//! final argument. Handing it a command directly is what lets every rebase flow
//! skip writing a `.bat`/`.sh` editor script to disk: those needed a separate
//! per-platform body, a chmod, a fixed name two concurrent rebases fought over,
//! a cleanup pass every early return skipped, and an exec (on Linux, exec of a
//! file another process still holds open for writing fails with ETXTBSY).

use std::path::Path;

/// Wrap `value` in single quotes for the shell git runs editor commands with.
///
/// Single quotes are the only shell quoting that takes its contents literally,
/// so a path containing `$`, a backtick or a double quote survives intact. The
/// replacement closes the quote, escapes one apostrophe, and reopens it.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Render `path` the way the shell git uses can open it.
fn shell_path(path: &Path, windows: bool) -> String {
    let rendered = path.to_string_lossy();
    if windows {
        // That shell is POSIX even though the path is not: it hands the
        // argument to a POSIX `cp`, which reads `C:\dir\file` as one segment.
        rendered.replace('\\', "/")
    } else {
        rendered.into_owned()
    }
}

/// An editor command that overwrites the file git passes it with `source`.
pub fn copy_file_editor_command(source: &Path) -> String {
    copy_file_editor_command_for(source, cfg!(target_os = "windows"))
}

fn copy_file_editor_command_for(source: &Path, windows: bool) -> String {
    format!("cp -- {}", shell_quote(&shell_path(source, windows)))
}

/// The `git` options a `rebase -i` must carry for
/// `todo_action_editor_command`'s pattern to match the todo git writes.
///
/// That pattern is anchored on the literal word `pick` and a 7-character
/// abbreviation, and BOTH are user-configurable. With
/// `rebase.abbreviateCommands=true` git writes `p abc1234 subject`; with
/// `core.abbrev=6` it writes `pick abc123 subject`. Either way the sed matches
/// nothing, git replays every commit as a plain `pick` and exits 0 — so the
/// caller sees a successful rebase that did not do the one thing it was for:
/// a reword silently keeps the old message, and a date edit amends the
/// DESCENDANT the completed rebase left at HEAD.
///
/// `core.abbrev=7` is a floor rather than an exact width — git lengthens an
/// abbreviation that would be ambiguous, and the pattern matches on prefix —
/// so pinning it keeps the match correct rather than merely likely.
pub const TODO_FORMAT_ARGS: [&str; 4] = [
    "-c",
    "rebase.abbreviateCommands=false",
    "-c",
    "core.abbrev=7",
];

/// A `GIT_SEQUENCE_EDITOR` command that rewrites the `pick` line for
/// `short_oid` to `action`, leaving every other line of the todo alone.
///
/// The `rebase -i` it is handed to must also carry [`TODO_FORMAT_ARGS`], which
/// pins the two config settings this pattern assumes.
pub fn todo_action_editor_command(short_oid: &str, action: &str) -> String {
    format!(
        "sed -i.bak -e {}",
        shell_quote(&format!("s/^pick {}/{} {}/", short_oid, action, short_oid))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_command_quotes_windows_paths() {
        assert_eq!(
            copy_file_editor_command_for(Path::new(r"C:\Temp Dir\O'Brien\rebase todo"), true),
            "cp -- 'C:/Temp Dir/O'\\''Brien/rebase todo'",
            "Windows separators, spaces, and apostrophes must be shell-safe"
        );
    }

    #[test]
    fn copy_command_quotes_unix_paths() {
        assert_eq!(
            copy_file_editor_command_for(Path::new("/tmp/Temp Dir/O'Brien/rebase todo"), false),
            "cp -- '/tmp/Temp Dir/O'\\''Brien/rebase todo'",
            "Unix spaces and apostrophes must be shell-safe"
        );
    }

    /// A repository directory may legitimately contain `$` or a double quote.
    /// The editor scripts this replaces interpolated the path into a
    /// DOUBLE-quoted `cp`, so the shell expanded `$po` to nothing and the copy
    /// read a path that was not there.
    #[test]
    fn copy_command_does_not_let_the_shell_expand_the_path() {
        let command = copy_file_editor_command_for(Path::new("/tmp/re$po \"x\"/MSG"), false);
        assert_eq!(
            command, "cp -- '/tmp/re$po \"x\"/MSG'",
            "`$po` must reach cp verbatim rather than being expanded away"
        );
    }

    #[test]
    fn todo_action_command_rewrites_only_the_targeted_pick() {
        assert_eq!(
            todo_action_editor_command("abc1234", "reword"),
            "sed -i.bak -e 's/^pick abc1234/reword abc1234/'"
        );
        assert_eq!(
            todo_action_editor_command("abc1234", "edit"),
            "sed -i.bak -e 's/^pick abc1234/edit abc1234/'"
        );
    }

    /// The same command has to run on Windows, so it must not be a path to a
    /// script file the way the `.bat` it replaces was.
    #[test]
    fn todo_action_command_is_platform_independent() {
        let command = todo_action_editor_command("abc1234", "edit");
        assert!(!command.contains(".bat"), "{command}");
        assert!(!command.contains("powershell"), "{command}");
    }
}
