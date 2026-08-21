/**
 * Tests for user feedback in lv-tag-list.
 *
 * - handleCheckoutTag failure must show the backend error message, not
 *   "[object Object]" (result.error is a CommandError object).
 * - handlePushTag success must show a confirmation toast.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvTagList } from '../lv-tag-list.ts';
import '../lv-tag-list.ts';
import { uiStore } from '../../../stores/ui.store.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeTag(name = 'v1.0.0') {
  return { name, targetOid: 'abc123', message: null, tagger: null, isAnnotated: false };
}

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_tags') return Promise.resolve([]);
  if (command === 'get_tag_sort_mode') return Promise.resolve('name');
  // Confirmation dialogs return the clicked button label; 'Ok' = confirmed.
  if (command === 'plugin:dialog|message') return Promise.resolve('Ok');
  return Promise.resolve(null);
}

type MockRemote = { name: string; url: string; pushUrl: string | null };

/**
 * A mock for the tag-delete flow, which now asks TWO questions: the local
 * confirm, then the remote follow-up. Records every dialog's message so the
 * copy and the dialog count are assertable, and answers them in order.
 */
function deleteFlowMock(options: {
  remotes?: MockRemote[];
  answers?: string[];
  deleteRemoteTag?: () => Promise<unknown>;
}) {
  const dialogMessages: string[] = [];
  const invokes: Array<{ command: string; args?: unknown }> = [];
  const answers = options.answers ?? [];
  let dialogIndex = 0;

  const mock: MockInvoke = (command: string, args?: unknown) => {
    invokes.push({ command, args });
    if (command === 'plugin:dialog|message') {
      dialogMessages.push(String((args as { message?: string } | undefined)?.message ?? ''));
      return Promise.resolve(answers[dialogIndex++] ?? 'Cancel');
    }
    if (command === 'get_remotes') return Promise.resolve(options.remotes ?? []);
    if (command === 'delete_tag') return Promise.resolve(null);
    if (command === 'delete_remote_tag') {
      return options.deleteRemoteTag ? options.deleteRemoteTag() : Promise.resolve(null);
    }
    return defaultMockInvoke(command);
  };

  return { mock, dialogMessages, invokes };
}

/** Run handleDeleteTag against a tag the context menu is open on. */
async function runDeleteTag(el: LvTagList, tagName: string): Promise<void> {
  const tag = makeTag(tagName);
  (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
    visible: true, x: 0, y: 0, tag,
  };
  await (el as unknown as { handleDeleteTag: () => Promise<void> }).handleDeleteTag();
}

async function createComponent(): Promise<LvTagList> {
  mockInvoke = defaultMockInvoke;
  const el = await fixture<LvTagList>(
    html`<lv-tag-list .repositoryPath=${REPO_PATH}></lv-tag-list>`
  );
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-tag-list feedback', () => {
  beforeEach(() => {
    const state = uiStore.getState();
    state.toasts.forEach(t => state.removeToast(t.id));
  });

  it('handleCheckoutTag failure shows the backend message, not [object Object]', async () => {
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'checkout_with_autostash') {
        return Promise.reject({ code: 'CHECKOUT_ERROR', message: 'Local changes would be overwritten' });
      }
      return defaultMockInvoke(command);
    };

    const tag = makeTag('v1.0.0');
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    await (el as unknown as { handleCheckoutTag: () => Promise<void> }).handleCheckoutTag();

    const errorToast = uiStore.getState().toasts.find(t => t.type === 'error');
    expect(errorToast, 'an error toast should be shown').to.not.be.undefined;
    expect(errorToast!.message).to.contain('Local changes would be overwritten');
    expect(errorToast!.message).to.not.contain('[object Object]');
  });

  it('handlePushTag success shows a confirmation toast', async () => {
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'push_tag') return Promise.resolve(null);
      return defaultMockInvoke(command);
    };

    const tag = makeTag('v2.0.0');
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    await (el as unknown as { handlePushTag: () => Promise<void> }).handlePushTag();

    const successToast = uiStore.getState().toasts.find(t => t.type === 'success');
    expect(successToast, 'a success toast should be shown').to.not.be.undefined;
    expect(successToast!.message).to.equal('Pushed tag v2.0.0 to remote');
  });

  it('deleting a tag confirms the destructive operation happened', async () => {
    // The identical delete from the graph's ref menu toasts. Here the only
    // signal was a row disappearing from a list that is often filtered or
    // scrolled away from the deleted row — i.e. no signal at all.
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'delete_tag') return Promise.resolve(null);
      return defaultMockInvoke(command);
    };

    const tag = makeTag('v3.0.0');
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    await (el as unknown as { handleDeleteTag: () => Promise<void> }).handleDeleteTag();

    const successToast = uiStore.getState().toasts.find((t) => t.type === 'success');
    expect(successToast, 'the delete is acknowledged').to.not.be.undefined;
    expect(successToast!.message).to.equal('Deleted tag v3.0.0');
  });

  // ── Remote follow-up ──────────────────────────────────────────────────────
  // delete_tag removes the local ref only, and the tag fetch refspec
  // (refs/tags/*:refs/tags/*) copies a pushed tag straight back — so a
  // "deleted" tag reappeared on the next fetch under a confirm that promised
  // the delete could not be undone.

  const ORIGIN: MockRemote[] = [{ name: 'origin', url: 'https://example.test/r.git', pushUrl: null }];

  it('the delete confirm says the tag survives on the remote', async () => {
    const el = await createComponent();
    const flow = deleteFlowMock({ remotes: ORIGIN, answers: ['Cancel'] });
    mockInvoke = flow.mock;

    await runDeleteTag(el, 'v3.0.0');

    expect(flow.dialogMessages[0], 'the local confirm names the remote copy').to.match(
      /stays on the remote/
    );
    expect(flow.dialogMessages[0]).to.match(/next fetch/);
  });

  it('confirming the follow-up deletes the tag on the remote', async () => {
    const el = await createComponent();
    const flow = deleteFlowMock({ remotes: ORIGIN, answers: ['Ok', 'Ok'] });
    mockInvoke = flow.mock;

    await runDeleteTag(el, 'v3.0.0');

    const remoteDelete = flow.invokes.filter((i) => i.command === 'delete_remote_tag');
    expect(remoteDelete.length, 'the remote copy is deleted too').to.equal(1);
    expect(remoteDelete[0].args).to.deep.include({
      path: REPO_PATH,
      name: 'v3.0.0',
      remote: 'origin',
    });

    const toasts = uiStore.getState().toasts;
    expect(
      toasts.some((t) => t.type === 'success' && t.message === 'Deleted tag v3.0.0 on origin'),
      'the remote delete is acknowledged'
    ).to.be.true;
  });

  it('declining the follow-up leaves the remote tag alone', async () => {
    const el = await createComponent();
    const flow = deleteFlowMock({ remotes: ORIGIN, answers: ['Ok', 'Cancel'] });
    mockInvoke = flow.mock;

    await runDeleteTag(el, 'v3.0.0');

    expect(flow.dialogMessages.length, 'the follow-up was offered').to.equal(2);
    expect(flow.invokes.filter((i) => i.command === 'delete_remote_tag')).to.have.length(0);
    // The local delete is not conditional on the follow-up's answer.
    expect(flow.invokes.filter((i) => i.command === 'delete_tag')).to.have.length(1);
  });

  it('a repo with no remotes is not asked about one', async () => {
    const el = await createComponent();
    const flow = deleteFlowMock({ remotes: [], answers: ['Ok'] });
    mockInvoke = flow.mock;

    await runDeleteTag(el, 'v3.0.0');

    expect(flow.dialogMessages[0]).to.match(/stays on the remote/);
    expect(flow.dialogMessages.length, 'nothing to ask about').to.equal(1);
    expect(flow.invokes.filter((i) => i.command === 'delete_remote_tag')).to.have.length(0);
  });

  it('a failed remote delete is reported to the user', async () => {
    const el = await createComponent();
    const flow = deleteFlowMock({
      remotes: ORIGIN,
      answers: ['Ok', 'Ok'],
      deleteRemoteTag: () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'remote ref does not exist' }),
    });
    mockInvoke = flow.mock;

    await runDeleteTag(el, 'v3.0.0');

    const errorToast = uiStore.getState().toasts.find((t) => t.type === 'error');
    expect(errorToast, 'the failure is not swallowed').to.not.be.undefined;
    expect(errorToast!.message).to.contain('Failed to delete tag v3.0.0 on origin');
    expect(errorToast!.message).to.contain('remote ref does not exist');
  });

  it('a rejected tag push carries the tag name to the Force Push Tag action', async () => {
    // Without it the suggestion renders a button that dispatches an undefined
    // target — a dead affordance on the recovery path.
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'push_tag') {
        return Promise.reject({
          code: 'COMMAND_ERROR',
          message: 'cannot push non-fastforwardable reference',
        });
      }
      return defaultMockInvoke(command);
    };

    const tag = makeTag('v5.0.0');
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    await (el as unknown as { handlePushTag: () => Promise<void> }).handlePushTag();

    const toast = uiStore.getState().toasts.find((t) => t.action?.label === 'Force Push Tag');
    expect(toast, 'the recovery action is offered').to.not.be.undefined;

    let detail: { tagName?: string } | null = null;
    const handler = (e: Event): void => {
      detail = (e as CustomEvent<{ tagName?: string }>).detail;
    };
    window.addEventListener('force-push-tag', handler);
    try {
      toast!.action!.callback();
    } finally {
      window.removeEventListener('force-push-tag', handler);
    }
    expect(detail!.tagName).to.equal('v5.0.0');
  });

  it('handlePushTag pins push + tags-changed to the origin repo after a mid-push tab switch', async () => {
    // Pushing is a slow network op; a tab switch during it rebinds
    // this.repositoryPath. Both the push and the tags-changed refresh must pin
    // to the origin repo so the host refreshes the right (backgrounded) tab.
    const el = await createComponent();

    let resolvePush!: (v: unknown) => void;
    let pushArgs: { path?: string } | null = null;
    mockInvoke = (command: string, args?: unknown) => {
      if (command === 'push_tag') {
        pushArgs = args as { path?: string };
        return new Promise((resolve) => {
          resolvePush = resolve;
        });
      }
      return defaultMockInvoke(command);
    };

    let detail: { repositoryPath?: string } | null = null;
    el.addEventListener('tags-changed', (e) => {
      detail = (e as CustomEvent<{ repositoryPath?: string }>).detail;
    });

    const tag = makeTag('v4.0.0');
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    const promise = (el as unknown as { handlePushTag: () => Promise<void> }).handlePushTag();
    await new Promise((r) => setTimeout(r, 10));
    (el as unknown as { repositoryPath: string }).repositoryPath = '/other/repo';

    resolvePush(null);
    await promise;

    expect(pushArgs, 'push_tag called').to.not.be.null;
    expect(pushArgs!.path).to.equal(REPO_PATH);
    expect(detail, 'tags-changed dispatched').to.not.be.null;
    expect(detail!.repositoryPath).to.equal(REPO_PATH);
  });

  it('tag-checkout carries the repo the checkout ran on, even after a mid-op tab switch', async () => {
    // repoPath is captured BEFORE the checkout await; if .repositoryPath
    // rebinds mid-flight (tab switch), the event must still name the origin
    // repo so the host pins its refresh there, not to the newly-active tab.
    const el = await createComponent();

    let resolveCheckout!: (v: unknown) => void;
    mockInvoke = (command: string) => {
      if (command === 'checkout_with_autostash') {
        return new Promise((resolve) => {
          resolveCheckout = resolve;
        });
      }
      return defaultMockInvoke(command);
    };

    let detail: { repositoryPath?: string } | null = null;
    el.addEventListener('tag-checkout', (e) => {
      detail = (e as CustomEvent<{ repositoryPath?: string }>).detail;
    });

    const tag = makeTag('v3.0.0');
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    const promise = (el as unknown as { handleCheckoutTag: () => Promise<void> }).handleCheckoutTag();
    // Let the confirm resolve and the checkout await begin, then switch tabs.
    await new Promise((r) => setTimeout(r, 10));
    (el as unknown as { repositoryPath: string }).repositoryPath = '/other/repo';

    resolveCheckout({ success: true, data: { success: true, message: 'ok', stashed: false, stashApplied: false, stashConflict: false } });
    await promise;

    expect(detail, 'tag-checkout dispatched').to.not.be.null;
    expect(detail!.repositoryPath).to.equal(REPO_PATH);
  });
});
