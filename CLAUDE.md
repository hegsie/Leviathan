# Claude Code Instructions

## Before Committing

Always run the following checks before creating any commit:

### 1. TypeScript Lint
```bash
npm run lint
```
Fix any errors or warnings before committing.

### 2. TypeScript Type Check
```bash
npm run typecheck
```

### 3. Rust Formatting
```bash
cd src-tauri && cargo fmt
```

### 4. Rust Clippy (optional but recommended)
```bash
cd src-tauri && cargo clippy
```

## Quick Pre-commit Check
Run all checks in sequence:
```bash
npm run lint && npm run typecheck && cd src-tauri && cargo fmt --check && cargo clippy
```

## Fixing Common Issues

### Unused Imports (TypeScript)
Remove unused imports flagged by eslint.

### Rust Formatting
Run `cargo fmt` to auto-fix formatting issues.
