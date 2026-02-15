import { expect } from '@open-wc/testing';
import { workflowStore, getProfileById, getDefaultProfile, hasProfiles } from '../workflow.store.ts';
import type { GitProfile } from '../../types/workflow.types.ts';

describe('workflow.store', () => {
  function createMockProfile(overrides: Partial<GitProfile> = {}): GitProfile {
    return {
      id: 'test-id',
      name: 'Test Profile',
      gitName: 'Test User',
      gitEmail: 'test@example.com',
      signingKey: null,
      urlPatterns: [],
      isDefault: false,
      color: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    workflowStore.getState().reset();
  });

  describe('initial state', () => {
    it('should start with empty profiles', () => {
      expect(workflowStore.getState().profiles).to.have.lengthOf(0);
    });

    it('should start with no active profile', () => {
      expect(workflowStore.getState().activeProfile).to.be.null;
    });

    it('should start with no current repository path', () => {
      expect(workflowStore.getState().currentRepositoryPath).to.be.null;
    });

    it('should start with loading false', () => {
      expect(workflowStore.getState().isLoadingProfiles).to.be.false;
    });

    it('should start with no error', () => {
      expect(workflowStore.getState().profileError).to.be.null;
    });
  });

  describe('setProfiles', () => {
    it('should set profiles array', () => {
      const profiles = [createMockProfile({ id: '1' }), createMockProfile({ id: '2' })];
      workflowStore.getState().setProfiles(profiles);
      expect(workflowStore.getState().profiles).to.have.lengthOf(2);
    });

    it('should clear profile error', () => {
      workflowStore.getState().setProfileError('some error');
      workflowStore.getState().setProfiles([]);
      expect(workflowStore.getState().profileError).to.be.null;
    });
  });

  describe('setActiveProfile', () => {
    it('should set the active profile', () => {
      const profile = createMockProfile();
      workflowStore.getState().setActiveProfile(profile);
      expect(workflowStore.getState().activeProfile).to.deep.equal(profile);
    });

    it('should allow setting to null', () => {
      const profile = createMockProfile();
      workflowStore.getState().setActiveProfile(profile);
      workflowStore.getState().setActiveProfile(null);
      expect(workflowStore.getState().activeProfile).to.be.null;
    });
  });

  describe('setCurrentRepositoryPath', () => {
    it('should set the current repository path', () => {
      workflowStore.getState().setCurrentRepositoryPath('/test/path');
      expect(workflowStore.getState().currentRepositoryPath).to.equal('/test/path');
    });
  });

  describe('setLoadingProfiles', () => {
    it('should set loading state', () => {
      workflowStore.getState().setLoadingProfiles(true);
      expect(workflowStore.getState().isLoadingProfiles).to.be.true;
    });
  });

  describe('setProfileError', () => {
    it('should set error and stop loading', () => {
      workflowStore.getState().setLoadingProfiles(true);
      workflowStore.getState().setProfileError('An error');
      expect(workflowStore.getState().profileError).to.equal('An error');
      expect(workflowStore.getState().isLoadingProfiles).to.be.false;
    });
  });

  describe('addProfile', () => {
    it('should add a profile', () => {
      const profile = createMockProfile();
      workflowStore.getState().addProfile(profile);
      expect(workflowStore.getState().profiles).to.have.lengthOf(1);
      expect(workflowStore.getState().profiles[0]).to.deep.equal(profile);
    });

    it('should clear profile error', () => {
      workflowStore.getState().setProfileError('error');
      workflowStore.getState().addProfile(createMockProfile());
      expect(workflowStore.getState().profileError).to.be.null;
    });
  });

  describe('updateProfile', () => {
    it('should update an existing profile', () => {
      const profile = createMockProfile({ id: '1', name: 'Old Name' });
      workflowStore.getState().addProfile(profile);

      const updated = { ...profile, name: 'New Name' };
      workflowStore.getState().updateProfile(updated);

      expect(workflowStore.getState().profiles[0].name).to.equal('New Name');
    });

    it('should update active profile if it matches', () => {
      const profile = createMockProfile({ id: '1', name: 'Old Name' });
      workflowStore.getState().addProfile(profile);
      workflowStore.getState().setActiveProfile(profile);

      const updated = { ...profile, name: 'New Name' };
      workflowStore.getState().updateProfile(updated);

      expect(workflowStore.getState().activeProfile?.name).to.equal('New Name');
    });

    it('should not update active profile if id does not match', () => {
      const profile1 = createMockProfile({ id: '1', name: 'Profile 1' });
      const profile2 = createMockProfile({ id: '2', name: 'Profile 2' });
      workflowStore.getState().addProfile(profile1);
      workflowStore.getState().addProfile(profile2);
      workflowStore.getState().setActiveProfile(profile1);

      const updated = { ...profile2, name: 'Updated Profile 2' };
      workflowStore.getState().updateProfile(updated);

      expect(workflowStore.getState().activeProfile?.name).to.equal('Profile 1');
    });
  });

  describe('removeProfile', () => {
    it('should remove a profile by id', () => {
      const profile = createMockProfile({ id: '1' });
      workflowStore.getState().addProfile(profile);
      workflowStore.getState().removeProfile('1');
      expect(workflowStore.getState().profiles).to.have.lengthOf(0);
    });

    it('should clear active profile if removed', () => {
      const profile = createMockProfile({ id: '1' });
      workflowStore.getState().addProfile(profile);
      workflowStore.getState().setActiveProfile(profile);
      workflowStore.getState().removeProfile('1');
      expect(workflowStore.getState().activeProfile).to.be.null;
    });

    it('should not clear active profile if other profile removed', () => {
      const profile1 = createMockProfile({ id: '1' });
      const profile2 = createMockProfile({ id: '2' });
      workflowStore.getState().addProfile(profile1);
      workflowStore.getState().addProfile(profile2);
      workflowStore.getState().setActiveProfile(profile1);
      workflowStore.getState().removeProfile('2');
      expect(workflowStore.getState().activeProfile?.id).to.equal('1');
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      workflowStore.getState().addProfile(createMockProfile());
      workflowStore.getState().setActiveProfile(createMockProfile());
      workflowStore.getState().setCurrentRepositoryPath('/test');
      workflowStore.getState().setLoadingProfiles(true);

      workflowStore.getState().reset();

      expect(workflowStore.getState().profiles).to.have.lengthOf(0);
      expect(workflowStore.getState().activeProfile).to.be.null;
      expect(workflowStore.getState().currentRepositoryPath).to.be.null;
      expect(workflowStore.getState().isLoadingProfiles).to.be.false;
    });
  });

  describe('helper functions', () => {
    describe('getProfileById', () => {
      it('should return profile by id', () => {
        workflowStore.getState().addProfile(createMockProfile({ id: 'test-1', name: 'Found' }));
        const result = getProfileById('test-1');
        expect(result?.name).to.equal('Found');
      });

      it('should return undefined for non-existent id', () => {
        expect(getProfileById('non-existent')).to.be.undefined;
      });
    });

    describe('getDefaultProfile', () => {
      it('should return the default profile', () => {
        workflowStore.getState().addProfile(createMockProfile({ id: '1', isDefault: false }));
        workflowStore.getState().addProfile(createMockProfile({ id: '2', isDefault: true, name: 'Default' }));
        const result = getDefaultProfile();
        expect(result?.name).to.equal('Default');
      });

      it('should return undefined when no default exists', () => {
        workflowStore.getState().addProfile(createMockProfile({ isDefault: false }));
        expect(getDefaultProfile()).to.be.undefined;
      });
    });

    describe('hasProfiles', () => {
      it('should return false when no profiles', () => {
        expect(hasProfiles()).to.be.false;
      });

      it('should return true when profiles exist', () => {
        workflowStore.getState().addProfile(createMockProfile());
        expect(hasProfiles()).to.be.true;
      });
    });
  });
});
