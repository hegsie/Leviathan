import { expect } from '@open-wc/testing';
import {
  DEFAULT_GITFLOW_CONFIG,
  createEmptyProfile,
  PROFILE_COLORS,
} from '../workflow.types.ts';

describe('workflow.types', () => {
  describe('DEFAULT_GITFLOW_CONFIG', () => {
    it('should not be initialized', () => {
      expect(DEFAULT_GITFLOW_CONFIG.initialized).to.be.false;
    });

    it('should have main as default main branch', () => {
      expect(DEFAULT_GITFLOW_CONFIG.mainBranch).to.equal('main');
    });

    it('should have develop as default develop branch', () => {
      expect(DEFAULT_GITFLOW_CONFIG.developBranch).to.equal('develop');
    });

    it('should have feature/ as default feature prefix', () => {
      expect(DEFAULT_GITFLOW_CONFIG.featurePrefix).to.equal('feature/');
    });

    it('should have release/ as default release prefix', () => {
      expect(DEFAULT_GITFLOW_CONFIG.releasePrefix).to.equal('release/');
    });

    it('should have hotfix/ as default hotfix prefix', () => {
      expect(DEFAULT_GITFLOW_CONFIG.hotfixPrefix).to.equal('hotfix/');
    });

    it('should have v as default version tag prefix', () => {
      expect(DEFAULT_GITFLOW_CONFIG.versionTagPrefix).to.equal('v');
    });
  });

  describe('createEmptyProfile', () => {
    it('should return a profile with empty name', () => {
      const profile = createEmptyProfile();
      expect(profile.name).to.equal('');
    });

    it('should return a profile with empty git name', () => {
      const profile = createEmptyProfile();
      expect(profile.gitName).to.equal('');
    });

    it('should return a profile with empty git email', () => {
      const profile = createEmptyProfile();
      expect(profile.gitEmail).to.equal('');
    });

    it('should return a profile with null signing key', () => {
      const profile = createEmptyProfile();
      expect(profile.signingKey).to.be.null;
    });

    it('should return a profile with empty URL patterns', () => {
      const profile = createEmptyProfile();
      expect(profile.urlPatterns).to.deep.equal([]);
    });

    it('should return a profile that is not default', () => {
      const profile = createEmptyProfile();
      expect(profile.isDefault).to.be.false;
    });

    it('should return a profile with null color', () => {
      const profile = createEmptyProfile();
      expect(profile.color).to.be.null;
    });

    it('should not include an id field', () => {
      const profile = createEmptyProfile();
      expect((profile as Record<string, unknown>)['id']).to.be.undefined;
    });
  });

  describe('PROFILE_COLORS', () => {
    it('should have 8 colors', () => {
      expect(PROFILE_COLORS).to.have.lengthOf(8);
    });

    it('should contain valid hex color strings', () => {
      for (const color of PROFILE_COLORS) {
        expect(color).to.match(/^#[0-9a-f]{6}$/);
      }
    });

    it('should have unique colors', () => {
      const unique = new Set(PROFILE_COLORS);
      expect(unique.size).to.equal(PROFILE_COLORS.length);
    });
  });
});
