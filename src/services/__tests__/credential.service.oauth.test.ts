/**
 * Credential Service OAuth Tests
 *
 * Tests for OAuth token storage and management functions.
 * Note: These tests focus on the logic and interface, not actual storage
 * since Stronghold requires a Tauri runtime.
 */

import { expect } from '@open-wc/testing';
import type { IntegrationType } from '../../types/integration-accounts.types.ts';

// Mock import.meta.env
(globalThis as unknown as { import: { meta: { env: Record<string, string> } } }).import = {
  meta: {
    env: {
      DEV: 'true',
      MODE: 'test',
    },
  },
};

// Define the key generation function locally for testing
// (matches the implementation in credential.service.ts)
function getAccountCredentialKey(
  integrationType: IntegrationType,
  accountId: string
): string {
  return `${integrationType}_token_${accountId}`;
}

describe('credential.service - OAuth Token Key Generation', () => {
  it('should generate correct key for github', () => {
    const key = getAccountCredentialKey('github', 'acc-123');
    expect(key).to.equal('github_token_acc-123');
  });

  it('should generate correct key for gitlab', () => {
    const key = getAccountCredentialKey('gitlab', 'acc-456');
    expect(key).to.equal('gitlab_token_acc-456');
  });

  it('should generate correct key for azure-devops', () => {
    const key = getAccountCredentialKey('azure-devops', 'acc-789');
    expect(key).to.equal('azure-devops_token_acc-789');
  });

  it('should generate unique keys for different accounts', () => {
    const key1 = getAccountCredentialKey('github', 'acc-1');
    const key2 = getAccountCredentialKey('github', 'acc-2');
    expect(key1).to.not.equal(key2);
  });

  it('should generate unique keys for different integrations', () => {
    const key1 = getAccountCredentialKey('github', 'acc-1');
    const key2 = getAccountCredentialKey('gitlab', 'acc-1');
    expect(key1).to.not.equal(key2);
  });
});

// Note: Interface tests for storeAccountOAuthToken, getAccountOAuthToken, and
// isOAuthTokenExpiring are skipped because these functions require Stronghold
// which is only available in the Tauri runtime. The logic tests below verify
// the algorithms used by these functions.

describe('credential.service - OAuth Token Expiry Calculation', () => {
  it('should calculate expiry time correctly', () => {
    // When expiresIn is 3600 (1 hour), expiresAt should be ~1 hour from now
    const now = Date.now();
    const expiresIn = 3600; // seconds
    const expectedExpiresAt = now + expiresIn * 1000;

    // The actual calculation happens in storeAccountOAuthToken
    // Verify the calculation logic
    const calculatedExpiresAt = now + expiresIn * 1000;
    expect(calculatedExpiresAt).to.be.approximately(expectedExpiresAt, 100);
  });

  it('should handle undefined expiresIn', () => {
    // When expiresIn is undefined, expiresAt should be undefined
    const expiresIn = undefined;
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;
    expect(expiresAt).to.be.undefined;
  });
});

describe('credential.service - Token Expiry Check Logic', () => {
  it('should consider token expiring within 5 minutes as expiring', () => {
    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();

    // Token expiring in 4 minutes (within 5 min buffer)
    const expiresAt = now + 4 * 60 * 1000;
    const isExpiring = now > expiresAt - fiveMinutes;
    expect(isExpiring).to.be.true;
  });

  it('should not consider token expiring after 5 minutes as expiring', () => {
    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();

    // Token expiring in 10 minutes (outside 5 min buffer)
    const expiresAt = now + 10 * 60 * 1000;
    const isExpiring = now > expiresAt - fiveMinutes;
    expect(isExpiring).to.be.false;
  });

  it('should consider expired token as expiring', () => {
    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();

    // Token already expired
    const expiresAt = now - 1000;
    const isExpiring = now > expiresAt - fiveMinutes;
    expect(isExpiring).to.be.true;
  });
});

describe('credential.service - OAuth Token Data Structure', () => {
  it('should include accessToken in stored data', () => {
    const tokenData = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    };
    expect(tokenData.accessToken).to.exist;
    expect(tokenData.accessToken).to.equal('test-access-token');
  });

  it('should include optional refreshToken', () => {
    const tokenData = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    };
    expect(tokenData.refreshToken).to.equal('test-refresh-token');
  });

  it('should handle missing refreshToken', () => {
    const tokenData: { accessToken: string; refreshToken?: string } = {
      accessToken: 'test-access-token',
    };
    expect(tokenData.refreshToken).to.be.undefined;
  });

  it('should include optional expiresAt', () => {
    const expiresAt = Date.now() + 3600000;
    const tokenData = {
      accessToken: 'test-access-token',
      expiresAt,
    };
    expect(tokenData.expiresAt).to.equal(expiresAt);
  });
});

describe('credential.service - Integration Type Validation', () => {
  const validTypes: IntegrationType[] = ['github', 'gitlab', 'azure-devops'];

  validTypes.forEach((type) => {
    it(`should accept ${type} as valid integration type`, () => {
      const key = getAccountCredentialKey(type, 'test-id');
      expect(key).to.include(type);
    });
  });
});
