/**
 * Progress Service — backend event routing
 *
 * `remote-operation-completed` carries no progress-operation ID — rows are
 * keyed `fetch:<repo>` — so a listener that removed "the first row whose type
 * matches" removed whichever repo's row happened to be first: fetch repo B,
 * Ctrl+Tab, fetch repo A (a different `fetch:<repo>` key, so both run at
 * once), and A finishing tore down B's progress indicator while B was still
 * fetching. Every row is started and removed by its own caller in app-shell.
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
        listeners.set(event, handler as (e: { event: string; id: number; payload: unknown }) => void);
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

// Imported dynamically, NOT statically: static imports are hoisted above the
// mock above, and this service attaches its listeners in the singleton's
// constructor — i.e. at module evaluation. A static import would build the
// service against a bare window and register nothing at all.
type ProgressServiceModule = typeof import('../progress.service.ts');
let progressService: ProgressServiceModule['progressService'];

describe('progress.service backend events', () => {
  before(async () => {
    ({ progressService } = await import('../progress.service.ts'));
    await progressService.ready();
    expect([...listeners.keys()], 'the service attached its backend listeners').to.include(
      'operation-progress',
    );
  });

  beforeEach(async () => {
    await progressService.ready();
    for (const op of progressService.getOperations()) {
      progressService.completeOperation(op.id);
    }
  });

  // Control: proves the harness really delivers events to the service, so the
  // assertions below are about routing and not about a dead emit().
  it('removes the row an operation-progress completion names', () => {
    const first = progressService.startOperation('fetch', 'Fetching repo A...');
    const second = progressService.startOperation('fetch', 'Fetching repo B...');

    emit('operation-progress', { operationId: second, completed: true });

    expect(progressService.getOperations().map((op) => op.id)).to.deep.equal([first]);

    progressService.completeOperation(first);
  });

  it('leaves both fetch rows alone when a fetch completes elsewhere', () => {
    const repoB = progressService.startOperation('fetch', 'Fetching repo B...');
    const repoA = progressService.startOperation('fetch', 'Fetching repo A...');

    // Repo A's fetch finishes first. The event names no repository at all.
    emit('remote-operation-completed', {
      operation: 'fetch',
      remote: 'origin',
      success: true,
      message: 'Fetch completed successfully',
    });

    expect(
      progressService.getOperations().map((op) => op.id),
      "repo B's indicator must survive a completion it knows nothing about",
    ).to.deep.equal([repoB, repoA]);

    progressService.completeOperation(repoA);
    progressService.completeOperation(repoB);
  });

  it('leaves both push rows alone when a push completes elsewhere', () => {
    const repoB = progressService.startOperation('push', 'Pushing repo B...');
    const repoA = progressService.startOperation('push', 'Pushing repo A...');

    emit('remote-operation-completed', {
      operation: 'push',
      remote: 'origin',
      success: true,
      message: 'Pushed to origin/main',
    });

    expect(progressService.getOperations().map((op) => op.id)).to.deep.equal([repoB, repoA]);

    progressService.completeOperation(repoA);
    progressService.completeOperation(repoB);
  });

  // ---- operation-progress carries the real transfer counts ----
  //
  // Nothing in the backend used to emit this event at all, so every
  // fetch/pull/push row showed an indeterminate stripe with no counts for as
  // long as it ran.

  it('updates the named row from an operation-progress event', () => {
    const id = progressService.startOperation('fetch', 'Fetching from remote...', {
      cancellable: true,
    });

    emit('operation-progress', {
      operationId: id,
      message: 'Fetching from origin',
      progress: 42,
      receivedObjects: 420,
      totalObjects: 1000,
      receivedBytes: 2048,
    });

    const [op] = progressService.getOperations();
    expect(op.message).to.equal('Fetching from origin');
    expect(op.progress).to.equal(42);
    expect(op.receivedObjects).to.equal(420);
    expect(op.totalObjects).to.equal(1000);
    expect(op.receivedBytes).to.equal(2048);

    progressService.completeOperation(id);
  });

  it('routes progress to the row it names and no other', () => {
    const fetching = progressService.startOperation('fetch', 'Fetching...');
    const pushing = progressService.startOperation('push', 'Pushing...');

    emit('operation-progress', {
      operationId: pushing,
      progress: 10,
      receivedObjects: 5,
      totalObjects: 50,
      receivedBytes: 100,
    });

    const rows = progressService.getOperations();
    expect(rows.find((op) => op.id === fetching)?.receivedObjects).to.equal(undefined);
    expect(rows.find((op) => op.id === pushing)?.receivedObjects).to.equal(5);

    progressService.completeOperation(fetching);
    progressService.completeOperation(pushing);
  });

  it('notifies subscribers so the indicator re-renders on progress', () => {
    const id = progressService.startOperation('pull', 'Pulling...');
    let seen = 0;
    const unsubscribe = progressService.subscribe(() => {
      seen++;
    });
    const afterSubscribe = seen;

    emit('operation-progress', {
      operationId: id,
      progress: 5,
      receivedObjects: 1,
      totalObjects: 20,
      receivedBytes: 64,
    });

    expect(seen).to.be.greaterThan(afterSubscribe);

    unsubscribe();
    progressService.completeOperation(id);
  });

  it('ignores progress for a row that has already gone', () => {
    const id = progressService.startOperation('fetch', 'Fetching...');
    progressService.completeOperation(id);

    // A late event from a transfer that has already finished must not
    // resurrect its row.
    emit('operation-progress', { operationId: id, progress: 90 });

    expect(progressService.getOperations()).to.have.length(0);
  });

  it('still lets the caller that started a row remove it', () => {
    // The rows are owned by their callers (app-shell completes on success and
    // fails on error, on every branch), which is why nothing else needs to
    // guess from the event.
    const id = progressService.startOperation('fetch', 'Fetching...');
    progressService.completeOperation(id);

    expect(progressService.getOperations()).to.have.length(0);
  });
});
