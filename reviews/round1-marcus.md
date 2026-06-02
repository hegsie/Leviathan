# Round 1 — MARCUS (Security & Correctness)

Oh, fantastic. Another codebase where the word "security" appears in comments but the implementation reads like it was written at 2 AM by someone who learned OAuth from a YouTube tutorial. Let me be precise about what I actually found — because every one of these is real, traceable, and frankly embarrassing.

---

### M1: GitHub App Private Key Never Stored — But IPC Argv Exposure Is Claimed to Be Fixed — Verdict: Lie — Severity: High

- **Where:** `src-tauri/src/commands/github.rs:2383–2454`, `src-tauri/src/commands/credentials.rs:519–580`
- **Evidence:**
  ```rust
  // github.rs:2383
  pub async fn configure_github_app(
      app_id: u64,
      private_key_pem: String,   // <-- RSA private key arrives here
      installation_id: u64,
  ) -> Result<GitHubConnectionStatus> {
  ```
  ```rust
  // credentials.rs:519 — the macOS keyring workaround correctly pipes via stdin
  let mut child = std::process::Command::new("security")
      .args(["add-generic-password", "-s", INTEGRATION_SERVICE, "-a", &key, "-A", "-U", "-w"])
      .stdin(std::process::Stdio::piped())
      ...
  ```
- **Problem:** `configure_github_app` accepts a full RSA private key PEM and uses it to generate a JWT, then **discards it entirely** — it is never persisted to the keyring or anywhere else. The backend `get_github_app_config` at line 2429 is a stub returning `Ok(None)`. So the key lives only in the IPC message payload and the Rust stack frame for the duration of the call. Every subsequent app launch will find no key and silently fall back (the UI sets `connectionStatus.connected = true` anyway at line 1462 in the dialog). The user's PEM was just uploaded through IPC, consumed once, then thrown away — next launch they get a broken "connected" indicator with no working token. This is not a storage mistake; the storage code simply was never written.
- **Fix:** After validating the key, store it via `store_keyring_token` using a namespaced key such as `github_app_pem_<app_id>`. Implement `get_github_app_config` and `remove_github_app_config` as real keyring operations.

---

### M2: `store_git_credentials` Logs the Remote URL at INFO Level — Potential Credential URL Leak — Severity: High

- **Where:** `src-tauri/src/commands/credentials.rs:462–471`
- **Evidence:**
  ```rust
  pub async fn store_git_credentials(url: String, username: String, password: String) -> Result<()> {
      tracing::info!("Storing git credentials for URL: {}", url);
      ...
      tracing::info!("Successfully stored git credentials for URL: {}", url);
  ```
- **Problem:** `url` is frontend-supplied and can be an authenticated HTTPS remote URL of the form `https://token@github.com/org/repo`. If the caller passes the raw remote string (which git sometimes provides), the token or password is embedded in `url` and immediately written to the application's INFO log at both entry and exit. This is a production logging path — not a debug log — and INFO is typically captured in crash reporters, log aggregators, and macOS Console. The `username` and `password` parameters are not logged, but the URL is, and authenticated URLs are a real credential vector.
- **Fix:** Parse the URL before logging to strip any embedded userinfo: `url.split('@').last().map_or(&url, |s| s)`. Or simply do not log the URL at INFO level; a structured log with only the hostname is sufficient.

---

### M3: macOS Keychain Entry Created with `-A` (Allow Any Application) — Keychain Isolation Demolished — Severity: High

- **Where:** `src-tauri/src/commands/credentials.rs:537–547`
- **Evidence:**
  ```rust
  let mut child = std::process::Command::new("security")
      .args([
          "add-generic-password",
          "-s", INTEGRATION_SERVICE,
          "-a", &key,
          "-A",   // Allow any application to access without prompt
          "-U",
          "-w",
      ])
  ```
- **Problem:** The `-A` flag in macOS `security add-generic-password` sets the ACL to "allow all applications" — any process running as the current user, including malicious software, browser extensions running in a compromised process, and other Electron/Tauri apps, can silently read these tokens without any authorization prompt. The comment even admits it: "Allow any application to access without prompt." The stated reason is to avoid repeated code-signature prompts during dev builds, but this flag persists into production builds. The correct fix for dev builds is to use entitlements or a stable identifier, not to destroy the keychain's per-application isolation for all users.
- **Fix:** Remove `-A`. For dev build signature instability, use `security add-generic-password -T ""` scoped to a stable team ID or accept the prompt — it happens once per signature change, not every call.

---

### M4: Git Config Key Injection via `url_pattern` Parameter — Severity: High

- **Where:** `src-tauri/src/commands/credentials.rs:172–180`
- **Evidence:**
  ```rust
  if let Some(url) = url_pattern {
      let key = format!("credential.{}.helper", url);
      let scope = ...;
      run_git_config(repo_path, &[scope, &key, &helper])?;
  }
  ```
- **Problem:** `url_pattern` is a caller-supplied string inserted verbatim between `"credential."` and `".helper"` to form a git config key. Git config keys are `section.subsection.key`; if `url_pattern` contains a newline or `\n`, git config will treat it as a multi-value entry. More critically, if `url_pattern` contains something like `https://evil.com" --global user.name "attacker`, the resulting string is passed as a single array element to `run_git_config` which uses `cmd.args(...)` — this is NOT shell injection since there's no shell, but the key itself is still malformed and could break the config file or, with a crafted `.` sequence, write to an unexpected subsection. The `helper` parameter has the same exposure at line 180. Neither parameter is validated against a pattern before use.
- **Fix:** Validate `url_pattern` against a strict allowlist regex (scheme + hostname only, no newlines, no special characters beyond `/`) before constructing the key. Validate `helper` similarly.

---

### M5: OAuth PKCE Verifier Returned to Frontend and Logged — Severity: Medium

- **Where:** `src-tauri/src/commands/oauth.rs:223–228`, `src/components/dialogs/lv-github-dialog.ts:1177–1182`
- **Evidence:**
  ```rust
  Ok(StartOAuthResponse {
      authorize_url,
      verifier: pkce.verifier,  // sent to frontend
      state,
      loopback_port,
  })
  ```
  ```typescript
  console.log('[GitHub Dialog] OAuth complete event received:', {
    provider,
    hasTokens: !!tokens,
    accessToken: tokens?.accessToken?.substring(0, 10) + '...',
    tokenKeys: tokens ? Object.keys(tokens) : [],
  });
  ```
- **Problem:** The PKCE verifier is a secret — it is the pre-image of the challenge and is required to complete the token exchange. Returning it to the frontend means it now lives in the DOM/IPC layer and is accessible to any JavaScript that can reach the window. Additionally, the GitHub dialog logs the first 10 characters of the access token to the browser console at line 1180. The GitLab dialog at line 1142 logs token verification results including `connected` and `user.username` which, while not the token itself, confirms exact token validity in the console log stream. Console output in Electron/Tauri is visible in DevTools and in crash reports if captured.
- **Fix:** The verifier should be stored entirely server-side in the `OAuthState.pending` map (which already exists but is unused). Do not return it to the frontend. Remove the partial `accessToken` log from the GitHub dialog.

---

### M6: `loadUnifiedProfiles` Does Not Call `setLoading(false)` on Error — UI Stuck in Loading State — Severity: Medium

- **Where:** `src/services/unified-profile.service.ts:503–513`
- **Evidence:**
  ```typescript
  export async function loadUnifiedProfiles(): Promise<void> {
    const store = unifiedProfileStore.getState();
    store.setLoading(true);
    try {
      const config = await getUnifiedProfilesConfig();
      store.setConfig(config);
      store.setLoading(false);          // only reached on success
    } catch (error) {
      store.setError(error instanceof Error ? error.message : 'Failed to load profiles');
      // setLoading(false) is NEVER called in the error path
    }
  }
  ```
- **Problem:** On any backend failure (disk error, parse error, IPC failure), `setLoading(true)` is set and never cleared. `setError` does clear `isLoading` via `setError: (error) => set({ error, isLoading: false })` at store line 220, so it actually _is_ cleared. Wait — checking `src/stores/unified-profile.store.ts:220`: `setError: (error) => set({ error, isLoading: false })`. So `setError` _does_ reset loading. This is not a bug for the loading state. However: `initializeUnifiedProfiles` (line 557) sets `store.setLoading(true)`, then if `checkMigrationNeeded()` succeeds and sets `needsMigration=true`, it skips `loadUnifiedProfiles()` and falls through to `store.setLoading(false)` at line 575 — OK. But if `checkMigrationNeeded` itself throws, `store.setError` at line 577 catches it. This path is clean. **Downgrading to Low:** the `setError` implementation correctly resets `isLoading`. Still, the pattern is misleading and easy to break if `setError` is ever refactored.

---

### M7: GitLab `handleDeleteIntegration` Error Path Is Silent — Severity: Medium

- **Where:** `src/components/dialogs/lv-gitlab-dialog.ts:1086–1087`
- **Evidence:**
  ```typescript
  } catch (err) {
    console.error('Failed to delete GitLab integration:', err);
    // No this.error = ..., no showToast(...)
  } finally {
    this.isLoading = false;
  }
  ```
- **Problem:** This is a direct CLAUDE.md violation: "Error paths must never be silent." If `deleteAccountToken` or `deleteGlobalAccount` throws — network error, keyring failure, backend crash — the user sees the spinner disappear and nothing else. The account may or may not have been deleted; the UI silently resets as if it succeeded. Contrast with the GitHub dialog's equivalent handler at `lv-github-dialog.ts:1408` which correctly sets `this.error`. The two sibling handlers are inconsistent, also violating the "all sibling handlers must follow the same pattern" rule.
- **Fix:** Replace `console.error(...)` with `this.error = err instanceof Error ? err.message : 'Failed to delete integration'` and add `showToast(this.error, 'error')`.

---

### M8: `unified_profiles.json` Stored as World-Readable Plaintext JSON Including `cachedUser` Email — Severity: Medium

- **Where:** `src-tauri/src/commands/unified_profiles.rs:82–94`
- **Evidence:**
  ```rust
  fn save_unified_profiles_config(config: &UnifiedProfilesConfig) -> Result<()> {
      let path = get_unified_profiles_path()?;
      let content = serde_json::to_string_pretty(config).map_err(...)?;
      fs::write(&path, content).map_err(...)?;
      Ok(())
  }
  ```
- **Problem:** The config file is written with `fs::write` using the default umask — typically `0o644` on Linux/macOS, making it readable by any user in the same group. The file contains `cachedUser.email`, display names, usernames, account IDs, and URL patterns for every connected integration. On a shared or multi-user system this is a privacy violation. The tokens themselves are in the keyring (good), but the metadata is not.
- **Fix:** Set file permissions explicitly after writing: use `std::os::unix::fs::PermissionsExt` to set mode `0o600`. On Windows, use `set_readonly` or ACL manipulation.

---

### M9: `discover_oidc_config` Fetches Arbitrary URLs from User-Supplied `issuerUrl` — SSRF — Severity: Medium

- **Where:** `src-tauri/src/services/oauth.rs:239–263`
- **Evidence:**
  ```rust
  pub async fn discover_oidc_config(issuer_url: &str) -> Result<OidcDiscovery, String> {
      let discovery_url = format!(
          "{}/.well-known/openid-configuration",
          issuer_url.trim_end_matches('/')
      );
      let client = reqwest::Client::new();
      let response = client.get(&discovery_url)...
  ```
- **Problem:** `issuer_url` is directly user-supplied from the frontend (the OIDC dialog's `instanceUrl` field) with no validation. This allows the Tauri backend to be used as a server-side request forgery proxy: a malicious or misconfigured input like `http://169.254.169.254/` (AWS IMDSv1), `file:///etc/passwd`, or `http://internal-host/` will cause the backend process to issue an HTTP request to an arbitrary target reachable from the host machine. Since this is a desktop app, the SSRF is self-SSRF — the attacker would need to control the UI, which limits severity — but it's still a design flaw. `reqwest` does not block `file://` schemes by default.
- **Fix:** Validate `issuer_url` against an allowlist of schemes (`https://` only) and reject RFC-1918 / loopback addresses. Use `url::Url::parse` to extract and validate the host.

---

### M10: Race Condition Between `deleteAccountToken` and `deleteGlobalAccount` — Token Orphan on Partial Failure — Severity: Low

- **Where:** `src/components/dialogs/lv-github-dialog.ts:1392–1393`, `src/components/dialogs/lv-gitlab-dialog.ts:1071–1072`
- **Evidence:**
  ```typescript
  await credentialService.deleteAccountToken('github', this.selectedAccountId);
  await unifiedProfileService.deleteGlobalAccount(this.selectedAccountId);
  ```
- **Problem:** These are two separate, non-atomic operations. If `deleteAccountToken` succeeds but `deleteGlobalAccount` fails (or vice versa), the system is left in a partially deleted state: the account record exists in `unified_profiles.json` but the token is gone from the keyring (or vice versa). On next load, the account will appear in the UI as "disconnected" with no way to re-authenticate it (token gone) and no indication of why. The user is left with a zombie account. Both dialogs have this pattern.
- **Fix:** Perform keyring deletion last (best-effort), since the config file entry is the source of truth for account existence. If the config delete fails, leave the keyring entry intact so the user can retry. Log failures but don't silently swallow them.

---

### M11: `OAuthState.pending` Map Is Populated But Never Read — CSRF State Not Validated — Severity: Low

- **Where:** `src-tauri/src/commands/oauth.rs:48–60`
- **Evidence:**
  ```rust
  pub struct OAuthState {
      #[allow(dead_code)]   // <-- the compiler itself is suspicious
      pending: Mutex<HashMap<String, PendingOAuthFlow>>,
  }
  ```
- **Problem:** The `pending` map is declared as `#[allow(dead_code)]` and is never read in any command handler. The `state` parameter returned to the frontend is cryptographically generated and included in the authorize URL, but the backend never validates that the `state` received in the callback matches what was issued. The OAuth loopback server extracts the code and returns it raw via `oauth_wait_for_callback` without checking the state parameter. CSRF protection is therefore decorative — the state string goes out, is never verified on the way back. This is low severity because it requires a local loopback intercept.
- **Fix:** Validate the `state` query parameter in the loopback callback against the stored value before returning the code. Remove `#[allow(dead_code)]` once the map is actually used.

---

**Confidence note:** M1 (GitHub App key never stored) is 100% confirmed — `get_github_app_config` returns `Ok(None)` at line 2429 and there is no keyring write after the JWT validation. M3 (macOS `-A` flag) is directly in the source at line 544, not a matter of interpretation. M6 was initially flagged as a loading-state leak but on secondary read `setError` resets `isLoading` at store line 220, so that specific sub-claim is retracted and the finding is downgraded; the remaining findings in that entry stand as a code clarity warning. All other findings are grounded in directly read code.
