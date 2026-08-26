//! Commit command handlers

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tauri::command;

use crate::error::{LeviathanError, Result};
use crate::models::{Commit, FileHistoryEntry};

/// Cached full revwalk (OIDs only) per repository for the all-branches graph
/// walk. Paging a raw revwalk with `skip` is O(skip) per request and re-walks
/// from the roots on every page; caching the walked order makes each page
/// O(page size). Entries are fingerprinted by every ref tip plus HEAD, so any
/// commit, fetch, branch move, or tag change invalidates them.
struct WalkCache {
    fingerprint: u64,
    oids: Vec<git2::Oid>,
    /// Recency marker for LRU eviction — refreshed on every hit
    last_used: std::time::Instant,
}

const WALK_CACHE_MAX_ENTRIES: usize = 8;

fn walk_cache() -> &'static Mutex<HashMap<String, WalkCache>> {
    static CACHE: OnceLock<Mutex<HashMap<String, WalkCache>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// One consistent snapshot of the repository's ref state: the fingerprint
/// and the walk tips come from the SAME enumeration, so a ref changing
/// between "compute fingerprint" and "seed the walk" can't produce a cache
/// entry whose fingerprint matches a different ref state than its walk.
fn refs_snapshot(repo: &git2::Repository) -> (u64, Vec<git2::Oid>) {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut tips: Vec<git2::Oid> = Vec::new();

    // HEAD is a pseudo-ref that references() does NOT enumerate. It must be
    // a walk tip too: commits created on a detached HEAD are reachable from
    // nothing else and would otherwise vanish from the graph and the total.
    if let Ok(head) = repo.head() {
        head.name().unwrap_or("").hash(&mut hasher);
        if let Some(oid) = head.target() {
            oid.as_bytes().hash(&mut hasher);
            tips.push(oid);
        }
    }

    if let Ok(refs) = repo.references() {
        for reference in refs.flatten() {
            reference.name().unwrap_or("").hash(&mut hasher);
            if let Some(oid) = reference.target() {
                oid.as_bytes().hash(&mut hasher);
                tips.push(oid);
            }
        }
    }
    (hasher.finish(), tips)
}

/// Get one page of the all-branches walk plus the true total commit count,
/// (re)building the cached walk when the repo's refs changed
fn cached_walk_page(
    repo: &git2::Repository,
    path: &str,
    skip: usize,
    limit: usize,
) -> Result<(Vec<git2::Oid>, usize)> {
    let (fingerprint, tips) = refs_snapshot(repo);

    // Fast path: serve a warm entry under a short lock
    {
        let mut cache = walk_cache().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = cache.get_mut(path) {
            if entry.fingerprint == fingerprint {
                entry.last_used = std::time::Instant::now();
                let total = entry.oids.len();
                let page = entry.oids.iter().skip(skip).take(limit).copied().collect();
                return Ok((page, total));
            }
        }
    }

    // Cold or stale: walk WITHOUT holding the lock — a multi-second walk on
    // a large repository must not block history/total calls for every OTHER
    // open repository whose entry is warm. A concurrent duplicate walk of
    // the same repo is possible and acceptable (last writer wins with an
    // identical result).
    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;
    // Seed from the SAME snapshot the fingerprint was computed from
    for tip in &tips {
        let _ = revwalk.push(*tip);
    }
    let oids: Vec<git2::Oid> = revwalk.flatten().collect();
    let total = oids.len();
    let page = oids.iter().skip(skip).take(limit).copied().collect();

    let mut cache = walk_cache().lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() >= WALK_CACHE_MAX_ENTRIES && !cache.contains_key(path) {
        // Evict the least-recently-used entry (HashMap iteration order is
        // arbitrary, so recency is tracked explicitly)
        if let Some(lru_key) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(key, _)| key.clone())
        {
            cache.remove(&lru_key);
        }
    }
    cache.insert(
        path.to_string(),
        WalkCache {
            fingerprint,
            oids,
            last_used: std::time::Instant::now(),
        },
    );

    Ok((page, total))
}

/// Parse an ISO 8601 date string into a git2::Time
///
/// Supports formats like:
/// - "2024-01-15T10:30:00Z"
/// - "2024-01-15T10:30:00+05:00"
/// - "2024-01-15T10:30:00-03:00"
/// - Unix timestamp as string (e.g., "1705312200")
fn parse_iso8601_to_git_time(date_str: &str) -> std::result::Result<git2::Time, LeviathanError> {
    // Try parsing as unix timestamp first
    if let Ok(ts) = date_str.parse::<i64>() {
        return Ok(git2::Time::new(ts, 0));
    }

    // Try parsing ISO 8601 format
    // Format: YYYY-MM-DDTHH:MM:SS[Z|+HH:MM|-HH:MM]
    let (datetime_str, offset_minutes) = if let Some(stripped) = date_str.strip_suffix('Z') {
        (stripped, 0i32)
    } else if date_str.len() > 6 {
        // Check for +HH:MM or -HH:MM suffix
        let last6 = &date_str[date_str.len() - 6..];
        if (last6.starts_with('+') || last6.starts_with('-')) && last6.chars().nth(3) == Some(':') {
            let sign = if last6.starts_with('+') { 1 } else { -1 };
            let hours: i32 = last6[1..3].parse().map_err(|_| {
                LeviathanError::OperationFailed(format!("Invalid timezone offset in: {}", date_str))
            })?;
            let mins: i32 = last6[4..6].parse().map_err(|_| {
                LeviathanError::OperationFailed(format!("Invalid timezone offset in: {}", date_str))
            })?;
            (&date_str[..date_str.len() - 6], sign * (hours * 60 + mins))
        } else {
            (date_str, 0)
        }
    } else {
        (date_str, 0)
    };

    // Parse datetime: YYYY-MM-DDTHH:MM:SS
    let parts: Vec<&str> = datetime_str.split('T').collect();
    if parts.len() != 2 {
        return Err(LeviathanError::OperationFailed(format!(
            "Invalid ISO 8601 date format: {}. Expected YYYY-MM-DDTHH:MM:SS[Z|+HH:MM]",
            date_str
        )));
    }

    let date_parts: Vec<&str> = parts[0].split('-').collect();
    let time_parts: Vec<&str> = parts[1].split(':').collect();

    if date_parts.len() != 3 || time_parts.len() < 2 {
        return Err(LeviathanError::OperationFailed(format!(
            "Invalid ISO 8601 date format: {}. Expected YYYY-MM-DDTHH:MM:SS[Z|+HH:MM]",
            date_str
        )));
    }

    let year: i32 = date_parts[0].parse().map_err(|_| {
        LeviathanError::OperationFailed(format!("Invalid year in date: {}", date_str))
    })?;
    let month: u32 = date_parts[1].parse().map_err(|_| {
        LeviathanError::OperationFailed(format!("Invalid month in date: {}", date_str))
    })?;
    let day: u32 = date_parts[2].parse().map_err(|_| {
        LeviathanError::OperationFailed(format!("Invalid day in date: {}", date_str))
    })?;
    let hour: u32 = time_parts[0].parse().map_err(|_| {
        LeviathanError::OperationFailed(format!("Invalid hour in date: {}", date_str))
    })?;
    let minute: u32 = time_parts[1].parse().map_err(|_| {
        LeviathanError::OperationFailed(format!("Invalid minute in date: {}", date_str))
    })?;
    let second: u32 = if time_parts.len() >= 3 {
        // Handle fractional seconds by taking only the integer part
        let sec_str = time_parts[2].split('.').next().unwrap_or("0");
        sec_str.parse().map_err(|_| {
            LeviathanError::OperationFailed(format!("Invalid second in date: {}", date_str))
        })?
    } else {
        0
    };

    // Convert to Unix timestamp
    // Simple calculation - days from epoch
    let mut days: i64 = 0;
    for y in 1970..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }
    let month_days = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for m in 1..month {
        days += month_days[m as usize] as i64;
        if m == 2 && is_leap_year(year) {
            days += 1;
        }
    }
    days += (day as i64) - 1;

    let timestamp = days * 86400 + (hour as i64) * 3600 + (minute as i64) * 60 + (second as i64);

    // Adjust for timezone offset (offset is in minutes from UTC)
    let adjusted_timestamp = timestamp - (offset_minutes as i64) * 60;

    Ok(git2::Time::new(adjusted_timestamp, offset_minutes))
}

/// Check if a year is a leap year
fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Build a git2::Signature with an optional custom date
///
/// If `date_str` is provided, creates a signature with the given name/email but
/// with the specified date. Otherwise returns the original signature as-is.
fn signature_with_date<'a>(
    name: &str,
    email: &str,
    date_str: Option<&str>,
) -> std::result::Result<git2::Signature<'a>, LeviathanError> {
    match date_str {
        Some(ds) => {
            let time = parse_iso8601_to_git_time(ds)?;
            Ok(git2::Signature::new(name, email, &time)?)
        }
        None => Ok(git2::Signature::now(name, email)?),
    }
}

/// Get commit history
#[command]
pub async fn get_commit_history(
    path: String,
    start_oid: Option<String>,
    limit: Option<usize>,
    skip: Option<usize>,
    all_branches: Option<bool>,
) -> Result<Vec<Commit>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let skip_count = skip.unwrap_or(0);
    let limit_count = limit.unwrap_or(100);

    if all_branches.unwrap_or(false) {
        // All-branches graph walk: served from the cached walk so deep
        // pagination doesn't re-walk from the roots on every page
        let (page, _total) = cached_walk_page(&repo, &path, skip_count, limit_count)?;
        let commits: Vec<Commit> = page
            .into_iter()
            .filter_map(|oid| repo.find_commit(oid).ok().map(|c| Commit::from_git2(&c)))
            .collect();
        return Ok(commits);
    }

    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;

    if let Some(ref oid_str) = start_oid {
        let start = git2::Oid::from_str(oid_str)?;
        revwalk.push(start)?;
    } else {
        let start = repo
            .head()?
            .target()
            .ok_or(LeviathanError::RepositoryNotOpen)?;
        revwalk.push(start)?;
    }

    let commits: Vec<Commit> = revwalk
        .skip(skip_count)
        .take(limit_count)
        .filter_map(|oid_result| {
            oid_result
                .ok()
                .and_then(|oid| repo.find_commit(oid).ok().map(|c| Commit::from_git2(&c)))
        })
        .collect();

    Ok(commits)
}

/// Get the total number of commits reachable from any ref (the size of the
/// all-branches graph walk). Served from the same cached walk as
/// `get_commit_history`, so it is O(1) when the cache is warm.
#[command]
pub async fn get_commit_total(path: String) -> Result<usize> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let (_page, total) = cached_walk_page(&repo, &path, 0, 0)?;
    Ok(total)
}

/// Get a single commit by OID
#[command]
pub async fn get_commit(path: String, oid: String) -> Result<Commit> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let oid = git2::Oid::from_str(&oid)?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| LeviathanError::CommitNotFound(oid.to_string()))?;

    Ok(Commit::from_git2(&commit))
}

/// Create a new commit
///
/// If `sign_commit` is Some(true), the commit will be GPG signed.
/// If `sign_commit` is Some(false), the commit will not be signed.
/// If `sign_commit` is None, the repository's default setting (commit.gpgsign) is used.
/// If `allow_empty` is Some(true), the commit is created even with no staged changes.
/// If `author_date` is provided, uses it as the author date (ISO 8601 format).
/// If `committer_date` is provided, uses it as the committer date (ISO 8601 format).
#[command]
pub async fn create_commit(
    path: String,
    message: String,
    amend: Option<bool>,
    sign_commit: Option<bool>,
    allow_empty: Option<bool>,
    author_date: Option<String>,
    committer_date: Option<String>,
) -> Result<Commit> {
    let is_allow_empty = allow_empty.unwrap_or(false);
    let has_custom_dates = author_date.is_some() || committer_date.is_some();

    // git refuses `git commit --amend` mid-operation ("You are in the middle of
    // a merge -- cannot amend."), and nothing here did.
    //
    // With the Amend box ticked during a merge, the git2 path rewrote the
    // PRE-merge HEAD using its pre-merge parents: MERGE_HEAD never became a
    // parent, and cleanup_state() only runs on the non-amend branch. The result
    // was an ordinary commit with the merged branch's changes baked in, the
    // merge silently dropped from the history, and the repository still in
    // MERGING state with the banner stuck on. Checked before the CLI dispatch
    // so signed and allow-empty amends refuse with the same message.
    if amend.unwrap_or(false) {
        let state = git2::Repository::open(Path::new(&path))?.state();
        if let Some(what) = crate::commands::branch::in_progress_operation(state) {
            return Err(LeviathanError::OperationFailed(format!(
                "Cannot amend while a {} is in progress. Finish or abort it first.",
                what
            )));
        }
    }

    // Check if we need to sign via git CLI
    let should_sign = should_sign_commit(&path, sign_commit)?;

    // Use git CLI for signed commits, allow-empty commits, or custom dates with signing
    if should_sign || is_allow_empty {
        return create_commit_with_git_cli(
            &path,
            &message,
            amend.unwrap_or(false),
            should_sign,
            is_allow_empty,
            author_date.as_deref(),
            committer_date.as_deref(),
        )
        .await;
    }

    // Use git2 for unsigned commits (faster)
    let mut repo = git2::Repository::open(Path::new(&path))?;

    // A commit created while a merge is in progress must include MERGE_HEAD
    // as a parent, otherwise the merged branch is silently dropped and the
    // repository stays stuck in MERGING state. Collect the merge heads up
    // front (mergehead_foreach needs a unique borrow of the repo).
    //
    // Cherry-pick and revert also leave sequencer state (CHERRY_PICK_HEAD /
    // REVERT_HEAD) that must be cleared after committing, or the app stays
    // stuck showing the operation "in progress". Unlike a merge, though, the
    // resulting commit keeps a SINGLE parent (HEAD only) — the picked/reverted
    // commit is NOT an extra parent.
    let state = repo.state();
    let merging = state == git2::RepositoryState::Merge;
    let needs_cleanup = matches!(
        state,
        git2::RepositoryState::Merge
            | git2::RepositoryState::CherryPick
            | git2::RepositoryState::Revert
    );
    let mut merge_oids: Vec<git2::Oid> = Vec::new();
    if merging {
        repo.mergehead_foreach(|oid| {
            merge_oids.push(*oid);
            true
        })?;
    }
    let repo = repo;

    // Run client-side hooks like canonical git does — the git2 commit path
    // otherwise bypasses them entirely. pre-commit can veto the commit;
    // commit-msg can veto or rewrite the message.
    crate::commands::hooks::run_hook_blocking(&repo, "pre-commit", &[], None)?;
    let message = crate::commands::hooks::run_commit_msg_hook(&repo, &message)?;

    let default_signature = repo.signature()?;

    // Build author and committer signatures, optionally with custom dates
    let author_sig = if has_custom_dates {
        signature_with_date(
            default_signature.name().ok().unwrap_or("Unknown"),
            default_signature.email().ok().unwrap_or(""),
            author_date.as_deref(),
        )?
    } else {
        default_signature.clone()
    };

    let committer_sig = if has_custom_dates {
        signature_with_date(
            default_signature.name().ok().unwrap_or("Unknown"),
            default_signature.email().ok().unwrap_or(""),
            committer_date.as_deref(),
        )?
    } else {
        default_signature
    };

    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    // `git commit` refuses a commit that changes nothing unless --allow-empty,
    // and this path never checked. The only guard was the frontend's staged
    // COUNT, which goes stale the moment anything unstages outside the app — a
    // terminal, another tool, watcher lag — so pressing Commit then wrote a
    // no-op commit into history with no warning at all.
    //
    // Not applied mid-merge: concluding a merge whose result happens to match
    // HEAD's tree is a legitimate commit, and git allows that one too.
    if !amend.unwrap_or(false) && merge_oids.is_empty() {
        let head_tree_id = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.tree_id());
        let nothing_staged = match head_tree_id {
            Some(head_tree_id) => head_tree_id == tree_oid,
            // Unborn HEAD: there is no parent tree to compare against, so
            // "nothing staged" means the index itself is empty. Comparing
            // against a None head tree could never match, which let the very
            // first commit in a repository be created empty — `git commit`
            // refuses that one too.
            None => repo
                .find_tree(tree_oid)
                .map(|t| t.is_empty())
                .unwrap_or(false),
        };
        if nothing_staged {
            return Err(LeviathanError::OperationFailed(
                "No staged changes to commit".to_string(),
            ));
        }
    }

    let commit_oid = if amend.unwrap_or(false) {
        let head_commit = repo.head()?.peel_to_commit()?;

        // `git commit --amend` PRESERVES the original author identity and author
        // date; only `--reset-author` changes them. An explicitly supplied
        // author date still applies, on top of the original identity.
        //
        // The signed path (`git commit --amend` via the CLI) and amend_commit
        // both already preserve the author, so rebuilding it from
        // repo.signature() here also made the result depend on whether
        // commit.gpgsign happened to be enabled.
        let amend_author: git2::Signature<'_> = if author_date.is_some() {
            let original = head_commit.author();
            signature_with_date(
                original.name().ok().unwrap_or("Unknown"),
                original.email().ok().unwrap_or(""),
                author_date.as_deref(),
            )?
        } else {
            head_commit.author()
        };

        // Commit::amend, not repo.commit(Some("HEAD"), .., parents).
        //
        // libgit2 validates that the updated ref's current tip IS the new
        // commit's first parent. An amend replaces the tip, so that check can
        // never pass and this path failed outright with "current tip is not the
        // first parent" — meaning amend from the commit panel was broken for
        // every repository without commit.gpgsign enabled. Commit::amend
        // performs the replacement libgit2 expects and carries the original
        // parents over unchanged.
        head_commit.amend(
            Some("HEAD"),
            Some(&amend_author),
            Some(&committer_sig),
            None,
            Some(&message),
            Some(&tree),
        )?
    } else {
        let mut parents: Vec<git2::Commit> = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .into_iter()
            .collect();

        // Include MERGE_HEAD parents collected above when mid-merge
        for oid in &merge_oids {
            parents.push(repo.find_commit(*oid)?);
        }
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        let commit_oid = repo.commit(
            Some("HEAD"),
            &author_sig,
            &committer_sig,
            &message,
            &tree,
            &parent_refs,
        )?;
        if needs_cleanup {
            repo.cleanup_state()?;
        }
        commit_oid
    };

    // post-commit runs after the commit is created and never blocks it.
    crate::commands::hooks::run_hook_noblock(&repo, "post-commit", &[]);

    let commit = repo.find_commit(commit_oid)?;
    Ok(Commit::from_git2(&commit))
}

/// Check if a commit should be signed based on explicit parameter or repo config
pub(crate) fn should_sign_commit(path: &str, sign_commit: Option<bool>) -> Result<bool> {
    match sign_commit {
        Some(sign) => Ok(sign),
        None => {
            // Check repository config for commit.gpgsign
            let repo = git2::Repository::open(Path::new(path))?;
            let config = repo.config()?;
            Ok(config.get_bool("commit.gpgsign").unwrap_or(false))
        }
    }
}

/// Create a commit using git CLI (supports GPG signing, allow-empty, and custom dates)
async fn create_commit_with_git_cli(
    path: &str,
    message: &str,
    amend: bool,
    sign: bool,
    allow_empty: bool,
    author_date: Option<&str>,
    committer_date: Option<&str>,
) -> Result<Commit> {
    let mut args = vec!["commit", "-m", message];

    if sign {
        args.push("-S");
    }

    if amend {
        args.push("--amend");
    }

    if allow_empty {
        args.push("--allow-empty");
    }

    let mut cmd = crate::utils::create_command("git");
    cmd.current_dir(path).args(&args);

    // Set date environment variables if provided
    if let Some(ad) = author_date {
        cmd.env("GIT_AUTHOR_DATE", ad);
    }
    if let Some(cd) = committer_date {
        cmd.env("GIT_COMMITTER_DATE", cd);
    }

    let output = cmd
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to run git commit: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(LeviathanError::OperationFailed(format!(
            "Git commit failed: {}",
            stderr
        )));
    }

    // Get the new commit
    let repo = git2::Repository::open(Path::new(path))?;
    let head_commit = repo.head()?.peel_to_commit()?;
    Ok(Commit::from_git2(&head_commit))
}

/// Amend the HEAD commit message without changing any files
///
/// This only updates the commit message; the tree and parents remain the same.
#[command]
pub async fn amend_commit_message(path: String, message: String) -> Result<Commit> {
    // libgit2's repo.commit() cannot sign and would strip any existing signature.
    // When commit.gpgsign is enabled, amend via the CLI so the reworded commit is
    // re-signed instead of silently emitted unsigned.
    if should_sign_commit(&path, None)? {
        let output = crate::utils::create_command("git")
            .current_dir(&path)
            .args(["commit", "--amend", "-S", "-m", &message])
            .output()
            .map_err(|e| {
                LeviathanError::OperationFailed(format!("Failed to run git commit --amend: {}", e))
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(LeviathanError::OperationFailed(format!(
                "Git commit --amend failed: {}",
                stderr.trim()
            )));
        }
        let repo = git2::Repository::open(Path::new(&path))?;
        let head_commit = repo.head()?.peel_to_commit()?;
        return Ok(Commit::from_git2(&head_commit));
    }

    let repo = git2::Repository::open(Path::new(&path))?;

    // git runs pre-commit/commit-msg/post-commit for `git commit --amend` too;
    // the git2 amend path otherwise bypasses them.
    crate::commands::hooks::run_hook_blocking(&repo, "pre-commit", &[], None)?;
    let message = crate::commands::hooks::run_commit_msg_hook(&repo, &message)?;

    let head_commit = repo
        .head()?
        .peel_to_commit()
        .map_err(|_| LeviathanError::CommitNotFound("HEAD".to_string()))?;

    let tree = head_commit.tree()?;
    let signature = repo.signature()?;

    // A reword changes only the message. Passing the fresh signature as AUTHOR
    // as well re-attributed the commit to whoever reworded it and reset the
    // author date to now — which also reorders it in date-sorted history views.
    // git preserves the author across a reword; only the committer changes.
    //
    // Commit::amend, not repo.commit(Some("HEAD"), .., parents): libgit2 checks
    // that the updated ref's tip is the new commit's first parent, which a
    // reword never satisfies, so that call failed with "current tip is not the
    // first parent". Commit::amend performs the replacement and carries the
    // original parents over unchanged.
    let new_oid = head_commit.amend(
        Some("HEAD"),
        Some(&head_commit.author()),
        Some(&signature),
        None,
        Some(&message),
        Some(&tree),
    )?;

    crate::commands::hooks::run_hook_noblock(&repo, "post-commit", &[]);

    let new_commit = repo.find_commit(new_oid)?;
    Ok(Commit::from_git2(&new_commit))
}

/// Result of an amend operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmendResult {
    pub new_oid: String,
    pub old_oid: String,
    pub success: bool,
}

/// Amend the HEAD commit
///
/// This can update the commit message and/or reset the author.
/// If message is None, the original message is preserved.
/// If reset_author is true, the author is updated to the current user.
/// If sign_amend is Some(true), the amended commit will be GPG signed.
/// If sign_amend is Some(false), the amended commit will not be signed.
/// If sign_amend is None, the repository's default setting (commit.gpgsign) is used.
#[command]
pub async fn amend_commit(
    path: String,
    message: Option<String>,
    reset_author: Option<bool>,
    sign_amend: Option<bool>,
) -> Result<AmendResult> {
    // Check if we need to sign via git CLI
    let should_sign = should_sign_commit(&path, sign_amend)?;

    if should_sign {
        return amend_commit_with_git_cli(&path, message.as_deref(), reset_author.unwrap_or(false))
            .await;
    }

    let repo = git2::Repository::open(Path::new(&path))?;

    // git runs pre-commit for `git commit --amend`; the git2 path bypasses it.
    crate::commands::hooks::run_hook_blocking(&repo, "pre-commit", &[], None)?;

    let head_commit = repo
        .head()?
        .peel_to_commit()
        .map_err(|_| LeviathanError::CommitNotFound("HEAD".to_string()))?;

    let old_oid = head_commit.id().to_string();
    let tree = head_commit.tree()?;
    let signature = repo.signature()?;

    // Use the new message or keep the original
    let commit_message =
        message.unwrap_or_else(|| head_commit.message().ok().unwrap_or("").to_string());
    // commit-msg may veto or rewrite the (possibly reused) message.
    let commit_message = crate::commands::hooks::run_commit_msg_hook(&repo, &commit_message)?;

    // Use new author if reset_author is true, otherwise keep original
    let author = if reset_author.unwrap_or(false) {
        signature.clone()
    } else {
        head_commit.author()
    };

    let parent_ids: Vec<git2::Oid> = head_commit.parent_ids().collect();
    let parents: Vec<git2::Commit> = parent_ids
        .iter()
        .filter_map(|id| repo.find_commit(*id).ok())
        .collect();
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    // Create commit without updating ref (avoids git2 parent validation error
    // for root commits), then manually update HEAD.
    let new_oid = repo.commit(
        None,
        &author,
        &signature,
        &commit_message,
        &tree,
        &parent_refs,
    )?;

    // Update HEAD to point to the new commit
    let head_ref = repo.head()?;
    if head_ref.is_branch() {
        let branch_name = head_ref
            .name()
            .map_err(|_| LeviathanError::OperationFailed("Invalid HEAD ref".to_string()))?;
        repo.reference(
            branch_name,
            new_oid,
            true,
            &format!("amend: {}", &old_oid[..std::cmp::min(7, old_oid.len())]),
        )?;
    } else {
        repo.set_head_detached(new_oid)?;
    }

    crate::commands::hooks::run_hook_noblock(&repo, "post-commit", &[]);
    // The Hooks dialog advertises post-rewrite for "rebase, amend" and lets
    // the user enable it, but nothing ran it — so the same Amend button fired
    // it or not depending purely on whether GPG signing was on, since the
    // signed path shells out to git and git runs it.
    crate::commands::hooks::run_hook_noblock_with_stdin(
        &repo,
        "post-rewrite",
        &["amend"],
        Some(&format!("{} {}\n", old_oid, new_oid)),
    );

    Ok(AmendResult {
        new_oid: new_oid.to_string(),
        old_oid,
        success: true,
    })
}

/// Amend a commit using git CLI (supports GPG signing)
async fn amend_commit_with_git_cli(
    path: &str,
    message: Option<&str>,
    reset_author: bool,
) -> Result<AmendResult> {
    // Get the old OID before amending
    let repo = git2::Repository::open(Path::new(path))?;
    let old_oid = repo.head()?.peel_to_commit()?.id().to_string();
    drop(repo);

    let mut args = vec!["commit", "--amend", "-S"];

    if let Some(msg) = message {
        args.push("-m");
        args.push(msg);
    } else {
        args.push("--no-edit");
    }

    if reset_author {
        args.push("--reset-author");
    }

    let output = crate::utils::create_command("git")
        .current_dir(path)
        .args(&args)
        .output()
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to run git commit --amend: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(LeviathanError::OperationFailed(format!(
            "Git commit --amend failed: {}",
            stderr
        )));
    }

    // Get the new commit OID
    let repo = git2::Repository::open(Path::new(path))?;
    let new_oid = repo.head()?.peel_to_commit()?.id().to_string();

    Ok(AmendResult {
        new_oid,
        old_oid,
        success: true,
    })
}

/// Whether HEAD has already been published to its upstream.
///
/// Amending rewrites HEAD. When the commit being rewritten is already on the
/// remote, that rewrites PUBLISHED history: the branch and its upstream
/// diverge, the next push is rejected, and the only way forward is a force
/// push — which discards whatever anyone else based on that commit. None of
/// the amend surfaces said so, so this is what lets them ask first.
///
/// True only when the branch has an upstream AND that upstream contains HEAD.
/// A branch with no upstream, an unborn HEAD, a detached HEAD, or an upstream
/// that does not yet have this commit are all safe to amend, and all answer
/// false — the check must never invent a warning for an ordinary local commit.
#[command]
pub async fn is_head_published(path: String) -> Result<bool> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let Ok(head) = repo.head() else {
        return Ok(false); // Unborn HEAD: nothing to amend yet.
    };
    if repo.head_detached().unwrap_or(false) {
        return Ok(false); // No upstream to diverge from.
    }
    let Some(head_oid) = head.target() else {
        return Ok(false);
    };
    let Ok(branch_name) = head.shorthand() else {
        return Ok(false);
    };

    let Ok(branch) = repo.find_branch(branch_name, git2::BranchType::Local) else {
        return Ok(false);
    };
    // An upstream that is configured but pruned resolves to Err here, and that
    // is the right answer: with no remote-tracking ref there is nothing local
    // that can show the commit was published.
    let Ok(upstream) = branch.upstream() else {
        return Ok(false);
    };
    let Some(upstream_oid) = upstream.get().target() else {
        return Ok(false);
    };

    if upstream_oid == head_oid {
        return Ok(true);
    }
    // The upstream having moved PAST head still means head is published.
    Ok(repo
        .graph_descendant_of(upstream_oid, head_oid)
        .unwrap_or(false))
}

/// Get the full commit message for a commit
#[command]
pub async fn get_commit_message(path: String, oid: String) -> Result<String> {
    let repo = git2::Repository::open(Path::new(&path))?;
    let oid = git2::Oid::from_str(&oid)?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| LeviathanError::CommitNotFound(oid.to_string()))?;

    Ok(commit.message().ok().unwrap_or("").to_string())
}

/// Edit the author and/or committer date of an existing commit
///
/// For the HEAD commit, this recreates the commit with updated signatures.
/// For non-HEAD commits, this uses interactive rebase with environment variables
/// to set `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE`.
///
/// Dates should be in ISO 8601 format (e.g., "2024-01-15T10:30:00Z") or unix timestamps.
#[command]
pub async fn edit_commit_date(
    path: String,
    oid: String,
    author_date: Option<String>,
    committer_date: Option<String>,
) -> Result<AmendResult> {
    if author_date.is_none() && committer_date.is_none() {
        return Err(LeviathanError::OperationFailed(
            "At least one of author_date or committer_date must be provided".to_string(),
        ));
    }

    // Extract commit info in a closure to ensure git2 objects are dropped before any .await
    struct CommitDateInfo {
        is_head: bool,
        author_name: String,
        author_email: String,
        committer_name: String,
        committer_email: String,
        message: String,
        parent_ids: Vec<git2::Oid>,
    }

    let info: std::result::Result<CommitDateInfo, LeviathanError> = (|| {
        let repo = git2::Repository::open(Path::new(&path))?;

        let target_oid =
            git2::Oid::from_str(&oid).map_err(|_| LeviathanError::CommitNotFound(oid.clone()))?;
        let target_commit = repo
            .find_commit(target_oid)
            .map_err(|_| LeviathanError::CommitNotFound(oid.clone()))?;

        let head_oid = repo.head()?.peel_to_commit()?.id();
        let is_head = head_oid == target_oid;

        if repo.state() != git2::RepositoryState::Clean {
            return Err(LeviathanError::OperationFailed(
                "Another operation is in progress".to_string(),
            ));
        }

        // Extract all values from signatures before they are dropped
        let author_name = target_commit
            .author()
            .name()
            .ok()
            .unwrap_or("Unknown")
            .to_string();
        let author_email = target_commit
            .author()
            .email()
            .ok()
            .unwrap_or("")
            .to_string();
        let committer_name = target_commit
            .committer()
            .name()
            .ok()
            .unwrap_or("Unknown")
            .to_string();
        let committer_email = target_commit
            .committer()
            .email()
            .ok()
            .unwrap_or("")
            .to_string();
        let message = target_commit.message().ok().unwrap_or("").to_string();
        let parent_ids = target_commit.parent_ids().collect();

        Ok(CommitDateInfo {
            is_head,
            author_name,
            author_email,
            committer_name,
            committer_email,
            message,
            parent_ids,
        })
    })();

    let info = info?;

    if info.is_head {
        // For HEAD commit, recreate it with updated dates using git2
        let repo = git2::Repository::open(Path::new(&path))?;
        let target_oid = git2::Oid::from_str(&oid)?;
        let target_commit = repo.find_commit(target_oid)?;

        let old_oid = target_oid.to_string();

        // Build author signature with optional new date
        let new_author = if let Some(ref ad) = author_date {
            let time = parse_iso8601_to_git_time(ad)?;
            git2::Signature::new(&info.author_name, &info.author_email, &time)?
        } else {
            target_commit.author()
        };

        // Build committer signature with optional new date
        let new_committer = if let Some(ref cd) = committer_date {
            let time = parse_iso8601_to_git_time(cd)?;
            git2::Signature::new(&info.committer_name, &info.committer_email, &time)?
        } else {
            target_commit.committer()
        };

        let tree = target_commit.tree()?;
        let parents: Vec<git2::Commit> = info
            .parent_ids
            .iter()
            .filter_map(|id| repo.find_commit(*id).ok())
            .collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        // Create commit without updating ref (avoids git2 parent validation error),
        // then manually update HEAD to point to the new commit.
        let new_oid = repo.commit(
            None,
            &new_author,
            &new_committer,
            &info.message,
            &tree,
            &parent_refs,
        )?;

        // Update HEAD to point to the new commit
        let head_ref = repo.head()?;
        if head_ref.is_branch() {
            // HEAD points to a branch - update the branch target
            let branch_name = head_ref
                .name()
                .map_err(|_| LeviathanError::OperationFailed("Invalid HEAD ref".to_string()))?;
            repo.reference(
                branch_name,
                new_oid,
                true,
                &format!("edit_commit_date: updated {}", &old_oid[..7]),
            )?;
        } else {
            // Detached HEAD - update HEAD directly
            repo.set_head_detached(new_oid)?;
        }

        Ok(AmendResult {
            new_oid: new_oid.to_string(),
            old_oid,
            success: true,
        })
    } else {
        // For non-HEAD commits, use git CLI with rebase and environment variables
        edit_commit_date_with_rebase(
            &path,
            &oid,
            author_date.as_deref(),
            committer_date.as_deref(),
        )
        .await
    }
}

/// Edit a non-HEAD commit's date using interactive rebase with env vars
async fn edit_commit_date_with_rebase(
    path: &str,
    oid: &str,
    author_date: Option<&str>,
    committer_date: Option<&str>,
) -> Result<AmendResult> {
    // Find the parent of the target commit for the rebase base
    let parent_oid_str = {
        let repo = git2::Repository::open(Path::new(path))?;
        let target_oid = git2::Oid::from_str(oid)
            .map_err(|_| LeviathanError::CommitNotFound(oid.to_string()))?;
        let target_commit = repo
            .find_commit(target_oid)
            .map_err(|_| LeviathanError::CommitNotFound(oid.to_string()))?;

        let parent = target_commit.parent(0).map_err(|_| {
            LeviathanError::OperationFailed("Cannot edit date of root commit".to_string())
        })?;
        parent.id().to_string()
    };

    // Resolve via repo.path(): in a linked worktree `<wt>/.git` is a gitdir
    // POINTER FILE, so writing to `<wt>/.git/<script>` fails with ENOTDIR and
    // the whole operation dies on a raw OS error.
    let git_dir = git2::Repository::open(std::path::Path::new(path))?
        .path()
        .to_path_buf();
    let short_oid = &oid[..std::cmp::min(7, oid.len())];

    // Create a GIT_SEQUENCE_EDITOR script that changes 'pick <oid>' to 'edit <oid>'
    let editor_script = if cfg!(target_os = "windows") {
        let script_path = git_dir.join("date-edit-editor.bat");
        let script_content = format!(
            "@echo off\r\n\
             powershell -Command \"(Get-Content '%1') -replace '^pick {}', 'edit {}' | Set-Content '%1'\"",
            short_oid, short_oid
        );
        std::fs::write(&script_path, &script_content)?;
        script_path.to_string_lossy().to_string()
    } else {
        let script_path = git_dir.join("date-edit-editor.sh");
        let script_content = format!(
            "#!/bin/sh\nsed -i.bak 's/^pick {}/edit {}/' \"$1\"",
            short_oid, short_oid
        );
        std::fs::write(&script_path, &script_content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))?;
        }
        script_path.to_string_lossy().to_string()
    };

    // Start the rebase
    let output = crate::utils::create_command("git")
        .current_dir(path)
        .env("GIT_SEQUENCE_EDITOR", &editor_script)
        .args(["rebase", "-i", &parent_oid_str])
        .output()
        .map_err(|e| LeviathanError::OperationFailed(format!("Failed to start rebase: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up
        let _ = std::fs::remove_file(git_dir.join("date-edit-editor.bat"));
        let _ = std::fs::remove_file(git_dir.join("date-edit-editor.sh"));
        return Err(LeviathanError::OperationFailed(format!(
            "Rebase failed: {}",
            stderr
        )));
    }

    // Now amend the commit with the new date(s)
    let mut amend_cmd = crate::utils::create_command("git");
    amend_cmd
        .current_dir(path)
        .args(["commit", "--amend", "--no-edit", "--allow-empty"]);

    if let Some(ad) = author_date {
        amend_cmd.env("GIT_AUTHOR_DATE", ad);
    }
    if let Some(cd) = committer_date {
        amend_cmd.env("GIT_COMMITTER_DATE", cd);
    }

    let amend_output = amend_cmd.output().map_err(|e| {
        LeviathanError::OperationFailed(format!("Failed to amend commit date: {}", e))
    })?;

    if !amend_output.status.success() {
        let stderr = String::from_utf8_lossy(&amend_output.stderr);
        // Abort the rebase on failure
        let _ = crate::utils::create_command("git")
            .current_dir(path)
            .args(["rebase", "--abort"])
            .output();
        let _ = std::fs::remove_file(git_dir.join("date-edit-editor.bat"));
        let _ = std::fs::remove_file(git_dir.join("date-edit-editor.sh"));
        return Err(LeviathanError::OperationFailed(format!(
            "Failed to amend commit date: {}",
            stderr
        )));
    }

    // Continue the rebase
    let continue_output = crate::utils::create_command("git")
        .current_dir(path)
        .args(["rebase", "--continue"])
        .output()
        .map_err(|e| {
            LeviathanError::OperationFailed(format!("Failed to continue rebase: {}", e))
        })?;

    // Clean up temp files
    let _ = std::fs::remove_file(git_dir.join("date-edit-editor.bat"));
    let _ = std::fs::remove_file(git_dir.join("date-edit-editor.sh"));

    if !continue_output.status.success() {
        let stderr = String::from_utf8_lossy(&continue_output.stderr);
        if stderr.contains("CONFLICT") || stderr.contains("conflict") {
            return Err(LeviathanError::RebaseConflict);
        }
        // Sometimes rebase --continue fails because there's nothing to continue
        // (single commit case) - check if we're in a clean state
        let repo = git2::Repository::open(Path::new(path))?;
        if repo.state() != git2::RepositoryState::Clean {
            let _ = crate::utils::create_command("git")
                .current_dir(path)
                .args(["rebase", "--abort"])
                .output();
            return Err(LeviathanError::OperationFailed(format!(
                "Rebase continue failed: {}",
                stderr
            )));
        }
    }

    // Get the new HEAD
    let repo = git2::Repository::open(Path::new(path))?;
    let new_head = repo.head()?.peel_to_commit()?;

    Ok(AmendResult {
        new_oid: new_head.id().to_string(),
        old_oid: oid.to_string(),
        success: true,
    })
}

/// Reword a commit that is not HEAD by performing an interactive rebase
///
/// This uses git CLI under the hood as git2 doesn't support interactive rebase well.
#[command]
pub async fn reword_commit(path: String, oid: String, message: String) -> Result<AmendResult> {
    // Use a closure to ensure git2 objects are dropped before any .await
    // This is necessary because git2 types are not Send
    let result: std::result::Result<(bool, Option<git2::Oid>), LeviathanError> = (|| {
        let repo = git2::Repository::open(Path::new(&path))?;

        // Verify the commit exists
        let target_oid =
            git2::Oid::from_str(&oid).map_err(|_| LeviathanError::CommitNotFound(oid.clone()))?;
        let target_commit = repo
            .find_commit(target_oid)
            .map_err(|_| LeviathanError::CommitNotFound(oid.clone()))?;

        // Check if this is the HEAD commit - if so, use amend instead
        let head_oid = repo.head()?.peel_to_commit()?.id();
        let is_head = head_oid == target_oid;

        // Check for existing operations in progress
        if repo.state() != git2::RepositoryState::Clean {
            return Err(LeviathanError::OperationFailed(
                "Another operation is in progress".to_string(),
            ));
        }

        // For non-HEAD commits, we need to use git rebase
        // Find the parent of the target commit to use as the base
        let parent_oid = if !is_head {
            Some(
                target_commit
                    .parent(0)
                    .map_err(|_| {
                        LeviathanError::OperationFailed("Cannot reword root commit".to_string())
                    })?
                    .id(),
            )
        } else {
            None
        };

        Ok((is_head, parent_oid))
    })();

    let (is_head, parent_oid) = result?;

    // Now we can safely await since all git2 objects are dropped
    if is_head {
        return amend_commit(path, Some(message), None, None).await;
    }

    let parent_oid = parent_oid.expect("parent_oid should be set for non-HEAD commits");

    // Write the new message to a temporary file
    let git_dir = git2::Repository::open(Path::new(&path))?
        .path()
        .to_path_buf();
    let msg_file = git_dir.join("REWORD_MSG");
    std::fs::write(&msg_file, &message)?;

    // Create a GIT_SEQUENCE_EDITOR script that will change 'pick' to 'reword' for our target commit
    let editor_script = if cfg!(target_os = "windows") {
        // On Windows, create a batch file
        let script_path = git_dir.join("reword-editor.bat");
        let script_content = format!(
            "@echo off\r\n\
             powershell -Command \"(Get-Content '%1') -replace '^pick {}', 'reword {}' | Set-Content '%1'\"",
            &oid[..7],
            &oid[..7]
        );
        std::fs::write(&script_path, &script_content)?;
        script_path.to_string_lossy().to_string()
    } else {
        // On Unix, create a shell script
        let script_path = git_dir.join("reword-editor.sh");
        let script_content = format!(
            "#!/bin/sh\nsed -i.bak 's/^pick {}/reword {}/' \"$1\"",
            &oid[..7],
            &oid[..7]
        );
        std::fs::write(&script_path, &script_content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))?;
        }
        script_path.to_string_lossy().to_string()
    };

    // Create a COMMIT_EDITOR script that uses our saved message
    let commit_editor_script = if cfg!(target_os = "windows") {
        let script_path = git_dir.join("commit-editor.bat");
        let msg_file_escaped = msg_file.to_string_lossy().replace('\\', "\\\\");
        let script_content = format!("@echo off\r\ncopy /Y \"{}\" \"%1\" >nul", msg_file_escaped);
        std::fs::write(&script_path, &script_content)?;
        script_path.to_string_lossy().to_string()
    } else {
        let script_path = git_dir.join("commit-editor.sh");
        let script_content = format!("#!/bin/sh\ncp \"{}\" \"$1\"", msg_file.to_string_lossy());
        std::fs::write(&script_path, &script_content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))?;
        }
        script_path.to_string_lossy().to_string()
    };

    // Run the rebase
    let output = crate::utils::create_command("git")
        .current_dir(&path)
        .env("GIT_SEQUENCE_EDITOR", &editor_script)
        .env("GIT_EDITOR", &commit_editor_script)
        .args(["rebase", "-i", &parent_oid.to_string()])
        .output()
        .map_err(|e| LeviathanError::OperationFailed(e.to_string()))?;

    // Clean up temporary files
    let _ = std::fs::remove_file(&msg_file);
    let _ = std::fs::remove_file(git_dir.join("reword-editor.bat"));
    let _ = std::fs::remove_file(git_dir.join("reword-editor.sh"));
    let _ = std::fs::remove_file(git_dir.join("commit-editor.bat"));
    let _ = std::fs::remove_file(git_dir.join("commit-editor.sh"));

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("CONFLICT") || stderr.contains("conflict") {
            return Err(LeviathanError::RebaseConflict);
        }
        return Err(LeviathanError::OperationFailed(format!(
            "Rebase failed: {}",
            stderr
        )));
    }

    // Reopen the repository to get the new state after rebase
    let repo = git2::Repository::open(Path::new(&path))?;

    // Get the new HEAD to find the reworded commit's new OID
    let new_head = repo.head()?.peel_to_commit()?;

    // Walk back to find the commit that replaced our target
    // The new commit will be at approximately the same position in history
    let mut revwalk = repo.revwalk()?;
    revwalk.push(new_head.id())?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL)?;

    let mut new_commit_oid = new_head.id().to_string();
    for rev_oid in revwalk.flatten() {
        let commit = repo.find_commit(rev_oid)?;
        // The reworded commit will have our new message
        if commit.message().ok().unwrap_or("") == message {
            new_commit_oid = rev_oid.to_string();
            break;
        }
    }

    Ok(AmendResult {
        new_oid: new_commit_oid,
        old_oid: oid,
        success: true,
    })
}

/// Search commits with filters
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn search_commits(
    path: String,
    query: Option<String>,
    author: Option<String>,
    date_from: Option<i64>,
    date_to: Option<i64>,
    file_path: Option<String>,
    branch: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<Commit>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;

    if let Some(ref branch_name) = branch {
        // Push only the specified branch/ref
        let reference = repo
            .resolve_reference_from_short_name(branch_name)
            .map_err(|_| crate::error::LeviathanError::BranchNotFound(branch_name.clone()))?;
        if let Some(oid) = reference.target() {
            revwalk.push(oid)?;
        }
    } else {
        // Push all branch heads for complete search
        for reference in repo.references()?.flatten() {
            if let Some(oid) = reference.target() {
                let _ = revwalk.push(oid);
            }
        }
    }

    let limit_count = limit.unwrap_or(500);
    let query_lower = query.as_ref().map(|q| q.to_lowercase());
    let author_lower = author.as_ref().map(|a| a.to_lowercase());

    let mut results = Vec::new();

    for oid_result in revwalk {
        if results.len() >= limit_count {
            break;
        }

        let oid = match oid_result {
            Ok(oid) => oid,
            Err(_) => continue,
        };

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Check query filter (message, SHA)
        if let Some(ref q) = query_lower {
            let message = commit.message().ok().unwrap_or("").to_lowercase();
            let sha = commit.id().to_string().to_lowercase();
            if !message.contains(q) && !sha.starts_with(q) {
                continue;
            }
        }

        // Check author filter
        if let Some(ref a) = author_lower {
            let author_name = commit.author().name().ok().unwrap_or("").to_lowercase();
            let author_email = commit.author().email().ok().unwrap_or("").to_lowercase();
            if !author_name.contains(a) && !author_email.contains(a) {
                continue;
            }
        }

        // Check date range
        let commit_time = commit.time().seconds();
        if let Some(from) = date_from {
            if commit_time < from {
                continue;
            }
        }
        if let Some(to) = date_to {
            if commit_time > to {
                continue;
            }
        }

        // Check file path filter
        if let Some(ref fp) = file_path {
            let tree = match commit.tree() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

            let mut diff_opts = git2::DiffOptions::new();
            diff_opts.pathspec(fp);

            let diff = match repo.diff_tree_to_tree(
                parent_tree.as_ref(),
                Some(&tree),
                Some(&mut diff_opts),
            ) {
                Ok(d) => d,
                Err(_) => continue,
            };

            if diff.deltas().count() == 0 {
                continue;
            }
        }

        results.push(Commit::from_git2(&commit));
    }

    Ok(results)
}

/// Get all commits that modified a specific file, each paired with the path
/// the file had in that commit.
///
/// The path is per-entry, not per-request: following a rename backwards means
/// older entries refer to the file under its old name, and a caller that
/// diffed or blamed them under the file's current name would get
/// "File not found in commit" for a commit this very list says touched it.
#[command]
pub async fn get_file_history(
    path: String,
    file_path: String,
    limit: Option<usize>,
    follow_renames: Option<bool>,
) -> Result<Vec<FileHistoryEntry>> {
    let repo = git2::Repository::open(Path::new(&path))?;

    let mut revwalk = repo.revwalk()?;
    // TOPOLOGICAL as well as TIME. Following a rename rewrites current_path
    // when the walk REACHES the renaming commit, so every commit before the
    // rename must be visited after it. Sorting by time alone does not
    // guarantee that — commits made within the same second (a scripted commit,
    // a rebase, an import) tie, and a tie can put the renaming commit last, by
    // which point the pre-rename history has already been tested against the
    // new name and discarded. Topological order makes children precede parents
    // no matter what the timestamps say.
    revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;

    // Start from HEAD
    let head = repo
        .head()?
        .target()
        .ok_or(LeviathanError::RepositoryNotOpen)?;
    revwalk.push(head)?;

    let limit_count = limit.unwrap_or(500);
    let should_follow = follow_renames.unwrap_or(true);
    let mut entries: Vec<FileHistoryEntry> = Vec::new();
    let mut current_path = file_path.clone();

    for oid_result in revwalk {
        if entries.len() >= limit_count {
            break;
        }

        let oid = match oid_result {
            Ok(oid) => oid,
            Err(_) => continue,
        };

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => continue,
        };

        // Check if file exists in this commit
        let file_in_commit = tree.get_path(std::path::Path::new(&current_path)).is_ok();

        if !file_in_commit && !should_follow {
            continue;
        }

        // Get parent tree for diff
        let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

        // Create diff options
        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.pathspec(&current_path);

        let diff =
            match repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut diff_opts)) {
                Ok(d) => d,
                Err(_) => continue,
            };

        // Check if file was modified in this commit
        let mut file_modified;
        let mut renamed_from: Option<String> = None;

        if should_follow {
            // The pathspec above filters deltas at diff-GENERATION time, so at
            // the commit that renamed old -> current this diff holds only the
            // Added(current) half. find_similar had no Deleted(old) to pair it
            // with, delta.status() was therefore never Renamed, renamed_from
            // was never set, and the walk stopped dead at the rename — the one
            // thing follow_renames exists to get past.
            //
            // Detect the modification from the cheap filtered diff, then pay
            // for an UNFILTERED diff only where a rename could actually be
            // hiding: the commit that introduces the path. That is once per
            // rename, not once per commit.
            let introduced_here = diff
                .deltas()
                .any(|d| d.status() == git2::Delta::Added || d.status() == git2::Delta::Renamed);
            file_modified = diff.deltas().count() > 0;

            // `if let Ok`, not an early `continue`: the filtered diff has
            // already established the file was touched by this commit. Skipping
            // the iteration on a failed diff dropped the commit from the
            // history entirely — losing a real entry to report a rename we
            // could not look for. Without the unfiltered diff we simply do not
            // detect a rename here, and the walk stops following the path,
            // which is the old behaviour rather than a missing commit.
            if introduced_here {
                if let Ok(mut unfiltered) =
                    repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
                {
                    let mut find_opts = git2::DiffFindOptions::new();
                    find_opts.renames(true);
                    find_opts.copies(false);
                    let _ = unfiltered.find_similar(Some(&mut find_opts));

                    for delta in unfiltered.deltas() {
                        if delta.status() != git2::Delta::Renamed {
                            continue;
                        }
                        let is_ours = delta
                            .new_file()
                            .path()
                            .is_some_and(|p| p.to_string_lossy() == current_path);
                        if is_ours {
                            file_modified = true;
                            if let Some(old_file) = delta.old_file().path() {
                                renamed_from = Some(old_file.to_string_lossy().to_string());
                            }
                            break;
                        }
                    }
                }
            }
        } else {
            file_modified = diff.deltas().count() > 0;
        }

        if file_modified {
            // Recorded BEFORE the rename is followed: at the renaming commit
            // the file already exists in that commit's tree under the NEW
            // name, so the new name is the right path there. Only commits
            // older than the rename get the old name.
            entries.push(FileHistoryEntry {
                commit: Commit::from_git2(&commit),
                path_at_commit: current_path.clone(),
            });

            // Follow the rename backwards
            if let Some(old_path) = renamed_from {
                current_path = old_path;
            }
        }
    }

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestRepo;

    /// follow_renames must actually follow the rename.
    ///
    /// The per-commit diff was built with a pathspec, which filters deltas at
    /// diff-GENERATION time — so at the renaming commit the diff held only the
    /// Added(new) half and find_similar had no Deleted(old) to pair it with.
    /// delta.status() was never Renamed, renamed_from was never set, and the
    /// walk stopped at the rename: history before it was invisible, which is
    /// the one thing the option exists to provide.
    /// Commit the current index at an EXPLICIT time.
    ///
    /// The rename tests need timestamps that deliberately disagree with
    /// topology. With wall-clock times every commit lands in the same second in
    /// commit order, so `Sort::TIME` alone already produces the right order and
    /// the tests would pass even with `Sort::TOPOLOGICAL` removed — proving
    /// nothing about the walk they exist to cover.
    fn commit_index_at(repo: &TestRepo, message: &str, seconds: i64) -> git2::Oid {
        let git_repo = repo.repo();
        let mut index = git_repo.index().unwrap();
        index.write().unwrap();
        let tree = git_repo.find_tree(index.write_tree().unwrap()).unwrap();
        let when = git2::Time::new(seconds, 0);
        let sig = git2::Signature::new("Test User", "test@example.com", &when).unwrap();
        let parent = git_repo.head().unwrap().peel_to_commit().unwrap();
        git_repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .unwrap()
    }

    /// Write a file, stage it, and commit at an explicit time.
    fn commit_file_at(repo: &TestRepo, message: &str, file: &str, body: &str, seconds: i64) {
        std::fs::write(repo.path.join(file), body).unwrap();
        {
            let git_repo = repo.repo();
            let mut index = git_repo.index().unwrap();
            index.add_path(std::path::Path::new(file)).unwrap();
            index.write().unwrap();
        }
        commit_index_at(repo, message, seconds);
    }

    /// Stage a rename and commit it at an explicit time.
    fn commit_rename_at(repo: &TestRepo, from: &str, to: &str, message: &str, seconds: i64) {
        std::fs::rename(repo.path.join(from), repo.path.join(to)).unwrap();
        {
            let git_repo = repo.repo();
            let mut index = git_repo.index().unwrap();
            index.remove_path(std::path::Path::new(from)).unwrap();
            index.add_path(std::path::Path::new(to)).unwrap();
            index.write().unwrap();
        }
        commit_index_at(repo, message, seconds);
    }

    #[tokio::test]
    async fn test_get_file_history_follows_a_rename() {
        let repo = TestRepo::with_initial_commit();

        // Timestamps chosen to DISAGREE with topology: the rename is older than
        // its own parent. Under a TIME-only walk the parent would be visited
        // first — before the path is known to have changed — so this ordering
        // is what makes the test able to fail.
        commit_file_at(&repo, "Add original", "old-name.txt", "line one\n", 1_000);
        commit_file_at(
            &repo,
            "Edit original",
            "old-name.txt",
            "line one\nline two\n",
            3_000,
        );
        // Renamed with identical content, so it is unambiguously a rename.
        commit_rename_at(&repo, "old-name.txt", "new-name.txt", "Rename it", 2_000);
        commit_file_at(
            &repo,
            "Edit after rename",
            "new-name.txt",
            "line one\nline two\nline three\n",
            4_000,
        );

        let following = get_file_history(
            repo.path_str(),
            "new-name.txt".to_string(),
            None,
            Some(true),
        )
        .await
        .unwrap();
        let summaries: Vec<String> = following.iter().map(|e| e.commit.summary.clone()).collect();

        assert!(
            summaries.iter().any(|s| s == "Add original"),
            "history before the rename must be reachable, got {:?}",
            summaries
        );
        assert!(
            summaries.iter().any(|s| s == "Edit original"),
            "edits under the old name must be reachable, got {:?}",
            summaries
        );
        assert!(summaries.iter().any(|s| s == "Rename it"));
        assert!(summaries.iter().any(|s| s == "Edit after rename"));
    }

    /// With following OFF, the history stops at the rename — as asked.
    #[tokio::test]
    async fn test_get_file_history_without_following_stops_at_the_rename() {
        let repo = TestRepo::with_initial_commit();

        // Same topology-inconsistent timestamps as the following test, so the
        // two differ only in the flag under test.
        commit_file_at(&repo, "Add original", "old-name.txt", "line one\n", 3_000);
        commit_rename_at(&repo, "old-name.txt", "new-name.txt", "Rename it", 2_000);

        let not_following = get_file_history(
            repo.path_str(),
            "new-name.txt".to_string(),
            None,
            Some(false),
        )
        .await
        .unwrap();
        let summaries: Vec<String> = not_following
            .iter()
            .map(|e| e.commit.summary.clone())
            .collect();

        assert!(
            !summaries.iter().any(|s| s == "Add original"),
            "not following must not reach past the rename, got {:?}",
            summaries
        );
    }

    /// Every entry must carry the path the file had in ITS commit.
    ///
    /// Following a rename makes pre-rename commits reachable, but a bare
    /// `Commit` says nothing about where the file lived then, so the UI had
    /// only the file's current path to offer for diff/blame — a name that did
    /// not exist yet at those commits.
    #[tokio::test]
    async fn test_file_history_entries_carry_the_path_at_each_commit() {
        let repo = TestRepo::with_initial_commit();

        // Topology-inconsistent timestamps, as in the rename tests above.
        commit_file_at(&repo, "Add original", "old-name.txt", "line one\n", 1_000);
        commit_file_at(
            &repo,
            "Edit original",
            "old-name.txt",
            "line one\nline two\n",
            3_000,
        );
        commit_rename_at(&repo, "old-name.txt", "new-name.txt", "Rename it", 2_000);
        commit_file_at(
            &repo,
            "Edit after rename",
            "new-name.txt",
            "line one\nline two\nline three\n",
            4_000,
        );

        let entries = get_file_history(
            repo.path_str(),
            "new-name.txt".to_string(),
            None,
            Some(true),
        )
        .await
        .unwrap();

        let path_for = |summary: &str| -> String {
            entries
                .iter()
                .find(|e| e.commit.summary == summary)
                .unwrap_or_else(|| panic!("missing entry {:?}", summary))
                .path_at_commit
                .clone()
        };

        assert_eq!(
            path_for("Add original"),
            "old-name.txt",
            "a commit older than the rename must report the OLD path"
        );
        assert_eq!(
            path_for("Edit original"),
            "old-name.txt",
            "edits under the old name must report the OLD path"
        );
        assert_eq!(
            path_for("Rename it"),
            "new-name.txt",
            "at the renaming commit the file already exists under the new name"
        );
        assert_eq!(path_for("Edit after rename"), "new-name.txt");
    }

    /// The point of the per-entry path: it is actually diffable.
    ///
    /// The second half of this test is what every UI click on a pre-rename row
    /// used to do — pass the file's current name — and it still fails, which is
    /// exactly why the entry has to carry its own path.
    #[tokio::test]
    async fn test_file_history_path_at_commit_is_diffable() {
        let repo = TestRepo::with_initial_commit();

        commit_file_at(&repo, "Add original", "old-name.txt", "line one\n", 1_000);
        commit_rename_at(&repo, "old-name.txt", "new-name.txt", "Rename it", 2_000);

        let entries = get_file_history(
            repo.path_str(),
            "new-name.txt".to_string(),
            None,
            Some(true),
        )
        .await
        .unwrap();

        let entry = entries
            .iter()
            .find(|e| e.commit.summary == "Add original")
            .expect("pre-rename commit must be listed");

        let ok = crate::commands::diff::get_commit_file_diff(
            repo.path_str(),
            entry.commit.oid.clone(),
            entry.path_at_commit.clone(),
            None,
        )
        .await
        .expect("the path the entry reports must be diffable at that commit");
        assert_eq!(ok.path, "old-name.txt");

        let err = crate::commands::diff::get_commit_file_diff(
            repo.path_str(),
            entry.commit.oid.clone(),
            "new-name.txt".to_string(),
            None,
        )
        .await
        .expect_err("the file's CURRENT name does not exist at that commit");
        assert!(
            err.to_string().contains("File not found in commit"),
            "unexpected error: {}",
            err
        );
    }

    /// Edge case: nothing was renamed, so every entry keeps the requested path.
    #[tokio::test]
    async fn test_file_history_entries_use_the_requested_path_when_nothing_was_renamed() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Modify README", &[("README.md", "# Updated")]);
        repo.create_commit("Modify again", &[("README.md", "# Updated again")]);

        let entries = get_file_history(
            repo.path_str(),
            "README.md".to_string(),
            Some(100),
            Some(true),
        )
        .await
        .unwrap();

        assert_eq!(entries.len(), 3);
        for entry in &entries {
            assert_eq!(
                entry.path_at_commit, "README.md",
                "no rename happened, so every entry keeps the requested path"
            );
        }
    }

    #[tokio::test]
    async fn test_commit_history_all_branches_pagination_and_total() {
        let repo = TestRepo::with_initial_commit();
        for i in 0..9 {
            repo.create_commit(
                &format!("Commit {}", i),
                &[("file.txt", &format!("v{}", i))],
            );
        }

        // Full walk: 10 commits (initial + 9)
        let all = get_commit_history(repo.path_str(), None, Some(100), None, Some(true))
            .await
            .unwrap();
        assert_eq!(all.len(), 10);

        // Paged walk (served from the cache) must slice the same order
        let page1 = get_commit_history(repo.path_str(), None, Some(4), Some(0), Some(true))
            .await
            .unwrap();
        let page2 = get_commit_history(repo.path_str(), None, Some(4), Some(4), Some(true))
            .await
            .unwrap();
        let page3 = get_commit_history(repo.path_str(), None, Some(4), Some(8), Some(true))
            .await
            .unwrap();
        assert_eq!(page1.len(), 4);
        assert_eq!(page2.len(), 4);
        assert_eq!(page3.len(), 2);

        let paged_oids: Vec<String> = page1
            .iter()
            .chain(page2.iter())
            .chain(page3.iter())
            .map(|c| c.oid.clone())
            .collect();
        let all_oids: Vec<String> = all.iter().map(|c| c.oid.clone()).collect();
        assert_eq!(paged_oids, all_oids);

        let total = get_commit_total(repo.path_str()).await.unwrap();
        assert_eq!(total, 10);
    }

    #[tokio::test]
    async fn test_commit_history_cache_invalidates_on_new_commit() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second", &[("a.txt", "a")]);

        // Warm the cache
        let before = get_commit_history(repo.path_str(), None, Some(100), None, Some(true))
            .await
            .unwrap();
        assert_eq!(before.len(), 2);
        assert_eq!(get_commit_total(repo.path_str()).await.unwrap(), 2);

        // A new commit moves the branch tip — the fingerprint changes and
        // the stale cached walk must not be served
        repo.create_commit("Third", &[("b.txt", "b")]);
        let after = get_commit_history(repo.path_str(), None, Some(100), None, Some(true))
            .await
            .unwrap();
        assert_eq!(after.len(), 3);
        assert_eq!(after[0].summary, "Third");
        assert_eq!(get_commit_total(repo.path_str()).await.unwrap(), 3);
    }

    #[tokio::test]
    async fn test_commit_history_includes_detached_head_commits() {
        let repo = TestRepo::with_initial_commit();
        let base = repo.head_oid();
        repo.create_commit("On branch", &[("a.txt", "a")]);

        // Detach HEAD at the older commit and commit while detached — the
        // new commit is reachable ONLY from HEAD, not from any ref
        repo.repo().set_head_detached(base).unwrap();
        let detached = repo.create_commit("Detached work", &[("d.txt", "d")]);

        let commits = get_commit_history(repo.path_str(), None, Some(100), None, Some(true))
            .await
            .unwrap();
        assert!(
            commits.iter().any(|c| c.oid == detached.to_string()),
            "detached-HEAD commit must appear in the all-branches walk"
        );
        assert_eq!(get_commit_total(repo.path_str()).await.unwrap(), 3);
    }

    #[tokio::test]
    async fn test_commit_history_all_branches_includes_side_branches() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();
        repo.create_branch("side");
        repo.checkout_branch("side");
        repo.create_commit("Side commit", &[("side.txt", "side")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main commit", &[("main.txt", "main")]);

        let commits = get_commit_history(repo.path_str(), None, Some(100), None, Some(true))
            .await
            .unwrap();
        let summaries: Vec<&str> = commits.iter().map(|c| c.summary.as_str()).collect();
        assert!(summaries.contains(&"Side commit"));
        assert!(summaries.contains(&"Main commit"));
    }

    /// Committing with nothing staged must refuse, as `git commit` does.
    ///
    /// The only guard was the frontend's staged COUNT, and it goes stale the
    /// moment something unstages outside the app — a terminal, another tool,
    /// watcher lag. Pressing Commit then wrote a no-op commit into history with
    /// no warning at all.
    #[tokio::test]
    async fn test_create_commit_refuses_when_nothing_is_staged() {
        let repo = TestRepo::with_initial_commit();
        let before = repo.repo().head().unwrap().peel_to_commit().unwrap().id();

        let err = create_commit(
            repo.path_str(),
            "Nothing to see here".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await
        .expect_err("an empty commit must be refused");
        assert!(
            err.to_string().contains("No staged changes"),
            "unexpected error: {}",
            err
        );

        let after = repo.repo().head().unwrap().peel_to_commit().unwrap().id();
        assert_eq!(before, after, "HEAD must not move");
    }

    /// Amending a commit that is already on the remote must be detectable.
    ///
    /// Amend rewrites HEAD; when HEAD is published that rewrites history the
    /// remote already has, so the branch and its upstream diverge and the next
    /// push is rejected until someone force pushes. No amend surface warned,
    /// because nothing could tell.
    #[tokio::test]
    async fn test_is_head_published_detects_a_pushed_head() {
        let repo = TestRepo::with_initial_commit();
        let branch = repo.current_branch();
        let tip = repo.create_commit("Published", &[("a.txt", "a")]);

        // set_upstream needs a real remote to resolve its fetch refspec; the
        // URL is never contacted.
        repo.add_remote("origin", "/nonexistent/origin.git");

        // Stand up a remote-tracking ref at the same commit, with upstream
        // config — exactly the state a push leaves behind.
        {
            let git_repo = repo.repo();
            git_repo
                .reference(
                    &format!("refs/remotes/origin/{}", branch),
                    tip,
                    true,
                    "test",
                )
                .unwrap();
            let mut local = git_repo
                .find_branch(&branch, git2::BranchType::Local)
                .unwrap();
            local
                .set_upstream(Some(&format!("origin/{}", branch)))
                .unwrap();
        }

        assert!(
            is_head_published(repo.path_str()).await.unwrap(),
            "a commit sitting on its upstream is published"
        );
    }

    /// An upstream that has moved PAST head still means head was published.
    #[tokio::test]
    async fn test_is_head_published_when_the_upstream_is_ahead() {
        let repo = TestRepo::with_initial_commit();
        let branch = repo.current_branch();
        let published = repo.create_commit("Published", &[("a.txt", "a")]);
        let remote_only = repo.create_commit("Remote moved on", &[("b.txt", "b")]);
        repo.add_remote("origin", "/nonexistent/origin.git");

        {
            let git_repo = repo.repo();
            git_repo
                .reference(
                    &format!("refs/remotes/origin/{}", branch),
                    remote_only,
                    true,
                    "test",
                )
                .unwrap();
            let mut local = git_repo
                .find_branch(&branch, git2::BranchType::Local)
                .unwrap();
            local
                .set_upstream(Some(&format!("origin/{}", branch)))
                .unwrap();
            // Move the local branch back to the published commit.
            git_repo
                .reference(&format!("refs/heads/{}", branch), published, true, "test")
                .unwrap();
            git_repo
                .set_head(&format!("refs/heads/{}", branch))
                .unwrap();
        }

        assert!(
            is_head_published(repo.path_str()).await.unwrap(),
            "an upstream that contains head means head is published"
        );
    }

    /// The ordinary case must NOT warn.
    ///
    /// A local-only commit, a branch with no upstream at all, and an unpushed
    /// commit ahead of its upstream are all safe to amend. Warning on those
    /// would train the user to click through the one warning that matters.
    #[tokio::test]
    async fn test_is_head_published_is_false_for_unpublished_work() {
        // No upstream configured at all.
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Local only", &[("a.txt", "a")]);
        assert!(
            !is_head_published(repo.path_str()).await.unwrap(),
            "a branch with no upstream has nothing published"
        );

        // Upstream configured, but head is AHEAD of it.
        let repo = TestRepo::with_initial_commit();
        let branch = repo.current_branch();
        let published = repo.create_commit("Published", &[("a.txt", "a")]);
        repo.add_remote("origin", "/nonexistent/origin.git");
        {
            let git_repo = repo.repo();
            git_repo
                .reference(
                    &format!("refs/remotes/origin/{}", branch),
                    published,
                    true,
                    "test",
                )
                .unwrap();
            let mut local = git_repo
                .find_branch(&branch, git2::BranchType::Local)
                .unwrap();
            local
                .set_upstream(Some(&format!("origin/{}", branch)))
                .unwrap();
        }
        repo.create_commit("Not pushed yet", &[("b.txt", "b")]);
        assert!(
            !is_head_published(repo.path_str()).await.unwrap(),
            "an unpushed commit is safe to amend"
        );
    }

    /// A detached HEAD has no upstream to diverge from.
    #[tokio::test]
    async fn test_is_head_published_is_false_when_detached() {
        let repo = TestRepo::with_initial_commit();
        let tip = repo.create_commit("Second", &[("a.txt", "a")]);
        repo.repo().set_head_detached(tip).unwrap();

        assert!(!is_head_published(repo.path_str()).await.unwrap());
    }

    /// An empty INITIAL commit must be refused too.
    ///
    /// On an unborn HEAD there is no parent tree, so the head-tree comparison
    /// had nothing to match and every first commit was allowed through — even
    /// with an empty index. `git commit` refuses that one as well.
    #[tokio::test]
    async fn test_create_commit_refuses_an_empty_initial_commit() {
        let repo = TestRepo::new();

        let err = create_commit(
            repo.path_str(),
            "Initial commit".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await
        .expect_err("an empty initial commit must be refused");
        assert!(
            err.to_string().contains("No staged changes"),
            "unexpected error: {}",
            err
        );

        assert!(
            repo.repo().head().is_err(),
            "HEAD must still be unborn — no commit was created"
        );
    }

    /// Control: a real initial commit still works on an unborn HEAD.
    #[tokio::test]
    async fn test_create_commit_allows_a_real_initial_commit() {
        let repo = TestRepo::new();
        std::fs::write(repo.path.join("first.txt"), "content").unwrap();
        repo.stage_file("first.txt");

        create_commit(
            repo.path_str(),
            "Initial commit".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await
        .expect("an initial commit with staged content must succeed");

        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), Some("Initial commit"));
        assert_eq!(head.parent_count(), 0, "the initial commit has no parents");
    }

    /// Control: with something staged, the same call still commits.
    #[tokio::test]
    async fn test_create_commit_still_commits_staged_changes() {
        let repo = TestRepo::with_initial_commit();
        std::fs::write(repo.path.join("new.txt"), "content").unwrap();
        repo.stage_file("new.txt");

        create_commit(
            repo.path_str(),
            "Add new.txt".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await
        .expect("a commit with staged changes must succeed");

        let git_repo = repo.repo();
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.summary().unwrap(), Some("Add new.txt"));
    }

    /// Amending mid-merge must refuse, as `git commit --amend` does
    /// ("You are in the middle of a merge -- cannot amend.").
    ///
    /// The git2 amend branch rewrote the PRE-merge HEAD with its pre-merge
    /// parents, so MERGE_HEAD never became a parent and cleanup_state() — which
    /// only runs on the non-amend branch — never ran. The merge was silently
    /// dropped from the history while the repository stayed MERGING with the
    /// merged branch's changes baked into an ordinary commit.
    #[tokio::test]
    async fn test_create_commit_refuses_to_amend_mid_merge() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        repo.create_commit("Add shared", &[("shared.txt", "base")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);

        let merge_result = crate::commands::merge::merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(merge_result.is_err(), "expected merge conflict");

        crate::commands::merge::resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();

        let head_before = repo.repo().head().unwrap().peel_to_commit().unwrap().id();

        let err = create_commit(
            repo.path_str(),
            "Amended mid-merge".to_string(),
            Some(true),
            Some(false),
            None,
            None,
            None,
        )
        .await
        .expect_err("amending mid-merge must be refused");
        assert!(
            err.to_string().contains("Cannot amend while a merge"),
            "unexpected error: {}",
            err
        );

        // The merge is still there to finish or abort, and HEAD is untouched.
        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Merge);
        assert!(git_repo.path().join("MERGE_HEAD").exists());
        assert_eq!(
            git_repo.head().unwrap().peel_to_commit().unwrap().id(),
            head_before,
            "the pre-merge HEAD must not have been rewritten"
        );
    }

    #[tokio::test]
    async fn test_create_commit_mid_merge_includes_merge_head() {
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        // Conflicting merge, resolved manually, then committed from the
        // normal commit panel: the commit must get MERGE_HEAD as a second
        // parent and clear the MERGING state.
        repo.create_commit("Add shared", &[("shared.txt", "base")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        repo.create_commit("Feature change", &[("shared.txt", "feature content")]);
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);

        let merge_result = crate::commands::merge::merge(
            repo.path_str(),
            "feature".to_string(),
            Some(true),
            None,
            None,
        )
        .await;
        assert!(merge_result.is_err(), "expected merge conflict");

        crate::commands::merge::resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();

        let result = create_commit(
            repo.path_str(),
            "Commit during merge".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_ok(), "commit failed: {:?}", result.err());

        let git_repo = repo.repo();
        assert_eq!(git_repo.state(), git2::RepositoryState::Clean);
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.parent_count(),
            2,
            "commit made mid-merge must keep MERGE_HEAD as a parent"
        );
    }

    #[tokio::test]
    async fn test_get_commit_history() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content")]);
        repo.create_commit("Third commit", &[("file3.txt", "content")]);

        let result = get_commit_history(repo.path_str(), None, Some(10), None, None).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 3);
        // Commits are in reverse chronological order
        assert!(commits[0].summary.contains("Third"));
        assert!(commits[1].summary.contains("Second"));
        assert!(commits[2].summary.contains("Initial"));
    }

    #[tokio::test]
    async fn test_get_commit_history_with_limit() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content")]);
        repo.create_commit("Third commit", &[("file3.txt", "content")]);

        let result = get_commit_history(repo.path_str(), None, Some(2), None, None).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
    }

    #[tokio::test]
    async fn test_get_commit_history_with_skip() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Second commit", &[("file2.txt", "content")]);
        repo.create_commit("Third commit", &[("file3.txt", "content")]);

        let result = get_commit_history(repo.path_str(), None, Some(10), Some(1), None).await;
        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
        // Should skip the most recent commit
        assert!(commits[0].summary.contains("Second"));
    }

    #[tokio::test]
    async fn test_get_commit() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result = get_commit(repo.path_str(), oid.to_string()).await;
        assert!(result.is_ok());
        let commit = result.unwrap();
        assert_eq!(commit.oid, oid.to_string());
        assert!(commit.summary.contains("Initial"));
    }

    #[tokio::test]
    async fn test_get_commit_not_found() {
        let repo = TestRepo::with_initial_commit();
        let fake_oid = "0000000000000000000000000000000000000000".to_string();

        let result = get_commit(repo.path_str(), fake_oid).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_commit() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file("new-file.txt", "new content");
        repo.stage_file("new-file.txt");

        let result = create_commit(
            repo.path_str(),
            "Test commit message".to_string(),
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        let commit = result.unwrap();
        assert!(commit.summary.contains("Test commit message"));
    }

    #[tokio::test]
    async fn test_create_empty_commit() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();

        // Create an empty commit (no staged changes)
        let result = create_commit(
            repo.path_str(),
            "Empty commit message".to_string(),
            None,
            None,
            Some(true),
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        let commit = result.unwrap();
        assert!(commit.summary.contains("Empty commit message"));
        // The new commit should have a different OID from the initial commit
        assert_ne!(commit.oid, initial_oid.to_string());
    }

    // Note: The amend test is complex because git2's commit() with update_ref
    // has safety checks that conflict with how we build the parent list.
    // In production, amend works through the UI flow which handles this properly.
    // Skipping this test for now - the amend functionality works in the app.

    #[tokio::test]
    async fn test_search_commits_by_message() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Add feature X", &[("feature.txt", "x")]);
        repo.create_commit("Fix bug Y", &[("bugfix.txt", "y")]);

        let result = search_commits(
            repo.path_str(),
            Some("feature".to_string()),
            None,
            None,
            None,
            None,
            None,
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 1);
        assert!(commits[0].summary.contains("feature"));
    }

    #[tokio::test]
    async fn test_search_commits_by_sha() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();
        let short_sha = &oid.to_string()[..7];

        let result = search_commits(
            repo.path_str(),
            Some(short_sha.to_string()),
            None,
            None,
            None,
            None,
            None,
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 1);
    }

    #[tokio::test]
    async fn test_search_commits_by_author() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Another commit", &[("file.txt", "content")]);

        let result = search_commits(
            repo.path_str(),
            None,
            Some("Test User".to_string()),
            None,
            None,
            None,
            None,
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 2);
    }

    #[tokio::test]
    async fn test_search_commits_no_match() {
        let repo = TestRepo::with_initial_commit();

        let result = search_commits(
            repo.path_str(),
            Some("nonexistent message xyz123".to_string()),
            None,
            None,
            None,
            None,
            None,
            Some(100),
        )
        .await;

        assert!(result.is_ok());
        let commits = result.unwrap();
        assert!(commits.is_empty());
    }

    #[tokio::test]
    async fn test_get_file_history() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Modify README", &[("README.md", "# Updated")]);
        repo.create_commit("Modify again", &[("README.md", "# Updated again")]);

        let result = get_file_history(
            repo.path_str(),
            "README.md".to_string(),
            Some(100),
            Some(true),
        )
        .await;

        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 3); // Initial + 2 modifications
    }

    #[tokio::test]
    async fn test_get_file_history_with_limit() {
        let repo = TestRepo::with_initial_commit();
        repo.create_commit("Modify README", &[("README.md", "# Updated")]);
        repo.create_commit("Modify again", &[("README.md", "# Updated again")]);

        let result = get_file_history(
            repo.path_str(),
            "README.md".to_string(),
            Some(2),
            Some(true),
        )
        .await;

        assert!(result.is_ok());
        let entries = result.unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[tokio::test]
    async fn test_get_file_history_nonexistent_file() {
        let repo = TestRepo::with_initial_commit();

        let result = get_file_history(
            repo.path_str(),
            "nonexistent.txt".to_string(),
            Some(100),
            Some(true),
        )
        .await;

        assert!(result.is_ok());
        let entries = result.unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn test_commit_has_author_info() {
        let repo = TestRepo::with_initial_commit();
        let result = get_commit(repo.path_str(), repo.head_oid().to_string()).await;

        assert!(result.is_ok());
        let commit = result.unwrap();
        assert_eq!(commit.author.name, "Test User");
        assert_eq!(commit.author.email, "test@example.com");
    }

    #[tokio::test]
    async fn test_commit_has_parent() {
        let repo = TestRepo::with_initial_commit();
        let initial_oid = repo.head_oid();
        repo.create_commit("Second", &[("file.txt", "content")]);

        let result = get_commit(repo.path_str(), repo.head_oid().to_string()).await;
        assert!(result.is_ok());
        let commit = result.unwrap();
        assert_eq!(commit.parent_ids.len(), 1);
        assert_eq!(commit.parent_ids[0], initial_oid.to_string());
    }

    #[tokio::test]
    async fn test_get_commit_message() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result = get_commit_message(repo.path_str(), oid.to_string()).await;
        assert!(result.is_ok());
        let message = result.unwrap();
        assert!(message.contains("Initial commit"));
    }

    #[tokio::test]
    async fn test_get_commit_message_not_found() {
        let repo = TestRepo::with_initial_commit();
        let fake_oid = "0000000000000000000000000000000000000000".to_string();

        let result = get_commit_message(repo.path_str(), fake_oid).await;
        assert!(result.is_err());
    }

    /// Amending through create_commit must actually succeed.
    ///
    /// The commit panel sends {message, amend} to create_commit, which took the
    /// git2 path whenever commit.gpgsign was off. That path called
    /// repo.commit(Some("HEAD"), .., parents-of-HEAD), and libgit2 rejects it
    /// because the ref's tip is not the new commit's first parent — so amend
    /// failed outright with "current tip is not the first parent" for every
    /// repository without signing enabled.
    #[tokio::test]
    async fn test_unsigned_amend_replaces_head_instead_of_failing() {
        let test_repo = TestRepo::with_initial_commit();
        let first = test_repo.head_oid();
        test_repo.create_commit("Second", &[("a.txt", "content")]);
        let before = test_repo.head_oid();

        let result = create_commit(
            test_repo.path_str(),
            "Amended second".to_string(),
            Some(true),
            Some(false), // unsigned: the git2 path
            None,
            None,
            None,
        )
        .await;

        assert!(
            result.is_ok(),
            "unsigned amend must succeed, got: {:?}",
            result.err()
        );

        let repo = test_repo.repo();
        let head = repo.head().unwrap().peel_to_commit().unwrap();

        assert_eq!(head.message().unwrap().trim(), "Amended second");
        assert_ne!(head.id(), before, "amend must replace the tip");
        assert_eq!(head.parent_count(), 1, "the original parent is preserved");
        assert_eq!(head.parent_id(0).unwrap(), first);
    }

    /// `git commit --amend` preserves the ORIGINAL author identity and author
    /// date; only `--reset-author` changes them.
    ///
    /// The commit panel sends only message+amend, so every amend through it
    /// silently re-attributed the commit to the current user and reset its
    /// author date to now — and only when commit.gpgsign was OFF, since the
    /// signed path shells out to `git commit --amend`, which gets it right.
    #[tokio::test]
    async fn test_amend_preserves_the_original_author() {
        let test_repo = TestRepo::with_initial_commit();

        const ORIGINAL_TIME: i64 = 1_000_000_000;
        {
            let repo = test_repo.repo();
            test_repo.create_file("a.txt", "content");
            test_repo.stage_file("a.txt");

            let mut index = repo.index().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_oid).unwrap();

            let author = git2::Signature::new(
                "Original Author",
                "original@example.com",
                &git2::Time::new(ORIGINAL_TIME, 0),
            )
            .unwrap();
            let committer = repo.signature().unwrap();
            let parent = repo.head().unwrap().peel_to_commit().unwrap();

            repo.commit(
                Some("HEAD"),
                &author,
                &committer,
                "Original message",
                &tree,
                &[&parent],
            )
            .unwrap();
        }

        create_commit(
            test_repo.path_str(),
            "Amended message".to_string(),
            Some(true),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let repo = test_repo.repo();
        let amended = repo.head().unwrap().peel_to_commit().unwrap();
        let local = repo.signature().unwrap();

        assert_eq!(amended.message().unwrap().trim(), "Amended message");

        // Author untouched, timestamp included.
        assert_eq!(amended.author().name().unwrap(), "Original Author");
        assert_eq!(amended.author().email().unwrap(), "original@example.com");
        assert_eq!(amended.author().when().seconds(), ORIGINAL_TIME);

        // Committer is whoever performed the amend.
        assert_eq!(amended.committer().name().unwrap(), local.name().unwrap());
    }

    /// A reword changes the message and nothing else. Passing the fresh
    /// signature as author re-attributed a colleague's commit to whoever
    /// reworded it, and the new author date reordered it in date-sorted views.
    #[tokio::test]
    async fn test_reword_head_preserves_the_original_author() {
        let test_repo = TestRepo::with_initial_commit();

        const ORIGINAL_TIME: i64 = 1_000_000_000;
        {
            let repo = test_repo.repo();
            test_repo.create_file("b.txt", "content");
            test_repo.stage_file("b.txt");

            let mut index = repo.index().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_oid).unwrap();

            let author = git2::Signature::new(
                "Colleague",
                "colleague@example.com",
                &git2::Time::new(ORIGINAL_TIME, 0),
            )
            .unwrap();
            let committer = repo.signature().unwrap();
            let parent = repo.head().unwrap().peel_to_commit().unwrap();

            repo.commit(
                Some("HEAD"),
                &author,
                &committer,
                "Typo in mesage",
                &tree,
                &[&parent],
            )
            .unwrap();
        }

        amend_commit_message(test_repo.path_str(), "Fix typo in message".to_string())
            .await
            .unwrap();

        let repo = test_repo.repo();
        let reworded = repo.head().unwrap().peel_to_commit().unwrap();

        assert_eq!(reworded.message().unwrap().trim(), "Fix typo in message");
        assert_eq!(reworded.author().name().unwrap(), "Colleague");
        assert_eq!(reworded.author().email().unwrap(), "colleague@example.com");
        assert_eq!(reworded.author().when().seconds(), ORIGINAL_TIME);
    }

    #[tokio::test]
    async fn test_amend_commit_with_new_message() {
        let repo = TestRepo::with_initial_commit();
        let old_oid = repo.head_oid();

        let result = amend_commit(
            repo.path_str(),
            Some("Amended commit message".to_string()),
            None,
            Some(false), // Explicitly disable signing to avoid CI gpgsign config
        )
        .await;

        assert!(result.is_ok());
        let amend_result = result.unwrap();
        assert!(amend_result.success);
        assert_eq!(amend_result.old_oid, old_oid.to_string());
        assert_ne!(amend_result.new_oid, old_oid.to_string());

        // Verify the new message
        let commit_result = get_commit(repo.path_str(), amend_result.new_oid.clone()).await;
        assert!(commit_result.is_ok());
        assert_eq!(commit_result.unwrap().summary, "Amended commit message");
    }

    #[tokio::test]
    async fn test_amend_commit_keep_message() {
        let repo = TestRepo::with_initial_commit();
        let old_oid = repo.head_oid();

        // Get original message
        let original_message = get_commit_message(repo.path_str(), old_oid.to_string())
            .await
            .unwrap();

        // Amend without changing message, explicitly disable signing for CI
        let result = amend_commit(repo.path_str(), None, None, Some(false)).await;

        assert!(result.is_ok());
        let amend_result = result.unwrap();
        assert!(amend_result.success);

        // Verify message is preserved
        let new_message = get_commit_message(repo.path_str(), amend_result.new_oid.clone())
            .await
            .unwrap();
        assert_eq!(new_message, original_message);
    }

    #[tokio::test]
    async fn test_amend_result_serialization() {
        let result = AmendResult {
            new_oid: "abc123".to_string(),
            old_oid: "def456".to_string(),
            success: true,
        };

        let json = serde_json::to_string(&result);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("\"newOid\":\"abc123\""));
        assert!(json_str.contains("\"oldOid\":\"def456\""));
        assert!(json_str.contains("\"success\":true"));
    }

    #[test]
    fn test_parse_iso8601_utc() {
        let time = parse_iso8601_to_git_time("2024-01-15T10:30:00Z").unwrap();
        // 2024-01-15T10:30:00Z = 1705314600
        assert_eq!(time.seconds(), 1705314600);
        assert_eq!(time.offset_minutes(), 0);
    }

    #[test]
    fn test_parse_iso8601_positive_offset() {
        let time = parse_iso8601_to_git_time("2024-01-15T15:30:00+05:00").unwrap();
        // 2024-01-15T15:30:00+05:00 = 2024-01-15T10:30:00Z = 1705314600
        assert_eq!(time.seconds(), 1705314600);
        assert_eq!(time.offset_minutes(), 300);
    }

    #[test]
    fn test_parse_iso8601_negative_offset() {
        let time = parse_iso8601_to_git_time("2024-01-15T07:30:00-03:00").unwrap();
        // 2024-01-15T07:30:00-03:00 = 2024-01-15T10:30:00Z = 1705314600
        assert_eq!(time.seconds(), 1705314600);
        assert_eq!(time.offset_minutes(), -180);
    }

    #[test]
    fn test_parse_unix_timestamp() {
        let time = parse_iso8601_to_git_time("1705312200").unwrap();
        assert_eq!(time.seconds(), 1705312200);
        assert_eq!(time.offset_minutes(), 0);
    }

    #[test]
    fn test_parse_iso8601_invalid_format() {
        let result = parse_iso8601_to_git_time("not-a-date");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_iso8601_no_time() {
        let result = parse_iso8601_to_git_time("2024-01-15");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_commit_with_custom_author_date() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file("dated-file.txt", "content");
        repo.stage_file("dated-file.txt");

        let custom_date = "2020-06-15T12:00:00Z"; // June 15, 2020 at noon UTC
        let result = create_commit(
            repo.path_str(),
            "Commit with custom date".to_string(),
            None,
            None,
            None,
            Some(custom_date.to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
        let commit = result.unwrap();
        assert!(commit.summary.contains("Commit with custom date"));

        // Verify the author date was set correctly
        // 2020-06-15T12:00:00Z = 1592222400
        assert_eq!(commit.author.timestamp, 1592222400);
    }

    #[tokio::test]
    async fn test_create_commit_with_custom_committer_date() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file("dated-file2.txt", "content");
        repo.stage_file("dated-file2.txt");

        let custom_date = "2020-06-15T12:00:00Z"; // June 15, 2020 at noon UTC
        let result = create_commit(
            repo.path_str(),
            "Commit with custom committer date".to_string(),
            None,
            None,
            None,
            None,
            Some(custom_date.to_string()),
        )
        .await;

        assert!(result.is_ok());
        let commit = result.unwrap();
        // Verify the committer date was set
        assert_eq!(commit.committer.timestamp, 1592222400);
    }

    #[tokio::test]
    async fn test_create_commit_with_both_custom_dates() {
        let repo = TestRepo::with_initial_commit();
        repo.create_file("dated-file3.txt", "content");
        repo.stage_file("dated-file3.txt");

        let author_date = "2020-06-15T12:00:00Z";
        let committer_date = "2021-03-20T08:00:00Z"; // March 20, 2021 at 8am UTC = 1616227200

        let result = create_commit(
            repo.path_str(),
            "Commit with both custom dates".to_string(),
            None,
            None,
            None,
            Some(author_date.to_string()),
            Some(committer_date.to_string()),
        )
        .await;

        assert!(result.is_ok());
        let commit = result.unwrap();
        assert_eq!(commit.author.timestamp, 1592222400);
        assert_eq!(commit.committer.timestamp, 1616227200);
    }

    #[tokio::test]
    async fn test_edit_commit_date_head_author() {
        let repo = TestRepo::with_initial_commit();
        let old_oid = repo.head_oid();

        let new_date = "2019-12-25T00:00:00Z"; // Christmas 2019 = 1577232000

        let result = edit_commit_date(
            repo.path_str(),
            old_oid.to_string(),
            Some(new_date.to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
        let amend_result = result.unwrap();
        assert!(amend_result.success);
        assert_eq!(amend_result.old_oid, old_oid.to_string());
        assert_ne!(amend_result.new_oid, old_oid.to_string());

        // Verify the new author date
        let commit_result = get_commit(repo.path_str(), amend_result.new_oid).await;
        assert!(commit_result.is_ok());
        let commit = commit_result.unwrap();
        assert_eq!(commit.author.timestamp, 1577232000);
    }

    #[tokio::test]
    async fn test_edit_commit_date_head_committer() {
        let repo = TestRepo::with_initial_commit();
        let old_oid = repo.head_oid();

        let new_date = "2019-12-25T00:00:00Z"; // Christmas 2019

        let result = edit_commit_date(
            repo.path_str(),
            old_oid.to_string(),
            None,
            Some(new_date.to_string()),
        )
        .await;

        assert!(result.is_ok());
        let amend_result = result.unwrap();
        assert!(amend_result.success);

        // Verify the new committer date
        let commit_result = get_commit(repo.path_str(), amend_result.new_oid).await;
        assert!(commit_result.is_ok());
        let commit = commit_result.unwrap();
        assert_eq!(commit.committer.timestamp, 1577232000);
    }

    #[tokio::test]
    async fn test_edit_commit_date_head_both_dates() {
        let repo = TestRepo::with_initial_commit();
        let old_oid = repo.head_oid();

        let author_date = "2019-12-25T00:00:00Z"; // 1577232000
        let committer_date = "2020-01-01T00:00:00Z"; // 1577836800

        let result = edit_commit_date(
            repo.path_str(),
            old_oid.to_string(),
            Some(author_date.to_string()),
            Some(committer_date.to_string()),
        )
        .await;

        assert!(result.is_ok());
        let amend_result = result.unwrap();
        assert!(amend_result.success);

        let commit_result = get_commit(repo.path_str(), amend_result.new_oid).await;
        assert!(commit_result.is_ok());
        let commit = commit_result.unwrap();
        assert_eq!(commit.author.timestamp, 1577232000);
        assert_eq!(commit.committer.timestamp, 1577836800);
    }

    #[tokio::test]
    async fn test_edit_commit_date_no_dates_provided() {
        let repo = TestRepo::with_initial_commit();
        let oid = repo.head_oid();

        let result = edit_commit_date(repo.path_str(), oid.to_string(), None, None).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_commit_date_invalid_commit() {
        let repo = TestRepo::with_initial_commit();
        let fake_oid = "0000000000000000000000000000000000000000".to_string();

        let result = edit_commit_date(
            repo.path_str(),
            fake_oid,
            Some("2020-01-01T00:00:00Z".to_string()),
            None,
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_commit_date_preserves_message() {
        let repo = TestRepo::with_initial_commit();
        let old_oid = repo.head_oid();

        // Get original message
        let original_message = get_commit_message(repo.path_str(), old_oid.to_string())
            .await
            .unwrap();

        let result = edit_commit_date(
            repo.path_str(),
            old_oid.to_string(),
            Some("2020-06-15T12:00:00Z".to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
        let amend_result = result.unwrap();

        // Verify message is preserved
        let new_message = get_commit_message(repo.path_str(), amend_result.new_oid)
            .await
            .unwrap();
        assert_eq!(new_message, original_message);
    }

    #[tokio::test]
    async fn test_edit_commit_date_preserves_author_info() {
        let repo = TestRepo::with_initial_commit();
        let old_oid = repo.head_oid();

        // Get original author info
        let original = get_commit(repo.path_str(), old_oid.to_string())
            .await
            .unwrap();

        let result = edit_commit_date(
            repo.path_str(),
            old_oid.to_string(),
            Some("2020-06-15T12:00:00Z".to_string()),
            None,
        )
        .await;

        assert!(result.is_ok());
        let amend_result = result.unwrap();

        let new_commit = get_commit(repo.path_str(), amend_result.new_oid)
            .await
            .unwrap();
        // Author name and email should be preserved
        assert_eq!(new_commit.author.name, original.author.name);
        assert_eq!(new_commit.author.email, original.author.email);
        // Only the date should change
        assert_ne!(new_commit.author.timestamp, original.author.timestamp);
    }

    #[test]
    fn test_is_leap_year() {
        assert!(is_leap_year(2000));
        assert!(is_leap_year(2024));
        assert!(!is_leap_year(1900));
        assert!(!is_leap_year(2023));
        assert!(is_leap_year(2400));
    }

    #[tokio::test]
    async fn test_create_commit_mid_cherrypick_clears_state() {
        // A cherry-pick that conflicts leaves CHERRY_PICK_HEAD set. Resolving
        // and committing via the normal commit panel must produce a SINGLE
        // parent commit AND clear the sequencer state, otherwise the app stays
        // stuck showing "cherry-pick in progress".
        let repo = TestRepo::with_initial_commit();
        let initial_branch = repo.current_branch();

        repo.create_commit("Add shared", &[("shared.txt", "base")]);
        repo.create_branch("feature");
        repo.checkout_branch("feature");
        let pick_oid = repo.create_commit("Feature change", &[("shared.txt", "feature content")]);

        // Divergent change on the base branch so the cherry-pick conflicts.
        repo.checkout_branch(&initial_branch);
        repo.create_commit("Main change", &[("shared.txt", "main content")]);

        {
            let git_repo = repo.repo();
            let commit = git_repo.find_commit(pick_oid).unwrap();
            // A conflicting cherry-pick still sets CHERRY_PICK_HEAD.
            let _ = git_repo.cherrypick(&commit, None);
            assert_eq!(git_repo.state(), git2::RepositoryState::CherryPick);
        }

        // Resolve by staging the file.
        crate::commands::merge::resolve_conflict(
            repo.path_str(),
            "shared.txt".to_string(),
            "resolved".to_string(),
            None,
        )
        .await
        .unwrap();

        let result = create_commit(
            repo.path_str(),
            "Cherry-picked change".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_ok(), "commit failed: {:?}", result.err());

        let git_repo = repo.repo();
        assert_eq!(
            git_repo.state(),
            git2::RepositoryState::Clean,
            "cherry-pick state must be cleared after committing"
        );
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.parent_count(),
            1,
            "a cherry-pick commit keeps a single parent"
        );
    }

    #[tokio::test]
    async fn test_create_commit_mid_revert_clears_state() {
        // A revert leaves REVERT_HEAD set; committing must clear it and keep a
        // single parent.
        let repo = TestRepo::with_initial_commit();
        let target = repo.create_commit("Add file", &[("revert_me.txt", "content")]);

        {
            let git_repo = repo.repo();
            let commit = git_repo.find_commit(target).unwrap();
            git_repo.revert(&commit, None).unwrap();
            assert_eq!(git_repo.state(), git2::RepositoryState::Revert);
        }

        let result = create_commit(
            repo.path_str(),
            "Revert add file".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_ok(), "commit failed: {:?}", result.err());

        let git_repo = repo.repo();
        assert_eq!(
            git_repo.state(),
            git2::RepositoryState::Clean,
            "revert state must be cleared after committing"
        );
        let head = git_repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head.parent_count(),
            1,
            "a revert commit keeps a single parent"
        );
    }

    // Finding 100: amend_commit_message must honor commit.gpgsign and re-sign the
    // reworded commit rather than emit it unsigned (libgit2 cannot sign).
    #[tokio::test]
    async fn test_amend_commit_message_signs_when_gpgsign_enabled() {
        let repo = TestRepo::with_initial_commit();

        // Configure SSH signing; skip if ssh-keygen is unavailable.
        let keydir = tempfile::TempDir::new().unwrap();
        let key = keydir.path().join("id");
        let gen = std::process::Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "", "-f", key.to_str().unwrap(), "-q"])
            .output();
        if gen.map(|o| !o.status.success()).unwrap_or(true) {
            return;
        }
        let pubkey = format!("{}.pub", key.to_str().unwrap());
        for (k, v) in [
            ("gpg.format", "ssh"),
            ("user.signingkey", pubkey.as_str()),
            ("commit.gpgsign", "true"),
        ] {
            std::process::Command::new("git")
                .current_dir(&repo.path)
                .args(["config", k, v])
                .output()
                .unwrap();
        }

        let commit = amend_commit_message(repo.path_str(), "Reworded and signed".to_string())
            .await
            .unwrap();
        assert_eq!(commit.summary, "Reworded and signed");

        // The reworded commit must carry a signature.
        let git_repo = repo.repo();
        let oid = git2::Oid::from_str(&commit.oid).unwrap();
        assert!(
            git_repo.extract_signature(&oid, None).is_ok(),
            "amended commit must be signed when commit.gpgsign=true"
        );
    }

    // ---- Hook parity (git2 commit path) ----

    #[cfg(unix)]
    #[tokio::test]
    async fn test_create_commit_pre_commit_hook_aborts() {
        let repo = TestRepo::with_initial_commit();
        let head_before = repo.head_oid();
        repo.install_hook("pre-commit", "#!/bin/sh\necho blocked 1>&2\nexit 1\n");
        repo.create_file("new.txt", "x");
        repo.stage_file("new.txt");

        let result = create_commit(
            repo.path_str(),
            "Should be blocked".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_err(), "pre-commit exit 1 must abort the commit");
        assert!(result.unwrap_err().to_string().contains("blocked"));
        // HEAD must not have advanced.
        assert_eq!(repo.head_oid(), head_before);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_create_commit_runs_post_commit_hook() {
        let repo = TestRepo::with_initial_commit();
        let marker = repo.path.join("post-commit-ran");
        repo.install_hook(
            "post-commit",
            &format!("#!/bin/sh\ntouch \"{}\"\n", marker.display()),
        );
        repo.create_file("new.txt", "x");
        repo.stage_file("new.txt");

        let result = create_commit(
            repo.path_str(),
            "With post-commit".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_ok());
        assert!(marker.exists(), "post-commit hook must run after commit");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_create_commit_commit_msg_hook_rewrites() {
        let repo = TestRepo::with_initial_commit();
        repo.install_hook(
            "commit-msg",
            "#!/bin/sh\nprintf '\\nEdited-by: hook' >> \"$1\"\n",
        );
        repo.create_file("new.txt", "x");
        repo.stage_file("new.txt");

        let commit = create_commit(
            repo.path_str(),
            "Base message".to_string(),
            None,
            Some(false),
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let full = get_commit_message(repo.path_str(), commit.oid)
            .await
            .unwrap();
        assert!(
            full.contains("Edited-by: hook"),
            "commit-msg rewrite must be persisted, got: {full:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_amend_commit_pre_commit_hook_aborts() {
        let repo = TestRepo::with_initial_commit();
        let head_before = repo.head_oid();
        repo.install_hook("pre-commit", "#!/bin/sh\nexit 1\n");

        let result = amend_commit(
            repo.path_str(),
            Some("new msg".to_string()),
            None,
            Some(false),
        )
        .await;
        assert!(result.is_err(), "amend must honor pre-commit");
        assert_eq!(repo.head_oid(), head_before, "HEAD must not move");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_amend_commit_runs_post_commit_and_commit_msg_hooks() {
        let repo = TestRepo::with_initial_commit();
        let marker = repo.path.join("amend-post-commit");
        repo.install_hook(
            "post-commit",
            &format!("#!/bin/sh\ntouch \"{}\"\n", marker.display()),
        );
        repo.install_hook("commit-msg", "#!/bin/sh\nprintf '\\ntrailer' >> \"$1\"\n");

        let result = amend_commit(
            repo.path_str(),
            Some("Reworded".to_string()),
            None,
            Some(false),
        )
        .await
        .unwrap();
        assert!(marker.exists(), "post-commit must run on amend");
        let full = get_commit_message(repo.path_str(), result.new_oid)
            .await
            .unwrap();
        assert!(full.contains("trailer"), "commit-msg rewrite must persist");
    }
}
