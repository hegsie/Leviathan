# Technical Spike: Cross-Platform File System Challenges

## Executive Summary

Building a Git GUI that works consistently across Windows, macOS, and Linux requires careful handling of fundamental file system differences. These differences cause real bugs in production - many Git GUIs have shipped bugs related to case sensitivity, line endings, and symlinks. This document catalogs the challenges and provides tested solutions.

---

# Table of Contents

1. [Overview of Platform Differences](#1-overview-of-platform-differences)
2. [Case Sensitivity](#2-case-sensitivity)
3. [Line Endings (CRLF/LF)](#3-line-endings-crlflf)
4. [File Permissions](#4-file-permissions)
5. [Symlinks](#5-symlinks)
6. [Path Length Limits](#6-path-length-limits)
7. [File Locking](#7-file-locking)
8. [Unicode & Filename Encoding](#8-unicode--filename-encoding)
9. [Hidden Files & System Files](#9-hidden-files--system-files)
10. [File Watching](#10-file-watching)
11. [Temporary Files & Atomic Operations](#11-temporary-files--atomic-operations)
12. [Testing Strategy](#12-testing-strategy)
13. [Implementation Checklist](#13-implementation-checklist)

---

# 1. Overview of Platform Differences

## 1.1 Platform Comparison Matrix

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Case sensitive | ❌ No (NTFS default) | ❌ No (APFS default) | ✅ Yes |
| Case preserving | ✅ Yes | ✅ Yes | ✅ Yes |
| Default line ending | CRLF (`\r\n`) | LF (`\n`) | LF (`\n`) |
| File permissions | Limited (ACLs) | Unix (rwx) | Unix (rwx) |
| Execute bit | ❌ No | ✅ Yes | ✅ Yes |
| Symlinks | ⚠️ Limited | ✅ Yes | ✅ Yes |
| Max path length | 260 chars* | 1024 chars | 4096 chars |
| File locking | Mandatory | Advisory | Advisory |
| Unicode normalization | NFC | NFD | NFC (usually) |
| Hidden files | Attribute | Dot prefix | Dot prefix |
| Reserved names | CON, PRN, etc. | None | None |

*Windows can support long paths with opt-in setting

## 1.2 Impact on Git Operations

| Git Operation | Affected By |
|---------------|-------------|
| Clone | Case sensitivity, symlinks, line endings |
| Status | Case changes, Unicode normalization |
| Diff | Line endings, permissions |
| Commit | Line endings, permissions, hooks execution |
| Checkout | Case conflicts, symlinks, permissions |
| Merge | All of the above |
| Stash | File locking (Windows) |

## 1.3 Risk Assessment

| Issue | Frequency | Severity | Detection Difficulty |
|-------|-----------|----------|---------------------|
| Line endings | Very High | Medium | Easy |
| Case sensitivity | High | High | Medium |
| Path length | Medium | High | Easy |
| Symlinks | Medium | Medium | Easy |
| File locking | Medium | Medium | Medium |
| Unicode normalization | Low | High | Hard |
| Permissions | Low | Low | Easy |

---

# 2. Case Sensitivity

## 2.1 The Problem

```
Scenario: Developer on Linux creates two files
  - README.md
  - readme.md

Windows/macOS user clones:
  - Only ONE file appears (whichever git extracts last)
  - The other is silently lost
  - Git status shows the "missing" file as deleted
```

**Real-world example:** React Native had issues where `file.js` and `File.js` caused build failures on macOS.

## 2.2 Detection

```rust
use std::path::Path;

/// Detect if filesystem is case-sensitive
pub fn is_case_sensitive(path: &Path) -> bool {
    let test_lower = path.join(".case_test_lower");
    let test_upper = path.join(".CASE_TEST_LOWER");
    
    // Create lowercase file
    if std::fs::write(&test_lower, "").is_err() {
        return true; // Assume case-sensitive if we can't test
    }
    
    // Check if uppercase version exists (would mean case-insensitive)
    let is_insensitive = test_upper.exists();
    
    // Cleanup
    let _ = std::fs::remove_file(&test_lower);
    
    !is_insensitive
}

/// Check if a repository has case conflicts
pub fn find_case_conflicts(repo: &Repository) -> Vec<CaseConflict> {
    let mut conflicts = Vec::new();
    let mut seen: HashMap<String, String> = HashMap::new(); // lowercase -> original
    
    // Walk the tree
    let head = repo.head().unwrap().peel_to_tree().unwrap();
    head.walk(TreeWalkMode::PreOrder, |dir, entry| {
        let path = format!("{}{}", dir, entry.name().unwrap_or(""));
        let lower = path.to_lowercase();
        
        if let Some(existing) = seen.get(&lower) {
            if existing != &path {
                conflicts.push(CaseConflict {
                    path1: existing.clone(),
                    path2: path.clone(),
                });
            }
        } else {
            seen.insert(lower, path);
        }
        
        TreeWalkResult::Ok
    }).unwrap();
    
    conflicts
}

#[derive(Debug)]
pub struct CaseConflict {
    pub path1: String,
    pub path2: String,
}
```

## 2.3 Git Configuration

```rust
/// Configure repository for cross-platform safety
pub fn configure_case_handling(repo: &Repository, fs_case_sensitive: bool) -> Result<(), Error> {
    let mut config = repo.config()?;
    
    // core.ignoreCase - should match filesystem behavior
    config.set_bool("core.ignoreCase", !fs_case_sensitive)?;
    
    Ok(())
}

/// Check for potential case issues before checkout
pub fn pre_checkout_case_check(
    repo: &Repository,
    target: &Commit,
    fs_case_sensitive: bool,
) -> Result<Vec<CaseWarning>, Error> {
    if fs_case_sensitive {
        return Ok(vec![]); // No issues on case-sensitive FS
    }
    
    let mut warnings = Vec::new();
    let tree = target.tree()?;
    let mut paths_lower: HashMap<String, Vec<String>> = HashMap::new();
    
    tree.walk(TreeWalkMode::PreOrder, |dir, entry| {
        let path = format!("{}{}", dir, entry.name().unwrap_or(""));
        let lower = path.to_lowercase();
        
        paths_lower.entry(lower).or_default().push(path);
        TreeWalkResult::Ok
    })?;
    
    for (lower, paths) in paths_lower {
        if paths.len() > 1 {
            warnings.push(CaseWarning {
                conflicting_paths: paths,
                message: format!(
                    "These paths differ only in case and will conflict on this filesystem"
                ),
            });
        }
    }
    
    Ok(warnings)
}
```

## 2.4 UI Handling

```typescript
// Frontend: Show case conflict warnings
interface CaseConflictWarning {
  paths: string[];
  severity: 'error' | 'warning';
}

@customElement('ok-case-conflict-dialog')
export class CaseConflictDialog extends LitElement {
  @property({ type: Array }) conflicts: CaseConflictWarning[] = [];
  
  render() {
    return html`
      <ok-dialog type="warning" title="Case Sensitivity Conflict">
        <p>
          This repository contains files that differ only in letter case.
          On your filesystem (${this.fsType}), these will conflict:
        </p>
        
        <ul class="conflict-list">
          ${this.conflicts.map(conflict => html`
            <li>
              <code>${conflict.paths.join('</code> vs <code>')}</code>
            </li>
          `)}
        </ul>
        
        <p>
          <strong>Options:</strong>
        </p>
        <ul>
          <li>Rename files in the repository to avoid conflicts</li>
          <li>Use a case-sensitive filesystem (Linux, or macOS with APFS case-sensitive)</li>
          <li>Proceed anyway (some files may be overwritten)</li>
        </ul>
        
        <div slot="actions">
          <ok-button @click=${this.cancel}>Cancel Clone</ok-button>
          <ok-button variant="warning" @click=${this.proceedAnyway}>
            Proceed Anyway
          </ok-button>
        </div>
      </ok-dialog>
    `;
  }
}
```

## 2.5 Rename Detection

```rust
/// Detect case-only renames in status
pub fn detect_case_renames(repo: &Repository) -> Result<Vec<CaseRename>, Error> {
    let mut renames = Vec::new();
    
    let statuses = repo.statuses(Some(
        StatusOptions::new()
            .include_untracked(true)
            .renames_head_to_index(true)
    ))?;
    
    for entry in statuses.iter() {
        if let Some(diff_delta) = entry.head_to_index() {
            let old_path = diff_delta.old_file().path();
            let new_path = diff_delta.new_file().path();
            
            if let (Some(old), Some(new)) = (old_path, new_path) {
                if old.to_string_lossy().to_lowercase() == 
                   new.to_string_lossy().to_lowercase() &&
                   old != new {
                    renames.push(CaseRename {
                        old_path: old.to_path_buf(),
                        new_path: new.to_path_buf(),
                    });
                }
            }
        }
    }
    
    Ok(renames)
}

/// Perform a case-only rename safely
pub fn rename_case_only(repo: &Repository, old: &Path, new: &Path) -> Result<(), Error> {
    // On case-insensitive FS, direct rename may not work
    // Need to use intermediate name
    let workdir = repo.workdir().ok_or(Error::BareRepo)?;
    let old_full = workdir.join(old);
    let new_full = workdir.join(new);
    
    if !is_case_sensitive(workdir) {
        // Two-step rename via temporary name
        let temp = workdir.join(format!(".rename_temp_{}", uuid::Uuid::new_v4()));
        std::fs::rename(&old_full, &temp)?;
        std::fs::rename(&temp, &new_full)?;
    } else {
        std::fs::rename(&old_full, &new_full)?;
    }
    
    // Update index
    let mut index = repo.index()?;
    index.remove_path(old)?;
    index.add_path(new)?;
    index.write()?;
    
    Ok(())
}
```

---

# 3. Line Endings (CRLF/LF)

## 3.1 The Problem

```
Windows default: CRLF (\r\n) - 2 bytes per line end
Unix/macOS: LF (\n) - 1 byte per line end

Without proper handling:
- Every file shows as modified when switching platforms
- Diffs are unreadable (entire file changed)
- Merge conflicts on every line
- Binary files can be corrupted
```

## 3.2 Git Configuration Options

| Setting | Value | Effect |
|---------|-------|--------|
| `core.autocrlf` | `true` | Convert to CRLF on checkout (Windows), LF on commit |
| `core.autocrlf` | `input` | Convert to LF on commit, no conversion on checkout |
| `core.autocrlf` | `false` | No automatic conversion |
| `core.eol` | `lf` | Force LF line endings |
| `core.eol` | `crlf` | Force CRLF line endings |
| `core.eol` | `native` | Use platform default |

## 3.3 .gitattributes Handling

```rust
/// Parse .gitattributes for line ending rules
#[derive(Debug, Clone)]
pub struct GitAttributes {
    rules: Vec<AttributeRule>,
}

#[derive(Debug, Clone)]
pub struct AttributeRule {
    pattern: glob::Pattern,
    attributes: HashMap<String, AttributeValue>,
}

#[derive(Debug, Clone)]
pub enum AttributeValue {
    Set,           // attr
    Unset,         // -attr
    Value(String), // attr=value
    Unspecified,   // !attr
}

impl GitAttributes {
    pub fn parse(content: &str) -> Self {
        let mut rules = Vec::new();
        
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 {
                continue;
            }
            
            let pattern = glob::Pattern::new(parts[0]).ok();
            if let Some(pattern) = pattern {
                let mut attributes = HashMap::new();
                
                for attr in &parts[1..] {
                    if attr.starts_with('-') {
                        attributes.insert(attr[1..].to_string(), AttributeValue::Unset);
                    } else if let Some((key, value)) = attr.split_once('=') {
                        attributes.insert(key.to_string(), AttributeValue::Value(value.to_string()));
                    } else {
                        attributes.insert(attr.to_string(), AttributeValue::Set);
                    }
                }
                
                rules.push(AttributeRule { pattern, attributes });
            }
        }
        
        GitAttributes { rules }
    }
    
    /// Get line ending mode for a file
    pub fn get_eol(&self, path: &Path) -> Option<LineEnding> {
        let path_str = path.to_string_lossy();
        
        // Check rules in reverse order (last match wins)
        for rule in self.rules.iter().rev() {
            if rule.pattern.matches(&path_str) {
                // Check 'eol' attribute
                if let Some(AttributeValue::Value(eol)) = rule.attributes.get("eol") {
                    return match eol.as_str() {
                        "lf" => Some(LineEnding::Lf),
                        "crlf" => Some(LineEnding::Crlf),
                        _ => None,
                    };
                }
                
                // Check 'text' attribute
                if let Some(attr) = rule.attributes.get("text") {
                    match attr {
                        AttributeValue::Set => return Some(LineEnding::Native),
                        AttributeValue::Unset => return Some(LineEnding::Binary),
                        AttributeValue::Value(v) if v == "auto" => {
                            return Some(LineEnding::Auto);
                        }
                        _ => {}
                    }
                }
                
                // Check 'binary' attribute
                if matches!(rule.attributes.get("binary"), Some(AttributeValue::Set)) {
                    return Some(LineEnding::Binary);
                }
            }
        }
        
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LineEnding {
    Lf,
    Crlf,
    Native,
    Binary,
    Auto,
}
```

## 3.4 Line Ending Detection & Conversion

```rust
/// Detect line endings in content
pub fn detect_line_endings(content: &[u8]) -> LineEndingStats {
    let mut stats = LineEndingStats::default();
    
    let mut i = 0;
    while i < content.len() {
        if content[i] == b'\r' {
            if i + 1 < content.len() && content[i + 1] == b'\n' {
                stats.crlf_count += 1;
                i += 2;
                continue;
            } else {
                stats.cr_count += 1; // Old Mac style
            }
        } else if content[i] == b'\n' {
            stats.lf_count += 1;
        }
        i += 1;
    }
    
    // Detect if binary
    stats.is_binary = content.iter().take(8000).any(|&b| b == 0);
    
    stats
}

#[derive(Debug, Default)]
pub struct LineEndingStats {
    pub lf_count: usize,
    pub crlf_count: usize,
    pub cr_count: usize,
    pub is_binary: bool,
}

impl LineEndingStats {
    pub fn dominant_ending(&self) -> Option<LineEnding> {
        if self.is_binary {
            return None;
        }
        
        if self.crlf_count > self.lf_count {
            Some(LineEnding::Crlf)
        } else if self.lf_count > 0 {
            Some(LineEnding::Lf)
        } else {
            None
        }
    }
    
    pub fn is_mixed(&self) -> bool {
        !self.is_binary && self.crlf_count > 0 && self.lf_count > 0
    }
}

/// Normalize line endings
pub fn normalize_line_endings(content: &[u8], target: LineEnding) -> Vec<u8> {
    if matches!(target, LineEnding::Binary) {
        return content.to_vec();
    }
    
    let target_ending = match target {
        LineEnding::Lf | LineEnding::Native if !cfg!(windows) => b"\n".as_slice(),
        LineEnding::Crlf | LineEnding::Native => b"\r\n".as_slice(),
        _ => b"\n".as_slice(),
    };
    
    let mut result = Vec::with_capacity(content.len());
    let mut i = 0;
    
    while i < content.len() {
        if content[i] == b'\r' {
            if i + 1 < content.len() && content[i + 1] == b'\n' {
                // CRLF
                result.extend_from_slice(target_ending);
                i += 2;
                continue;
            } else {
                // CR only (old Mac)
                result.extend_from_slice(target_ending);
                i += 1;
                continue;
            }
        } else if content[i] == b'\n' {
            // LF only
            result.extend_from_slice(target_ending);
            i += 1;
            continue;
        }
        
        result.push(content[i]);
        i += 1;
    }
    
    result
}
```

## 3.5 Diff Display with Line Ending Awareness

```rust
/// Enhanced diff that shows line ending differences
pub struct LineEndingAwareDiff {
    pub hunks: Vec<DiffHunk>,
    pub line_ending_changes: Vec<LineEndingChange>,
}

#[derive(Debug)]
pub struct LineEndingChange {
    pub line_number: usize,
    pub old_ending: LineEnding,
    pub new_ending: LineEnding,
}

impl LineEndingAwareDiff {
    pub fn compute(old: &[u8], new: &[u8]) -> Self {
        // Standard diff
        let hunks = compute_diff(old, new);
        
        // Additionally track line ending changes
        let old_lines = split_lines_preserving_endings(old);
        let new_lines = split_lines_preserving_endings(new);
        
        let mut line_ending_changes = Vec::new();
        
        for (i, (old_line, new_line)) in old_lines.iter().zip(&new_lines).enumerate() {
            let old_ending = detect_line_ending(old_line);
            let new_ending = detect_line_ending(new_line);
            
            if old_ending != new_ending {
                line_ending_changes.push(LineEndingChange {
                    line_number: i + 1,
                    old_ending,
                    new_ending,
                });
            }
        }
        
        Self { hunks, line_ending_changes }
    }
}
```

## 3.6 UI for Line Ending Issues

```typescript
// Show line ending indicator in diff view
@customElement('ok-line-ending-indicator')
export class LineEndingIndicator extends LitElement {
  @property({ type: String }) ending: 'lf' | 'crlf' | 'mixed' = 'lf';
  
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
    }
    :host([ending="lf"]) {
      background: var(--color-success-subtle);
      color: var(--color-success);
    }
    :host([ending="crlf"]) {
      background: var(--color-warning-subtle);
      color: var(--color-warning);
    }
    :host([ending="mixed"]) {
      background: var(--color-error-subtle);
      color: var(--color-error);
    }
  `;
  
  render() {
    const labels = {
      lf: 'LF (Unix)',
      crlf: 'CRLF (Windows)',
      mixed: 'Mixed (!)' 
    };
    
    return html`
      <ok-icon name=${this.ending === 'mixed' ? 'alert-triangle' : 'file-text'}></ok-icon>
      <span>${labels[this.ending]}</span>
    `;
  }
}

// Batch line ending fix dialog
@customElement('ok-fix-line-endings-dialog')  
export class FixLineEndingsDialog extends LitElement {
  @property({ type: Array }) files: FileWithLineEndingIssue[] = [];
  @state() private selectedFix: 'lf' | 'crlf' | 'gitattributes' = 'lf';
  
  render() {
    return html`
      <ok-dialog title="Fix Line Endings">
        <p>${this.files.length} files have inconsistent line endings:</p>
        
        <div class="file-list">
          ${this.files.map(f => html`
            <div class="file-item">
              <code>${f.path}</code>
              <ok-line-ending-indicator ending=${f.currentEnding}></ok-line-ending-indicator>
            </div>
          `)}
        </div>
        
        <fieldset>
          <legend>Convert to:</legend>
          <label>
            <input type="radio" name="fix" value="lf" 
              ?checked=${this.selectedFix === 'lf'}
              @change=${() => this.selectedFix = 'lf'}>
            LF (Unix/macOS) - Recommended for most projects
          </label>
          <label>
            <input type="radio" name="fix" value="crlf"
              ?checked=${this.selectedFix === 'crlf'}
              @change=${() => this.selectedFix = 'crlf'}>
            CRLF (Windows)
          </label>
          <label>
            <input type="radio" name="fix" value="gitattributes"
              ?checked=${this.selectedFix === 'gitattributes'}
              @change=${() => this.selectedFix = 'gitattributes'}>
            Add .gitattributes (recommended for teams)
          </label>
        </fieldset>
        
        ${this.selectedFix === 'gitattributes' ? html`
          <div class="gitattributes-preview">
            <p>Will create/update <code>.gitattributes</code>:</p>
            <pre><code>* text=auto eol=lf
*.bat text eol=crlf
*.ps1 text eol=crlf</code></pre>
          </div>
        ` : null}
        
        <div slot="actions">
          <ok-button @click=${this.close}>Cancel</ok-button>
          <ok-button variant="primary" @click=${this.applyFix}>
            Fix ${this.files.length} Files
          </ok-button>
        </div>
      </ok-dialog>
    `;
  }
}
```

---

# 4. File Permissions

## 4.1 The Problem

```
Git tracks the execute bit (chmod +x)
Windows has no execute bit concept
 
Scenario:
1. Linux dev creates shell script, marks executable
2. Windows dev edits file, commits
3. File loses executable bit
4. Script won't run on Linux

Opposite scenario:
1. Windows dev creates batch file
2. Git marks it non-executable (correctly)
3. Some tools incorrectly add execute bit
```

## 4.2 Git Configuration

```rust
/// Configure filemode handling
pub fn configure_filemode(repo: &Repository) -> Result<(), Error> {
    let mut config = repo.config()?;
    
    #[cfg(windows)]
    {
        // Disable filemode tracking on Windows
        config.set_bool("core.fileMode", false)?;
    }
    
    #[cfg(not(windows))]
    {
        // Enable filemode tracking on Unix
        config.set_bool("core.fileMode", true)?;
    }
    
    Ok(())
}

/// Check if a file should be executable based on shebang/extension
pub fn should_be_executable(path: &Path, content: &[u8]) -> bool {
    // Check shebang
    if content.starts_with(b"#!") {
        return true;
    }
    
    // Check extension
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    matches!(ext.to_lowercase().as_str(), 
        "sh" | "bash" | "zsh" | "fish" |
        "py" | "rb" | "pl" | "php" |
        "js" | "ts" | // If they have shebang
        "exe" | "bat" | "cmd" | "ps1" // Windows executables
    )
}
```

## 4.3 Permission Display and Modification

```rust
/// Get file mode from index
pub fn get_file_mode(repo: &Repository, path: &Path) -> Result<FileMode, Error> {
    let index = repo.index()?;
    
    if let Some(entry) = index.get_path(path, 0) {
        let mode = entry.mode;
        Ok(FileMode::from_raw(mode))
    } else {
        Err(Error::FileNotInIndex)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FileMode {
    Regular,      // 100644
    Executable,   // 100755
    Symlink,      // 120000
    Gitlink,      // 160000 (submodule)
    Tree,         // 040000
}

impl FileMode {
    pub fn from_raw(mode: u32) -> Self {
        match mode {
            0o100644 => FileMode::Regular,
            0o100755 => FileMode::Executable,
            0o120000 => FileMode::Symlink,
            0o160000 => FileMode::Gitlink,
            0o040000 => FileMode::Tree,
            _ => FileMode::Regular, // Default
        }
    }
    
    pub fn to_raw(self) -> u32 {
        match self {
            FileMode::Regular => 0o100644,
            FileMode::Executable => 0o100755,
            FileMode::Symlink => 0o120000,
            FileMode::Gitlink => 0o160000,
            FileMode::Tree => 0o040000,
        }
    }
}

/// Set file as executable in index
pub fn set_executable(repo: &Repository, path: &Path, executable: bool) -> Result<(), Error> {
    let mut index = repo.index()?;
    
    // Get current entry
    let entry = index.get_path(path, 0).ok_or(Error::FileNotInIndex)?;
    
    // Create new entry with updated mode
    let mut new_entry = entry.clone();
    new_entry.mode = if executable { 0o100755 } else { 0o100644 };
    
    // Remove old and add new
    index.remove_path(path)?;
    index.add(&new_entry)?;
    index.write()?;
    
    // Also update working directory on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let workdir = repo.workdir().ok_or(Error::BareRepo)?;
        let full_path = workdir.join(path);
        
        let mut perms = std::fs::metadata(&full_path)?.permissions();
        if executable {
            perms.set_mode(perms.mode() | 0o111);
        } else {
            perms.set_mode(perms.mode() & !0o111);
        }
        std::fs::set_permissions(&full_path, perms)?;
    }
    
    Ok(())
}
```

## 4.4 UI for Permissions

```typescript
@customElement('ok-file-mode-toggle')
export class FileModeToggle extends LitElement {
  @property({ type: String }) path = '';
  @property({ type: Boolean }) executable = false;
  @property({ type: Boolean }) disabled = false;
  
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    
    .toggle {
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 12px;
    }
    
    .toggle.executable {
      background: var(--color-success-subtle);
      color: var(--color-success);
    }
    
    .toggle:not(.executable) {
      background: var(--color-neutral-subtle);
      color: var(--color-neutral);
    }
    
    .toggle:hover:not([disabled]) {
      filter: brightness(0.95);
    }
  `;
  
  private toggle() {
    if (this.disabled) return;
    
    this.dispatchEvent(new CustomEvent('mode-change', {
      detail: { path: this.path, executable: !this.executable }
    }));
  }
  
  render() {
    return html`
      <button 
        class="toggle ${this.executable ? 'executable' : ''}"
        ?disabled=${this.disabled}
        @click=${this.toggle}
        title=${this.executable ? 'Click to remove execute permission' : 'Click to make executable'}
      >
        ${this.executable ? '-rwxr-xr-x' : '-rw-r--r--'}
      </button>
    `;
  }
}
```

---

# 5. Symlinks

## 5.1 The Problem

```
Windows symlink challenges:
1. Requires admin privileges OR Developer Mode
2. Different API than Unix symlinks
3. Some programs don't follow symlinks properly
4. Can't tell file vs directory symlinks apart easily

Git behavior:
- Stores symlink target as file content
- On Windows without symlink support: creates regular file with target path as content
```

## 5.2 Detection and Support

```rust
use std::os::windows::fs::symlink_file;
use std::os::unix::fs::symlink;

/// Check if symlinks are supported
pub fn symlinks_supported(test_dir: &Path) -> bool {
    let link_path = test_dir.join(".symlink_test");
    let target_path = test_dir.join(".symlink_target");
    
    // Create a test file
    if std::fs::write(&target_path, "test").is_err() {
        return false;
    }
    
    // Try to create symlink
    let result = create_symlink(&target_path, &link_path);
    
    // Cleanup
    let _ = std::fs::remove_file(&link_path);
    let _ = std::fs::remove_file(&target_path);
    
    result.is_ok()
}

/// Cross-platform symlink creation
pub fn create_symlink(target: &Path, link: &Path) -> Result<(), Error> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)?;
    }
    
    #[cfg(windows)]
    {
        // Try to detect if target is a directory
        let is_dir = target.is_dir() || 
            target.to_string_lossy().ends_with('/') ||
            target.to_string_lossy().ends_with('\\');
        
        if is_dir {
            std::os::windows::fs::symlink_dir(target, link)?;
        } else {
            std::os::windows::fs::symlink_file(target, link)?;
        }
    }
    
    Ok(())
}

/// Configure symlink handling
pub fn configure_symlinks(repo: &Repository) -> Result<SymlinkConfig, Error> {
    let workdir = repo.workdir().ok_or(Error::BareRepo)?;
    let supported = symlinks_supported(workdir);
    
    let mut config = repo.config()?;
    config.set_bool("core.symlinks", supported)?;
    
    Ok(SymlinkConfig {
        supported,
        windows_developer_mode: cfg!(windows) && supported,
    })
}

#[derive(Debug)]
pub struct SymlinkConfig {
    pub supported: bool,
    pub windows_developer_mode: bool,
}
```

## 5.3 Handling Symlinks in Checkout

```rust
/// Checkout with symlink awareness
pub fn checkout_tree_with_symlinks(
    repo: &Repository,
    tree: &Tree,
    symlinks_supported: bool,
) -> Result<CheckoutResult, Error> {
    let mut result = CheckoutResult::default();
    
    tree.walk(TreeWalkMode::PreOrder, |dir, entry| {
        let path = format!("{}{}", dir, entry.name().unwrap_or(""));
        let full_path = repo.workdir().unwrap().join(&path);
        
        if entry.kind() == Some(ObjectType::Blob) {
            let mode = FileMode::from_raw(entry.filemode() as u32);
            
            if mode == FileMode::Symlink {
                // Read symlink target from blob
                let blob = repo.find_blob(entry.id()).unwrap();
                let target = String::from_utf8_lossy(blob.content());
                
                if symlinks_supported {
                    // Create actual symlink
                    if let Err(e) = create_symlink(Path::new(target.as_ref()), &full_path) {
                        result.symlink_errors.push(SymlinkError {
                            path: path.clone(),
                            target: target.to_string(),
                            error: e.to_string(),
                        });
                    }
                } else {
                    // Create regular file with target as content
                    std::fs::write(&full_path, target.as_bytes()).unwrap();
                    result.symlinks_as_files.push(path);
                }
            }
        }
        
        TreeWalkResult::Ok
    })?;
    
    Ok(result)
}

#[derive(Debug, Default)]
pub struct CheckoutResult {
    pub symlinks_as_files: Vec<String>,
    pub symlink_errors: Vec<SymlinkError>,
}

#[derive(Debug)]
pub struct SymlinkError {
    pub path: String,
    pub target: String,
    pub error: String,
}
```

## 5.4 UI for Symlink Issues

```typescript
@customElement('ok-symlink-warning')
export class SymlinkWarning extends LitElement {
  @property({ type: Array }) symlinkFiles: string[] = [];
  @property({ type: Boolean }) symlinkSupported = false;
  
  render() {
    if (this.symlinkFiles.length === 0) return null;
    
    return html`
      <ok-alert type="warning">
        <strong>Symlinks Not Supported</strong>
        <p>
          This repository contains ${this.symlinkFiles.length} symbolic links, 
          but your system doesn't support them.
          ${!this.symlinkSupported && navigator.platform.includes('Win') ? html`
            <br><br>
            <strong>To enable symlinks on Windows:</strong>
            <ol>
              <li>Enable Developer Mode in Windows Settings</li>
              <li>Or run this application as Administrator</li>
            </ol>
          ` : null}
        </p>
        <details>
          <summary>Affected files (${this.symlinkFiles.length})</summary>
          <ul>
            ${this.symlinkFiles.map(f => html`<li><code>${f}</code></li>`)}
          </ul>
        </details>
      </ok-alert>
    `;
  }
}
```

---

# 6. Path Length Limits

## 6.1 The Problem

| Platform | Limit | Notes |
|----------|-------|-------|
| Windows (default) | 260 chars | MAX_PATH constant |
| Windows (long paths) | 32,767 chars | Requires opt-in |
| macOS | 1024 chars | PATH_MAX |
| Linux | 4096 chars | PATH_MAX |

**Real impact:** Node.js `node_modules` frequently exceeds 260 chars.

## 6.2 Detection and Configuration

```rust
/// Check if long paths are enabled on Windows
#[cfg(windows)]
pub fn long_paths_enabled() -> bool {
    use winreg::enums::*;
    use winreg::RegKey;
    
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) = hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\FileSystem") {
        if let Ok(value) = key.get_value::<u32, _>("LongPathsEnabled") {
            return value == 1;
        }
    }
    false
}

#[cfg(not(windows))]
pub fn long_paths_enabled() -> bool {
    true // Not an issue on Unix
}

/// Get maximum path length for current platform
pub fn max_path_length() -> usize {
    #[cfg(windows)]
    {
        if long_paths_enabled() {
            32767
        } else {
            260
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        1024
    }
    
    #[cfg(target_os = "linux")]
    {
        4096
    }
}

/// Check repository for path length issues
pub fn check_path_lengths(repo: &Repository) -> Vec<PathLengthIssue> {
    let mut issues = Vec::new();
    let max_len = max_path_length();
    let workdir = repo.workdir().unwrap();
    let workdir_len = workdir.to_string_lossy().len();
    
    let head = repo.head().unwrap().peel_to_tree().unwrap();
    head.walk(TreeWalkMode::PreOrder, |dir, entry| {
        let rel_path = format!("{}{}", dir, entry.name().unwrap_or(""));
        let full_len = workdir_len + 1 + rel_path.len(); // +1 for separator
        
        if full_len > max_len {
            issues.push(PathLengthIssue {
                path: rel_path,
                length: full_len,
                max_allowed: max_len,
                exceeds_by: full_len - max_len,
            });
        } else if full_len > max_len - 50 {
            // Warn if close to limit
            issues.push(PathLengthIssue {
                path: rel_path,
                length: full_len,
                max_allowed: max_len,
                exceeds_by: 0, // Warning, not error
            });
        }
        
        TreeWalkResult::Ok
    }).unwrap();
    
    issues
}

#[derive(Debug)]
pub struct PathLengthIssue {
    pub path: String,
    pub length: usize,
    pub max_allowed: usize,
    pub exceeds_by: usize,
}

impl PathLengthIssue {
    pub fn is_error(&self) -> bool {
        self.exceeds_by > 0
    }
}
```

## 6.3 Workarounds

```rust
/// Strategies for handling long paths
pub enum LongPathStrategy {
    /// Clone to shorter path
    ShorterPath { suggested_path: PathBuf },
    /// Enable Windows long paths (requires admin)
    EnableLongPaths,
    /// Use subst to create short drive letter
    SubstDrive { drive_letter: char },
}

/// Create a subst drive on Windows
#[cfg(windows)]
pub fn create_subst_drive(target: &Path) -> Result<char, Error> {
    // Find available drive letter
    let available = ('G'..='Z')
        .find(|&c| !Path::new(&format!("{}:\\", c)).exists())
        .ok_or(Error::NoDriveLetterAvailable)?;
    
    let output = Command::new("subst")
        .arg(format!("{}:", available))
        .arg(target)
        .output()?;
    
    if output.status.success() {
        Ok(available)
    } else {
        Err(Error::SubstFailed(String::from_utf8_lossy(&output.stderr).to_string()))
    }
}

/// Clone with path length awareness
pub fn clone_with_path_check(
    url: &str,
    target: &Path,
) -> Result<CloneResult, Error> {
    // Pre-check: estimate path lengths
    // This would require fetching the tree first (expensive)
    // Instead, we check after clone and warn
    
    let repo = clone(url, target)?;
    let issues = check_path_lengths(&repo);
    
    let errors: Vec<_> = issues.iter().filter(|i| i.is_error()).collect();
    let warnings: Vec<_> = issues.iter().filter(|i| !i.is_error()).collect();
    
    Ok(CloneResult {
        repo,
        path_errors: errors.into_iter().cloned().collect(),
        path_warnings: warnings.into_iter().cloned().collect(),
    })
}
```

## 6.4 UI for Path Length Issues

```typescript
@customElement('ok-path-length-dialog')
export class PathLengthDialog extends LitElement {
  @property({ type: Array }) errors: PathLengthIssue[] = [];
  @property({ type: Boolean }) longPathsEnabled = false;
  
  render() {
    return html`
      <ok-dialog type="error" title="Path Length Exceeded">
        <p>
          ${this.errors.length} files have paths that are too long for your 
          system (max ${this.errors[0]?.maxAllowed} characters).
        </p>
        
        <div class="error-list">
          ${this.errors.slice(0, 5).map(e => html`
            <div class="error-item">
              <code title=${e.path}>${this.truncatePath(e.path)}</code>
              <span class="length">${e.length} chars (+${e.exceedsBy})</span>
            </div>
          `)}
          ${this.errors.length > 5 ? html`
            <div class="more">...and ${this.errors.length - 5} more</div>
          ` : null}
        </div>
        
        <h4>Solutions:</h4>
        
        ${navigator.platform.includes('Win') && !this.longPathsEnabled ? html`
          <div class="solution">
            <strong>Option 1: Enable Long Paths (Recommended)</strong>
            <p>Run this in PowerShell as Administrator:</p>
            <pre><code>New-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force</code></pre>
            <ok-button @click=${this.copyPowershellCommand}>Copy Command</ok-button>
          </div>
        ` : null}
        
        <div class="solution">
          <strong>Option ${this.longPathsEnabled ? '1' : '2'}: Clone to shorter path</strong>
          <p>Clone to a shorter directory path, like:</p>
          <code>C:\\dev\\repo</code> instead of 
          <code>C:\\Users\\Username\\Documents\\Projects\\MyProject\\repo</code>
        </div>
        
        <div slot="actions">
          <ok-button @click=${this.cancel}>Cancel</ok-button>
          <ok-button variant="warning" @click=${this.proceedAnyway}>
            Proceed Anyway (may cause errors)
          </ok-button>
        </div>
      </ok-dialog>
    `;
  }
  
  private truncatePath(path: string): string {
    if (path.length > 60) {
      return path.substring(0, 30) + '...' + path.substring(path.length - 27);
    }
    return path;
  }
}
```

---

# 7. File Locking

## 7.1 The Problem

| Platform | Locking Type | Behavior |
|----------|--------------|----------|
| Windows | Mandatory | Open file cannot be modified/deleted by others |
| macOS | Advisory | Lock is a hint, not enforced |
| Linux | Advisory | Lock is a hint, not enforced |

**Common issues on Windows:**
- IDE has file open → can't stage/checkout
- Antivirus scanning → random lock errors
- Search indexer → intermittent failures
- File preview in Explorer → brief locks

## 7.2 Detection and Handling

```rust
use std::io::ErrorKind;

/// Check if a file is locked
pub fn is_file_locked(path: &Path) -> bool {
    #[cfg(windows)]
    {
        // Try to open with exclusive access
        use std::fs::OpenOptions;
        
        match OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
        {
            Ok(_) => false,
            Err(e) if e.kind() == ErrorKind::PermissionDenied => true,
            Err(e) if e.raw_os_error() == Some(32) => true, // ERROR_SHARING_VIOLATION
            Err(_) => false,
        }
    }
    
    #[cfg(not(windows))]
    {
        // Advisory locking - can check but rarely blocked
        false
    }
}

/// Retry operation with file lock awareness
pub async fn retry_with_lock_handling<T, F, Fut>(
    operation_name: &str,
    path: &Path,
    max_retries: u32,
    mut operation: F,
) -> Result<T, Error>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, Error>>,
{
    let mut last_error = None;
    
    for attempt in 0..max_retries {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) if is_lock_error(&e) => {
                last_error = Some(e);
                
                // Check if file is actually locked
                if is_file_locked(path) {
                    // Exponential backoff
                    let delay = Duration::from_millis(100 * (2_u64.pow(attempt)));
                    tokio::time::sleep(delay).await;
                    continue;
                }
            }
            Err(e) => return Err(e),
        }
    }
    
    Err(Error::FileLocked {
        path: path.to_path_buf(),
        operation: operation_name.to_string(),
        inner: last_error.map(Box::new),
    })
}

fn is_lock_error(e: &Error) -> bool {
    match e {
        Error::Io(io_err) => {
            io_err.kind() == ErrorKind::PermissionDenied ||
            io_err.raw_os_error() == Some(32) || // Windows: ERROR_SHARING_VIOLATION
            io_err.raw_os_error() == Some(33)    // Windows: ERROR_LOCK_VIOLATION
        }
        _ => false,
    }
}

/// Find which process has a file locked (Windows only)
#[cfg(windows)]
pub fn find_locking_process(path: &Path) -> Option<String> {
    use windows::Win32::System::RestartManager::*;
    
    // This requires the Restart Manager API
    // Implementation is complex but possible
    // Returns process name like "Code.exe" or "explorer.exe"
    
    // Simplified: use handle.exe from Sysinternals or similar
    let output = Command::new("handle.exe")
        .arg(path)
        .output()
        .ok()?;
    
    // Parse output to find process name
    let stdout = String::from_utf8_lossy(&output.stdout);
    // ... parse logic
    
    None
}
```

## 7.3 UI for File Locks

```typescript
@customElement('ok-file-locked-dialog')
export class FileLockedDialog extends LitElement {
  @property({ type: String }) path = '';
  @property({ type: String }) operation = '';
  @property({ type: String }) lockingProcess?: string;
  @state() private retrying = false;
  
  render() {
    return html`
      <ok-dialog type="error" title="File Locked">
        <p>
          Cannot ${this.operation} because the file is locked:
        </p>
        <code>${this.path}</code>
        
        ${this.lockingProcess ? html`
          <p>
            <strong>Locked by:</strong> ${this.lockingProcess}
          </p>
        ` : html`
          <p>
            The file may be open in another application (IDE, text editor, 
            file explorer preview, or antivirus scanner).
          </p>
        `}
        
        <h4>Try:</h4>
        <ul>
          <li>Close any applications that might have this file open</li>
          <li>Wait a moment and retry</li>
          <li>Check your antivirus software</li>
        </ul>
        
        <div slot="actions">
          <ok-button @click=${this.cancel}>Cancel</ok-button>
          <ok-button 
            variant="primary" 
            @click=${this.retry}
            ?disabled=${this.retrying}
          >
            ${this.retrying ? 'Retrying...' : 'Retry'}
          </ok-button>
        </div>
      </ok-dialog>
    `;
  }
}
```

---

# 8. Unicode & Filename Encoding

## 8.1 The Problem

```
macOS uses NFD (decomposed): "café" stored as "cafe" + "́" (combining accent)
Windows/Linux use NFC (composed): "café" stored as "café" (single char)

Result: Same visual filename, different bytes
Git sees them as different files
File may appear missing or duplicated
```

## 8.2 Detection and Normalization

```rust
use unicode_normalization::UnicodeNormalization;

/// Normalize a path to NFC
pub fn normalize_path_nfc(path: &Path) -> PathBuf {
    let normalized: String = path.to_string_lossy().nfc().collect();
    PathBuf::from(normalized)
}

/// Check if a string has different NFC/NFD forms
pub fn has_normalization_issue(s: &str) -> bool {
    let nfc: String = s.nfc().collect();
    let nfd: String = s.nfd().collect();
    nfc != nfd && (s != nfc || s != nfd)
}

/// Find Unicode normalization issues in repository
pub fn find_normalization_issues(repo: &Repository) -> Vec<NormalizationIssue> {
    let mut issues = Vec::new();
    let mut seen_nfc: HashMap<String, String> = HashMap::new();
    
    let head = repo.head().unwrap().peel_to_tree().unwrap();
    head.walk(TreeWalkMode::PreOrder, |dir, entry| {
        let path = format!("{}{}", dir, entry.name().unwrap_or(""));
        let nfc: String = path.nfc().collect();
        
        if path != nfc {
            issues.push(NormalizationIssue {
                original: path.clone(),
                normalized: nfc.clone(),
                issue_type: NormalizationIssueType::NotNFC,
            });
        }
        
        if let Some(existing) = seen_nfc.get(&nfc) {
            if existing != &path {
                issues.push(NormalizationIssue {
                    original: path.clone(),
                    normalized: nfc.clone(),
                    issue_type: NormalizationIssueType::Collision {
                        other: existing.clone(),
                    },
                });
            }
        } else {
            seen_nfc.insert(nfc, path);
        }
        
        TreeWalkResult::Ok
    }).unwrap();
    
    issues
}

#[derive(Debug)]
pub struct NormalizationIssue {
    pub original: String,
    pub normalized: String,
    pub issue_type: NormalizationIssueType,
}

#[derive(Debug)]
pub enum NormalizationIssueType {
    NotNFC,
    Collision { other: String },
}

/// Configure precomposeunicode
pub fn configure_unicode(repo: &Repository) -> Result<(), Error> {
    let mut config = repo.config()?;
    
    // macOS specific: normalize filenames
    #[cfg(target_os = "macos")]
    {
        config.set_bool("core.precomposeUnicode", true)?;
    }
    
    Ok(())
}
```

## 8.3 Illegal Characters

```rust
/// Characters not allowed in filenames on Windows
const WINDOWS_ILLEGAL_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Reserved names on Windows (case-insensitive)
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Check if a filename is valid on all platforms
pub fn validate_filename(name: &str) -> Vec<FilenameIssue> {
    let mut issues = Vec::new();
    
    // Check for empty
    if name.is_empty() {
        issues.push(FilenameIssue::Empty);
        return issues;
    }
    
    // Check for Windows illegal characters
    for c in WINDOWS_ILLEGAL_CHARS {
        if name.contains(*c) {
            issues.push(FilenameIssue::IllegalCharacter(*c));
        }
    }
    
    // Check for Windows reserved names
    let name_upper = name.to_uppercase();
    let base_name = name_upper.split('.').next().unwrap_or("");
    if WINDOWS_RESERVED_NAMES.contains(&base_name) {
        issues.push(FilenameIssue::ReservedName(name.to_string()));
    }
    
    // Check for trailing space or period (Windows issue)
    if name.ends_with(' ') || name.ends_with('.') {
        issues.push(FilenameIssue::TrailingSpaceOrPeriod);
    }
    
    // Check for control characters
    if name.chars().any(|c| c.is_control()) {
        issues.push(FilenameIssue::ControlCharacter);
    }
    
    issues
}

#[derive(Debug)]
pub enum FilenameIssue {
    Empty,
    IllegalCharacter(char),
    ReservedName(String),
    TrailingSpaceOrPeriod,
    ControlCharacter,
}

/// Find all cross-platform filename issues in repo
pub fn find_filename_issues(repo: &Repository) -> Vec<FilenameProblem> {
    let mut problems = Vec::new();
    
    let head = repo.head().unwrap().peel_to_tree().unwrap();
    head.walk(TreeWalkMode::PreOrder, |dir, entry| {
        let name = entry.name().unwrap_or("");
        let issues = validate_filename(name);
        
        if !issues.is_empty() {
            problems.push(FilenameProblem {
                path: format!("{}{}", dir, name),
                issues,
            });
        }
        
        TreeWalkResult::Ok
    }).unwrap();
    
    problems
}
```

---

# 9. Hidden Files & System Files

## 9.1 Platform Differences

| Aspect | Windows | macOS/Linux |
|--------|---------|-------------|
| Hidden indicator | `hidden` attribute | Leading dot (`.file`) |
| View in explorer | Option to show | Option to show |
| System files | `system` attribute | N/A |
| Important hidden | `.git`, `Thumbs.db` | `.git`, `.DS_Store` |

## 9.2 Handling

```rust
/// Check if a file is hidden
pub fn is_hidden(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    
    // Unix-style hidden (dot prefix)
    if name.starts_with('.') && name != "." && name != ".." {
        return true;
    }
    
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if let Ok(meta) = path.metadata() {
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            return meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0;
        }
    }
    
    false
}

/// Set hidden attribute (Windows)
#[cfg(windows)]
pub fn set_hidden(path: &Path, hidden: bool) -> Result<(), Error> {
    use std::os::windows::fs::MetadataExt;
    use windows::Win32::Storage::FileSystem::*;
    
    let meta = path.metadata()?;
    let mut attrs = meta.file_attributes();
    
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    if hidden {
        attrs |= FILE_ATTRIBUTE_HIDDEN;
    } else {
        attrs &= !FILE_ATTRIBUTE_HIDDEN;
    }
    
    // SetFileAttributesW
    unsafe {
        SetFileAttributesW(path.as_os_str(), FILE_FLAGS_AND_ATTRIBUTES(attrs))?;
    }
    
    Ok(())
}

/// Ensure .git directory is hidden on Windows
pub fn ensure_git_hidden(repo: &Repository) -> Result<(), Error> {
    #[cfg(windows)]
    {
        let git_dir = repo.path();
        set_hidden(git_dir, true)?;
    }
    Ok(())
}

/// Files to ignore per platform
pub fn platform_ignore_patterns() -> Vec<&'static str> {
    let mut patterns = vec![
        ".git",
    ];
    
    #[cfg(windows)]
    {
        patterns.extend(&[
            "Thumbs.db",
            "desktop.ini",
            "*.lnk",
        ]);
    }
    
    #[cfg(target_os = "macos")]
    {
        patterns.extend(&[
            ".DS_Store",
            ".Spotlight-V100",
            ".Trashes",
            "._*",
        ]);
    }
    
    patterns
}
```

---

# 10. File Watching

## 10.1 Platform Differences

| Platform | API | Reliability | Notes |
|----------|-----|-------------|-------|
| Windows | ReadDirectoryChangesW | Good | Buffer overflow possible |
| macOS | FSEvents | Good | Coalesces events |
| Linux | inotify | Good | Watch limit issues |

## 10.2 Cross-Platform Implementation

```rust
use notify::{RecommendedWatcher, RecursiveMode, Watcher, Config};
use std::sync::mpsc::channel;

/// Cross-platform file watcher
pub struct RepositoryWatcher {
    watcher: RecommendedWatcher,
    repo_path: PathBuf,
}

impl RepositoryWatcher {
    pub fn new(repo_path: PathBuf, callback: impl Fn(WatchEvent) + Send + 'static) -> Result<Self, Error> {
        let (tx, rx) = channel();
        
        // Create watcher with platform-appropriate config
        let config = Config::default()
            .with_poll_interval(Duration::from_secs(2))
            .with_compare_contents(false);
        
        let mut watcher = RecommendedWatcher::new(tx, config)?;
        
        // Watch the repository
        watcher.watch(&repo_path, RecursiveMode::Recursive)?;
        
        // Don't watch .git internals (too noisy)
        // notify doesn't support exclude, so we filter in callback
        
        // Spawn handler thread
        let repo_path_clone = repo_path.clone();
        std::thread::spawn(move || {
            let debouncer = Debouncer::new(Duration::from_millis(100));
            
            for result in rx {
                match result {
                    Ok(event) => {
                        // Filter out .git internals
                        let dominated_by_git = event.paths.iter().all(|p| {
                            p.strip_prefix(&repo_path_clone)
                                .map(|rel| rel.starts_with(".git"))
                                .unwrap_or(false)
                        });
                        
                        if dominated_by_git && !is_ref_change(&event) {
                            continue;
                        }
                        
                        // Debounce
                        if debouncer.should_emit() {
                            callback(WatchEvent::from(event));
                        }
                    }
                    Err(e) => {
                        callback(WatchEvent::Error(e.to_string()));
                    }
                }
            }
        });
        
        Ok(Self { watcher, repo_path })
    }
}

fn is_ref_change(event: &notify::Event) -> bool {
    // HEAD, refs/heads/*, refs/remotes/* changes are important
    event.paths.iter().any(|p| {
        let s = p.to_string_lossy();
        s.ends_with("HEAD") || 
        s.contains("refs/heads") || 
        s.contains("refs/remotes")
    })
}

#[derive(Debug)]
pub enum WatchEvent {
    Changed(Vec<PathBuf>),
    Created(Vec<PathBuf>),
    Deleted(Vec<PathBuf>),
    Renamed { from: PathBuf, to: PathBuf },
    RefChanged,
    Error(String),
}

/// Linux-specific: check inotify limits
#[cfg(target_os = "linux")]
pub fn check_inotify_limits() -> Result<InotifyLimits, Error> {
    let max_user_watches = std::fs::read_to_string(
        "/proc/sys/fs/inotify/max_user_watches"
    )?.trim().parse::<usize>()?;
    
    let max_user_instances = std::fs::read_to_string(
        "/proc/sys/fs/inotify/max_user_instances"
    )?.trim().parse::<usize>()?;
    
    Ok(InotifyLimits {
        max_user_watches,
        max_user_instances,
        recommended_watches: 524288, // Common recommendation
    })
}

#[derive(Debug)]
pub struct InotifyLimits {
    pub max_user_watches: usize,
    pub max_user_instances: usize,
    pub recommended_watches: usize,
}

impl InotifyLimits {
    pub fn is_sufficient(&self) -> bool {
        self.max_user_watches >= self.recommended_watches
    }
    
    pub fn fix_command(&self) -> String {
        format!(
            "echo {} | sudo tee /proc/sys/fs/inotify/max_user_watches",
            self.recommended_watches
        )
    }
}
```

---

# 11. Temporary Files & Atomic Operations

## 11.1 Safe File Writing

```rust
use std::io::Write;
use tempfile::NamedTempFile;

/// Write file atomically (write to temp, then rename)
pub fn atomic_write(path: &Path, content: &[u8]) -> Result<(), Error> {
    let parent = path.parent().ok_or(Error::InvalidPath)?;
    
    // Create temp file in same directory (required for atomic rename)
    let mut temp = NamedTempFile::new_in(parent)?;
    temp.write_all(content)?;
    temp.flush()?;
    
    // Sync to disk
    temp.as_file().sync_all()?;
    
    // Atomic rename
    #[cfg(unix)]
    {
        temp.persist(path)?;
    }
    
    #[cfg(windows)]
    {
        // Windows rename fails if target exists
        // Use persist_noclobber and handle error
        match temp.persist_noclobber(path) {
            Ok(_) => {}
            Err(e) => {
                // Target exists, need to delete first (not atomic!)
                if path.exists() {
                    std::fs::remove_file(path)?;
                }
                e.file.persist(path)?;
            }
        }
    }
    
    Ok(())
}

/// Create a temporary directory in appropriate location
pub fn create_temp_dir(prefix: &str) -> Result<TempDir, Error> {
    // Use repo-local temp if possible (same filesystem for atomic ops)
    // Otherwise use system temp
    
    let temp_dir = tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()?;
    
    Ok(temp_dir)
}
```

---

# 12. Testing Strategy

## 12.1 Test Matrix

```rust
/// Test configuration for cross-platform behavior
#[derive(Debug)]
pub struct PlatformTestConfig {
    pub case_sensitive_fs: bool,
    pub symlinks_supported: bool,
    pub long_paths_enabled: bool,
    pub unicode_normalization: UnicodeNormalization,
    pub line_ending_default: LineEnding,
}

impl PlatformTestConfig {
    pub fn current() -> Self {
        Self {
            case_sensitive_fs: detect_case_sensitivity(),
            symlinks_supported: detect_symlink_support(),
            long_paths_enabled: long_paths_enabled(),
            unicode_normalization: detect_normalization(),
            line_ending_default: if cfg!(windows) { LineEnding::Crlf } else { LineEnding::Lf },
        }
    }
    
    pub fn simulated_windows() -> Self {
        Self {
            case_sensitive_fs: false,
            symlinks_supported: false,
            long_paths_enabled: false,
            unicode_normalization: UnicodeNormalization::NFC,
            line_ending_default: LineEnding::Crlf,
        }
    }
    
    pub fn simulated_macos() -> Self {
        Self {
            case_sensitive_fs: false,
            symlinks_supported: true,
            long_paths_enabled: true,
            unicode_normalization: UnicodeNormalization::NFD,
            line_ending_default: LineEnding::Lf,
        }
    }
    
    pub fn simulated_linux() -> Self {
        Self {
            case_sensitive_fs: true,
            symlinks_supported: true,
            long_paths_enabled: true,
            unicode_normalization: UnicodeNormalization::NFC,
            line_ending_default: LineEnding::Lf,
        }
    }
}

#[cfg(test)]
mod platform_tests {
    use super::*;
    
    #[test]
    fn test_case_sensitivity_detection() {
        let config = PlatformTestConfig::current();
        println!("Case sensitive: {}", config.case_sensitive_fs);
        // Test passes on all platforms - just detection
    }
    
    #[test]
    fn test_clone_with_case_conflicts() {
        let repo = setup_test_repo_with_case_conflicts();
        let config = PlatformTestConfig::current();
        
        let issues = pre_checkout_case_check(&repo, config.case_sensitive_fs);
        
        if config.case_sensitive_fs {
            assert!(issues.is_empty(), "Should have no issues on case-sensitive FS");
        } else {
            assert!(!issues.is_empty(), "Should detect case conflicts");
        }
    }
    
    #[test]
    fn test_line_ending_normalization() {
        let content_crlf = b"line1\r\nline2\r\n";
        let content_lf = b"line1\nline2\n";
        
        let normalized = normalize_line_endings(content_crlf, LineEnding::Lf);
        assert_eq!(normalized, content_lf);
        
        let normalized = normalize_line_endings(content_lf, LineEnding::Crlf);
        assert_eq!(normalized, content_crlf);
    }
    
    #[test]
    #[cfg(unix)]
    fn test_symlink_creation() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        let link = dir.path().join("link");
        
        std::fs::write(&target, "content").unwrap();
        create_symlink(&target, &link).unwrap();
        
        assert!(link.is_symlink());
    }
    
    #[test]
    fn test_unicode_normalization() {
        let nfc = "café";  // Single character é
        let nfd = "cafe\u{0301}"; // e + combining accent
        
        assert!(has_normalization_issue(nfd));
        
        let normalized: String = nfd.nfc().collect();
        assert_eq!(normalized, nfc);
    }
    
    #[test]
    fn test_filename_validation() {
        // Valid on all platforms
        assert!(validate_filename("normal.txt").is_empty());
        assert!(validate_filename("file-name_123.rs").is_empty());
        
        // Invalid on Windows
        let issues = validate_filename("file:name.txt");
        assert!(!issues.is_empty());
        
        let issues = validate_filename("CON.txt");
        assert!(!issues.is_empty());
        
        let issues = validate_filename("file.txt ");
        assert!(!issues.is_empty());
    }
}
```

## 12.2 CI Configuration

```yaml
# .github/workflows/cross-platform.yml
name: Cross-Platform Tests

on: [push, pull_request]

jobs:
  test-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: cargo test --features platform-tests
      - name: Test with long paths
        run: |
          # Enable long paths in registry
          reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
          cargo test --features long-path-tests
        shell: pwsh
        
  test-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: cargo test --features platform-tests
      - name: Test case-sensitive APFS
        run: |
          # Create case-sensitive disk image
          hdiutil create -size 100m -fs "Case-sensitive APFS" -volname "CaseSensitive" /tmp/case.dmg
          hdiutil attach /tmp/case.dmg
          cd /Volumes/CaseSensitive
          cargo test --features case-sensitive-tests
          
  test-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: cargo test --features platform-tests
      - name: Test with case-insensitive mount
        run: |
          # Create case-insensitive filesystem for testing
          dd if=/dev/zero of=/tmp/citest.img bs=1M count=100
          mkfs.vfat /tmp/citest.img
          mkdir -p /mnt/citest
          sudo mount -o loop /tmp/citest.img /mnt/citest
          cd /mnt/citest
          cargo test --features case-insensitive-tests
```

---

# 13. Implementation Checklist

## 13.1 Repository Operations

| Operation | Case | LineEnd | Perms | Symlink | PathLen | Unicode | Lock |
|-----------|------|---------|-------|---------|---------|---------|------|
| Clone | ✅ Warn | ✅ Auto | ✅ Config | ✅ Fallback | ✅ Warn | ✅ NFC | N/A |
| Checkout | ✅ Warn | ✅ Convert | ✅ Apply | ✅ Handle | ✅ Check | ✅ NFC | ✅ Retry |
| Status | ✅ Detect | ✅ Ignore | ✅ Track | ✅ Show | N/A | ✅ Match | N/A |
| Stage | ✅ Warn | ✅ Convert | ✅ Track | ✅ Add | N/A | ✅ NFC | ✅ Retry |
| Commit | N/A | ✅ Ensure | ✅ Preserve | ✅ Store | N/A | ✅ NFC | N/A |
| Diff | ✅ Match | ✅ Handle | ✅ Show | ✅ Show | N/A | ✅ Match | N/A |
| Merge | ✅ Warn | ✅ Handle | ✅ Preserve | ✅ Handle | N/A | ✅ Match | ✅ Retry |

## 13.2 User-Facing Warnings

| Issue | When to Show | Severity | Action |
|-------|--------------|----------|--------|
| Case conflict | Clone/checkout | Error | Block or confirm |
| Mixed line endings | Status/diff | Warning | Offer fix |
| Symlink unsupported | Clone/checkout | Warning | Inform |
| Path too long | Clone/checkout | Error | Suggest fix |
| Unicode collision | Clone/checkout | Warning | Inform |
| File locked | Any write | Error | Retry option |
| Illegal filename | Clone/checkout | Error | Block or rename |

## 13.3 Configuration UI

```typescript
@customElement('ok-cross-platform-settings')
export class CrossPlatformSettings extends LitElement {
  @property({ type: Object }) config: CrossPlatformConfig = {};
  
  render() {
    return html`
      <ok-settings-section title="Cross-Platform Compatibility">
        
        <ok-setting 
          title="Line Endings"
          description="How to handle line endings when checking out and committing files"
        >
          <select @change=${this.onLineEndingChange}>
            <option value="auto" ?selected=${this.config.lineEndings === 'auto'}>
              Automatic (recommended)
            </option>
            <option value="lf" ?selected=${this.config.lineEndings === 'lf'}>
              Always LF (Unix)
            </option>
            <option value="crlf" ?selected=${this.config.lineEndings === 'crlf'}>
              Always CRLF (Windows)
            </option>
            <option value="native" ?selected=${this.config.lineEndings === 'native'}>
              Native (platform default)
            </option>
          </select>
        </ok-setting>
        
        <ok-setting
          title="Case Sensitivity Warnings"
          description="Warn when files may conflict on case-insensitive systems"
        >
          <ok-toggle 
            ?checked=${this.config.caseWarnings}
            @change=${this.onCaseWarningsChange}
          ></ok-toggle>
        </ok-setting>
        
        <ok-setting
          title="Symlink Handling"
          description="What to do when symlinks can't be created"
        >
          <select @change=${this.onSymlinkChange}>
            <option value="warn">Warn and create regular file</option>
            <option value="error">Show error</option>
            <option value="skip">Skip silently</option>
          </select>
        </ok-setting>
        
        ${navigator.platform.includes('Win') ? html`
          <ok-setting
            title="Long Paths"
            description="Enable support for paths longer than 260 characters"
          >
            <ok-button 
              variant="secondary"
              @click=${this.enableLongPaths}
              ?disabled=${this.config.longPathsEnabled}
            >
              ${this.config.longPathsEnabled ? 'Enabled' : 'Enable (requires admin)'}
            </ok-button>
          </ok-setting>
        ` : null}
        
      </ok-settings-section>
    `;
  }
}
```

---

# Summary

## Key Takeaways

1. **Test on all platforms from day one** - CI must include Windows, macOS, and Linux
2. **Default to safe behavior** - Warn early, don't silently fail
3. **Make issues visible** - Users should understand what's happening
4. **Provide fixes** - Don't just warn, offer solutions
5. **Configure git properly** - Set `core.ignoreCase`, `core.autocrlf`, `core.symlinks` correctly

## Priority Order

| Priority | Issue | Reason |
|----------|-------|--------|
| P0 | Line endings | Most common issue, affects everyone |
| P0 | File locking (Windows) | Blocks basic operations |
| P1 | Case sensitivity | Causes data loss |
| P1 | Path length (Windows) | Common with npm |
| P2 | Symlinks | Affects some projects |
| P2 | Unicode normalization | Rare but severe |
| P3 | File permissions | Minor inconvenience |

---

*Document Version: 1.0*
*Created: December 2024*
*Purpose: Technical Spike for Cross-Platform File System Challenges*
