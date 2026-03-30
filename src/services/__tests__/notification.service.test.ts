import { expect } from '@open-wc/testing';

// Mock Tauri internals before importing modules
if (!(globalThis as Record<string, unknown>).__TAURI_INTERNALS__) {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: (_command: string): Promise<unknown> => Promise.resolve(null),
    transformCallback: () => 0,
  };
}

import { uiStore } from '../../stores/ui.store.ts';
import { showToast, notify, notifySuccess, notifyError, notifyWarning, notifyInfo } from '../notification.service.ts';

describe('notification.service', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
  });

  describe('showToast', () => {
    it('should add an info toast by default', () => {
      showToast('Test message');
      const toasts = uiStore.getState().toasts;
      expect(toasts).to.have.lengthOf(1);
      expect(toasts[0].message).to.equal('Test message');
      expect(toasts[0].type).to.equal('info');
    });

    it('should accept a custom type', () => {
      showToast('Error occurred', 'error');
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].type).to.equal('error');
    });

    it('should accept a custom duration', () => {
      showToast('Quick message', 'info', 2000);
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].duration).to.equal(2000);
    });

    it('should default duration to 5000', () => {
      showToast('Default duration');
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].duration).to.equal(5000);
    });

    it('should accept an action', () => {
      const action = { label: 'Undo', callback: () => {} };
      showToast('With action', 'info', 5000, action);
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].action).to.deep.equal(action);
    });

    it('should add multiple toasts', () => {
      showToast('First');
      showToast('Second');
      showToast('Third');
      expect(uiStore.getState().toasts).to.have.lengthOf(3);
    });

    it('should generate unique IDs for each toast', () => {
      showToast('First');
      showToast('Second');
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].id).to.not.equal(toasts[1].id);
    });

    it('should support all notification types', () => {
      showToast('Info', 'info');
      showToast('Success', 'success');
      showToast('Warning', 'warning');
      showToast('Error', 'error');
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].type).to.equal('info');
      expect(toasts[1].type).to.equal('success');
      expect(toasts[2].type).to.equal('warning');
      expect(toasts[3].type).to.equal('error');
    });
  });

  describe('notify', () => {
    it('should add a toast with title and body combined', async () => {
      await notify({ title: 'Build', body: 'Completed successfully' });
      const toasts = uiStore.getState().toasts;
      expect(toasts).to.have.lengthOf(1);
      expect(toasts[0].message).to.equal('Build: Completed successfully');
    });

    it('should default to info type', async () => {
      await notify({ title: 'Info', body: 'Something happened' });
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].type).to.equal('info');
    });

    it('should respect custom type', async () => {
      await notify({ title: 'Error', body: 'Something failed', type: 'error' });
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].type).to.equal('error');
    });

    it('should respect custom duration', async () => {
      await notify({ title: 'Quick', body: 'Brief message', duration: 1000 });
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].duration).to.equal(1000);
    });

    it('should default duration to 5000', async () => {
      await notify({ title: 'Default', body: 'Message' });
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].duration).to.equal(5000);
    });

    it('should not throw when toastOnly is true', async () => {
      await notify({ title: 'Toast Only', body: 'No native', toastOnly: true });
      const toasts = uiStore.getState().toasts;
      expect(toasts).to.have.lengthOf(1);
    });

    it('should not throw when native notification fails', async () => {
      // In test environment, native notifications will fail — verify no throw
      await notify({ title: 'Test', body: 'Should not throw' });
      expect(uiStore.getState().toasts).to.have.lengthOf(1);
    });
  });

  describe('convenience methods', () => {
    it('notifySuccess should use success type', async () => {
      await notifySuccess('Done', 'All good');
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].type).to.equal('success');
      expect(toasts[0].message).to.include('Done');
      expect(toasts[0].message).to.include('All good');
    });

    it('notifyError should use error type', async () => {
      await notifyError('Failed', 'Something broke');
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].type).to.equal('error');
    });

    it('notifyWarning should use warning type', async () => {
      await notifyWarning('Caution', 'Be careful');
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].type).to.equal('warning');
    });

    it('notifyInfo should use info type', async () => {
      await notifyInfo('FYI', 'Just so you know');
      const toasts = uiStore.getState().toasts;
      expect(toasts[0].type).to.equal('info');
    });

    it('notifySuccess with toastOnly should not throw', async () => {
      await notifySuccess('Done', 'All good', true);
      expect(uiStore.getState().toasts).to.have.lengthOf(1);
    });

    it('notifyError with toastOnly should not throw', async () => {
      await notifyError('Failed', 'Broke', true);
      expect(uiStore.getState().toasts).to.have.lengthOf(1);
    });
  });
});
