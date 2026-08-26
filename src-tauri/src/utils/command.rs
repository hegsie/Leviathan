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

/// The credential context a token may be spent on: `scheme://host[:port]`,
/// with any userinfo and path stripped so the scope matches every request to
/// that host.
///
/// `None` for anything that is not an http(s) URL. An SSH or local remote never
/// asks `git credential` for a password, so there is nothing to scope — and
/// emitting the helper anyway would only widen where the token can go.
fn credential_scope(remote_url: &str) -> Option<String> {
    let (scheme, rest) = remote_url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return None;
    }

    // Authority only: git requires a path in the config URL to match the
    // request's path, so including it would stop the helper from ever firing.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // Likewise a username in the config URL has to match the request's, and
    // git-lfs does not necessarily send one.
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    if host.is_empty() {
        return None;
    }

    Some(format!("{}://{}", scheme, host.to_ascii_lowercase()))
}

/// Feed a token to a `git` child process as a credential helper, the way the
/// git2 paths do with `Cred::userpass_plaintext`.
///
/// The token goes in an env var and the helper reads it from there, so it never
/// appears in the process's argv (readable by every other user on the machine)
/// nor in any config file on disk. The helper is APPENDED via `GIT_CONFIG_*`
/// rather than replacing `credential.helper`: clearing that key would also
/// disable the user's own helper, so a credential it could have supplied — or
/// saved — would be lost.
///
/// The helper is SCOPED to `remote_url`'s host (`credential.<scheme>://<host>`)
/// and not installed as a bare `credential.helper`. A bare one answers every
/// host git asks about, and the host is not always ours to choose: `git lfs`
/// takes its endpoint from `lfs.url` in `.lfsconfig`, a file that is COMMITTED
/// TO THE REPOSITORY, so a hostile repo could point LFS at its own server and
/// collect the user's provider token the moment someone clicked Pull. Scoped,
/// git simply does not run the helper for a host that is not the remote's, and
/// the pull fails to authenticate instead of leaking.
///
/// A blank token, or a remote the token cannot be spent on, is ignored.
/// Installing a helper that answers with an empty password would shadow a real
/// failure with a rejected login, giving the user a wronger error than no token
/// at all.
///
/// Owns `GIT_CONFIG_*` index 0; no other caller may set it on the same child.
pub fn apply_token_credentials(cmd: &mut Command, token: &str, remote_url: &str) {
    if token.trim().is_empty() {
        return;
    }

    let Some(scope) = credential_scope(remote_url) else {
        return;
    };

    cmd.env("LEVIATHAN_GIT_TOKEN", token);
    cmd.env("GIT_CONFIG_COUNT", "1");
    cmd.env("GIT_CONFIG_KEY_0", format!("credential.{}.helper", scope));
    // `git` as the username matches the git2 path's fallback; every provider we
    // support authenticates a token as the password and ignores the username.
    cmd.env(
        "GIT_CONFIG_VALUE_0",
        "!f() { echo username=git; echo \"password=$LEVIATHAN_GIT_TOKEN\"; }; f",
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credential_scope_keeps_scheme_and_host() {
        assert_eq!(
            credential_scope("https://github.com/o/r.git").as_deref(),
            Some("https://github.com")
        );
        assert_eq!(
            credential_scope("https://git.example.co.uk:8443/o/r.git").as_deref(),
            Some("https://git.example.co.uk:8443"),
            "a non-default port is part of the credential context"
        );
        assert_eq!(
            credential_scope("http://localhost:3000/o/r.git").as_deref(),
            Some("http://localhost:3000")
        );
    }

    #[test]
    fn test_credential_scope_drops_userinfo_and_path() {
        // git only runs a scoped helper when the config URL's username and path
        // match the request's; git-lfs sends neither, so keeping them would
        // silently stop the helper from ever firing.
        assert_eq!(
            credential_scope("https://someone@github.com/o/r.git").as_deref(),
            Some("https://github.com")
        );
        assert_eq!(
            credential_scope("https://GitHub.COM/O/R.git").as_deref(),
            Some("https://github.com"),
            "hosts are case-insensitive; git normalises them to lower case"
        );
    }

    #[test]
    fn test_credential_scope_rejects_non_http_remotes() {
        for url in [
            "git@github.com:o/r.git",
            "ssh://git@github.com/o/r.git",
            "file:///srv/repos/r.git",
            "/srv/repos/r.git",
            "https://",
            "",
        ] {
            assert_eq!(credential_scope(url), None, "{} must not be scoped", url);
        }
    }

    #[test]
    fn test_apply_token_credentials_scopes_the_helper_to_the_remote_host() {
        let mut cmd = Command::new("git");
        apply_token_credentials(&mut cmd, "s3cr3t", "https://github.com/o/r.git");

        let env: Vec<(String, Option<String>)> = cmd
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().to_string(),
                    v.map(|v| v.to_string_lossy().to_string()),
                )
            })
            .collect();
        let get = |key: &str| {
            env.iter()
                .find(|(k, _)| k == key)
                .and_then(|(_, v)| v.clone())
        };

        assert_eq!(
            get("GIT_CONFIG_KEY_0").as_deref(),
            Some("credential.https://github.com.helper"),
            "an unscoped credential.helper answers for every host, including one \
             a hostile .lfsconfig picked"
        );
        assert_eq!(get("LEVIATHAN_GIT_TOKEN").as_deref(), Some("s3cr3t"));
        // The token must reach git ONLY through the env var: argv is readable
        // by every other user on the machine.
        let helper = get("GIT_CONFIG_VALUE_0").expect("helper must be set");
        assert!(helper.contains("LEVIATHAN_GIT_TOKEN"));
        assert!(!helper.contains("s3cr3t"));
    }

    #[test]
    fn test_apply_token_credentials_ignores_blank_and_unusable_remotes() {
        for (token, url) in [
            ("   ", "https://github.com/o/r.git"),
            ("s3cr3t", "git@github.com:o/r.git"),
            ("s3cr3t", ""),
        ] {
            let mut cmd = Command::new("git");
            apply_token_credentials(&mut cmd, token, url);
            assert_eq!(
                cmd.get_envs().count(),
                0,
                "token {:?} on {:?} must install nothing",
                token,
                url
            );
        }
    }
}
