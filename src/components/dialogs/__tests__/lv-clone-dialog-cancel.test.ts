/**
 * A clone in flight must be cancellable.
 *
 * The Cancel button was disabled while cloning and handleModalClose re-asserted
 * modal.open, so Escape, the overlay and the × could not dismiss the dialog
 * either. With no cancellation on the backend and no timeout passed from the
 * frontend, a clone against an unreachable host or an SSH remote waiting on
 * interactive auth locked the modal for the life of the application — the only
 * recovery was restarting it.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invoked: { command: string; args?: unknown }[] = [];

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invoked.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

(globalThis as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  convertCallback: (callback: unknown, once: boolean) => {
    void once;
    void callback;
    return 0;
  },
  unregisterListener: (_event: string, _eventId: number) => {},
};

import { expect, fixture, html } from '@open-wc/testing';
import '../lv-clone-dialog.ts';
import type { LvCloneDialog } from '../lv-clone-dialog.ts';
import { settingsStore } from '../../../stores/settings.store.ts';

/** Resolver for the pending clone, so the test controls when it finishes. */
let finishClone: ((value: unknown) => void) | null = null;

function footerButtons(el: LvCloneDialog): HTMLButtonElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll('[slot="footer"] button'));
}

function cancelButton(el: LvCloneDialog): HTMLButtonElement {
  return footerButtons(el)[0];
}

function cloneButton(el: LvCloneDialog): HTMLButtonElement {
  return footerButtons(el)[1];
}

async function startClone(el: LvCloneDialog): Promise<void> {
  el.open();
  await el.updateComplete;

  const urlInput = el.shadowRoot!.querySelector('input') as HTMLInputElement;
  urlInput.value = 'https://example.com/hung/repo.git';
  urlInput.dispatchEvent(new Event('input'));
  await el.updateComplete;

  const destInput = el.shadowRoot!.querySelectorAll('input')[1] as HTMLInputElement;
  destInput.value = '/tmp/clone-target';
  destInput.dispatchEvent(new Event('input'));
  await el.updateComplete;

  cloneButton(el).click();
  // handleClone awaits the progress listener before invoking the clone, so a
  // single update tick is not enough for the command to have been sent.
  await flush();
  await el.updateComplete;
}

/** Let pending microtasks and timers settle. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('lv-clone-dialog cancellation', () => {
  let el: LvCloneDialog;

  beforeEach(async () => {
    invoked.length = 0;
    finishClone = null;
    settingsStore.getState().setDefaultClonePath('');

    mockInvoke = (command) => {
      if (command === 'clone_repository') {
        // Never resolves on its own — this is the hung clone.
        return new Promise((resolve) => {
          finishClone = resolve;
        });
      }
      return Promise.resolve(null);
    };

    el = await fixture<LvCloneDialog>(html`<lv-clone-dialog></lv-clone-dialog>`);
  });

  afterEach(() => {
    finishClone?.(null);
  });

  it('offers a usable Cancel button while the clone is in flight', async () => {
    await startClone(el);

    const cancel = cancelButton(el);
    expect(cancel.disabled, 'Cancel must be pressable during a clone').to.be.false;
    expect(cancel.textContent?.trim()).to.contain('Cancel');
  });

  it('asks the backend to cancel when Cancel is pressed', async () => {
    await startClone(el);

    cancelButton(el).click();
    await flush();
    await el.updateComplete;

    expect(
      invoked.some((c) => c.command === 'cancel_clone'),
      'pressing Cancel must invoke cancel_clone',
    ).to.be.true;
  });

  it('cancels rather than silently ignoring an Escape/overlay dismissal', async () => {
    await startClone(el);

    const modal = el.shadowRoot!.querySelector('lv-modal')!;
    modal.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    await flush();
    await el.updateComplete;

    expect(
      invoked.some((c) => c.command === 'cancel_clone'),
      'dismissing the modal during a clone must cancel it',
    ).to.be.true;
  });

  it('sends a network timeout so a hung clone cannot run forever', async () => {
    settingsStore.getState().setNetworkOperationTimeout?.(30);
    await startClone(el);

    const cloneCall = invoked.find((c) => c.command === 'clone_repository');
    expect(cloneCall, 'clone should have been invoked').to.exist;

    const args = cloneCall!.args as Record<string, unknown> | undefined;
    // Tauri nests command args under the parameter name.
    const payload = (args?.args ?? args) as Record<string, unknown> | undefined;
    expect(payload?.timeoutSecs, 'clone must carry the network timeout like fetch/pull/push').to
      .not.be.undefined;
  });

  it('releases the dialog once the cancelled clone returns', async () => {
    await startClone(el);
    cancelButton(el).click();
    await flush();
    await el.updateComplete;

    // Backend reports the cancellation as a failed clone.
    finishClone?.(Promise.reject(new Error('Clone cancelled')));
    await flush();
    await el.updateComplete;

    // The dialog must now be closable: Cancel goes back to plain dismissal.
    expect(cancelButton(el).disabled).to.be.false;
  });
});
