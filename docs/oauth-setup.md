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

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to **Microsoft Entra ID** → **App registrations** → **New registration**
3. Fill in:
   - **Name**: Leviathan
   - **Supported account types**: "Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts"
   - **Redirect URI**:
     - Platform: **Public client/native (mobile & desktop)**
     - URI: `leviathan://oauth/azure/callback`
4. Click **Register**
5. After creation, go to **API permissions**:
   - Click **Add a permission**
   - Select **Azure DevOps**
   - Check `user_impersonation`
   - Click **Add permissions**
6. Copy the **Application (client) ID** - this gets hardcoded in the app

### Notes
- No admin consent is required for `user_impersonation`
- The app uses PKCE for secure authorization
- Microsoft's redirect URI validation requires exact matches, so ensure the URI is correct

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
  azure: 'your-azure-application-client-id',
  bitbucket: 'your-bitbucket-key',
};
```
