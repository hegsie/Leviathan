import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;
const invokeHistory: Array<{ command: string; args: unknown }> = [];

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import { getUndoHistory, undoLastAction, redoLastAction, recordAction } from '../git.service.ts';
import type { UndoAction, UndoHistory } from '../../types/git.types.ts';

describe('git.service - Undo/redo operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
  });

  describe('getUndoHistory', () => {
    it('invokes get_undo_history command with path', async () => {
      const mockHistory: UndoHistory = {
        actions: [],
        currentIndex: -1,
        canUndo: false,
        canRedo: false,
      };
      mockInvoke = () => Promise.resolve(mockHistory);

      await getUndoHistory('/test/repo');
      expect(lastInvokedCommand).to.equal('get_undo_history');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('supports maxCount parameter', async () => {
      const mockHistory: UndoHistory = {
        actions: [],
        currentIndex: -1,
        canUndo: false,
        canRedo: false,
      };
      mockInvoke = () => Promise.resolve(mockHistory);

      await getUndoHistory('/test/repo', 10);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.maxCount).to.equal(10);
    });

    it('returns undo history with actions', async () => {
      const mockHistory: UndoHistory = {
        actions: [
          {
            actionType: 'commit',
            description: 'Commit: Add new feature',
            timestamp: 1706400000,
            beforeRef: 'abc123',
            afterRef: 'def456',
            details: '{"reflogIndex": 0}',
          },
          {
            actionType: 'checkout',
            description: 'Checkout: moving from main to feature',
            timestamp: 1706390000,
            beforeRef: 'def456',
            afterRef: 'ghi789',
            details: '{"reflogIndex": 1}',
          },
        ],
        currentIndex: -1,
        canUndo: true,
        canRedo: false,
      };
      mockInvoke = () => Promise.resolve(mockHistory);

      const result = await getUndoHistory('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.actions.length).to.equal(2);
      expect(result.data?.canUndo).to.be.true;
      expect(result.data?.canRedo).to.be.false;
      expect(result.data?.currentIndex).to.equal(-1);
    });

    it('returns empty history for fresh repo', async () => {
      const mockHistory: UndoHistory = {
        actions: [],
        currentIndex: -1,
        canUndo: false,
        canRedo: false,
      };
      mockInvoke = () => Promise.resolve(mockHistory);

      const result = await getUndoHistory('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.actions).to.deep.equal([]);
      expect(result.data?.canUndo).to.be.false;
    });

    it('handles error when repository not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPO_NOT_FOUND', message: 'Repository not found' });

      const result = await getUndoHistory('/invalid/path');
      expect(result.success).to.be.false;
    });

    it('returns actions with correct properties', async () => {
      const mockAction: UndoAction = {
        actionType: 'merge',
        description: 'Merge: feature into main',
        timestamp: 1706400000,
        beforeRef: 'abc123def456',
        afterRef: 'ghi789jkl012',
        details: '{"reflogIndex": 0, "rawMessage": "merge feature: Fast-forward", "author": "Test User"}',
      };
      const mockHistory: UndoHistory = {
        actions: [mockAction],
        currentIndex: -1,
        canUndo: true,
        canRedo: false,
      };
      mockInvoke = () => Promise.resolve(mockHistory);

      const result = await getUndoHistory('/test/repo');
      expect(result.success).to.be.true;
      const action = result.data?.actions[0];
      expect(action?.actionType).to.equal('merge');
      expect(action?.description).to.equal('Merge: feature into main');
      expect(action?.timestamp).to.equal(1706400000);
      expect(action?.beforeRef).to.equal('abc123def456');
      expect(action?.afterRef).to.equal('ghi789jkl012');
      expect(action?.details).to.be.a('string');
    });
  });

  describe('undoLastAction', () => {
    it('invokes undo_last_action command with path', async () => {
      const mockResult: UndoAction = {
        actionType: 'undo',
        description: 'Undo: Commit: Add new feature',
        timestamp: 1706400000,
        beforeRef: 'def456',
        afterRef: 'abc123',
        details: null,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await undoLastAction('/test/repo');
      expect(lastInvokedCommand).to.equal('undo_last_action');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('returns the undo action result', async () => {
      const mockResult: UndoAction = {
        actionType: 'undo',
        description: 'Undo: Commit: Add feature',
        timestamp: 1706400000,
        beforeRef: 'def456',
        afterRef: 'abc123',
        details: '{"undoneAction": "commit"}',
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await undoLastAction('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.actionType).to.equal('undo');
      expect(result.data?.description).to.include('Undo');
    });

    it('handles error when nothing to undo', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Nothing to undo: not enough reflog history',
        });

      const result = await undoLastAction('/test/repo');
      expect(result.success).to.be.false;
    });

    it('handles error when repo not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPO_NOT_FOUND', message: 'Repository not found' });

      const result = await undoLastAction('/invalid/path');
      expect(result.success).to.be.false;
    });
  });

  describe('redoLastAction', () => {
    it('invokes redo_last_action command with path', async () => {
      const mockResult: UndoAction = {
        actionType: 'redo',
        description: 'Redo: restored previous state',
        timestamp: 1706400000,
        beforeRef: 'abc123',
        afterRef: 'def456',
        details: null,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await redoLastAction('/test/repo');
      expect(lastInvokedCommand).to.equal('redo_last_action');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('returns the redo action result', async () => {
      const mockResult: UndoAction = {
        actionType: 'redo',
        description: 'Redo: restored previous state',
        timestamp: 1706400000,
        beforeRef: 'abc123',
        afterRef: 'def456',
        details: '{"author": "Test User"}',
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await redoLastAction('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.actionType).to.equal('redo');
      expect(result.data?.description).to.include('Redo');
    });

    it('handles error when nothing to redo', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Nothing to redo: last action was not an undo',
        });

      const result = await redoLastAction('/test/repo');
      expect(result.success).to.be.false;
    });

    it('handles error when repo not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPO_NOT_FOUND', message: 'Repository not found' });

      const result = await redoLastAction('/invalid/path');
      expect(result.success).to.be.false;
    });
  });

  describe('recordAction', () => {
    it('invokes record_action command with path and action', async () => {
      mockInvoke = () => Promise.resolve(undefined);

      const action: UndoAction = {
        actionType: 'branch_delete',
        description: 'Deleted branch feature',
        timestamp: 1706400000,
        beforeRef: 'abc123',
        afterRef: 'def456',
        details: null,
      };

      await recordAction('/test/repo', action);
      expect(lastInvokedCommand).to.equal('record_action');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.action).to.deep.equal(action);
    });

    it('records action successfully', async () => {
      mockInvoke = () => Promise.resolve(undefined);

      const action: UndoAction = {
        actionType: 'stash',
        description: 'Stash: WIP changes',
        timestamp: 1706400000,
        beforeRef: 'abc123',
        afterRef: 'def456',
        details: '{"stashIndex": 0}',
      };

      const result = await recordAction('/test/repo', action);
      expect(result.success).to.be.true;
    });

    it('handles error when repo not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPO_NOT_FOUND', message: 'Repository not found' });

      const action: UndoAction = {
        actionType: 'commit',
        description: 'test',
        timestamp: 0,
        beforeRef: '',
        afterRef: '',
        details: null,
      };

      const result = await recordAction('/invalid/path', action);
      expect(result.success).to.be.false;
    });

    it('passes action with all fields', async () => {
      mockInvoke = () => Promise.resolve(undefined);

      const action: UndoAction = {
        actionType: 'reset',
        description: 'Reset: moving to HEAD~3',
        timestamp: 1706400000,
        beforeRef: 'abc123def456789',
        afterRef: 'ghi789jkl012345',
        details: '{"mode": "hard"}',
      };

      await recordAction('/test/repo', action);
      const args = lastInvokedArgs as Record<string, unknown>;
      const passedAction = args.action as UndoAction;
      expect(passedAction.actionType).to.equal('reset');
      expect(passedAction.description).to.equal('Reset: moving to HEAD~3');
      expect(passedAction.timestamp).to.equal(1706400000);
      expect(passedAction.beforeRef).to.equal('abc123def456789');
      expect(passedAction.afterRef).to.equal('ghi789jkl012345');
      expect(passedAction.details).to.equal('{"mode": "hard"}');
    });
  });
});
