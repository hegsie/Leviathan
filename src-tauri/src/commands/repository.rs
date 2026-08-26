//! Repository command handlers

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter};

use crate::error::{LeviathanError, Result};
use crate::models::{Repository, RepositoryState};

/// Progress event payload for clone operations
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub stage: String,
    pub received_objects: usize,
    pub total_objects: usize,
    pub indexed_objects: usize,
    pub received_bytes: usize,
    pub percent: u8,
}

/// Information about a partial clone's filter configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneFilterInfo {
    pub is_partial_clone: bool,
    pub filter: Option<String>,
    pub promisor_remote: Option<String>,
}

/// Open an existing repository
#[command]
pub async fn open_repository(path: String) -> Result<Repository> {
    let path = Path::new(&path);

    if !path.exists() {
        return Err(LeviathanError::RepositoryNotFound(
            path.display().to_string(),
        ));
    }

    let repo = git2::Repository::open(path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let head = repo.head().ok();
    let head_ref = head.as_ref().map(|h| {
        h.shorthand()
            .ok()
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                h.target()
                    .map(|t| t.to_string()[..7].to_string())
                    .unwrap_or_default()
            })
    });
    let detached_head_oid = detached_head_oid(&repo, head.as_ref())?;

    // Detect shallow and partial clone status
    let is_shallow = repo.is_shallow();
    let (is_partial_clone, clone_filter) = detect_partial_clone_status(&repo);

    Ok(Repository {
        path: path.display().to_string(),
        name,
        is_valid: true,
        is_bare: repo.is_bare(),
        head_ref,
        detached_head_oid,
        state: RepositoryState::from(repo.state()),
        is_shallow,
        is_partial_clone,
        clone_filter,
    })
}

/// Validate a clone URL: reject values that could be parsed as a CLI flag, and
/// require a recognizable scheme. This is critical defense against
/// `--upload-pack=`/`--config=` style argument injection when the URL is
/// passed to `git clone`.
fn validate_clone_url(url: &str) -> Result<()> {
    if url.is_empty() {
        return Err(LeviathanError::Custom("Clone URL is empty".into()));
    }
    // Leading-`-` and CR/LF are the universal CLI-safety rejections. Reuse
    // the shared helper so this stays consistent with every other git-CLI
    // entrypoint in the codebase.
    crate::utils::reject_flag_like(url, "Clone URL")?;
    let lower = url.to_ascii_lowercase();
    let has_scheme = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("ssh://")
        || lower.starts_with("git://")
        || lower.starts_with("file://");
    // Accept SCP-style refs of the form `[user@]host:path`. The standard form
    // is `user@host:path` but git also allows the `@` to be omitted
    // (`host:path`). To stay unambiguous on Windows, we explicitly reject
    // values that look like a drive-letter path (`C:/...`, `C:\...`).
    let looks_like_scp = !has_scheme && {
        let first_colon = url.find(':');
        let first_slash = url.find('/');
        match first_colon {
            None => false,
            Some(colon_idx) => {
                // Reject Windows drive-letter paths: single ASCII letter then ':'
                // optionally followed by '/' or '\\'. Treat as a local path,
                // not an SCP URL.
                let drive_letter = colon_idx == 1
                    && url
                        .chars()
                        .next()
                        .map(|c| c.is_ascii_alphabetic())
                        .unwrap_or(false);
                if drive_letter {
                    false
                } else {
                    // host part (before ':') must be non-empty and not contain '/'
                    let host = &url[..colon_idx];
                    // Reject `scheme://` patterns where the char after ':' is
                    // also '/' — that's a URI scheme, not SCP form.
                    let after_colon = url.as_bytes().get(colon_idx + 1).copied();
                    !host.is_empty()
                        && !host.contains('/')
                        && after_colon != Some(b'/')
                        && first_slash.map(|s| s > colon_idx).unwrap_or(true)
                }
            }
        }
    };
    if !has_scheme && !looks_like_scp {
        return Err(LeviathanError::Custom(format!(
            "Unsupported clone URL scheme: {}",
            url
        )));
    }
    Ok(())
}

/// Build the `git clone` invocation used by the CLI fallback path.
///
/// The token is deliberately NOT spliced into the URL. An argv is world
/// readable in the process list for the whole life of the clone, and git
/// echoes the URL back in its own error text, which the clone dialog renders.
/// It is handed to git out of band instead, through a one-shot credential
/// helper that reads it from the child's environment — the same mechanism the
/// force-push path in remote.rs uses. As a side effect the token no longer has
/// to survive URL syntax, so one containing `/`, `@` or `:` works.
#[allow(clippy::too_many_arguments)]
fn build_clone_command(
    url: &str,
    dest: &Path,
    bare: bool,
    branch: Option<&str>,
    depth: Option<u32>,
    filter: Option<&str>,
    single_branch: bool,
    token: Option<&str>,
) -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("clone");

    if let Some(depth_val) = depth {
        cmd.arg("--depth").arg(depth_val.to_string());
    }

    if let Some(filter_spec) = filter {
        cmd.arg("--filter").arg(filter_spec);
    }

    if single_branch {
        cmd.arg("--single-branch");
    }

    if bare {
        cmd.arg("--bare");
    }

    if let Some(branch) = branch {
        cmd.arg("--branch").arg(branch);
    }

    // `--` prevents URL/path from being parsed as a flag
    // (defense against `--upload-pack=` style injection).
    cmd.arg("--");
    cmd.arg(url);
    cmd.arg(dest);

    // Only HTTPS can consume a token; the previous in-URL form was gated the
    // same way, so an ssh:// or git:// clone keeps using the user's own
    // credentials exactly as before.
    if let (Some(token_value), true) = (token, url.starts_with("https://")) {
        cmd.env("LEVIATHAN_CLONE_TOKEN", token_value);
        // Two entries: the empty helper resets the list, so the token the
        // caller gave us wins outright the way in-URL credentials did. Without
        // the reset, a system helper holding a stale credential for the same
        // host would answer first and the clone would fail where it used to
        // succeed. Nothing is set when we have no token, so the user's own
        // helper is untouched on every other clone.
        cmd.env("GIT_CONFIG_COUNT", "2");
        cmd.env("GIT_CONFIG_KEY_0", "credential.helper");
        cmd.env("GIT_CONFIG_VALUE_0", "");
        cmd.env("GIT_CONFIG_KEY_1", "credential.helper");
        // `git` as the username matches the git2 path's fallback; every
        // provider we support authenticates a token as the password and
        // ignores the username.
        cmd.env(
            "GIT_CONFIG_VALUE_1",
            "!f() { echo username=git; echo \"password=$LEVIATHAN_CLONE_TOKEN\"; }; f",
        );
    }

    cmd
}

/// Wrap git's stderr in the error the clone dialog displays, with any
/// credentials embedded in a URL stripped first.
fn clone_failed(stderr: &str) -> LeviathanError {
    LeviathanError::Custom(format!(
        "git clone failed: {}",
        crate::commands::credentials::redact_credentials_in_text(stderr.trim())
    ))
}

/// Detect if a repository is a partial clone and extract the filter
fn detect_partial_clone_status(repo: &git2::Repository) -> (bool, Option<String>) {
    let config = match repo.config() {
        Ok(c) => c,
        Err(_) => return (false, None),
    };

    // Check extensions.partialClone
    let has_partial = config.get_bool("extensions.partialClone").unwrap_or(false);

    // Check remote.origin.promisor
    let has_promisor = config.get_bool("remote.origin.promisor").unwrap_or(false);

    if has_partial || has_promisor {
        let filter = config.get_string("remote.origin.partialclonefilter").ok();
        (true, filter)
    } else {
        (false, None)
    }
}

/// The commit a detached HEAD points at — a tag or commit checkout, or an
/// interrupted rebase/bisect. Takes the already-resolved HEAD instead of
/// re-reading it: an unborn HEAD does not resolve, so asking for it again would
/// turn opening a freshly initialised repository into an error.
fn detached_head_oid(
    repo: &git2::Repository,
    head: Option<&git2::Reference<'_>>,
) -> Result<Option<String>> {
    match head {
        Some(head) if repo.head_detached()? => Ok(head.target().map(|oid| oid.to_string())),
        _ => Ok(None),
    }
}

/// Set when the user cancels an in-flight clone.
///
/// A single flag is sufficient: the clone dialog runs one clone at a time and
/// blocks further input while it is in flight. Cleared at the start of every
/// clone so a stale cancellation cannot kill the next one.
static CLONE_CANCELLED: AtomicBool = AtomicBool::new(false);

/// Request cancellation of the in-flight clone.
///
/// Without this a clone against an unreachable host, a hung connection, or an
/// SSH remote waiting on interactive auth left the modal permanently locked —
/// Cancel was disabled and Escape/overlay dismissal was refused, so restarting
/// the app was the only way out.
#[command]
pub async fn cancel_clone() -> Result<()> {
    CLONE_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Clone a repository with progress reporting
#[allow(clippy::too_many_arguments)]
#[command]
pub async fn clone_repository(
    app: AppHandle,
    url: String,
    path: String,
    bare: Option<bool>,
    branch: Option<String>,
    token: Option<String>,
    depth: Option<u32>,
    filter: Option<String>,
    single_branch: Option<bool>,
    timeout_secs: Option<u64>,
) -> Result<Repository> {
    // A cancellation requested against a previous clone must not kill this one.
    CLONE_CANCELLED.store(false, Ordering::SeqCst);

    validate_clone_url(&url)?;
    // `--branch` and `--filter` consume the next argv as their value, so a
    // value starting with `-` is not a flag injection today. We reject them
    // anyway as defense in depth: a future refactor toward
    // `--branch=<value>` style would otherwise re-introduce flag injection.
    if let Some(ref b) = branch {
        if b.starts_with('-') || b.contains('\n') || b.contains('\r') {
            return Err(LeviathanError::Custom(
                "Branch name must not start with '-' or contain newlines".into(),
            ));
        }
    }
    if let Some(ref f) = filter {
        if f.starts_with('-') || f.contains('\n') || f.contains('\r') {
            return Err(LeviathanError::Custom(
                "Filter spec must not start with '-' or contain newlines".into(),
            ));
        }
    }
    let do_clone = async {
        let dest_path = std::path::PathBuf::from(&path);
        let url_clone = url.clone();
        let bare = bare.unwrap_or(false);
        let app_for_progress = app.clone();
        let token_clone = token.clone();

        // Use git CLI when features unsupported by git2 are requested
        let single_branch = single_branch.unwrap_or(false);
        let needs_cli = depth.is_some() || filter.is_some() || single_branch;

        if needs_cli {
            // git2 doesn't support --depth, --filter, or --single-branch, so fall back to git CLI
            let result = tokio::task::spawn_blocking(move || {
                let mut cmd = build_clone_command(
                    &url_clone,
                    &dest_path,
                    bare,
                    branch.as_deref(),
                    depth,
                    filter.as_deref(),
                    single_branch,
                    token_clone.as_deref(),
                );

                // Spawned rather than run to completion so a cancel can kill it.
                // stderr is drained on its own thread: git clone writes progress
                // there, and leaving a piped stream unread deadlocks the child
                // once the pipe buffer fills on a large clone.
                cmd.stdout(std::process::Stdio::null());
                cmd.stderr(std::process::Stdio::piped());

                let mut child = cmd.spawn().map_err(|e| {
                    LeviathanError::Custom(format!("Failed to execute git command: {}", e))
                })?;

                let stderr_pipe = child.stderr.take();
                let stderr_reader = std::thread::spawn(move || {
                    use std::io::Read;
                    // Bytes, not read_to_string: git may emit a non-UTF-8 path or
                    // remote message, and read_to_string aborts on the first
                    // invalid sequence — leaving the pipe undrained (the very
                    // deadlock this thread exists to prevent) and the error lost.
                    let mut buf = Vec::new();
                    if let Some(mut pipe) = stderr_pipe {
                        let _ = pipe.read_to_end(&mut buf);
                    }
                    String::from_utf8_lossy(&buf).into_owned()
                });

                enum CloneOutcome {
                    Finished(std::process::ExitStatus),
                    Cancelled,
                    TimedOut,
                    WaitFailed(String),
                }

                // The timeout is enforced HERE as well as by the outer
                // tokio::time::timeout. That one only drops the future — this
                // blocking task, and the git process it spawned, would keep
                // running unattended after the caller gave up.
                let deadline = timeout_secs
                    .filter(|secs| *secs > 0)
                    .map(|secs| std::time::Instant::now() + std::time::Duration::from_secs(secs));

                let outcome = loop {
                    if CLONE_CANCELLED.load(Ordering::Relaxed) {
                        break CloneOutcome::Cancelled;
                    }

                    if deadline.is_some_and(|d| std::time::Instant::now() >= d) {
                        break CloneOutcome::TimedOut;
                    }

                    match child.try_wait() {
                        Ok(Some(status)) => break CloneOutcome::Finished(status),
                        Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
                        Err(e) => break CloneOutcome::WaitFailed(e.to_string()),
                    }
                };

                // Single exit path for every abnormal outcome: kill the child,
                // join the drain thread, and clear the partial destination.
                // Returning early from any of these without killing would leave
                // an orphaned git process still writing into that directory.
                let status = match outcome {
                    CloneOutcome::Finished(status) => status,
                    abnormal => {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = stderr_reader.join();
                        let _ = std::fs::remove_dir_all(&dest_path);

                        return Err(match abnormal {
                            CloneOutcome::Cancelled => {
                                LeviathanError::Custom("Clone cancelled".to_string())
                            }
                            CloneOutcome::TimedOut => LeviathanError::OperationTimeout(
                                "Clone operation timed out".to_string(),
                            ),
                            CloneOutcome::WaitFailed(e) => {
                                LeviathanError::Custom(format!("Failed to wait for git: {}", e))
                            }
                            CloneOutcome::Finished(_) => unreachable!("handled above"),
                        });
                    }
                };

                let stderr = stderr_reader.join().unwrap_or_default();

                if !status.success() {
                    return Err(clone_failed(&stderr));
                }

                git2::Repository::open(&dest_path).map_err(|e| {
                    LeviathanError::Custom(format!("Failed to open cloned repo: {}", e))
                })
            })
            .await
            .map_err(|e| LeviathanError::Custom(format!("Clone task failed: {}", e)))?;

            let repo = result?;
            let path = Path::new(&path);

            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string());

            let head = repo.head().ok();
            let head_ref = head.as_ref().map(|h| {
                h.shorthand()
                    .ok()
                    .map(|s| s.to_string())
                    .unwrap_or_default()
            });
            let detached_head_oid = detached_head_oid(&repo, head.as_ref())?;

            // Emit completion
            let _ = app.emit(
                "clone-progress",
                CloneProgress {
                    stage: "Complete".to_string(),
                    received_objects: 0,
                    total_objects: 0,
                    indexed_objects: 0,
                    received_bytes: 0,
                    percent: 100,
                },
            );

            let is_shallow = repo.is_shallow();
            let (is_partial_clone, clone_filter) = detect_partial_clone_status(&repo);

            Ok(Repository {
                path: path.display().to_string(),
                name,
                is_valid: true,
                is_bare: repo.is_bare(),
                head_ref,
                detached_head_oid,
                state: RepositoryState::from(repo.state()),
                is_shallow,
                is_partial_clone,
                clone_filter,
            })
        } else {
            // Full clone: use git2 RepoBuilder with progress callbacks
            //
            // Declared out here, not inside the blocking closure: the error arm
            // below needs it, and libgit2 reports a deadline abort as the same
            // generic error a user cancellation produces.
            let timed_out = Arc::new(AtomicBool::new(false));
            let timed_out_cb = Arc::clone(&timed_out);
            let result = tokio::task::spawn_blocking(move || {
                let mut builder = git2::build::RepoBuilder::new();

                if bare {
                    builder.bare(true);
                }

                if let Some(ref branch) = branch {
                    builder.branch(branch);
                }

                // Set up fetch options with credentials and progress callbacks
                let mut fetch_opts = git2::FetchOptions::new();

                // Use CredentialsHelper to get callbacks with authentication support
                let mut callbacks =
                    crate::services::CredentialsHelper::new_with_token(token_clone).get_callbacks();

                // Track last emitted percent to avoid spamming events
                let last_percent = Arc::new(AtomicUsize::new(0));
                let last_percent_clone = Arc::clone(&last_percent);
                let app_clone = app_for_progress;

                let deadline = timeout_secs
                    .filter(|secs| *secs > 0)
                    .map(|secs| std::time::Instant::now() + std::time::Duration::from_secs(secs));

                callbacks.transfer_progress(move |stats| {
                    // Returning false aborts the transfer — the only cancellation
                    // point libgit2 offers.
                    if CLONE_CANCELLED.load(Ordering::Relaxed) {
                        return false;
                    }

                    // Same reason the CLI path polls its own deadline: the outer
                    // tokio::time::timeout only drops the future, so without this
                    // the transfer keeps running after the caller gave up.
                    if deadline.is_some_and(|d| std::time::Instant::now() >= d) {
                        timed_out_cb.store(true, Ordering::Relaxed);
                        return false;
                    }

                    let total = stats.total_objects();
                    let received = stats.received_objects();
                    let indexed = stats.indexed_objects();

                    // Calculate percent (receiving is 0-80%, indexing is 80-100%)
                    let percent = if total == 0 {
                        0
                    } else if received < total {
                        // Receiving phase: 0-80%
                        (received * 80 / total) as u8
                    } else {
                        // Indexing phase: 80-100%
                        80 + (indexed * 20 / total) as u8
                    };

                    // Only emit if percent changed
                    let prev = last_percent_clone.swap(percent as usize, Ordering::Relaxed);
                    if prev != percent as usize {
                        let stage = if received < total {
                            "Receiving objects"
                        } else {
                            "Indexing objects"
                        };

                        let progress = CloneProgress {
                            stage: stage.to_string(),
                            received_objects: received,
                            total_objects: total,
                            indexed_objects: indexed,
                            received_bytes: stats.received_bytes(),
                            percent,
                        };

                        let _ = app_clone.emit("clone-progress", progress);
                    }

                    true
                });

                fetch_opts.remote_callbacks(callbacks);
                builder.fetch_options(fetch_opts);

                builder.clone(&url_clone, &dest_path)
            })
            .await
            .map_err(|e| LeviathanError::Custom(format!("Clone task failed: {}", e)))?;

            let repo = match result {
                Ok(repo) => repo,
                Err(e) => {
                    // libgit2 surfaces a cancelled transfer as a generic error;
                    // report it as the cancellation it was and clear the partial
                    // checkout so a retry does not hit an occupied destination.
                    if CLONE_CANCELLED.load(Ordering::Relaxed) {
                        let _ = std::fs::remove_dir_all(Path::new(&path));
                        return Err(LeviathanError::Custom("Clone cancelled".to_string()));
                    }
                    // A deadline abort leaves exactly the same partial checkout
                    // a cancellation does, and reported it as a bare libgit2
                    // error with the directory still on disk — so the retry the
                    // message invites failed at "destination already exists",
                    // with nothing saying the first attempt had timed out.
                    if timed_out.load(Ordering::Relaxed) {
                        let _ = std::fs::remove_dir_all(Path::new(&path));
                        return Err(LeviathanError::OperationTimeout(
                            "Clone operation timed out".to_string(),
                        ));
                    }
                    return Err(e.into());
                }
            };

            // git runs post-checkout after a clone checks out the initial
            // working tree (old-ref = all-zeros, flag = 1). The shallow/CLI
            // clone path above runs it natively via `git clone`; the git2 path
            // does not, so run it here. Non-blocking.
            if !bare {
                let new_head = crate::commands::hooks::head_oid_string(&repo);
                crate::commands::hooks::run_post_checkout(
                    &repo,
                    crate::commands::hooks::ZERO_OID,
                    &new_head,
                    true,
                );
            }

            let path = Path::new(&path);

            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string());

            let head = repo.head().ok();
            let head_ref = head.as_ref().map(|h| {
                h.shorthand()
                    .ok()
                    .map(|s| s.to_string())
                    .unwrap_or_default()
            });
            let detached_head_oid = detached_head_oid(&repo, head.as_ref())?;

            // Emit completion
            let _ = app.emit(
                "clone-progress",
                CloneProgress {
                    stage: "Complete".to_string(),
                    received_objects: 0,
                    total_objects: 0,
                    indexed_objects: 0,
                    received_bytes: 0,
                    percent: 100,
                },
            );

            Ok(Repository {
                path: path.display().to_string(),
                name,
                is_valid: true,
                is_bare: repo.is_bare(),
                head_ref,
                detached_head_oid,
                state: RepositoryState::from(repo.state()),
                is_shallow: false, // Full clone via git2 is never shallow
                is_partial_clone: false,
                clone_filter: None,
            })
        }
    };

    if let Some(secs) = timeout_secs {
        if secs > 0 {
            match tokio::time::timeout(std::time::Duration::from_secs(secs), do_clone).await {
                Ok(result) => result,
                Err(_) => Err(LeviathanError::OperationTimeout(
                    "Clone operation timed out".to_string(),
                )),
            }
        } else {
            do_clone.await
        }
    } else {
        do_clone.await
    }
}

/// Get clone filter info for a repository (partial clone detection)
#[command]
pub async fn get_clone_filter_info(path: String) -> Result<CloneFilterInfo> {
    let path_clone = path.clone();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&path_clone).map_err(|e| {
            LeviathanError::RepositoryNotFound(format!("Failed to open repository: {}", e))
        })?;

        let config = repo.config().map_err(|e| {
            LeviathanError::Custom(format!("Failed to read repository config: {}", e))
        })?;

        // Check for remote.<name>.promisor = true and remote.<name>.partialclonefilter
        // Git stores partial clone info in the config as:
        //   remote.<name>.promisor = true
        //   remote.<name>.partialclonefilter = <filter-spec>
        // Also check extensions.partialClone for the promisor remote name

        let promisor_remote = config
            .get_string("extensions.partialClone")
            .ok()
            .or_else(|| {
                // Fall back to checking if origin is a promisor remote
                config
                    .get_bool("remote.origin.promisor")
                    .ok()
                    .and_then(|is_promisor| {
                        if is_promisor {
                            Some("origin".to_string())
                        } else {
                            None
                        }
                    })
            });

        let filter = if let Some(ref remote_name) = promisor_remote {
            let key = format!("remote.{}.partialclonefilter", remote_name);
            config.get_string(&key).ok()
        } else {
            None
        };

        let is_partial_clone = promisor_remote.is_some();

        Ok(CloneFilterInfo {
            is_partial_clone,
            filter,
            promisor_remote,
        })
    })
    .await
    .map_err(|e| LeviathanError::Custom(format!("Task failed: {}", e)))?
}

/// List all tracked files in the repository
#[command]
pub async fn list_tracked_files(path: String) -> Result<Vec<String>> {
    let path_clone = path.clone();
    tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&path_clone)
            .arg("ls-files")
            .output()
            .map_err(|e| {
                LeviathanError::Custom(format!("Failed to execute git ls-files: {}", e))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(LeviathanError::Custom(format!(
                "git ls-files failed: {}",
                stderr.trim()
            )));
        }

        let files = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(String::from)
            .collect();
        Ok(files)
    })
    .await
    .map_err(|e| LeviathanError::Custom(format!("Task failed: {}", e)))?
}

/// Initialize a new repository
#[command]
pub async fn init_repository(
    path: String,
    bare: Option<bool>,
    initial_branch: Option<String>,
) -> Result<Repository> {
    let path = Path::new(&path);

    let mut opts = git2::RepositoryInitOptions::new();
    opts.bare(bare.unwrap_or(false));

    // libgit2 writes the initial_head into HEAD verbatim and validates nothing,
    // so a bad name here would produce a repository git itself cannot use.
    // Reject it before anything is created on disk. An absent or blank value
    // leaves initial_head unset so libgit2 keeps honouring the user's
    // `init.defaultBranch` git config.
    if let Some(branch) = initial_branch
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
    {
        // libgit2 only prefixes `refs/heads/` when the name does NOT already
        // start with `refs/` — otherwise it uses it verbatim. Validating
        // `refs/heads/{branch}` unconditionally would therefore check a
        // different ref than the one written: `refs/tags/v1` would pass and
        // then point HEAD outside the branch namespace. Build the exact ref
        // libgit2 will use, require it to be a branch, and pass that.
        let full_ref = if branch.starts_with("refs/") {
            branch.to_string()
        } else {
            format!("refs/heads/{}", branch)
        };
        if !full_ref.starts_with("refs/heads/") || !git2::Reference::is_valid_name(&full_ref) {
            return Err(LeviathanError::Custom(format!(
                "Invalid initial branch name: {}",
                branch
            )));
        }
        opts.initial_head(&full_ref);
    }

    let repo = git2::Repository::init_opts(path, &opts)?;

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    Ok(Repository {
        path: path.display().to_string(),
        name,
        is_valid: true,
        is_bare: repo.is_bare(),
        head_ref: None,
        // A fresh repository's HEAD is unborn, which is not detached.
        detached_head_oid: None,
        state: RepositoryState::Clean,
        is_shallow: false,
        is_partial_clone: false,
        clone_filter: None,
    })
}

/// Get information about the current repository
#[command]
pub async fn get_repository_info(path: String) -> Result<Repository> {
    open_repository(path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;
    use tempfile::TempDir;

    #[test]
    fn test_validate_clone_url_accepts_https_and_ssh_schemes() {
        assert!(validate_clone_url("https://github.com/foo/bar.git").is_ok());
        assert!(validate_clone_url("http://example.com/foo.git").is_ok());
        assert!(validate_clone_url("ssh://git@host/foo.git").is_ok());
        assert!(validate_clone_url("git://host/foo.git").is_ok());
        assert!(validate_clone_url("file:///tmp/repo").is_ok());
    }

    #[test]
    fn test_validate_clone_url_accepts_scp_style() {
        // user@host:path is the canonical SCP form
        assert!(validate_clone_url("git@github.com:foo/bar.git").is_ok());
        // host:path (no user) is also valid git syntax
        assert!(validate_clone_url("server.example.com:repo.git").is_ok());
    }

    #[test]
    fn test_validate_clone_url_rejects_flag_like() {
        assert!(validate_clone_url("--upload-pack=/tmp/evil").is_err());
        assert!(validate_clone_url("-foo").is_err());
    }

    #[test]
    fn test_validate_clone_url_rejects_crlf() {
        assert!(validate_clone_url("https://example.com/\nfoo").is_err());
        assert!(validate_clone_url("https://example.com/\rfoo").is_err());
    }

    #[test]
    fn test_validate_clone_url_rejects_windows_drive_letter() {
        // C:\path is a local Windows path, NOT an SCP URL — must be rejected
        // so we don't accidentally pass it to git as `git clone host:path`.
        assert!(validate_clone_url("C:/Users/me/repo").is_err());
        assert!(validate_clone_url("D:\\repo").is_err());
    }

    #[test]
    fn test_validate_clone_url_rejects_empty_and_unknown_scheme() {
        assert!(validate_clone_url("").is_err());
        assert!(validate_clone_url("ftp://host/foo").is_err());
        // No colon at all → not a recognizable URL form
        assert!(validate_clone_url("plainstring").is_err());
    }

    // ========================================================================
    // build_clone_command / clone_failed: the token must never reach argv
    // ========================================================================

    fn args_of(cmd: &std::process::Command) -> Vec<String> {
        cmd.get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    fn env_of(cmd: &std::process::Command, key: &str) -> Option<String> {
        cmd.get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new(key))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned())
    }

    /// The command line of a running process is readable by every other
    /// process on the machine, so a token spliced into the clone URL is a
    /// plaintext credential leak for the whole life of the clone.
    #[test]
    fn test_build_clone_command_keeps_the_token_out_of_argv() {
        let cmd = build_clone_command(
            "https://github.com/o/r.git",
            Path::new("/tmp/x"),
            false,
            None,
            Some(1),
            None,
            false,
            Some("ghp_s3cret"),
        );

        let args = args_of(&cmd);
        assert!(
            args.iter().all(|a| !a.contains("ghp_s3cret")),
            "token must not appear in argv: {:?}",
            args
        );
        assert!(
            args.iter().all(|a| !a.contains("x-access-token")),
            "userinfo must not appear in argv: {:?}",
            args
        );
        assert!(
            args.contains(&"https://github.com/o/r.git".to_string()),
            "the plain URL must still be passed to git: {:?}",
            args
        );
    }

    /// Keeping the token out of argv is only a fix if the clone still
    /// authenticates: git must receive it out of band, through a credential
    /// helper reading it from the child's environment.
    #[test]
    fn test_build_clone_command_hands_the_token_to_git_through_a_credential_helper() {
        let cmd = build_clone_command(
            "https://github.com/o/r.git",
            Path::new("/tmp/x"),
            false,
            None,
            Some(1),
            None,
            false,
            Some("ghp_s3cret"),
        );

        assert_eq!(
            env_of(&cmd, "LEVIATHAN_CLONE_TOKEN"),
            Some("ghp_s3cret".to_string())
        );
        assert_eq!(env_of(&cmd, "GIT_CONFIG_COUNT"), Some("2".to_string()));
        assert_eq!(
            env_of(&cmd, "GIT_CONFIG_KEY_0"),
            Some("credential.helper".to_string())
        );
        // The empty helper resets the list so a stale system helper cannot
        // answer ahead of the token the caller handed us.
        assert_eq!(env_of(&cmd, "GIT_CONFIG_VALUE_0"), Some(String::new()));
        assert_eq!(
            env_of(&cmd, "GIT_CONFIG_KEY_1"),
            Some("credential.helper".to_string())
        );
        let helper = env_of(&cmd, "GIT_CONFIG_VALUE_1").expect("helper must be configured");
        assert!(
            helper.contains("$LEVIATHAN_CLONE_TOKEN"),
            "helper must read the token from the environment: {}",
            helper
        );
        assert!(
            helper.contains("username=git"),
            "helper must supply a username: {}",
            helper
        );
    }

    /// A token containing URL syntax characters could not survive the splice
    /// into the URL; handing it over out of band means it no longer has to.
    #[test]
    fn test_build_clone_command_handles_a_token_with_url_special_characters() {
        let cmd = build_clone_command(
            "https://github.com/o/r.git",
            Path::new("/tmp/x"),
            false,
            None,
            Some(1),
            None,
            false,
            Some("to/ken@we:ird"),
        );

        let args = args_of(&cmd);
        assert!(
            args.contains(&"https://github.com/o/r.git".to_string()),
            "URL must be passed byte-for-byte: {:?}",
            args
        );
        assert_eq!(
            env_of(&cmd, "LEVIATHAN_CLONE_TOKEN"),
            Some("to/ken@we:ird".to_string())
        );
    }

    /// Guard (passes before and after the fix): the credential.helper reset
    /// must never be set on a clone we have no token for, or it would disable
    /// the user's own helper on an ordinary clone.
    #[test]
    fn test_build_clone_command_sets_no_credential_env_without_a_token() {
        let no_token = build_clone_command(
            "https://github.com/o/r.git",
            Path::new("/tmp/x"),
            false,
            None,
            Some(1),
            None,
            false,
            None,
        );
        assert_eq!(no_token.get_envs().count(), 0);
        assert!(args_of(&no_token).contains(&"https://github.com/o/r.git".to_string()));

        // ssh:// cannot consume an HTTPS token — same gate as the old in-URL form.
        let ssh = build_clone_command(
            "ssh://git@host/o/r.git",
            Path::new("/tmp/x"),
            false,
            None,
            Some(1),
            None,
            false,
            Some("ghp_s3cret"),
        );
        assert_eq!(env_of(&ssh, "LEVIATHAN_CLONE_TOKEN"), None);
        assert_eq!(env_of(&ssh, "GIT_CONFIG_COUNT"), None);
        assert!(args_of(&ssh).contains(&"ssh://git@host/o/r.git".to_string()));
    }

    /// Guard for the extraction: the flags the CLI path exists for, and the
    /// `--` that stops a URL from being read as a flag, must all survive.
    #[test]
    fn test_build_clone_command_still_passes_the_shallow_and_filter_flags() {
        let cmd = build_clone_command(
            "https://github.com/o/r.git",
            Path::new("/tmp/x"),
            true,
            Some("dev"),
            Some(5),
            Some("blob:none"),
            true,
            None,
        );

        assert_eq!(
            args_of(&cmd),
            vec![
                "clone",
                "--depth",
                "5",
                "--filter",
                "blob:none",
                "--single-branch",
                "--bare",
                "--branch",
                "dev",
                "--",
                "https://github.com/o/r.git",
                "/tmp/x",
            ]
        );
    }

    /// git's stderr is rendered verbatim by the clone dialog, so a URL
    /// carrying credentials — one git did not anonymize, or one the user typed
    /// with a password in it — would be displayed on screen.
    #[test]
    fn test_clone_failed_redacts_credentials_from_git_stderr() {
        let err = clone_failed(
            "fatal: unable to access 'https://x-access-token:ghp_s3cret@github.com/o/r.git/': The requested URL returned error: 404",
        );
        let msg = err.to_string();

        assert!(
            msg.contains("git clone failed:"),
            "message must keep its prefix: {}",
            msg
        );
        assert!(!msg.contains("ghp_s3cret"), "token leaked: {}", msg);
        assert!(!msg.contains("x-access-token"), "userinfo leaked: {}", msg);
        assert!(
            msg.contains("github.com/o/r.git"),
            "message must stay diagnostically useful: {}",
            msg
        );
        assert!(
            msg.contains("404"),
            "git's own diagnosis must survive: {}",
            msg
        );
    }

    #[tokio::test]
    async fn test_open_repository_valid() {
        let repo = TestRepo::with_initial_commit();
        let result = open_repository(repo.path_str()).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
        assert!(!repo_info.is_bare);
    }

    #[tokio::test]
    async fn test_open_repository_gets_name() {
        let repo = TestRepo::with_initial_commit();
        let result = open_repository(repo.path_str()).await.unwrap();
        // The name should be the directory name
        assert!(!result.name.is_empty());
        assert_ne!(result.name, "Unknown");
    }

    #[tokio::test]
    async fn test_open_repository_gets_head_ref() {
        let repo = TestRepo::with_initial_commit();
        let result = open_repository(repo.path_str()).await.unwrap();
        // Should have a head ref after initial commit
        assert!(result.head_ref.is_some());
    }

    #[tokio::test]
    async fn test_open_repository_reports_a_detached_head() {
        let repo = TestRepo::with_initial_commit();
        let target = repo.create_commit("Second", &[("a.txt", "a")]);
        repo.repo().set_head_detached(target).unwrap();

        let result = open_repository(repo.path_str()).await.unwrap();

        assert_eq!(result.detached_head_oid, Some(target.to_string()));
        // Why the OID has to be its own field: a detached HEAD's shorthand is
        // the literal "HEAD", which names no commit the UI could show.
        assert_eq!(result.head_ref.as_deref(), Some("HEAD"));
    }

    #[tokio::test]
    async fn test_open_repository_reports_no_detached_head_on_a_branch() {
        let repo = TestRepo::with_initial_commit();

        let result = open_repository(repo.path_str()).await.unwrap();

        assert!(result.detached_head_oid.is_none());
        assert!(result.head_ref.is_some());
    }

    #[tokio::test]
    async fn test_open_repository_unborn_head_is_not_detached() {
        // An unborn HEAD still resolves as a symbolic ref, so it must not be
        // reported as detached — an empty repository is not a tag checkout.
        let repo = TestRepo::new();

        let result = open_repository(repo.path_str()).await.unwrap();

        assert!(result.head_ref.is_none());
        assert!(result.detached_head_oid.is_none());
    }

    #[tokio::test]
    async fn test_open_repository_nonexistent() {
        let result = open_repository("/nonexistent/path/to/repo".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_open_repository_not_a_repo() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let result = open_repository(dir.path().to_string_lossy().to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_init_repository() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("new-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        let result = init_repository(path.to_string_lossy().to_string(), None, None).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
        assert!(!repo_info.is_bare);
        assert_eq!(repo_info.name, "new-repo");

        // Verify .git directory exists
        assert!(path.join(".git").exists());
    }

    #[tokio::test]
    async fn test_init_repository_bare() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("bare-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        let result = init_repository(path.to_string_lossy().to_string(), Some(true), None).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
        assert!(repo_info.is_bare);

        // Bare repos have HEAD directly in the path, no .git directory
        assert!(path.join("HEAD").exists());
    }

    /// Resolve the symbolic target of HEAD (`refs/heads/<name>`) for an
    /// unborn-HEAD repository.
    fn head_symbolic_target(path: &Path) -> String {
        let repo = git2::Repository::open(path).expect("Failed to open repo");
        let head = repo.find_reference("HEAD").expect("HEAD missing");
        head.symbolic_target()
            .expect("HEAD target is not valid UTF-8")
            .expect("HEAD is not symbolic")
            .to_string()
    }

    #[tokio::test]
    async fn test_init_repository_uses_initial_branch() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("new-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        init_repository(
            path.to_string_lossy().to_string(),
            None,
            Some("trunk".to_string()),
        )
        .await
        .expect("init should succeed");

        assert_eq!(head_symbolic_target(&path), "refs/heads/trunk");
    }

    #[tokio::test]
    async fn test_init_repository_bare_uses_initial_branch() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("bare-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        let repo_info = init_repository(
            path.to_string_lossy().to_string(),
            Some(true),
            Some("trunk".to_string()),
        )
        .await
        .expect("init should succeed");

        assert!(repo_info.is_bare);
        assert_eq!(head_symbolic_target(&path), "refs/heads/trunk");
    }

    #[tokio::test]
    async fn test_init_repository_rejects_invalid_initial_branch() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("bad-branch-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        let result = init_repository(
            path.to_string_lossy().to_string(),
            None,
            Some("bad name".to_string()),
        )
        .await;

        let err = result.expect_err("invalid branch name must be rejected");
        assert!(
            err.to_string().contains("Invalid initial branch name"),
            "unexpected error: {}",
            err
        );
        // Validation runs before anything is created on disk.
        assert!(!path.join(".git").exists());
    }

    #[tokio::test]
    async fn test_init_repository_blank_initial_branch_falls_back_to_git_default() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("blank-branch-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        init_repository(
            path.to_string_lossy().to_string(),
            None,
            Some("   ".to_string()),
        )
        .await
        .expect("blank branch name should fall back to git's default");

        // A naive implementation would forward the blank string and write
        // `ref: refs/heads/   ` into HEAD.
        let target = head_symbolic_target(&path);
        assert!(
            target.starts_with("refs/heads/"),
            "unexpected HEAD target: {}",
            target
        );
        let name = &target["refs/heads/".len()..];
        assert!(
            !name.is_empty() && name.trim() == name,
            "bad branch: {name:?}"
        );
    }

    #[tokio::test]
    async fn test_init_repository_rejects_non_branch_ref_as_initial_branch() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("tag-ref-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        // libgit2 uses a `refs/`-prefixed initial_head verbatim, so this would
        // otherwise write `ref: refs/tags/v1` into HEAD and point the new
        // repository at the tag namespace.
        let result = init_repository(
            path.to_string_lossy().to_string(),
            None,
            Some("refs/tags/v1".to_string()),
        )
        .await;

        let err = result.expect_err("a non-branch ref must be rejected");
        assert!(
            err.to_string().contains("Invalid initial branch name"),
            "unexpected error: {}",
            err
        );
        // Validation runs before anything is created on disk.
        assert!(!path.join(".git").exists());
    }

    #[tokio::test]
    async fn test_init_repository_accepts_fully_qualified_branch_ref() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("qualified-branch-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        // A fully qualified branch ref must not be double-prefixed into
        // `refs/heads/refs/heads/trunk`.
        init_repository(
            path.to_string_lossy().to_string(),
            None,
            Some("refs/heads/trunk".to_string()),
        )
        .await
        .expect("a fully qualified branch ref should be accepted");

        assert_eq!(head_symbolic_target(&path), "refs/heads/trunk");
    }

    #[tokio::test]
    async fn test_init_repository_state_is_clean() {
        let dir = TempDir::new().expect("Failed to create temp dir");
        let path = dir.path().join("clean-repo");
        std::fs::create_dir(&path).expect("Failed to create dir");

        let result = init_repository(path.to_string_lossy().to_string(), None, None)
            .await
            .unwrap();
        assert!(matches!(result.state, RepositoryState::Clean));
    }

    #[tokio::test]
    async fn test_get_repository_info() {
        let repo = TestRepo::with_initial_commit();
        let result = get_repository_info(repo.path_str()).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
    }

    #[tokio::test]
    async fn test_open_repository_state_clean() {
        let repo = TestRepo::with_initial_commit();
        let result = open_repository(repo.path_str()).await.unwrap();
        assert!(matches!(result.state, RepositoryState::Clean));
    }

    #[tokio::test]
    async fn test_open_empty_repository() {
        let repo = TestRepo::new(); // No initial commit
        let result = open_repository(repo.path_str()).await;
        assert!(result.is_ok());
        let repo_info = result.unwrap();
        assert!(repo_info.is_valid);
        // Empty repo has no head_ref
        assert!(repo_info.head_ref.is_none());
    }

    #[tokio::test]
    async fn test_get_clone_filter_info_normal_repo() {
        let repo = TestRepo::with_initial_commit();
        let result = get_clone_filter_info(repo.path_str()).await;
        assert!(result.is_ok());
        let info = result.unwrap();
        // A normal repo is not a partial clone
        assert!(!info.is_partial_clone);
        assert!(info.filter.is_none());
        assert!(info.promisor_remote.is_none());
    }

    #[tokio::test]
    async fn test_get_clone_filter_info_with_promisor_config() {
        let test_repo = TestRepo::with_initial_commit();
        let repo = test_repo.repo();

        // Add a remote first
        repo.remote("origin", "https://example.com/repo.git")
            .expect("Failed to add remote");

        // Simulate partial clone config
        let mut config = repo.config().expect("Failed to get config");
        config
            .set_bool("remote.origin.promisor", true)
            .expect("Failed to set promisor");
        config
            .set_str("remote.origin.partialclonefilter", "blob:none")
            .expect("Failed to set partialclonefilter");

        let result = get_clone_filter_info(test_repo.path_str()).await;
        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_partial_clone);
        assert_eq!(info.filter, Some("blob:none".to_string()));
        assert_eq!(info.promisor_remote, Some("origin".to_string()));
    }

    #[tokio::test]
    async fn test_get_clone_filter_info_with_extensions_partial_clone() {
        let test_repo = TestRepo::with_initial_commit();
        let repo = test_repo.repo();

        // Add a remote first
        repo.remote("origin", "https://example.com/repo.git")
            .expect("Failed to add remote");

        // Simulate partial clone via extensions.partialClone
        let mut config = repo.config().expect("Failed to get config");
        config
            .set_str("extensions.partialClone", "origin")
            .expect("Failed to set extensions.partialClone");
        config
            .set_str("remote.origin.partialclonefilter", "tree:0")
            .expect("Failed to set partialclonefilter");

        let result = get_clone_filter_info(test_repo.path_str()).await;
        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(info.is_partial_clone);
        assert_eq!(info.filter, Some("tree:0".to_string()));
        assert_eq!(info.promisor_remote, Some("origin".to_string()));
    }

    #[tokio::test]
    async fn test_get_clone_filter_info_nonexistent_repo() {
        let result = get_clone_filter_info("/nonexistent/path/to/repo".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_clone_filter_info_struct_serialization() {
        let info = CloneFilterInfo {
            is_partial_clone: true,
            filter: Some("blob:none".to_string()),
            promisor_remote: Some("origin".to_string()),
        };
        let json = serde_json::to_string(&info).expect("Failed to serialize");
        assert!(json.contains("isPartialClone"));
        assert!(json.contains("blob:none"));
        assert!(json.contains("promisorRemote"));
    }
}
