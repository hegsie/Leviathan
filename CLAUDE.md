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

**CRITICAL: Tests must be written for every code change — not after, but as part of the change.** A bug fix without a test that would have caught the bug is incomplete. A new feature without tests covering all its code paths is incomplete. Do not consider any change done until tests exist for:
- Every code path through the changed code (happy path, error paths, edge cases)
- Every user-visible outcome (UI updates, error messages, state changes)
- Every cross-component interaction affected by the change

When adding new features or fixing bugs, **always** include:

### 1. Unit Tests
- Add unit tests for all new TypeScript/Lit components in `src/**/__tests__/*.test.ts`
- Add unit tests for new Rust functions in the corresponding `#[cfg(test)] mod tests` block
- **Cover every code path**: happy path, every error branch, edge cases, boundary conditions
- For Rust backend changes: write tests using `TestRepo` that exercise the real git2 operations against a temporary repo — not mocks
- For TypeScript component changes: render real components with `fixture()` and verify real DOM updates

### 2. Integration Tests
Integration tests are **Playwright E2E tests** in `e2e/tests/*.spec.ts` that run against the real application (frontend + Rust backend). They must cover the **complete user-visible behavior**, not just isolated components.

**Requirements:**
- Test the full stack: user action → frontend handler → Tauri command → Rust backend → response → UI update
- Cover **all scenarios**, not just the happy path:
  - Happy path (action succeeds, UI updates correctly)
  - Error/failure scenarios (backend returns error, UI shows appropriate feedback)
  - Edge cases (empty state, boundary conditions, concurrent operations)
  - Cross-component effects (action in component A updates components B and C)
- Verify the UI actually reflects the result — not just that a command was called, but that the user can **see** the correct outcome
- Test with real data flows: e.g., checking out a remote branch should create a local tracking branch AND the branch list should show it as HEAD
- Never substitute mocked responses for real backend behavior in integration tests — that defeats the purpose

**Common integration gaps to avoid:**
- Testing only the happy path — always include failure scenarios
- Testing a single component in isolation — verify the whole screen updates
- Using mocks that return ideal data instead of exercising the real backend
- Assuming events/listeners are wired up — verify the actual UI change the user would see
- Forgetting to test edge cases like remote branch checkout, detached HEAD, merge conflicts

### 3. Test Patterns
- Use `@open-wc/testing` with `fixture()` for **unit tests** of individual Lit components (render real components, mock only Tauri invoke)
- Use **Playwright** for integration/E2E tests against the running app
- Unit tests go in `src/**/__tests__/*.test.ts`
- E2E tests go in `e2e/tests/*.spec.ts`

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
