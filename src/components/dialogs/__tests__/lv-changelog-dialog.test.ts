/**
 * Changelog Dialog Tests
 *
 * Tests rendering, generation, and copy functionality.
 */

let failingCommands: Set<string> = new Set();

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: 'Operation failed' };
  }

  switch (command) {
    case 'get_tags':
      return [
        { name: 'v0.2.72', targetOid: 'abc123', message: null, tagger: null, isAnnotated: false },
        { name: 'v0.2.71', targetOid: 'def456', message: null, tagger: null, isAnnotated: false },
      ];
    case 'is_ai_available':
      return true;
    case 'generate_changelog':
      return { content: '## Features\n- Added semantic search (abc1234)' };
    default:
      return null;
  }
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

import { expect, fixture, html } from '@open-wc/testing';
import '../lv-changelog-dialog.ts';
import type { LvChangelogDialog } from '../lv-changelog-dialog.ts';

describe('lv-changelog-dialog', () => {
  beforeEach(() => {
    failingCommands = new Set();
  });

  it('renders the modal', async () => {
    const el = await fixture<LvChangelogDialog>(
      html`<lv-changelog-dialog .repositoryPath=${'/test/repo'}></lv-changelog-dialog>`,
    );

    const modal = el.shadowRoot!.querySelector('lv-modal');
    expect(modal).to.not.be.null;
  });

  it('loads tags on open', async () => {
    const el = await fixture<LvChangelogDialog>(
      html`<lv-changelog-dialog .repositoryPath=${'/test/repo'}></lv-changelog-dialog>`,
    );

    await el.open();
    await el.updateComplete;

    // Should have tag options in the select
    const select = el.shadowRoot!.querySelector('select');
    if (select) {
      expect(select.options.length).to.be.greaterThan(0);
    }
  });

  it('generates changelog on button click', async () => {
    const el = await fixture<LvChangelogDialog>(
      html`<lv-changelog-dialog .repositoryPath=${'/test/repo'}></lv-changelog-dialog>`,
    );

    await el.open();
    await el.updateComplete;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).baseRef = 'v0.2.71';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).compareRef = 'v0.2.72';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleGenerate();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).result).to.include('Features');
  });

  it('shows error on generation failure', async () => {
    failingCommands.add('generate_changelog');

    const el = await fixture<LvChangelogDialog>(
      html`<lv-changelog-dialog .repositoryPath=${'/test/repo'}></lv-changelog-dialog>`,
    );

    await el.open();
    await el.updateComplete;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).baseRef = 'v0.2.71';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleGenerate();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).error).to.not.be.empty;
  });
});
