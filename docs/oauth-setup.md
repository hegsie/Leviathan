# OAuth App Setup Guide

This guide covers how to register OAuth applications with each integration provider. The client IDs are hardcoded in the app, so users don't need to configure anything.

## GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/applications/new)
2. Fill in:
   - **Application name**: Leviathan
   - **Homepage URL**: https://github.com/anthropics/leviathan (or your app's website)
   - **Authorization callback URL**: `http://127.0.0.1/callback`
     - GitHub's loopback redirect allows any port, so the app can dynamically allocate one
3. Click **Register application**
4. Copy the **Client ID** - this gets hardcoded in the app
5. **No client secret needed** - GitHub supports PKCE for public clients

### Notes
- GitHub automatically trusts any port on `127.0.0.1` for the callback, making loopback OAuth simple
- The app uses PKCE (Proof Key for Code Exchange) for secure authorization without a client secret

---

## GitLab OAuth Application

1. Go to [GitLab Applications](https://gitlab.com/-/user_settings/applications)
   - For self-hosted GitLab: `https://your-gitlab-instance/-/user_settings/applications`
2. Fill in:
   - **Name**: Leviathan
   - **Redirect URI**: `leviathan://oauth/gitlab/callback`
   - **Confidential**: **Unchecked** (this makes it a public client)
   - **Scopes**: Select `api` and `read_user`
3. Click **Save application**
4. Copy the **Application ID** - this gets hardcoded in the app

### Notes
- Users with self-hosted GitLab instances will need to register their own OAuth app on their instance
- The `api` scope provides full API access; `read_user` allows reading user profile info

---

## Azure DevOps (Microsoft Entra ID)

"Sign in with Microsoft" uses the OAuth 2.0 **authorization-code + PKCE flow** over
a **loopback redirect** — the same interactive flow as GitHub/GitLab — backed by a
registered multi-tenant Entra **public client** (`a1b13ec5-3f32-4ec7-b07f-5dfc5acbd2a8`).
The user clicks the button, signs in in the browser, and Entra redirects back to a
short-lived local loopback server that captures the code and exchanges it. This
interactive flow (unlike the earlier device-code flow) works under tenant
Conditional Access policies that block device-code sign-in.

The app requests the Azure DevOps `user_impersonation` scope (resource
`499b84ac-1321-427f-aa17-267ca6975798`) plus `offline_access` (for refresh) under
the `organizations` authority by default.

### Registering your own Entra app
The embedded client is a public client, so no per-user setup is required. To ship
your own Entra app instead:

1. Go to [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID** →
   **App registrations** → **New registration**.
2. **Supported account types**: "Accounts in any organizational directory
   (Any Microsoft Entra ID tenant — Multitenant)".
3. Under **Authentication** → **Add a platform** → **Mobile and desktop
   applications**, add the redirect URI **`http://localhost/callback`**.
   - Use `localhost`, **not** `127.0.0.1`: Entra ignores the port only for a
     `localhost` loopback redirect, and the app allocates its loopback port
     dynamically. A single `http://localhost/callback` entry therefore matches
     every port. (If the portal blocks the `http` loopback URI, add it via the
     app manifest's `replyUrlsWithType` instead.)
4. Under **Authentication** → **Advanced settings**, set **Allow public client
   flows** to **Yes** (enables the public-client PKCE flow).
5. Under **API permissions**, add **Azure DevOps → `user_impersonation`**. Grant
   admin consent for the tenant only if your tenant restricts user consent
   (users can otherwise self-consent to this delegated scope on first sign-in).
6. Copy the **Application (client) ID** and set it as `azure` in `OAUTH_CLIENT_IDS`.

### Notes
- The registered redirect URI must be `http://localhost/callback` (loopback,
  port-agnostic). The loopback server binds `127.0.0.1` and, best-effort, the
  IPv6 loopback `[::1]` on the same port, so the callback lands whether
  `localhost` resolves to the IPv4 or IPv6 loopback (e.g. `::1` first on Windows).
- `user_impersonation` is a delegated scope users can normally self-consent to
  on first sign-in; tenant admin consent is only required if the tenant
  restricts user consent.

---

## Bitbucket OAuth Consumer

1. Go to your Bitbucket workspace settings:
   `https://bitbucket.org/YOUR_WORKSPACE/workspace/settings/oauth-consumers/new`
2. Fill in:
   - **Name**: Leviathan
   - **Callback URL**: `leviathan://oauth/bitbucket/callback`
   - **This is a private consumer**: **Unchecked** (makes it a public client)
   - **Permissions**:
     - Account: Read
     - Repositories: Read, Write
     - Pull requests: Read, Write
3. Click **Save**
4. Copy the **Key** (this is the client ID) - this gets hardcoded in the app

### Notes
- Bitbucket OAuth consumers are workspace-specific
- The "Key" is the client ID, and "Secret" is the client secret (not needed for public clients with PKCE)

---

## Updating the Hardcoded Client IDs

After registering the OAuth apps, update the client IDs in:

```
src/services/oauth.service.ts
```

Look for the `OAUTH_CLIENT_IDS` object near the top of the file:

```typescript
const OAUTH_CLIENT_IDS: Record<OAuthProvider, string> = {
  github: 'your-github-client-id',
  gitlab: 'your-gitlab-application-id',
  azure: 'your-azure-application-client-id', // optional: defaults to the embedded Leviathan multi-tenant public client (auth-code + loopback)
  bitbucket: 'your-bitbucket-key',
};
```
