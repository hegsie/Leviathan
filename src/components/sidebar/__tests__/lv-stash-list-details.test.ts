/**
 * Tests for the inline stash contents preview in lv-stash-list.
 *
 * Apply/Pop/Drop all act on content the user could not see — Drop
 * irreversibly. These cover clicking a row to reveal `git stash show`'s
 * diffstat, the context-menu and keyboard routes to it, and the staleness
 * guards that stop the WRONG stash being previewed.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeCalls: Array<{ command: string; args?: unknown }> = [];

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvStashList } from '../lv-stash-list.ts';

// Import the actual component
import '../lv-stash-list.ts';
import { resetRefOpLocks } from '../../../utils/ref-lock.ts';
import { uiStore } from '../../../stores/ui.store.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeStash(overrides: Partial<{
  index: number;
  message: string;
  oid: string;
}> = {}) {
  return {
    index: overrides.index ?? 0,
    message: overrides.message ?? 'WIP on main',
    oid: overrides.oid ?? 'abc123',
  };
}

/**
 * Stash list returned by `get_stashes`. handleToggleDetails re-resolves the
 * clicked stash by oid against this list before calling stash_show, so a test
 * that expects a preview must seed it with that stash.
 */
let mockStashes: unknown[] = [];

/** Result returned by `stash_show`. */
let stashShowResult: unknown = null;

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_stashes') {
    return Promise.resolve(mockStashes);
  }
  if (command === 'stash_show') {
    return Promise.resolve(stashShowResult);
  }
  return Promise.resolve(null);
}

async function createComponent(): Promise<LvStashList> {
  mockInvoke = defaultMockInvoke;
  const el = await fixture<LvStashList>(
    html`<lv-stash-list .repositoryPath=${REPO_PATH}></lv-stash-list>`
  );
  await el.updateComplete;
  return el;
}

/** Two microtask hops: resolveStashIndex, then stashShow. */
async function settle(el: LvStashList): Promise<void> {
  await el.updateComplete;
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;
}

function row(el: LvStashList): HTMLElement {
  return el.shadowRoot!.querySelector('li.stash-item') as HTMLElement;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-stash-list contents preview', () => {
  beforeEach(() => {
    resetRefOpLocks();
    invokeCalls.length = 0;
    mockStashes = [makeStash({ index: 0, message: 'WIP', oid: 'abc123' })];
    stashShowResult = {
      index: 0,
      message: 'WIP',
      files: [{ path: 'src/a.ts', additions: 3, deletions: 1, status: 'modified' }],
      totalAdditions: 3,
      totalDeletions: 1,
      patch: null,
    };
  });

  it('clicking a stash row shows what is in it', async () => {
    const el = await createComponent();
    invokeCalls.length = 0;

    row(el).click();
    await settle(el);

    expect(invokeCalls.filter(c => c.command === 'stash_show')).to.have.length(1);
    expect(el.shadowRoot!.querySelector('.stash-details')).to.not.be.null;
    expect(el.shadowRoot!.textContent).to.include('src/a.ts');
    expect(el.shadowRoot!.textContent).to.include('+3');
  });

  it('a second click collapses it', async () => {
    const el = await createComponent();

    row(el).click();
    await settle(el);
    expect(el.shadowRoot!.querySelector('.stash-details')).to.not.be.null;

    row(el).click();
    await settle(el);
    expect(el.shadowRoot!.querySelector('.stash-details')).to.be.null;
  });

  it('reports a failed read in the row instead of swallowing it', async () => {
    const el = await createComponent();
    mockInvoke = (c: string) =>
      c === 'stash_show'
        ? Promise.reject({ code: 'COMMAND_ERROR', message: 'could not read stash entry' })
        : defaultMockInvoke(c);

    row(el).click();
    await settle(el);

    const errEl = el.shadowRoot!.querySelector('.stash-details-error');
    expect(errEl).to.not.be.null;
    expect(errEl!.textContent).to.include('could not read stash entry');
    // The loading flag must clear, or the row is stuck on a spinner forever.
    expect(el.shadowRoot!.textContent).to.not.include('Loading contents');
  });

  it('says so when the stash has no file changes', async () => {
    const el = await createComponent();
    stashShowResult = {
      index: 0,
      message: 'WIP',
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      patch: null,
    };

    row(el).click();
    await settle(el);

    expect(el.shadowRoot!.querySelector('.stash-details')!.textContent!.trim())
      .to.equal('No file changes');
  });

  it('previews the stash the user clicked after the list shifts', async () => {
    const target = makeStash({ index: 1, message: 'refactor WIP', oid: 'target-oid' });
    mockStashes = [target];
    const el = await createComponent();

    // Two stashes pushed since render: the clicked row still carries index 1,
    // but its live position is now 2.
    mockStashes = [
      makeStash({ index: 0, oid: 'new-oid' }),
      makeStash({ index: 1, oid: 'other-oid' }),
      { ...target, index: 2 },
    ];
    invokeCalls.length = 0;

    row(el).click();
    await settle(el);

    const call = invokeCalls.find(c => c.command === 'stash_show');
    expect(call, 'stash_show must be called').to.not.be.undefined;
    expect(
      (call!.args as { index: number }).index,
      'must preview the CURRENT position of the clicked stash'
    ).to.equal(2);
  });

  it('does not preview a stash that has vanished', async () => {
    const el = await createComponent();
    uiStore.setState({ toasts: [] });

    mockStashes = [makeStash({ oid: 'someone-else' })];
    invokeCalls.length = 0;

    row(el).click();
    await settle(el);

    expect(invokeCalls.filter(c => c.command === 'stash_show')).to.have.length(0);
    expect(el.shadowRoot!.querySelector('.stash-details')).to.be.null;
    expect(
      uiStore.getState().toasts.some(t => /no longer in the stash list/i.test(t.message))
    ).to.be.true;
  });

  it('does not render another repo\'s stash contents after a tab switch', async () => {
    const el = await createComponent();

    let resolveShow: (v: unknown) => void = () => {};
    mockInvoke = (c: string) =>
      c === 'stash_show'
        ? new Promise(resolve => { resolveShow = resolve; })
        : defaultMockInvoke(c);

    row(el).click();
    // Let the oid resolution settle so the pending call is stash_show.
    await el.updateComplete;
    await new Promise(r => setTimeout(r, 0));
    await el.updateComplete;

    // The read really did go out — otherwise "nothing rendered" would prove
    // nothing about discarding its result.
    expect(invokeCalls.filter(c => c.command === 'stash_show')).to.have.length(1);

    (el as unknown as { repositoryPath: string }).repositoryPath = '/other/repo';
    resolveShow(stashShowResult);
    await settle(el);

    expect(el.shadowRoot!.querySelector('.stash-details')).to.be.null;
  });

  it('opens the preview from the Show Contents context-menu item', async () => {
    const el = await createComponent();

    row(el).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await el.updateComplete;

    const items = Array.from(
      el.shadowRoot!.querySelectorAll('.context-menu-item')
    ) as HTMLElement[];
    const labels = items.map(i => i.textContent!.trim());
    expect(labels).to.include('Show Contents');

    items[labels.indexOf('Show Contents')].click();
    await settle(el);

    expect(el.shadowRoot!.querySelector('.stash-details')).to.not.be.null;
  });

  it('opens the preview when Enter is pressed on a row', async () => {
    const el = await createComponent();

    row(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle(el);

    expect(row(el).getAttribute('aria-expanded')).to.equal('true');
    expect(el.shadowRoot!.querySelector('.stash-details')).to.not.be.null;
  });

  it('still reaches the actions menu with Shift+F10', async () => {
    const el = await createComponent();

    row(el).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })
    );
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.context-menu')).to.not.be.null;
  });

  it('closes the preview when its stash is dropped', async () => {
    const el = await createComponent();

    row(el).click();
    await settle(el);
    expect(el.shadowRoot!.querySelector('.stash-details')).to.not.be.null;

    mockStashes = [];
    await (el as unknown as { refresh: () => Promise<void> }).refresh();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.stash-details')).to.be.null;
  });
});
