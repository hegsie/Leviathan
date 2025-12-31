import { expect } from '@open-wc/testing';
import type {
  MigrationPreview,
  MigrationPreviewProfile,
  MigrationPreviewAccount,
  UnmatchedAccount,
  UnifiedMigrationResult,
} from '../../../types/unified-profile.types.ts';

// Mock Tauri API
const mockInvoke = (command: string): Promise<unknown> => {
  switch (command) {
    case 'needs_unified_profiles_migration':
      return Promise.resolve({ success: true, data: false });
    case 'preview_unified_profiles_migration':
      return Promise.resolve({ success: true, data: { profiles: [], unmatchedAccounts: [] } });
    case 'execute_unified_profiles_migration':
      return Promise.resolve({
        success: true,
        data: { success: true, profilesMigrated: 0, accountsMigrated: 0, unmatchedAccounts: [], errors: [] },
      });
    default:
      return Promise.resolve({ success: true, data: null });
  }
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('Migration Dialog Data Structures', () => {
  describe('MigrationPreview', () => {
    it('should have correct structure for empty migration', () => {
      const preview: MigrationPreview = {
        profiles: [],
        unmatchedAccounts: [],
      };

      expect(preview.profiles).to.deep.equal([]);
      expect(preview.unmatchedAccounts).to.deep.equal([]);
    });

    it('should have correct structure with matched accounts', () => {
      const preview: MigrationPreview = {
        profiles: [
          {
            profileId: 'profile-1',
            profileName: 'Work',
            gitEmail: 'john@company.com',
            matchedAccounts: [
              {
                accountId: 'account-1',
                accountName: 'Work GitHub',
                integrationType: 'github',
              },
              {
                accountId: 'account-2',
                accountName: 'Work GitLab',
                integrationType: 'gitlab',
              },
            ],
          },
        ],
        unmatchedAccounts: [],
      };

      expect(preview.profiles).to.have.lengthOf(1);
      expect(preview.profiles[0].matchedAccounts).to.have.lengthOf(2);
    });

    it('should have correct structure with unmatched accounts', () => {
      const preview: MigrationPreview = {
        profiles: [
          {
            profileId: 'profile-1',
            profileName: 'Work',
            gitEmail: 'john@company.com',
            matchedAccounts: [],
          },
        ],
        unmatchedAccounts: [
          {
            accountId: 'orphan-1',
            accountName: 'Old Account',
            integrationType: 'github',
            suggestedProfileId: 'profile-1',
          },
          {
            accountId: 'orphan-2',
            accountName: 'No Match Account',
            integrationType: 'azure-devops',
            suggestedProfileId: null,
          },
        ],
      };

      expect(preview.unmatchedAccounts).to.have.lengthOf(2);
      expect(preview.unmatchedAccounts[0].suggestedProfileId).to.equal('profile-1');
      expect(preview.unmatchedAccounts[1].suggestedProfileId).to.be.null;
    });
  });

  describe('MigrationPreviewProfile', () => {
    it('should contain profile info and matched accounts', () => {
      const profile: MigrationPreviewProfile = {
        profileId: 'test-id',
        profileName: 'Personal',
        gitEmail: 'user@gmail.com',
        matchedAccounts: [
          {
            accountId: 'gh-1',
            accountName: 'Personal GitHub',
            integrationType: 'github',
          },
        ],
      };

      expect(profile.profileId).to.equal('test-id');
      expect(profile.profileName).to.equal('Personal');
      expect(profile.gitEmail).to.equal('user@gmail.com');
      expect(profile.matchedAccounts).to.have.lengthOf(1);
    });
  });

  describe('MigrationPreviewAccount', () => {
    it('should have account identification info', () => {
      const account: MigrationPreviewAccount = {
        accountId: 'acc-123',
        accountName: 'Enterprise GitHub',
        integrationType: 'github',
      };

      expect(account.accountId).to.equal('acc-123');
      expect(account.accountName).to.equal('Enterprise GitHub');
      expect(account.integrationType).to.equal('github');
    });

    it('should support all integration types', () => {
      const types: Array<'github' | 'gitlab' | 'azure-devops'> = ['github', 'gitlab', 'azure-devops'];

      types.forEach((type) => {
        const account: MigrationPreviewAccount = {
          accountId: `${type}-1`,
          accountName: `${type} Account`,
          integrationType: type,
        };
        expect(account.integrationType).to.equal(type);
      });
    });
  });

  describe('UnmatchedAccount', () => {
    it('should have suggestion for possible profile', () => {
      const account: UnmatchedAccount = {
        accountId: 'unmatched-1',
        accountName: 'Orphan Account',
        integrationType: 'gitlab',
        suggestedProfileId: 'suggested-profile',
      };

      expect(account.suggestedProfileId).to.equal('suggested-profile');
    });

    it('should allow null suggestion when no match possible', () => {
      const account: UnmatchedAccount = {
        accountId: 'unmatched-1',
        accountName: 'No Match Account',
        integrationType: 'azure-devops',
        suggestedProfileId: null,
      };

      expect(account.suggestedProfileId).to.be.null;
    });
  });

  describe('UnifiedMigrationResult', () => {
    it('should have correct structure for successful migration', () => {
      const result: UnifiedMigrationResult = {
        success: true,
        profilesMigrated: 2,
        accountsMigrated: 5,
        unmatchedAccounts: [],
        errors: [],
      };

      expect(result.success).to.be.true;
      expect(result.profilesMigrated).to.equal(2);
      expect(result.accountsMigrated).to.equal(5);
      expect(result.unmatchedAccounts).to.deep.equal([]);
      expect(result.errors).to.deep.equal([]);
    });

    it('should have correct structure for partial migration', () => {
      const result: UnifiedMigrationResult = {
        success: true,
        profilesMigrated: 2,
        accountsMigrated: 3,
        unmatchedAccounts: [
          {
            accountId: 'orphan-1',
            accountName: 'Old Account',
            integrationType: 'github',
            suggestedProfileId: null,
          },
        ],
        errors: [],
      };

      expect(result.success).to.be.true;
      expect(result.unmatchedAccounts).to.have.lengthOf(1);
    });

    it('should have correct structure for failed migration', () => {
      const result: UnifiedMigrationResult = {
        success: false,
        profilesMigrated: 0,
        accountsMigrated: 0,
        unmatchedAccounts: [],
        errors: ['Failed to read config file', 'Permission denied'],
      };

      expect(result.success).to.be.false;
      expect(result.errors).to.have.lengthOf(2);
    });
  });

  describe('Account assignments', () => {
    it('should be a mapping of account ID to profile ID', () => {
      const assignments: Record<string, string> = {
        'account-1': 'profile-1',
        'account-2': 'profile-1',
        'account-3': 'profile-2',
      };

      expect(Object.keys(assignments)).to.have.lengthOf(3);
      expect(assignments['account-1']).to.equal('profile-1');
    });

    it('should handle multiple accounts assigned to same profile', () => {
      const assignments: Record<string, string> = {
        'github-work': 'work-profile',
        'gitlab-work': 'work-profile',
        'azure-work': 'work-profile',
      };

      const profileCounts = Object.values(assignments).reduce(
        (acc, profileId) => {
          acc[profileId] = (acc[profileId] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      expect(profileCounts['work-profile']).to.equal(3);
    });
  });

  describe('Migration workflow', () => {
    it('should process assignment changes correctly', () => {
      // Initial assignments from preview
      const initialAssignments: Record<string, string> = {
        'account-1': 'profile-1', // Suggested by system
        'account-2': 'profile-1',
      };

      // User changes assignment for account-1
      const updatedAssignments: Record<string, string> = {
        ...initialAssignments,
        'account-1': 'profile-2',
      };

      expect(updatedAssignments['account-1']).to.equal('profile-2');
      expect(updatedAssignments['account-2']).to.equal('profile-1');
    });

    it('should initialize assignments from unmatched accounts with suggestions', () => {
      const unmatchedAccounts: UnmatchedAccount[] = [
        {
          accountId: 'acc-1',
          accountName: 'Account 1',
          integrationType: 'github',
          suggestedProfileId: 'profile-1',
        },
        {
          accountId: 'acc-2',
          accountName: 'Account 2',
          integrationType: 'gitlab',
          suggestedProfileId: null,
        },
      ];

      const defaultProfileId = 'default-profile';

      // Build initial assignments
      const assignments: Record<string, string> = {};
      for (const account of unmatchedAccounts) {
        assignments[account.accountId] = account.suggestedProfileId ?? defaultProfileId;
      }

      expect(assignments['acc-1']).to.equal('profile-1');
      expect(assignments['acc-2']).to.equal('default-profile');
    });
  });

  describe('Migration state transitions', () => {
    it('should track step progression', () => {
      type MigrationStep = 'loading' | 'preview' | 'migrating' | 'complete' | 'error';

      let currentStep: MigrationStep = 'loading';

      // Load preview
      currentStep = 'preview';
      expect(currentStep).to.equal('preview');

      // Start migration
      currentStep = 'migrating';
      expect(currentStep).to.equal('migrating');

      // Complete
      currentStep = 'complete';
      expect(currentStep).to.equal('complete');
    });

    it('should handle error state', () => {
      type MigrationStep = 'loading' | 'preview' | 'migrating' | 'complete' | 'error';

      let currentStep: MigrationStep = 'loading';
      let errorMessage: string | null = null;

      // Simulate error during loading
      currentStep = 'error';
      errorMessage = 'Failed to load migration preview';

      expect(currentStep).to.equal('error');
      expect(errorMessage).to.not.be.null;
    });
  });

  describe('Empty state handling', () => {
    it('should detect when no profiles exist', () => {
      const preview: MigrationPreview = {
        profiles: [],
        unmatchedAccounts: [
          {
            accountId: 'acc-1',
            accountName: 'Account 1',
            integrationType: 'github',
            suggestedProfileId: null,
          },
        ],
      };

      const hasProfiles = preview.profiles.length > 0;
      const hasUnmatchedAccounts = preview.unmatchedAccounts.length > 0;

      expect(hasProfiles).to.be.false;
      expect(hasUnmatchedAccounts).to.be.true;
    });

    it('should detect when no accounts need migration', () => {
      const preview: MigrationPreview = {
        profiles: [
          {
            profileId: 'p1',
            profileName: 'Work',
            gitEmail: 'work@example.com',
            matchedAccounts: [],
          },
        ],
        unmatchedAccounts: [],
      };

      const totalAccounts =
        preview.profiles.reduce((sum, p) => sum + p.matchedAccounts.length, 0) +
        preview.unmatchedAccounts.length;

      expect(totalAccounts).to.equal(0);
    });
  });
});
