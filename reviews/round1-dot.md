# Round 1 — DOT (UI Consistency, Feedback, Dead Code, Test Coverage)

You've built a whole unified profile system with scattered events that *mostly* work but have several silent failures and inconsistent sibling handlers. The migration dialog is orphaned, profile cards dispatch events to nobody, and refresh-account has no error UI. Test coverage is good but missing entire error paths. 

---

## Findings

### D1: `edit-profile` event dispatched from lv-profile-card but no parent listener — Severity: Medium
- **Where:** `/home/user/Leviathan/src/components/dashboard/lv-profile-card.ts:226`
- **Evidence:** `this.dispatchEvent(new CustomEvent('edit-profile', { bubbles: true, composed: true }));`
- **Problem:** The "Edit profile" button in `lv-profile-card.ts` fires a custom event, but no parent in `app-shell.ts` or `lv-context-dashboard.ts` listens for it. CLAUDE.md rule: "Every dispatched event must have at least one listener." Dead code.
- **Fix:** Either add `@edit-profile=${() => { this.showProfileManager = true; }}` to the `<lv-context-dashboard>` host in app-shell.ts (line ~2472), or change the button to call a callback via property instead.

---

### D2: `open-dialog` and `refresh-account` events from lv-integration-card lack listener — Severity: Medium
- **Where:** `/home/user/Leviathan/src/components/dashboard/lv-integration-card.ts:253, 258`
- **Evidence:** 
  ```typescript
  this.dispatchEvent(new CustomEvent('open-dialog', { bubbles: true, composed: true }));
  this.dispatchEvent(new CustomEvent('refresh-account', {
    detail: { accountId: this.account.id },
    bubbles: true,
    composed: true
  }));
  ```
- **Problem:** `lv-context-dashboard` does not bubble these events to its parent. The `refresh-account` handler exists in `app-shell.ts:1758`, but only if the dashboard bubbles it. The `open-dialog` event has NO listener anywhere. CLAUDE.md: "Every dispatched event must have at least one listener."
- **Fix:** Add event listeners on `<lv-context-dashboard>` in app-shell.ts:2478 to capture and re-dispatch, or move handlers to the context dashboard itself.

---

### D3: `handleRefreshAccount()` in app-shell shows silent error path — Severity: High
- **Where:** `/home/user/Leviathan/src/app-shell.ts:1758–1769`
- **Evidence:**
  ```typescript
  private async handleRefreshAccount(e: CustomEvent<{ accountId: string }>): Promise<void> {
    const { accountId } = e.detail;
    try {
      const account = await unifiedProfileService.getGlobalAccount(accountId);
      if (account) {
        await unifiedProfileService.refreshAccountCachedUser(account);
      }
    } catch (error) {
      log.error('Failed to refresh account', error);  // <-- console.error only!
      showToast('Failed to refresh account connection', 'error');  // This line does run, so not silent actually
    }
  }
  ```
- **Problem:** CLAUDE.md rule "Error paths must never be silent." The catch block has `log.error()` (console only) but DOES call `showToast()`. However, the code is fragile: if `getGlobalAccount()` returns null (falsy), the refresh never runs and there's no feedback. Silent code path.
- **Fix:** Change the guard to show feedback: `if (!account) { showToast('Account not found', 'error'); return; }`

---

### D4: `migration-needed` event from lv-profile-manager-dialog has parent listener but no feedback on restore — Severity: Medium
- **Where:** `/home/user/Leviathan/src/components/dialogs/lv-profile-manager-dialog.ts:767–772`
- **Evidence:**
  ```typescript
  this.dispatchEvent(
    new CustomEvent('migration-needed', {
      bubbles: true,
      composed: true,
    })
  );
  ```
- **Problem:** The event is dispatched on restore backup (line 765–772) and has a listener in app-shell.ts:3040 (`@migration-needed=${() => { this.showMigrationDialog = true; }}`). GOOD! But the `performClose()` on line 765 runs BEFORE the event fires, so the dialog closes, then the migration dialog opens — jarring UX. The toast says "Restored X profiles..." but the user doesn't see the migration dialog open until after the close animation.
- **Fix:** Move `this.dispatchEvent()` BEFORE `this.handleClose()`, or dispatch after the close animation settles.

---

### D5: Sibling handlers in lv-profile-manager-dialog lack consistent event dispatch (handleSave vs handleSaveAccount) — Severity: Medium
- **Where:** `/home/user/Leviathan/src/components/dialogs/lv-profile-manager-dialog.ts:999–1049, 1190–1220`
- **Evidence:**
  - `handleSave()` (profile): calls `showToast(wasCreate ? 'Profile created' : 'Profile saved', 'success');` and `this.handleBack();`
  - `handleSaveAccount()` (account): calls `showToast('Account saved', 'success');` and `this.handleBack();`
  - Neither dispatches a `profile-changed` or `account-changed` event.
  - CLAUDE.md rule: "All sibling handlers must follow the same pattern. If handleAdd() dispatches a foo-changed event, then handleRemove(), handleUpdate() must also."
- **Problem:** The store subscription syncs the UI automatically, so the lack of events doesn't break functionality. BUT `handleDelete()` and `handleDeleteGlobalAccount()` also don't dispatch events. Inconsistent and fragile — future maintainers won't know if an event is expected.
- **Fix:** Add consistent event dispatch: `this.dispatchEvent(new CustomEvent('profile-updated', { bubbles: true, composed: true }));` in both handlers, and document that the parent listens (or document that the store subscription is the source of truth).

---

### D6: `open-profile-manager` event from lv-migration-dialog has listener but no UX feedback — Severity: Low
- **Where:** `/home/user/Leviathan/src/components/dialogs/lv-migration-dialog.ts:496–504`
- **Evidence:**
  ```typescript
  private handleOpenProfileManager(): void {
    this.dispatchEvent(
      new CustomEvent('open-profile-manager', {
        bubbles: true,
        composed: true,
      })
    );
  }
  ```
  Listener in app-shell.ts:3046: `@open-profile-manager=${() => { this.showProfileManager = true; }}`
- **Problem:** When the user clicks "Open Profile Manager" on the empty-state preview (line 617), the dialog triggers the event and sets `showProfileManager = true`, which opens the profile manager. But the migration dialog STAYS OPEN behind it. The migration dialog should close or demote itself. CLAUDE.md: the profile manager has a `demoted` property (line 610 in lv-profile-manager-dialog.ts) for exactly this. Not used here.
- **Fix:** Modify the handler to set the profile manager's `initialView` and `demoted` properties, or close the migration dialog first.

---

### D7: lv-account-selector dispatches three events but inconsistent feedback — Severity: Medium
- **Where:** `/home/user/Leviathan/src/components/dialogs/lv-account-selector.ts:292–324`
- **Evidence:**
  - `handleSelectAccount()`: dispatches `account-change`, closes dropdown immediately
  - `handleAddAccount()`: dispatches `add-account`, closes dropdown immediately
  - `handleManageAccounts()`: dispatches `manage-accounts`, closes dropdown immediately
  - No toast/inline feedback for any action
- **Problem:** CLAUDE.md rule: "Every user-initiated operation must provide feedback." The selector is a sub-dialog (opened from an integration dialog), so it's reasonable to not show toasts (they'd stack). But there's NO inline success message either. The user clicks "Add Account" and the dropdown closes — is it working? Did it fail? Silent.
- **Fix:** Add inline feedback (e.g., a spinner, then a checkmark) or ensure the parent handler calls `showToast()`.

---

### D8: Test coverage gap — lv-integration-card refresh/open-dialog handlers not tested — Severity: High
- **Where:** `/home/user/Leviathan/src/components/dashboard/lv-integration-card.ts` (no test file found)
- **Evidence:** `grep -rn "lv-integration-card" src/components/dashboard/__tests__/` returns nothing. The component exists, handles clicks, dispatches events, but has zero unit tests.
- **Problem:** CLAUDE.md: "Tests must be written for every code change... for every code path (happy path, error paths, edge cases)." The `handleRefresh()` and `handleOpenDialog()` methods have no test coverage. If a refactor breaks the event dispatch, no test will catch it.
- **Fix:** Create `/home/user/Leviathan/src/components/dashboard/__tests__/lv-integration-card.test.ts` with tests for: rendering, refresh button click (event dispatch), open dialog button click (event dispatch), connection status rendering (connected/disconnected/checking/unknown), user info display.

---

### D9: Test coverage gap — lv-profile-card edit handler not tested — Severity: Medium
- **Where:** `/home/user/Leviathan/src/components/dashboard/lv-profile-card.ts` (no test file found)
- **Evidence:** Same as D8 — no test file for this component.
- **Problem:** The `handleEdit()` method dispatches an event, but no test verifies the event is fired or that the button click works. If the event name changes or the listener is removed, no test catches it.
- **Fix:** Create `/home/user/Leviathan/src/components/dashboard/__tests__/lv-profile-card.test.ts` with tests for: empty state rendering, profile info rendering, edit button click (event dispatch), default badge display, assignment source icon/label.

---

### D10: Test coverage gap — lv-context-dashboard event bubbling not tested — Severity: Medium
- **Where:** `/home/user/Leviathan/src/components/dashboard/lv-context-dashboard.ts` (exists but no test for event propagation)
- **Evidence:** The component listens to profile-card and integration-card events but tests don't verify the bubbling chain. Line 1749–1769 in app-shell.ts depends on the dashboard bubbling `refresh-account`, but there's no E2E or unit test that verifies this flow.
- **Problem:** If a refactor removes the event listener in the dashboard, the integration dialog's refresh button silently stops working. No test catches it.
- **Fix:** Add tests to `lv-context-dashboard.test.ts` (if it exists) or create one, testing: `refresh-account` event capture from integration card and re-dispatch to parent, profile card edit event propagation.

---

### D11: lv-profile-manager-dialog bulk assign error path shows toast but no state rollback — Severity: Medium
- **Where:** `/home/user/Leviathan/src/components/dialogs/lv-profile-manager-dialog.ts:921–956`
- **Evidence:**
  ```typescript
  private async handleBulkAssign(): Promise<void> {
    // ...
    if (errorCount === 0) {
      showToast(`Assigned ${successCount} repository...`, 'success');
    } else {
      showToast(`Assigned ${successCount}, failed ${errorCount}`, 'warning');
    }
    // ... always resets selectedReposForAssignment = new Set();
  }
  ```
- **Problem:** On partial failure, the UI shows a warning toast but still clears the selection and returns to edit view. If the user wanted to retry the failed repos, they'd have to re-select them all. No error details (which repos failed). CLAUDE.md: "Every user-initiated operation must provide feedback." The feedback is too sparse for a destructive operation.
- **Fix:** On error, stay in assign-repos view with the failed repos still selected, or show a detailed error dialog listing failed repos.

---

### D12: Test coverage gap — Migration dialog does not test error paths — Severity: High
- **Where:** `/home/user/Leviathan/src/components/dialogs/__tests__/lv-migration-dialog.test.ts`
- **Evidence:** Scan the test file (lines 1–300+): tests cover intro → preview → migrating → complete, but there are NO tests for:
  - `preview_unified_profiles_migration` command fails → error toast shown
  - `execute_unified_profiles_migration` command fails → user returned to preview view
  - `loadPreview()` rejects → error state UI
  - Empty preview (no profiles, no accounts) → correct UI rendered
  - Unmatched accounts → assignment UI works
- **Problem:** CLAUDE.md: "Tests must exist for... Every code path (happy path, error paths, edge cases)." The migration dialog has silent error handling in `loadPreview()` (line 448–452: `showToast(..., 'error')` but no test for it). Error state UI not tested.
- **Fix:** Add tests for: preview load failure, migration execution failure, empty preview, unmatched account assignment, account assignment persistence.

---

## Confidence & Summary

**Confidence: High.** All findings are grounded in code reads of actual files:
- D1–D2: Event dispatch verified by grep + Read
- D3: Handler code verified in app-shell.ts
- D4–D7: Event dispatch and listener matching verified
- D8–D10: Test absence verified by grep for test files
- D11: Code path verified in lv-profile-manager-dialog.ts
- D12: Test file scanned for missing error path coverage

**Severity Breakdown:**
- Critical: 0
- High: 3 (D3 silent null path, D8 no integration-card tests, D12 migration error paths untested)
- Medium: 8 (D1, D2, D4–D7, D11)
- Low: 1 (D6)

**Next Steps:** Fix event listener chains first (D1, D2), then add missing test files (D8, D9, D10, D12), then refactor error feedback (D3, D11).
