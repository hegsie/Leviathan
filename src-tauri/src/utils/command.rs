//! Command utilities for cross-platform process spawning
//!
//! This module provides helpers to create commands that don't show
//! console windows on Windows.

use std::process::Command;

/// Creates a Command with platform-specific settings to hide console windows.
///
/// On Windows, this sets the CREATE_NO_WINDOW flag to prevent CMD popups.
/// On other platforms, it returns a standard Command.
pub fn create_command(program: &str) -> Command {
    let mut cmd = Command::new(program);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000
        // This prevents the console window from appearing
        cmd.creation_flags(0x08000000);
    }

    // Prevent git credential popup dialogs
    if program == "git" {
        cmd.env("GIT_TERMINAL_PROMPT", "0");

        // Every git subprocess in this app has its output PARSED, never shown
        // raw. git translates its porcelain-adjacent strings, so on a localized
        // machine a match like "[would prune]" simply never fires — and the
        // caller concludes nothing happened while the command in fact did the
        // work. bisect.rs, worktree.rs and merge.rs each pinned this locally
        // with a comment saying why; maintenance.rs was missed, which is the
        // hand-enumerated-list failure again. Set once, here, so the next
        // shell-out inherits it.
        cmd.env("LC_ALL", "C");

        // Under test, cut the child off from the developer's (or CI
        // container's) real git config.
        //
        // Several commands read settings by shelling out to `git config
        // --get`, so a test asserting a DEFAULT was really asserting something
        // about whoever's machine it ran on. This container's global gitconfig
        // sets commit.gpgsign=true and a signing key, which made the gpg,
        // signature and jira tests fail here while passing elsewhere. Done in
        // the one factory every git subprocess goes through, rather than at
        // each call site — the sibling isolation for libgit2's own config
        // search path lives in test_utils::isolate_git_config.
        #[cfg(test)]
        {
            cmd.env("GIT_CONFIG_GLOBAL", "/dev/null");
            cmd.env("GIT_CONFIG_SYSTEM", "/dev/null");
            cmd.env("GIT_CONFIG_NOSYSTEM", "1");
        }
    }

    cmd
}

/// Feed a token to a `git` subprocess as a one-shot credential helper.
///
/// `create_command` sets GIT_TERMINAL_PROMPT=0, so a git subprocess that needs
/// HTTPS credentials and has none simply fails — there is no prompt to fall
/// back to. This hands git the token the app already holds, the same way the
/// git2 paths hand it to `Cred::userpass_plaintext`.
///
/// Configured through GIT_CONFIG_* rather than `-c` on purpose: those are
/// ENVIRONMENT variables, so every child git process inherits them. `git
/// submodule update` clones and fetches each submodule in a child process, and
/// a `-c` on the outer command would not reach them.
///
/// This ADDS to the user's credential.helper list rather than replacing it —
/// clearing the list would also disable their own helper, so a token that is
/// wrong or expired could no longer be recovered from the keychain.
pub fn apply_token_credential_helper(cmd: &mut Command, token: &str) {
    cmd.env("LEVIATHAN_GIT_TOKEN", token);
    cmd.env("GIT_CONFIG_COUNT", "1");
    cmd.env("GIT_CONFIG_KEY_0", "credential.helper");
    // `git` as the username matches the git2 path's fallback; every provider we
    // support authenticates a token as the password and ignores the username.
    // The token stays in the environment and never enters the URL, so it cannot
    // leak into .git/config, the reflog, or a git error message.
    cmd.env(
        "GIT_CONFIG_VALUE_0",
        "!f() { echo username=git; echo \"password=$LEVIATHAN_GIT_TOKEN\"; }; f",
    );
}
