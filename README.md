# Leviathan

[![Build & Release](https://github.com/hegsie/Leviathan/actions/workflows/build.yml/badge.svg)](https://github.com/hegsie/Leviathan/actions/workflows/build.yml)
[![CI](https://github.com/hegsie/Leviathan/actions/workflows/ci.yml/badge.svg)](https://github.com/hegsie/Leviathan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/hegsie/Leviathan)](https://github.com/hegsie/Leviathan/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/hegsie/Leviathan/releases)

A modern, cross-platform Git GUI client built with Tauri, Lit, and Rust.

Leviathan aims to be a fast, privacy-first alternative to existing Git clients like GitHub Desktop, GitKraken, and Sourcetree. It runs entirely offline with no telemetry, account requirements, or cloud dependencies.

## Screenshots

<p align="center">
  <img src="docs/screenshots/main-window.png" alt="Main Window" width="800">
</p>

<details>
<summary>More Screenshots</summary>

### Commit Graph
<img src="docs/screenshots/commit-graph.png" alt="Commit Graph" width="800">

### Diff Viewer
<img src="docs/screenshots/diff-viewer.png" alt="Diff Viewer" width="800">

</details>

## Features

### Repository Management
- Open, clone, and initialize repositories
- Multi-repository support with tabs
- File system watching for auto-refresh

### Commit Operations
- Commit history with interactive graph visualization
- Create commits with staging support
- Hunk-level staging/unstaging
- Commit details view with file list
- Commit amend - modify last commit message and staged files

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

### Tags & Stashes
- Tag management (create, delete, push)
- Stash management (create, apply, pop, drop)

### Diff & Blame
- Diff viewer with syntax highlighting (Shiki)
- Blame view with author attribution
- Dark and light themes
- Syntax highlighting theme options

### Advanced Git Operations
- **Remote Management** - add, remove, rename remotes, edit URLs
- **Clean Operations** - remove untracked/ignored files with preview
- **Bisect** - binary search for bug-introducing commits
- **Submodules** - add, init, update, sync, remove submodules
- **Worktrees** - create, remove, lock/unlock, move multiple working directories
- **Git LFS** - track patterns, pull/fetch/prune large files

### Security & Configuration
- **GPG Signing** - configure keys, sign commits/tags, verify signatures, trust levels
- **SSH Key Management** - generate keys (Ed25519, RSA, ECDSA), view/copy public keys, test connections
- **Git Configuration** - view/edit global and repository config, manage aliases, user identity
- **Credential Management** - credential helper configuration, test credentials, per-remote settings

### GitHub Integration
- **Pull Requests** - view PRs, create PRs, PR status visualization in commit graph
- **Issues** - view issues, create issues, filter by state/labels
- **Commit Linking** - automatic issue reference detection (fixes #123, closes #456)
- **Releases** - view releases, create releases with auto-generated notes
- **Actions** - workflow run status, check runs for commits

### GitLab Integration
- **Merge Requests** - view MRs, create MRs, status filtering
- **Issues** - view issues, create issues, label filtering
- **Pipelines** - view CI/CD pipeline status

### Azure DevOps Integration
- **Pull Requests** - view PRs, create PRs, PR status filtering
- **Work Items** - browse and query work items by project
- **Pipelines** - view pipeline/build run status

### Bitbucket Integration
- **Pull Requests** - view PRs, create PRs, status filtering
- **Issues** - view issues with priority and status
- **Pipelines** - view pipeline run status

### AI-Powered Features
- **Commit Message Generation** - generate conventional commit messages from staged diffs
- **Embedded LLM** - uses [Tavernari/git-commit-message](https://huggingface.co/Tavernari/git-commit-message) model (~2GB quantized)
- **Offline-First** - model downloads once on first use, runs entirely locally
- **GPU Acceleration** - Metal on macOS, CUDA on Windows/Linux (configurable via `LEVIATHAN_GPU_LAYERS`)
- **Progress Feedback** - download progress and generation status in UI

### Unified Profiles
- **Multiple Identities** - configure work/personal Git identities
- **Integration Accounts** - link GitHub, GitLab, Azure DevOps accounts to profiles
- **Auto-Detection** - automatically switch profiles based on repository URL patterns
- **Profile Switching** - switch identity and linked accounts together

## Installation

### Download

Pre-built binaries are available from the [Releases](https://github.com/hegsie/Leviathan/releases) page:

| Platform | Download |
|----------|----------|
| macOS (Universal) | `.dmg` |
| macOS (ARM64) | `.dmg` |
| Windows | `.msi` or `.exe` |
| Linux | `.deb` or `.AppImage` |

### Build from Source

#### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.70+
- Platform-specific dependencies (see below)

#### macOS

```bash
xcode-select --install
```

#### Linux (Debian/Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libgtk-3-dev \
  libglib2.0-dev \
  libdbus-1-dev
```

#### Windows

Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.

#### Build Steps

```bash
# Clone the repository
git clone https://github.com/hegsie/Leviathan.git
cd Leviathan

# Install dependencies
npm install

# Build and run in development mode
npm run tauri:dev

# Build for production
npm run tauri:build
```

Production builds are output to `src-tauri/target/release/bundle/`.

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run tauri:dev` | Run app in development mode |
| `npm run tauri:build` | Build production application |
| `npm run build` | Build frontend only |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type check without emitting |
| `npm run lint` | Lint TypeScript files |
| `npm run lint:fix` | Lint and fix issues |
| `npm run format` | Format code with Prettier |

### Project Structure

```
leviathan/
├── src/                    # Frontend (TypeScript/Lit)
│   ├── components/         # UI components
│   │   ├── common/         # Shared components
│   │   ├── dialogs/        # Modal dialogs
│   │   ├── graph/          # Commit graph visualization
│   │   ├── panels/         # Content panels (diff, blame)
│   │   ├── sidebar/        # Navigation sidebars
│   │   └── toolbar/        # Top toolbar
│   ├── services/           # API and service layer
│   ├── stores/             # Zustand state management
│   ├── types/              # TypeScript type definitions
│   └── styles/             # CSS and design tokens
│
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── commands/       # Tauri command handlers
│   │   ├── services/       # Business logic
│   │   └── models/         # Data structures
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
│
├── plan/                   # Technical documentation
└── .github/workflows/      # CI/CD pipelines
```

## Tech Stack

### Frontend
- [Lit](https://lit.dev/) - Web components framework
- [Vite](https://vitejs.dev/) - Build tool
- [Zustand](https://zustand-demo.pmnd.rs/) - State management
- [Shiki](https://shiki.style/) - Syntax highlighting
- [TypeScript](https://www.typescriptlang.org/) - Type safety

### Backend
- [Tauri 2.0](https://v2.tauri.app/) - Desktop application framework
- [Rust](https://www.rust-lang.org/) - Systems programming language
- [git2-rs](https://github.com/rust-lang/git2-rs) - libgit2 bindings
- [Tokio](https://tokio.rs/) - Async runtime
- [SQLite](https://www.sqlite.org/) - Local database
- [llama-cpp-2](https://github.com/utilityai/llama-cpp-rs) - LLM inference with GPU acceleration

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features including:

- Inline file editing in diff view
- Image diff comparison
- Commit message templates
- Git Flow workflow support
- External AI backends (Ollama, LM Studio)
- Code review suggestions

## Troubleshooting

### AI Commit Message Generation

The AI feature uses an embedded LLM that runs locally on your machine. On first use, it downloads a ~2GB model file.

**macOS GPU Issues**: If the app crashes when generating commit messages, you may need to adjust GPU settings:

```bash
# Run with CPU-only inference (slower but stable)
LEVIATHAN_GPU_LAYERS=0 /Applications/Leviathan.app/Contents/MacOS/Leviathan

# Or reduce GPU layers (try 16, 8, etc.)
LEVIATHAN_GPU_LAYERS=16 /Applications/Leviathan.app/Contents/MacOS/Leviathan
```

This is a known issue with Metal GPU buffer allocation on some macOS configurations. See [llama.cpp#16266](https://github.com/ggml-org/llama.cpp/issues/16266) for details.

**Model Storage**: The AI model is stored in:
- macOS: `~/Library/Application Support/io.github.hegsie.leviathan/models/`
- Windows: `%APPDATA%\io.github.hegsie.leviathan\models\`
- Linux: `~/.config/io.github.hegsie.leviathan/models/`

You can delete the model folder to re-download or free up space.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [libgit2](https://libgit2.org/) - The git library powering core operations
- [Tauri](https://tauri.app/) - For making cross-platform desktop apps accessible
- The open source community for inspiration and tooling
