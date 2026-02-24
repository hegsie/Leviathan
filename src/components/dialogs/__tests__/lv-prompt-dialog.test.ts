/**
 * Prompt Dialog Tests
 *
 * Tests the lv-prompt-dialog component that provides a themed replacement
 * for native prompt() calls.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
let cbId = 0;

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';

import '../lv-prompt-dialog.ts';
import type { LvPromptDialog } from '../lv-prompt-dialog.ts';

describe('lv-prompt-dialog', () => {
  let el: LvPromptDialog;

  beforeEach(async () => {
    el = await fixture<LvPromptDialog>(html`<lv-prompt-dialog></lv-prompt-dialog>`);
  });

  it('opens and shows title and message', async () => {
    // Don't await the promise — just trigger open
    const resultPromise = el.open({
      title: 'Test Title',
      message: 'Test message',
    });

    await el.updateComplete;

    const modal = el.shadowRoot!.querySelector('lv-modal')!;
    expect(modal.modalTitle).to.equal('Test Title');
    expect(modal.open).to.be.true;

    const message = el.shadowRoot!.querySelector('.prompt-message')!;
    expect(message.textContent).to.equal('Test message');

    // Clean up — cancel to resolve the promise
    const cancelBtn = el.shadowRoot!.querySelector('.btn-secondary') as HTMLButtonElement;
    cancelBtn.click();
    const result = await resultPromise;
    expect(result).to.be.null;
  });

  it('pre-fills input with defaultValue', async () => {
    const resultPromise = el.open({
      title: 'Rename',
      message: 'Enter name:',
      defaultValue: 'my-branch',
    });

    await el.updateComplete;

    const input = el.shadowRoot!.querySelector('.prompt-input') as HTMLInputElement;
    expect(input.value).to.equal('my-branch');

    // Clean up
    const cancelBtn = el.shadowRoot!.querySelector('.btn-secondary') as HTMLButtonElement;
    cancelBtn.click();
    await resultPromise;
  });

  it('returns input value on confirm click', async () => {
    const resultPromise = el.open({
      title: 'Name',
      message: 'Enter name:',
      defaultValue: 'hello',
    });

    await el.updateComplete;

    const confirmBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
    confirmBtn.click();

    const result = await resultPromise;
    expect(result).to.equal('hello');
  });

  it('returns null on cancel click', async () => {
    const resultPromise = el.open({
      title: 'Name',
      message: 'Enter name:',
      defaultValue: 'hello',
    });

    await el.updateComplete;

    const cancelBtn = el.shadowRoot!.querySelector('.btn-secondary') as HTMLButtonElement;
    cancelBtn.click();

    const result = await resultPromise;
    expect(result).to.be.null;
  });

  it('returns value on Enter key', async () => {
    const resultPromise = el.open({
      title: 'Name',
      message: 'Enter name:',
      defaultValue: 'test-value',
    });

    await el.updateComplete;

    const input = el.shadowRoot!.querySelector('.prompt-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const result = await resultPromise;
    expect(result).to.equal('test-value');
  });

  it('returns null on modal close event (Escape)', async () => {
    const resultPromise = el.open({
      title: 'Name',
      message: 'Enter name:',
    });

    await el.updateComplete;

    const modal = el.shadowRoot!.querySelector('lv-modal')!;
    modal.close();

    const result = await resultPromise;
    expect(result).to.be.null;
  });

  it('uses custom button labels', async () => {
    const resultPromise = el.open({
      title: 'Confirm',
      message: 'Enter value:',
      confirmLabel: 'Save',
      cancelLabel: 'Dismiss',
    });

    await el.updateComplete;

    const confirmBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
    const cancelBtn = el.shadowRoot!.querySelector('.btn-secondary') as HTMLButtonElement;
    expect(confirmBtn.textContent!.trim()).to.equal('Save');
    expect(cancelBtn.textContent!.trim()).to.equal('Dismiss');

    // Clean up
    cancelBtn.click();
    await resultPromise;
  });

  it('shows placeholder text', async () => {
    const resultPromise = el.open({
      title: 'Feature',
      message: 'Enter feature name:',
      placeholder: 'feature-name',
    });

    await el.updateComplete;

    const input = el.shadowRoot!.querySelector('.prompt-input') as HTMLInputElement;
    expect(input.placeholder).to.equal('feature-name');

    // Clean up
    const cancelBtn = el.shadowRoot!.querySelector('.btn-secondary') as HTMLButtonElement;
    cancelBtn.click();
    await resultPromise;
  });

  it('returns updated input value after user typing', async () => {
    const resultPromise = el.open({
      title: 'Name',
      message: 'Enter name:',
      defaultValue: '',
    });

    await el.updateComplete;

    const input = el.shadowRoot!.querySelector('.prompt-input') as HTMLInputElement;
    input.value = 'new-value';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;

    const confirmBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
    confirmBtn.click();

    const result = await resultPromise;
    expect(result).to.equal('new-value');
  });
});
