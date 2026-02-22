# Claude Code Instructions

## Before Committing

Run all checks in sequence:
```bash
npm run lint && npm run typecheck && npm test && cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings
```

CI treats all clippy warnings as errors.

Verify no snake_case in Tauri API calls (should return no matches):
```bash
grep -rn "_[a-z]*:" src/types/api.types.ts src/services/git.service.ts src/app-shell.ts src/components/ --include="*.ts" | grep -v "node_modules" | grep -v "__tests__"
```
If this returns matches in object literals being passed to `invokeCommand` or `gitService.*`, convert them to camelCase.

## Tauri Naming Conventions

Tauri automatically converts between Rust's snake_case and TypeScript's camelCase.
- Example: Rust `target_ref: String` → TypeScript `targetRef: string`

## Testing Requirements

**CRITICAL: Tests must be written for every code change — not after, but as part of the change.** Do not consider any change done until tests exist for:
- Every code path (happy path, error paths, edge cases)
- Every user-visible outcome (UI updates, error messages, state changes)
- Every cross-component interaction affected by the change

### Unit Tests
- TypeScript/Lit components: `src/**/__tests__/*.test.ts` — use `@open-wc/testing` with `fixture()`, mock only Tauri invoke
- Rust functions: `#[cfg(test)] mod tests` block — use `TestRepo` with real git2 operations, not mocks

### Integration Tests (E2E)
Playwright E2E tests in `e2e/tests/*.spec.ts` run against the Vite dev server. They must cover complete user-visible behavior across the full stack.

**Requirements:**
- Cover all scenarios: happy path, error/failure, edge cases, cross-component effects
- Verify the UI actually reflects the result — not just that a command was called
- Test with real data flows (e.g., remote branch checkout should update the branch list)

### Running Tests
```bash
npm test                    # Unit tests
npm run test:e2e            # E2E tests (playwright.config.ts starts vite dev server)
npx playwright test --config=e2e/playwright.config.ts e2e/tests/branches.spec.ts      # Single file
npx playwright test --config=e2e/playwright.config.ts e2e/tests/branches.spec.ts:42   # Specific test
```

### E2E Test Architecture

E2E tests run against the Vite dev server (`localhost:1420`). All Tauri IPC calls are mocked via `__TAURI_INTERNALS__.invoke` overrides.

**Key files:**
- `e2e/fixtures/tauri-mock.ts` — Tauri IPC mock layer, default mock data, `setupOpenRepository()`, `initializeRepositoryStore()`
- `e2e/fixtures/test-helpers.ts` — `startCommandCaptureWithMocks()`, `findCommand()`, `injectCommandMock()`, `injectCommandError()`, `autoConfirmDialogs()`
- `e2e/pages/*.page.ts` — Page object models

**Store access:** Zustand stores exposed on `window.__LEVIATHAN_STORES__` in dev mode. Repository store uses `openRepositories[]` + `activeIndex` (NOT `currentRepository`).

### E2E Test Conventions

- **No `waitForTimeout()`** — use Playwright auto-retrying assertions (`.toBeVisible()`, `.toHaveText()`, etc.) or `page.waitForFunction()`
- **Playwright auto-pierces shadow DOM** — never use `el.shadowRoot.querySelector()`
- **Use standardized helpers** from `test-helpers.ts`, not inline mock setup
- **Verify UI outcomes**, not just that commands were called
- **Include error scenarios** using `injectCommandError()`
- **Open dialogs via events or command palette** — don't set `@state()` properties directly

```typescript
// GOOD — use helpers
await startCommandCaptureWithMocks(page, {
  get_branches: [{ name: 'main', isCurrent: true }],
  checkout: null,
});

// GOOD — verify UI outcome after action
await btn.click();
await expect(page.locator('.branch-item')).toHaveCount(0);

// GOOD — test error scenarios
await injectCommandError(page, 'checkout', 'Conflict detected');
await expect(page.locator('.toast.error, .error-banner')).toBeVisible();
```

E2E tests run in CI on every push/PR to main and as a gate before release builds.
