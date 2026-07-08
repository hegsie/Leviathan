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

**No registration is required.** "Sign in with Microsoft" uses the OAuth 2.0
**device-code flow** with an embedded, well-known public client ID (the Visual
Studio client `872cd9fa-d31f-45e0-9eab-6e460a02d1f1`, which is multi-tenant and
pre-authorized for Azure DevOps). The user clicks the button, a short code is
shown, they approve it in the browser, and the app polls for the token — there is
**no redirect URI and no PKCE**, so nothing needs to be configured per deployment.

### Swapping in your own client ID (optional)
If you'd rather ship your own Entra app instead of the embedded one:

1. Go to [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID** →
   **App registrations** → **New registration**.
2. **Supported account types**: "Accounts in any organizational directory
   (Multitenant) and personal Microsoft accounts".
3. Under **Authentication** → **Advanced settings**, set **Allow public client
   flows** to **Yes** (required for the device-code flow). No redirect URI is needed.
4. Under **API permissions**, add **Azure DevOps → `user_impersonation`**.
5. Copy the **Application (client) ID** and set it as `azure` in `OAUTH_CLIENT_IDS`.

### Notes
- No admin consent is required for `user_impersonation`.
- The device-code flow needs no redirect URI, which is why the embedded public
  client works without Leviathan owning its app registration.

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
  azure: 'your-azure-application-client-id', // optional: defaults to the embedded Visual Studio public client (device-code flow)
  bitbucket: 'your-bitbucket-key',
};
```
