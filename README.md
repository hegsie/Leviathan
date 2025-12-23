# Leviathan

[![Build & Release](https://github.com/hegsie/Leviathan/actions/workflows/build.yml/badge.svg)](https://github.com/hegsie/Leviathan/actions/workflows/build.yml)
[![CI](https://github.com/hegsie/Leviathan/actions/workflows/ci.yml/badge.svg)](https://github.com/hegsie/Leviathan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/hegsie/Leviathan)](https://github.com/hegsie/Leviathan/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/hegsie/Leviathan/releases)

A modern, cross-platform Git GUI client built with Tauri, Lit, and Rust.

Leviathan aims to be a fast, privacy-first alternative to existing Git clients like GitHub Desktop, GitKraken, and Sourcetree. It runs entirely offline with no telemetry, account requirements, or cloud dependencies.

## Screenshots

<!-- Add screenshots here -->
<p align="center">
  <img src="docs/screenshots/main-window.png" alt="Main Window" width="800">
</p>

<details>
<summary>More Screenshots</summary>

### Commit Graph
<img src="docs/screenshots/commit-graph.png" alt="Commit Graph" width="800">

### Diff Viewer
<img src="docs/screenshots/diff-viewer.png" alt="Diff Viewer" width="800">

### Merge Conflict Resolution
<img src="docs/screenshots/merge-conflict.png" alt="Merge Conflict Resolution" width="800">

</details>

## Features

### Core Git Operations
- **Repository Management** - Open, clone, and initialize repositories with multi-tab support
- **Commit History** - Interactive graph visualization with branch topology
- **Staging** - Stage/unstage files and individual hunks
- **Branching** - Create, delete, rename, and checkout branches
- **Merging** - Fast-forward, squash, and no-ff merge strategies
- **Rebasing** - Standard and interactive rebase with action editor
- **Conflict Resolution** - 3-way merge editor for resolving conflicts

### Additional Features
- **Remote Operations** - Fetch, pull, push with force push support
- **Tags** - Create, delete, and push tags
- **Stashes** - Create, apply, pop, and drop stashes
- **Diff Viewer** - Syntax-highlighted diffs powered by Shiki
- **Blame View** - Line-by-line author attribution
- **File Watching** - Auto-refresh on file system changes

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

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features including:

- Cherry-pick, revert, and reset operations
- Command palette with keyboard shortcuts
- Submodule and Git LFS support
- GitHub/GitLab/Bitbucket integration
- Custom themes and light mode
- Git Flow workflow support

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
