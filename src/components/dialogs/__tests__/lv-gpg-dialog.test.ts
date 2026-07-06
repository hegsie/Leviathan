/**
 * GPG Dialog setup-detection tests
 *
 * Regression coverage for finding 98: an SSH signer (gpg.format=ssh with a
 * configured user.signingkey) must NOT be pushed into the "generate a GPG key"
 * setup flow just because no GPG keyring keys exist.
 */

// Mock Tauri API before importing any modules that use it
const mockInvoke = (): Promise<unknown> => Promise.resolve(null);
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
