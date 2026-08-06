/**
 * Regression tests for lv-bisect-dialog.
 *
 * The dialog's `repositoryPath` is live-bound to the ACTIVE repository, and
 * repo switching is a document-level keyboard shortcut that fires straight
 * through the dialog's own overlay. That makes two things mandatory:
 *
 *  - every event the dialog dispatches must name the repository the operation
 *    actually ran against, or app-shell refreshes whichever tab happens to be
 *    active instead (every other destructive dialog already does this);
 *  - a mid-session repo switch must re-read status and drop the previous
 *    repo's session, or the dialog displays repo A while its buttons target
 *    repo B — "Bad" would mark a commit bad in the repo the user is not
 *    looking at.
 *
 * `git bisect start` also checks out the midpoint, so starting a bisect moves
 * HEAD exactly as good/bad/skip do and must announce it.
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
import '../lv-bisect-dialog.ts';

const REPO_A = '/repo/a';
const REPO_B = '/repo/b';

interface BisectStatus {
  active: boolean;
  currentCommit?: string | null;
  badCommit?: string | null;
  goodCommits?: string[];
  remaining?: number | null;
  currentStep?: number | null;
  totalSteps?: number | null;
}

function status(overrides: Partial<BisectStatus> = {}): BisectStatus {
  return {
    active: true,
    currentCommit: 'aaaaaaaaaaaa',
    badCommit: 'bbbbbbbbbbbb',
    goodCommits: ['cccccccccccc'],
    remaining: 3,
    currentStep: 1,
    totalSteps: 2,
    ...overrides,
  };
}

/** Status per repository path, so a tab switch yields a different session. */
let statusByPath: Record<string, BisectStatus> = {};
let confirmAnswer = 'Ok';
const dialogPrompts: string[] = [];

function installMock(): void {
  mockInvoke = (command: string, args?: unknown) => {
    const path = (args as { path?: string } | undefined)?.path ?? '';
    switch (command) {
      case 'get_bisect_status':
        return Promise.resolve(statusByPath[path] ?? { active: false });
      case 'get_commit':
        return Promise.resolve({ oid: 'aaaaaaaaaaaa', shortId: 'aaaaaaa', summary: `commit in ${path}` });
      case 'bisect_start':
      case 'bisect_good':
      case 'bisect_bad':
      case 'bisect_skip':
        return Promise.resolve({ status: statusByPath[path] ?? status(), message: 'ok', culprit: null });
      case 'bisect_reset':
        return Promise.resolve(null);
      case 'plugin:dialog|message':
        dialogPrompts.push(String((args as { message?: string })?.message ?? ''));
        // confirm() resolves to (result === okLabel); the default ok is 'Ok'.
        return Promise.resolve(confirmAnswer);
      default:
        return Promise.resolve(null);
    }
  };
}

async function settle(el: HTMLElement & { updateComplete: Promise<unknown> }): Promise<void> {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

type Dialog = HTMLElement & {
  updateComplete: Promise<unknown>;
  repositoryPath: string;
  open: boolean;
};

async function openOn(path: string): Promise<Dialog> {
  const el = await fixture<Dialog>(
    html`<lv-bisect-dialog .repositoryPath=${path} .open=${true}></lv-bisect-dialog>`
  );
  await settle(el);
  return el;
}

function clickAction(el: Dialog, label: string): void {
  const buttons = [...el.shadowRoot!.querySelectorAll('.action-btn')];
  const btn = buttons.find((b) => b.textContent?.includes(label));
  expect(btn, `"${label}" button present`).to.not.be.undefined;
  (btn as HTMLButtonElement).click();
}

describe('lv-bisect-dialog repository targeting', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    statusByPath = { [REPO_A]: status(), [REPO_B]: { active: false } };
    installMock();
  });

  it('names the repository the step ran against in bisect-step', async () => {
    const el = await openOn(REPO_A);

    const seen: Array<string | undefined> = [];
    el.addEventListener('bisect-step', (e) => {
      seen.push((e as CustomEvent<{ repositoryPath?: string }>).detail?.repositoryPath);
    });

    clickAction(el, 'Bad');
    await settle(el);

    expect(seen).to.deep.equal([REPO_A]);
  });

  it('names the repository in bisect-complete when the session is reset', async () => {
    const el = await openOn(REPO_A);

    let detailPath: string | undefined;
    el.addEventListener('bisect-complete', (e) => {
      detailPath = (e as CustomEvent<{ repositoryPath?: string }>).detail?.repositoryPath;
    });

    const resetBtn = [...el.shadowRoot!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Abort Bisect')
    );
    expect(resetBtn, 'Abort Bisect button present').to.not.be.undefined;
    resetBtn!.click();
    await settle(el);

    expect(detailPath).to.equal(REPO_A);
  });

  // `git bisect start` checks out the midpoint: HEAD has moved, so the graph
  // and branch list are stale until something refreshes them. Its three
  // siblings announced the move; this one silently did not.
  it('announces the HEAD move when a bisect is started', async () => {
    statusByPath = { [REPO_A]: { active: false } };
    const el = await openOn(REPO_A);

    let detailPath: string | undefined;
    let fired = 0;
    el.addEventListener('bisect-step', (e) => {
      fired++;
      detailPath = (e as CustomEvent<{ repositoryPath?: string }>).detail?.repositoryPath;
    });

    const inputs = el.shadowRoot!.querySelectorAll<HTMLInputElement>('.commit-input input');
    inputs[0].value = 'HEAD';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = 'v1.0';
    inputs[1].dispatchEvent(new Event('input'));
    await el.updateComplete;

    statusByPath[REPO_A] = status();
    const startBtn = [...el.shadowRoot!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Start Bisect')
    );
    expect(startBtn, 'Start Bisect button present').to.not.be.undefined;
    startBtn!.click();
    await settle(el);

    expect(fired, 'bisect-step dispatched after start').to.equal(1);
    expect(detailPath).to.equal(REPO_A);
  });

  // Repo switching (Ctrl+Tab) is a document-level shortcut and is not blocked
  // by this dialog's overlay, so the binding really does change underneath it.
  it('re-reads status and drops the old session when the repository switches', async () => {
    const el = await openOn(REPO_A);
    expect(el.shadowRoot!.querySelector('.current-commit'), 'repo A session shown').to.not.be.null;

    invokeCalls.length = 0;
    el.repositoryPath = REPO_B;
    await settle(el);

    const statusCalls = invokeCalls.filter((c) => c.command === 'get_bisect_status');
    expect(statusCalls.length, 'status re-read for the new repo').to.be.greaterThan(0);
    expect((statusCalls[0].args as { path: string }).path).to.equal(REPO_B);

    // Repo B has no bisect in progress, so the in-progress surface for repo A
    // must be gone rather than left on screen driving buttons at repo B.
    expect(el.shadowRoot!.querySelector('.current-commit')).to.be.null;
  });

  it('sends the step to the repository shown, not one bound mid-flight', async () => {
    const el = await openOn(REPO_A);
    invokeCalls.length = 0;

    clickAction(el, 'Good');
    // Switch tabs while the command is in flight.
    el.repositoryPath = REPO_B;
    await settle(el);

    const good = invokeCalls.find((c) => c.command === 'bisect_good');
    expect(good, 'bisect_good issued').to.not.be.undefined;
    expect((good!.args as { path: string }).path).to.equal(REPO_A);
  });

  describe('aborting a bisect', () => {
    beforeEach(() => {
      invokeCalls.length = 0;
      dialogPrompts.length = 0;
      confirmAnswer = 'Ok';
      statusByPath = { [REPO_A]: status(), [REPO_B]: { active: false } };
      installMock();
    });

    it('asks first — the session is many decisions git does not record', async () => {
      const el = await openOn(REPO_A);
      confirmAnswer = 'Cancel';
      invokeCalls.length = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleReset();

      expect(
        invokeCalls.some((c) => c.command === 'bisect_reset'),
        'declining leaves the session running',
      ).to.equal(false);
    });

    it('names how much narrowing is discarded', async () => {
      const el = await openOn(REPO_A);
      confirmAnswer = 'Cancel';
      dialogPrompts.length = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleReset();

      const prompt = dialogPrompts.join(' ');
      expect(prompt, 'the step count is stated').to.contain('1 step');
      expect(prompt, 'and that HEAD comes back').to.contain('original HEAD');
    });

    it('declining releases the in-flight flag', async () => {
      const el = await openOn(REPO_A);
      confirmAnswer = 'Cancel';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleReset();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).loading, 'or the dialog wedges').to.equal(false);
    });

    it('confirming aborts and still pins the refresh to the origin repo', async () => {
      const el = await openOn(REPO_A);
      confirmAnswer = 'Ok';
      let detail: { repositoryPath?: string } | null = null;
      el.addEventListener('bisect-complete', (e) => {
        detail = (e as CustomEvent<{ repositoryPath?: string }>).detail;
      });
      invokeCalls.length = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleReset();

      expect(invokeCalls.some((c) => c.command === 'bisect_reset')).to.equal(true);
      expect(detail!.repositoryPath).to.equal(REPO_A);
    });

    it('a double-click raises one prompt', async () => {
      const el = await openOn(REPO_A);
      confirmAnswer = 'Ok';
      dialogPrompts.length = 0;
      invokeCalls.length = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = (el as any).handleReset();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const second = (el as any).handleReset();
      await Promise.all([first, second]);

      expect(dialogPrompts.length, 'one prompt, not two').to.equal(1);
      expect(invokeCalls.filter((c) => c.command === 'bisect_reset').length).to.equal(1);
    });
  });
});
