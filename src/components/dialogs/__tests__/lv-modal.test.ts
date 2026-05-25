/**
 * lv-modal tests — focuses on the header controls (close × vs. back ←).
 */
import { expect, fixture, html } from '@open-wc/testing';
import '../lv-modal.ts';
import type { LvModal } from '../lv-modal.ts';

describe('lv-modal', () => {
  it('shows a close button by default', async () => {
    const el = await fixture<LvModal>(html`<lv-modal .open=${true} modalTitle="Test"></lv-modal>`);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('button[aria-label="Close"]')).to.not.be.null;
    expect(el.shadowRoot!.querySelector('button[aria-label="Back"]')).to.be.null;
  });

  it('shows a back button (and no close) when backButton is set', async () => {
    const el = await fixture<LvModal>(
      html`<lv-modal .open=${true} ?backButton=${true} modalTitle="Test"></lv-modal>`
    );
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('button[aria-label="Back"]')).to.not.be.null;
    expect(el.shadowRoot!.querySelector('button[aria-label="Close"]')).to.be.null;
  });

  it('dispatches close when the back button is clicked', async () => {
    const el = await fixture<LvModal>(
      html`<lv-modal .open=${true} ?backButton=${true} modalTitle="Test"></lv-modal>`
    );
    await el.updateComplete;

    let closed = false;
    el.addEventListener('close', () => {
      closed = true;
    });
    (el.shadowRoot!.querySelector('button[aria-label="Back"]') as HTMLButtonElement).click();
    expect(closed).to.be.true;
  });
});
