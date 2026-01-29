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

### 4. Rust Clippy
```bash
cd src-tauri && cargo clippy -- -D warnings
```
CI treats all clippy warnings as errors. This check is **mandatory**.

### 5. Unit Tests
```bash
npm test
```

## Quick Pre-commit Check
Run all checks in sequence:
```bash
npm run lint && npm run typecheck && npm test && cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings
```

Also verify no snake_case in Tauri API calls (should return no matches):
```bash
grep -rn "_[a-z]*:" src/types/api.types.ts | grep -v "//"
```

## Testing Requirements

When adding new features, **always** include:

### 1. Unit Tests
- Add unit tests for all new TypeScript/Lit components in `src/**/__tests__/*.test.ts`
- Add unit tests for new Rust functions in the corresponding `tests/` module
- Test edge cases, error handling, and boundary conditions
- Aim for meaningful coverage of the new functionality

### 2. Integration Tests
- For UI features, add E2E tests in `e2e/tests/*.spec.ts`
- Test the feature works correctly in the context of the full application
- Include tests for user interactions and workflows

### 3. Test Patterns
- Follow existing test patterns in the codebase
- Use `@open-wc/testing` for Lit component tests
- Use Playwright for E2E tests
- Mock external dependencies (Tauri invoke, network calls)

### Running Tests
```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e
```

## Fixing Common Issues

### Unused Imports (TypeScript)
Remove unused imports flagged by eslint.

### Rust Formatting
Run `cargo fmt` to auto-fix formatting issues.

## Tauri Naming Conventions

**IMPORTANT:** Tauri automatically converts between Rust's snake_case and TypeScript's camelCase.

When calling Tauri commands from TypeScript:
- Rust: `target_ref: String` → TypeScript: `targetRef: string`
- Rust: `no_ff: Option<bool>` → TypeScript: `noFf?: boolean`
- Rust: `include_untracked: Option<bool>` → TypeScript: `includeUntracked?: boolean`

### Pre-commit Check for Snake Case
Before committing, verify no snake_case is used in Tauri command parameters:
```bash
grep -rn "_[a-z]*:" src/types/api.types.ts src/services/git.service.ts src/app-shell.ts src/components/ --include="*.ts" | grep -v "node_modules" | grep -v "__tests__"
```
If this returns matches in object literals being passed to `invokeCommand` or `gitService.*`, convert them to camelCase.
