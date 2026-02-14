import { expect } from '@open-wc/testing';
import { uiStore } from '../ui.store.ts';

describe('ui.store', () => {
  beforeEach(() => {
    // Reset panels to default
    uiStore.setState({
      panels: {
        left: { isVisible: true, width: 250, isCollapsed: false },
        right: { isVisible: true, width: 350, isCollapsed: false },
        bottom: { isVisible: false, width: 200, isCollapsed: false },
      },
      viewMode: 'graph',
      splitDiffMode: true,
      showLineNumbers: true,
      toasts: [],
    });
  });

  describe('initial state', () => {
    it('should have left panel visible by default', () => {
      expect(uiStore.getState().panels.left.isVisible).to.be.true;
    });

    it('should have right panel visible by default', () => {
      expect(uiStore.getState().panels.right.isVisible).to.be.true;
    });

    it('should have bottom panel hidden by default', () => {
      expect(uiStore.getState().panels.bottom.isVisible).to.be.false;
    });

    it('should have graph view mode by default', () => {
      expect(uiStore.getState().viewMode).to.equal('graph');
    });

    it('should have split diff mode enabled by default', () => {
      expect(uiStore.getState().splitDiffMode).to.be.true;
    });

    it('should have line numbers shown by default', () => {
      expect(uiStore.getState().showLineNumbers).to.be.true;
    });

    it('should start with no toasts', () => {
      expect(uiStore.getState().toasts).to.have.lengthOf(0);
    });
  });

  describe('togglePanel', () => {
    it('should toggle left panel visibility', () => {
      uiStore.getState().togglePanel('left');
      expect(uiStore.getState().panels.left.isVisible).to.be.false;

      uiStore.getState().togglePanel('left');
      expect(uiStore.getState().panels.left.isVisible).to.be.true;
    });

    it('should toggle right panel visibility', () => {
      uiStore.getState().togglePanel('right');
      expect(uiStore.getState().panels.right.isVisible).to.be.false;
    });

    it('should toggle bottom panel visibility', () => {
      uiStore.getState().togglePanel('bottom');
      expect(uiStore.getState().panels.bottom.isVisible).to.be.true;
    });

    it('should not affect other panels', () => {
      uiStore.getState().togglePanel('left');
      expect(uiStore.getState().panels.right.isVisible).to.be.true;
      expect(uiStore.getState().panels.bottom.isVisible).to.be.false;
    });
  });

  describe('setPanelWidth', () => {
    it('should set the width of a panel', () => {
      uiStore.getState().setPanelWidth('left', 300);
      expect(uiStore.getState().panels.left.width).to.equal(300);
    });

    it('should not affect other panel properties', () => {
      uiStore.getState().setPanelWidth('left', 300);
      expect(uiStore.getState().panels.left.isVisible).to.be.true;
      expect(uiStore.getState().panels.left.isCollapsed).to.be.false;
    });
  });

  describe('setPanelCollapsed', () => {
    it('should set panel collapsed state', () => {
      uiStore.getState().setPanelCollapsed('left', true);
      expect(uiStore.getState().panels.left.isCollapsed).to.be.true;
    });

    it('should uncollapse a panel', () => {
      uiStore.getState().setPanelCollapsed('left', true);
      uiStore.getState().setPanelCollapsed('left', false);
      expect(uiStore.getState().panels.left.isCollapsed).to.be.false;
    });
  });

  describe('setViewMode', () => {
    it('should set view mode to list', () => {
      uiStore.getState().setViewMode('list');
      expect(uiStore.getState().viewMode).to.equal('list');
    });

    it('should set view mode to tree', () => {
      uiStore.getState().setViewMode('tree');
      expect(uiStore.getState().viewMode).to.equal('tree');
    });

    it('should set view mode back to graph', () => {
      uiStore.getState().setViewMode('list');
      uiStore.getState().setViewMode('graph');
      expect(uiStore.getState().viewMode).to.equal('graph');
    });
  });

  describe('setSplitDiffMode', () => {
    it('should disable split diff mode', () => {
      uiStore.getState().setSplitDiffMode(false);
      expect(uiStore.getState().splitDiffMode).to.be.false;
    });

    it('should enable split diff mode', () => {
      uiStore.getState().setSplitDiffMode(false);
      uiStore.getState().setSplitDiffMode(true);
      expect(uiStore.getState().splitDiffMode).to.be.true;
    });
  });

  describe('setShowLineNumbers', () => {
    it('should disable line numbers', () => {
      uiStore.getState().setShowLineNumbers(false);
      expect(uiStore.getState().showLineNumbers).to.be.false;
    });
  });

  describe('addToast', () => {
    it('should add a toast with generated id', () => {
      uiStore.getState().addToast({ type: 'success', message: 'Test toast' });
      const toasts = uiStore.getState().toasts;
      expect(toasts).to.have.lengthOf(1);
      expect(toasts[0].message).to.equal('Test toast');
      expect(toasts[0].type).to.equal('success');
      expect(toasts[0].id).to.be.a('string');
      expect(toasts[0].id).to.include('toast-');
    });

    it('should add multiple toasts', () => {
      uiStore.getState().addToast({ type: 'info', message: 'First' });
      uiStore.getState().addToast({ type: 'error', message: 'Second' });
      expect(uiStore.getState().toasts).to.have.lengthOf(2);
    });

    it('should preserve duration in toast', () => {
      uiStore.getState().addToast({ type: 'warning', message: 'Timed', duration: 3000 });
      expect(uiStore.getState().toasts[0].duration).to.equal(3000);
    });

    it('should preserve action in toast', () => {
      const action = { label: 'Undo', callback: () => {} };
      uiStore.getState().addToast({ type: 'info', message: 'With action', action });
      expect(uiStore.getState().toasts[0].action).to.deep.equal(action);
    });
  });

  describe('removeToast', () => {
    it('should remove a toast by id', () => {
      uiStore.getState().addToast({ type: 'info', message: 'Remove me' });
      const toastId = uiStore.getState().toasts[0].id;
      uiStore.getState().removeToast(toastId);
      expect(uiStore.getState().toasts).to.have.lengthOf(0);
    });

    it('should only remove the specified toast', () => {
      uiStore.getState().addToast({ type: 'info', message: 'First' });
      uiStore.getState().addToast({ type: 'info', message: 'Second' });
      const firstId = uiStore.getState().toasts[0].id;
      uiStore.getState().removeToast(firstId);
      expect(uiStore.getState().toasts).to.have.lengthOf(1);
      expect(uiStore.getState().toasts[0].message).to.equal('Second');
    });

    it('should not throw when removing non-existent toast', () => {
      expect(() => uiStore.getState().removeToast('non-existent')).to.not.throw();
    });
  });
});
