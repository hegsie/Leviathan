/**
 * Local AI Service — background download failure reporting.
 *
 * `download_model` returns as soon as the download is spawned and reports the
 * outcome minutes later over a Tauri event. The only listeners used to live in
 * the Settings dialog, which app-shell destroys when it closes, so a download
 * that failed after the user closed Settings produced no toast, no banner and
 * no explanation — the user just never got a model. The app-level listener
 * added here has to survive that, without mistaking a user-requested cancel or
 * a successful load for a failure.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type EventCallback = (e: { event: string; id: number; payload: unknown }) => void;

/** Every live listener, so unlisten and multi-listener delivery are testable. */
const listeners = new Map<number, { event: string; cb: EventCallback }>();
const callbacks = new Map<number, EventCallback>();
let nextId = 1;

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  transformCallback: (cb: EventCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  },
  invoke: (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command === 'plugin:event|listen') {
      const cb = callbacks.get(args?.handler as number);
      const id = nextId++;
      if (cb) listeners.set(id, { event: args?.event as string, cb });
      return Promise.resolve(id);
    }
    if (command === 'plugin:event|unlisten') {
      listeners.delete(args?.eventId as number);
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  },
};

// `unlisten()` from @tauri-apps/api pokes the event plugin's own internals
// before invoking `plugin:event|unlisten`, so it has to exist for teardown.
(globalThis as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};

/** Deliver a backend event exactly as the Tauri event plugin would. */
function emit(event: string, payload: unknown): void {
  for (const listener of [...listeners.values()]) {
    if (listener.event === event) listener.cb({ event, id: 1, payload });
  }
}

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { listenForModelDownloadFailures } from '../local-ai.service.ts';
import { uiStore } from '../../stores/ui.store.ts';

function toasts() {
  return uiStore.getState().toasts;
}

describe('local-ai.service background download failures', () => {
  let unlisten: UnlistenFn | undefined;

  beforeEach(async () => {
    uiStore.setState({ toasts: [] });
    listeners.clear();
    unlisten = await listenForModelDownloadFailures();
  });

  afterEach(() => {
    unlisten?.();
    unlisten = undefined;
    uiStore.setState({ toasts: [] });
  });

  it('toasts the failure when a background download errors', () => {
    emit('model-download-error', {
      modelId: 'qwen-2.5-1.5b',
      error: 'Network unreachable',
    });

    const toast = toasts().find((t) => t.type === 'error');
    expect(toast, 'a failed download must be reported').to.not.be.undefined;
    expect(toast!.message).to.contain('qwen-2.5-1.5b');
    expect(toast!.message).to.contain('Network unreachable');
  });

  it('toasts when a downloaded model cannot be loaded', () => {
    emit('model-download-complete', {
      modelId: 'qwen-2.5-1.5b',
      loaded: false,
      loadError: 'Out of memory',
    });

    const toast = toasts().find((t) => t.type === 'error');
    expect(toast, 'a model that will not load must be reported').to.not.be.undefined;
    expect(toast!.message).to.contain('Out of memory');
  });

  it('stays quiet when the model downloads and loads', () => {
    emit('model-download-complete', { modelId: 'qwen-2.5-1.5b', loaded: true });

    expect(toasts(), 'a successful download is not an error').to.have.lengthOf(0);
  });

  it('stays quiet when the complete event omits the loaded flag', () => {
    emit('model-download-complete', { modelId: 'qwen-2.5-1.5b' });

    expect(toasts(), 'only an explicit loaded:false is a failure').to.have.lengthOf(0);
  });

  it('stays quiet when the user cancelled the download', () => {
    emit('model-download-error', { modelId: 'qwen-2.5-1.5b', error: 'Download cancelled' });

    expect(toasts(), 'a user-requested cancel is not a failure').to.have.lengthOf(0);
  });

  it('stops toasting after the returned unlisten runs', async () => {
    unlisten!();
    unlisten = undefined;
    // Tauri's unlisten deregisters over IPC, so let those promises settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    emit('model-download-error', { modelId: 'qwen-2.5-1.5b', error: 'Disk full' });
    emit('model-download-complete', {
      modelId: 'qwen-2.5-1.5b',
      loaded: false,
      loadError: 'Out of memory',
    });

    expect(toasts(), 'both listeners must be removed').to.have.lengthOf(0);
  });
});
