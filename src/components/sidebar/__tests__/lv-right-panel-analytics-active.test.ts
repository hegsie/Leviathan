/**
 * The right panel keeps <lv-analytics-panel> mounted inside a CSS-hidden tab,
 * so the panel cannot tell on its own whether it is on screen. It must be told,
 * otherwise a `repository-refresh` arriving while another tab is up either
 * pays for a full statistics walk nobody is looking at, or is dropped and the
 * numbers go stale forever.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
let cbId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvRightPanel } from '../lv-right-panel.ts';
import '../lv-right-panel.ts';
import type { LvAnalyticsPanel } from '../../panels/lv-analytics-panel.ts';
import { repositoryStore } from '../../../stores/index.ts';
import type { Repository } from '../../../types/git.types.ts';

function mockRepo(path: string): Repository {
  return {
    path,
    name: 'test-repo',
    isValid: true,
    isBare: false,
    headRef: 'main',
    state: 'clean',
    isShallow: false,
    isPartialClone: false,
    cloneFilter: null,
  };
}

describe('lv-right-panel analytics visibility', () => {
  beforeEach(() => {
    repositoryStore.getState().reset();
    repositoryStore.getState().addRepository(mockRepo('/test/repo'));
  });

  it('tells the analytics panel whether its tab is showing', async () => {
    const el = await fixture<LvRightPanel>(html`<lv-right-panel></lv-right-panel>`);
    await el.updateComplete;

    const panel = el.shadowRoot!.querySelector('lv-analytics-panel') as LvAnalyticsPanel;
    expect(panel).to.not.be.null;

    // Default tab is Changes — the analytics panel is mounted but hidden.
    expect(panel.active).to.equal(false);

    el.showAnalytics();
    await el.updateComplete;
    expect(panel.active).to.equal(true);

    el.showChanges();
    await el.updateComplete;
    expect(panel.active).to.equal(false);
  });
});
