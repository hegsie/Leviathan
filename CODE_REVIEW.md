# Leviathan Code Review

Comprehensive code review covering broken/incomplete features, UX issues, event wiring problems, architectural inconsistencies, and test coverage gaps.

---

## 1. BUGS - Broken Event Wiring

These are confirmed broken behaviors where dispatched events have no listener, or event names are mismatched.

### 1.1 `clean-complete` vs `files-cleaned` Event Name Mismatch

**Severity: BUG**

The clean dialog dispatches `clean-complete` but the app-shell listens for `files-cleaned`. The post-clean repository refresh never fires.

- `src/components/dialogs/lv-clean-dialog.ts:425` dispatches `clean-complete`
- `src/app-shell.ts:2611` listens for `@files-cleaned`

**Fix:** Change one to match the other.

### 1.2 `show-commit` from Reflog Dialog is Unhandled

**Severity: BUG**

The reflog dialog's "Show in graph" context menu action dispatches `show-commit`, but no parent component listens for it. Clicking "Show in graph" does nothing.

- `src/components/dialogs/lv-reflog-dialog.ts:461` dispatches `show-commit`
- No listener in `src/app-shell.ts`

**Fix:** Add a `@show-commit` handler on the reflog dialog in app-shell that calls `this.graphCanvas?.selectCommit(e.detail.oid)`.

### 1.3 `show-toast` Events from 3 Components Are Unhandled

**Severity: BUG**

Three components dispatch `show-toast` custom events that nobody listens for. Toasts from these components silently fail to display.

- `src/components/panels/lv-diff-view.ts` (lines 1065, 1070, 1076)
- `src/components/panels/lv-merge-editor.ts` (lines 547, 553, 559, 821, 827)
- `src/components/dialogs/lv-conflict-resolution-dialog.ts` (lines 423, 428, 434)

**Fix:** Replace `this.dispatchEvent(new CustomEvent('show-toast', ...))` with direct calls to `showToast()` from `notification.service.ts`, which is the pattern used everywhere else.

### 1.4 `merge-conflict` from Branch List is Unhandled

**Severity: BUG**

When a merge results in conflicts from the branch list sidebar, `merge-conflict` is dispatched but no parent listens for it. The conflict resolution dialog won't open automatically after a merge conflict.

- `src/components/sidebar/lv-branch-list.ts:1440,1504` dispatches `merge-conflict`
- No listener in the parent hierarchy

Note: `open-conflict-dialog` (for rebase conflicts) IS handled. Only the merge case is broken.

**Fix:** Add a `merge-conflict` handler that opens the conflict resolution dialog, or consolidate with `open-conflict-dialog`.

### 1.5 Gitflow Events Are Unhandled - No Refresh After Operations

**Severity: BUG**

All gitflow operations dispatch `gitflow-initialized` or `gitflow-operation` events, but nothing in the component hierarchy listens for them. After starting/finishing a feature, release, or hotfix, the graph and repository state are not refreshed.

- `src/components/sidebar/lv-gitflow-panel.ts` (lines 318, 343, 371, 397, 428, 454, 485)
- No listener in any parent component

**Fix:** Handle these events in the left panel or app-shell to trigger a repository refresh.

### 1.6 `open-repo-file` from Workspace Manager is Unhandled

**Severity: BUG**

The workspace manager dispatches `open-repo-file` when clicking a cross-repository search result, but nobody listens for it. The file cannot be opened.

- `src/components/dialogs/lv-workspace-manager-dialog.ts:1191` dispatches `open-repo-file`
- No listener anywhere

### 1.7 Repository Health Dialog Title Not Displayed

**Severity: BUG**

The `lv-modal` component uses the `modalTitle` property (defined at `src/components/dialogs/lv-modal.ts:114`), but the app-shell passes `title` instead of `modalTitle` for the Repository Health dialog.

- `src/app-shell.ts:2617` uses `title="Repository Health"`
- Should be `modalTitle="Repository Health"`

### 1.8 File History Commit Selection Doesn't Navigate Graph

**Severity: BUG**

When selecting a commit in the file history panel, `selectedCommit` is set directly but the graph is NOT scrolled/highlighted. Compare with the blame view which correctly calls `this.graphCanvas?.selectCommit(oid)`.

- `src/app-shell.ts` `handleFileHistoryCommitSelected` sets `this.selectedCommit` but doesn't call `graphCanvas.selectCommit()`
- `handleBlameCommitClick` correctly navigates the graph

---

## 2. BUGS - Snake_case Tauri Parameters

Per the CLAUDE.md instructions, Tauri automatically converts between Rust's `snake_case` and TypeScript's `camelCase`. These methods pass snake_case keys which won't match Rust parameter names.

### 2.1 `searchCommits()` - 3 snake_case parameters

**File:** `src/services/git.service.ts:335-337`

```typescript
date_from: options.dateFrom,   // Should be: dateFrom
date_to: options.dateTo,       // Should be: dateTo
file_path: options.filePath,   // Should be: filePath
```

### 2.2 `resolveConflict()` - 1 snake_case parameter

**File:** `src/services/git.service.ts:989`

```typescript
file_path: filePath,   // Should be: filePath
```

### 2.3 `detectConflictMarkers()` - 1 snake_case parameter

**File:** `src/services/git.service.ts:1007`

```typescript
file_path: filePath,   // Should be: filePath
```

### 2.4 `getConflictDetails()` - 1 snake_case parameter

**File:** `src/services/git.service.ts:1024`

```typescript
file_path: filePath,   // Should be: filePath
```

---

## 3. Architectural Inconsistencies

### 3.1 `workflowStore` Duplicates `unifiedProfileStore`

**Severity: HIGH**

`src/stores/workflow.store.ts` is a near-exact duplicate of the profile management portion of `src/stores/unified-profile.store.ts`. Both manage:
- `profiles` array, `activeProfile`, `currentRepositoryPath`, `isLoading`, error state
- Identical CRUD actions (`addProfile`, `updateProfile`, `removeProfile`)
- Identical helpers (`getProfileById` vs `getUnifiedProfileById`)

The `workflowStore` appears to be a legacy version that was superseded by `unifiedProfileStore` but never removed.

### 3.2 Recent Repositories Tracked in Two Stores

**Severity: HIGH**

- `src/stores/repository.store.ts`: `recentRepositories: RecentRepository[]` with `addRecentRepository(path, name)`
- `src/stores/settings.store.ts`: `recentRepositories: string[]` with `addRecentRepository(path)`

These maintain completely independent lists persisted under different localStorage keys. Only `repositoryStore` is actively used; the `settingsStore` version is vestigial.

### 3.3 `IntegrationAccount` Type Defined Three Times

**Severity: HIGH**

The `IntegrationAccount` interface is independently defined in:
1. `src/types/integration-accounts.types.ts` (lines 39-56)
2. `src/types/unified-profile.types.ts` (lines 43-60)
3. `src/types/unified-profile.types.ts` (lines 66-81 as `ProfileIntegrationAccount`)

These are not re-exports -- they're independent definitions that could diverge.

### 3.4 `uiStore` Modal System Entirely Unused

**Severity: HIGH**

`src/stores/ui.store.ts` defines a centralized modal system with `activeModal: ModalId`, `openModal()`, `closeModal()`. The `ModalId` type only covers 6 modals.

No component calls `openModal()` or `closeModal()`. Instead, the app-shell manages 23+ individual boolean `@state()` properties for each dialog. The store's modal system is dead code.

### 3.5 Factory Functions Duplicated Across Type Files

**Severity: MEDIUM**

`createEmpty*Account()` functions, `getAccountDisplayLabel()`, `generateAccountId()`/`generateId()`, and `INTEGRATION_TYPE_NAMES` exist in both:
- `src/types/integration-accounts.types.ts`
- `src/types/unified-profile.types.ts`

Components import from different files inconsistently.

### 3.6 Duplicate Maintenance Functions in git.service.ts

**Severity: MEDIUM**

| Old Function | New Function | Difference |
|---|---|---|
| `runGarbageCollection()` (line 6350) | `runGc()` (line 6705) | New one has toast notifications |
| `verifyRepository()` (line 6390) | `runFsck()` (line 6723) | New one has toast notifications |

The old versions call different Tauri commands but accomplish the same thing.

### 3.7 Two Incompatible Toast Notification Patterns

**Severity: MEDIUM**

- **Pattern A** (correct): `showToast('message', 'success')` from `notification.service.ts`
- **Pattern B** (broken): `this.dispatchEvent(new CustomEvent('show-toast', ...))` from components

Pattern B is used in 3 components (see Bug 1.3) and no parent ever handles it.

### 3.8 Tauri IPC Wrapper Bypassed by 5 Services

**Severity: MEDIUM**

These services use raw `invoke()` from `@tauri-apps/api/core` instead of the standardized `invokeCommand()` from `tauri-api.ts`, bypassing consistent error handling:
- `watcher.service.ts`
- `progress.service.ts`
- `credential.service.ts`
- `search-index.service.ts`
- `oauth.service.ts`

### 3.9 Window Events vs Component Events for Same Concept

**Severity: MEDIUM**

"Repository changed, please refresh" is dispatched as both:
- `window.dispatchEvent(new CustomEvent('repository-refresh'))` (in app-shell, commit-panel, file-status)
- `this.dispatchEvent(new CustomEvent('repository-changed', { bubbles: true, composed: true }))` (in left-panel, right-panel)

Different event names for the same semantic concept.

### 3.10 Error Masking in git.service.ts

**Severity: MEDIUM**

`getRepositoryStats()` (line 6307-6316) and `getPackInfo()` (line 6329-6338) return `success: true` with zeroed data when the actual backend command fails. Callers cannot distinguish between "the repo has 0 objects" and "the command failed."

### 3.11 Legacy + Multi-Account Credential Dual Systems

**Severity: LOW**

`credential.service.ts` maintains both a legacy system (single-token: `GitHubCredentials.getToken()`) and a multi-account system (`getAccountToken(type, accountId)`). The `git.service.ts` `getRepoToken()` function still uses legacy methods, meaning network operations (fetch/push/pull) always use the legacy single-token credential, not the multi-account system.

---

## 4. UX Usability Issues

### 4.1 Silent Error Failures (~25 instances)

**Severity: HIGH**

Numerous operations log errors to `console.error` but show no user-visible feedback. The user performs an action and nothing visibly happens.

**lv-branch-list.ts:**
- Checkout failure (line 952)
- Rename failure (line 996)
- Delete failure (line 1032)
- Merge failure (line 1073)
- Rebase failure (line 1115)
- Remote checkout failure (line 1481)

**lv-tag-list.ts:**
- Load tags failure (line 371)
- Checkout tag failure (line 478)
- Delete tag failure (line 508)
- Push tag failure (line 557)

**lv-stash-list.ts:**
- Load stashes failure (line 190)
- Create stash failure (line 215)
- Apply stash failure (line 255)
- Pop stash failure (line 277)
- Drop stash failure (line 308)

**lv-commit-panel.ts:**
- Fetch last commit message failure (line 778)

**lv-file-status.ts:**
- Open in editor failure (line 1310)
- Reveal in finder failure (line 1323)
- Copy path failure (line 1334)

**lv-clean-dialog.ts:**
- Load files failure (line 359)
- Clean failure (line 433)

### 4.2 Native `confirm()`/`prompt()` Instead of Themed Dialogs (~20 instances)

**Severity: MEDIUM**

The app has a custom `showConfirm` dialog service but many places use the browser's native `confirm()` and `prompt()`, creating a jarring UX inconsistency.

**Native `confirm()` usage:**
- `src/app-shell.ts:1230` -- Hard reset confirmation
- `src/components/dialogs/lv-credentials-dialog.ts:479,529` -- Remove/erase credentials
- `src/components/dialogs/lv-submodule-dialog.ts:458` -- Remove submodule
- `src/components/dialogs/lv-ssh-dialog.ts:481` -- Delete SSH key
- `src/components/dialogs/lv-reflog-dialog.ts:389` -- Hard reset from reflog
- `src/components/dialogs/lv-worktree-dialog.ts:441` -- Remove worktree
- `src/components/dialogs/lv-profile-manager-dialog.ts:658,687,810,921`
- `src/components/dialogs/lv-hooks-dialog.ts:757,942,965`
- `src/components/dialogs/lv-config-dialog.ts:491` -- Delete alias
- `src/components/panels/lv-merge-editor.ts:892`

**Native `prompt()` usage:**
- `src/components/sidebar/lv-branch-list.ts:979` -- Rename branch
- `src/components/sidebar/lv-branch-list.ts:1190` -- Set upstream
- `src/components/sidebar/lv-commit-panel.ts:675` -- Save template name
- `src/components/sidebar/lv-gitflow-panel.ts:334,388,414,445,471` -- Feature/release/hotfix names
- `src/components/toolbar/lv-search-bar.ts:331` -- Save search preset

### 4.3 Missing Loading States for Async Operations (~15 instances)

**Severity: MEDIUM**

These operations have no visual loading indicator. The user clicks and waits with no feedback.

**lv-branch-list.ts:**
- `handleCheckout()` (line 925) -- no loading state
- `handleRenameBranch()` (line 968) -- no loading state
- `handleDeleteBranch()` (line 1000) -- no loading state
- `handleMergeBranch()` (line 1036) -- no loading state
- `handleRebaseBranch()` (line 1078) -- no loading state
- `handleDeleteMergedBranches()` (line 860) -- iterates with no progress

**lv-tag-list.ts:**
- `handleCheckoutTag()` (line 455) -- no loading state
- `handleDeleteTag()` (line 482) -- no loading state
- `handlePushTag()` (line 539) -- no loading state

**lv-file-status.ts:**
- `handleStageFile()`, `handleUnstageFile()`, `handleDiscardFile()` -- no per-operation loading state

### 4.4 Missing Confirmations for Destructive Operations

**Severity: HIGH**

- **Clean dialog's "Delete Selected"** (`lv-clean-dialog.ts:415`): Permanently deletes files without a final "Are you sure?" confirmation
- **Revert commit** (`app-shell.ts:1128`): No confirmation before reverting
- **Soft/mixed reset** (`app-shell.ts:1222-1234`): Only hard reset has confirmation; soft/mixed resets move HEAD without warning
- **Tag checkout** (`lv-tag-list.ts:455`): No warning about entering detached HEAD state
- **Stash apply/pop** (`lv-stash-list.ts`): No confirmation before potentially overwriting working directory changes

### 4.5 Missing Disabled States / Double-Click Prevention

**Severity: MEDIUM**

Context menu actions in `lv-branch-list`, `lv-tag-list`, and `lv-stash-list` are always enabled. There's no guard to prevent double-clicking operations (e.g., merging a branch while another merge is in progress).

### 4.6 Inconsistent Notification Pattern in git.service.ts

**Severity: MEDIUM**

Network operations (fetch, pull, push) show toasts on success/failure. Equally important operations do not:

| Operation | Shows Toast? |
|---|---|
| fetch/pull/push | Yes |
| merge | No |
| rebase | No |
| cherry-pick | No |
| revert | No |
| reset | No |
| stash create/apply/pop | No |
| tag create/delete/push | No |
| squash commits | No |
| drop commit | No |

### 4.7 Keyboard Accessibility Gaps

**Severity: MEDIUM**

- Only 14 `aria-label` attributes across the entire component directory
- Only 3 `role` attributes across the entire codebase
- `lv-stash-list`, `lv-tag-list`: Clickable items with no keyboard handlers (no tabindex, no keydown)
- Context menus: Mouse-only interaction (no keyboard trapping, arrow key navigation, or Escape handling)
- Tab close button in toolbar: `<span class="tab-close">` with `@click` but no keyboard handler, no button role

---

## 5. Incomplete Features

### 5.1 `uiStore.globalLoading` Never Used

**Severity: LOW**

`src/stores/ui.store.ts` defines `globalLoading` and `setGlobalLoading()`, but no component or service ever calls `setGlobalLoading()`. This was presumably intended as a centralized loading state but was never wired up.

### 5.2 Potentially Unused Functions in git.service.ts

**Severity: LOW**

These functions are defined but appear only in the service definition and/or test files, never called from production components:

| Function | Line |
|---|---|
| `getCommitSignature()` (singular) | 2029 |
| `runGarbageCollection()` | 6350 |
| `verifyRepository()` | 6390 |
| `getRepoSizeInfo()` | 6408 |
| `getRepoStats()` | 4966 |
| `getContributorStats()` | 4976 |

### 5.3 Cache Usage Inconsistency

**Severity: LOW**

`getCommitsSignatures()` (batch, line 2039) uses caching, but `getCommitSignature()` (singular, line 2029) does not. A call to the singular version bypasses the cache entirely.

### 5.4 Progress Service Race Condition

**Severity: LOW**

`src/services/progress.service.ts`: `setupListeners()` is called without `await` in the constructor. Event listeners may not be ready for operations that start very quickly after initialization.

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

### Critical (Functionality Broken)
1. Fix `clean-complete` / `files-cleaned` event name mismatch
2. Fix 4 snake_case Tauri parameter bugs in `git.service.ts`
3. Wire up `merge-conflict` event from branch list to open conflict dialog
4. Wire up `gitflow-initialized`/`gitflow-operation` events to trigger refresh
5. Fix `show-toast` events (replace with direct `showToast()` calls)
6. Wire up `show-commit` from reflog dialog to navigate graph
7. Fix Repository Health dialog `title` -> `modalTitle`

### High Priority (Data Integrity / UX)
8. Add user-visible error feedback to ~25 silent-failure operations
9. Add confirmation dialogs for destructive operations (clean, revert, soft/mixed reset)
10. Remove or consolidate `workflowStore` with `unifiedProfileStore`
11. Remove duplicate `recentRepositories` from `settingsStore`
12. Consolidate triplicate `IntegrationAccount` type definitions

### Medium Priority (Quality / Consistency)
13. Replace ~20 native `confirm()`/`prompt()` calls with themed dialogs
14. Add loading states to async operations in branch/tag/stash lists
15. Add disabled states to prevent double-clicking operations
16. Consolidate duplicate maintenance functions in git.service.ts
17. Standardize Tauri IPC usage (use `invokeCommand` everywhere)
18. Consolidate window events vs component events for refresh
19. Remove unused `uiStore` modal system
20. Add missing notification toasts for merge/rebase/cherry-pick/stash operations

### Low Priority (Polish / Maintenance)
21. Improve keyboard accessibility (aria-labels, tab navigation, context menu keyboard support)
22. Add cache consistency for `getCommitSignature()` singular
23. Fix error masking in `getRepositoryStats()` and `getPackInfo()`
24. Increase component unit test coverage (currently 21%)
25. Increase utility test coverage (currently 20%)
26. Remove unused functions from git.service.ts
27. Move inline types from git.service.ts to proper type files
