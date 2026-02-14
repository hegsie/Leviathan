import { expect } from '@open-wc/testing';
import { settingsStore, getGraphColorSchemes } from '../settings.store.ts';

describe('settings.store', () => {
  beforeEach(() => {
    settingsStore.getState().resetToDefaults();
  });

  describe('initial state / defaults', () => {
    it('should have dark theme by default', () => {
      expect(settingsStore.getState().theme).to.equal('dark');
    });

    it('should have medium font size by default', () => {
      expect(settingsStore.getState().fontSize).to.equal('medium');
    });

    it('should have comfortable density by default', () => {
      expect(settingsStore.getState().density).to.equal('comfortable');
    });

    it('should have main as default branch name', () => {
      expect(settingsStore.getState().defaultBranchName).to.equal('main');
    });

    it('should have origin as default remote name', () => {
      expect(settingsStore.getState().defaultRemoteName).to.equal('origin');
    });

    it('should show avatars by default', () => {
      expect(settingsStore.getState().showAvatars).to.be.true;
    });

    it('should show commit size by default', () => {
      expect(settingsStore.getState().showCommitSize).to.be.true;
    });

    it('should have 3 diff context lines by default', () => {
      expect(settingsStore.getState().diffContextLines).to.equal(3);
    });

    it('should have word wrap enabled by default', () => {
      expect(settingsStore.getState().wordWrap).to.be.true;
    });

    it('should not show whitespace by default', () => {
      expect(settingsStore.getState().showWhitespace).to.be.false;
    });

    it('should have auto fetch disabled by default', () => {
      expect(settingsStore.getState().autoFetchInterval).to.equal(0);
    });

    it('should have fetch on focus disabled by default', () => {
      expect(settingsStore.getState().fetchOnFocus).to.be.false;
    });

    it('should confirm before discard by default', () => {
      expect(settingsStore.getState().confirmBeforeDiscard).to.be.true;
    });

    it('should open last repository by default', () => {
      expect(settingsStore.getState().openLastRepository).to.be.true;
    });

    it('should have auto stash on checkout disabled by default', () => {
      expect(settingsStore.getState().autoStashOnCheckout).to.be.false;
    });

    it('should have 90 stale branch days by default', () => {
      expect(settingsStore.getState().staleBranchDays).to.equal(90);
    });

    it('should have 300s network timeout by default', () => {
      expect(settingsStore.getState().networkOperationTimeout).to.equal(300);
    });

    it('should not minimize to tray by default', () => {
      expect(settingsStore.getState().minimizeToTray).to.be.false;
    });

    it('should show native notifications by default', () => {
      expect(settingsStore.getState().showNativeNotifications).to.be.true;
    });
  });

  describe('setters', () => {
    it('should set font size', () => {
      settingsStore.getState().setFontSize('large');
      expect(settingsStore.getState().fontSize).to.equal('large');
    });

    it('should set font family', () => {
      settingsStore.getState().setFontFamily('monospace');
      expect(settingsStore.getState().fontFamily).to.equal('monospace');
    });

    it('should set default branch name', () => {
      settingsStore.getState().setDefaultBranchName('master');
      expect(settingsStore.getState().defaultBranchName).to.equal('master');
    });

    it('should set default remote name', () => {
      settingsStore.getState().setDefaultRemoteName('upstream');
      expect(settingsStore.getState().defaultRemoteName).to.equal('upstream');
    });

    it('should set show avatars', () => {
      settingsStore.getState().setShowAvatars(false);
      expect(settingsStore.getState().showAvatars).to.be.false;
    });

    it('should set show commit size', () => {
      settingsStore.getState().setShowCommitSize(false);
      expect(settingsStore.getState().showCommitSize).to.be.false;
    });

    it('should set graph row height', () => {
      settingsStore.getState().setGraphRowHeight(50);
      expect(settingsStore.getState().graphRowHeight).to.equal(50);
    });

    it('should set diff context lines', () => {
      settingsStore.getState().setDiffContextLines(5);
      expect(settingsStore.getState().diffContextLines).to.equal(5);
    });

    it('should set word wrap', () => {
      settingsStore.getState().setWordWrap(false);
      expect(settingsStore.getState().wordWrap).to.be.false;
    });

    it('should set show whitespace', () => {
      settingsStore.getState().setShowWhitespace(true);
      expect(settingsStore.getState().showWhitespace).to.be.true;
    });

    it('should set auto fetch interval', () => {
      settingsStore.getState().setAutoFetchInterval(5);
      expect(settingsStore.getState().autoFetchInterval).to.equal(5);
    });

    it('should set fetch on focus', () => {
      settingsStore.getState().setFetchOnFocus(true);
      expect(settingsStore.getState().fetchOnFocus).to.be.true;
    });

    it('should set confirm before discard', () => {
      settingsStore.getState().setConfirmBeforeDiscard(false);
      expect(settingsStore.getState().confirmBeforeDiscard).to.be.false;
    });

    it('should set open last repository', () => {
      settingsStore.getState().setOpenLastRepository(false);
      expect(settingsStore.getState().openLastRepository).to.be.false;
    });

    it('should set auto stash on checkout', () => {
      settingsStore.getState().setAutoStashOnCheckout(true);
      expect(settingsStore.getState().autoStashOnCheckout).to.be.true;
    });

    it('should set stale branch days', () => {
      settingsStore.getState().setStaleBranchDays(30);
      expect(settingsStore.getState().staleBranchDays).to.equal(30);
    });

    it('should set network operation timeout', () => {
      settingsStore.getState().setNetworkOperationTimeout(60);
      expect(settingsStore.getState().networkOperationTimeout).to.equal(60);
    });

    it('should set minimize to tray', () => {
      settingsStore.getState().setMinimizeToTray(true);
      expect(settingsStore.getState().minimizeToTray).to.be.true;
    });

    it('should set show native notifications', () => {
      settingsStore.getState().setShowNativeNotifications(false);
      expect(settingsStore.getState().showNativeNotifications).to.be.false;
    });
  });

  describe('resetToDefaults', () => {
    it('should reset all settings to defaults', () => {
      settingsStore.getState().setFontSize('large');
      settingsStore.getState().setAutoFetchInterval(10);
      settingsStore.getState().setConfirmBeforeDiscard(false);

      settingsStore.getState().resetToDefaults();

      expect(settingsStore.getState().fontSize).to.equal('medium');
      expect(settingsStore.getState().autoFetchInterval).to.equal(0);
      expect(settingsStore.getState().confirmBeforeDiscard).to.be.true;
    });
  });

  describe('getGraphColorSchemes', () => {
    it('should return all available schemes', () => {
      const schemes = getGraphColorSchemes();
      expect(schemes).to.have.lengthOf(5);
    });

    it('should include default scheme', () => {
      const schemes = getGraphColorSchemes();
      expect(schemes.some(s => s.id === 'default')).to.be.true;
    });

    it('should include high-contrast scheme', () => {
      const schemes = getGraphColorSchemes();
      expect(schemes.some(s => s.id === 'high-contrast')).to.be.true;
    });

    it('should have colors for each scheme', () => {
      const schemes = getGraphColorSchemes();
      for (const scheme of schemes) {
        expect(scheme.colors).to.be.an('array');
        expect(scheme.colors.length).to.be.greaterThan(0);
      }
    });

    it('should have names for each scheme', () => {
      const schemes = getGraphColorSchemes();
      for (const scheme of schemes) {
        expect(scheme.name).to.be.a('string');
        expect(scheme.name.length).to.be.greaterThan(0);
      }
    });
  });
});
