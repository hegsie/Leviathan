/**
 * Profile Manager Dialog Tests
 *
 * These render the REAL lv-profile-manager-dialog component, mock only the
 * Tauri invoke layer and stores, and verify the actual component code calls
 * the right commands and renders the correct UI.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const invokeHistory: Array<{ command: string; args?: unknown }> = [];
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import { unifiedProfileStore } from '../../../stores/unified-profile.store.ts';
import { repositoryStore } from '../../../stores/repository.store.ts';
import type { UnifiedProfile, IntegrationAccount } from '../../../types/unified-profile.types.ts';
import { PROFILE_COLORS } from '../../../types/unified-profile.types.ts';

// Import the actual component — registers <lv-profile-manager-dialog> custom element
import '../lv-profile-manager-dialog.ts';
import type { LvProfileManagerDialog } from '../lv-profile-manager-dialog.ts';

// ── Test data ──────────────────────────────────────────────────────────────
function makeProfile(overrides: Partial<UnifiedProfile> = {}): UnifiedProfile {
  return {
    id: 'profile-1',
    name: 'Work',
    gitName: 'John Doe',
    gitEmail: 'john@work.com',
    signingKey: null,
    urlPatterns: [],
    isDefault: false,
    color: PROFILE_COLORS[0],
    defaultAccounts: {},
    ...overrides,
  };
}

function makeAccount(overrides: Partial<IntegrationAccount> = {}): IntegrationAccount {
  return {
    id: 'account-1',
    name: 'Work GitHub',
    integrationType: 'github',
    config: { type: 'github' },
    color: null,
    cachedUser: null,
    urlPatterns: [],
    isDefault: false,
    ...overrides,
  };
}

const workProfile = makeProfile();
const personalProfile = makeProfile({
  id: 'profile-2',
  name: 'Personal',
  gitName: 'John Personal',
  gitEmail: 'john@personal.com',
  isDefault: true,
  color: PROFILE_COLORS[1],
  urlPatterns: ['github.com/personal/*'],
  defaultAccounts: { github: 'account-2' },
});

const githubAccount = makeAccount();
const gitlabAccount = makeAccount({
  id: 'account-2',
  name: 'Personal GitLab',
  integrationType: 'gitlab',
  config: { type: 'gitlab', instanceUrl: 'https://gitlab.com' },
  isDefault: true,
  cachedUser: { username: 'johndoe', displayName: 'John', avatarUrl: null, email: 'john@personal.com' },
});

const testProfiles: UnifiedProfile[] = [workProfile, personalProfile];
const testAccounts: IntegrationAccount[] = [githubAccount, gitlabAccount];

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

function setupDefaultMocks(): void {
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_unified_profiles_config':
        return {
          version: 3,
          profiles: testProfiles,
          accounts: testAccounts,
          repositoryAssignments: { '/repo/work': 'profile-1' },
        };
      case 'get_migration_backup_info':
        return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
      case 'save_unified_profile':
        return testProfiles[0];
      case 'delete_unified_profile':
        return null;
      case 'save_global_account':
        return testAccounts[0];
      case 'delete_global_account':
        return null;
      case 'apply_unified_profile':
        return null;
      default:
        return null;
    }
  };
}

function setupStoreState(): void {
  const store = unifiedProfileStore.getState();
  store.setConfig({
    version: 3,
    profiles: testProfiles,
    accounts: testAccounts,
    repositoryAssignments: { '/repo/work': 'profile-1' },
  });
  store.setLoading(false);

  // Set up repository store with recent repos
  const repoStore = repositoryStore.getState();
  repoStore.addRecentRepository('/repo/work', 'work');
  repoStore.addRecentRepository('/repo/personal', 'personal');
}

async function renderDialog(props: { open?: boolean; repoPath?: string } = {}): Promise<LvProfileManagerDialog> {
  const { open = true, repoPath = '/test/repo' } = props;
  const el = await fixture<LvProfileManagerDialog>(
    html`<lv-profile-manager-dialog .open=${open} .repoPath=${repoPath}></lv-profile-manager-dialog>`
  );
  await el.updateComplete;
  // Allow async loadProfiles to settle
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-profile-manager-dialog', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
    setupStoreState();
  });

  afterEach(() => {
    // Reset store state
    unifiedProfileStore.getState().reset();
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders nothing when open is false', async () => {
      const el = await renderDialog({ open: false });
      const overlay = el.shadowRoot!.querySelector('.dialog-overlay');
      expect(overlay).to.be.null;
    });

    it('renders the dialog overlay and dialog when open', async () => {
      const el = await renderDialog();
      const overlay = el.shadowRoot!.querySelector('.dialog-overlay');
      expect(overlay).to.not.be.null;
      const dialog = el.shadowRoot!.querySelector('.dialog');
      expect(dialog).to.not.be.null;
    });

    it('displays "Profiles" as the default dialog title', async () => {
      const el = await renderDialog();
      const title = el.shadowRoot!.querySelector('.dialog-title');
      expect(title).to.not.be.null;
      expect(title!.textContent).to.include('Profiles');
    });

    it('renders the profile list with all profiles', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      expect(profileItems.length).to.equal(2);
    });

    it('displays profile name, git identity, and color in the list', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');

      // First profile: Work
      const firstItem = profileItems[0];
      const name = firstItem.querySelector('.profile-name');
      expect(name!.textContent).to.include('Work');

      const email = firstItem.querySelector('.profile-email');
      expect(email!.textContent).to.include('John Doe');
      expect(email!.textContent).to.include('john@work.com');

      const colorDot = firstItem.querySelector('.profile-color') as HTMLElement;
      expect(colorDot).to.not.be.null;
    });

    it('shows the "Default" badge on the default profile', async () => {
      const el = await renderDialog();
      const badges = el.shadowRoot!.querySelectorAll('.default-badge');
      expect(badges.length).to.equal(1);
      // Personal profile is the default
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      const personalItem = profileItems[1];
      const badge = personalItem.querySelector('.default-badge');
      expect(badge).to.not.be.null;
      expect(badge!.textContent).to.include('Default');
    });

    it('shows URL pattern count in profile meta when patterns exist', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      // Personal profile has 1 URL pattern
      const personalItem = profileItems[1];
      const meta = personalItem.querySelector('.profile-meta');
      expect(meta!.textContent).to.include('1 pattern');
    });

    it('shows "New Profile" button in footer on list view', async () => {
      const el = await renderDialog();
      const buttons = el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary');
      const newProfileBtn = Array.from(buttons).find(
        (btn) => btn.textContent?.trim().includes('New Profile')
      );
      expect(newProfileBtn).to.not.be.undefined;
    });
  });

  // ── Empty state ────────────────────────────────────────────────────────
  describe('empty state', () => {
    it('shows empty state when no profiles exist', async () => {
      // Override mock to return empty config so loadProfiles populates empty state
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: [], accounts: [], repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          default:
            return null;
        }
      };
      unifiedProfileStore.getState().setConfig({
        version: 3,
        profiles: [],
        accounts: [],
        repositoryAssignments: {},
      });

      const el = await renderDialog();
      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.not.be.null;
      expect(emptyState!.textContent).to.include('No profiles yet');
    });
  });

  // ── Create profile ─────────────────────────────────────────────────────
  describe('create profile', () => {
    it('switches to create view when "New Profile" is clicked', async () => {
      const el = await renderDialog();
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;

      newProfileBtn.click();
      await el.updateComplete;

      const title = el.shadowRoot!.querySelector('.dialog-title');
      expect(title!.textContent).to.include('New Profile');
    });

    it('shows form fields for profile name, git name, git email, signing key, URL patterns', async () => {
      const el = await renderDialog();
      // Navigate to create view
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      const inputs = el.shadowRoot!.querySelectorAll('.form-group input, .form-group textarea');
      // Profile Name, Git Name, Git Email, Signing Key, URL Patterns (textarea)
      expect(inputs.length).to.be.greaterThanOrEqual(4);

      // Check for labels
      const labels = el.shadowRoot!.querySelectorAll('.form-group label');
      const labelTexts = Array.from(labels).map((l) => l.textContent?.trim());
      expect(labelTexts).to.include('Profile Name');
      expect(labelTexts).to.include('Git Name');
      expect(labelTexts).to.include('Git Email');
    });

    it('shows "Save Profile" and "Cancel" buttons in create mode', async () => {
      const el = await renderDialog();
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      const footerButtons = el.shadowRoot!.querySelectorAll('.dialog-footer .btn');
      const buttonTexts = Array.from(footerButtons).map((b) => b.textContent?.trim());
      expect(buttonTexts.some((t) => t?.includes('Save Profile'))).to.be.true;
      expect(buttonTexts.some((t) => t?.includes('Cancel'))).to.be.true;
    });

    it('calls save_unified_profile with form data when Save is clicked', async () => {
      // Make save return a success
      mockInvoke = async (command: string, args?: unknown) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: testProfiles, accounts: testAccounts, repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          case 'save_unified_profile': {
            const typedArgs = args as { profile: UnifiedProfile };
            return typedArgs.profile;
          }
          default:
            return null;
        }
      };

      const el = await renderDialog();
      // Navigate to create
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      // Fill in form
      const inputs = el.shadowRoot!.querySelectorAll('.form-group input') as NodeListOf<HTMLInputElement>;
      // Profile name input
      const nameInput = inputs[0];
      nameInput.value = 'Test Profile';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      // Git name input
      const gitNameInput = inputs[1];
      gitNameInput.value = 'Test User';
      gitNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      // Git email input
      const gitEmailInput = inputs[2];
      gitEmailInput.value = 'test@example.com';
      gitEmailInput.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      clearHistory();

      // Click Save Profile
      const saveBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('Save Profile')) as HTMLButtonElement;
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const saveCalls = findCommands('save_unified_profile');
      expect(saveCalls.length).to.equal(1);
      const savedProfile = (saveCalls[0].args as { profile: UnifiedProfile }).profile;
      expect(savedProfile.name).to.equal('Test Profile');
      expect(savedProfile.gitName).to.equal('Test User');
      expect(savedProfile.gitEmail).to.equal('test@example.com');
    });
  });

  // ── Edit profile ───────────────────────────────────────────────────────
  describe('edit profile', () => {
    it('switches to edit view when a profile is clicked', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      const title = el.shadowRoot!.querySelector('.dialog-title');
      expect(title!.textContent).to.include('Edit Profile');
    });

    it('populates the form with the selected profile data', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      const inputs = el.shadowRoot!.querySelectorAll('.form-group input') as NodeListOf<HTMLInputElement>;
      // Profile name
      expect(inputs[0].value).to.equal('Work');
      // Git name
      expect(inputs[1].value).to.equal('John Doe');
      // Git email
      expect(inputs[2].value).to.equal('john@work.com');
    });

    it('shows back button in edit view that navigates to list', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      const backBtn = el.shadowRoot!.querySelector('.back-btn') as HTMLButtonElement;
      expect(backBtn).to.not.be.null;

      backBtn.click();
      await el.updateComplete;

      const title = el.shadowRoot!.querySelector('.dialog-title');
      expect(title!.textContent).to.include('Profiles');
    });

    it('calls save_unified_profile when Save is clicked in edit mode', async () => {
      mockInvoke = async (command: string, args?: unknown) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: testProfiles, accounts: testAccounts, repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          case 'save_unified_profile': {
            const typedArgs = args as { profile: UnifiedProfile };
            return typedArgs.profile;
          }
          default:
            return null;
        }
      };

      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      // Edit the name
      const inputs = el.shadowRoot!.querySelectorAll('.form-group input') as NodeListOf<HTMLInputElement>;
      inputs[0].value = 'Work Updated';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      clearHistory();

      const saveBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('Save Profile')) as HTMLButtonElement;
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const saveCalls = findCommands('save_unified_profile');
      expect(saveCalls.length).to.equal(1);
      const savedProfile = (saveCalls[0].args as { profile: UnifiedProfile }).profile;
      expect(savedProfile.name).to.equal('Work Updated');
      expect(savedProfile.id).to.equal('profile-1');
    });
  });

  // ── Delete profile ─────────────────────────────────────────────────────
  describe('delete profile', () => {
    it('renders a delete button for each profile in the list', async () => {
      const el = await renderDialog();
      const deleteButtons = el.shadowRoot!.querySelectorAll('.action-btn.delete');
      expect(deleteButtons.length).to.equal(2);
    });

    it('calls delete_unified_profile when delete is confirmed', async () => {
      // showConfirm uses Tauri dialog plugin — mock it to return true
      const prevInvoke = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'plugin:dialog|confirm') return true;
        return prevInvoke(command, args);
      };

      const el = await renderDialog();
      const deleteButtons = el.shadowRoot!.querySelectorAll('.action-btn.delete');

      clearHistory();
      (deleteButtons[0] as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const deleteCalls = findCommands('delete_unified_profile');
      expect(deleteCalls.length).to.equal(1);
      expect((deleteCalls[0].args as { profileId: string }).profileId).to.equal('profile-1');

      mockInvoke = prevInvoke;
    });

    it('does NOT call delete_unified_profile when delete is cancelled', async () => {
      // showConfirm uses Tauri dialog plugin — mock it to return false
      const prevInvoke = mockInvoke;
      mockInvoke = async (command: string, args?: unknown) => {
        if (command === 'plugin:dialog|confirm') return false;
        return prevInvoke(command, args);
      };

      const el = await renderDialog();
      const deleteButtons = el.shadowRoot!.querySelectorAll('.action-btn.delete');

      clearHistory();
      (deleteButtons[0] as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const deleteCalls = findCommands('delete_unified_profile');
      expect(deleteCalls.length).to.equal(0);

      mockInvoke = prevInvoke;
    });
  });

  // ── Form validation ────────────────────────────────────────────────────
  describe('form validation', () => {
    it('does not call save_unified_profile when profile name is empty', async () => {
      const el = await renderDialog();
      // Navigate to create
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      // Fill only git fields but not profile name
      const inputs = el.shadowRoot!.querySelectorAll('.form-group input') as NodeListOf<HTMLInputElement>;
      inputs[1].value = 'Some User';
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[2].value = 'user@test.com';
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      clearHistory();

      const saveBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('Save Profile')) as HTMLButtonElement;
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const saveCalls = findCommands('save_unified_profile');
      expect(saveCalls.length).to.equal(0);
    });

    it('does not call save_unified_profile when git name is empty', async () => {
      const el = await renderDialog();
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      const inputs = el.shadowRoot!.querySelectorAll('.form-group input') as NodeListOf<HTMLInputElement>;
      // Set profile name only
      inputs[0].value = 'My Profile';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      // Leave git name empty, set email
      inputs[2].value = 'user@test.com';
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      clearHistory();

      const saveBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('Save Profile')) as HTMLButtonElement;
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(findCommands('save_unified_profile').length).to.equal(0);
    });

    it('does not call save_unified_profile when git email is empty', async () => {
      const el = await renderDialog();
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      const inputs = el.shadowRoot!.querySelectorAll('.form-group input') as NodeListOf<HTMLInputElement>;
      inputs[0].value = 'My Profile';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1].value = 'Some User';
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      // Leave email empty
      await el.updateComplete;

      clearHistory();

      const saveBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('Save Profile')) as HTMLButtonElement;
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(findCommands('save_unified_profile').length).to.equal(0);
    });
  });

  // ── Color selection ────────────────────────────────────────────────────
  describe('color selection', () => {
    it('renders color options in the create/edit form', async () => {
      const el = await renderDialog();
      // Navigate to create
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      const colorOptions = el.shadowRoot!.querySelectorAll('.color-option');
      expect(colorOptions.length).to.equal(PROFILE_COLORS.length);
    });

    it('marks the first color as selected by default for new profile', async () => {
      const el = await renderDialog();
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      const selectedColor = el.shadowRoot!.querySelector('.color-option.selected') as HTMLElement;
      expect(selectedColor).to.not.be.null;
      // The first color option in the picker should be the selected one
      const allColors = el.shadowRoot!.querySelectorAll('.color-option');
      expect(selectedColor).to.equal(allColors[0]);
    });

    it('updates selected color when a color option is clicked', async () => {
      mockInvoke = async (command: string, args?: unknown) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: testProfiles, accounts: testAccounts, repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          case 'save_unified_profile': {
            const typedArgs = args as { profile: UnifiedProfile };
            return typedArgs.profile;
          }
          default:
            return null;
        }
      };

      const el = await renderDialog();
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      // Click the third color
      const colorOptions = el.shadowRoot!.querySelectorAll('.color-option');
      (colorOptions[2] as HTMLElement).click();
      await el.updateComplete;

      const selectedColor = el.shadowRoot!.querySelector('.color-option.selected') as HTMLElement;
      expect(selectedColor).to.not.be.null;
      // Third color option should now be the selected one
      expect(selectedColor).to.equal(colorOptions[2]);
    });
  });

  // ── URL patterns ───────────────────────────────────────────────────────
  describe('URL patterns', () => {
    it('renders a textarea for URL patterns', async () => {
      const el = await renderDialog();
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.form-group textarea') as HTMLTextAreaElement;
      expect(textarea).to.not.be.null;
    });

    it('populates URL patterns textarea when editing a profile with patterns', async () => {
      const el = await renderDialog();
      // Click on Personal profile which has URL patterns
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[1] as HTMLElement).click();
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.form-group textarea') as HTMLTextAreaElement;
      expect(textarea).to.not.be.null;
      expect(textarea.value).to.include('github.com/personal/*');
    });

    it('saves URL patterns correctly from textarea input', async () => {
      mockInvoke = async (command: string, args?: unknown) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: testProfiles, accounts: testAccounts, repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          case 'save_unified_profile': {
            const typedArgs = args as { profile: UnifiedProfile };
            return typedArgs.profile;
          }
          default:
            return null;
        }
      };

      const el = await renderDialog();
      // Click to edit Work profile
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.form-group textarea') as HTMLTextAreaElement;
      textarea.value = 'github.com/work/*\ngitlab.com/company/*';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      clearHistory();

      const saveBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('Save Profile')) as HTMLButtonElement;
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const saveCalls = findCommands('save_unified_profile');
      expect(saveCalls.length).to.equal(1);
      const savedProfile = (saveCalls[0].args as { profile: UnifiedProfile }).profile;
      expect(savedProfile.urlPatterns).to.deep.equal(['github.com/work/*', 'gitlab.com/company/*']);
    });
  });

  // ── Account list in profile form ──────────────────────────────────────
  describe('accounts section', () => {
    it('shows integration accounts section in edit/create view', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      const sectionTitles = el.shadowRoot!.querySelectorAll('.form-section-title');
      const accountsTitle = Array.from(sectionTitles).find(
        (t) => t.textContent?.includes('Integration Accounts')
      );
      expect(accountsTitle).to.not.be.undefined;
    });

    it('lists global accounts in the accounts section', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      const accountItems = el.shadowRoot!.querySelectorAll('.account-item');
      expect(accountItems.length).to.be.greaterThanOrEqual(2);
    });

    it('shows account name and type badge for each account', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      const accountNames = el.shadowRoot!.querySelectorAll('.account-name');
      const nameTexts = Array.from(accountNames).map((n) => n.textContent?.trim());
      expect(nameTexts.some((t) => t?.includes('Work GitHub'))).to.be.true;
      expect(nameTexts.some((t) => t?.includes('Personal GitLab'))).to.be.true;

      const typeBadges = el.shadowRoot!.querySelectorAll('.type-badge');
      expect(typeBadges.length).to.be.greaterThanOrEqual(2);
    });

    it('shows empty accounts warning when no accounts exist', async () => {
      // Override mock to return config with no accounts
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: testProfiles, accounts: [], repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          default:
            return null;
        }
      };
      unifiedProfileStore.getState().setConfig({
        version: 3,
        profiles: testProfiles,
        accounts: [],
        repositoryAssignments: {},
      });

      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      const warning = el.shadowRoot!.querySelector('.empty-accounts.warning');
      expect(warning).to.not.be.null;
      expect(warning!.textContent).to.include('No integration accounts configured');
    });
  });

  // ── Default account per integration type ───────────────────────────────
  describe('default account per integration type', () => {
    it('shows "Default" badge on the default account', async () => {
      const el = await renderDialog();
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      // gitlabAccount has isDefault: true
      const defaultBadges = el.shadowRoot!.querySelectorAll('.account-item .default-badge');
      expect(defaultBadges.length).to.be.greaterThanOrEqual(1);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────
  describe('error handling', () => {
    it('handles save failure gracefully without crashing', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: testProfiles, accounts: testAccounts, repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          case 'save_unified_profile':
            throw new Error('Save failed!');
          default:
            return null;
        }
      };

      const el = await renderDialog();
      // Navigate to create
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      // Fill required fields
      const inputs = el.shadowRoot!.querySelectorAll('.form-group input') as NodeListOf<HTMLInputElement>;
      inputs[0].value = 'Error Profile';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1].value = 'Error User';
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[2].value = 'error@test.com';
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      // Click save - should not throw
      const saveBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('Save Profile')) as HTMLButtonElement;
      saveBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Component should still be rendered and not crashed
      const dialog = el.shadowRoot!.querySelector('.dialog');
      expect(dialog).to.not.be.null;
    });

    it('handles delete failure gracefully', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: testProfiles, accounts: testAccounts, repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          case 'delete_unified_profile':
            throw new Error('Delete failed!');
          case 'plugin:dialog|confirm':
            return true;
          default:
            return null;
        }
      };

      const el = await renderDialog();
      const deleteButtons = el.shadowRoot!.querySelectorAll('.action-btn.delete');
      (deleteButtons[0] as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Component should still be rendered
      const dialog = el.shadowRoot!.querySelector('.dialog');
      expect(dialog).to.not.be.null;
    });

    it('handles account removal failure gracefully', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_unified_profiles_config':
            return { version: 3, profiles: testProfiles, accounts: testAccounts, repositoryAssignments: {} };
          case 'get_migration_backup_info':
            return { hasBackup: false, backupDate: null, profilesCount: null, accountsCount: null };
          case 'delete_global_account':
            throw new Error('Account removal failed!');
          case 'plugin:dialog|confirm':
            return true;
          default:
            return null;
        }
      };

      const el = await renderDialog();
      // Go to edit view
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      // Click remove on the first account
      const removeButtons = el.shadowRoot!.querySelectorAll('.account-actions .action-btn.delete');
      if (removeButtons.length > 0) {
        (removeButtons[0] as HTMLButtonElement).click();
        await new Promise((r) => setTimeout(r, 100));
        await el.updateComplete;
      }

      // Component should still be rendered
      const dialog = el.shadowRoot!.querySelector('.dialog');
      expect(dialog).to.not.be.null;
    });
  });

  // ── Dialog open/close behavior ─────────────────────────────────────────
  describe('dialog open/close behavior', () => {
    it('dispatches "close" event when close button is clicked', async () => {
      const el = await renderDialog();

      let closeFired = false;
      el.addEventListener('close', () => { closeFired = true; });

      const closeBtn = el.shadowRoot!.querySelector('.close-btn') as HTMLButtonElement;
      closeBtn.click();
      await el.updateComplete;

      expect(closeFired).to.be.true;
    });

    it('dispatches "close" event when clicking the overlay background', async () => {
      const el = await renderDialog();

      let closeFired = false;
      el.addEventListener('close', () => { closeFired = true; });

      const overlay = el.shadowRoot!.querySelector('.dialog-overlay') as HTMLElement;
      // Click on the overlay itself (not the dialog within it)
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      expect(closeFired).to.be.true;
    });

    it('loads profiles when dialog is opened', async () => {
      clearHistory();
      await renderDialog({ open: true });

      const loadCalls = findCommands('get_unified_profiles_config');
      expect(loadCalls.length).to.be.greaterThan(0);
    });

    it('resets to list view and clears editing state on close', async () => {
      const el = await renderDialog();
      // Navigate to edit
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[0] as HTMLElement).click();
      await el.updateComplete;

      let title = el.shadowRoot!.querySelector('.dialog-title');
      expect(title!.textContent).to.include('Edit Profile');

      // Close and re-open
      const closeBtn = el.shadowRoot!.querySelector('.close-btn') as HTMLButtonElement;
      closeBtn.click();
      await el.updateComplete;

      el.open = true;
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      title = el.shadowRoot!.querySelector('.dialog-title');
      expect(title!.textContent).to.include('Profiles');
    });
  });

  // ── Duplicate profile ──────────────────────────────────────────────────
  describe('duplicate profile', () => {
    it('shows duplicate button for each profile', async () => {
      const el = await renderDialog();
      // There are action buttons for each profile; duplicate is the copy icon button
      // (not .delete class)
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      for (const item of Array.from(profileItems)) {
        const actionBtns = item.querySelectorAll('.action-btn:not(.delete)');
        // Should have at least a duplicate button (possibly also apply)
        expect(actionBtns.length).to.be.greaterThanOrEqual(1);
      }
    });
  });

  // ── Apply profile ──────────────────────────────────────────────────────
  describe('apply profile', () => {
    it('shows apply button when repoPath is set', async () => {
      const el = await renderDialog({ repoPath: '/test/repo' });
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      // Each item should have an apply button (checkmark icon)
      for (const item of Array.from(profileItems)) {
        const applyBtn = Array.from(item.querySelectorAll('.action-btn')).find(
          (btn) => btn.getAttribute('title') === 'Apply to current repository'
        );
        expect(applyBtn).to.not.be.undefined;
      }
    });

    it('calls apply_unified_profile when apply button is clicked', async () => {
      const el = await renderDialog({ repoPath: '/test/repo' });

      clearHistory();

      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      const firstItem = profileItems[0];
      const applyBtn = Array.from(firstItem.querySelectorAll('.action-btn')).find(
        (btn) => btn.getAttribute('title') === 'Apply to current repository'
      ) as HTMLButtonElement;
      applyBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const applyCalls = findCommands('apply_unified_profile');
      expect(applyCalls.length).to.equal(1);
      expect((applyCalls[0].args as { path: string; profileId: string }).path).to.equal('/test/repo');
      expect((applyCalls[0].args as { path: string; profileId: string }).profileId).to.equal('profile-1');
    });
  });

  // ── Default checkbox ───────────────────────────────────────────────────
  describe('default profile checkbox', () => {
    it('renders isDefault checkbox in create/edit form', async () => {
      const el = await renderDialog();
      const newProfileBtn = Array.from(
        el.shadowRoot!.querySelectorAll('.dialog-footer .btn-primary')
      ).find((btn) => btn.textContent?.trim().includes('New Profile')) as HTMLButtonElement;
      newProfileBtn.click();
      await el.updateComplete;

      const checkbox = el.shadowRoot!.querySelector('.checkbox-row input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox).to.not.be.null;

      const label = el.shadowRoot!.querySelector('.checkbox-row label');
      expect(label!.textContent).to.include('Set as default profile');
    });

    it('sets isDefault checkbox when editing a default profile', async () => {
      const el = await renderDialog();
      // Click Personal profile which is default
      const profileItems = el.shadowRoot!.querySelectorAll('.profile-item');
      (profileItems[1] as HTMLElement).click();
      await el.updateComplete;

      const checkbox = el.shadowRoot!.querySelector('.checkbox-row input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).to.be.true;
    });
  });
});
