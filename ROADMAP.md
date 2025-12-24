# Leviathan Roadmap

## Current Features (v0.1.0)

### Repository Management
- Open, clone, and initialize repositories
- Multi-repository support with tabs
- File system watching for auto-refresh

### Commit Operations
- Commit history with interactive graph visualization
- Create commits with staging support
- Hunk-level staging/unstaging
- Commit details view with file list
- **Commit amend** - modify last commit message and staged files

### Branch Operations
- Create, delete, rename branches
- Checkout branches and commits
- Branch tracking (upstream detection)
- Ahead/behind commit counting

### Merge & Rebase
- Merge with fast-forward, squash, and no-ff options
- Rebase onto branches
- Interactive rebase with action editor
- 3-way merge conflict resolution editor
- Abort/continue operations

### Cherry-pick & Revert
- Cherry-pick specific commits to apply to current branch
- Conflict resolution support for cherry-pick
- Abort/continue cherry-pick operations
- Revert commits with auto-generated revert message
- Abort/continue revert operations

### Reset Operations
- Soft, mixed, and hard reset modes
- Reset to any commit with visual confirmation
- Context menu integration for quick access

### Remote Operations
- Fetch, pull, push
- Multiple remotes support
- Force push option

### Productivity Features
- **Command Palette** (Cmd/Ctrl+P) - fuzzy finder for all actions
- **File History** - view all commits that modified a file with rename following
- **Commit Search** - search by message, author, SHA, file path, or date range
- **Undo/Redo** - visual reflog browser for recovering previous states
- **Keyboard Shortcuts** - comprehensive keyboard navigation with vim-style support
- **Drag & Drop** - drag branches to merge/rebase, drag files to stage/unstage

### Other Features
- Tag management (create, delete, push)
- Stash management (create, apply, pop, drop)
- Diff viewer with syntax highlighting (Shiki)
- Blame view with author attribution
- Dark and light themes
- Syntax highlighting theme options

### Advanced Git Operations
- **Remote Management** - add, remove, rename remotes, edit URLs
- **Clean Operations** - remove untracked/ignored files with preview
- **Bisect** - binary search for bug-introducing commits
- **Submodules** - add, init, update, sync, remove submodules
- **Worktrees** - create, remove, lock/unlock multiple working directories
- **Git LFS** - track patterns, pull/fetch/prune large files

### Security & Configuration
- **GPG Signing** - configure keys, sign commits/tags, verify signatures, trust levels
- **SSH Key Management** - generate keys (Ed25519, RSA, ECDSA), view/copy public keys, test connections
- **Git Configuration** - view/edit global and repository config, manage aliases, user identity
- **Credential Management** - credential helper configuration, test credentials, per-remote settings

---

## Planned Features

### Phase 5: Platform Integrations (In Progress)

#### GitHub Integration
- View pull requests
- Create pull requests
- Review PR diffs
- View/create issues
- Link commits to issues
- GitHub Actions status
- Release management

#### GitLab Integration
- Merge request support
- Issue tracking
- CI/CD pipeline status
- GitLab CI configuration

#### Bitbucket Integration
- Pull request support
- Issue tracking
- Pipelines status

#### Azure DevOps Integration
- Pull request support
- Work item linking
- Pipeline status

---

### Phase 6: UI/UX Enhancements

#### Inline Editing
- Edit files directly in diff view
- Quick fixes for conflicts
- Syntax-aware editing

#### Image Diff
- Side-by-side image comparison
- Onion skin overlay
- Swipe comparison
- Difference highlighting

#### Commit Templates
- Save commit message templates
- Auto-populate from .gitmessage
- Template variables
- Conventional commits support

#### Notifications
- Push/pull completion notifications
- Conflict alerts
- Background operation status
- System tray integration

#### Auto-fetch
- Configurable periodic fetch
- Fetch on window focus
- Remote change indicators
- Background sync

---

### Phase 7: Workflow Support

#### Git Flow
- Initialize Git Flow
- Feature/release/hotfix branches
- Automatic branch naming
- Finish operations
- Version tagging

#### GitHub Flow
- Simplified branch workflow
- PR-centric development
- Auto-link to issues

#### Trunk-Based Development
- Short-lived feature branches
- Feature flags integration

#### Profiles
- Multiple Git identities
- Per-repository identity
- Quick profile switching
- Work/personal separation

---

### Phase 8: Advanced Features

#### Patch Operations
- Create patches (format-patch)
- Apply patches
- Apply mailbox patches (am)
- Send patches via email

#### Archive & Export
- Create zip/tar archives
- Export specific commits
- Export with prefix

#### Notes
- Add commit notes
- View notes
- Remove notes
- Push/pull notes

#### Sparse Checkout
- Initialize sparse checkout
- Add/remove paths
- Cone mode support

#### Shallow & Partial Clones
- Shallow clone (--depth)
- Deepen shallow clones
- Partial clone (--filter)
- Fetch missing objects

#### Bundle Operations
- Create bundles
- Verify bundles
- Unbundle

---

### Phase 9: Maintenance & Performance

#### Repository Maintenance
- Garbage collection (gc)
- Prune unreachable objects
- Repack objects
- Optimize repository

#### Repository Health
- fsck (file system check)
- Verify pack files
- Check ref integrity
- Repair operations

#### Performance Optimization
- Virtual scrolling improvements
- Lazy loading for large repos
- Background indexing
- Caching strategies

---

### Future Considerations

- AI-assisted commit messages
- Code review tools
- Team collaboration features
- Repository analytics & statistics
- Performance profiling
- Plugin/extension system
- Custom scripts/hooks UI
- Multi-language support (i18n)
- Accessibility improvements (a11y)
- Mobile companion app
