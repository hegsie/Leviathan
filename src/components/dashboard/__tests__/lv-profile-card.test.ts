import { expect } from '@open-wc/testing';
import type { UnifiedProfile, ProfileAssignmentSource } from '../../../types/unified-profile.types.ts';
import { PROFILE_COLORS } from '../../../types/unified-profile.types.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('LvProfileCard Data Structures', () => {
  const mockProfile: UnifiedProfile = {
    id: 'test-profile-id',
    name: 'Work',
    gitName: 'John Doe',
    gitEmail: 'john@company.com',
    signingKey: 'ABC123',
    urlPatterns: ['github.com/company/*'],
    isDefault: true,
    color: PROFILE_COLORS[0],
    defaultAccounts: {
      github: 'github-account-1',
    },
  };

  describe('UnifiedProfile type', () => {
    it('should have required id field', () => {
      expect(mockProfile.id).to.equal('test-profile-id');
    });

    it('should have required name field', () => {
      expect(mockProfile.name).to.equal('Work');
    });

    it('should have git identity fields', () => {
      expect(mockProfile.gitName).to.equal('John Doe');
      expect(mockProfile.gitEmail).to.equal('john@company.com');
    });

    it('should support optional signing key', () => {
      expect(mockProfile.signingKey).to.equal('ABC123');

      const profileWithoutKey: UnifiedProfile = { ...mockProfile, signingKey: null };
      expect(profileWithoutKey.signingKey).to.be.null;
    });

    it('should have isDefault flag', () => {
      expect(mockProfile.isDefault).to.be.true;

      const nonDefaultProfile: UnifiedProfile = { ...mockProfile, isDefault: false };
      expect(nonDefaultProfile.isDefault).to.be.false;
    });

    it('should have color from PROFILE_COLORS', () => {
      expect(mockProfile.color).to.equal(PROFILE_COLORS[0]);
      expect(PROFILE_COLORS.length).to.be.greaterThan(0);
    });

    it('should have defaultAccounts mapping', () => {
      expect(mockProfile.defaultAccounts).to.have.property('github');
      expect(mockProfile.defaultAccounts.github).to.equal('github-account-1');
    });

    it('should have urlPatterns array', () => {
      expect(mockProfile.urlPatterns).to.be.an('array');
      expect(mockProfile.urlPatterns.length).to.equal(1);
    });
  });

  describe('ProfileAssignmentSource type', () => {
    it('should support manual assignment', () => {
      const source: ProfileAssignmentSource = 'manual';
      expect(source).to.equal('manual');
    });

    it('should support url-pattern assignment', () => {
      const source: ProfileAssignmentSource = 'url-pattern';
      expect(source).to.equal('url-pattern');
    });

    it('should support default assignment', () => {
      const source: ProfileAssignmentSource = 'default';
      expect(source).to.equal('default');
    });

    it('should support none assignment', () => {
      const source: ProfileAssignmentSource = 'none';
      expect(source).to.equal('none');
    });
  });

  describe('assignment source labels', () => {
    function getAssignmentSourceLabel(source: ProfileAssignmentSource): string {
      switch (source) {
        case 'manual':
          return 'Manually assigned';
        case 'url-pattern':
          return 'Matched by URL pattern';
        case 'default':
          return 'Default profile';
        default:
          return '';
      }
    }

    it('should return correct label for manual', () => {
      expect(getAssignmentSourceLabel('manual')).to.equal('Manually assigned');
    });

    it('should return correct label for url-pattern', () => {
      expect(getAssignmentSourceLabel('url-pattern')).to.equal('Matched by URL pattern');
    });

    it('should return correct label for default', () => {
      expect(getAssignmentSourceLabel('default')).to.equal('Default profile');
    });

    it('should return empty string for none', () => {
      expect(getAssignmentSourceLabel('none')).to.equal('');
    });
  });
});
