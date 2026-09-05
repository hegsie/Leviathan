/**
 * Tests for opening repositories dropped onto the window.
 *
 * The webview's `tauri://drag-drop` event cannot be produced in this
 * environment, so the listener wiring is covered by the E2E suite (which can
 * emit backend events through the Tauri mock) and everything the drop DOES is
 * covered here, against the same handler the listener calls.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
const invokeCallArgs: Array<{ command: string; args: Record<string, unknown> }> = [];
const mockResponses: Record<string, (args: Record<string, unknown>) => unknown> = {};

let cbId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => {
    invokeCallArgs.push({ command, args: args || {} });
    const handler = mockResponses[command];
    try {
      return Promise.resolve(handler ? handler(args || {}) : null);
    } catch (err) {
      return Promise.reject(err);
    }
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';
import {
  handleDroppedPaths,
  offerDirectoryScan,
  REPOSITORY_SCAN_OFFER_EVENT,
} from '../window-drop.service.ts';
import { repositoryStore, uiStore } from '../../stores/index.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

function classification(
  path: string,
  overrides: Partial<{
    exists: boolean;
    isDirectory: boolean;
    isRepository: boolean;
    isBare: boolean;
  }> = {},
) {
  return {
    path,
    name: path.split('/').pop(),
    exists: true,
    isDirectory: true,
    isRepository: true,
    isBare: false,
    ...overrides,
  };
}

function mockRepoPayload(path: string) {
  return {
    path,
    name: path.split('/').pop(),
    isValid: true,
    isBare: false,
    headRef: 'main',
    state: 'clean',
    isShallow: false,
    isPartialClone: false,
    cloneFilter: null,
  };
}

/** Classify every path with the same shape unless `perPath` overrides it. */
function mockClassifications(perPath: Record<string, ReturnType<typeof classification>>): void {
  mockResponses['classify_repository_path'] = (args) => {
    const path = args.path as string;
    return perPath[path] ?? classification(path);
  };
}

function toastMessages(): string[] {
  return uiStore.getState().toasts.map((t) => t.message);
}

describe('window drop handler', () => {
  beforeEach(() => {
    invokeCallArgs.length = 0;
    for (const key of Object.keys(mockResponses)) {
      delete mockResponses[key];
    }
    uiStore.setState({ toasts: [] });
    repositoryStore.getState().reset();
    mockResponses['open_repository'] = (args) => mockRepoPayload(args.path as string);
  });

  it('opens a dropped repository and says so', async () => {
    mockClassifications({});

    const outcome = await handleDroppedPaths(['/repos/alpha']);

    expect(outcome.opened).to.deep.equal(['/repos/alpha']);
    const state = repositoryStore.getState();
    expect(state.openRepositories.length).to.equal(1);
    expect(state.openRepositories[0].repository.path).to.equal('/repos/alpha');
    const toasts = uiStore.getState().toasts;
    expect(toasts.length).to.equal(1);
    expect(toasts[0].type).to.equal('success');
    expect(toasts[0].message).to.contain('alpha');
  });

  it('offers a scan for a folder that is not a repository', async () => {
    mockClassifications({
      '/projects': classification('/projects', { isRepository: false }),
    });

    const offers: string[] = [];
    const listener = (e: Event) => offers.push((e as CustomEvent<{ path: string }>).detail.path);
    window.addEventListener(REPOSITORY_SCAN_OFFER_EVENT, listener);
    try {
      const outcome = await handleDroppedPaths(['/projects']);
      expect(outcome.notRepositories).to.deep.equal(['/projects']);
    } finally {
      window.removeEventListener(REPOSITORY_SCAN_OFFER_EVENT, listener);
    }

    expect(offers).to.deep.equal(['/projects']);
    expect(repositoryStore.getState().openRepositories.length).to.equal(0);
    // The offer dialog IS the feedback; a toast on top of it would be noise.
    expect(uiStore.getState().toasts.length).to.equal(0);
  });

  it('focuses the existing tab instead of opening a repository twice', async () => {
    mockClassifications({});
    await handleDroppedPaths(['/repos/alpha']);
    await handleDroppedPaths(['/repos/beta']);
    uiStore.setState({ toasts: [] });
    const openCallsBefore = invokeCallArgs.filter((c) => c.command === 'open_repository').length;

    const outcome = await handleDroppedPaths(['/repos/alpha']);

    expect(outcome.alreadyOpen).to.deep.equal(['/repos/alpha']);
    expect(outcome.opened).to.deep.equal([]);
    const state = repositoryStore.getState();
    expect(state.openRepositories.length).to.equal(2, 'no duplicate tab');
    expect(state.openRepositories[state.activeIndex].repository.path).to.equal('/repos/alpha');
    expect(
      invokeCallArgs.filter((c) => c.command === 'open_repository').length,
      'an already-open repository is not re-opened over IPC',
    ).to.equal(openCallsBefore);
    const toasts = uiStore.getState().toasts;
    expect(toasts.length).to.equal(1);
    expect(toasts[0].type).to.equal('info');
    expect(toasts[0].message).to.contain('already open');
  });

  it('handles a mixed drop: opens the repositories and reports the rest', async () => {
    mockClassifications({
      '/repos/beta': classification('/repos/beta', { isRepository: false }),
      '/repos/notes.txt': classification('/repos/notes.txt', {
        isDirectory: false,
        isRepository: false,
      }),
      '/repos/gone': classification('/repos/gone', {
        exists: false,
        isDirectory: false,
        isRepository: false,
      }),
    });

    const outcome = await handleDroppedPaths([
      '/repos/alpha',
      '/repos/gamma',
      '/repos/beta',
      '/repos/notes.txt',
      '/repos/gone',
    ]);

    expect(outcome.opened).to.deep.equal(['/repos/alpha', '/repos/gamma']);
    expect(outcome.notRepositories).to.deep.equal(['/repos/beta']);
    expect(outcome.files).to.deep.equal(['/repos/notes.txt']);
    expect(outcome.missing).to.deep.equal(['/repos/gone']);
    expect(repositoryStore.getState().openRepositories.length).to.equal(2);

    const messages = toastMessages();
    expect(messages.some((m) => m.includes('Opened 2 repositories'))).to.equal(true);
    expect(messages.some((m) => m.includes('no longer exists'))).to.equal(true);
    expect(messages.some((m) => m.includes('is a file'))).to.equal(true);
    expect(messages.some((m) => m.includes('not a Git repository'))).to.equal(true);
  });

  it('offers a scan from the toast when several folders are not repositories', async () => {
    mockClassifications({
      '/a': classification('/a', { isRepository: false }),
      '/b': classification('/b', { isRepository: false }),
    });

    await handleDroppedPaths(['/a', '/b']);

    const toasts = uiStore.getState().toasts;
    expect(toasts.length).to.equal(1);
    expect(toasts[0].message).to.contain('2 dropped folders');
    expect(toasts[0].action?.label).to.equal('Scan folder');

    const offers: string[] = [];
    const listener = (e: Event) => offers.push((e as CustomEvent<{ path: string }>).detail.path);
    window.addEventListener(REPOSITORY_SCAN_OFFER_EVENT, listener);
    try {
      toasts[0].action?.callback();
    } finally {
      window.removeEventListener(REPOSITORY_SCAN_OFFER_EVENT, listener);
    }
    expect(offers).to.deep.equal(['/a']);
  });

  it('reports a repository that cannot be opened', async () => {
    mockClassifications({});
    mockResponses['open_repository'] = () => {
      throw new Error('failed to open repository: permission denied');
    };

    const outcome = await handleDroppedPaths(['/repos/locked']);

    expect(outcome.failures.length).to.equal(1);
    expect(outcome.failures[0].message).to.contain('permission denied');
    expect(repositoryStore.getState().openRepositories.length).to.equal(0);
    const toasts = uiStore.getState().toasts;
    expect(toasts.length).to.equal(1);
    expect(toasts[0].type).to.equal('error');
    expect(toasts[0].message).to.contain('permission denied');
  });

  it('reports a path that could not even be inspected', async () => {
    mockResponses['classify_repository_path'] = () => {
      throw new Error('backend unavailable');
    };

    const outcome = await handleDroppedPaths(['/repos/alpha']);

    expect(outcome.failures.length).to.equal(1);
    expect(uiStore.getState().toasts[0].type).to.equal('error');
    expect(uiStore.getState().toasts[0].message).to.contain('backend unavailable');
  });

  it('does nothing for an empty drop', async () => {
    const outcome = await handleDroppedPaths([]);

    expect(outcome.opened).to.deep.equal([]);
    expect(uiStore.getState().toasts.length).to.equal(0);
    expect(invokeCallArgs.length).to.equal(0);
  });

  it('dispatches the scan offer on the window', () => {
    const offers: string[] = [];
    const listener = (e: Event) => offers.push((e as CustomEvent<{ path: string }>).detail.path);
    window.addEventListener(REPOSITORY_SCAN_OFFER_EVENT, listener);
    try {
      offerDirectoryScan('/somewhere');
    } finally {
      window.removeEventListener(REPOSITORY_SCAN_OFFER_EVENT, listener);
    }
    expect(offers).to.deep.equal(['/somewhere']);
  });
});
