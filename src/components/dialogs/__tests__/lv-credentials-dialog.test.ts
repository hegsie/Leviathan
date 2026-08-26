/**
 * Credentials Dialog Tests
 *
 * Covers removing credential helpers: a URL-scoped helper can live in any git
 * config file, so the removal has to be aimed at the file git reported
 * (`configScope`), not at the "url" badge.
 */

import { expect, fixture, html } from '@open-wc/testing';
import type { CredentialHelper } from '../../../services/git.service.ts';

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const invokeCalls: Array<{ command: string; args?: unknown }> = [];
let mockHelpers: CredentialHelper[] = [];
/**
 * When set, `unset_credential_helper` rejects with this — but only for a call
 * aimed at the config file the helper actually lives in. A removal pointed at
 * the wrong file resolves and changes nothing, which is what the backend does
 * (and the silent no-op this dialog used to produce).
 */
let unsetFailure: { message: string } | null = null;

/** Does this `unset_credential_helper` call target `mockHelpers[0]`'s file? */
function aimedAtHelperFile(args: unknown): boolean {
  const params = (args ?? {}) as { path?: string | null; global?: boolean };
  return mockHelpers[0]?.configScope === 'global'
    ? params.global === true
    : params.global !== true && typeof params.path === 'string' && params.path.length > 0;
}

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  invokeCalls.push({ command, args });

  switch (command) {
    case 'get_credential_helpers':
      return mockHelpers;
    case 'get_available_helpers':
      return [];
    case 'get_remotes':
      return [];
    case 'detect_credential_manager':
      return null;
    case 'unset_credential_helper':
      if (!aimedAtHelperFile(args)) return null;
      if (unsetFailure) throw unsetFailure;
      mockHelpers = [];
      return null;
    // showConfirm() resolves true when the dialog plugin answers "Ok".
    case 'plugin:dialog|message':
      return 'Ok';
    default:
      return null;
  }
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import the component AFTER setting up the mock
import '../lv-credentials-dialog.ts';
import type { LvCredentialsDialog } from '../lv-credentials-dialog.ts';

function urlHelper(configScope: string): CredentialHelper {
  return {
    name: 'manager',
    command: 'manager',
    scope: 'url',
    configScope,
    urlPattern: 'https://github.com',
  };
}

async function openDialog(): Promise<LvCredentialsDialog> {
  const el = await fixture<LvCredentialsDialog>(
    html`<lv-credentials-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-credentials-dialog>`,
  );
  // Wait for loadData() to resolve and render the helper list.
  await waitFor(() => el.shadowRoot!.querySelectorAll('.helper-item').length > 0);
  return el;
}

async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function unsetCalls(): Array<Record<string, unknown>> {
  return invokeCalls
    .filter((c) => c.command === 'unset_credential_helper')
    .map((c) => c.args as Record<string, unknown>);
}

describe('lv-credentials-dialog helper removal', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    unsetFailure = null;
    mockHelpers = [];
  });

  it('unsets a URL helper stored in the global config with --global', async () => {
    mockHelpers = [urlHelper('global')];
    const el = await openDialog();

    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('.helper-item .btn-icon.danger')!;
    expect(btn.disabled).to.be.false;
    btn.click();

    await waitFor(() => unsetCalls().length > 0);
    expect(unsetCalls()[0]).to.deep.equal({
      path: null,
      global: true,
      urlPattern: 'https://github.com',
    });
  });

  it('unsets a URL helper stored in the repository config against the pinned repo', async () => {
    mockHelpers = [urlHelper('local')];
    const el = await openDialog();

    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('.helper-item .btn-icon.danger')!;
    btn.click();

    await waitFor(() => unsetCalls().length > 0);
    expect(unsetCalls()[0]).to.deep.equal({
      path: '/test/repo',
      global: false,
      urlPattern: 'https://github.com',
    });
  });

  it('refuses to remove a system-scoped helper and says why', async () => {
    mockHelpers = [urlHelper('system')];
    const el = await openDialog();

    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('.helper-item .btn-icon.danger')!;
    expect(btn.disabled).to.be.true;

    await (
      el as unknown as { handleRemoveHelper: (h: CredentialHelper) => Promise<void> }
    ).handleRemoveHelper(mockHelpers[0]);
    await el.updateComplete;

    expect(unsetCalls()).to.have.length(0);
    const banner = el.shadowRoot!.querySelector('.error-banner');
    expect(banner).to.not.be.null;
    expect(banner!.textContent).to.include('system');
  });

  it('shows the error when the backend refuses the removal', async () => {
    mockHelpers = [urlHelper('local')];
    unsetFailure = { message: 'could not lock config file' };
    const el = await openDialog();

    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('.helper-item .btn-icon.danger')!;
    btn.click();

    await waitFor(() => el.shadowRoot!.querySelector('.error-banner') !== null);
    const banner = el.shadowRoot!.querySelector('.error-banner');
    expect(banner!.textContent).to.include('could not lock config file');
    // The helper it failed to remove is still listed.
    expect(el.shadowRoot!.querySelectorAll('.helper-item')).to.have.length(1);
  });
});
