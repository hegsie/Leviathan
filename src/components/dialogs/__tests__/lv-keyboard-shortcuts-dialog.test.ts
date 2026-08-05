/**
 * Tests for lv-keyboard-shortcuts-dialog's key-recording mode.
 *
 * KeyboardService registers its `document` keydown listener at MODULE
 * evaluation, so it always runs before this dialog's (registered in
 * connectedCallback) — and stopPropagation() cannot suppress a listener on the
 * same node. So the key being recorded was executed first: pressing "s" to
 * rebind a shortcut staged the whole working tree, Ctrl+Shift+S stashed
 * including untracked files, Ctrl+Shift+U pushed. It also swallowed the
 * "Esc to cancel" the dialog advertises, closing the entire dialog instead.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import { keyboardService } from '../../../services/keyboard.service.ts';
import type { LvKeyboardShortcutsDialog } from '../lv-keyboard-shortcuts-dialog.ts';
import '../lv-keyboard-shortcuts-dialog.ts';

interface Internal {
  editingId: string | null;
  startEditing: (id: string) => void;
  cancelEditing: () => void;
}

function internalOf(el: LvKeyboardShortcutsDialog): Internal {
  return el as unknown as Internal;
}

async function openDialog(): Promise<LvKeyboardShortcutsDialog> {
  const el = await fixture<LvKeyboardShortcutsDialog>(
    html`<lv-keyboard-shortcuts-dialog ?open=${true}></lv-keyboard-shortcuts-dialog>`
  );
  await el.updateComplete;
  return el;
}

describe('lv-keyboard-shortcuts-dialog recording mode', () => {
  afterEach(() => {
    // Never leave the service disabled for the next test.
    keyboardService.setEnabled(true);
  });

  it('does not run a shortcut while capturing its replacement', async () => {
    let fired = 0;
    keyboardService.register('test-destructive', {
      key: 'y',
      action: () => { fired++; },
      description: 'destructive probe',
      category: 'Test',
    });

    const el = await openDialog();
    try {
      internalOf(el).startEditing('test-destructive');
      await el.updateComplete;

      // The key the user is recording must be captured, NOT executed. This is
      // the whole bug: "s" staged the working tree before being recorded.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y' }));

      expect(fired, 'the shortcut must not run while being rebound').to.equal(0);
    } finally {
      keyboardService.unregister('test-destructive');
    }
  });

  it('re-enables shortcuts once recording is cancelled', async () => {
    let fired = 0;
    keyboardService.register('test-restore', {
      key: 'y',
      action: () => { fired++; },
      description: 'restore probe',
      category: 'Test',
    });

    const el = await openDialog();
    try {
      internalOf(el).startEditing('test-restore');
      await el.updateComplete;
      internalOf(el).cancelEditing();
      await el.updateComplete;

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y' }));

      expect(fired, 'shortcuts work again after cancelling').to.equal(1);
    } finally {
      keyboardService.unregister('test-restore');
    }
  });

  // The inverse failure: leaving the service disabled kills every shortcut in
  // the app with no way back.
  it('re-enables shortcuts if torn down mid-recording', async () => {
    let fired = 0;
    keyboardService.register('test-teardown', {
      key: 'y',
      action: () => { fired++; },
      description: 'teardown probe',
      category: 'Test',
    });

    const el = await openDialog();
    try {
      internalOf(el).startEditing('test-teardown');
      await el.updateComplete;

      el.remove();
      await new Promise((r) => setTimeout(r, 0));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y' }));

      expect(fired, 'shortcuts must survive a mid-recording teardown').to.equal(1);
    } finally {
      keyboardService.unregister('test-teardown');
    }
  });
});
