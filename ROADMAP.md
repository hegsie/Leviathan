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

### Remote Operations
- Fetch, pull, push
- Multiple remotes support
- Force push option

### Other Features
- Tag management (create, delete, push)
- Stash management (create, apply, pop, drop)
- Diff viewer with syntax highlighting (Shiki)
- Blame view with author attribution
- Dark theme UI

---

## Planned Features

### Phase 1: Core Git Operations

#### Cherry-pick
- Pick specific commits to apply to current branch
- Multi-commit cherry-pick
- Cherry-pick with edit option
- Conflict resolution support

#### Revert
- Create revert commits for any commit
- Multi-commit revert
- Revert merge commits with parent selection

#### Reset
- Soft, mixed, and hard reset modes
- Reset to any commit
- Reset individual files
- Visual confirmation for destructive operations

#### Commit Amend
- Amend last commit message
- Add/remove files from last commit
- Dedicated UI for amend operations

---

### Phase 2: Productivity Features

#### Command Palette
- Fuzzy finder for all actions (Cmd/Ctrl+P)
- Quick branch switching
- Quick file navigation
- Recent actions history

#### File History
- View all commits that modified a file
- Follow renames
- Compare file across commits

#### Commit Search
- Search by commit message
- Search by author
- Search by SHA
- Search by file path
- Advanced filters (date range, etc.)

#### Undo/Redo
- Undo last git operation
- Visual reflog browser
- One-click recovery of lost commits

#### Keyboard Shortcuts
- Comprehensive keyboard navigation
- Customizable keybindings
- Vim-style navigation option

#### Drag & Drop
- Drag branches to merge/rebase
- Drag commits to cherry-pick
- Drag files to stage/unstage

---

### Phase 3: Advanced Features

#### Submodule Support
- Initialize submodules
- Update submodules
- Clone with submodules
- Submodule status in file tree

#### Git LFS
- LFS file tracking
- LFS pull/push
- LFS file status indicators

#### Worktrees
- Create/remove worktrees
- Switch between worktrees
- Worktree status overview

#### GPG Signing
- Configure GPG keys
- Sign commits
- Verify commit signatures
- Visual indicators for signed commits

#### SSH Key Management
- Generate SSH keys
- View/copy public keys
- Test SSH connections

---

### Phase 4: Platform Integrations

#### GitHub Integration
- View pull requests
- Create pull requests
- Review PR diffs
- View/create issues
- Link commits to issues

#### GitLab Integration
- Merge request support
- Issue tracking
- CI/CD pipeline status

#### Bitbucket Integration
- Pull request support
- Issue tracking

---

### Phase 5: UI/UX Enhancements

#### Themes
- Light theme
- Custom theme support
- Syntax highlighting theme options

#### Inline Editing
- Edit files directly in diff view
- Quick fixes for conflicts

#### Image Diff
- Side-by-side image comparison
- Onion skin overlay
- Swipe comparison

#### Commit Templates
- Save commit message templates
- Auto-populate from .gitmessage
- Template variables

#### Notifications
- Push/pull completion notifications
- Conflict alerts
- Background operation status

#### Auto-fetch
- Configurable periodic fetch
- Fetch on window focus
- Remote change indicators

---

### Phase 6: Workflow Support

#### Git Flow
- Initialize Git Flow
- Feature/release/hotfix branches
- Automatic branch naming
- Finish operations

#### GitHub Flow
- Simplified branch workflow
- PR-centric development

#### Profiles
- Multiple Git identities
- Per-repository identity
- Quick profile switching

---

### Future Considerations

- AI-assisted commit messages
- Code review tools
- Team collaboration features
- Repository analytics
- Performance profiling
- Plugin/extension system
