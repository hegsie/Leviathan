import { expect, fixture, html } from '@open-wc/testing';
import { LitElement, html as litHtml } from 'lit';
import { customElement } from 'lit/decorators.js';
import { deepActiveElement, containsDeepActiveElement } from '../focus.ts';

@customElement('focus-test-host')
class FocusTestHost extends LitElement {
  render() {
    return litHtml`
      <input id="shadow-input" />
      <slot></slot>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'focus-test-host': FocusTestHost;
  }
}

describe('focus utils', () => {
  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('deepActiveElement returns null when nothing is focused', () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(deepActiveElement()).to.equal(null);
  });

  it('deepActiveElement walks through shadow roots to the real target', async () => {
    const el = await fixture<FocusTestHost>(html`<focus-test-host></focus-test-host>`);
    await el.updateComplete;

    const input = el.shadowRoot!.querySelector<HTMLInputElement>('#shadow-input')!;
    input.focus();

    // document.activeElement only names the host — the helper must go deeper.
    expect(document.activeElement).to.equal(el);
    expect(deepActiveElement()).to.equal(input);
  });

  it('containsDeepActiveElement is true for a field in the host shadow root', async () => {
    const el = await fixture<FocusTestHost>(html`<focus-test-host></focus-test-host>`);
    await el.updateComplete;

    expect(containsDeepActiveElement(el)).to.equal(false);

    el.shadowRoot!.querySelector<HTMLInputElement>('#shadow-input')!.focus();
    expect(containsDeepActiveElement(el)).to.equal(true);
  });

  it('containsDeepActiveElement is true for slotted light-DOM content', async () => {
    const el = await fixture<FocusTestHost>(
      html`<focus-test-host><input id="light-input" /></focus-test-host>`,
    );
    await el.updateComplete;

    const light = el.querySelector<HTMLInputElement>('#light-input')!;
    light.focus();

    expect(deepActiveElement()).to.equal(light);
    expect(containsDeepActiveElement(el)).to.equal(true);
  });

  it('containsDeepActiveElement is false when focus sits in a sibling element', async () => {
    const wrap = await fixture<HTMLDivElement>(html`
      <div>
        <focus-test-host></focus-test-host>
        <input id="outside" />
      </div>
    `);
    const host = wrap.querySelector<FocusTestHost>('focus-test-host')!;
    await host.updateComplete;

    wrap.querySelector<HTMLInputElement>('#outside')!.focus();
    expect(containsDeepActiveElement(host)).to.equal(false);
  });
});
