# Profiles & Integrations Substrate — Converged 3-Way Review

**Substrate reviewed:** the unified-profile + integration-accounts stack — TS service/store/types,
the profile-manager / account-selector / migration dialogs, the dashboard profile/integration cards,
and the Rust `profiles`/`unified_profiles` commands, `integration_accounts`/`unified_profile` models,
plus the `credentials`/`oauth`/`github` integration backends. (~8k LOC core.)

## How this review was run

Three reviewers, three different models, each in a deliberately adversarial mood and each
with a distinct lens, reviewed independently (Round 1), then read each other's reports and
re-opened the code to attack/defend every finding (Round 2 — "the battle"). A final arbitration
pass (this document) resolved the disputes the panel itself could not, by direct code verification.

| Reviewer | Model | Lens |
|----------|-------|------|
| **VERA** | Opus | Architecture & data-model integrity (store/service/Rust contract, Tauri boundary, migrations) |
| **MARCUS** | Sonnet | Security & correctness (credentials, OAuth, panics, races, silent errors) |
| **DOT** | Haiku | UI event consistency, user feedback, dead code, test coverage (per `CLAUDE.md`) |

Round artifacts: `round1-{vera,marcus,dot}.md`, `round2-{vera,marcus,dot}.md`.

## What the battle changed (convergence movement)

The fight did real work — three Round-1 headline findings collapsed, and several severities moved:

- **`oidc` Critical → Medium (merged V1+M9).** Vera's R1 called the TS/Rust `oidc` enum mismatch a
  guaranteed-on-first-save config-corruption bug (Critical). Under fire, both Vera and Marcus traced the
  save path and found **no UI can create an oidc account**: the provider list at
  `lv-profile-manager-dialog.ts:1882` is hardcoded to `['github','gitlab','bitbucket','azure-devops']`,
  and the oidc config factory (`:2047`) is only reachable when *editing* an oidc account that nothing
  can create. The serde landmine is real but unreachable. Marcus's M9 SSRF in `discover_oidc_config`
  is the same half-built feature from the other end. **Merged and downgraded to Medium** (see arbitration).
- **DOT retracted D1 & D2 in full.** She claimed `edit-profile` / `open-dialog` / `refresh-account`
  were orphaned events (dead code). Vera and Marcus both refuted it, and Dot re-grepped and conceded:
  `lv-context-dashboard.ts` is an **event-bus relay** (`:1173`, `:1197`, `:1198`) that re-dispatches to
  `app-shell.ts` (`:2473–2478`). Full listener chains exist. **Not bugs.**
- **DOT's D3 downgraded High → Low.** The catch block *does* call `showToast`; only the null-account
  guard returns without feedback.
- **MARCUS retracted M6's stuck-spinner sub-claim**, merged into Vera's V6; both conceded the spinner
  never sticks (`setError` resets `isLoading` at `store.ts:220`).
- **MARCUS escalated M5+M11 Low → Medium (merged)** after confirming the loopback callback ignores the
  `state` param and the PKCE verifier is round-tripped through the client.

## Arbitration — disputes the panel could not settle itself

Two factual disagreements remained after Round 2. I resolved them by reading the code directly:

1. **Test coverage (D8/D9/D12): "no tests" vs "tests exist."**
   Marcus and Dot both kept D8/D9/D12 as missing tests; **Vera refuted them.** Direct check:
   `src/components/dashboard/__tests__/lv-dashboard-cards.test.ts` tests **both** cards —
   `lv-profile-card` edit-profile dispatch (`:267`, `:319`) and `lv-integration-card` (`:489`+).
   `src/components/dialogs/__tests__/lv-migration-dialog.test.ts` covers migration failure (`:506`),
   retry (`:539`) and preview-load failure (`:581`). **Vera is correct. D8 and D9 are INVALID**
   (Marcus and Dot assumed the filenames `lv-integration-card.test.ts` / `lv-profile-card.test.ts`,
   which don't exist; the real tests are in the combined `lv-dashboard-cards.test.ts`).
   **D12 collapses into V2** — the migration tests fail by mocking the IPC to *reject*; the one
   genuinely-untested case ("success-but-with-errors") is untestable because the backend can't produce
   it. That's the V2 defect, not a coverage gap.

2. **`oidc` severity: Vera Low vs Marcus Medium.**
   Direct check: `discover_oidc_provider` and `decode_oidc_id_token` **are** registered in the invoke
   handler (`src-tauri/src/lib.rs:662–663`) → reachable over IPC from the renderer. But **no component
   calls the TS wrappers** (`discoverOidcProvider`/`decodeOidcIdToken` have zero callers), and
   `startOAuth` is never invoked with `'oidc'`. So the SSRF sink is IPC-reachable but has no UI trigger,
   and the serde mismatch is a latent landmine. **Arbiter call: Medium** (latent, but a registered
   IPC-reachable SSRF + a config-corruption footgun that detonates the moment the "Enterprise SSO (OIDC)"
   entry the UI already advertises at `integration-accounts.types.ts:103` gets wired).

Independently verified during arbitration:
- **V2**: `unified_profiles.rs:746` sets `success: true`; nothing ever flips it and `errors` is never
  pushed to. There is no `Ok(..)` return with `success:false`. The frontend's `if (result.success)` and
  any `result.errors` rendering are structurally dead. **Confirmed.**
- **M7**: `lv-gitlab-dialog.ts` `handleDeleteIntegration` catch is `console.error`-only. **Confirmed.**

---

## Converged issue ledger

Severity is the arbitrated final. Where the panel split, the arbiter call + reason is noted.
"R1→Final" shows the severity journey.

### High — fix before shipping

| ID | Finding | Where | R1→Final |
|----|---------|-------|----------|
| **V2** | Migration always reports `success: true` — backend never computes success or populates `errors`, so the dialog's success/error branching is dead. Real failures are invisible. (D12 folds in here.) | `unified_profiles.rs:745–826` | High→**High** |
| **V3** | Default-account has two unreconciled sources of truth: `set_default_account` writes only `IntegrationAccount.is_default`, but `get_profile_preferred_account` reads the per-profile `default_accounts` map first. "Set as default globally" is a silent no-op for any profile with a preference. | `unified_profile.rs:588–612` | High→**High** |
| **M1** | GitHub App private-key PEM is accepted, used once to mint a JWT, then **never stored**; `get_github_app_config` is a stub returning `Ok(None)`, yet the UI sets `connected = true`. Auth silently broken on next launch. | `github.rs:2383–2454`, `:2429` | High→**High** |
| **M3** | macOS keychain entries created with `-A` (allow *any* application to read without prompt) — destroys per-app isolation for every stored integration token, in production builds. | `credentials.rs:544` | High→**High** |
| **M2** | `store_git_credentials` logs the full remote URL at `tracing::info!` on entry **and** exit; authenticated `https://token@host/...` remotes leak the token to production INFO logs / crash reporters. *(Marcus/Dot High, Vera Medium-as-conditional; arbiter: High with the caveat it only fires when a userinfo-bearing URL is passed — strip userinfo before logging regardless.)* | `credentials.rs:462–471` | High/Med→**High** |

### Medium

| ID | Finding | Where | R1→Final |
|----|---------|-------|----------|
| **V1+M9** | **OIDC is half-built.** TS enum has an `oidc` variant Rust can't deserialize (config-corruption landmine if ever wired) **and** `discover_oidc_config` is an unvalidated SSRF sink reachable via registered IPC commands. No UI path triggers either today. Fix enum parity **and** issuer-URL validation in the same change that wires the SSO UI. | `integration-accounts.types.ts:11,21`; `services/oauth.rs:239`; `lib.rs:662–663` | Crit/Med→**Medium** |
| **M5+M11** | PKCE verifier is round-tripped through the frontend instead of held server-side (`OAuthState.pending` is `#[allow(dead_code)]`), and the loopback callback ignores the `state` param — PKCE + CSRF guarantees both eliminated. Desktop threat model keeps it off High. | `oauth.rs:225,50–51`; `loopback_server.rs:208–230` | Med/Low→**Medium** |
| **M4** | `url_pattern` injected verbatim into a git config key `credential.<pattern>.helper` with no validation. No shell (so no RCE), but newlines/crafted input corrupt the config / write unexpected subsections. *(Marcus High; Vera+Dot Medium → Medium.)* | `credentials.rs:172–180` | High→**Medium** |
| **M7** | GitLab `handleDeleteIntegration` swallows errors with `console.error` only — no `this.error`/`showToast`. Direct `CLAUDE.md` "error paths must never be silent" violation; the GitHub sibling handler does it right. | `lv-gitlab-dialog.ts:1086` | Med→**Medium** |
| **M8** | `unified_profiles.json` written with default umask (≈`0644`) — group-readable PII (cached emails, display names, usernames, account IDs). Tokens are safely in the keyring; metadata is not. | `unified_profiles.rs:82–94` | Med→**Medium** |
| **V7** | `updateGlobalAccountCachedUser` ends with a full `loadUnifiedProfiles()` (replaces the whole config); the refresh/validate loops call it per-account → O(N) full-config reloads, racing the separately-updated `accountConnectionStatus` slice. | `unified-profile.service.ts:270–284, 680–727` | Med→**Medium** |
| **V8** | Two migration paths disagree on account `url_patterns`: the v2→v3 model path hardcodes `Vec::new()` while the command path copies them. After the model path, account auto-detection silently stops. | `unified_profile.rs:388–402` vs `unified_profiles.rs:756–768` | Med→**Medium** |
| **V5** | Three different functions named `getProfilePreferredAccount` (store selector, pure helper, Tauri wrapper) with three signatures and three fallback semantics — a silent FE/BE disagreement on which account is "preferred." | `store.ts:285`, `types.ts:309`, `service.ts:289` | Med→**Medium** |
| **V4** | Migration hardcodes color `"#3b82f6"` instead of `PROFILE_COLORS[0]`; two legacy-profile shapes feed two paths with different color types. | `unified_profiles.rs:802` | Med→**Medium** |
| **V6+M6** | `loadUnifiedProfiles` has no `finally` and never clears `profiles`/`accounts` on error, so the UI can show **stale data alongside an error banner**. (Spinner-stuck sub-claim retracted: `setError` resets `isLoading`.) *(Vera Low, Marcus+Dot Medium → Medium.)* | `unified-profile.service.ts:503–514` | Med→**Medium** |
| **D4** | Restore-backup runs `performClose()` before dispatching `migration-needed`, so the dialog closes then the migration dialog reopens — jarring. *(Vera Low, Marcus+Dot Medium → Medium.)* | `lv-profile-manager-dialog.ts:765–772` | Med→**Medium** |
| **D11** | Bulk-assign partial failure clears the selection and returns to edit view, with a single warning toast and no list of which repos failed — retry means re-selecting everything. | `lv-profile-manager-dialog.ts:921–956` | Med→**Medium** |

### Low

| ID | Finding | Where |
|----|---------|-------|
| **D3** | `handleRefreshAccount` null-account guard returns with no feedback (the catch path *does* toast). *(High→Low.)* | `app-shell.ts:1758–1769` |
| **D5** | `handleSave`/`handleSaveAccount` (and delete siblings) dispatch no change event; store subscription is the real sync — document it as the source of truth. | `lv-profile-manager-dialog.ts:999,1190` |
| **D6** | "Open Profile Manager" from the empty migration preview leaves the migration dialog stacked behind it; the `demoted` property exists but is unused. | `lv-migration-dialog.ts:496–504` |
| **D7** | `lv-account-selector` actions give no inline feedback (sub-dialog; toasts would stack) — minor. | `lv-account-selector.ts:292–324` |
| **D10** | The card→dashboard→app-shell relay re-dispatch is not covered by a test (the wiring itself is present). | `lv-context-dashboard.test.ts` |
| **M10** | `deleteAccountToken` + `deleteGlobalAccount` are non-atomic → zombie account / orphaned token on partial failure. Delete keyring last. | `lv-github-dialog.ts:1392`, `lv-gitlab-dialog.ts:1071` |
| **V9** | `addProfile` fabricates a `version: 3` config from a literal; sibling mutators leave `config: null`. Use `UNIFIED_PROFILES_CONFIG_VERSION`, pick one bootstrap rule. | `unified-profile.store.ts:113–215` |
| **V10** | `get_account_from_any_profile` returns `("".to_string(), account)` — a lying profile-id (deprecated); empty id → "Profile not found" downstream. Delete it or return `Option<IntegrationAccount>`. | `unified_profiles.rs:1072–1084` |

### Struck — refuted by the battle / arbitration (do not action)

| ID | Claim | Why it's invalid |
|----|-------|------------------|
| **D1** | `edit-profile` orphaned | Relayed `lv-context-dashboard.ts:1173` → `app-shell.ts:2473`. Fully wired. |
| **D2** | `open-dialog`/`refresh-account` orphaned | Handled at `lv-context-dashboard.ts:1197/1198` → `app-shell.ts:2474–2478`. Fully wired. |
| **D8** | `lv-integration-card` untested | Tested in `lv-dashboard-cards.test.ts:489+`. |
| **D9** | `lv-profile-card` untested | Tested in `lv-dashboard-cards.test.ts:267,319`. |
| **D12** | Migration error paths untested | Covered at `lv-migration-dialog.test.ts:506/539/581`; the residual gap *is* V2. |

---

## Recommended fix order

1. **Ship-blockers (data-loss + auth + credential exposure):** V2, V3, M1, M3, M2.
2. **Security hardening:** M4, M5+M11, M8, M9 (do V1+M9 together before any OIDC UI work).
3. **Correctness / consistency:** V5, V7, V8, V4, V6, M7, M10.
4. **UX + maintainability + the one real test gap:** D4, D11, D3, D5, D6, D7, D10, V9, V10.

## Tally (arbitrated)

- **High:** 5 (V2, V3, M1, M3, M2)
- **Medium:** 12 (V1+M9, M5+M11, M4, M7, M8, V7, V8, V5, V4, V6+M6, D4, D11)
- **Low:** 8 (D3, D5, D6, D7, D10, M10, V9, V10)
- **Struck as invalid:** 5 (D1, D2, D8, D9, D12)

No Critical survived the battle — the lone Round-1 Critical (`oidc`) was downgraded once both reviewers
proved it's unreachable through the current UI. The real risk concentration is the **migration system**
(V2/V3/V4/V8) and **credential/keychain handling** (M1/M2/M3), which is where remediation should start.
