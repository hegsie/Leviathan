/**
 * Unified Profile Service - Profile Default Account Tests
 *
 * Tests setProfileDefaultAccount and removeProfileDefaultAccount functions
 * including Tauri command invocation, store updates for default account
 * preferences, and error handling.
 */

import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeHistory: Array<{ command: string; args: unknown }> = [];

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import {
  setProfileDefaultAccount,
  removeProfileDefaultAccount,
} from '../unified-profile.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import type {
  UnifiedProfile,
  UnifiedProfilesConfig,
} from '../../types/unified-profile.types.ts';
import { PROFILE_COLORS } from '../../types/unified-profile.types.ts';

// Helper: create a test profile
function makeTestProfile(
  id: string,
  overrides: Partial<UnifiedProfile> = {}
): UnifiedProfile {
  return {
    id,
    name: overrides.name ?? `Profile ${id}`,
    gitName: overrides.gitName ?? 'Test User',
    gitEmail: overrides.gitEmail ?? 'test@example.com',
    signingKey: overrides.signingKey ?? null,
    urlPatterns: overrides.urlPatterns ?? [],
    isDefault: overrides.isDefault ?? false,
    color: overrides.color ?? PROFILE_COLORS[0],
    defaultAccounts: overrides.defaultAccounts ?? {},
  };
}

// Helper: set up the store with profiles
function setupStore(profiles: UnifiedProfile[]): void {
  const config: UnifiedProfilesConfig = {
    version: 3,
    profiles,
    accounts: [],
    repositoryAssignments: {},
  };
  unifiedProfileStore.getState().setConfig(config);
}

describe('unified-profile.service - setProfileDefaultAccount', () => {
  beforeEach(() => {
    unifiedProfileStore.getState().reset();
    invokeHistory.length = 0;

    // Default mock: all commands succeed
    mockInvoke = async (command: string) => {
      if (command === 'set_profile_default_account') {
        return null;
      }
      if (command === 'save_unified_profiles_config') {
        return null;
      }
      return null;
    };
  });

  it('invokes the set_profile_default_account Tauri command', async () => {
    const profile = makeTestProfile('profile-1');
    setupStore([profile]);

    await setProfileDefaultAccount('profile-1', 'github', 'acc-gh-1');

    const call = invokeHistory.find((h) => h.command === 'set_profile_default_account');
    expect(call).to.not.be.undefined;
    expect(call!.command).to.equal('set_profile_default_account');

    const args = call!.args as Record<string, unknown>;
    expect(args.profileId).to.equal('profile-1');
    expect(args.integrationType).to.equal('github');
    expect(args.accountId).to.equal('acc-gh-1');
  });

  it('updates store profile defaultAccounts for the given type', async () => {
    const profile = makeTestProfile('profile-1', { defaultAccounts: {} });
    setupStore([profile]);

    await setProfileDefaultAccount('profile-1', 'github', 'acc-gh-1');

    const updatedProfile = unifiedProfileStore.getState().profiles.find((p) => p.id === 'profile-1');
    expect(updatedProfile).to.not.be.undefined;
    expect(updatedProfile!.defaultAccounts.github).to.equal('acc-gh-1');
  });

  it('handles multiple integration types on the same profile', async () => {
    const profile = makeTestProfile('profile-1', { defaultAccounts: {} });
    setupStore([profile]);

    await setProfileDefaultAccount('profile-1', 'github', 'acc-gh-1');
    await setProfileDefaultAccount('profile-1', 'gitlab', 'acc-gl-1');

    const updatedProfile = unifiedProfileStore.getState().profiles.find((p) => p.id === 'profile-1');
    expect(updatedProfile).to.not.be.undefined;
    expect(updatedProfile!.defaultAccounts.github).to.equal('acc-gh-1');
    expect(updatedProfile!.defaultAccounts.gitlab).to.equal('acc-gl-1');
  });

  it('replaces existing default account for the same type', async () => {
    const profile = makeTestProfile('profile-1', {
      defaultAccounts: { github: 'old-acc-gh' },
    });
    setupStore([profile]);

    await setProfileDefaultAccount('profile-1', 'github', 'new-acc-gh');

    const updatedProfile = unifiedProfileStore.getState().profiles.find((p) => p.id === 'profile-1');
    expect(updatedProfile).to.not.be.undefined;
    expect(updatedProfile!.defaultAccounts.github).to.equal('new-acc-gh');
  });

  it('throws without store side effects on error', async () => {
    const profile = makeTestProfile('profile-1', {
      defaultAccounts: { github: 'original-acc' },
    });
    setupStore([profile]);

    mockInvoke = async (command: string) => {
      if (command === 'set_profile_default_account') {
        throw new Error('Failed to set profile default account');
      }
      return null;
    };

    let errorThrown = false;
    try {
      await setProfileDefaultAccount('profile-1', 'gitlab', 'acc-gl-1');
    } catch (error) {
      errorThrown = true;
      expect((error as Error).message).to.include('Failed to set profile default account');
    }

    expect(errorThrown).to.be.true;

    // Store should remain unchanged
    const unchangedProfile = unifiedProfileStore.getState().profiles.find((p) => p.id === 'profile-1');
    expect(unchangedProfile).to.not.be.undefined;
    expect(unchangedProfile!.defaultAccounts.github).to.equal('original-acc');
    expect(unchangedProfile!.defaultAccounts.gitlab).to.be.undefined;
  });
});

describe('unified-profile.service - removeProfileDefaultAccount', () => {
  beforeEach(() => {
    unifiedProfileStore.getState().reset();
    invokeHistory.length = 0;

    // Default mock: all commands succeed
    mockInvoke = async (command: string) => {
      if (command === 'remove_profile_default_account') {
        return null;
      }
      if (command === 'save_unified_profiles_config') {
        return null;
      }
      return null;
    };
  });

  it('invokes the remove_profile_default_account Tauri command', async () => {
    const profile = makeTestProfile('profile-1', {
      defaultAccounts: { github: 'acc-gh-1' },
    });
    setupStore([profile]);

    await removeProfileDefaultAccount('profile-1', 'github');

    const call = invokeHistory.find((h) => h.command === 'remove_profile_default_account');
    expect(call).to.not.be.undefined;
    expect(call!.command).to.equal('remove_profile_default_account');

    const args = call!.args as Record<string, unknown>;
    expect(args.profileId).to.equal('profile-1');
    expect(args.integrationType).to.equal('github');
  });

  it('removes the type from profile defaultAccounts in the store', async () => {
    const profile = makeTestProfile('profile-1', {
      defaultAccounts: { github: 'acc-gh-1' },
    });
    setupStore([profile]);

    await removeProfileDefaultAccount('profile-1', 'github');

    const updatedProfile = unifiedProfileStore.getState().profiles.find((p) => p.id === 'profile-1');
    expect(updatedProfile).to.not.be.undefined;
    expect(updatedProfile!.defaultAccounts.github).to.be.undefined;
  });

  it('preserves other types in defaultAccounts when removing one', async () => {
    const profile = makeTestProfile('profile-1', {
      defaultAccounts: {
        github: 'acc-gh-1',
        gitlab: 'acc-gl-1',
        'azure-devops': 'acc-ado-1',
      },
    });
    setupStore([profile]);

    await removeProfileDefaultAccount('profile-1', 'github');

    const updatedProfile = unifiedProfileStore.getState().profiles.find((p) => p.id === 'profile-1');
    expect(updatedProfile).to.not.be.undefined;
    expect(updatedProfile!.defaultAccounts.github).to.be.undefined;
    expect(updatedProfile!.defaultAccounts.gitlab).to.equal('acc-gl-1');
    expect(updatedProfile!.defaultAccounts['azure-devops']).to.equal('acc-ado-1');
  });

  it('throws without store side effects on error', async () => {
    const profile = makeTestProfile('profile-1', {
      defaultAccounts: { github: 'acc-gh-1', gitlab: 'acc-gl-1' },
    });
    setupStore([profile]);

    mockInvoke = async (command: string) => {
      if (command === 'remove_profile_default_account') {
        throw new Error('Failed to remove profile default account');
      }
      return null;
    };

    let errorThrown = false;
    try {
      await removeProfileDefaultAccount('profile-1', 'github');
    } catch (error) {
      errorThrown = true;
      expect((error as Error).message).to.include('Failed to remove profile default account');
    }

    expect(errorThrown).to.be.true;

    // Store should remain unchanged
    const unchangedProfile = unifiedProfileStore.getState().profiles.find((p) => p.id === 'profile-1');
    expect(unchangedProfile).to.not.be.undefined;
    expect(unchangedProfile!.defaultAccounts.github).to.equal('acc-gh-1');
    expect(unchangedProfile!.defaultAccounts.gitlab).to.equal('acc-gl-1');
  });
});
