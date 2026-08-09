/**
 * GPG Dialog setup-detection tests
 *
 * Regression coverage for finding 98: an SSH signer (gpg.format=ssh with a
 * configured user.signingkey) must NOT be pushed into the "generate a GPG key"
 * setup flow just because no GPG keyring keys exist.
 */

// Mock Tauri API before importing any modules that use it
/** Commands that reject with a git error, e.g. a read-only .git/config. */
let failingCommands: Set<string> = new Set();
/** Config the backend reports, per repository path. */
const configByRepo = new Map<string, unknown>();

const mockInvoke = (command: string, args?: unknown): Promise<unknown> => {
  if (failingCommands.has(command)) {
    return Promise.reject({ code: 'COMMAND_ERROR', message: 'could not lock config file' });
  }
  if (command === 'get_gpg_config') {
    const path = ((args as { path?: string }) ?? {}).path ?? '';
    return Promise.resolve(configByRepo.get(path) ?? null);
  }
  if (command === 'get_gpg_keys') return Promise.resolve([]);
  return Promise.resolve(null);
};
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

import { expect, fixture, html } from '@open-wc/testing';
import '../lv-gpg-dialog.ts';
import type { LvGpgDialog } from '../lv-gpg-dialog.ts';
import type { GpgConfig } from '../../../services/git.service.ts';

function makeConfig(overrides: Partial<GpgConfig>): GpgConfig {
  return {
    gpgAvailable: false,
    gpgVersion: null,
    signingKey: null,
    signCommits: false,
    signTags: false,
    gpgProgram: null,
    gpgFormat: null,
    ...overrides,
  };
}

interface DialogInternals {
  config: GpgConfig | null;
  keys: unknown[];
  setupMode: boolean;
  setupStep: string;
  detectSetupState(): void;
}

describe('lv-gpg-dialog SSH signing setup detection', () => {
  it('does not force a configured SSH signer into GPG generate-guide mode', async () => {
    const el = await fixture<LvGpgDialog>(
      html`<lv-gpg-dialog></lv-gpg-dialog>`
    );
    const internals = el as unknown as DialogInternals;
    // SSH signing configured, but no GPG keyring keys (the common case).
    internals.config = makeConfig({
      gpgFormat: 'ssh',
      gpgAvailable: true,
      gpgVersion: 'gpg (GnuPG) 2.2.27',
      signingKey: '~/.ssh/id_ed25519.pub',
    });
    internals.keys = [];

    internals.detectSetupState();

    expect(internals.setupMode).to.equal(false);
  });

  it('prompts SSH users to configure a key only when none is set', async () => {
    const el = await fixture<LvGpgDialog>(
      html`<lv-gpg-dialog></lv-gpg-dialog>`
    );
    const internals = el as unknown as DialogInternals;
    internals.config = makeConfig({ gpgFormat: 'ssh', signingKey: null });
    internals.keys = [];

    internals.detectSetupState();

    expect(internals.setupMode).to.equal(true);
    expect(internals.setupStep).to.equal('configure');
  });
});

// Both banners render unconditionally, and nothing ever cleared `success`:
// a green "Commit signing enabled" therefore sat under the red error of the
// NEXT toggle, and survived close/reopen to be replayed over another
// repository's settings.
describe('lv-gpg-dialog banner lifecycle', () => {
  const REPO_A = '/repo/a';
  const REPO_B = '/repo/b';

  beforeEach(() => {
    failingCommands = new Set();
    configByRepo.clear();
    configByRepo.set(
      REPO_A,
      makeConfig({ gpgAvailable: true, gpgVersion: 'gpg (GnuPG) 2.2.27', signingKey: 'KEY1' }),
    );
    configByRepo.set(
      REPO_B,
      makeConfig({ gpgAvailable: true, gpgVersion: 'gpg (GnuPG) 2.2.27', signingKey: 'KEY2' }),
    );
  });

  async function openOn(path: string): Promise<LvGpgDialog> {
    const el = await fixture<LvGpgDialog>(
      html`<lv-gpg-dialog ?open=${true} .repositoryPath=${path}></lv-gpg-dialog>`,
    );
    for (let i = 0; i < 200; i++) {
      if ((el as unknown as DialogInternals).config) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    await el.updateComplete;
    return el;
  }

  function banners(el: LvGpgDialog): { success: string | null; error: string | null } {
    const root = el.shadowRoot!;
    return {
      success: root.querySelector('.message.success')?.textContent?.trim() ?? null,
      error: root.querySelector('.message.error')?.textContent?.trim() ?? null,
    };
  }

  it('a failed toggle does not render under the previous toggle\'s success', async () => {
    const el = await openOn(REPO_A);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleToggleCommitSigning();
    await el.updateComplete;
    expect(banners(el).success, 'the first toggle reports').to.contain('Commit signing');

    // The second toggle fails — a read-only .git/config, a missing key, or
    // --global scope the user cannot write.
    failingCommands.add('set_tag_signing');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleToggleTagSigning();
    await el.updateComplete;

    const after = banners(el);
    expect(after.error, 'the failure is reported').to.not.be.null;
    expect(after.success, 'and the stale green banner is gone').to.be.null;
  });

  it('the same holds for every sibling handler', async () => {
    // Each of the three handlers sets `success`, so each of them has to clear
    // it — one straggler is enough to put a green banner over a red one.
    const el = await openOn(REPO_A);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleToggleTagSigning();
    await el.updateComplete;
    expect(banners(el).success).to.contain('Tag signing');

    failingCommands.add('set_commit_signing');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleToggleCommitSigning();
    await el.updateComplete;
    expect(banners(el).error, 'the commit-signing failure is reported').to.not.be.null;
    expect(banners(el).success, 'no stale tag-signing banner beside it').to.be.null;

    failingCommands.delete('set_commit_signing');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleSelectKey('KEY1');
    await el.updateComplete;
    expect(banners(el).success).to.contain('Signing key');

    failingCommands.add('set_signing_key');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleSelectKey('KEY2');
    await el.updateComplete;
    expect(banners(el).error, 'the key failure is reported').to.not.be.null;
    expect(banners(el).success, 'no stale key banner beside it').to.be.null;
  });

  it('a success does not survive close, repository switch and reopen', async () => {
    const el = await openOn(REPO_A);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleToggleCommitSigning();
    await el.updateComplete;
    expect(banners(el).success).to.contain('Commit signing');

    // The dialog stays mounted; the host only toggles ?open. Ctrl+Tab then
    // rebinds repositoryPath to another repository.
    el.open = false;
    await el.updateComplete;
    el.repositoryPath = REPO_B;
    el.open = true;
    await el.updateComplete;
    for (let i = 0; i < 200; i++) {
      if ((el as unknown as DialogInternals).config === configByRepo.get(REPO_B)) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    await el.updateComplete;

    expect(
      banners(el).success,
      'repo B never had its commit signing enabled',
    ).to.be.null;
  });

  it('the loaders do not blank a message the user just asked for', async () => {
    // loadData() runs AFTER a handler has set its message (Refresh & Check
    // calls it directly), so clearing there would erase the result.
    const el = await openOn(REPO_A);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleToggleCommitSigning();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleRefreshAndCheck();
    await el.updateComplete;

    expect(banners(el).success, 'still on screen after a reload').to.contain('Commit signing');
  });
});
