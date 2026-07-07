/**
 * Watcher Service Tests
 *
 * Tests for file watcher service using invokeCommand wrapper.
 */

import { expect } from '@open-wc/testing';

const invokeCallArgs: Array<{ command: string; args: Record<string, unknown> }> = [];
let shouldFail = false;

let callbackId = 0;

const mockInvoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  invokeCallArgs.push({ command, args: args || {} });

  if (shouldFail) {
    return Promise.reject('Backend error');
  }

  switch (command) {
    case 'start_watching':
    case 'stop_watching':
      return Promise.resolve(null);
    case 'plugin:event|listen':
      return Promise.resolve(null);
    default:
      return Promise.resolve(null);
  }
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
  transformCallback: (_callback: unknown, _once?: boolean) => {
    return callbackId++;
  },
};

import { startWatching, stopWatching, onFileChange, cleanup } from '../watcher.service.ts';

describe('watcher.service', () => {
  beforeEach(() => {
    invokeCallArgs.length = 0;
    shouldFail = false;
  });

  afterEach(async () => {
    // Note: cleanup calls stopWatching which invokes the backend
    // Don't clean up here to avoid double-invoke issues in tests
  });

  // NOTE: this block must run FIRST — the module registers its (single)
  // Tauri listener on the first successful startWatching, so listener-count
  // assertions are only meaningful before other tests trigger it.
  describe('shared listener registration', () => {
    function listenRegistrations(): number {
      return invokeCallArgs.filter(
        (c) => c.command === 'plugin:event|listen' && c.args.event === 'file-change'
      ).length;
    }

    it('registers exactly ONE file-change listener across concurrent startWatching calls', async () => {
      // Regression: startup restore watches N repos back-to-back; a
      // non-atomic `if (!unlisten)` check let every call register its own
      // listener, leaking N-1 of them and dispatching every event N times.
      await Promise.all([
        startWatching('/repo/one'),
        startWatching('/repo/two'),
        startWatching('/repo/three'),
      ]);

      expect(listenRegistrations()).to.equal(1);

      // Each repo still gets its own backend watcher
      const watched = invokeCallArgs
        .filter((c) => c.command === 'start_watching')
        .map((c) => c.args.path);
      expect(watched).to.have.members(['/repo/one', '/repo/two', '/repo/three']);
    });

    it('does not register another listener on later startWatching calls', async () => {
      await startWatching('/repo/four');
      expect(listenRegistrations()).to.equal(0); // registered in the previous test
    });
  });

  describe('startWatching', () => {
    it('should invoke start_watching with the path', async () => {
      await startWatching('/path/to/repo');

      const call = invokeCallArgs.find((c) => c.command === 'start_watching');
      expect(call).to.not.be.undefined;
      expect(call!.args.path).to.equal('/path/to/repo');
    });

    it('should throw on backend error', async () => {
      shouldFail = true;

      try {
        await startWatching('/path/to/repo');
        expect.fail('Should have thrown');
      } catch (e) {
        // invokeCommand wraps the rejection message
        expect((e as Error).message).to.be.a('string');
      }
    });
  });

  describe('stopWatching', () => {
    it('should invoke stop_watching', async () => {
      await stopWatching();

      const call = invokeCallArgs.find((c) => c.command === 'stop_watching');
      expect(call).to.not.be.undefined;
    });

    it('should pass the specific path when given one', async () => {
      await stopWatching('/repo/one');

      const call = invokeCallArgs.find((c) => c.command === 'stop_watching');
      expect(call!.args.path).to.equal('/repo/one');
    });

    it('should pass null (stop all) when called without a path', async () => {
      await stopWatching();

      const call = invokeCallArgs.find((c) => c.command === 'stop_watching');
      expect(call!.args.path).to.equal(null);
    });

    it('should throw on backend error', async () => {
      shouldFail = true;

      try {
        await stopWatching();
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).to.be.a('string');
      }
    });
  });

  describe('onFileChange', () => {
    it('should register and unregister handlers', () => {
      let callCount = 0;
      const unsubscribe = onFileChange(() => {
        callCount++;
      });

      expect(typeof unsubscribe).to.equal('function');
      unsubscribe();
      // Handler was removed, callCount should stay 0
      expect(callCount).to.equal(0);
    });
  });
});
