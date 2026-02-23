/**
 * Credential Service Multi-Account Tests
 *
 * Tests credential key format, account isolation logic, and simulated
 * storage isolation for the multi-account credential system.
 */

import { expect } from '@open-wc/testing';
import type { IntegrationType } from '../../types/integration-accounts.types.ts';

// Simulated credential storage using a Map
const credentialStorage = new Map<string, string>();

// Mock Tauri API with simulated storage
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  const params = args as Record<string, unknown> | undefined;

  if (command === 'plugin:stronghold|set_value') {
    const key = params?.key as string;
    const value = params?.value as string;
    credentialStorage.set(key, value);
    return null;
  }

  if (command === 'plugin:stronghold|get_value') {
    const key = params?.key as string;
    return credentialStorage.get(key) ?? null;
  }

  return null;
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    return mockInvoke(command, args);
  },
};

import {
  getAccountCredentialKey,
} from '../credential.service.ts';

describe('credential.service - Multi-Account Key Format and Isolation', () => {
  beforeEach(() => {
    credentialStorage.clear();
  });

  describe('getAccountCredentialKey', () => {
    it('produces different keys for two github accounts', () => {
      const key1 = getAccountCredentialKey('github', 'account-1');
      const key2 = getAccountCredentialKey('github', 'account-2');

      expect(key1).to.not.equal(key2);
    });

    it('produces different keys for different types with same account ID', () => {
      const githubKey = getAccountCredentialKey('github', 'shared-id');
      const gitlabKey = getAccountCredentialKey('gitlab', 'shared-id');

      expect(githubKey).to.not.equal(gitlabKey);
    });

    it('follows the format {type}_token_{id}', () => {
      const key = getAccountCredentialKey('github', 'abc-123');

      expect(key).to.equal('github_token_abc-123');
    });

    it('follows the format for gitlab type', () => {
      const key = getAccountCredentialKey('gitlab', 'xyz-456');

      expect(key).to.equal('gitlab_token_xyz-456');
    });

    it('follows the format for azure-devops type', () => {
      const key = getAccountCredentialKey('azure-devops', 'ado-789');

      expect(key).to.equal('azure-devops_token_ado-789');
    });

    it('follows the format for bitbucket type', () => {
      const key = getAccountCredentialKey('bitbucket', 'bb-101');

      expect(key).to.equal('bitbucket_token_bb-101');
    });

    it('does not collide with legacy key format (github_token without account ID)', () => {
      const legacyKey = 'github_token';
      const accountKey = getAccountCredentialKey('github', 'my-account');

      expect(accountKey).to.not.equal(legacyKey);
      // Legacy key is just "github_token", account key is "github_token_my-account"
      expect(accountKey.startsWith(legacyKey + '_')).to.be.true;
    });

    it('does not collide with legacy gitlab_token key', () => {
      const legacyKey = 'gitlab_token';
      const accountKey = getAccountCredentialKey('gitlab', 'my-account');

      expect(accountKey).to.not.equal(legacyKey);
    });

    it('does not collide with legacy azure_devops_token key', () => {
      const legacyKey = 'azure_devops_token';
      const accountKey = getAccountCredentialKey('azure-devops', 'my-account');

      expect(accountKey).to.not.equal(legacyKey);
    });

    it('generates consistent keys for the same input', () => {
      const key1 = getAccountCredentialKey('github', 'stable-id');
      const key2 = getAccountCredentialKey('github', 'stable-id');

      expect(key1).to.equal(key2);
    });
  });

  describe('Simulated storage isolation', () => {
    it('storing a token for account A does not affect account B', () => {
      const keyA = getAccountCredentialKey('github', 'account-A');
      const keyB = getAccountCredentialKey('github', 'account-B');

      // Store token for account A
      credentialStorage.set(keyA, 'token-for-A');

      // Account B should have no token
      expect(credentialStorage.has(keyB)).to.be.false;
      expect(credentialStorage.get(keyB)).to.be.undefined;

      // Account A should have its token
      expect(credentialStorage.get(keyA)).to.equal('token-for-A');
    });

    it('storing tokens for both accounts keeps them separate', () => {
      const keyA = getAccountCredentialKey('github', 'account-A');
      const keyB = getAccountCredentialKey('github', 'account-B');

      credentialStorage.set(keyA, 'token-A');
      credentialStorage.set(keyB, 'token-B');

      expect(credentialStorage.get(keyA)).to.equal('token-A');
      expect(credentialStorage.get(keyB)).to.equal('token-B');
    });

    it('deleting one account token does not affect another', () => {
      const keyA = getAccountCredentialKey('github', 'account-A');
      const keyB = getAccountCredentialKey('github', 'account-B');

      credentialStorage.set(keyA, 'token-A');
      credentialStorage.set(keyB, 'token-B');

      // Delete account A's token
      credentialStorage.delete(keyA);

      expect(credentialStorage.has(keyA)).to.be.false;
      expect(credentialStorage.get(keyB)).to.equal('token-B');
    });

    it('cross-type isolation: github and gitlab accounts with same ID are separate', () => {
      const githubKey = getAccountCredentialKey('github', 'same-id');
      const gitlabKey = getAccountCredentialKey('gitlab', 'same-id');

      credentialStorage.set(githubKey, 'github-token');
      credentialStorage.set(gitlabKey, 'gitlab-token');

      expect(credentialStorage.get(githubKey)).to.equal('github-token');
      expect(credentialStorage.get(gitlabKey)).to.equal('gitlab-token');
    });

    it('all four integration types produce isolated keys for same account ID', () => {
      const types: IntegrationType[] = ['github', 'gitlab', 'azure-devops', 'bitbucket'];
      const accountId = 'shared-account';

      const keys = types.map((type) => getAccountCredentialKey(type, accountId));

      // All keys should be unique
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).to.equal(types.length);

      // Store tokens for all
      keys.forEach((key, i) => {
        credentialStorage.set(key, `token-${types[i]}`);
      });

      // Verify each has its own value
      keys.forEach((key, i) => {
        expect(credentialStorage.get(key)).to.equal(`token-${types[i]}`);
      });
    });
  });
});
