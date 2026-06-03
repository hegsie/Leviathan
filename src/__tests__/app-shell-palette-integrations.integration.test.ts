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

// ── Wave 5b: explicit dialog navigation (return targets + attach) ───────────
describe('app-shell explicit integration navigation', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  // The profile manager ref is a read-only @query getter; stub it for tests.
  function stubProfileManager(el: AppShell, stub: unknown): void {
    Object.defineProperty(el, 'profileManagerDialog', {
      configurable: true,
      get: () => stub,
    });
  }

  it('standalone open sets no return context → no Back arrow, no attach name', () => {
    const el = createAppShellNoRepo();
    getCommand(el, 'github').action();
    expect((el as any).showGitHub).to.equal(true);
    expect((el as any).integrationContext, 'no context standalone').to.equal(null);
    expect((el as any).integrationBackButton, 'no back arrow').to.equal(false);
    expect((el as any).integrationAttachName, 'no breadcrumb').to.equal('');
  });

  it('open-from-manager captures the explicit context → Back arrow + breadcrumb', () => {
    const el = createAppShellNoRepo();
    const context = {
      returnTo: 'profile-manager' as const,
      integrationType: 'github' as const,
      profileId: 'p1',
      profileName: 'Work',
      attach: true,
    };
    (el as any).handleOpenIntegrationFromManager('github', { detail: context });
    expect((el as any).showGitHub).to.equal(true);
    expect((el as any).integrationContext).to.deep.equal(context);
    expect((el as any).integrationBackButton, 'back arrow shown').to.equal(true);
    expect((el as any).integrationAttachName, 'breadcrumb name shown').to.equal('Work');
    // The profile manager renders demoted (behind) only via this explicit context.
    expect((el as any).profileManagerDemoted).to.equal(true);
  });

  it('a context with attach:false shows the Back arrow but no breadcrumb', () => {
    const el = createAppShellNoRepo();
    (el as any).handleOpenIntegrationFromManager('oidc', {
      detail: {
        returnTo: 'profile-manager',
        integrationType: 'oidc',
        profileId: '',
        profileName: 'Work',
        attach: false,
      },
    });
    expect((el as any).integrationBackButton).to.equal(true);
    expect((el as any).integrationAttachName, 'no breadcrumb without attach').to.equal('');
  });

  it('closing a from-manager dialog clears context and reveals the manager with attach', () => {
    const el = createAppShellNoRepo();
    const context = {
      returnTo: 'profile-manager' as const,
      integrationType: 'github' as const,
      profileId: 'p1',
      profileName: 'Work',
      attach: true,
    };
    (el as any).handleOpenIntegrationFromManager('github', { detail: context });

    let revealed: unknown = null;
    stubProfileManager(el, {
      revealAfterConnect: (ctx: unknown) => { revealed = ctx; },
      get currentView() { return 'select-account'; },
    });

    (el as any).handleIntegrationDialogClose('github');
    expect((el as any).showGitHub, 'provider dialog closed').to.equal(false);
    expect((el as any).integrationContext, 'context cleared').to.equal(null);
    expect(revealed, 'manager revealed with the explicit context').to.deep.equal(context);
  });

  it('closing a standalone dialog does NOT reveal/attach to the manager', () => {
    const el = createAppShellNoRepo();
    getCommand(el, 'gitlab').action();
    let revealedCalled = false;
    stubProfileManager(el, {
      revealAfterConnect: () => { revealedCalled = true; },
      get currentView() { return 'list'; },
    });
    (el as any).handleIntegrationDialogClose('gitlab');
    expect((el as any).showGitLab).to.equal(false);
    expect(revealedCalled, 'no reveal for standalone close').to.equal(false);
  });

  it('Manage Accounts is reversible: closing the Accounts view reopens the provider', () => {
    const el = createAppShellNoRepo();
    // Simulate a provider dialog open, then "Manage Accounts" from it.
    (el as any).showGitHub = true;
    (el as any).handleManageAccounts({ detail: { integrationType: 'github' } });
    expect((el as any).showGitHub, 'provider dialog closed').to.equal(false);
    expect((el as any).showProfileManager, 'manager opened').to.equal(true);
    expect((el as any).profileManagerView, 'lands on Accounts view').to.equal('accounts');
    // Not demoted — the manager is shown ON TOP (no stacked-overlay context).
    expect((el as any).profileManagerDemoted).to.equal(false);

    // Closing OUT OF the Accounts view returns to the provider dialog.
    (el as any).handleProfileManagerClose({ detail: { fromView: 'accounts' } });
    expect((el as any).showProfileManager).to.equal(false);
    expect((el as any).showGitHub, 'returned to the provider dialog').to.equal(true);
  });

  it('Manage Accounts close does NOT reopen the provider if user navigated off Accounts', () => {
    const el = createAppShellNoRepo();
    (el as any).showGitHub = true;
    (el as any).handleManageAccounts({ detail: { integrationType: 'github' } });
    // User navigated into the profile list; closing should NOT bounce back.
    (el as any).handleProfileManagerClose({ detail: { fromView: 'list' } });
    expect((el as any).showProfileManager).to.equal(false);
    expect((el as any).showGitHub, 'no surprise reopen off Accounts').to.equal(false);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});
