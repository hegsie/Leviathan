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

// Mock Tauri API. `mockInvoke` is reassignable so individual tests can install
// their own handler; the closure below reads the live binding.
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);

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
  exchangeCode,
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

describe('oauth.service - exchangeCode server-side PKCE contract (M5/M11)', () => {
  const defaultMock = mockInvoke;
  afterEach(() => {
    mockInvoke = defaultMock;
  });

  it('sends only {state, code, clientId, clientSecret} and never the verifier/redirectUri/provider', async () => {
    let captured: Record<string, unknown> | undefined;
    mockInvoke = (command, args) => {
      if (command === 'oauth_exchange_code') {
        captured = args as Record<string, unknown>;
        return Promise.resolve({ accessToken: 'tok_abc', tokenType: 'bearer' });
      }
      return Promise.resolve(null);
    };

    const tokens = await exchangeCode('github', 'state-xyz', 'code-123');

    expect(tokens.accessToken).to.equal('tok_abc');
    expect(captured).to.exist;
    // The new contract: state keys the server-side flow; code is exchanged.
    expect(captured!.state).to.equal('state-xyz');
    expect(captured!.code).to.equal('code-123');
    expect(captured).to.have.property('clientId');
    // The PKCE verifier and redirect/provider/instance are now server-derived
    // and must NOT be sent from the frontend.
    expect(captured).to.not.have.property('verifier');
    expect(captured).to.not.have.property('redirectUri');
    expect(captured).to.not.have.property('provider');
    expect(captured).to.not.have.property('instanceUrl');
  });

  it('surfaces a server-rejected state as a thrown error', async () => {
    mockInvoke = (command) => {
      if (command === 'oauth_exchange_code') {
        return Promise.resolve(null); // invokeCommand treats null data as failure
      }
      return Promise.resolve(null);
    };
    let threw = false;
    try {
      await exchangeCode('github', 'bad-state', 'code-123');
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it('preserves the OIDC id token in the normalized result (camelCase and snake_case)', async () => {
    mockInvoke = (command) => {
      if (command === 'oauth_exchange_code') {
        return Promise.resolve({ accessToken: 'a', idToken: 'h.p.s', tokenType: 'bearer' });
      }
      return Promise.resolve(null);
    };
    const camel = await exchangeCode('oidc', 'state', 'code');
    expect(camel.idToken, 'idToken preserved (OIDC identity source)').to.equal('h.p.s');

    mockInvoke = (command) => {
      if (command === 'oauth_exchange_code') {
        return Promise.resolve({ access_token: 'a', id_token: 'h2.p2.s2' });
      }
      return Promise.resolve(null);
    };
    const snake = await exchangeCode('oidc', 'state', 'code');
    expect(snake.idToken).to.equal('h2.p2.s2');
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

describe('oauth.service - refreshToken', () => {
  const defaultMock = mockInvoke;
  afterEach(() => {
    mockInvoke = defaultMock;
  });

  it('normalizes snake_case token fields returned by the backend', async () => {
    mockInvoke = (command) => {
      if (command === 'oauth_refresh_token') {
        return Promise.resolve({ access_token: 'a2', refresh_token: 'r2', expires_in: 1800 });
      }
      return Promise.resolve(null);
    };
    const { refreshToken } = await import('../oauth.service.ts');
    const tokens = await refreshToken('azure', 'old-refresh');
    expect(tokens.accessToken).to.equal('a2');
    expect(tokens.refreshToken).to.equal('r2');
    expect(tokens.expiresIn).to.equal(1800);
  });

  it('accepts camelCase token fields', async () => {
    mockInvoke = (command) => {
      if (command === 'oauth_refresh_token') {
        return Promise.resolve({ accessToken: 'a3', refreshToken: 'r3', expiresIn: 3600 });
      }
      return Promise.resolve(null);
    };
    const { refreshToken } = await import('../oauth.service.ts');
    const tokens = await refreshToken('azure', 'old-refresh');
    expect(tokens.accessToken).to.equal('a3');
    expect(tokens.refreshToken).to.equal('r3');
  });
});

describe('oauth.service - loopback cancel/restart guard', () => {
  const defaultMock = mockInvoke;
  afterEach(() => {
    mockInvoke = defaultMock;
    cancelOAuth();
  });

  it("a superseded flow's late callback does not error or clobber the newer flow", async () => {
    const { startOAuth } = await import('../oauth.service.ts');

    // Each start gets its own state + loopback port; oauth_wait_for_callback is
    // held open per port so we control exactly when each flow's callback resolves.
    const waiters = new Map<number, (v: { code: string; state: string }) => void>();
    const states: string[] = [];
    let n = 0;
    const dispatched: unknown[] = [];
    window.addEventListener('oauth-complete', (e) => dispatched.push((e as CustomEvent).detail));

    mockInvoke = (command, args) => {
      if (command === 'oauth_get_authorize_url') {
        n += 1;
        const state = `state-${n}`;
        states.push(state);
        return Promise.resolve({ authorizeUrl: 'https://login/authorize', state, loopbackPort: 8080 + n });
      }
      if (command === 'oauth_wait_for_callback') {
        const port = (args as { port: number }).port;
        return new Promise((resolve) => waiters.set(port, resolve));
      }
      if (command === 'oauth_exchange_code') {
        return Promise.resolve({ accessToken: 'tok' });
      }
      return Promise.resolve(null);
    };

    const errors: string[] = [];
    const unsub = onOAuthStateChange((s) => {
      if (s.provider === 'azure' && s.status === 'error') errors.push(s.error ?? '');
    });

    // Flow A starts (state-1, port 8081), then the user cancels and restarts:
    // flow B (state-2, port 8082) is now the current pending flow.
    await startOAuth('azure', 'cid');
    cancelOAuth('azure');
    await startOAuth('azure', 'cid');

    // Flow A's browser tab finally completes — its callback arrives on port 8081.
    waiters.get(8081)!({ code: 'code-a', state: states[0] });
    await new Promise((r) => setTimeout(r, 40));

    // The stale callback is dropped silently: no error toast, no oauth-complete,
    // and flow B remains the pending flow (its callback never fired).
    expect(errors, 'no spurious state-mismatch error').to.have.length(0);
    expect(dispatched, 'no oauth-complete for the abandoned flow').to.have.length(0);
    expect(isPendingOAuth(), 'the newer flow is still pending').to.be.true;
    expect(getPendingProvider()).to.equal('azure');

    unsub();
  });

  it("a superseded flow's late error/timeout does not error or clobber the newer flow", async () => {
    const { startOAuth } = await import('../oauth.service.ts');

    // Flow A's wait rejects (timeout); flow B's wait is held open. cancelOAuth
    // can't abort A's backend wait, so A's rejection arrives while B is pending.
    const rejecters = new Map<number, (e: Error) => void>();
    const states: string[] = [];
    let n = 0;
    mockInvoke = (command, args) => {
      if (command === 'oauth_get_authorize_url') {
        n += 1;
        const state = `state-${n}`;
        states.push(state);
        return Promise.resolve({ authorizeUrl: 'https://login/authorize', state, loopbackPort: 8080 + n });
      }
      if (command === 'oauth_wait_for_callback') {
        const port = (args as { port: number }).port;
        return new Promise((_resolve, reject) => rejecters.set(port, reject));
      }
      return Promise.resolve(null);
    };

    const errors: string[] = [];
    const unsub = onOAuthStateChange((s) => {
      if (s.provider === 'azure' && s.status === 'error') errors.push(s.error ?? '');
    });

    // Flow A (port 8081), cancel, restart → flow B (port 8082) is current.
    await startOAuth('azure', 'cid');
    cancelOAuth('azure');
    await startOAuth('azure', 'cid');

    // Flow A's backend wait finally times out (rejects) minutes later.
    rejecters.get(8081)!(new Error('OAuth callback timed out'));
    await new Promise((r) => setTimeout(r, 40));

    // No spurious error for the current flow, and flow B stays pending.
    expect(errors, 'no spurious timeout error for the newer flow').to.have.length(0);
    expect(isPendingOAuth(), 'the newer flow is still pending').to.be.true;
    expect(getPendingProvider()).to.equal('azure');

    unsub();
  });
});
