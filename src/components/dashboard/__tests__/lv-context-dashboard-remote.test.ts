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

  it('reports success exactly once', async () => {
    const el = await dashboard();
    uiStore.setState({ toasts: [] });

    await (el as any).handleFetch();

    const successes = uiStore.getState().toasts.filter((t) => t.type === 'success');
    expect(successes.length, 'one confirmation, not zero and not two').to.equal(1);
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
});
