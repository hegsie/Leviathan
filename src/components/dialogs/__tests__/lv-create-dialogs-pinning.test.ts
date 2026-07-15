/**
 * Multi-repo pinning tests for the create-tag and create-branch dialogs.
 *
 * Both dialogs' `repositoryPath` property is bound live to the active tab in
 * app-shell. If the user opens the dialog on repo A and switches tabs to repo B
 * while the modal is open, Create must still target repo A (the repo the dialog
 * was opened for), and the created event must carry A so the host pins its
 * refresh there — not silently mutate/refresh B.
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
import type { LvCreateTagDialog } from '../lv-create-tag-dialog.ts';
import type { LvCreateBranchDialog } from '../lv-create-branch-dialog.ts';
import '../lv-create-tag-dialog.ts';
import '../lv-create-branch-dialog.ts';

const REPO_A = '/repo/a';
const REPO_B = '/repo/b';

describe('create-tag / create-branch dialog pinning', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    mockInvoke = () => Promise.resolve(null);
  });

  it('create-tag targets the repo it was opened for after a mid-dialog tab switch', async () => {
    const el = await fixture<LvCreateTagDialog>(
      html`<lv-create-tag-dialog .repositoryPath=${REPO_A}></lv-create-tag-dialog>`,
    );
    await el.updateComplete;

    let detail: { repositoryPath?: string } | null = null;
    el.addEventListener('tag-created', (e) => {
      detail = (e as CustomEvent<{ repositoryPath?: string }>).detail;
    });

    // Open the dialog on repo A, then switch the (live) prop to repo B.
    el.open();
    await el.updateComplete;
    el.repositoryPath = REPO_B;
    await el.updateComplete;

    // Fill in a non-annotated tag and create.
    const internal = el as unknown as {
      name: string;
      isAnnotated: boolean;
      handleCreate: () => Promise<void>;
    };
    internal.name = 'v1.0.0';
    internal.isAnnotated = false;
    invokeCalls.length = 0;
    await internal.handleCreate();

    const call = invokeCalls.find((c) => c.command === 'create_tag');
    expect(call, 'create_tag called').to.not.be.undefined;
    expect((call!.args as { path: string }).path).to.equal(REPO_A);
    expect(detail, 'tag-created dispatched').to.not.be.null;
    expect(detail!.repositoryPath).to.equal(REPO_A);
  });

  it('create-tag exposes its pinned repo only while open, for host self-close', async () => {
    const el = await fixture<LvCreateTagDialog>(
      html`<lv-create-tag-dialog .repositoryPath=${REPO_A}></lv-create-tag-dialog>`,
    );
    await el.updateComplete;

    expect(el.pinnedRepositoryPathIfOpen, 'null before open').to.be.null;
    el.open();
    await el.updateComplete;
    expect(el.pinnedRepositoryPathIfOpen, 'pinned repo while open').to.equal(REPO_A);
    el.close();
    expect(el.pinnedRepositoryPathIfOpen, 'null after close').to.be.null;
  });

  it('create-branch targets the repo it was opened for after a mid-dialog tab switch', async () => {
    const el = await fixture<LvCreateBranchDialog>(
      html`<lv-create-branch-dialog .repositoryPath=${REPO_A}></lv-create-branch-dialog>`,
    );
    await el.updateComplete;

    let detail: { repositoryPath?: string } | null = null;
    el.addEventListener('branch-created', (e) => {
      detail = (e as CustomEvent<{ repositoryPath?: string }>).detail;
    });

    el.open();
    await el.updateComplete;
    el.repositoryPath = REPO_B;
    await el.updateComplete;

    const internal = el as unknown as {
      branchName: string;
      handleCreate: () => Promise<void>;
    };
    internal.branchName = 'feature/x';
    invokeCalls.length = 0;
    await internal.handleCreate();

    const call = invokeCalls.find((c) => c.command === 'create_branch');
    expect(call, 'create_branch called').to.not.be.undefined;
    expect((call!.args as { path: string }).path).to.equal(REPO_A);
    expect(detail, 'branch-created dispatched').to.not.be.null;
    expect(detail!.repositoryPath).to.equal(REPO_A);
  });

  it('create-branch exposes its pinned repo only while open, for host self-close', async () => {
    const el = await fixture<LvCreateBranchDialog>(
      html`<lv-create-branch-dialog .repositoryPath=${REPO_A}></lv-create-branch-dialog>`,
    );
    await el.updateComplete;

    expect(el.pinnedRepositoryPathIfOpen, 'null before open').to.be.null;
    el.open();
    await el.updateComplete;
    expect(el.pinnedRepositoryPathIfOpen, 'pinned repo while open').to.equal(REPO_A);
    el.close();
    expect(el.pinnedRepositoryPathIfOpen, 'null after close').to.be.null;
  });
});
