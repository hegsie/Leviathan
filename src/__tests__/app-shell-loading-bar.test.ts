/**
 * The global loading bar must actually be styled.
 *
 * The `.skip-link` rule above it was never closed, so under CSS nesting — which
 * the WebView2 and WKWebView engines Tauri uses both support — the loading-bar
 * selectors compiled to `.skip-link .global-loading-bar` and matched nothing:
 * the bar is a SIBLING of the skip link, not a descendant. The bar rendered but
 * was invisible, so every long-running operation ran with no progress
 * indicator at all. The skip link lost its own colours too, because its
 * declarations were stranded after the @keyframes block.
 *
 * Asserted through computed style rather than by reading the stylesheet text,
 * so it fails for a nesting mistake of any shape.
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
import type { AppShell } from '../app-shell.ts';
import '../app-shell.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function shellWithLoading(loading: boolean): Promise<AppShell> {
  const el = await fixture<AppShell>(html`<lv-app-shell></lv-app-shell>`);
  (el as any).globalLoading = loading;
  await el.updateComplete;
  return el;
}

describe('app-shell global loading bar', () => {
  it('renders the bar only while an operation is running', async () => {
    const idle = await shellWithLoading(false);
    expect(idle.shadowRoot!.querySelector('.global-loading-bar')).to.be.null;

    const busy = await shellWithLoading(true);
    expect(busy.shadowRoot!.querySelector('.global-loading-bar')).to.not.be.null;
  });

  it('styles the bar, so it is actually visible', async () => {
    const el = await shellWithLoading(true);
    const bar = el.shadowRoot!.querySelector('.global-loading-bar') as HTMLElement;
    expect(bar, 'the bar must be rendered').to.not.be.null;

    const style = getComputedStyle(bar);

    // Nested under .skip-link the rule never applied, leaving the div at its
    // default `position: static` with no height — present in the DOM and
    // invisible on screen.
    expect(style.position, 'the loading bar must be positioned').to.equal('fixed');
    expect(
      parseFloat(style.height),
      'the loading bar must have a height, or nothing is drawn',
    ).to.be.greaterThan(0);
  });

  it('styles the skip link, whose declarations sat after the keyframes', async () => {
    const el = await shellWithLoading(false);
    const skip = el.shadowRoot!.querySelector('.skip-link') as HTMLElement;
    expect(skip, 'the skip link must be rendered').to.not.be.null;

    const style = getComputedStyle(skip);
    expect(style.position, 'the skip link must be positioned').to.equal('absolute');
    // Stranded after @keyframes, this declaration was dropped entirely.
    expect(
      style.textDecorationLine,
      'the skip link must keep its own styling',
    ).to.contain('none');
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
