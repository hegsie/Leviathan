import { expect } from '@open-wc/testing';
import { uiStore } from '../stores/ui.store.js';

// Mock Tauri API
const mockInvoke = (_command: string, _args?: unknown): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: typeof mockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('App Shell - requiresRepository', () => {
  beforeEach(() => {
    // Clear any existing toasts
    uiStore.setState({ toasts: [] });
  });

  describe('uiStore toast functionality', () => {
    it('can add a toast', () => {
      uiStore.getState().addToast({
        type: 'warning',
        message: 'Please open a repository first',
        duration: 3000,
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].message).to.equal('Please open a repository first');
      expect(toasts[0].type).to.equal('warning');
    });

    it('can add multiple toasts', () => {
      uiStore.getState().addToast({
        type: 'info',
        message: 'First toast',
      });

      uiStore.getState().addToast({
        type: 'error',
        message: 'Second toast',
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(2);
    });

    it('can remove a toast', () => {
      uiStore.getState().addToast({
        type: 'info',
        message: 'Test toast',
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);

      const toastId = toasts[0].id;
      uiStore.getState().removeToast(toastId);

      expect(uiStore.getState().toasts.length).to.equal(0);
    });

    it('toast has correct structure', () => {
      uiStore.getState().addToast({
        type: 'success',
        message: 'Operation completed',
        duration: 5000,
      });

      const toast = uiStore.getState().toasts[0];
      expect(toast).to.have.property('id');
      expect(toast).to.have.property('type', 'success');
      expect(toast).to.have.property('message', 'Operation completed');
      expect(toast).to.have.property('duration', 5000);
    });
  });

  describe('panel toggle functionality', () => {
    beforeEach(() => {
      // Reset panel visibility using the correct structure
      uiStore.setState({
        panels: {
          left: { isVisible: true, width: 250, isCollapsed: false },
          right: { isVisible: true, width: 350, isCollapsed: false },
          bottom: { isVisible: false, width: 200, isCollapsed: false },
        },
      });
    });

    it('can toggle left panel', () => {
      expect(uiStore.getState().panels.left.isVisible).to.be.true;

      uiStore.getState().togglePanel('left');
      expect(uiStore.getState().panels.left.isVisible).to.be.false;

      uiStore.getState().togglePanel('left');
      expect(uiStore.getState().panels.left.isVisible).to.be.true;
    });

    it('can toggle right panel', () => {
      expect(uiStore.getState().panels.right.isVisible).to.be.true;

      uiStore.getState().togglePanel('right');
      expect(uiStore.getState().panels.right.isVisible).to.be.false;

      uiStore.getState().togglePanel('right');
      expect(uiStore.getState().panels.right.isVisible).to.be.true;
    });
  });

  describe('requiresRepository behavior simulation', () => {
    it('shows toast when action requires repository but none is open', () => {
      // Simulate requiresRepository behavior
      const activeRepository = null;

      const action = () => {
        if (!activeRepository) {
          uiStore.getState().addToast({
            type: 'warning',
            message: 'Please open a repository first',
            duration: 3000,
          });
          return;
        }
        // Would open dialog here
      };

      action();

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].message).to.equal('Please open a repository first');
    });

    it('does not show toast when repository is open', () => {
      // Simulate requiresRepository behavior with active repo
      const activeRepository = { path: '/test/repo' };
      let dialogOpened = false;

      const action = () => {
        if (!activeRepository) {
          uiStore.getState().addToast({
            type: 'warning',
            message: 'Please open a repository first',
            duration: 3000,
          });
          return;
        }
        dialogOpened = true;
      };

      action();

      expect(uiStore.getState().toasts.length).to.equal(0);
      expect(dialogOpened).to.be.true;
    });
  });
});
