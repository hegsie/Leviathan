# Leviathan Roadmap

This document outlines the strategic vision and planned features for Leviathan. For current features, see [README.md](README.md).

## Vision

Leviathan aims to become a polished, cross-platform, power-user Git GUI that can fully replace tools like Sourcetree, Fork, and GitKraken for developers who care about **privacy and performance**. Unlike commercial alternatives, Leviathan:

- **Runs entirely offline** with no telemetry, account requirements, or cloud dependencies
- **Respects your privacy** by keeping all data local
- **Performs exceptionally** even with large repositories
- **Remains open source** and transparent

Our north star: *A fast, scriptable, offline-first Git workstation that teams can standardize on without giving up their privacy or their existing tools.*

---

## Strategic Phases

### 1. Short-term: Stabilize and Delight ✅

**Goal:** Make core Git workflows rock-solid and pleasant enough for a full workday without dropping to the terminal (except for very advanced commands).

**Test:** "Can I do a full workday in this client (branching, committing, rebasing, resolving conflicts, reviewing diffs) without dropping to the terminal?"

#### Core Commit Workflow

- ✅ **Staging refinements**
  - Line-level staging (stage/unstage individual lines within hunks)
  - Better visual feedback for partially staged files
  - Preserve partial staging during file edits

- ✅ **Commit operations**
  - Commit message templates with variables
  - Auto-populate from .gitmessage
  - Conventional commits support
  - Quick amend/reword/fixup/squash from history

- ✅ **Auto-stashing**
  - Auto-stash on checkout with conflicts
  - Smart stash application after branch switch
  - Stash conflict resolution

#### Repository Browsing & Navigation

- ✅ **Branch management**
  - Clearer branch list with grouping (local/remote/stale)
  - Quick branch switching with fuzzy search
  - Branch health indicators (ahead/behind, last commit date)
  - Delete merged branches in bulk

- ✅ **Log view improvements**
  - Search and filtering by author, message, date range, file path
  - Save filter presets
  - Performance for repositories with 100k+ commits
  - Blame integration from log view

- ✅ **Tags & remotes**
  - Better tag visualization in graph
  - Remote management improvements
  - Quick remote branch tracking setup

#### UX Polish

- ✅ **Keyboard shortcuts**
  - Comprehensive keyboard navigation
  - Customizable keyboard shortcut editor
  - Vim-style navigation
  - Quick switcher (files, branches, commits)

- ✅ **Visual themes**
  - Dark/light themes
  - Syntax highlighting themes
  - Custom color schemes for graph and UI (default, pastel, vibrant, monochrome, high-contrast)
  - Compact/comfortable/spacious density settings

- ✅ **Responsiveness & feedback**
  - Clear progress indicators for long operations
  - Cancellation support for fetch/clone/push
  - Better error messages with suggested fixes
  - Toast notifications for background operations

#### Performance & Reliability

- ✅ **Large repository handling**
  - Virtual scrolling for graph and diffs
  - Lazy loading for commit history
  - Background indexing for faster searches
  - Memory optimization for huge diffs

- ✅ **Robustness**
  - Operation timeout handling
  - Conflict detection and recovery
  - Repository health checks
  - Automatic fsck and gc recommendations

---

### 2. Medium-term: Power Features (Still Offline)

**Goal:** Add advanced features that power users need while maintaining the privacy-first promise. No accounts, telemetry, or cloud services required.

#### Advanced Branch & History Management

- ✅ **Visual interactive rebase**
  - Drag-and-drop reordering of commits
  - Edit/squash/fixup/drop actions in UI
  - Conflict resolution during rebase
  - Preview of rebase result before executing

- ✅ **Branch graph enhancements**
  - Filter graph by author, message, date, path
  - Hide/show branches dynamically
  - Export graph as image/SVG
  - Graph performance for complex histories

- ✅ **Branch cleanup automation**
  - One-click "delete merged branches" with accurate graph-based merge detection
  - Stale branch detection with configurable rules
  - Safe delete with upstream tracking verification
  - Remote tracking branch pruning

#### Conflict Resolution

- ✅ **Built-in 3-way merge editor**
  - Side-by-side conflict view with base/theirs/ours
  - Inline explanations of conflict origin
  - Smart conflict resolution suggestions (AI-powered per-chunk and batch resolution)
  - Chunk-by-chunk resolution workflow

- ✅ **External merge tool integration**
  - Configure Kdiff3, Beyond Compare, Meld, P4Merge
  - Launch external tool from conflict view
  - Auto-detect common merge tools (availability checking)
  - Custom tool configuration

#### Multi-Repository Workflows

- ✅ **Workspace concept**
  - Group related repositories (monorepos or microservices)
  - Quick switching between workspace repos
  - Batch operations (fetch all, pull all, status overview)
  - Workspace persistence and management dialog

- ✅ **Workspace enhancements**
  - Workspace-level search (find across all repos)
  - Import/export workspace configurations
  - Clone and setup entire project structures (planned)

#### Local Hooks & Automation

- ✅ **Custom actions**
  - Define per-repo custom commands
  - Execute scripts from the UI

- ✅ **Git hooks UI**
  - Visual hook configuration (pre-commit, commit-msg, pre-push)
  - Hook templates (lint, format, test)
  - Enable/disable hooks per repository
  - Hook execution logs and debugging (planned)

---

### 3. Long-term: Positioning & Ecosystem

**Goal:** Position Leviathan as a mature, extensible Git workstation that integrates into developer workflows without compromising privacy.

#### Extensibility & Customization

- **Plugin system**
  - Extension API for custom panels and views
  - Community plugins (without shipping cloud integrations in core)
  - Plugin marketplace or registry
  - Safe plugin sandboxing

#### Opinionated Workflow Support

- ✅ **Git Flow**
  - Initialize Git Flow with configuration
  - Feature/release/hotfix branch creation and finish operations
  - Automatic branch naming conventions
  - Version tagging with semantic versioning
  - Customizable branch prefixes

- **Additional workflow templates** (planned)
  - GitHub Flow with PR-centric development
  - GitLab Flow with environment branches
  - Trunk-Based Development with feature flags
  - Custom workflow definitions

- **Guided workflows** (planned)
  - "New feature" wizard (branch, commit, PR creation)
  - "Release" wizard (tag, changelog, notes)
  - "Hotfix" wizard (emergency branch, backport)
  - Workflow-specific validation and guardrails

#### Cross-Platform Excellence

- **Accessibility**
  - Screen reader support (ARIA labels, semantic HTML)
  - ✅ Keyboard-only navigation
  - ✅ High-contrast theme
  - ✅ Configurable font sizes and density
  - Focus indicators and skip links
  - Full accessibility audit and compliance

---

## Detailed Feature Backlog

### UI/UX Enhancements

- ✅ **Inline editing** — edit files directly in diff view with syntax-aware editing
- ✅ **Image diff** — side-by-side, onion skin, swipe slider, difference highlighting (PNG, JPG, GIF, WebP)
- ✅ **Notifications & background operations** — push/pull notifications, conflict alerts, system tray, per-repo preferences
- ✅ **Auto-fetch** — configurable intervals, fetch on focus, remote change indicators, rate limiting, pause/resume

---

### Advanced Git Features

- ✅ **Patch operations** — create patches (format-patch), apply with context awareness, mailbox patches (am)
- ✅ **Archive & export** — ZIP/TAR/TAR.GZ archives, specific refs, custom prefix paths
- ✅ **Git notes** — add/edit/remove commit notes, custom notes refs, namespace management
- ✅ **Sparse checkout** — initialize, add/remove paths, cone mode, disable
- ✅ **Bundle operations** — create/verify/list/unbundle for offline transfer and air-gapped environments

- **Shallow & partial clones** (planned)
  - Shallow clone with configurable `--depth`
  - Deepen shallow clones incrementally
  - Partial clone with blob/tree filters
  - Fetch missing objects on demand
  - Convert between shallow and full clones

---

### Maintenance & Performance

- ✅ **Repository maintenance** — garbage collection with progress, prune unreachable objects, repack, health dialog
- ✅ **Repository health & diagnostics** — fsck with detailed output, integrity checks, health score and recommendations
- ✅ **Performance optimization** — virtual scrolling, lazy loading, background indexing, incremental rendering for large diffs

---

### Distribution & Platform Support

- ✅ **Code signing & notarization**
  - macOS: Apple Developer certificate, notarization, hardened runtime, CI/CD automation
  - Windows: MSI/NSIS installers with signing
  - Linux: DEB, AppImage, RPM packages

- ✅ **Auto-updates** — Tauri updater with signing key, background download with install prompt

- **Distribution improvements** (planned)
  - Flatpak distribution on Flathub
  - Snap package for Ubuntu Software
  - Delta updates for reduced download size
  - Update channels (stable, beta, nightly)
  - Rollback support for failed updates

---

### AI & Machine Learning Features

- ✅ **Local AI backends** — Ollama, LM Studio auto-detection, configurable model selection, provider fallback
- ✅ **Cloud AI providers** — Anthropic Claude, GitHub Copilot, OpenAI, Google Gemini, API key management
- ✅ **AI-assisted workflows**
  - Generate commit messages from staged changes
  - Conflict resolution suggestions with reasoning

- **AI enhancements** (planned)
  - Code review suggestions with explanations
  - Automated commit message improvements (grammar, clarity, conventional format)
  - Smart branch naming based on issue or task
  - Pull request description generation from commits
  - Diff summarization for large changes
  - Code explanation for complex diffs
  - Security vulnerability detection in changes
  - Usage tracking and cost estimates per provider
  - Rate limiting and quota management

---

### Authentication & Security

- ✅ **GitHub OAuth** — browser-based OAuth 2.0 with PKCE, automatic token refresh, scope management
- ✅ **GitLab OAuth** — OAuth for GitLab.com and self-hosted instances, custom OAuth application configuration
- ✅ **Bitbucket** — OAuth authentication, workspace and repository access, PRs/issues/pipelines
- ✅ **Azure DevOps** — PAT authentication, PRs/work items/pipelines

> **Note on Azure DevOps OAuth:** Microsoft deprecated Azure DevOps native OAuth in April 2025 (full removal 2026). Microsoft Entra ID OAuth only supports work/school accounts. Leviathan uses PAT authentication. We will monitor Microsoft's promised "native MSA support" for Entra ID OAuth. See: https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth

- **Future authentication** (planned)
  - GitHub App installation (fine-grained permissions, org-level, no token expiration)
  - Git Credential Manager (GCM) integration
  - Enterprise SSO (SAML, OIDC)

---

### Testing & Quality Assurance

- ✅ **Unit tests** — 100+ test files, 1900+ tests via web-test-runner
- ✅ **E2E tests** — 38 Playwright test files covering dialogs, git operations, UI components, OAuth flows
- ✅ **Rust tests** — integration tests for Tauri commands with TestRepo helpers
- ✅ **CI/CD** — GitHub Actions build workflow with signing for tagged releases

- **Testing improvements** (planned)
  - Visual regression testing with screenshot comparisons
  - Accessibility (a11y) automated testing with axe-core
  - Performance benchmarks for large repositories
  - Code coverage thresholds and enforcement
  - Multi-browser E2E execution (Chromium, Firefox, WebKit)

---

### Future Explorations

These are ideas for the distant future, to be evaluated based on user feedback and project maturity:

- **Code review tools** — inline commenting, review workflow, approval tracking, checklist templates
- **Repository analytics** — commit frequency graphs, contributor visualization, code churn, file heatmaps (all local)
- **Plugin/extension system** — extension API, community plugins, marketplace, sandboxing
- **Internationalization (i18n)** — multi-language support, community translations, RTL support
- **Mobile companion app** — view status, review PRs, approve/comment (read-only)

---

## Security & Trust as Differentiators

Reinforce Leviathan's privacy-first positioning through transparency and user control:

- **Plain text storage** — all configuration in human-readable JSON/TOML, easy to inspect and version control
- **Data locality** — all data stored locally, no cloud sync, clear documentation of what's stored where
- **Paranoid mode** (planned) — explicit network operation prompts, remote whitelist/blacklist, offline mode
- **Supply chain security** (planned) — reproducible builds, dependency auditing, CVE monitoring

---

## Contributing to the Roadmap

Have ideas or feedback on these plans? We welcome community input!

1. **Open an issue** to discuss new feature ideas
2. **Comment on existing issues** to vote or provide use cases
3. **Submit a PR** if you want to help implement a feature
4. **Join discussions** in GitHub Discussions for broader topics

Remember: Leviathan's core value proposition is **privacy-first, offline-capable, high-performance Git GUI**. Features should align with these principles.

---

Last updated: 2026-02-11
