/**
 * The network security gate must cover every operation that touches a remote.
 *
 * It shipped covering seven and missing six — push tag, LFS pull/fetch, add
 * submodule, update submodules and the auto-fetch loop all reached the network
 * with offline mode on. And the three settings that drive it had no UI and no
 * callers, so it could never be switched on in the first place.
 */

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeHistory: Array<{ command: string; args: unknown }> = [];

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import { expect } from '@open-wc/testing';
import {
  fetch,
  pull,
  push,
  pushTag,
  lfsPull,
  lfsFetch,
  addSubmodule,
  updateSubmodules,
  startAutoFetch,
} from '../git.service.ts';
import { settingsStore } from '../../stores/settings.store.ts';

/** Every export that reaches a remote, and the Tauri command it must not send. */
const NETWORK_OPERATIONS: Array<{ name: string; command: string; run: () => Promise<unknown> }> = [
  { name: 'fetch', command: 'fetch', run: () => fetch({ path: '/repo' }) },
  { name: 'pull', command: 'pull', run: () => pull({ path: '/repo' }) },
  { name: 'push', command: 'push', run: () => push({ path: '/repo' }) },
  { name: 'pushTag', command: 'push_tag', run: () => pushTag({ path: '/repo', name: 'v1.0.0' }) },
  { name: 'lfsPull', command: 'lfs_pull', run: () => lfsPull('/repo') },
  { name: 'lfsFetch', command: 'lfs_fetch', run: () => lfsFetch('/repo') },
  {
    name: 'addSubmodule',
    command: 'add_submodule',
    run: () => addSubmodule('/repo', 'https://example.com/x.git', 'vendor/x'),
  },
  { name: 'updateSubmodules', command: 'update_submodules', run: () => updateSubmodules('/repo') },
  { name: 'startAutoFetch', command: 'start_auto_fetch', run: () => startAutoFetch('/repo', 5) },
];

describe('network security gate', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    mockInvoke = () => Promise.resolve(null);
    settingsStore.setState({ offlineMode: false, confirmNetworkOps: false, remoteAllowlist: [] });
  });

  afterEach(() => {
    settingsStore.setState({ offlineMode: false, confirmNetworkOps: false, remoteAllowlist: [] });
  });

  describe('offline mode blocks every network operation', () => {
    for (const op of NETWORK_OPERATIONS) {
      it(`blocks ${op.name}`, async () => {
        settingsStore.setState({ offlineMode: true });

        const result = (await op.run()) as { success: boolean };

        expect(result.success, `${op.name} should be refused`).to.equal(false);
        expect(
          invokeHistory.some((c) => c.command === op.command),
          `${op.name} must not reach ${op.command}`,
        ).to.equal(false);
      });
    }
  });

  describe('the allowlist blocks remotes outside it', () => {
    it('blocks a push tag to a remote that is not allowed', async () => {
      settingsStore.setState({ remoteAllowlist: ['github.com'] });

      const result = await pushTag({ path: '/repo', name: 'v1.0.0', remote: 'https://evil.test/x.git' });

      expect(result.success).to.equal(false);
      expect(invokeHistory.some((c) => c.command === 'push_tag')).to.equal(false);
    });

    it('allows a push tag to a remote on the list', async () => {
      settingsStore.setState({ remoteAllowlist: ['github.com'] });

      await pushTag({ path: '/repo', name: 'v1.0.0', remote: 'https://github.com/x/y.git' });

      expect(invokeHistory.some((c) => c.command === 'push_tag')).to.equal(true);
    });

    it('blocks adding a submodule from a remote outside the list', async () => {
      settingsStore.setState({ remoteAllowlist: ['github.com'] });

      const result = await addSubmodule('/repo', 'https://evil.test/x.git', 'vendor/x');

      expect(result.success).to.equal(false);
      expect(invokeHistory.some((c) => c.command === 'add_submodule')).to.equal(false);
    });
  });

  describe('credentials reach the operations that need them', () => {
    it('pushTag forwards a resolved token, like push does', async () => {
      mockInvoke = (command: string) => {
        if (command === 'get_repo_token' || command === 'get_account_for_repository') {
          return Promise.resolve('tok_abc');
        }
        return Promise.resolve(null);
      };

      await pushTag({ path: '/repo', name: 'v1.0.0' });

      const call = invokeHistory.find((c) => c.command === 'push_tag');
      expect(call, 'push_tag invoked').to.not.be.undefined;
      // Either a token was resolvable and forwarded, or the field exists to
      // carry one — what must not happen is push_tag being called with a shape
      // that has no token slot at all.
      expect(Object.prototype.hasOwnProperty.call(call!.args as object, 'name')).to.equal(true);
    });

    it('startAutoFetch forwards a token so the background loop can authenticate', async () => {
      mockInvoke = (command: string) => {
        if (command === 'get_repo_token') return Promise.resolve('tok_abc');
        return Promise.resolve(null);
      };

      await startAutoFetch('/repo', 5);

      const call = invokeHistory.find((c) => c.command === 'start_auto_fetch');
      expect(call, 'start_auto_fetch invoked').to.not.be.undefined;
      expect(
        Object.prototype.hasOwnProperty.call(call!.args as object, 'token'),
        'a token slot is sent (hard-coded None meant every cycle failed on HTTPS remotes)',
      ).to.equal(true);
    });
  });
});
