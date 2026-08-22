/**
 * git.service — late remote-operation completions
 *
 * `tokio::time::timeout` only DROPS the future it wraps; the `spawn_blocking`
 * task doing the pull/push keeps running. The backend now reports those late
 * landings with `late: true` and the repository they actually changed, because
 * the caller that would normally refresh returned an error minutes earlier.
 * These tests pin what the UI does with such an event.
 */

import { expect } from '@open-wc/testing';

/** Handlers registered through `listen`, by event name. */
const listeners = new Map<string, (e: { event: string; id: number; payload: unknown }) => void>();
const callbacks = new Map<number, (payload: unknown) => void>();
let nextId = 1;

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  transformCallback: (cb: (payload: unknown) => void) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  },
  invoke: (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command === 'plugin:event|listen') {
      const event = args?.event as string;
      const handler = callbacks.get(args?.handler as number);
      if (handler) {
        listeners.set(
          event,
          handler as (e: { event: string; id: number; payload: unknown }) => void,
        );
      }
      return Promise.resolve(nextId++);
    }
    return Promise.resolve(null);
  },
};

/** Deliver a backend event exactly as the Tauri event plugin would. */
function emit(event: string, payload: unknown): void {
  listeners.get(event)?.({ event, id: 1, payload });
}

// Imported dynamically, NOT statically: a static import is hoisted above the
// mock installed above, and the service builds its Tauri bindings against
// whatever `window` holds at module evaluation.
type UiStoreModule = typeof import('../../stores/ui.store.ts');
let uiStore: UiStoreModule['uiStore'];

describe('git.service late remote-operation completions', () => {
  let refreshes: string[] = [];
  const onRefresh = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { repoPath?: string } | undefined;
    refreshes.push(detail?.repoPath ?? '');
  };

  before(async () => {
    const gitService = await import('../git.service.ts');
    ({ uiStore } = await import('../../stores/ui.store.ts'));
    await gitService.setupRemoteOperationListeners();
    expect([...listeners.keys()], 'the service attached its backend listener').to.include(
      'remote-operation-completed',
    );
  });

  beforeEach(() => {
    refreshes = [];
    uiStore.setState({ toasts: [] });
    window.addEventListener('repository-refresh', onRefresh);
  });

  afterEach(() => {
    window.removeEventListener('repository-refresh', onRefresh);
    uiStore.setState({ toasts: [] });
  });

  const newestToast = (): { type: string; message: string } | undefined => {
    const toasts = uiStore.getState().toasts;
    return toasts[toasts.length - 1];
  };

  it('refreshes the repository a late pull completion names', () => {
    const message = 'Pull finished after it was reported as timed out: Merge completed';
    emit('remote-operation-completed', {
      operation: 'pull',
      remote: 'origin',
      repoPath: '/repos/alpha',
      success: true,
      message,
      late: true,
    });

    expect(refreshes, 'the repo the pull actually changed must be refreshed').to.deep.equal([
      '/repos/alpha',
    ]);
    expect(newestToast()).to.include({ type: 'warning', message });
  });

  it('reports a late failure as an error and still refreshes', () => {
    // A late rebase that failed can leave the repo in REBASE state; the UI has
    // to see it even though the operation reports failure.
    const message = 'Pull failed after it was reported as timed out: Rebase conflict';
    emit('remote-operation-completed', {
      operation: 'pull',
      remote: 'origin',
      repoPath: '/repos/alpha',
      success: false,
      message,
      late: true,
    });

    expect(refreshes).to.deep.equal(['/repos/alpha']);
    expect(newestToast()).to.include({ type: 'error', message });
  });

  it('routes a late pull that ended in conflicts into the conflict dialog', () => {
    // MERGE_HEAD is on disk: the user needs the dialog's Complete/Abort, which
    // a red toast plus a plain refresh does not offer. app-shell listens for
    // `merge-conflict` on ITSELF, so the dispatch has to target that element.
    const shell = document.createElement('app-shell');
    document.body.appendChild(shell);
    const conflicts: Array<{ repositoryPath?: string; operationType?: string }> = [];
    shell.addEventListener('merge-conflict', (e: Event) => {
      conflicts.push((e as CustomEvent).detail);
    });

    try {
      const message = 'Pull failed after it was reported as timed out: Merge conflict';
      emit('remote-operation-completed', {
        operation: 'pull',
        remote: 'origin',
        repoPath: '/repos/alpha',
        success: false,
        message,
        errorCode: 'MERGE_CONFLICT',
        late: true,
      });

      expect(conflicts, 'the conflict dialog must be opened for the right repo').to.deep.equal([
        { repositoryPath: '/repos/alpha', operationType: 'merge' },
      ]);
      // Not an error: the pull landed and now needs resolving.
      expect(newestToast()).to.include({ type: 'warning', message });
    } finally {
      shell.remove();
    }
  });

  it('opens a late rebase conflict as a rebase, not a merge', () => {
    const shell = document.createElement('app-shell');
    document.body.appendChild(shell);
    const conflicts: Array<{ repositoryPath?: string; operationType?: string }> = [];
    shell.addEventListener('merge-conflict', (e: Event) => {
      conflicts.push((e as CustomEvent).detail);
    });

    try {
      emit('remote-operation-completed', {
        operation: 'pull',
        remote: 'origin',
        repoPath: '/repos/alpha',
        success: false,
        message: 'Pull failed after it was reported as timed out: Rebase conflict',
        errorCode: 'REBASE_CONFLICT',
        late: true,
      });

      expect(conflicts).to.deep.equal([
        { repositoryPath: '/repos/alpha', operationType: 'rebase' },
      ]);
    } finally {
      shell.remove();
    }
  });

  it('still refreshes a late failure that is not a conflict', () => {
    const shell = document.createElement('app-shell');
    document.body.appendChild(shell);
    const conflicts: unknown[] = [];
    shell.addEventListener('merge-conflict', () => conflicts.push(true));

    try {
      emit('remote-operation-completed', {
        operation: 'pull',
        remote: 'origin',
        repoPath: '/repos/alpha',
        success: false,
        message: 'Pull failed after it was reported as timed out: Authentication required',
        errorCode: 'AUTH_REQUIRED',
        late: true,
      });

      expect(conflicts, 'only a conflict opens the conflict dialog').to.deep.equal([]);
      expect(refreshes).to.deep.equal(['/repos/alpha']);
      expect(newestToast()?.type).to.equal('error');
    } finally {
      shell.remove();
    }
  });

  it('leaves an ordinary completion alone', () => {
    // The caller that issued the push already refreshes; a second refresh from
    // here would be the overreach.
    emit('remote-operation-completed', {
      operation: 'push',
      remote: 'origin',
      repoPath: '/repos/alpha',
      success: true,
      message: 'Pushed to origin/main',
    });

    expect(refreshes, 'a normal completion must not trigger an extra refresh').to.deep.equal([]);
    expect(newestToast()).to.include({ type: 'success', message: 'Pushed to origin/main' });
  });

  it('still announces a late completion that names no repository', () => {
    const message = 'Push finished after it was reported as timed out: Pushed to origin/main';
    emit('remote-operation-completed', {
      operation: 'push',
      remote: 'origin',
      repoPath: '',
      success: true,
      message,
      late: true,
    });

    expect(refreshes, 'nothing to pin the refresh to').to.deep.equal([]);
    expect(newestToast()).to.include({ type: 'warning', message });
  });
});
