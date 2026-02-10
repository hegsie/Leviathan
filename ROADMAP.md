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

### 1. Short-term: Stabilize and Delight

**Goal:** Make core Git workflows rock-solid and pleasant enough for a full workday without dropping to the terminal (except for very advanced commands).

**Test:** "Can I do a full workday in this client (branching, committing, rebasing, resolving conflicts, reviewing diffs) without dropping to the terminal?"

#### Core Commit Workflow

- **Staging refinements**
  - ✅ Line-level staging (stage/unstage individual lines within hunks)
  - ✅ Better visual feedback for partially staged files
  - ✅ Preserve partial staging during file edits

- **Commit operations**
  - ✅ Commit message templates with variables
  - ✅ Auto-populate from .gitmessage
  - ✅ Conventional commits support
  - ✅ Quick amend/reword/fixup/squash from history

- **Auto-stashing**
  - ✅ Auto-stash on checkout with conflicts
  - ✅ Smart stash application after branch switch
  - ✅ Stash conflict resolution

#### Repository Browsing & Navigation

- **Branch management**
  - ✅ Clearer branch list with grouping (local/remote/stale)
  - ✅ Quick branch switching with fuzzy search
  - ✅ Branch health indicators (ahead/behind, last commit date)
  - ✅ Delete merged branches in bulk

- **Log view improvements**
  - ✅ Search and filtering by author, message, date range, file path
  - ✅ Save filter presets
  - ✅ Performance for repositories with 100k+ commits
  - ✅ Blame integration from log view

- **Tags & remotes**
  - ✅ Better tag visualization in graph
  - ✅ Remote management improvements
  - ✅ Quick remote branch tracking setup

#### UX Polish

- **Keyboard shortcuts**
  - ✅ Comprehensive keyboard navigation
  - ✅ Customizable keyboard shortcut editor
  - ✅ Vim-style navigation
  - ✅ Quick switcher (files, branches, commits)

- **Visual themes**
  - Dark/light themes (✅ done)
  - Syntax highlighting themes (✅ done)
  - ✅ Custom color schemes for graph and UI
  - ✅ Compact/comfortable/spacious density settings

- **Responsiveness & feedback**
  - ✅ Clear progress indicators for long operations
  - ✅ Cancellation support for fetch/clone/push
  - ✅ Better error messages with suggested fixes
  - ✅ Toast notifications for background operations

#### Performance & Reliability

- **Large repository handling**
  - ✅ Virtual scrolling improvements
  - ✅ Lazy loading for commit history
  - ✅ Background indexing for faster searches
  - ✅ Memory optimization for huge diffs

- **Robustness**
  - ✅ Operation timeout handling
  - ✅ Conflict detection and recovery
  - ✅ Repository health checks
  - ✅ Automatic fsck and gc recommendations

---

### 2. Medium-term: Power Features (Still Offline)

**Goal:** Add advanced features that power users need while maintaining the privacy-first promise. No accounts, telemetry, or cloud services required.

#### Advanced Branch & History Management

- **Visual interactive rebase**
  - Drag-and-drop reordering of commits
  - Edit/squash/fixup/drop actions in UI
  - Conflict resolution during rebase
  - Preview of rebase result before executing

- **Branch graph enhancements**
  - Filter graph by author, message, date, path
  - Hide/show branches dynamically
  - Export graph as image/SVG
  - Graph performance for complex histories

- **Branch cleanup automation**
  - One-click "delete merged branches"
  - Stale branch detection with configurable rules
  - Safe delete with upstream tracking verification

#### Conflict Resolution

- ✅ **Built-in 3-way merge editor**
  - ✅ Side-by-side conflict view with base/theirs/ours
  - ✅ Inline explanations of conflict origin
  - Smart conflict resolution suggestions (planned)
  - ✅ Chunk-by-chunk resolution workflow

- **External merge tool integration**
  - Configure Kdiff3, Beyond Compare, Meld, P4Merge (planned)
  - Launch external tool from conflict view (planned)
  - Auto-detect common merge tools (planned)
  - Custom tool configuration (planned)

#### Multi-Repository Workflows

- **Workspace concept**
  - Group related repositories (monorepos or microservices)
  - Quick switching between workspace repos
  - Workspace-level search (find across all repos)
  - Batch operations (pull all, fetch all, status overview)

- **Project templates**
  - Save workspace configurations
  - Clone and setup entire project structures
  - Import/export workspace definitions

#### Local Hooks & Automation

- **Git hooks UI**
  - Configure pre-commit, commit-msg, pre-push hooks
  - Hook templates (lint, format, test)
  - Enable/disable hooks per repository
  - Hook execution logs and debugging

- **Custom task buttons**
  - Define per-repo tasks (build, test, deploy scripts)
  - Show task output in integrated terminal
  - Task status in UI (running, success, failed)
  - Keyboard shortcuts for common tasks

---

### 3. Long-term: Positioning & Ecosystem

**Goal:** Position Leviathan as a mature, extensible Git workstation that integrates into developer workflows without compromising privacy.

#### Extensibility & Customization

- **Plugin system**
  - Extension API for custom panels and views
  - Community plugins (without shipping cloud integrations in core)
  - Plugin marketplace or registry
  - Safe plugin sandboxing

- **Custom commands**
  - Define per-repo or per-workspace custom commands
  - Commands appear in command palette
  - Script templates for common workflows
  - Share command configurations across team

#### Opinionated Workflow Support

- **Workflow templates**
  - Git Flow initialization and operations (feature/release/hotfix) 
  - GitHub Flow with PR-centric development
  - GitLab Flow with environment branches
  - Trunk-Based Development with feature flags
  - Custom workflow definitions

- **Guided workflows**
  - "New feature" wizard (branch, commit, PR creation)
  - "Release" wizard (tag, changelog, notes)
  - "Hotfix" wizard (emergency branch, backport)
  - Workflow-specific validation and guardrails

#### Cross-Platform Excellence

- **Platform parity**
  - Consistent keyboard shortcuts across macOS/Windows/Linux
  - Native look and feel on each platform
  - Platform-specific optimizations (Metal GPU, DirectX, Vulkan)

- **Distribution improvements**
  - AppImage/Flatpak for Linux
  - Signed .dmg and notarization for macOS
  - Signed installers for Windows
  - Auto-updates with delta downloads
  - Update channels (stable, beta, nightly)

- **Accessibility**
  - Screen reader support (ARIA labels, semantic HTML)
  - Keyboard-only navigation (already strong)
  - High-contrast theme
  - Configurable font sizes and spacing
  - Focus indicators and skip links

#### Team Collaboration (Privacy-Preserving)

- **Repository analytics**
  - Local statistics (commit frequency, contributor graphs)
  - Code churn analysis
  - No data sent to external servers

- **Documentation integration**
  - Markdown preview for README, CONTRIBUTING
  - Wiki clone and browse (for GitHub/GitLab wikis)
  - Local documentation search

---

## 4. Security & Trust as Differentiators

Reinforce Leviathan's privacy-first positioning through transparency and user control:

#### Transparent Configuration

- **Plain text storage**
  - All configuration in human-readable files (JSON/TOML)
  - Easy to inspect, back up, and version control
  - No hidden telemetry settings

- **Data locality**
  - All data stored locally (no cloud sync)
  - Clear documentation of what's stored where
  - Export/import configuration and data

#### Paranoid Mode

- **Network operation controls**
  - Optional "paranoid mode" with explicit network operation prompts
  - Whitelist/blacklist for Git remote operations
  - Visual indicators for network activity
  - Offline mode (block all network operations)

#### Security Transparency

- **Public security documentation**
  - How updates work (check for updates vs auto-install)
  - What data is collected (none!) and why
  - How to verify binary signatures
  - Security bug reporting process

- **Supply chain security**
  - Reproducible builds
  - Dependency auditing and minimal dependencies
  - Regular security updates and CVE monitoring

---

## 5. Actionable Next Steps

To turn this vision into concrete progress:

1. **Define the primary user persona**
   - Solo developer vs team developer
   - Primary OS (macOS/Windows/Linux)
   - Most common Git workflows

2. **Map a "day in the life"**
   - List every Git task the user does daily
   - Ensure smooth path for each in Leviathan
   - Identify gaps and friction points

3. **Prioritize short-term items**
   - Focus on blockers for "full workday" test
   - Fix critical bugs and performance issues
   - Polish existing features before adding new ones

4. **Implement 1-2 power features deeply**
   - Choose impactful features (e.g., visual interactive rebase, 3-way merge editor)
   - Implement thoroughly with excellent UX
   - Better to have few excellent features than many mediocre ones

5. **Gather feedback continuously**
   - Use the tool daily for development
   - Monitor GitHub issues and discussions
   - Revisit roadmap every few releases

---

## Detailed Feature Backlog

This section contains specific features organized by category. Items here support the strategic phases above.

### UI/UX Enhancements

#### Inline Editing
- Edit files directly in diff view
- Quick fixes for conflicts  
- Syntax-aware editing
- Save directly from diff view

#### Image Diff
- ✅ Side-by-side image comparison
- ✅ Onion skin overlay mode
- ✅ Swipe comparison slider
- ✅ Difference highlighting
- ✅ Support for common formats (PNG, JPG, GIF, WebP)

#### Notifications & Background Operations
- Push/pull completion notifications
- Conflict alerts
- Background operation status
- System tray integration
- Notification preferences per repository

#### Auto-fetch
- Configurable periodic fetch intervals
- Fetch on window focus/activation
- Remote change indicators in UI
- Background sync with rate limiting
- Pause/resume background fetch

---

### Workflow Templates

#### Git Flow
- Initialize Git Flow with configuration
- Feature/release/hotfix branch creation
- Automatic branch naming conventions
- Finish operations (merge and cleanup)
- Version tagging with semantic versioning
- Customizable branch prefixes

#### GitHub Flow
- Simplified branch-based workflow
- PR-centric development model
- Auto-link commits to issues
- Branch protection rule awareness

#### Trunk-Based Development
- Short-lived feature branches workflow
- Feature flags integration support
- Continuous integration emphasis
- Small, frequent commits

---

### Advanced Git Features

#### Patch Operations
- Create patches with `git format-patch`
- Apply patches with context awareness
- Apply mailbox patches (`git am`)
- Send patches via email integration
- Patch conflict resolution

#### Archive & Export
- Create zip/tar archives of repository state
- Export specific commits or ranges
- Export with custom prefix paths
- Exclude patterns support

#### Git Notes
- Add/edit commit notes
- View notes in commit details
- Remove notes with confirmation
- Push/pull notes refs
- Notes namespace management

#### Sparse Checkout
- Initialize sparse checkout mode
- Add/remove paths interactively
- Cone mode support for better performance
- Preview affected files before applying
- Disable sparse checkout

#### Shallow & Partial Clones
- Shallow clone with configurable `--depth`
- Deepen shallow clones incrementally
- Partial clone with blob/tree filters
- Fetch missing objects on demand
- Convert between shallow and full clones

#### Bundle Operations
- Create Git bundles for offline transfer
- Verify bundle integrity
- List bundle contents
- Unbundle and apply to repository
- Use cases for air-gapped environments

---

### Maintenance & Performance

#### Repository Maintenance
- Garbage collection (`git gc`) with progress
- Prune unreachable objects with age threshold
- Repack objects for optimal storage
- Optimize repository with `git maintenance`
- Schedule automatic maintenance tasks

#### Repository Health & Diagnostics
- File system check (`git fsck`) with detailed output
- Verify pack file integrity
- Check reference integrity and fix issues
- Repair corrupted repositories
- Health score and recommendations

#### Performance Optimization
- Virtual scrolling for large lists (✅ implemented, ongoing refinement)
- Lazy loading for commit history pagination (✅ implemented)
- Background indexing for fast search (✅ implemented)
- Caching strategies for frequent operations
- Memory profiling and optimization
- Incremental rendering for large diffs (✅ implemented via virtual scrolling)

---

### Distribution & Platform Support

#### Code Signing & Notarization

**macOS**
- Apple Developer Account integration
- Developer ID Application certificate
- Notarization for Gatekeeper compliance
- Hardened runtime entitlements configuration
- CI/CD integration for automated signing and notarization

**Windows**
- EV code signing certificate acquisition
- SmartScreen reputation building process
- Timestamp server integration
- CI/CD integration for automated signing

#### Linux Packaging
- Flatpak distribution on Flathub
- Snap package for Ubuntu Software
- AppImage improvements (portable, no installation)
- Debian (.deb) packages for apt repositories
- RPM packages for Fedora/RHEL distributions
- Arch Linux AUR package

#### Auto-Updates
- Delta updates for reduced download size
- Update channels: stable, beta, nightly
- Rollback support for failed updates
- User-controlled update timing
- Background download with install prompt
- Release notes display before update

---

### AI & Machine Learning Features

#### Local AI Backends
- ✅ Auto-detect Ollama running on `localhost:11434`
- ✅ Support LM Studio on `localhost:1234/v1`
- ✅ Configurable model selection in settings
- ✅ Cache available models from `/api/tags`
- ✅ User choice between embedded model and external backends
- ✅ Fallback to embedded model if external unavailable

#### Cloud AI Providers
- ✅ **Anthropic Claude** - API integration for commit messages
- ✅ **GitHub Copilot** - Integration for commit message generation
- ✅ **OpenAI** - GPT-4 and future models for AI-assisted features
- **Google Gemini** - Gemini API support (planned)
- ✅ API key management with secure storage
- ✅ Provider selection and priority in settings
- Usage tracking and cost estimates per provider (planned)
- Rate limiting and quota management (planned)

#### AI-Assisted Workflows
- ✅ Generate commit messages from staged changes (implemented with multiple providers)
- Code review suggestions with explanations (planned)
- Automated commit message improvements (grammar, clarity, conventional format) (planned)
- Smart branch naming based on issue or task (planned)
- Pull request description generation from commits (planned)
- Diff summarization for large changes (planned)
- Conflict resolution suggestions with reasoning (planned)
- Code explanation for complex diffs (planned)
- Security vulnerability detection in changes (planned)

---

### Authentication & Security

#### OAuth Authentication

**GitHub OAuth** (✅ implemented)
- ✅ Browser-based login via OAuth 2.0 with PKCE
- ✅ Automatic token refresh
- ✅ Scope management and permissions

**GitLab OAuth** (✅ implemented)
- ✅ OAuth authentication for GitLab.com
- ✅ Support for self-hosted GitLab instances
- ✅ Custom OAuth application configuration

**Bitbucket OAuth**
- Atlassian account authentication
- Workspace and repository access
- OAuth token management

#### Azure DevOps Authentication
> **Note:** Microsoft deprecated Azure DevOps native OAuth (vssps.visualstudio.com) in April 2025, with full removal in 2026.
> Microsoft Entra ID OAuth only supports work/school accounts for Azure DevOps - personal Microsoft accounts cannot use OAuth.
> Established tools like GitKraken have legacy app registrations that predate the deprecation.

**Current approach:** PAT (Personal Access Token) authentication only

**Future:** Monitor Microsoft's promised "native MSA support" for Entra ID OAuth with Azure DevOps. When available:
- Implement Microsoft Entra ID OAuth for Azure DevOps
- Support both personal Microsoft accounts and work/school accounts
- Unified authentication experience
- See: https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth

#### GitHub Apps
- Install Leviathan as a GitHub App
- Fine-grained permissions per repository
- Organization-level installation support
- No user token expiration concerns
- Webhook integration for real-time updates

#### Git Credential Manager Integration
- Detect and use Git Credential Manager (GCM) tokens
- Share credentials with git CLI seamlessly
- Support GCM's built-in OAuth flows
- Cross-platform credential storage integration

#### Enterprise SSO
- SAML authentication support for enterprise
- OIDC provider integration
- Enterprise managed accounts
- Multi-factor authentication (MFA) support
- Session management and timeout

---

### Testing & Quality Assurance

#### E2E Test Coverage
- Fix shadow DOM selectors using `locator.locator()` chaining
- Add store initialization to mock open repositories in tests
- Complete staging/commit/branch workflow tests
- Integration dialog tests (GitHub, GitLab, Azure DevOps, Bitbucket)
- Visual regression testing with screenshot comparisons
- Accessibility (a11y) testing in E2E suite

#### CI Integration
- Run E2E tests on every pull request
- Upload test artifacts (screenshots, traces, videos) on failure
- Parallel test execution across browsers (Chromium, Firefox, WebKit)
- Test result reporting in PR comments
- Performance benchmarks in CI
- Automated release testing before publish

#### Test Infrastructure
- Tauri WebDriver tests for Windows/Linux native app testing
- Component-level visual testing with Storybook or similar
- Performance benchmarks for large repositories (100k+ commits)
- Accessibility (a11y) automated testing with axe-core
- Memory leak detection in long-running tests

#### Code Quality
- Increase unit test coverage for components (current: ~10%, target: >70%)
- Add integration tests for Tauri IPC commands
- Mutation testing to verify test effectiveness
- Code coverage thresholds and enforcement in CI
- Code coverage reporting and trends
- Dependency vulnerability scanning

---

### Future Explorations

These are ideas for the distant future, to be evaluated based on user feedback and project maturity:

#### Code Review Tools
- Inline commenting on diffs
- Review request workflow
- Approval/rejection tracking
- Review checklist templates

#### Team Collaboration Features
- Shared repository configurations
- Team conventions and standards
- Local-only collaboration features
- No cloud services required

#### Repository Analytics & Statistics
- Commit frequency graphs
- Contributor activity visualization
- Code churn analysis over time
- File change heatmaps
- All data processed and stored locally

#### Performance Profiling
- Git operation timing and profiling
- UI performance metrics and monitoring
- Bottleneck identification
- Memory usage tracking and optimization

#### Plugin/Extension System
- Advanced plugin lifecycle management (versioning, compatibility checks, safe upgrades/rollbacks)
- Discovery features (search, ratings, tags) for a richer community plugin ecosystem
- Curated/verified plugin channels with optional organizational approval workflows
- Enhanced security model (capability-based permissions, review guidelines, and static checks for plugins)
- Developer tooling for plugins (scaffolding, testing harnesses, sample repos, and best-practices guides)

#### Custom Scripts & Hooks UI
- Centralized management of reusable hook/script presets (per-user and per-organization)
- Policy-driven enforcement (e.g., required hooks or scripts for specific repos/branches)
- Safe sandbox and dry-run mode for testing hooks before enabling them on real workflows
- Step-by-step debugging assistance for failing hooks, with captured inputs and outputs
- Analytics for automation usage (e.g., which hooks run, failure rates, and execution timing)

#### Internationalization (i18n)
- Multi-language support
- Community translations
- RTL (right-to-left) language support
- Locale-specific date/time formatting

#### Accessibility Improvements (a11y)
- Enhanced screen reader support
- High-contrast themes and modes
- Keyboard-only navigation (already strong, refine further)
- Focus indicators and skip links
- ARIA labels and semantic HTML
- Accessibility audit and compliance

#### Mobile Companion App
- View repository status on mobile
- Review PRs and commits
- Approve/comment on reviews
- Trigger builds or deployments
- Read-only access for security

---

## Contributing to the Roadmap

Have ideas or feedback on these plans? We welcome community input!

1. **Open an issue** to discuss new feature ideas
2. **Comment on existing issues** to vote or provide use cases
3. **Submit a PR** if you want to help implement a feature
4. **Join discussions** in GitHub Discussions for broader topics

Remember: Leviathan's core value proposition is **privacy-first, offline-capable, high-performance Git GUI**. Features should align with these principles.

---

## Roadmap Updates

This roadmap is a living document and will be updated regularly based on:
- User feedback and feature requests
- Development progress and priorities
- Changes in the Git ecosystem and related tools
- Security and performance considerations

Last updated: 2026-02-10
