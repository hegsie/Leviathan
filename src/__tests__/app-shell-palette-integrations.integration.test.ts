/**
 * Integration tests for app-shell command-palette integration entries.
 *
 * Wave 5a: account setup is repo-independent. The GitHub/GitLab/Bitbucket/
 * Azure DevOps/OIDC palette entries (and the Profiles & Accounts entry) must
 * open their dialogs even when NO repository is open, without emitting the
 * "Please open a repository first" warning toast.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';
import type { AppShell } from '../app-shell.ts';
import { uiStore } from '../stores/ui.store.ts';
import '../app-shell.ts';

interface PaletteCommand {
  id: string;
  label: string;
  action: () => void;
}

function createAppShellNoRepo(): AppShell {
  const el = document.createElement('lv-app-shell') as AppShell;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any).activeRepository = null;
  return el;
}

function getCommand(el: AppShell, id: string): PaletteCommand {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commands: PaletteCommand[] = (el as any).getPaletteCommands();
  const cmd = commands.find((c) => c.id === id);
  if (!cmd) throw new Error(`palette command "${id}" not found`);
  return cmd;
}

describe('app-shell palette integration entries (no repo required)', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
  });

  const cases: Array<{ id: string; flag: string }> = [
    { id: 'github', flag: 'showGitHub' },
    { id: 'gitlab', flag: 'showGitLab' },
    { id: 'bitbucket', flag: 'showBitbucket' },
    { id: 'azure-devops', flag: 'showAzureDevOps' },
    { id: 'oidc', flag: 'showOidc' },
    { id: 'profiles', flag: 'showProfileManager' },
  ];

  for (const { id, flag } of cases) {
    it(`"${id}" opens its dialog with no repository and shows no warning toast`, () => {
      const el = createAppShellNoRepo();
      const cmd = getCommand(el, id);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any)[flag], `${flag} starts false`).to.not.equal(true);

      cmd.action();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any)[flag], `${flag} set true`).to.equal(true);
      const warnings = uiStore.getState().toasts.filter(
        (t) => t.message === 'Please open a repository first',
      );
      expect(warnings.length, 'no requiresRepository warning toast').to.equal(0);
    });
  }

  it('"profiles" palette entry is labelled "Profiles & Accounts"', () => {
    const el = createAppShellNoRepo();
    expect(getCommand(el, 'profiles').label).to.equal('Profiles & Accounts');
  });

  it('a repo-gated command (e.g. repository-health) still warns with no repo open', () => {
    const el = createAppShellNoRepo();
    getCommand(el, 'repository-health').action();
    const warnings = uiStore.getState().toasts.filter(
      (t) => t.message === 'Please open a repository first',
    );
    expect(warnings.length, 'gated command still warns').to.be.greaterThan(0);
  });
});
