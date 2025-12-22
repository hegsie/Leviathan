# Technical Spike: libgit2 Limitations & Mitigation Strategies

## Executive Summary

libgit2 (via git2-rs) is the recommended git library for our project, but it doesn't support 100% of git's functionality. This document analyzes the gaps, proposes mitigation strategies, and provides a decision framework for when to fall back to the git CLI.

---

# Table of Contents

1. [libgit2 Overview](#1-libgit2-overview)
2. [Feature Comparison Matrix](#2-feature-comparison-matrix)
3. [Critical Limitations Analysis](#3-critical-limitations-analysis)
4. [Mitigation Strategies](#4-mitigation-strategies)
5. [CLI Fallback Architecture](#5-cli-fallback-architecture)
6. [Alternative: gitoxide](#6-alternative-gitoxide)
7. [Testing Strategy](#7-testing-strategy)
8. [Recommendations](#8-recommendations)

---

# 1. libgit2 Overview

## 1.1 What is libgit2?

libgit2 is a portable, pure C implementation of Git core methods. It's used by:

| Product | Usage |
|---------|-------|
| GitHub Desktop | Primary git engine |
| Visual Studio | Git integration |
| Sublime Merge | Primary git engine |
| GitButler | Primary git engine |
| Rust (Cargo) | Dependency fetching |

**git2-rs** is the Rust binding to libgit2, which is what we'd use with Tauri.

## 1.2 libgit2 Strengths

| Strength | Details |
|----------|---------|
| **Cross-platform** | Works identically on Windows, macOS, Linux |
| **No git installation required** | Self-contained, no PATH dependencies |
| **Thread-safe** | Can run operations in parallel |
| **Embeddable** | Links directly into your application |
| **Well-tested** | Used in production by major products |
| **Predictable** | No shell escaping issues |
| **Programmable callbacks** | Progress, credentials, certificate checks |

## 1.3 libgit2 Design Philosophy

libgit2 intentionally does NOT replicate all git CLI behavior:

> "libgit2 is not a reimplementation of the git command-line tool. It is a library that provides programmatic access to git repositories."

This means:
- No porcelain commands (just plumbing)
- No automatic conflict resolution
- No interactive features
- No hooks execution by default
- Different defaults than git CLI in some cases

---

# 2. Feature Comparison Matrix

## 2.1 Core Operations

| Operation | libgit2 | Notes |
|-----------|---------|-------|
| **Repository** | | |
| Init | ✅ Full | |
| Clone | ✅ Full | With progress callbacks |
| Open | ✅ Full | |
| Discover (.git search) | ✅ Full | |
| **Commits** | | |
| Create commit | ✅ Full | |
| Read commit | ✅ Full | |
| Amend commit | ✅ Full | Manual implementation |
| **Branches** | | |
| Create | ✅ Full | |
| Delete | ✅ Full | |
| Rename | ✅ Full | |
| List | ✅ Full | |
| Checkout | ✅ Full | |
| **Index/Staging** | | |
| Add files | ✅ Full | |
| Remove files | ✅ Full | |
| Read index | ✅ Full | |
| **Diff** | | |
| Tree-to-tree | ✅ Full | |
| Index-to-workdir | ✅ Full | |
| Blob-to-blob | ✅ Full | |
| Patch generation | ✅ Full | |
| **Merge** | | |
| Merge analysis | ✅ Full | |
| Merge commits | ✅ Full | |
| Merge files | ✅ Full | |
| Conflict detection | ✅ Full | |
| **Remotes** | | |
| Add/remove | ✅ Full | |
| Fetch | ✅ Full | With progress |
| Push | ✅ Full | With progress |
| **References** | | |
| Create/delete | ✅ Full | |
| Resolve | ✅ Full | |
| Reflog | ✅ Full | |
| **Tags** | | |
| Lightweight | ✅ Full | |
| Annotated | ✅ Full | |
| **Blame** | ✅ Full | |
| **Config** | ✅ Full | |

## 2.2 Partial/Limited Support

| Operation | libgit2 | Limitation | Workaround |
|-----------|---------|------------|------------|
| **Stash** | ⚠️ Partial | No stash with untracked (--include-untracked) | Manual implementation or CLI |
| **Rebase** | ⚠️ Partial | Basic rebase only, no interactive | CLI for interactive |
| **Cherry-pick** | ⚠️ Partial | Single commit only | Loop for ranges |
| **Submodules** | ⚠️ Partial | Init/update work, some edge cases fail | CLI for complex cases |
| **Worktrees** | ⚠️ Partial | Basic support, some operations missing | CLI fallback |
| **Shallow clones** | ⚠️ Partial | Can clone shallow, some operations limited | CLI for unshallow |
| **Sparse checkout** | ⚠️ Partial | Limited cone mode support | CLI required |
| **Bundle** | ⚠️ Partial | Read-only support | CLI for creation |
| **Notes** | ⚠️ Partial | Basic read/write | CLI for complex ops |

## 2.3 Not Supported

| Operation | libgit2 | Alternative |
|-----------|---------|-------------|
| **Interactive rebase** | ❌ None | CLI required |
| **git bisect** | ❌ None | CLI required |
| **git filter-branch** | ❌ None | CLI or git-filter-repo |
| **git gc / maintenance** | ❌ None | CLI required |
| **git fsck** | ❌ None | CLI required |
| **git archive** | ❌ None | CLI required |
| **git format-patch** | ❌ None | Manual or CLI |
| **git am** | ❌ None | Manual or CLI |
| **git send-email** | ❌ None | CLI required |
| **git svn** | ❌ None | CLI required |
| **git lfs** | ❌ None | git-lfs CLI required |
| **git annex** | ❌ None | CLI required |
| **Hooks execution** | ❌ None | Manual execution |
| **git credential** | ❌ None | Custom or CLI |
| **git maintenance** | ❌ None | CLI required |
| **Commit signing (SSH)** | ❌ None | GPG only, or CLI |
| **git rerere** | ❌ None | CLI required |

## 2.4 Behavioral Differences

| Behavior | git CLI | libgit2 | Impact |
|----------|---------|---------|--------|
| **Default branch** | Reads from config/init.defaultBranch | "master" unless specified | Must explicitly set |
| **Line endings** | Complex autocrlf logic | Simpler handling | May differ on Windows |
| **File modes** | Respects core.fileMode | Different defaults | May need manual config |
| **Symlinks** | Follows core.symlinks | May differ | Windows edge cases |
| **Hooks** | Auto-executed | Not executed | Must manually invoke |
| **Credential helpers** | Auto-invoked | Not invoked | Must integrate manually |
| **GPG signing** | Uses gpg from PATH | Requires manual setup | Need to shell out or use library |
| **Pager** | Uses configured pager | N/A (library) | Not applicable |
| **Aliases** | Expanded | N/A | Not applicable |

---

# 3. Critical Limitations Analysis

## 3.1 Interactive Rebase (CRITICAL)

**What's Missing:**
- No interactive rebase support whatsoever
- Can't do pick/reword/edit/squash/fixup/drop
- Can't reorder commits interactively

**Impact:** High - This is a key feature for any professional Git GUI

**Workaround Options:**

### Option A: Implement manually with libgit2 primitives

```rust
// Pseudo-code for manual interactive rebase
fn interactive_rebase(
    repo: &Repository,
    onto: &Commit,
    instructions: Vec<RebaseInstruction>,
) -> Result<(), Error> {
    // 1. Find merge base
    let base = repo.merge_base(onto.id(), instructions[0].commit)?;
    
    // 2. Detach HEAD to onto
    repo.set_head_detached(onto.id())?;
    
    // 3. Process each instruction
    for instruction in instructions {
        match instruction.action {
            Pick => {
                // Cherry-pick the commit
                let commit = repo.find_commit(instruction.commit)?;
                cherry_pick(repo, &commit)?;
            }
            Reword => {
                // Cherry-pick, then amend with new message
                let commit = repo.find_commit(instruction.commit)?;
                cherry_pick(repo, &commit)?;
                amend_head_message(repo, &instruction.new_message)?;
            }
            Squash | Fixup => {
                // Cherry-pick without committing, amend into previous
                let commit = repo.find_commit(instruction.commit)?;
                cherry_pick_no_commit(repo, &commit)?;
                squash_into_head(repo, instruction.action == Squash)?;
            }
            Drop => {
                // Simply skip this commit
                continue;
            }
            Edit => {
                // Cherry-pick and pause for user editing
                let commit = repo.find_commit(instruction.commit)?;
                cherry_pick(repo, &commit)?;
                save_rebase_state(repo, &instructions, current_index)?;
                return Err(RebasePaused);
            }
        }
        
        // Handle conflicts
        if repo.index()?.has_conflicts() {
            save_rebase_state(repo, &instructions, current_index)?;
            return Err(RebaseConflict);
        }
    }
    
    // 4. Update branch ref
    update_branch_to_head(repo, original_branch)?;
    
    Ok(())
}
```

**Complexity:** High - Need to handle:
- Conflict resolution at each step
- State persistence for pause/continue
- Abort and restore original state
- exec commands
- Autosquash

### Option B: Shell out to git CLI

```rust
fn interactive_rebase_cli(
    repo_path: &Path,
    onto: &str,
    todo_content: &str,
) -> Result<(), Error> {
    // Write todo file
    let todo_path = repo_path.join(".git/rebase-merge/git-rebase-todo");
    fs::write(&todo_path, todo_content)?;
    
    // Set GIT_SEQUENCE_EDITOR to cat (use our todo as-is)
    let output = Command::new("git")
        .current_dir(repo_path)
        .env("GIT_SEQUENCE_EDITOR", "cat")
        .args(["rebase", "-i", onto])
        .output()?;
    
    if !output.status.success() {
        // Check if it's a conflict
        if is_rebase_in_progress(repo_path) {
            return Err(RebaseConflict);
        }
        return Err(RebaseFailed(String::from_utf8_lossy(&output.stderr)));
    }
    
    Ok(())
}
```

**Recommendation:** Use **CLI for interactive rebase**. The complexity of a pure libgit2 implementation is too high and error-prone.

---

## 3.2 Stash with Untracked Files (HIGH)

**What's Missing:**
- `libgit2_stash_save` doesn't support `--include-untracked` flag
- Can only stash tracked, modified files

**Impact:** High - Users expect this common workflow

**Workaround:**

```rust
fn stash_including_untracked(repo: &Repository, message: &str) -> Result<Oid, Error> {
    // Get list of untracked files
    let statuses = repo.statuses(Some(
        StatusOptions::new()
            .include_untracked(true)
            .exclude_submodules(true)
    ))?;
    
    let untracked: Vec<PathBuf> = statuses.iter()
        .filter(|s| s.status() == Status::WT_NEW)
        .filter_map(|s| s.path().map(PathBuf::from))
        .collect();
    
    // If there are untracked files, we need to:
    // 1. Add them to the index temporarily
    // 2. Create the stash
    // 3. Remove them from index
    // 4. Delete the working directory copies
    
    if !untracked.is_empty() {
        let mut index = repo.index()?;
        
        // Stage untracked files
        for path in &untracked {
            index.add_path(path)?;
        }
        index.write()?;
        
        // Create stash with INCLUDE_UNTRACKED flag (if available in git2-rs)
        // Otherwise, use the workaround below
    }
    
    // Create the stash
    let stasher = repo.signature()?;
    let stash_oid = repo.stash_save(&stasher, message, Some(StashFlags::INCLUDE_UNTRACKED))?;
    
    // Clean up untracked files (they're now in the stash)
    for path in &untracked {
        fs::remove_file(repo.workdir().unwrap().join(path))?;
    }
    
    Ok(stash_oid)
}
```

**Note:** Recent versions of git2-rs DO support `StashFlags::INCLUDE_UNTRACKED`. Verify version compatibility.

---

## 3.3 Git LFS (CRITICAL for some users)

**What's Missing:**
- No LFS support in libgit2
- Cloning an LFS repo gets pointer files, not actual content
- Push/pull don't trigger LFS transfers

**Impact:** Critical for users with LFS repos (game dev, media, large files)

**Workaround:**

```rust
use std::process::Command;

struct LfsManager {
    repo_path: PathBuf,
}

impl LfsManager {
    /// Check if repo uses LFS
    fn is_lfs_enabled(&self) -> bool {
        let gitattributes = self.repo_path.join(".gitattributes");
        if let Ok(content) = fs::read_to_string(&gitattributes) {
            return content.contains("filter=lfs");
        }
        false
    }
    
    /// Check if git-lfs is installed
    fn is_lfs_installed() -> bool {
        Command::new("git")
            .args(["lfs", "version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    
    /// Fetch LFS objects for checked out files
    fn fetch_lfs_objects(&self) -> Result<(), Error> {
        let output = Command::new("git")
            .current_dir(&self.repo_path)
            .args(["lfs", "fetch"])
            .output()?;
        
        if !output.status.success() {
            return Err(LfsError::FetchFailed(
                String::from_utf8_lossy(&output.stderr).to_string()
            ));
        }
        Ok(())
    }
    
    /// Checkout LFS files (replace pointers with actual content)
    fn checkout_lfs_files(&self) -> Result<(), Error> {
        let output = Command::new("git")
            .current_dir(&self.repo_path)
            .args(["lfs", "checkout"])
            .output()?;
        
        if !output.status.success() {
            return Err(LfsError::CheckoutFailed(
                String::from_utf8_lossy(&output.stderr).to_string()
            ));
        }
        Ok(())
    }
    
    /// Push LFS objects before regular push
    fn push_lfs_objects(&self, remote: &str, refspec: &str) -> Result<(), Error> {
        let output = Command::new("git")
            .current_dir(&self.repo_path)
            .args(["lfs", "push", remote, refspec])
            .output()?;
        
        if !output.status.success() {
            return Err(LfsError::PushFailed(
                String::from_utf8_lossy(&output.stderr).to_string()
            ));
        }
        Ok(())
    }
    
    /// Track a file pattern with LFS
    fn track_pattern(&self, pattern: &str) -> Result<(), Error> {
        let output = Command::new("git")
            .current_dir(&self.repo_path)
            .args(["lfs", "track", pattern])
            .output()?;
        
        if !output.status.success() {
            return Err(LfsError::TrackFailed(
                String::from_utf8_lossy(&output.stderr).to_string()
            ));
        }
        Ok(())
    }
}

// Integration with main git operations
impl GitService {
    async fn clone(&self, url: &str, path: &Path) -> Result<Repository, Error> {
        // Use libgit2 for clone
        let repo = self.clone_with_libgit2(url, path).await?;
        
        // Check if LFS is needed
        let lfs = LfsManager::new(path);
        if lfs.is_lfs_enabled() {
            if !LfsManager::is_lfs_installed() {
                return Err(Error::LfsRequired(
                    "This repository uses Git LFS. Please install git-lfs."
                ));
            }
            
            // Fetch and checkout LFS objects
            lfs.fetch_lfs_objects()?;
            lfs.checkout_lfs_files()?;
        }
        
        Ok(repo)
    }
    
    async fn push(&self, remote: &str, refspec: &str) -> Result<(), Error> {
        let lfs = LfsManager::new(&self.repo_path);
        
        // Push LFS objects first
        if lfs.is_lfs_enabled() {
            lfs.push_lfs_objects(remote, refspec)?;
        }
        
        // Then push with libgit2
        self.push_with_libgit2(remote, refspec).await
    }
}
```

**Requirement:** git-lfs must be installed on user's system.

---

## 3.4 Hooks Execution (MEDIUM)

**What's Missing:**
- libgit2 does not execute git hooks
- pre-commit, commit-msg, post-commit, etc. are ignored

**Impact:** Medium - Many teams rely on hooks for linting, commit message validation

**Workaround:**

```rust
use std::os::unix::fs::PermissionsExt;

struct HooksManager {
    hooks_path: PathBuf,
}

impl HooksManager {
    fn new(repo: &Repository) -> Self {
        let hooks_path = repo.path().join("hooks");
        Self { hooks_path }
    }
    
    /// Get path to a specific hook
    fn hook_path(&self, hook_name: &str) -> PathBuf {
        self.hooks_path.join(hook_name)
    }
    
    /// Check if a hook exists and is executable
    fn hook_exists(&self, hook_name: &str) -> bool {
        let path = self.hook_path(hook_name);
        if !path.exists() {
            return false;
        }
        
        #[cfg(unix)]
        {
            if let Ok(meta) = path.metadata() {
                return meta.permissions().mode() & 0o111 != 0;
            }
        }
        
        #[cfg(windows)]
        {
            // On Windows, check for .exe, .bat, .cmd, .ps1, or shebang
            return true; // Simplified
        }
        
        false
    }
    
    /// Execute a hook with given arguments
    fn execute_hook(
        &self,
        hook_name: &str,
        args: &[&str],
        stdin: Option<&str>,
        env: &[(&str, &str)],
    ) -> Result<HookResult, Error> {
        let hook_path = self.hook_path(hook_name);
        
        if !self.hook_exists(hook_name) {
            return Ok(HookResult::NotFound);
        }
        
        let mut command = Command::new(&hook_path);
        command
            .current_dir(self.repo_path.parent().unwrap()) // repo workdir
            .args(args)
            .envs(env.iter().cloned());
        
        if let Some(input) = stdin {
            command.stdin(Stdio::piped());
        }
        
        let mut child = command.spawn()?;
        
        if let Some(input) = stdin {
            if let Some(mut stdin_handle) = child.stdin.take() {
                stdin_handle.write_all(input.as_bytes())?;
            }
        }
        
        let output = child.wait_with_output()?;
        
        Ok(HookResult::Executed {
            success: output.status.success(),
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

enum HookResult {
    NotFound,
    Executed {
        success: bool,
        exit_code: i32,
        stdout: String,
        stderr: String,
    },
}

// Usage in commit operation
impl GitService {
    fn commit(&self, message: &str, amend: bool) -> Result<Oid, Error> {
        let hooks = HooksManager::new(&self.repo);
        
        // 1. Run pre-commit hook
        match hooks.execute_hook("pre-commit", &[], None, &[])? {
            HookResult::Executed { success: false, stderr, .. } => {
                return Err(Error::HookFailed("pre-commit", stderr));
            }
            _ => {}
        }
        
        // 2. Run commit-msg hook (with message file)
        let msg_file = self.repo.path().join("COMMIT_EDITMSG");
        fs::write(&msg_file, message)?;
        
        match hooks.execute_hook("commit-msg", &[msg_file.to_str().unwrap()], None, &[])? {
            HookResult::Executed { success: false, stderr, .. } => {
                return Err(Error::HookFailed("commit-msg", stderr));
            }
            _ => {}
        }
        
        // Read potentially modified message
        let final_message = fs::read_to_string(&msg_file)?;
        
        // 3. Create commit with libgit2
        let oid = self.create_commit_internal(&final_message, amend)?;
        
        // 4. Run post-commit hook (non-blocking)
        let _ = hooks.execute_hook("post-commit", &[], None, &[]);
        
        Ok(oid)
    }
}
```

---

## 3.5 GPG/SSH Commit Signing (MEDIUM-HIGH)

**What's Missing:**
- libgit2 has basic GPG support but it's complex to set up
- SSH signing (newer git feature) not supported
- No automatic key detection like git CLI

**Impact:** Medium-High - Required in many enterprise environments

**Workaround Options:**

### Option A: Use gpgme library directly

```rust
use gpgme::{Context, Protocol};

fn sign_commit_data(data: &str, key_id: Option<&str>) -> Result<String, Error> {
    let mut ctx = Context::from_protocol(Protocol::OpenPgp)?;
    ctx.set_armor(true);
    
    // Find signing key
    if let Some(key_id) = key_id {
        let key = ctx.get_key(key_id)?;
        ctx.add_signer(&key)?;
    }
    
    let mut output = Vec::new();
    ctx.sign_detached(data.as_bytes(), &mut output)?;
    
    Ok(String::from_utf8(output)?)
}
```

### Option B: Shell out to git/gpg

```rust
fn sign_with_cli(data: &str, signing_key: Option<&str>) -> Result<String, Error> {
    let mut cmd = Command::new("gpg");
    cmd.args(["--armor", "--detach-sign"]);
    
    if let Some(key) = signing_key {
        cmd.args(["-u", key]);
    }
    
    cmd.stdin(Stdio::piped())
       .stdout(Stdio::piped());
    
    let mut child = cmd.spawn()?;
    child.stdin.take().unwrap().write_all(data.as_bytes())?;
    
    let output = child.wait_with_output()?;
    
    if output.status.success() {
        Ok(String::from_utf8(output.stdout)?)
    } else {
        Err(Error::SigningFailed)
    }
}
```

### Option C: For SSH signing (git 2.34+)

```rust
fn sign_with_ssh(data: &str, key_file: &Path) -> Result<String, Error> {
    // SSH signing requires shelling out to ssh-keygen
    let output = Command::new("ssh-keygen")
        .args(["-Y", "sign", "-f", key_file.to_str().unwrap(), "-n", "git"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
    
    // ... handle I/O
    
    Ok(signature)
}
```

---

## 3.6 Credential Handling (HIGH)

**What's Missing:**
- libgit2 doesn't automatically use git credential helpers
- No integration with system keychains by default
- Must handle all credential scenarios manually

**Impact:** High - Users expect seamless auth

**Workaround:**

```rust
use git2::{Cred, CredentialType, RemoteCallbacks};

struct CredentialManager {
    username: Option<String>,
    // In-memory credential cache
    cached_creds: HashMap<String, Credential>,
    // Keychain access
    keyring: keyring::Entry,
}

impl CredentialManager {
    fn git_callbacks(&self) -> RemoteCallbacks<'_> {
        let mut callbacks = RemoteCallbacks::new();
        
        callbacks.credentials(|url, username_from_url, allowed_types| {
            self.acquire_credentials(url, username_from_url, allowed_types)
        });
        
        callbacks.certificate_check(|cert, hostname| {
            // Certificate validation
            self.validate_certificate(cert, hostname)
        });
        
        callbacks
    }
    
    fn acquire_credentials(
        &self,
        url: &str,
        username_from_url: Option<&str>,
        allowed_types: CredentialType,
    ) -> Result<Cred, git2::Error> {
        // 1. Try SSH agent first
        if allowed_types.contains(CredentialType::SSH_KEY) {
            if let Ok(cred) = Cred::ssh_key_from_agent(username_from_url.unwrap_or("git")) {
                return Ok(cred);
            }
        }
        
        // 2. Try SSH key from file
        if allowed_types.contains(CredentialType::SSH_KEY) {
            let home = dirs::home_dir().unwrap();
            let ssh_dir = home.join(".ssh");
            
            for key_name in &["id_ed25519", "id_rsa", "id_ecdsa"] {
                let key_path = ssh_dir.join(key_name);
                if key_path.exists() {
                    if let Ok(cred) = Cred::ssh_key(
                        username_from_url.unwrap_or("git"),
                        Some(&key_path.with_extension("pub")),
                        &key_path,
                        None, // passphrase - need UI callback
                    ) {
                        return Ok(cred);
                    }
                }
            }
        }
        
        // 3. Try system credential store
        if allowed_types.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let Some(cred) = self.get_from_credential_store(url)? {
                return Ok(Cred::userpass_plaintext(&cred.username, &cred.password)?);
            }
        }
        
        // 4. Try git credential helper
        if allowed_types.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let Some(cred) = self.get_from_git_credential_helper(url)? {
                return Ok(Cred::userpass_plaintext(&cred.username, &cred.password)?);
            }
        }
        
        // 5. Prompt user (via IPC to frontend)
        if allowed_types.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let Some(cred) = self.prompt_user_for_credentials(url)? {
                // Store for future use
                self.store_in_credential_store(url, &cred)?;
                return Ok(Cred::userpass_plaintext(&cred.username, &cred.password)?);
            }
        }
        
        Err(git2::Error::from_str("No credentials available"))
    }
    
    /// Use git credential helper
    fn get_from_git_credential_helper(&self, url: &str) -> Result<Option<Credential>, Error> {
        let input = format!("protocol=https\nhost={}\n\n", extract_host(url));
        
        let output = Command::new("git")
            .args(["credential", "fill"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        
        output.stdin.unwrap().write_all(input.as_bytes())?;
        let result = output.wait_with_output()?;
        
        // Parse output
        let stdout = String::from_utf8_lossy(&result.stdout);
        let mut username = None;
        let mut password = None;
        
        for line in stdout.lines() {
            if let Some(u) = line.strip_prefix("username=") {
                username = Some(u.to_string());
            }
            if let Some(p) = line.strip_prefix("password=") {
                password = Some(p.to_string());
            }
        }
        
        match (username, password) {
            (Some(u), Some(p)) => Ok(Some(Credential { username: u, password: p })),
            _ => Ok(None),
        }
    }
    
    /// Store credentials via git credential helper
    fn store_credentials(&self, url: &str, cred: &Credential) -> Result<(), Error> {
        let input = format!(
            "protocol=https\nhost={}\nusername={}\npassword={}\n\n",
            extract_host(url),
            cred.username,
            cred.password
        );
        
        Command::new("git")
            .args(["credential", "approve"])
            .stdin(Stdio::piped())
            .spawn()?
            .stdin.unwrap()
            .write_all(input.as_bytes())?;
        
        Ok(())
    }
}
```

---

# 4. Mitigation Strategies

## 4.1 Strategy Overview

| Strategy | When to Use | Complexity |
|----------|-------------|------------|
| **libgit2 only** | Feature fully supported | Low |
| **Manual implementation** | Composable from libgit2 primitives | Medium |
| **CLI fallback** | Complex features, edge cases | Medium |
| **Hybrid** | LFS, signing, credentials | Medium-High |
| **User notification** | Unsupported features | Low |

## 4.2 Decision Matrix

```
┌─────────────────────────────────────────────────────────────────┐
│                    FEATURE SUPPORT DECISION                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────┐                                       │
│   │ Is feature needed   │                                       │
│   │ for MVP?            │                                       │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│         Yes  │  No                                              │
│              │   └──────────► Defer to later version            │
│              ▼                                                   │
│   ┌─────────────────────┐                                       │
│   │ Does libgit2        │                                       │
│   │ fully support it?   │                                       │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│         Yes  │  No                                              │
│              │   │                                               │
│   ┌──────────┘   │                                              │
│   │              ▼                                               │
│   │   ┌─────────────────────┐                                   │
│   │   │ Can it be composed  │                                   │
│   │   │ from primitives?    │                                   │
│   │   └──────────┬──────────┘                                   │
│   │              │                                               │
│   │         Yes  │  No                                          │
│   │              │   │                                           │
│   │   ┌──────────┘   │                                          │
│   │   │              ▼                                           │
│   │   │   ┌─────────────────────┐                               │
│   │   │   │ Is CLI fallback     │                               │
│   │   │   │ acceptable?         │                               │
│   │   │   └──────────┬──────────┘                               │
│   │   │              │                                           │
│   │   │         Yes  │  No                                      │
│   │   │              │   │                                       │
│   │   │   ┌──────────┘   │                                      │
│   │   │   │              ▼                                       │
│   │   │   │   ┌─────────────────────┐                           │
│   │   │   │   │ Mark as unsupported │                           │
│   │   │   │   │ or find workaround  │                           │
│   │   │   │   └─────────────────────┘                           │
│   │   │   │                                                      │
│   ▼   ▼   ▼                                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Use      Manual         CLI        Consider           │   │
│   │ libgit2   Impl         Fallback    Alternative        │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 4.3 Feature Implementation Plan

| Feature | Strategy | Priority | Notes |
|---------|----------|----------|-------|
| Clone | libgit2 + LFS hook | P0 | |
| Commit | libgit2 + hooks | P0 | |
| Branch operations | libgit2 | P0 | |
| Merge | libgit2 | P0 | |
| Push/Pull | libgit2 + LFS | P0 | |
| Fetch | libgit2 | P0 | |
| Diff | libgit2 | P0 | |
| Blame | libgit2 | P0 | |
| Stash (basic) | libgit2 | P0 | |
| Stash (untracked) | libgit2 flags or manual | P1 | Verify git2-rs support |
| Basic rebase | libgit2 | P1 | |
| Interactive rebase | CLI | P1 | Complex, defer to CLI |
| Cherry-pick (single) | libgit2 | P1 | |
| Cherry-pick (range) | Manual loop | P2 | |
| Tags | libgit2 | P1 | |
| Submodules | libgit2 + CLI fallback | P2 | |
| LFS | CLI wrapper | P1 | Requires git-lfs |
| GPG signing | gpgme or CLI | P2 | |
| SSH signing | CLI | P3 | |
| Hooks | Manual execution | P1 | |
| Credentials | Custom + git credential | P0 | |
| Worktrees | libgit2 + CLI | P3 | |
| Bisect | CLI | P3 | |
| gc/maintenance | CLI (background) | P3 | |
| rerere | CLI | P3 | |

---

# 5. CLI Fallback Architecture

## 5.1 CLI Wrapper Design

```rust
use std::process::{Command, Stdio, ExitStatus};
use tokio::process::Command as AsyncCommand;

/// Result of a git CLI operation
#[derive(Debug)]
pub struct GitCliResult {
    pub success: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration: Duration,
}

/// Wrapper for git CLI operations
pub struct GitCli {
    git_path: PathBuf,
    repo_path: PathBuf,
    env: HashMap<String, String>,
}

impl GitCli {
    pub fn new(repo_path: PathBuf) -> Result<Self, Error> {
        // Find git executable
        let git_path = which::which("git")
            .map_err(|_| Error::GitNotFound)?;
        
        Ok(Self {
            git_path,
            repo_path,
            env: HashMap::new(),
        })
    }
    
    /// Set environment variable for git commands
    pub fn env(mut self, key: &str, value: &str) -> Self {
        self.env.insert(key.to_string(), value.to_string());
        self
    }
    
    /// Execute a git command synchronously
    pub fn exec(&self, args: &[&str]) -> Result<GitCliResult, Error> {
        let start = Instant::now();
        
        let output = Command::new(&self.git_path)
            .current_dir(&self.repo_path)
            .args(args)
            .envs(&self.env)
            .env("GIT_TERMINAL_PROMPT", "0") // Disable interactive prompts
            .env("LC_ALL", "C") // Consistent output format
            .output()?;
        
        Ok(GitCliResult {
            success: output.status.success(),
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration: start.elapsed(),
        })
    }
    
    /// Execute a git command asynchronously
    pub async fn exec_async(&self, args: &[&str]) -> Result<GitCliResult, Error> {
        let start = Instant::now();
        
        let output = AsyncCommand::new(&self.git_path)
            .current_dir(&self.repo_path)
            .args(args)
            .envs(&self.env)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .output()
            .await?;
        
        Ok(GitCliResult {
            success: output.status.success(),
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration: start.elapsed(),
        })
    }
    
    /// Execute with progress streaming
    pub async fn exec_with_progress<F>(
        &self,
        args: &[&str],
        progress_callback: F,
    ) -> Result<GitCliResult, Error>
    where
        F: Fn(ProgressEvent) + Send + 'static,
    {
        let mut child = AsyncCommand::new(&self.git_path)
            .current_dir(&self.repo_path)
            .args(args)
            .envs(&self.env)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        
        // Git outputs progress to stderr
        let stderr = child.stderr.take().unwrap();
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        
        while reader.read_line(&mut line).await? > 0 {
            if let Some(progress) = parse_git_progress(&line) {
                progress_callback(progress);
            }
            line.clear();
        }
        
        let output = child.wait_with_output().await?;
        
        Ok(GitCliResult {
            success: output.status.success(),
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::new(), // Already consumed
            duration: Duration::ZERO, // Not tracked in streaming mode
        })
    }
}

/// Parse git progress output
fn parse_git_progress(line: &str) -> Option<ProgressEvent> {
    // Examples:
    // "Receiving objects:  45% (450/1000)"
    // "Resolving deltas:  67% (670/1000)"
    // "remote: Counting objects: 1000, done."
    
    if let Some(caps) = PROGRESS_REGEX.captures(line) {
        return Some(ProgressEvent {
            phase: caps.get(1)?.as_str().to_string(),
            percent: caps.get(2)?.as_str().parse().ok()?,
            current: caps.get(3)?.as_str().parse().ok()?,
            total: caps.get(4)?.as_str().parse().ok()?,
        });
    }
    None
}
```

## 5.2 Unified Git Service

```rust
/// Unified interface that uses libgit2 or CLI as appropriate
pub struct GitService {
    repo: Repository,    // libgit2
    cli: GitCli,         // CLI wrapper
    hooks: HooksManager,
    lfs: LfsManager,
    creds: CredentialManager,
}

impl GitService {
    // ============================================
    // Operations using libgit2
    // ============================================
    
    pub fn get_status(&self) -> Result<Vec<StatusEntry>, Error> {
        // libgit2 - fast, no reason to use CLI
        let statuses = self.repo.statuses(Some(&mut StatusOptions::new()))?;
        // ... convert to our types
    }
    
    pub fn stage_files(&self, paths: &[PathBuf]) -> Result<(), Error> {
        // libgit2 - fully supported
        let mut index = self.repo.index()?;
        for path in paths {
            index.add_path(path)?;
        }
        index.write()?;
        Ok(())
    }
    
    pub fn commit(&self, message: &str) -> Result<Oid, Error> {
        // libgit2 + manual hooks
        self.hooks.run_pre_commit()?;
        let oid = self.create_commit_libgit2(message)?;
        self.hooks.run_post_commit()?;
        Ok(oid)
    }
    
    // ============================================
    // Operations using CLI
    // ============================================
    
    pub async fn interactive_rebase(
        &self,
        onto: &str,
        instructions: Vec<RebaseInstruction>,
    ) -> Result<(), Error> {
        // CLI required - too complex for manual implementation
        let todo_content = self.format_rebase_todo(&instructions);
        
        // Write our todo file
        let todo_path = self.repo.path().join("rebase-merge/git-rebase-todo");
        fs::write(&todo_path, &todo_content)?;
        
        // Use GIT_SEQUENCE_EDITOR to skip editor
        let result = self.cli
            .env("GIT_SEQUENCE_EDITOR", "cat")
            .exec_async(&["rebase", "-i", onto])
            .await?;
        
        if !result.success {
            if self.is_rebase_in_progress() {
                return Err(Error::RebaseConflict(self.get_conflicts()?));
            }
            return Err(Error::RebaseFailed(result.stderr));
        }
        
        // Refresh libgit2's view of the repo
        self.repo.state_cleanup()?;
        
        Ok(())
    }
    
    pub async fn bisect_start(
        &self,
        bad: &str,
        good: &str,
    ) -> Result<BisectState, Error> {
        // CLI only - not in libgit2
        self.cli.exec_async(&["bisect", "start", bad, good]).await?;
        self.get_bisect_state()
    }
    
    // ============================================
    // Hybrid operations
    // ============================================
    
    pub async fn clone(
        url: &str,
        path: &Path,
        progress: impl Fn(CloneProgress),
    ) -> Result<GitService, Error> {
        // Use libgit2 for the clone
        let repo = clone_with_libgit2(url, path, |p| progress(p.into())).await?;
        
        let service = GitService::new(repo)?;
        
        // Check for LFS and fetch objects
        if service.lfs.is_enabled() {
            if !LfsManager::is_installed() {
                return Err(Error::LfsRequired);
            }
            service.lfs.fetch_objects().await?;
            service.lfs.checkout_files()?;
        }
        
        Ok(service)
    }
    
    pub async fn push(
        &self,
        remote: &str,
        refspec: &str,
        force: bool,
    ) -> Result<(), Error> {
        // Pre-push hook
        self.hooks.run_pre_push(remote, refspec)?;
        
        // LFS push first
        if self.lfs.is_enabled() {
            self.lfs.push_objects(remote, refspec).await?;
        }
        
        // Push with libgit2
        self.push_libgit2(remote, refspec, force).await?;
        
        Ok(())
    }
}
```

## 5.3 Error Handling

```rust
#[derive(Debug, Error)]
pub enum GitError {
    #[error("libgit2 error: {0}")]
    Libgit2(#[from] git2::Error),
    
    #[error("Git CLI error: {message}")]
    Cli {
        exit_code: i32,
        message: String,
    },
    
    #[error("Git not found in PATH")]
    GitNotFound,
    
    #[error("Git LFS required but not installed")]
    LfsRequired,
    
    #[error("Hook failed: {hook_name}: {message}")]
    HookFailed {
        hook_name: String,
        message: String,
    },
    
    #[error("Rebase conflict in: {files:?}")]
    RebaseConflict {
        files: Vec<PathBuf>,
    },
    
    #[error("Merge conflict in: {files:?}")]
    MergeConflict {
        files: Vec<PathBuf>,
    },
    
    #[error("Authentication failed for {url}")]
    AuthFailed {
        url: String,
    },
    
    #[error("Operation not supported: {operation}")]
    NotSupported {
        operation: String,
    },
}

/// Convert CLI result to proper error
impl GitCliResult {
    pub fn into_result(self) -> Result<String, GitError> {
        if self.success {
            Ok(self.stdout)
        } else {
            Err(GitError::Cli {
                exit_code: self.exit_code,
                message: self.stderr,
            })
        }
    }
}
```

---

# 6. Alternative: gitoxide

## 6.1 What is gitoxide?

**gitoxide** (gix) is a pure Rust implementation of Git. It's being actively developed and aims for full git compatibility.

| Aspect | libgit2 | gitoxide |
|--------|---------|----------|
| Language | C | Rust |
| License | GPL v2 + Linking Exception | MIT/Apache 2.0 |
| Maturity | Very mature | Actively developing |
| Features | ~80% of git | ~60% of git (growing) |
| Performance | Good | Excellent (often faster) |
| Safety | C memory issues possible | Memory-safe |
| Dependencies | OpenSSL, libssh2, etc. | Pure Rust options |
| Async | No | Yes (native) |

## 6.2 gitoxide Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| Clone | ✅ Working | |
| Fetch | ✅ Working | |
| Commit | ✅ Working | |
| Diff | ✅ Working | |
| Blame | ⚠️ In progress | |
| Merge | ⚠️ In progress | |
| Rebase | ❌ Not yet | |
| Push | ✅ Working | |
| Index | ✅ Working | |
| Pack files | ✅ Working | Very fast |
| Shallow | ⚠️ Partial | |
| Submodules | ⚠️ Partial | |

## 6.3 Hybrid Approach

Could use gitoxide for some operations and libgit2 for others:

```rust
// Hypothetical hybrid service
pub struct GitService {
    gix_repo: gix::Repository,    // gitoxide
    git2_repo: git2::Repository,  // libgit2
}

impl GitService {
    pub fn fetch(&self) -> Result<(), Error> {
        // Use gitoxide - faster pack handling
        gix::fetch(&self.gix_repo)?;
        // Refresh libgit2's view
        self.git2_repo.state_cleanup()?;
        Ok(())
    }
    
    pub fn merge(&self, branch: &str) -> Result<(), Error> {
        // Use libgit2 - more mature merge implementation
        self.git2_repo.merge(...)?;
        Ok(())
    }
}
```

## 6.4 Recommendation

**Start with libgit2**, but:

1. Architect for abstraction (can swap implementations later)
2. Monitor gitoxide development
3. Consider gitoxide for v2.0 when it matures

---

# 7. Testing Strategy

## 7.1 Test Categories

| Category | Purpose | Tools |
|----------|---------|-------|
| Unit tests | Individual functions | Rust test framework |
| Integration tests | Full operations | Test repos |
| Compatibility tests | libgit2 vs git CLI | Compare outputs |
| Edge case tests | Unusual scenarios | Crafted repos |
| Performance tests | Large repos | Benchmarks |

## 7.2 Test Repository Collection

Create a set of test repositories covering edge cases:

```rust
/// Generate test repositories
mod test_repos {
    /// Simple linear history
    pub fn linear_history() -> TempRepo {
        let repo = TempRepo::new();
        for i in 0..100 {
            repo.commit(&format!("Commit {}", i));
        }
        repo
    }
    
    /// Complex merge history
    pub fn merge_heavy() -> TempRepo {
        let repo = TempRepo::new();
        repo.commit("Initial");
        
        for i in 0..10 {
            repo.branch(&format!("feature-{}", i));
            repo.commit("Feature work");
            repo.checkout("main");
            repo.merge(&format!("feature-{}", i));
        }
        repo
    }
    
    /// Octopus merge
    pub fn octopus_merge() -> TempRepo {
        let repo = TempRepo::new();
        repo.commit("Initial");
        
        for i in 0..5 {
            repo.branch(&format!("branch-{}", i));
            repo.commit("Work");
        }
        
        repo.checkout("main");
        repo.exec(&["merge", "branch-0", "branch-1", "branch-2", "branch-3", "branch-4"]);
        repo
    }
    
    /// Submodules
    pub fn with_submodules() -> TempRepo {
        let sub = TempRepo::new();
        sub.commit("Submodule commit");
        
        let repo = TempRepo::new();
        repo.commit("Initial");
        repo.exec(&["submodule", "add", sub.path()]);
        repo.commit("Add submodule");
        repo
    }
    
    /// LFS repository
    pub fn with_lfs() -> TempRepo {
        let repo = TempRepo::new();
        repo.exec(&["lfs", "install"]);
        repo.exec(&["lfs", "track", "*.bin"]);
        repo.commit("Initial with LFS");
        
        // Create large file
        repo.write_file("large.bin", &vec![0u8; 1024 * 1024]);
        repo.add("large.bin");
        repo.commit("Add large file");
        repo
    }
    
    /// Conflict scenarios
    pub fn conflicting() -> TempRepo {
        let repo = TempRepo::new();
        repo.write_file("file.txt", "original");
        repo.commit("Initial");
        
        repo.branch("feature");
        repo.write_file("file.txt", "feature change");
        repo.commit("Feature change");
        
        repo.checkout("main");
        repo.write_file("file.txt", "main change");
        repo.commit("Main change");
        
        // Don't merge - leave for test to trigger conflict
        repo
    }
}
```

## 7.3 Compatibility Test Framework

```rust
/// Compare libgit2 output with git CLI
#[cfg(test)]
mod compatibility {
    use super::*;
    
    /// Test that libgit2 and CLI produce same results
    fn compare_outputs<T: PartialEq + Debug>(
        name: &str,
        libgit2_fn: impl FnOnce(&Repository) -> Result<T, Error>,
        cli_fn: impl FnOnce(&GitCli) -> Result<T, Error>,
        repo: &TestRepo,
    ) {
        let libgit2_result = libgit2_fn(&repo.git2);
        let cli_result = cli_fn(&repo.cli);
        
        match (libgit2_result, cli_result) {
            (Ok(a), Ok(b)) => {
                assert_eq!(a, b, "{}: outputs differ", name);
            }
            (Err(a), Err(b)) => {
                // Both failed - acceptable
            }
            (Ok(_), Err(e)) => {
                panic!("{}: libgit2 succeeded but CLI failed: {}", name, e);
            }
            (Err(e), Ok(_)) => {
                panic!("{}: CLI succeeded but libgit2 failed: {}", name, e);
            }
        }
    }
    
    #[test]
    fn test_status_compatibility() {
        let repo = test_repos::linear_history();
        repo.modify_file("file.txt");
        
        compare_outputs(
            "status",
            |r| get_status_libgit2(r),
            |c| parse_status_cli(c.exec(&["status", "--porcelain=v2"])?),
            &repo,
        );
    }
    
    #[test]
    fn test_log_compatibility() {
        let repo = test_repos::merge_heavy();
        
        compare_outputs(
            "log",
            |r| get_commits_libgit2(r, 100),
            |c| parse_log_cli(c.exec(&["log", "--format=%H", "-n", "100"])?),
            &repo,
        );
    }
    
    #[test]
    fn test_diff_compatibility() {
        let repo = test_repos::linear_history();
        repo.modify_file("file.txt");
        
        compare_outputs(
            "diff",
            |r| get_diff_libgit2(r),
            |c| parse_diff_cli(c.exec(&["diff"])?),
            &repo,
        );
    }
}
```

## 7.4 Edge Case Tests

```rust
#[cfg(test)]
mod edge_cases {
    #[test]
    fn test_empty_repository() {
        let repo = TempRepo::new();
        // No commits yet
        
        let service = GitService::new(repo.path()).unwrap();
        
        // Should not panic
        assert!(service.get_head().is_err()); // No HEAD yet
        assert!(service.get_commits(10).unwrap().is_empty());
        assert!(service.get_branches().unwrap().is_empty());
    }
    
    #[test]
    fn test_detached_head() {
        let repo = test_repos::linear_history();
        repo.exec(&["checkout", "HEAD~5"]);
        
        let service = GitService::new(repo.path()).unwrap();
        
        assert!(service.is_head_detached());
        assert!(service.get_current_branch().is_none());
    }
    
    #[test]
    fn test_corrupted_index() {
        let repo = test_repos::linear_history();
        
        // Corrupt the index
        let index_path = repo.path().join(".git/index");
        fs::write(&index_path, b"garbage data").unwrap();
        
        let service = GitService::new(repo.path());
        // Should handle gracefully, not panic
        assert!(service.is_err() || service.unwrap().get_status().is_err());
    }
    
    #[test]
    fn test_missing_objects() {
        let repo = test_repos::linear_history();
        
        // Delete a pack file
        let objects = repo.path().join(".git/objects");
        for entry in fs::read_dir(objects.join("pack")).unwrap() {
            if entry.unwrap().path().extension() == Some("pack".as_ref()) {
                fs::remove_file(entry.unwrap().path()).unwrap();
                break;
            }
        }
        
        let service = GitService::new(repo.path()).unwrap();
        // Should fail gracefully on operations that need those objects
    }
    
    #[test]
    fn test_unicode_filenames() {
        let repo = TempRepo::new();
        repo.write_file("файл.txt", "content");       // Russian
        repo.write_file("文件.txt", "content");       // Chinese
        repo.write_file("αρχείο.txt", "content");    // Greek
        repo.write_file("🎉.txt", "content");         // Emoji
        
        let service = GitService::new(repo.path()).unwrap();
        let status = service.get_status().unwrap();
        
        assert_eq!(status.len(), 4);
    }
    
    #[test]
    fn test_very_long_path() {
        let repo = TempRepo::new();
        
        // Create deeply nested path (may fail on Windows without long path support)
        let deep_path = "a/".repeat(100) + "file.txt";
        repo.write_file(&deep_path, "content");
        
        let service = GitService::new(repo.path()).unwrap();
        let status = service.get_status();
        
        #[cfg(windows)]
        {
            // May fail on Windows
        }
        
        #[cfg(not(windows))]
        {
            assert!(status.is_ok());
        }
    }
    
    #[test]
    fn test_binary_files() {
        let repo = TempRepo::new();
        repo.write_file("binary.dat", &(0..256).collect::<Vec<u8>>());
        repo.add("binary.dat");
        repo.commit("Add binary");
        
        let service = GitService::new(repo.path()).unwrap();
        
        // Diff should detect binary
        let diff = service.diff_head_to_index().unwrap();
        assert!(diff.files[0].is_binary);
    }
    
    #[test]
    fn test_symlinks() {
        #[cfg(unix)]
        {
            let repo = TempRepo::new();
            repo.write_file("target.txt", "content");
            std::os::unix::fs::symlink(
                repo.path().join("target.txt"),
                repo.path().join("link.txt"),
            ).unwrap();
            
            repo.add_all();
            repo.commit("Add symlink");
            
            let service = GitService::new(repo.path()).unwrap();
            // Should handle symlinks correctly
        }
    }
}
```

---

# 8. Recommendations

## 8.1 Summary of Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                    RECOMMENDED ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   GitService (Unified API)               │   │
│   │                                                          │   │
│   │   • Single interface for all git operations              │   │
│   │   • Decides libgit2 vs CLI internally                    │   │
│   │   • Handles hooks, LFS, credentials                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│   │   libgit2    │  │   Git CLI    │  │   External   │        │
│   │   (git2-rs)  │  │   Wrapper    │  │   (LFS,GPG)  │        │
│   │              │  │              │  │              │        │
│   │ • Core ops   │  │ • Rebase -i  │  │ • git-lfs    │        │
│   │ • Fast       │  │ • Bisect     │  │ • gpg        │        │
│   │ • Reliable   │  │ • Complex    │  │ • ssh-keygen │        │
│   └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 8.2 Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary git library | libgit2 (git2-rs) | Mature, proven, most features |
| Interactive rebase | CLI fallback | Too complex to implement |
| Hooks | Manual execution | Required for user workflows |
| LFS | git-lfs CLI | No library alternative |
| Credentials | Custom + git credential | Best UX |
| GPG signing | gpgme or CLI | Depends on complexity |
| SSH signing | CLI | Not in libgit2 |
| Future consideration | gitoxide | When more mature |

## 8.3 User Communication

When features require CLI fallback:

```typescript
// Frontend notification types
interface CapabilityWarning {
  feature: string;
  reason: string;
  requirement?: string;  // e.g., "git-lfs must be installed"
  workaround?: string;
}

// Example warnings
const warnings: CapabilityWarning[] = [
  {
    feature: "Git LFS",
    reason: "This repository uses Git LFS for large files",
    requirement: "git-lfs must be installed",
    workaround: "Install from https://git-lfs.github.com/",
  },
  {
    feature: "GPG Signing",
    reason: "Commit signing requires GPG",
    requirement: "GPG must be installed and configured",
    workaround: "Install GPG and configure your signing key",
  },
];
```

## 8.4 Minimum Requirements

Document what the application needs:

| Requirement | Required | Optional | Notes |
|-------------|----------|----------|-------|
| git CLI | ✅ Yes | | For fallback operations |
| git version | 2.20+ | | For modern features |
| git-lfs | | ✅ For LFS repos | User-installable |
| GPG | | ✅ For signing | User-installable |
| SSH | ✅ Yes | | For SSH remotes |

## 8.5 Next Steps

1. **Create abstraction layer** - `GitService` trait that hides implementation
2. **Implement core operations** - Start with libgit2-only features
3. **Add CLI fallback** - For interactive rebase, bisect
4. **Add hooks support** - Manual execution wrapper
5. **Add LFS integration** - CLI wrapper
6. **Test extensively** - Compatibility suite
7. **Document limitations** - User-facing documentation

---

# Appendix: Quick Reference

## Operations by Implementation

### libgit2 Only
- Repository: init, open, clone, discover
- Index: stage, unstage, status
- Commits: create, read, amend
- Branches: create, delete, rename, checkout
- Merge: analysis, execute, conflicts
- Diff: all types
- Blame: full support
- Tags: all types
- Remotes: add, remove, fetch, push
- Refs: all operations
- Config: read/write

### CLI Required
- Interactive rebase
- Bisect
- Filter-branch / filter-repo
- Git gc / maintenance
- Git fsck
- Archive
- Format-patch / am
- Send-email
- Rerere
- Worktree (complex operations)

### External Tools
- git-lfs: all LFS operations
- gpg: commit/tag signing
- ssh-keygen: SSH signing (git 2.34+)

---

*Document Version: 1.0*
*Created: December 2024*
*Purpose: Technical Spike for libgit2 Limitations*
