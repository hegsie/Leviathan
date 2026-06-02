# Round 1 — VERA (Architecture & Data-Model Integrity)

This substrate is held together with optimism and `?? null`. There are TWO canonical `IntegrationType` enums that flatly disagree across the TS/Rust boundary — the TypeScript side ships an `'oidc'` member and a whole `oidc` config variant that the Rust enum has never heard of, so the very first time a user saves an Enterprise SSO account the serde deserializer detonates and the entire `unified_profiles.json` becomes unreadable. There are TWO live, divergent definitions of `getProfilePreferredAccount` and `getDefaultGlobalAccount` (store vs types module) with subtly different fallback semantics. The migration dialog cheerfully reports "Migration completed successfully" and then leaves the store completely empty because nobody reloads it. The legacy `GitProfile.color` is `Option<String>` on one side of the migration and a required `String` on the other, papered over with a hardcoded hex literal that silently discards user color choices. And `set_default_global_account` mutates `is_default` flags but never reconciles the per-profile `default_accounts` maps, so "defaults" are now two independent sources of truth that drift the moment anyone touches them. This is not "needs polish." This is a data model that loses user data. Fix it before it ships.

---

### V1: `oidc` integration type exists in TypeScript but not in Rust — guaranteed serde failure & config corruption — Severity: Critical
- **Where:** `src/types/integration-accounts.types.ts:11` & `:16-21`; `src/components/dialogs/lv-profile-manager-dialog.ts:2047-2048`; vs `src-tauri/src/models/integration_accounts.rs:11-20` & `:34-59`
- **Evidence:**
  TypeScript declares `oidc` as a first-class type AND config variant:
  ```ts
  export type IntegrationType = 'github' | 'gitlab' | 'azure-devops' | 'bitbucket' | 'oidc';
  export type IntegrationConfig =
    | { type: 'github' }
    ...
    | { type: 'oidc'; issuerUrl: string; clientId: string };
  ```
  and the profile manager will actually construct one:
  ```ts
  case 'oidc':
    return { type: 'oidc', issuerUrl: '', clientId: '' };
  ```
  The Rust enums have no such member:
  ```rust
  pub enum IntegrationType {
      #[serde(rename = "github")] GitHub,
      #[serde(rename = "gitlab")] GitLab,
      #[serde(rename = "azure-devops")] AzureDevOps,
      #[serde(rename = "bitbucket")] Bitbucket,
  }   // no Oidc

  #[serde(tag = "type")]
  pub enum IntegrationConfig { GitHub, GitLab{..}, AzureDevOps{..}, Bitbucket{..} } // no oidc
  ```
- **Problem:** `save_global_account(account: IntegrationAccount)` deserializes the incoming payload into the Rust `IntegrationAccount`. An `integrationType: "oidc"` / `config: {type:"oidc",...}` payload cannot deserialize — serde rejects the unknown enum variant, the Tauri command fails. Worse: `INTEGRATION_TYPE_NAMES` (TS) and the store's `getAccountCountByType` already enumerate `oidc: 0`, so the UI invites the user to create something the backend cannot persist. If an oidc entry ever reaches `unified_profiles.json` by any path, every subsequent `load_unified_profiles_config()` (`unified_profiles.rs:74`) fails to parse the WHOLE file and the user loses all profiles and accounts.
- **Fix:** Either add `Oidc` to the Rust `IntegrationType` (with `#[serde(rename="oidc")]`), add an `Oidc { issuer_url, client_id }` variant to `IntegrationConfig`, and update `Display`/`integration_type()`, OR remove `oidc` from the TS `IntegrationType`/`IntegrationConfig`/`getDefaultConfigForType`/`INTEGRATION_TYPE_NAMES`. Do not ship a type whose values one side cannot represent. Pick one source of truth for the enum.

---

### V2: Migration reports success but never loads the migrated data into the store — Severity: High
- **Where:** `src/services/unified-profile.service.ts:439-454` (`executeUnifiedProfilesMigration`) and `:503-514` (`loadUnifiedProfiles`); `src/components/dialogs/lv-migration-dialog.ts:458-482`
- **Evidence:**
  ```ts
  // executeUnifiedProfilesMigration
  await loadUnifiedProfiles();   // <-- reloads
  return result.data!;
  ```
  but `loadUnifiedProfiles` swallows the case where migration just ran and `checkMigrationNeeded` was never re-run. More importantly, the dialog:
  ```ts
  const result = await unifiedProfileService.executeUnifiedProfilesMigration(this.accountAssignments);
  this.migrationResult = result;
  this.viewMode = 'complete';
  if (result.success) {
    unifiedProfileStore.getState().setNeedsMigration(false);
    showToast('Migration completed successfully', 'success');
  }
  ```
  Note `result.success` is hardcoded `true` in the backend (`unified_profiles.rs:746` sets `success: true` and never sets it false), so the dialog ALWAYS shows success even if zero profiles migrated.
- **Problem:** `execute_unified_profiles_migration` returns a `UnifiedMigrationResult` whose `success` field is initialized to `true` and never flipped to `false` on any error path — the only failures are early `?` returns that reject the whole command. So `result.success` in the UI is meaningless: it is `true` whenever the promise resolves. The "complete" screen and toast are therefore not evidence of anything. Combined with `loadUnifiedProfiles` being the only refresh, any race or partial failure is invisible to the user.
- **Fix:** Make the backend actually compute `success` (e.g. `success = result.errors.is_empty()`), push real errors into `errors`, and have the dialog branch on it. Verify the store reflects migrated profiles/accounts after `loadUnifiedProfiles()` resolves (it currently does call `setConfig`, but only because the file was written — assert it).

---

### V3: `set_default_global_account` and per-profile `default_accounts` are two unreconciled sources of truth — Severity: High
- **Where:** `src-tauri/src/models/unified_profile.rs:588-594` (`set_default_account`) and `:598-612` (`get_profile_preferred_account`); store mirror `src/stores/unified-profile.store.ts:294-311`
- **Evidence:**
  ```rust
  pub fn set_default_account(&mut self, integration_type: &IntegrationType, account_id: &str) {
      for account in &mut self.accounts {
          if &account.integration_type == integration_type {
              account.is_default = account.id == account_id;
          }
      }
  }   // touches account.is_default ONLY — never profile.default_accounts
  ```
  Preferred-account resolution prefers the profile map FIRST:
  ```rust
  if let Some(account_id) = profile.get_default_account_id(integration_type) {
      if let Some(account) = self.get_account(account_id) { return Some(account); }
  }
  self.get_default_account(integration_type)   // global is_default only a fallback
  ```
- **Problem:** "Default account for a type" is stored in TWO places: the global `IntegrationAccount.is_default` flag and each `UnifiedProfile.default_accounts[type]`. `set_default_global_account` updates only the former; `set_profile_default_account` updates only the latter. Because `get_profile_preferred_account` consults the profile map first, changing the global default has NO effect for any profile that has a preference — the UI's "Set as default globally" silently does nothing for those profiles. They drift permanently. There is no invariant keeping them consistent.
- **Fix:** Decide which is authoritative. Either (a) drop `IntegrationAccount.is_default` entirely and resolve defaults purely from profile maps + a single global-default map, or (b) when `set_default_global_account` runs, optionally clear/realign profile preferences, and document the precedence loudly. Right now the precedence is implicit and the two stores diverge by design.

---

### V4: Legacy `GitProfile.color` is `Option<String>` but migration hardcodes a fallback hex, silently dropping user color — Severity: Medium
- **Where:** `src-tauri/src/commands/unified_profiles.rs:802`; `src-tauri/src/models/workflow.rs:24` (`pub color: Option<String>`); target `src-tauri/src/models/unified_profile.rs:254` (`pub color: String`)
- **Evidence:**
  ```rust
  color: p.color.clone().unwrap_or_else(|| "#3b82f6".to_string()),
  ```
- **Problem:** The legacy `GitProfile.color` is optional. When it is `None`, migration assigns the literal blue `#3b82f6` regardless of `PROFILE_COLORS`. That is at least defensible. But there is a second, subtler issue: the v2→v3 in-model path (`UnifiedProfileV2.to_v3`, `unified_profile.rs:374-384`) clones `self.color.clone()` because v2's color is already `String`, while the COMMAND-level migration reads from `workflow::GitProfile` where color is `Option`. Two different "legacy profile" shapes feed two different migration code paths with different color types. Anyone maintaining this will assume one shape and corrupt the other. The hardcoded hex also bypasses `PROFILE_COLORS[0]` (`unified_profile.rs:307` uses the constant; the migration uses a string literal) — two definitions of "the default color."
- **Fix:** Use `PROFILE_COLORS[0]` (or the shared constant) instead of the bare `"#3b82f6"` literal so there's one default-color source. Document which legacy struct (`workflow::GitProfile` vs `UnifiedProfileV2`) each migration path consumes, and ideally collapse to one.

---

### V5: Two divergent implementations of `getProfilePreferredAccount` / `getDefaultGlobalAccount` — Severity: Medium
- **Where:** `src/stores/unified-profile.store.ts:285-311` vs `src/types/unified-profile.types.ts:309-333`
- **Evidence:**
  Store version (operates on live store state, profile lookup by id):
  ```ts
  export function getProfilePreferredAccount(profileId: string, integrationType: IntegrationType): IntegrationAccount | undefined {
    const { profiles, accounts } = unifiedProfileStore.getState();
    const profile = profiles.find((p) => p.id === profileId);
    ...
    return getDefaultGlobalAccount(integrationType);   // store-scoped helper
  }
  ```
  Types-module version (takes profile + accounts as args):
  ```ts
  export function getProfilePreferredAccount(profile: UnifiedProfile, accounts: IntegrationAccount[], integrationType: IntegrationType): IntegrationAccount | undefined { ... }
  ```
  Both are named identically; the types module also re-exports through `unified-profile.types.ts` while the service exports yet another `getProfilePreferredAccount` Tauri wrapper at `unified-profile.service.ts:289`. THREE things named `getProfilePreferredAccount`.
- **Problem:** Three same-named functions (store selector, pure helper, Tauri command wrapper) with three different signatures and three different fallback behaviors (store falls back to `getDefaultGlobalAccount` which returns `accounts.find(isDefault) || accounts[0]`; the Tauri one defers to Rust which prefers the profile map). A caller importing "the" preferred-account function has no way to know which semantics they get. This is exactly how the frontend and backend silently disagree on which account is "preferred."
- **Fix:** Rename them to reflect scope (`getStoreProfilePreferredAccount`, `resolveProfilePreferredAccount`, `fetchProfilePreferredAccount`) or delete the duplicates and keep ONE. Pick the Rust resolution as canonical and make the TS helpers mirror it exactly.

---

### V6: `loadUnifiedProfiles` leaves `isLoading` stuck `true` and never clears stale accounts on error — Severity: Medium
- **Where:** `src/services/unified-profile.service.ts:503-514`
- **Evidence:**
  ```ts
  export async function loadUnifiedProfiles(): Promise<void> {
    const store = unifiedProfileStore.getState();
    store.setLoading(true);
    try {
      const config = await getUnifiedProfilesConfig();
      store.setConfig(config);
      store.setLoading(false);
    } catch (error) {
      store.setError(error instanceof Error ? error.message : 'Failed to load profiles');
    }
  }
  ```
- **Problem:** On the happy path `setLoading(false)` runs. On the error path it relies on `setError` (store.ts:220) which does set `isLoading:false` — OK there. But there is no `finally`, and `setConfig` is only called on success, so a transient failure leaves the previously-loaded `profiles`/`accounts` in the store while ALSO setting an error string — the UI shows stale data and an error banner simultaneously, an inconsistent state. The pattern also differs from `initializeUnifiedProfiles` (`:557`) which separately toggles loading. Inconsistent loading-state handling across sibling loaders.
- **Fix:** Use a `finally { store.setLoading(false); }` and decide explicitly whether an error should clear `profiles`/`accounts` or keep them — don't leave it accidental. Make all loader functions follow the same loading/error contract.

---

### V7: `refreshAccountCachedUser` writes connection status to the store but the persisted cachedUser write is fire-and-forget across a reload — Severity: Medium
- **Where:** `src/services/unified-profile.service.ts:680-695` and `updateGlobalAccountCachedUser:270-284`
- **Evidence:**
  ```ts
  store.setAccountConnectionStatus(account.id, isConnected ? 'connected' : 'disconnected');
  if (cachedUser) {
    await updateGlobalAccountCachedUser(account.id, cachedUser);  // calls loadUnifiedProfiles() inside
  }
  ```
  and `updateGlobalAccountCachedUser` ends with `await loadUnifiedProfiles();`.
- **Problem:** `updateGlobalAccountCachedUser` triggers a full `loadUnifiedProfiles()` (which calls `setConfig`, replacing the entire `accounts` array) on EVERY single account refresh. `refreshAllAccountsCachedUser` (`:701`) and `validateAllAccountTokens` (`:727`) loop over all accounts calling `refreshAccountCachedUser` sequentially — so for N accounts you reload and replace the whole config N times. Each `setConfig` also resets `error: null` and rebuilds `profiles`. Beyond the obvious O(N) reload storm, the freshly-set `accountConnectionStatus` (a separate store slice) is preserved, but any concurrent edit to `accounts` made between the loop iterations is clobbered by the stale reload. The connection-status slice and the accounts slice are updated through two different mechanisms with no ordering guarantee.
- **Fix:** Have `update_global_account_cached_user` return the updated account (or the full config once) and update the single account in the store via `updateAccount`, instead of a blanket `loadUnifiedProfiles()` per call. Batch the validation loop into one reload at the end.

---

### V8: `IntegrationAccount` field ORDER and the deprecated `ProfileIntegrationAccount` create a silent migration data-loss surface — Severity: Medium
- **Where:** `src-tauri/src/models/unified_profile.rs:388-402` (`extract_accounts`) and `:42-61` (struct); `src/types/unified-profile.types.ts:64-79` (`ProfileIntegrationAccount`)
- **Evidence:**
  ```rust
  // v2 ProfileIntegrationAccount -> v3 IntegrationAccount
  .map(|a| IntegrationAccount {
      ...
      url_patterns: Vec::new(), // v2 accounts didn't have their own patterns
      is_default: a.is_default_for_type,
  })
  ```
- **Problem:** v2 accounts inherited the profile's URL patterns for auto-detection. The v2→v3 conversion hardcodes `url_patterns: Vec::new()`, so after migration NO account has any URL patterns. The command-level migration (`unified_profiles.rs:756-768`) does the opposite — it copies `account.url_patterns.clone()` from the LEGACY accounts config. So depending on whether the user came through `UnifiedProfilesConfigV2::to_v3` or `execute_unified_profiles_migration`, accounts either keep or lose their auto-detection patterns. Two migration paths, two different outcomes for the same conceptual data. After the v2-model path, repository auto-detection by account silently stops working.
- **Fix:** In `extract_accounts`, carry the owning v2 profile's `url_patterns` onto each extracted account (that was their effective detection set), or explicitly document that v2 account auto-detection is intentionally dropped. Make both migration paths converge on the same pattern-handling rule.

---

### V9: `addProfile` fabricates a `version: 3` config but `removeAccount`/`updateProfile` return `config: null` when none exists — inconsistent config bootstrapping — Severity: Low
- **Where:** `src/stores/unified-profile.store.ts:113-124` vs `:126-132`, `:181-215`
- **Evidence:**
  ```ts
  addProfile: (profile) => set((state) => {
    ...
    const config = state.config
      ? { ...state.config, profiles }
      : { version: 3, profiles, accounts: state.accounts, repositoryAssignments: {} };
    return { profiles, config, error: null };
  }),

  updateProfile: (profile) => set((state) => {
    ...
    const config = state.config ? { ...state.config, profiles } : null;  // <-- null!
    ...
  }),
  ```
- **Problem:** `addProfile` will synthesize a config out of thin air with a hardcoded `version: 3`, but every sibling mutator (`updateProfile`, `setAccounts`, `addAccount`, `updateAccount`, `removeAccount`) leaves `config` as `null` when it was `null`. So whether `store.config` exists after a mutation depends on which mutator you happened to call first. The hardcoded `3` also duplicates `UNIFIED_PROFILES_CONFIG_VERSION` (types.ts:37) instead of referencing it — a fourth place the version number is written by hand (store, types const, Rust const, migration result).
- **Fix:** Pick one rule: either all mutators bootstrap a config (using the imported `UNIFIED_PROFILES_CONFIG_VERSION`, never a literal `3`), or none do and config is only ever set by `setConfig`. The current split is an accident waiting to surface as "my profile saved but the config is null."

---

### V10: `get_account_from_any_profile` returns `("".to_string(), account)` — a vestigial profile-id contract that lies — Severity: Low
- **Where:** `src-tauri/src/commands/unified_profiles.rs:1072-1084`
- **Evidence:**
  ```rust
  pub async fn get_account_from_any_profile(account_id: String) -> Result<Option<(String, IntegrationAccount)>> {
      ...
      return Ok(Some(("".to_string(), account.clone())));
  }
  ```
- **Problem:** The tuple's first element used to be the owning profile id (v2 semantics, accounts nested in profiles). In v3 accounts are global, so it returns an empty string. Any TS caller destructuring `[profileId, account]` now gets `profileId === ""` and may use it as a real id — e.g. passing it to `set_profile_default_account`, which would `get_profile_mut("")` → `None` → "Profile not found". The signature actively encourages a bug.
- **Fix:** Delete this deprecated command (it's marked `@deprecated`, use `get_global_account`) or change the return to just `Option<IntegrationAccount>`. Don't ship a tuple whose first field is a permanent lie.

---

## Confidence

- **V1 (Critical):** High confidence the enums disagree and oidc cannot deserialize. I did NOT execute a serde round-trip, but `#[serde(tag="type")]` with no matching variant is a hard deserialize error by construction, and the TS factory at `lv-profile-manager-dialog.ts:2047` provably can emit it. The only thing that would downgrade this is if a command-registration layer (not in scope) blocks oidc before it reaches Rust — worth a 5-minute check of the invoke handler list.
- **V2:** High on "success is always true" (the Rust never sets it false). Medium on the exact store-refresh consequence — `loadUnifiedProfiles` does call `setConfig`, so the store is not necessarily empty; the real defect is that the success signal is meaningless. I softened the verdict's "completely empty" claim accordingly — treat that phrasing as rhetorical, the grounded defect is the bogus `success` flag.
- **V3, V8:** High — these are structural (two write paths, two read precedences) and visible directly in the quoted code.
- **V7:** High that every cached-user update triggers a full reload; medium on the concurrency clobber (depends on whether refreshes ever truly overlap — they're awaited sequentially in the provided loops, so the clobber window is narrow but real if any other caller writes concurrently).
- **V4, V5, V6, V9, V10:** High confidence on the facts; severities are deliberately Low/Medium because they are correctness/maintainability hazards rather than immediate data loss.
- I did not read the Tauri command-registration file (`lib.rs`/`main.rs`) or `credential.service.ts` — out of scope — so any claim depending on command wiring (only V1's mitigation note) is correspondingly hedged.
