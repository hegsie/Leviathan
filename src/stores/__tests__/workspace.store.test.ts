import { expect } from '@open-wc/testing';
import { workspaceStore } from '../workspace.store.ts';
import type { Workspace } from '../../types/git.types.ts';

function createMockWorkspace(id: string, name = 'Test Workspace'): Workspace {
  return {
    id,
    name,
    description: '',
    color: '#4fc3f7',
    repositories: [],
    createdAt: '2025-01-01T00:00:00Z',
    lastOpened: null,
  };
}

describe('workspace.store', () => {
  beforeEach(() => {
    workspaceStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts with empty workspaces', () => {
      const state = workspaceStore.getState();
      expect(state.workspaces.length).to.equal(0);
    });

    it('starts with no active workspace', () => {
      const state = workspaceStore.getState();
      expect(state.activeWorkspaceId).to.be.null;
    });

    it('starts with no loading state', () => {
      const state = workspaceStore.getState();
      expect(state.isLoading).to.be.false;
      expect(state.error).to.be.null;
    });
  });

  describe('setWorkspaces', () => {
    it('sets the workspaces array', () => {
      const ws = [createMockWorkspace('ws-1'), createMockWorkspace('ws-2')];
      workspaceStore.getState().setWorkspaces(ws);

      const state = workspaceStore.getState();
      expect(state.workspaces.length).to.equal(2);
      expect(state.workspaces[0].id).to.equal('ws-1');
    });

    it('replaces existing workspaces', () => {
      workspaceStore.getState().setWorkspaces([createMockWorkspace('ws-1')]);
      workspaceStore.getState().setWorkspaces([createMockWorkspace('ws-2')]);

      const state = workspaceStore.getState();
      expect(state.workspaces.length).to.equal(1);
      expect(state.workspaces[0].id).to.equal('ws-2');
    });
  });

  describe('addOrUpdateWorkspace', () => {
    it('adds a new workspace', () => {
      const ws = createMockWorkspace('ws-1', 'New WS');
      workspaceStore.getState().addOrUpdateWorkspace(ws);

      const state = workspaceStore.getState();
      expect(state.workspaces.length).to.equal(1);
      expect(state.workspaces[0].name).to.equal('New WS');
    });

    it('updates an existing workspace', () => {
      workspaceStore.getState().addOrUpdateWorkspace(createMockWorkspace('ws-1', 'Original'));
      workspaceStore.getState().addOrUpdateWorkspace(createMockWorkspace('ws-1', 'Updated'));

      const state = workspaceStore.getState();
      expect(state.workspaces.length).to.equal(1);
      expect(state.workspaces[0].name).to.equal('Updated');
    });
  });

  describe('removeWorkspace', () => {
    it('removes a workspace by id', () => {
      workspaceStore.getState().setWorkspaces([
        createMockWorkspace('ws-1'),
        createMockWorkspace('ws-2'),
      ]);
      workspaceStore.getState().removeWorkspace('ws-1');

      const state = workspaceStore.getState();
      expect(state.workspaces.length).to.equal(1);
      expect(state.workspaces[0].id).to.equal('ws-2');
    });

    it('clears activeWorkspaceId if removed workspace was active', () => {
      workspaceStore.getState().setWorkspaces([createMockWorkspace('ws-1')]);
      workspaceStore.getState().setActiveWorkspaceId('ws-1');
      workspaceStore.getState().removeWorkspace('ws-1');

      expect(workspaceStore.getState().activeWorkspaceId).to.be.null;
    });

    it('keeps activeWorkspaceId if removed workspace was not active', () => {
      workspaceStore.getState().setWorkspaces([
        createMockWorkspace('ws-1'),
        createMockWorkspace('ws-2'),
      ]);
      workspaceStore.getState().setActiveWorkspaceId('ws-1');
      workspaceStore.getState().removeWorkspace('ws-2');

      expect(workspaceStore.getState().activeWorkspaceId).to.equal('ws-1');
    });
  });

  describe('setActiveWorkspaceId', () => {
    it('sets the active workspace id', () => {
      workspaceStore.getState().setActiveWorkspaceId('ws-1');
      expect(workspaceStore.getState().activeWorkspaceId).to.equal('ws-1');
    });

    it('can clear the active workspace', () => {
      workspaceStore.getState().setActiveWorkspaceId('ws-1');
      workspaceStore.getState().setActiveWorkspaceId(null);
      expect(workspaceStore.getState().activeWorkspaceId).to.be.null;
    });
  });

  describe('setLoading', () => {
    it('sets loading state', () => {
      workspaceStore.getState().setLoading(true);
      expect(workspaceStore.getState().isLoading).to.be.true;

      workspaceStore.getState().setLoading(false);
      expect(workspaceStore.getState().isLoading).to.be.false;
    });
  });

  describe('setError', () => {
    it('sets error message', () => {
      workspaceStore.getState().setError('Something failed');
      expect(workspaceStore.getState().error).to.equal('Something failed');
    });

    it('clears error', () => {
      workspaceStore.getState().setError('err');
      workspaceStore.getState().setError(null);
      expect(workspaceStore.getState().error).to.be.null;
    });
  });

  describe('reset', () => {
    it('resets to initial state', () => {
      workspaceStore.getState().setWorkspaces([createMockWorkspace('ws-1')]);
      workspaceStore.getState().setActiveWorkspaceId('ws-1');
      workspaceStore.getState().setLoading(true);
      workspaceStore.getState().setError('err');

      workspaceStore.getState().reset();

      const state = workspaceStore.getState();
      expect(state.workspaces.length).to.equal(0);
      expect(state.activeWorkspaceId).to.be.null;
      expect(state.isLoading).to.be.false;
      expect(state.error).to.be.null;
    });
  });
});
