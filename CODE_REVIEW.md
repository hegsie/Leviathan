# Leviathan Code Review

Comprehensive code review covering broken/incomplete features, UX issues, event wiring problems, architectural inconsistencies, and test coverage gaps.

---

## 1. BUGS - Broken Event Wiring

These are confirmed broken behaviors where dispatched events have no listener, or event names are mismatched.

### 1.1 ~~`clean-complete` vs `files-cleaned` Event Name Mismatch~~ RESOLVED

Event names now match in the current codebase.

### 1.2 ~~`show-commit` from Reflog Dialog is Unhandled~~ RESOLVED

`app-shell.ts` now has `this.addEventListener('show-commit', this.handleShowCommitEvent)` which handles this via event bubbling.

### 1.3 ~~`show-toast` Events from 3 Components Are Unhandled~~ RESOLVED

These components now use `showToast()` from `notification.service.ts` directly.

### 1.4 ~~`merge-conflict` from Branch List is Unhandled~~ RESOLVED

`app-shell.ts` now has `this.addEventListener('merge-conflict', this.handleMergeConflictEvent)` which handles this via event bubbling.

### 1.5 Gitflow Panel Never Rendered in UI — FIXED

**Severity: BUG**

`lv-gitflow-panel` is a fully implemented component with gitflow init, feature/release/hotfix start/finish. `app-shell.ts` already had listeners for `gitflow-initialized` and `gitflow-operation` events, but the component was never imported or rendered anywhere — it was completely inaccessible from the UI.

**Fix:** Added `lv-gitflow-panel` as a collapsible "Git Flow" section in `lv-left-panel.ts`. Events bubble up through the left panel to `app-shell` where existing handlers trigger `handleRefresh()`.

### 1.6 `open-repo-file` from Workspace Manager Was Unhandled — FIXED

**Severity: BUG**

The workspace manager dispatches `open-repo-file` when clicking a cross-repository search result, but no handler existed. Clicking did nothing.

**Fix:** Added `@open-repo-file` handler on the workspace manager dialog in `app-shell.ts`. The handler closes the workspace manager, opens the target repository if needed, and shows the file in the blame view.

### 1.7 ~~Repository Health Dialog Title Not Displayed~~ NOT A BUG

The Repository Health dialog uses `modalTitle` correctly. The `lv-modal` component properly renders the title passed via the `modalTitle` property.

### 1.8 ~~File History Commit Selection Doesn't Navigate Graph~~ RESOLVED

Already fixed — `handleFileHistoryCommitSelected` calls `graphCanvas.selectCommit()`.

---

## 2. ~~BUGS - Snake_case Tauri Parameters~~ RESOLVED

All Tauri IPC parameters now use camelCase correctly. Tauri's automatic conversion handles the mapping to Rust's snake_case.

---

## 3. Architectural Inconsistencies

### 3.1 ~~`workflowStore` Duplicates `unifiedProfileStore`~~ NOT DEAD CODE

`workflowStore` has 12 active references in `git.service.ts` and serves a distinct role. Not a duplicate.

### 3.2 ~~Recent Repositories Tracked in Two Stores~~ NOT APPLICABLE

`settingsStore` has no `recentRepositories` field. Only `repositoryStore` tracks recent repos.

### 3.3 ~~`IntegrationAccount` Type Defined Three Times~~ FIXED

`unified-profile.types.ts` now re-exports `IntegrationAccount` from `integration-accounts.types.ts` instead of defining its own copy. Factory functions (`createEmpty*Account`), `INTEGRATION_TYPE_NAMES`, and `ACCOUNT_COLORS` are also re-exported. The inferior `getAccountDisplayLabel()` (without try/catch) was removed from `integration-accounts.types.ts`; the robust version remains in `unified-profile.types.ts`.

### 3.4 ~~`uiStore` Modal System Entirely Unused~~ NOT APPLICABLE

No `openModal`/`closeModal` exists in the codebase. The described modal system was never implemented.

### 3.5 ~~Factory Functions Duplicated Across Type Files~~ FIXED

Resolved as part of 3.3 — `unified-profile.types.ts` re-exports from `integration-accounts.types.ts`.

### 3.6 ~~Duplicate Maintenance Functions in git.service.ts~~ RESOLVED

Old duplicate functions have been removed. Only `runGc()` and `runFsck()` remain.

### 3.7 ~~Two Incompatible Toast Notification Patterns~~ RESOLVED

No `show-toast` custom events remain. All components use `showToast()` from `notification.service.ts`.

### 3.8 Tauri IPC Wrapper Bypassed by 5 Services — MOSTLY RESOLVED

**Severity: MEDIUM**

~~These services use raw `invoke()` from `@tauri-apps/api/core` instead of the standardized `invokeCommand()` from `tauri-api.ts`, bypassing consistent error handling:~~

`search-index.service.ts` migrated to `invokeCommand()`. The remaining 4 services intentionally use raw `invoke()`:
- `watcher.service.ts` — fire-and-forget, no return value needed
- `progress.service.ts` — fire-and-forget with intentional `.catch(() => {})`
- `credential.service.ts` — uses Stronghold plugin ecosystem with its own error handling
- `oauth.service.ts` — multi-step OAuth flow with specific error handling at each step

### 3.9 ~~Window Events vs Component Events for Same Concept~~ FIXED

All events now use `repository-refresh`. Child components dispatch DOM-bubbling `repository-refresh` events, and `app-shell` re-broadcasts on `window` for non-parent listeners.

### 3.10 ~~Error Masking in git.service.ts~~ FIXED

`getRepositoryStats()` and `getPackInfo()` now propagate backend failures (`return result`) instead of masking them with `success: true` and zeroed data. The caller (`lv-repository-health-dialog.ts`) already guards with `if (result.success && result.data)`.

### 3.11 Legacy + Multi-Account Credential Dual Systems

**Severity: LOW**

`credential.service.ts` maintains both a legacy system (single-token: `GitHubCredentials.getToken()`) and a multi-account system (`getAccountToken(type, accountId)`). The `git.service.ts` `getRepoToken()` function still uses legacy methods, meaning network operations (fetch/push/pull) always use the legacy single-token credential, not the multi-account system.

---

## 4. UX Usability Issues

### 4.1 ~~Silent Error Failures (~25 instances)~~ RESOLVED

All branch, tag, stash, file-status, and clean-dialog error paths already have `showToast` calls. The only remaining silent failure was `fetchLastCommitMessage` in `lv-commit-panel.ts`, now fixed with an error toast.

### ~~4.2 Native `confirm()`/`prompt()` Instead of Themed Dialogs (~20 instances)~~ FIXED

**Severity: MEDIUM**

~~The app has a custom `showConfirm` dialog service but many places use the browser's native `confirm()` and `prompt()`, creating a jarring UX inconsistency.~~

**Native `confirm()` usage:**
- ~~`src/app-shell.ts:1230` -- Hard reset confirmation~~ — FIXED (migrated to `showConfirm`)
- ~~`src/components/dialogs/lv-credentials-dialog.ts:479,529` -- Remove/erase credentials~~ — FIXED
- ~~`src/components/dialogs/lv-submodule-dialog.ts:458` -- Remove submodule~~ — FIXED
- ~~`src/components/dialogs/lv-ssh-dialog.ts:481` -- Delete SSH key~~ — FIXED
- ~~`src/components/dialogs/lv-reflog-dialog.ts:389` -- Hard reset from reflog~~ — FIXED (all reset modes now confirm via `showConfirm`)
- ~~`src/components/dialogs/lv-worktree-dialog.ts:441` -- Remove worktree~~ — FIXED
- ~~`src/components/dialogs/lv-profile-manager-dialog.ts:658,687,810,921`~~ — FIXED
- ~~`src/components/dialogs/lv-hooks-dialog.ts:757,942,965`~~ — FIXED
- ~~`src/components/dialogs/lv-config-dialog.ts:491` -- Delete alias~~ — FIXED
- ~~`src/components/panels/lv-merge-editor.ts:892`~~ — FIXED

**Native `prompt()` usage:**
- ~~`src/components/sidebar/lv-branch-list.ts` -- Rename branch~~ — FIXED (migrated to `showPrompt`)
- ~~`src/components/sidebar/lv-branch-list.ts` -- Set upstream~~ — FIXED (migrated to `showPrompt`)
- ~~`src/components/sidebar/lv-commit-panel.ts` -- Save template name~~ — FIXED (migrated to `showPrompt`)
- ~~`src/components/sidebar/lv-gitflow-panel.ts` -- Feature/release/hotfix names~~ — FIXED (migrated to `showPrompt`)
- ~~`src/components/toolbar/lv-search-bar.ts` -- Save search preset~~ — FIXED (migrated to `showPrompt`)

All `prompt()` calls replaced with `showPrompt()` backed by a new `lv-prompt-dialog` component.

### ~~4.3 Missing Loading States for Async Operations~~ FIXED

**Severity: MEDIUM**

~~These operations have no visual loading indicator. The user clicks and waits with no feedback.~~

**lv-branch-list.ts:** — FIXED (`operationInProgress` guard + disabled context menu items)
- ~~`handleCheckout()` -- no loading state~~
- ~~`handleRenameBranch()` -- no loading state~~
- ~~`handleDeleteBranch()` -- no loading state~~
- ~~`handleMergeBranch()` -- no loading state~~
- ~~`handleRebaseBranch()` -- no loading state~~
- ~~`handleDeleteMergedBranches()` -- iterates with no progress~~

**lv-tag-list.ts:** — FIXED (`operationInProgress` guard + disabled context menu items)
- ~~`handleCheckoutTag()` -- no loading state~~
- ~~`handleDeleteTag()` -- no loading state~~
- ~~`handlePushTag()` -- no loading state~~

**lv-file-status.ts:** — FIXED (`operationInProgress` guard + disabled buttons on all async handlers)
- ~~`handleStageFile()`, `handleUnstageFile()`, `handleDiscardFile()` -- no per-operation loading state~~

### 4.4 ~~Missing Confirmations for Destructive Operations~~ MOSTLY RESOLVED

- ~~**Revert commit** (`app-shell.ts`): No confirmation before reverting~~ — FIXED: Now shows `showConfirm` warning dialog
- ~~**Soft/mixed reset** (`app-shell.ts`): Only hard reset has confirmation~~ — FIXED: All reset modes now confirm via `showConfirm`; hard reset also migrated from native `confirm()` to `showConfirm()`, and a success toast was added
- ~~**Tag checkout** (`lv-tag-list.ts`): No warning about detached HEAD state~~ — FIXED: Now warns about detached HEAD via `showConfirm`
- **Clean dialog's "Delete Selected"** (`lv-clean-dialog.ts`): Acceptable — has visible warning banner and user clicks an explicit "Delete" button
- **Stash apply/pop** (`lv-stash-list.ts`): Acceptable — reversible operations that don't warrant a confirmation dialog

### 4.5 ~~Missing Disabled States / Double-Click Prevention~~ FIXED

**Severity: MEDIUM**

~~Context menu actions in `lv-branch-list`, `lv-tag-list`, and `lv-stash-list` are always enabled. There's no guard to prevent double-clicking operations (e.g., merging a branch while another merge is in progress).~~

All three components now have `operationInProgress` guards on async handlers, `?disabled` on context menu buttons, and drag-start prevention during operations.

### 4.6 ~~Inconsistent Notification Pattern in git.service.ts~~ RESOLVED

**Severity: MEDIUM**

Network operations (fetch, pull, push) show toasts on success/failure. All other operations now do too:

| Operation | Shows Toast? |
|---|---|
| fetch/pull/push | Yes |
| merge | Yes (added) |
| rebase | Yes (added) |
| interactive rebase | Yes (added) |
| cherry-pick | Yes |
| revert | Yes |
| reset | Yes (added) |
| stash create/apply/pop/drop | Yes (added) |
| tag create/delete/push | Yes (added) |
| squash commits | Yes |

### 4.7 ~~Keyboard Accessibility Gaps~~ FIXED

**Severity: MEDIUM**

~~`lv-stash-list`, `lv-tag-list`: Clickable items with no keyboard handlers (no tabindex, no keydown)~~
~~Context menus: Mouse-only interaction (no keyboard trapping, arrow key navigation, or Escape handling)~~
~~Tab close button in toolbar: `<span class="tab-close">` with `@click` but no keyboard handler, no button role~~

**Fixed:**
- `lv-stash-list`, `lv-tag-list`, `lv-branch-list`: All list items now have `tabindex="0"`, `role="option"`, `aria-label`, and `@keydown` handlers (Enter/Space)
- All context menus now have `role="menu"`, `role="menuitem"` on items, `role="separator"` on dividers, and Escape key handler
- All collapsible group headers now have `tabindex="0"`, `role="button"`, `aria-expanded`, and keyboard support
- List containers have `role="listbox"` with `aria-label`
- Branch items have `aria-selected` for current branch
- Toolbar tabs converted from nested `<button>/<span>` (invalid HTML) to `<div role="tab">/<button>` with proper `aria-selected`, `aria-label`, keyboard support, and `:focus-visible` styling on the close button

---

## 5. Incomplete Features

### 5.1 ~~`uiStore.globalLoading` Never Used~~ NOT APPLICABLE

`uiStore` does not have `globalLoading` — the described feature was never implemented.

### 5.2 ~~Potentially Unused Functions in git.service.ts~~ FIXED

**Severity: LOW**

Removed unused functions that had no production callers:
- `getCommitSignature()` (singular) — superseded by `getCommitsSignatures()` (batch with caching)
- `getRepoStats()` — superseded by `getRepoStatistics()` (enhanced version)
- `getContributorStats()` — superseded by `getRepoStatistics()` (enhanced version)

The associated old stat types (`ContributorStats`, `MonthActivity`, `DayOfWeekActivity`, `HourActivity`, `RepoStats`) were also removed as they were only used by these dead functions. Test file updated to only test `getRepoStatistics()`.

`runGarbageCollection()`, `verifyRepository()`, `getRepoSizeInfo()` had already been removed.

### 5.3 ~~Cache Usage Inconsistency~~ FIXED

**Severity: LOW**

Resolved by removing `getCommitSignature()` (singular). Only `getCommitsSignatures()` (batch with caching) remains.

### 5.4 ~~Progress Service Race Condition~~ FIXED

**Severity: LOW**

`ProgressService` now exposes a `ready: Promise<void>` property that resolves when backend event listeners are initialized. Callers can `await progressService.ready` if they need to ensure listeners are active before proceeding.

---

## 6. Security Considerations

### 6.1 Custom Actions Execute Arbitrary Shell Commands

**Severity: CRITICAL (by design, but worth documenting)**

`src-tauri/src/commands/custom_actions.rs` (lines 164-178): User-defined commands from the database are executed directly via `Command::new("cmd").args(["/C", &full_command])` with no sanitization or allowlist. This is an intentional feature but should be clearly documented as running with full app privileges.

### 6.2 OAuth Client Secrets in Source Code

**Severity: HIGH (acknowledged)**

`src/services/oauth.service.ts` contains embedded client secrets. This is documented as a known limitation with a recommendation to use PKCE-only flows.

### 6.3 Unencrypted In-Memory Credential Cache

**Severity: MEDIUM**

`src-tauri/src/services/credentials_service.rs`: Credentials are cached in plain text in a `Mutex<HashMap>` with no cleanup mechanism and no encryption.

### 6.4 Unbounded OAuth Pending Server Storage

**Severity: MEDIUM**

`src-tauri/src/services/oauth.rs`: The `PENDING_SERVERS` HashMap grows unboundedly if OAuth callbacks don't execute. No TTL or cleanup timer.

---

## 7. Test Coverage Gaps

### 7.1 Component Unit Test Coverage: 21%

Only 13 of 62 components have dedicated unit tests. Major untested components:

**Dialogs (20 untested):** lv-bisect-dialog, lv-cherry-pick-dialog, lv-clean-dialog, lv-clone-dialog, lv-config-dialog, lv-conflict-resolution-dialog, lv-create-branch-dialog, lv-create-tag-dialog, lv-credentials-dialog, lv-gpg-dialog, lv-init-dialog, lv-keyboard-shortcuts-dialog, lv-lfs-dialog, lv-reflog-dialog, lv-repository-health-dialog, lv-settings-dialog, lv-ssh-dialog, lv-submodule-dialog, lv-worktree-dialog, lv-command-palette

**Layout & Views (13 untested):** lv-left-panel, lv-right-panel, lv-commit-panel, lv-output-panel, lv-toolbar, lv-blame-view, lv-file-history, lv-merge-editor, lv-commit-details, lv-welcome, lv-stash-list, lv-modal, lv-avatar

### 7.2 Store Test Coverage: 57%

Untested stores: `settings.store.ts`, `ui.store.ts`, `workflow.store.ts`

### 7.3 Utility Test Coverage: 20%

Only `diff-utils.ts` and `fuzzy-search.ts` have tests. Untested: `format.ts`, `logger.ts`, `md5.ts`, `platform.ts`, `syntax-highlighter.ts`, `shiki-highlighter.ts`, `external-link.ts`

### 7.4 Service Test Gaps

Critical services without dedicated unit tests: `cache.service.ts`, `dialog.service.ts`, `drag-drop.service.ts`, `notification.service.ts`, `progress.service.ts`, `watcher.service.ts`, `workspace.service.ts`

### 7.5 Rust Backend Test Gaps

Only 7 integration tests exist in `src-tauri/tests/`. Missing tests for:
- Security-focused scenarios (command injection in custom actions)
- Concurrency / race condition scenarios
- OAuth flow cleanup and TTL behavior
- Error recovery edge cases

---

## 8. Summary: Prioritized Action Items

### Critical (Functionality Broken) — ALL RESOLVED
1. ~~Fix `clean-complete` / `files-cleaned` event name mismatch~~ — already fixed
2. ~~Fix 4 snake_case Tauri parameter bugs~~ — already uses camelCase
3. ~~Wire up `merge-conflict` event~~ — already handled in app-shell
4. ~~Wire up gitflow events~~ — events were handled but panel was never rendered; now rendered in left panel
5. ~~Fix `show-toast` events~~ — already uses `showToast()` directly
6. ~~Wire up `show-commit` from reflog~~ — already handled in app-shell
7. ~~Fix Repository Health dialog title~~ — was not a bug; uses `modalTitle` correctly
- **NEW:** Wire up `lv-gitflow-panel` in left panel sidebar — FIXED
- **NEW:** Handle `open-repo-file` from workspace manager — FIXED

### High Priority (Data Integrity / UX)
8. ~~Add user-visible error feedback to ~25 silent-failure operations~~ — RESOLVED (all error paths now have `showToast` calls)
9. ~~Add confirmation dialogs for destructive operations (clean, revert, soft/mixed reset)~~ — FIXED (revert, all reset modes, tag checkout detached HEAD warning; clean dialog and stash apply/pop acceptable as-is)
10. ~~Remove or consolidate `workflowStore` with `unifiedProfileStore`~~ — not a duplicate
11. ~~Remove duplicate `recentRepositories` from `settingsStore`~~ — never existed
12. ~~Consolidate triplicate `IntegrationAccount` type definitions~~ — FIXED

### Medium Priority (Quality / Consistency)
13. ~~Replace ~20 native `confirm()`/`prompt()` calls with themed dialogs~~ — FIXED (all `confirm()` replaced with `showConfirm()`; all `prompt()` replaced with `showPrompt()` + `lv-prompt-dialog`)
14. ~~Add loading states to async operations in branch/tag/stash/file-status lists~~ — FIXED (all components have `operationInProgress` guards)
15. ~~Add disabled states to prevent double-clicking operations~~ — FIXED
16. ~~Consolidate duplicate maintenance functions in git.service.ts~~ — already resolved
17. ~~Standardize Tauri IPC usage (use `invokeCommand` everywhere)~~ — MOSTLY RESOLVED (`search-index.service.ts` migrated; 4 others intentionally use raw `invoke()`)
18. ~~Consolidate window events vs component events for refresh~~ — FIXED
19. ~~Remove unused `uiStore` modal system~~ — never existed
20. ~~Add missing notification toasts for merge/rebase/cherry-pick/stash operations~~ — RESOLVED (all operations now show success/error toasts)

### Low Priority (Polish / Maintenance)
21. ~~Improve keyboard accessibility (aria-labels, tab navigation, context menu keyboard support)~~ — FIXED (sidebar lists, context menus, group headers, toolbar tabs all have ARIA + keyboard support)
22. ~~Add cache consistency for `getCommitSignature()` singular~~ — FIXED (removed singular function; only batch with caching remains)
23. ~~Fix error masking in `getRepositoryStats()` and `getPackInfo()`~~ — FIXED
24. Increase component unit test coverage (currently 21%)
25. Increase utility test coverage (currently 20%)
26. ~~Remove unused functions from git.service.ts~~ — FIXED (removed `getCommitSignature`, `getRepoStats`, `getContributorStats` and their associated dead types)
27. ~~Move inline types from git.service.ts to proper type files~~ — FIXED (50+ types moved to `git.types.ts`; stale `Submodule`/`SubmoduleStatus` in `git.types.ts` corrected; re-exports maintain backward compat)
