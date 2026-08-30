/**
 * Sidebar context menus must not survive a repository switch.
 *
 * lv-left-panel keeps ONE instance of each list across tabs and only rebinds
 * `.repositoryPath`. The only close paths a menu has are a document click and
 * Escape, and a Ctrl+digit / Ctrl+Tab switch produces neither — so an open menu
 * stayed on screen over the new repo's rows while its entries still resolved
 * the repo from `this.repositoryPath` at click time. Right-click `v1.0.0` in
 * repo A, Ctrl+2, click Delete, and the irreversible operation ran against
 * repo B — which routinely has a tag by the same name.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture } from '@open-wc/testing';
import '../lv-branch-list.ts';
import '../lv-file-status.ts';
import '../lv-stash-list.ts';
import '../lv-tag-list.ts';

type Loadable = HTMLElement & { repositoryPath: string; updateComplete: Promise<unknown> };

/** Rows loaded per repo path, keyed by the command that fetches them. */
let rows: Record<string, Record<string, unknown[]>> = {};
/** Commands whose next call must reject, simulating a failed load. */
let failing = new Set<string>();

function installMock(): void {
  mockInvoke = (command, args) => {
    const path = String((args as { path?: string })?.path ?? '');
    if (failing.has(command)) {
      return Promise.reject({ code: 'COMMAND_ERROR', message: 'repository is locked' });
    }
    const forCommand = rows[path]?.[command];
    if (forCommand) return Promise.resolve(forCommand);
    if (command === 'get_tag_sort_mode') return Promise.resolve('name');
    return Promise.resolve(null);
  };
}

/** Let an un-awaited async `updated()`/load settle. */
async function flush(el: Loadable): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await el.updateComplete;
}

/** Right-click the first row matching `selector`, as a user would. */
function rightClickRow(el: HTMLElement, selector: string): void {
  const row = el.shadowRoot!.querySelector(selector);
  if (!row) throw new Error(`no ${selector} row to right-click`);
  row.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, composed: true, clientX: 40, clientY: 60 })
  );
}

function menuOf(el: HTMLElement): Element | null {
  return el.shadowRoot!.querySelector('.context-menu');
}

/** Asserted on instead of the element itself: a failed `.to.be.null` on a DOM
 * node makes chai deep-inspect the whole menu subtree, which drowns the
 * reporter and turns a one-line failure into a runner timeout. */
function menuCount(el: HTMLElement): number {
  return el.shadowRoot!.querySelectorAll('.context-menu').length;
}

function makeTag(name: string) {
  return { name, targetOid: `oid-${name}`, message: null, tagger: null, isAnnotated: false };
}

function makeBranch(name: string) {
  return {
    name,
    shorthand: name,
    isHead: false,
    isRemote: false,
    upstream: null,
    targetOid: `oid-${name}`,
    isStale: false,
  };
}

function makeStash(index: number, message: string) {
  return { index, message, oid: `oid-${index}`, branch: 'main', timestamp: 0 };
}

function makeEntry(path: string) {
  return { path, status: 'modified', isStaged: false, isConflicted: false };
}

/**
 * One table-driven case per list: how to seed its rows, which row to
 * right-click, and the label the menu carries so the assertions are about the
 * REAL menu and not some other node.
 */
const cases = [
  {
    name: 'lv-tag-list',
    tag: 'lv-tag-list',
    command: 'get_tags',
    row: '.tag-item',
    menuLabel: 'Tag actions',
    // The same name in both repos: the exact collision that makes a leaked
    // menu destructive rather than merely confusing.
    a: [makeTag('v1.0.0')],
    b: [makeTag('v1.0.0')],
  },
  {
    name: 'lv-branch-list',
    tag: 'lv-branch-list',
    command: 'get_branches',
    row: '.branch-item',
    menuLabel: 'Branch actions',
    a: [makeBranch('develop')],
    b: [makeBranch('develop')],
  },
  {
    name: 'lv-stash-list',
    tag: 'lv-stash-list',
    command: 'get_stashes',
    row: '.stash-item',
    menuLabel: 'Stash actions',
    a: [makeStash(0, 'WIP on develop')],
    b: [makeStash(0, 'WIP on develop')],
  },
  {
    name: 'lv-file-status',
    tag: 'lv-file-status',
    command: 'get_status',
    row: '.file-item',
    menuLabel: 'File actions',
    a: [makeEntry('src/main.ts')],
    b: [makeEntry('src/main.ts')],
  },
] as const;

describe('sidebar context menus across a repository switch', () => {
  beforeEach(() => {
    rows = {};
    failing = new Set();
    installMock();
  });

  for (const c of cases) {
    describe(c.name, () => {
      async function mounted(): Promise<Loadable> {
        rows['/repo/a'] = { [c.command]: [...c.a] };
        rows['/repo/b'] = { [c.command]: [...c.b] };
        const list = await fixture<Loadable>(`<${c.tag}></${c.tag}>`);
        list.repositoryPath = '/repo/a';
        await flush(list);
        return list;
      }

      it('closes an open menu when the tab switch rebinds the repository', async () => {
        const el = await mounted();
        rightClickRow(el, c.row);
        await el.updateComplete;

        expect(menuCount(el), 'the menu opens on right-click').to.equal(1);
        expect(menuOf(el)!.getAttribute('aria-label')).to.equal(c.menuLabel);

        // Exactly what a Ctrl+digit switch does: lv-left-panel rebinds the
        // property on the SAME element. No click, no Escape.
        el.repositoryPath = '/repo/b';
        await flush(el);

        expect(menuCount(el), 'no menu survives into the new repository').to.equal(0);
      });

      it('keeps the menu open across a refresh of the same repository', async () => {
        // The guard must key off a repo CHANGE, not any re-render: a refresh
        // must not yank the menu out from under the user's click. Re-assigning
        // the SAME path would prove nothing — `repositoryPath` is a plain
        // @property, so Lit's `!==` check requests no update at all. Drive the
        // component's own refresh instead, which re-renders with
        // `changedProperties.has('repositoryPath')` false.
        const el = await mounted();
        rightClickRow(el, c.row);
        await el.updateComplete;
        expect(menuCount(el), 'the menu opens on right-click').to.equal(1);

        await (el as unknown as { refresh: () => unknown }).refresh();
        // A load that happens to produce identical state re-renders nothing, so
        // force one update cycle to guarantee `updated()` actually runs.
        (el as unknown as { requestUpdate: () => void }).requestUpdate();
        await flush(el);

        expect(menuCount(el), 'a same-repo refresh leaves the menu alone').to.equal(1);
        expect(
          (el as unknown as { contextMenu: { visible: boolean } }).contextMenu.visible,
          'a same-repo refresh leaves the menu armed'
        ).to.equal(true);
      });

      it('closes the menu even when the new repository fails to load', async () => {
        // The close must happen BEFORE the reload await, or a failing load
        // leaves the menu armed: lv-branch-list and lv-file-status swap the
        // whole body for an error state, so the node is merely hidden and comes
        // straight back — still holding repo A's row — the moment a later
        // refresh succeeds. Hence the assertion is on the state the entries
        // actually read, not on the DOM, which cannot tell the two apart.
        const el = await mounted();
        rightClickRow(el, c.row);
        await el.updateComplete;
        expect(menuCount(el), 'the menu opens on right-click').to.equal(1);

        failing.add(c.command);
        el.repositoryPath = '/repo/b';
        await flush(el);

        expect(
          (el as unknown as { contextMenu: { visible: boolean } }).contextMenu.visible,
          'a failed load still disarms the menu'
        ).to.equal(false);
      });
    });
  }
});
