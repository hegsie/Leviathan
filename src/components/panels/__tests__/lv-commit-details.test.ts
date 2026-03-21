/**
 * Commit Details Panel Tests
 *
 * Tests error toast on loadFiles failure.
 */

import { expect, fixture, html } from '@open-wc/testing';
import type { Commit } from '../../../types/git.types.ts';

let failingCommands: Set<string> = new Set();
let cbId = 0;

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: 'Failed to get files' };
  }

  if (command === 'get_commit_files') {
    return [];
  }

  return null;
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// Import AFTER setting up the mock
import '../lv-commit-details.ts';
import type { LvCommitDetails } from '../lv-commit-details.ts';
import { uiStore } from '../../../stores/ui.store.ts';

const mockCommit: Commit = {
  oid: 'abc123def456',
  shortId: 'abc123d',
  summary: 'Test commit',
  message: 'Test commit',
  body: null,
  timestamp: Math.floor(Date.now() / 1000),
  author: { name: 'Test User', email: 'test@example.com', timestamp: Math.floor(Date.now() / 1000) },
  committer: { name: 'Test User', email: 'test@example.com', timestamp: Math.floor(Date.now() / 1000) },
  parentIds: [],
};

describe('lv-commit-details', () => {
  beforeEach(() => {
    failingCommands = new Set();
    const state = uiStore.getState();
    state.toasts.forEach(t => state.removeToast(t.id));
  });

  it('renders with a commit', async () => {
    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );

    expect(el).to.not.be.null;
  });

  it('shows error toast on loadFiles API failure', async () => {
    failingCommands.add('get_commit_files');

    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).loadFiles();

    const toasts = uiStore.getState().toasts;
    const errorToast = toasts.find(t => t.type === 'error');
    expect(errorToast).to.not.be.undefined;
    expect(errorToast!.message).to.include('Failed to load commit files');
  });
});
