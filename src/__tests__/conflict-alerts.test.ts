/**
 * Conflict Alerts Tests
 *
 * Tests that conflict notifications are dispatched correctly
 * when merge, rebase, cherry-pick, and revert operations encounter conflicts.
 */

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string, _args?: unknown): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: typeof mockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

import { expect } from '@open-wc/testing';
import { uiStore } from '../stores/ui.store.ts';
import { notifyWarning } from '../services/notification.service.ts';

describe('Conflict Alerts', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
  });

  describe('notifyWarning creates toast notifications', () => {
    it('should create a warning toast for merge conflict', async () => {
      await notifyWarning(
        'Merge Conflict',
        'Conflicts detected while merging feature-branch. Please resolve conflicts to continue.',
        true
      );

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].type).to.equal('warning');
      expect(toasts[0].message).to.contain('Merge Conflict');
      expect(toasts[0].message).to.contain('feature-branch');
    });

    it('should create a warning toast for rebase conflict', async () => {
      await notifyWarning(
        'Rebase Conflict',
        'Conflicts detected while rebasing onto main. Please resolve conflicts to continue.',
        true
      );

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].type).to.equal('warning');
      expect(toasts[0].message).to.contain('Rebase Conflict');
    });

    it('should create a warning toast for cherry-pick conflict', async () => {
      await notifyWarning(
        'Cherry-pick Conflict',
        'Conflicts detected during cherry-pick. Please resolve conflicts to continue.',
        true
      );

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].type).to.equal('warning');
      expect(toasts[0].message).to.contain('Cherry-pick Conflict');
    });

    it('should create a warning toast for revert conflict', async () => {
      await notifyWarning(
        'Revert Conflict',
        'Conflicts detected while reverting abc1234. Please resolve conflicts to continue.',
        true
      );

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].type).to.equal('warning');
      expect(toasts[0].message).to.contain('Revert Conflict');
      expect(toasts[0].message).to.contain('abc1234');
    });
  });

  describe('toastOnly behavior', () => {
    it('should show toast-only notification when toastOnly is true', async () => {
      await notifyWarning('Merge Conflict', 'Test message', true);

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(1);
      expect(toasts[0].type).to.equal('warning');
      expect(toasts[0].message).to.contain('Merge Conflict');
    });

    it('should include both title and body in toast message', async () => {
      await notifyWarning('Rebase Conflict', 'Conflicts found on main', true);

      const toasts = uiStore.getState().toasts;
      expect(toasts[0].message).to.contain('Rebase Conflict');
      expect(toasts[0].message).to.contain('Conflicts found on main');
    });
  });
});
