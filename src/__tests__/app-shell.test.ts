import { expect } from '@open-wc/testing';
import { uiStore } from '../stores/ui.store.js';
import { repositoryStore } from '../stores/repository.store.js';

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

  describe('requiresRepository store contract', () => {
    beforeEach(() => {
      repositoryStore.getState().reset();
    });

    it('repositoryStore.getActiveRepository returns null when no repo is set', () => {
      const activeRepo = repositoryStore.getState().getActiveRepository();
      expect(activeRepo).to.be.null;
    });

    it('repositoryStore.getActiveRepository returns repo after addRepository', () => {
      repositoryStore.getState().addRepository({
        path: '/test/repo',
        name: 'test-repo',
        isValid: true,
        isBare: false,
        headRef: 'refs/heads/main',
        state: 'clean',
      });

      const activeRepo = repositoryStore.getState().getActiveRepository();
      expect(activeRepo).to.not.be.null;
      expect(activeRepo!.repository.path).to.equal('/test/repo');
      expect(activeRepo!.repository.name).to.equal('test-repo');
    });

    it('addToast with requiresRepository warning format creates correct toast', () => {
      uiStore.getState().addToast({
        type: 'warning',
        message: 'Please open a repository first',
        duration: 3000,
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].type).to.equal('warning');
      expect(toasts[0].message).to.equal('Please open a repository first');
      expect(toasts[0].duration).to.equal(3000);
    });

    it('full requiresRepository flow via stores', () => {
      // With no active repo, the warning toast should be produced
      const activeRepo = repositoryStore.getState().getActiveRepository();
      expect(activeRepo).to.be.null;

      uiStore.getState().addToast({
        type: 'warning',
        message: 'Please open a repository first',
        duration: 3000,
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].type).to.equal('warning');

      // After adding a repository, getActiveRepository returns non-null
      repositoryStore.getState().addRepository({
        path: '/test/repo',
        name: 'test-repo',
        isValid: true,
        isBare: false,
        headRef: 'refs/heads/main',
        state: 'clean',
      });

      const repoAfterAdd = repositoryStore.getState().getActiveRepository();
      expect(repoAfterAdd).to.not.be.null;
      expect(repoAfterAdd!.repository.path).to.equal('/test/repo');
    });
  });
});
