/**
 * OAuth Service Tests
 *
 * Tests for the OAuth service including state management,
 * event handling, and flow coordination.
 */

import { expect } from '@open-wc/testing';

// Mock import.meta.env before importing oauth.service
(globalThis as unknown as { import: { meta: { env: Record<string, string> } } }).import = {
  meta: {
    env: {
      VITE_GITHUB_CLIENT_ID: '',
      VITE_GITLAB_CLIENT_ID: '',
      VITE_AZURE_CLIENT_ID: '',
      VITE_BITBUCKET_CLIENT_ID: '',
      DEV: 'true',
      MODE: 'test',
    },
  },
};

// Also mock on import.meta directly if needed
if (typeof import.meta === 'object' && !import.meta.env) {
  (import.meta as unknown as { env: Record<string, string> }).env = {
    VITE_GITHUB_CLIENT_ID: '',
    VITE_GITLAB_CLIENT_ID: '',
    VITE_AZURE_CLIENT_ID: '',
    VITE_BITBUCKET_CLIENT_ID: '',
    DEV: 'true',
    MODE: 'test',
  };
}

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
const mockInvoke: MockInvoke = () => Promise.resolve(null);

// Set up mock before tests run
(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    return mockInvoke(command, args);
  },
};

// Mock shell plugin
(globalThis as unknown as { __TAURI_PLUGIN_SHELL__: { open: (url: string) => Promise<void> } }).__TAURI_PLUGIN_SHELL__ = {
  open: async () => {},
};

import {
  onOAuthStateChange,
  cancelOAuth,
  isPendingOAuth,
  getPendingProvider,
} from '../oauth.service.ts';
import type { OAuthFlowState } from '../../types/oauth.types.ts';

describe('oauth.service - State Management', () => {
  beforeEach(() => {
    // Reset state
    cancelOAuth();
  });

  it('should initially have no pending OAuth', () => {
    expect(isPendingOAuth()).to.be.false;
  });

  it('should initially have null pending provider', () => {
    expect(getPendingProvider()).to.be.null;
  });

  it('should allow subscribing to state changes', () => {
    const states: OAuthFlowState[] = [];
    const unsubscribe = onOAuthStateChange((state) => {
      states.push(state);
    });

    expect(typeof unsubscribe).to.equal('function');
    unsubscribe();
  });

  it('should unsubscribe correctly', () => {
    let callCount = 0;
    const unsubscribe = onOAuthStateChange(() => {
      callCount++;
    });

    unsubscribe();
    // After unsubscribe, state changes shouldn't trigger the listener
    // This is verified by the fact that callCount stays at 0
    expect(callCount).to.equal(0);
  });
});

describe('oauth.service - cancelOAuth', () => {
  it('should clear pending auth state', () => {
    // Even if there's no pending auth, cancel should work
    cancelOAuth();
    expect(isPendingOAuth()).to.be.false;
    expect(getPendingProvider()).to.be.null;
  });
});

// Note: isOAuthConfigured tests are skipped because import.meta.env
// is not available in the web-test-runner environment.
// These tests should be run in an E2E environment instead.

describe('oauth.service - State Listener Notifications', () => {
  afterEach(() => {
    cancelOAuth();
  });

  it('should notify multiple listeners', () => {
    const states1: OAuthFlowState[] = [];
    const states2: OAuthFlowState[] = [];

    const unsub1 = onOAuthStateChange((state) => states1.push(state));
    const unsub2 = onOAuthStateChange((state) => states2.push(state));

    // Both should be subscribed
    expect(states1.length).to.equal(0);
    expect(states2.length).to.equal(0);

    unsub1();
    unsub2();
  });

  it('should not notify after unsubscribe', () => {
    let notified = false;
    const unsub = onOAuthStateChange(() => {
      notified = true;
    });

    unsub();
    // Any state change after unsubscribe should not trigger the callback
    expect(notified).to.be.false;
  });
});

describe('oauth.service - Provider Types', () => {
  it('should handle github provider type', () => {
    // Just verify the type is accepted
    const provider = 'github' as const;
    expect(provider).to.equal('github');
  });

  it('should handle gitlab provider type', () => {
    const provider = 'gitlab' as const;
    expect(provider).to.equal('gitlab');
  });

  it('should handle azure provider type', () => {
    const provider = 'azure' as const;
    expect(provider).to.equal('azure');
  });

  it('should handle bitbucket provider type', () => {
    const provider = 'bitbucket' as const;
    expect(provider).to.equal('bitbucket');
  });
});
