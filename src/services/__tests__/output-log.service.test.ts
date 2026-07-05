import { expect } from '@open-wc/testing';

// Mock Tauri API before importing tauri-api.ts (same pattern as the other
// service tests): invokeCommand reads globalThis.__TAURI_INTERNALS__.invoke.
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
};

import {
  logGitCommand,
  getLogEntries,
  clearLogEntries,
  subscribeOutputLog,
  shouldLogToOutput,
} from '../output-log.service.ts';
import { invokeCommand } from '../tauri-api.ts';

describe('output-log.service', () => {
  beforeEach(() => {
    clearLogEntries();
    mockInvoke = () => Promise.resolve(null);
  });

  describe('log store', () => {
    it('records entries newest-first', () => {
      logGitCommand('first', '', true);
      logGitCommand('second', 'boom', false);

      const entries = getLogEntries();
      expect(entries.length).to.equal(2);
      expect(entries[0].command).to.equal('second');
      expect(entries[0].success).to.be.false;
      expect(entries[0].output).to.equal('boom');
      expect(entries[1].command).to.equal('first');
    });

    it('trims to 100 entries', () => {
      for (let i = 0; i < 105; i++) {
        logGitCommand(`cmd-${i}`, '', true);
      }
      const entries = getLogEntries();
      expect(entries.length).to.equal(100);
      expect(entries[0].command).to.equal('cmd-104');
    });

    it('clear empties the log and notifies subscribers', () => {
      let notified = 0;
      const unsubscribe = subscribeOutputLog(() => {
        notified++;
      });

      logGitCommand('checkout', '', true);
      expect(notified).to.equal(1);

      clearLogEntries();
      expect(getLogEntries().length).to.equal(0);
      expect(notified).to.equal(2);

      unsubscribe();
      logGitCommand('merge', '', true);
      expect(notified).to.equal(2); // no notification after unsubscribe
    });
  });

  describe('shouldLogToOutput', () => {
    it('logs state-changing commands', () => {
      expect(shouldLogToOutput('checkout')).to.be.true;
      expect(shouldLogToOutput('merge')).to.be.true;
      expect(shouldLogToOutput('push')).to.be.true;
      expect(shouldLogToOutput('create_stash')).to.be.true;
      expect(shouldLogToOutput('commit_merge')).to.be.true;
    });

    it('skips read queries and plumbing', () => {
      expect(shouldLogToOutput('get_commit_history')).to.be.false;
      expect(shouldLogToOutput('list_worktrees')).to.be.false;
      expect(shouldLogToOutput('check_bitbucket_connection')).to.be.false;
      expect(shouldLogToOutput('detect_conflict_markers')).to.be.false;
      expect(shouldLogToOutput('start_watching')).to.be.false;
      expect(shouldLogToOutput('store_keyring_token')).to.be.false;
      expect(shouldLogToOutput('plugin:event|listen')).to.be.false;
    });
  });

  describe('invokeCommand integration', () => {
    it('logs a successful state-changing command without its args', async () => {
      await invokeCommand('checkout', { path: '/repo', refName: 'main' });

      const entries = getLogEntries();
      expect(entries.length).to.equal(1);
      expect(entries[0].command).to.equal('checkout');
      expect(entries[0].success).to.be.true;
      // Args may carry credentials and must never appear in the log
      expect(entries[0].output).to.equal('');
      // The repository path IS recorded so multi-repo sessions can scope entries
      expect(entries[0].repoPath).to.equal('/repo');
    });

    it('leaves repoPath unset for repo-independent commands', async () => {
      await invokeCommand('store_github_token', { token: 'secret' });

      const entries = getLogEntries();
      expect(entries.length).to.equal(1);
      expect(entries[0].repoPath).to.equal(undefined);
      expect(entries[0].output).to.equal('');
    });

    it('logs a failed command with its error message', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'MERGE_CONFLICT', message: 'Merge conflict detected' });

      const result = await invokeCommand('merge', { path: '/repo', sourceRef: 'feature' });
      expect(result.success).to.be.false;

      const entries = getLogEntries();
      expect(entries.length).to.equal(1);
      expect(entries[0].command).to.equal('merge');
      expect(entries[0].success).to.be.false;
      expect(entries[0].output).to.equal('Merge conflict detected');
    });

    it('does not log read queries', async () => {
      await invokeCommand('get_commit_history', { path: '/repo' });
      await invokeCommand('check_bitbucket_connection');

      expect(getLogEntries().length).to.equal(0);
    });
  });
});
