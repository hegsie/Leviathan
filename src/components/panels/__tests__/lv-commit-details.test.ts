/**
 * Commit Details Panel Tests
 *
 * Tests error handling on loadFiles failure.
 */

import { expect, fixture, html } from '@open-wc/testing';
import { uiStore } from '../../../stores/ui.store.ts';
import type { Commit } from '../../../types/git.types.ts';

let failingCommands: Set<string> = new Set();
let mockFiles: unknown[] = [];
let cbId = 0;

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: 'Failed to get files' };
  }

  if (command === 'get_commit_files') {
    return mockFiles;
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
    mockFiles = [];
  });

  it('shows the previous path for a renamed file', async () => {
    mockFiles = [
      {
        path: 'src/new-name.ts',
        oldPath: 'src/old-name.ts',
        status: 'renamed',
        additions: 3,
        deletions: 1,
      },
    ];

    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).loadFiles();
    await el.updateComplete;

    const renamedFrom = el.shadowRoot!.querySelector('.file-renamed-from');
    expect(renamedFrom).to.not.be.null;
    expect(renamedFrom!.textContent).to.contain('src/old-name.ts');
  });

  it('renders with a commit', async () => {
    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );

    expect(el).to.not.be.null;
  });

  it('handles loadFiles failure gracefully', async () => {
    failingCommands.add('get_commit_files');

    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).loadFiles();

    // Files should remain empty after failure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).files).to.have.length(0);
    // Loading state should be cleared
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).loadingFiles).to.be.false;
  });

  it('shows an error message (not "No files changed") when loadFiles fails', async () => {
    failingCommands.add('get_commit_files');

    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).loadFiles();
    await el.updateComplete;

    // filesError state is set to the backend message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).filesError).to.contain('Failed to get files');

    // The error is rendered, and the misleading "No files changed" is NOT shown
    const errorNode = el.shadowRoot!.querySelector('.files-error');
    expect(errorNode).to.not.be.null;
    expect(errorNode!.textContent).to.contain('Failed to get files');

    const text = el.shadowRoot!.textContent ?? '';
    expect(text).to.not.contain('No files changed');
  });

  it('clears filesError and shows files on a subsequent successful load', async () => {
    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );

    // First load fails
    failingCommands.add('get_commit_files');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).loadFiles();
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).filesError).to.not.be.null;

    // Second load succeeds -> error must clear
    failingCommands.delete('get_commit_files');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).loadFiles();
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).filesError).to.be.null;
    expect(el.shadowRoot!.querySelector('.files-error')).to.be.null;
  });

  it('dispatches copy-sha after copying the full SHA', async () => {
    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );

    let received: { sha: string } | null = null;
    el.addEventListener('copy-sha', (e) => {
      received = (e as CustomEvent).detail;
    });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).copyFullSha();

    expect(received).to.not.be.null;
    expect(received!.sha).to.equal(mockCommit.oid.substring(0, 7));
  });

  it('shows an error toast when copying the SHA fails', async () => {
    uiStore.setState({ toasts: [] });

    const el = await fixture<LvCommitDetails>(
      html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${mockCommit}></lv-commit-details>`,
    );

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).copyFullSha();

    const toasts = uiStore.getState().toasts;
    expect(toasts.some((t) => t.type === 'error' && /copy sha/i.test(t.message))).to.be.true;
  });
});
