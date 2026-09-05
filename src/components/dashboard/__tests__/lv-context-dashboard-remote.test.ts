/**
 * The dashboard's Fetch / Pull / Push buttons.
 *
 * These are a THIRD surface for the same three operations the toolbar and the
 * command palette expose, and they had drifted: failures came out as a raw
 * git.service toast with no recovery action, the failure was additionally
 * written to `repositoryStore.setError` (which nothing in the app renders), and
 * a pull that produced conflicts was reported as a plain red failure and left
 * the repository mid-merge with no route to the resolution dialog.
 */

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
const invoked: Array<{ command: string; args?: unknown }> = [];
let failures = new Map<string, { code?: string; message: string }>();

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invoked.push({ command, args });
    const failure = failures.get(command);
    if (failure) return Promise.reject(failure);
    if (command === 'get_remote_status') {
      return Promise.resolve({ ahead: 0, behind: 0 });
    }
    return Promise.resolve(null);
  },
  transformCallback: () => 0,
};

import { expect, fixture, html } from '@open-wc/testing';
import '../lv-context-dashboard.ts';
import type { LvContextDashboard } from '../lv-context-dashboard.ts';
import { repositoryStore } from '../../../stores/repository.store.ts';
import { settingsStore } from '../../../stores/settings.store.ts';
import { uiStore } from '../../../stores/ui.store.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const REPO = {
  path: '/repo/a',
  name: 'repo-a',
  isValid: true,
  isBare: false,
  headRef: 'refs/heads/main',
  state: 'clean',
  isShallow: false,
  isPartialClone: false,
  cloneFilter: null,
};

async function dashboard(): Promise<LvContextDashboard> {
  repositoryStore.setState({
    openRepositories: [
      {
        repository: REPO,
        branches: [],
        currentBranch: null,
        remotes: [],
        tags: [],
        stashes: [],
      },
    ] as any,
    activeIndex: 0,
  } as any);
  const el = await fixture<LvContextDashboard>(
    html`<lv-context-dashboard></lv-context-dashboard>`,
  );
  await el.updateComplete;
  return el;
}

function toastText(): string {
  return uiStore.getState().toasts.map((t) => `${t.type}:${t.message}`).join(' | ');
}

describe('dashboard remote operations', () => {
  beforeEach(() => {
    invoked.length = 0;
    failures = new Map();
    uiStore.setState({ toasts: [] });
    settingsStore.setState({ offlineMode: false, confirmNetworkOps: false, remoteAllowlist: [] });
  });

  afterEach(() => {
    settingsStore.setState({ offlineMode: false, confirmNetworkOps: false, remoteAllowlist: [] });
  });

  it('leaves the success message to the backend event', async () => {
    // The Rust command emits `remote-operation-completed` and
    // setupRemoteOperationListeners toasts it, naming the remote. These
    // handlers adding their own stacked two messages on one click — the rule
    // the toolbar handlers already follow and document.
    const el = await dashboard();
    uiStore.setState({ toasts: [] });

    await (el as any).handleFetch();

    const successes = uiStore.getState().toasts.filter((t) => t.type === 'success');
    expect(successes.length, 'exactly one owner of the message').to.equal(0);
  });

  it('a rejected push offers the recovery action instead of a raw message', async () => {
    // The toolbar's Push routes through the suggestion service so a rejection
    // becomes a Pull Now button. Reaching the identical operation from the
    // dashboard must not silently drop that.
    const el = await dashboard();
    failures.set('push', {
      code: 'COMMAND_ERROR',
      message: 'Updates were rejected: non-fast-forward',
    });
    uiStore.setState({ toasts: [] });

    await (el as any).handlePush();

    const toast = uiStore.getState().toasts.find((t) => t.type === 'error');
    expect(toast, 'the failure is reported').to.not.be.undefined;
    expect(toast!.action?.label, 'with the action the app already implements').to.equal('Pull Now');
  });

  it('a pull that conflicts opens the conflict dialog rather than dead-ending', async () => {
    const el = await dashboard();
    failures.set('pull', { code: 'MERGE_CONFLICT', message: 'conflicts in 2 files' });
    uiStore.setState({ toasts: [] });

    let detail: { repositoryPath?: string; operationType?: string } | null = null;
    const handler = (e: Event): void => {
      detail = (e as CustomEvent<{ repositoryPath?: string; operationType?: string }>).detail;
    };
    el.addEventListener('merge-conflict', handler);
    try {
      await (el as any).handlePull();
    } finally {
      el.removeEventListener('merge-conflict', handler);
    }

    expect(detail, 'the resolution dialog is asked for').to.not.be.null;
    expect(detail!.repositoryPath).to.equal('/repo/a');
    expect(detail!.operationType).to.equal('merge');
    expect(toastText(), 'and it is not reported as a red failure').to.not.contain('error:');
  });

  it('a rebasing pull that conflicts asks for the rebase flavour of the dialog', async () => {
    const el = await dashboard();
    failures.set('pull', { code: 'REBASE_CONFLICT', message: 'conflicts in 1 file' });
    uiStore.setState({ toasts: [] });

    let detail: { operationType?: string } | null = null;
    const handler = (e: Event): void => {
      detail = (e as CustomEvent<{ operationType?: string }>).detail;
    };
    el.addEventListener('merge-conflict', handler);
    try {
      await (el as any).handlePull();
    } finally {
      el.removeEventListener('merge-conflict', handler);
    }

    // Continuing a rebase is not committing a merge — the dialog's Complete and
    // Abort actions differ, so the type has to travel with the event.
    expect(detail!.operationType).to.equal('rebase');
  });

  it('a security-gate block is not reported back as an error', async () => {
    const el = await dashboard();
    settingsStore.setState({ offlineMode: true });
    uiStore.setState({ toasts: [] });

    await (el as any).handleFetch();

    expect(
      uiStore.getState().toasts.some((t) => t.type === 'error'),
      "the user's own offline setting is not a failure",
    ).to.equal(false);
    expect(invoked.some((c) => c.command === 'fetch')).to.equal(false);
  });

  // ── cancellation ─────────────────────────────────────────────────────────
  //
  // These are the most visible fetch/pull/push buttons in the app and they
  // showed no progress row at all, so the whole cancellation flow was
  // unreachable from them even once the backend supported it.

  describe('cancellation', () => {
    async function progress() {
      return (await import('../../../services/progress.service.ts')).progressService;
    }

    for (const op of ['fetch', 'pull', 'push'] as const) {
      const handler = `handle${op[0].toUpperCase()}${op.slice(1)}`;

      it(`${op} shows a cancellable row and passes its id to the backend`, async () => {
        const service = await progress();
        const rows: Array<{ id: string; cancellable?: boolean }> = [];
        const unsubscribe = service.subscribe((ops) => {
          for (const o of ops) if (!rows.some((r) => r.id === o.id)) rows.push({ ...o });
        });
        try {
          const el = await dashboard();
          await (el as any)[handler]();

          const call = invoked.find((c) => c.command === op);
          expect(call, `${op} invoked`).to.not.be.undefined;
          const operationId = (call!.args as { operationId?: string }).operationId;
          expect(
            rows.some((r) => r.id === operationId && r.cancellable === true),
            `${op} must run under a cancellable row the backend can find`,
          ).to.equal(true);
        } finally {
          unsubscribe();
        }
      });

      it(`${op} removes its row when it finishes`, async () => {
        const service = await progress();
        const el = await dashboard();

        await (el as any)[handler]();

        expect(
          service.getOperations().length,
          `${op} must not leave a spinner behind`,
        ).to.equal(0);
      });

      it(`a cancelled ${op} says so instead of showing a failure`, async () => {
        failures.set(op, { code: 'OPERATION_CANCELLED', message: 'Operation cancelled' });
        const el = await dashboard();
        uiStore.setState({ toasts: [] });

        await (el as any)[handler]();

        expect(
          uiStore.getState().toasts.some((t) => t.type === 'error'),
          `a cancelled ${op} is not a red failure`,
        ).to.equal(false);
        expect(toastText()).to.match(/cancelled/i);
      });

      it(`a genuine ${op} failure is still reported as one`, async () => {
        failures.set(op, { code: 'COMMAND_ERROR', message: 'remote hung up' });
        const el = await dashboard();
        uiStore.setState({ toasts: [] });

        await (el as any)[handler]();

        expect(toastText()).to.contain('remote hung up');
        expect(
          (await progress()).getOperations().length,
          'the row is cleared on failure too',
        ).to.equal(0);
      });
    }
  });
});
