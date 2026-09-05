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

    it('scoped clear removes only the target repo (and repo-independent) entries', () => {
      logGitCommand('checkout', '', true, '/repoA');
      logGitCommand('merge', '', true, '/repoB');
      logGitCommand('store_github_token', '', true); // repo-independent

      let notified = 0;
      const unsubscribe = subscribeOutputLog(() => {
        notified++;
      });

      // Clearing repo A must NOT destroy repo B's history.
      clearLogEntries('/repoA');
      expect(notified).to.equal(1);

      const remaining = getLogEntries();
      const commands = remaining.map((e) => e.command);
      expect(commands).to.include('merge'); // repo B kept
      expect(commands).to.not.include('checkout'); // repo A cleared
      // Repo-independent entries are cleared when scoped (documented choice).
      expect(commands).to.not.include('store_github_token');

      unsubscribe();
    });

    it('accepts a details object as well as a bare repo path', () => {
      logGitCommand('push', 'ok', true, {
        repoPath: '/repoA',
        gitCommand: 'git push origin main',
        synthesized: false,
        durationMs: 1234,
      });
      logGitCommand('merge', '', true, '/repoB');

      // Newest first.
      const [mergeEntry, pushEntry] = getLogEntries();
      expect(pushEntry.repoPath).to.equal('/repoA');
      expect(pushEntry.gitCommand).to.equal('git push origin main');
      expect(pushEntry.synthesized).to.be.false;
      expect(pushEntry.durationMs).to.equal(1234);

      // The original 4th-parameter shape still works.
      expect(mergeEntry.repoPath).to.equal('/repoB');
      expect(mergeEntry.gitCommand).to.equal(undefined);
    });

    it('zero-arg clear still empties everything (e2e/injected usage)', () => {
      logGitCommand('checkout', '', true, '/repoA');
      logGitCommand('merge', '', true, '/repoB');

      clearLogEntries();
      expect(getLogEntries().length).to.equal(0);
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
      // Args are still never dumped wholesale into the output field
      expect(entries[0].output).to.equal('');
      // The repository path IS recorded so multi-repo sessions can scope entries
      expect(entries[0].repoPath).to.equal('/repo');
    });

    it('records the equivalent git command line, marked as synthesised', async () => {
      await invokeCommand('checkout', { path: '/repo', refName: 'feature/x' });

      const entry = getLogEntries()[0];
      expect(entry.gitCommand).to.equal('git checkout feature/x');
      // git2 did the work — the panel must not imply the CLI ran
      expect(entry.synthesized).to.be.true;
      expect(entry.durationMs).to.be.a('number');
      expect(entry.durationMs).to.be.at.least(0);
    });

    it('records no git line for a command with no honest synthesis', async () => {
      await invokeCommand('start_auto_fetch', { path: '/repo' });

      const entry = getLogEntries()[0];
      expect(entry.command).to.equal('start_auto_fetch');
      expect(entry.gitCommand).to.equal(undefined);
      expect(entry.synthesized).to.be.false;
    });

    it('never puts a token into the synthesised line', async () => {
      await invokeCommand('push', {
        path: '/repo',
        remote: 'origin',
        branch: 'main',
        token: 'ghp_0123456789abcdefghij',
      });

      const entry = getLogEntries()[0];
      expect(entry.gitCommand).to.equal('git push origin main');
      expect(JSON.stringify(entry)).to.not.contain('ghp_');
    });

    it('redacts a credentialed URL echoed back in a backend error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'AUTH',
          message:
            'failed to push to https://user:ghp_0123456789abcdefghij@github.com/o/r.git',
        });

      await invokeCommand('push', { path: '/repo', remote: 'origin', branch: 'main' });

      const entry = getLogEntries()[0];
      expect(entry.success).to.be.false;
      expect(entry.output).to.not.contain('ghp_');
      expect(entry.output).to.contain('***@github.com/o/r.git');
    });

    it('scopes commands that pass the repo path as repoPath (e.g. stage_hunk)', async () => {
      // stage_hunk/unstage_hunk pass the repository path as `repoPath`, not `path`.
      // The entry must still be scoped to that repo so it shows only in that repo's
      // panel and is not destroyed by an unrelated repo's scoped Clear.
      await invokeCommand('stage_hunk', { repoPath: '/repoA', patch: 'diff' });

      const entries = getLogEntries();
      expect(entries.length).to.equal(1);
      expect(entries[0].command).to.equal('stage_hunk');
      expect(entries[0].repoPath).to.equal('/repoA');
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
