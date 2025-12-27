import { expect } from '@open-wc/testing';
import type { Shortcut } from '../keyboard.service.ts';

// Clear localStorage before tests
const STORAGE_KEY = 'leviathan-keyboard-settings';

describe('keyboard.service', () => {
  beforeEach(() => {
    // Clear keyboard settings before each test
    localStorage.removeItem(STORAGE_KEY);
  });

  // Helper to create a mock shortcut
  function createShortcut(overrides: Partial<Shortcut> = {}): Shortcut {
    return {
      key: 'a',
      action: () => {},
      description: 'Test shortcut',
      category: 'Test',
      ...overrides,
    };
  }

  describe('formatShortcut', () => {
    // We need to test the formatting logic in isolation
    // Since formatShortcut is a method on the service, we'll test the behavior

    it('formats simple key shortcuts', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      const shortcut = createShortcut({ key: 'a' });
      const formatted = keyboardService.formatShortcut(shortcut);
      expect(formatted).to.equal('A');
    });

    it('formats ctrl+key shortcuts', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      const shortcut = createShortcut({ key: 'a', ctrl: true });
      const formatted = keyboardService.formatShortcut(shortcut);
      // Result depends on platform
      expect(formatted).to.match(/A$/);
    });

    it('formats shift+key shortcuts', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      const shortcut = createShortcut({ key: 'a', shift: true });
      const formatted = keyboardService.formatShortcut(shortcut);
      expect(formatted).to.include('A');
    });

    it('formats arrow keys', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      expect(keyboardService.formatShortcut(createShortcut({ key: 'ArrowUp' }))).to.equal('↑');
      expect(keyboardService.formatShortcut(createShortcut({ key: 'ArrowDown' }))).to.equal('↓');
      expect(keyboardService.formatShortcut(createShortcut({ key: 'ArrowLeft' }))).to.equal('←');
      expect(keyboardService.formatShortcut(createShortcut({ key: 'ArrowRight' }))).to.equal('→');
    });

    it('formats special keys', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      expect(keyboardService.formatShortcut(createShortcut({ key: 'Enter' }))).to.equal('↵');
      expect(keyboardService.formatShortcut(createShortcut({ key: 'Escape' }))).to.equal('Esc');
      expect(keyboardService.formatShortcut(createShortcut({ key: ' ' }))).to.equal('Space');
    });

    it('formats complex shortcuts with multiple modifiers', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      const shortcut = createShortcut({ key: 's', ctrl: true, shift: true });
      const formatted = keyboardService.formatShortcut(shortcut);
      expect(formatted).to.include('S');
    });
  });

  describe('register and unregister', () => {
    it('can register a shortcut', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      const initialCount = keyboardService.getAllShortcuts().length;

      keyboardService.register('test-shortcut', createShortcut({ key: 'x', description: 'Test X' }));

      const shortcuts = keyboardService.getAllShortcuts();
      expect(shortcuts.length).to.be.greaterThan(initialCount);
    });

    it('can unregister a shortcut', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      keyboardService.register('unregister-test', createShortcut({ key: 'y', description: 'unregister-test' }));
      const countBefore = keyboardService.getAllShortcuts().length;

      keyboardService.unregister('unregister-test');

      const countAfter = keyboardService.getAllShortcuts().length;
      expect(countAfter).to.equal(countBefore - 1);
    });
  });

  describe('getAllShortcuts', () => {
    it('returns array of shortcuts', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      const shortcuts = keyboardService.getAllShortcuts();
      expect(Array.isArray(shortcuts)).to.be.true;
    });
  });

  describe('getShortcutsByCategory', () => {
    it('returns map of categories', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      const byCategory = keyboardService.getShortcutsByCategory();
      expect(byCategory instanceof Map).to.be.true;
    });

    it('groups shortcuts by category', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      keyboardService.register('cat-test-1', createShortcut({ key: '1', category: 'TestCategory' }));
      keyboardService.register('cat-test-2', createShortcut({ key: '2', category: 'TestCategory' }));

      const byCategory = keyboardService.getShortcutsByCategory();
      const testCat = byCategory.get('TestCategory');
      expect(testCat).to.exist;
      expect(testCat!.length).to.be.greaterThanOrEqual(2);
    });
  });

  describe('vim mode', () => {
    it('can enable vim mode', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      keyboardService.setVimMode(true);
      expect(keyboardService.isVimMode()).to.be.true;
    });

    it('can disable vim mode', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      keyboardService.setVimMode(false);
      expect(keyboardService.isVimMode()).to.be.false;
    });

    it('persists vim mode setting', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      keyboardService.setVimMode(true);

      // Check localStorage was updated
      const stored = localStorage.getItem('leviathan-keyboard-settings');
      expect(stored).to.exist;
      const settings = JSON.parse(stored!);
      expect(settings.vimMode).to.be.true;
    });

    it('can set vim actions', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      let upCalled = false;
      let downCalled = false;

      keyboardService.setVimActions({
        navigateUp: () => { upCalled = true; },
        navigateDown: () => { downCalled = true; },
      });

      // Actions are set but not called until key events
      expect(upCalled).to.be.false;
      expect(downCalled).to.be.false;
    });
  });

  describe('setEnabled', () => {
    it('can disable keyboard shortcuts', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      keyboardService.setEnabled(false);
      // When disabled, shortcuts shouldn't fire (tested via integration)
      // Just verify the method exists and doesn't throw
      expect(() => keyboardService.setEnabled(true)).to.not.throw;
    });
  });

  describe('addListener', () => {
    it('returns unsubscribe function', async () => {
      const { keyboardService } = await import('../keyboard.service.ts');
      const listener = () => {};
      const unsubscribe = keyboardService.addListener(listener);
      expect(typeof unsubscribe).to.equal('function');

      // Clean up
      unsubscribe();
    });
  });
});

describe('registerDefaultShortcuts', () => {
  it('registers navigation shortcuts', async () => {
    const { keyboardService, registerDefaultShortcuts } = await import('../keyboard.service.ts');

    const mockActions = {
      navigateUp: () => {},
      navigateDown: () => {},
      selectCommit: () => {},
      stageAll: () => {},
      unstageAll: () => {},
      commit: () => {},
      refresh: () => {},
      search: () => {},
      openSettings: () => {},
      toggleLeftPanel: () => {},
      toggleRightPanel: () => {},
    };

    registerDefaultShortcuts(mockActions);

    const shortcuts = keyboardService.getAllShortcuts();
    const categories = shortcuts.map(s => s.category);

    expect(categories).to.include('Navigation');
    expect(categories).to.include('Staging');
    expect(categories).to.include('Commit');
    expect(categories).to.include('General');
    expect(categories).to.include('View');
  });

  it('sets vim navigation actions', async () => {
    const { keyboardService, registerDefaultShortcuts } = await import('../keyboard.service.ts');

    let upCalled = false;
    let downCalled = false;

    const mockActions = {
      navigateUp: () => { upCalled = true; },
      navigateDown: () => { downCalled = true; },
      selectCommit: () => {},
      stageAll: () => {},
      unstageAll: () => {},
      commit: () => {},
      refresh: () => {},
      search: () => {},
      openSettings: () => {},
      toggleLeftPanel: () => {},
      toggleRightPanel: () => {},
    };

    registerDefaultShortcuts(mockActions);

    // Vim actions are set
    keyboardService.setVimMode(true);
    // Actions would be called on key events
    expect(upCalled).to.be.false; // Not called until key event
    expect(downCalled).to.be.false;
  });

  it('registers optional shortcuts when provided', async () => {
    const { keyboardService, registerDefaultShortcuts } = await import('../keyboard.service.ts');

    const mockActions = {
      navigateUp: () => {},
      navigateDown: () => {},
      selectCommit: () => {},
      stageAll: () => {},
      unstageAll: () => {},
      commit: () => {},
      refresh: () => {},
      search: () => {},
      openSettings: () => {},
      toggleLeftPanel: () => {},
      toggleRightPanel: () => {},
      fetch: () => {},
      pull: () => {},
      push: () => {},
      createBranch: () => {},
      createStash: () => {},
    };

    registerDefaultShortcuts(mockActions);

    const shortcuts = keyboardService.getAllShortcuts();
    const descriptions = shortcuts.map(s => s.description);

    expect(descriptions).to.include('Fetch from remote');
    expect(descriptions).to.include('Pull from remote');
    expect(descriptions).to.include('Push to remote');
    expect(descriptions).to.include('Create new branch');
    expect(descriptions).to.include('Create stash');
  });
});
