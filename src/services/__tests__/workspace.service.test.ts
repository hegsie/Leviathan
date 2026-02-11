import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    return mockInvoke(command, args);
  },
};

import {
  getWorkspaces,
  getWorkspace,
  saveWorkspace,
  deleteWorkspace,
  addRepositoryToWorkspace,
  removeRepositoryFromWorkspace,
  updateWorkspaceLastOpened,
  validateWorkspaceRepositories,
} from '../workspace.service.ts';
import type { Workspace, WorkspaceRepoStatus } from '../../types/git.types.ts';

const mockWorkspace: Workspace = {
  id: 'ws-1',
  name: 'Test Workspace',
  description: 'A test workspace',
  color: '#4fc3f7',
  repositories: [
    { path: '/repo/one', name: 'one' },
    { path: '/repo/two', name: 'two' },
  ],
  createdAt: '2025-01-01T00:00:00Z',
  lastOpened: null,
};

describe('workspace.service', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getWorkspaces', () => {
    it('invokes get_workspaces command', async () => {
      mockInvoke = () => Promise.resolve([mockWorkspace]);

      const result = await getWorkspaces();
      expect(lastInvokedCommand).to.equal('get_workspaces');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('returns empty array when no workspaces', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getWorkspaces();
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('getWorkspace', () => {
    it('invokes get_workspace with workspaceId', async () => {
      mockInvoke = () => Promise.resolve(mockWorkspace);

      const result = await getWorkspace('ws-1');
      expect(lastInvokedCommand).to.equal('get_workspace');
      expect((lastInvokedArgs as Record<string, unknown>).workspaceId).to.equal('ws-1');
      expect(result.success).to.be.true;
      expect(result.data?.name).to.equal('Test Workspace');
    });

    it('handles workspace not found', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'Workspace not found' });

      const result = await getWorkspace('nonexistent');
      expect(result.success).to.be.false;
    });
  });

  describe('saveWorkspace', () => {
    it('invokes save_workspace with workspace object', async () => {
      mockInvoke = () => Promise.resolve(mockWorkspace);

      const result = await saveWorkspace(mockWorkspace);
      expect(lastInvokedCommand).to.equal('save_workspace');
      expect((lastInvokedArgs as Record<string, unknown>).workspace).to.deep.equal(mockWorkspace);
      expect(result.success).to.be.true;
    });

    it('handles save error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to save' });

      const result = await saveWorkspace(mockWorkspace);
      expect(result.success).to.be.false;
    });
  });

  describe('deleteWorkspace', () => {
    it('invokes delete_workspace with workspaceId', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await deleteWorkspace('ws-1');
      expect(lastInvokedCommand).to.equal('delete_workspace');
      expect((lastInvokedArgs as Record<string, unknown>).workspaceId).to.equal('ws-1');
      expect(result.success).to.be.true;
    });
  });

  describe('addRepositoryToWorkspace', () => {
    it('invokes add_repository_to_workspace with camelCase args', async () => {
      mockInvoke = () => Promise.resolve(mockWorkspace);

      const result = await addRepositoryToWorkspace('ws-1', '/new/repo', 'repo');
      expect(lastInvokedCommand).to.equal('add_repository_to_workspace');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.workspaceId).to.equal('ws-1');
      expect(args.path).to.equal('/new/repo');
      expect(args.name).to.equal('repo');
      expect(result.success).to.be.true;
    });
  });

  describe('removeRepositoryFromWorkspace', () => {
    it('invokes remove_repository_from_workspace with camelCase args', async () => {
      mockInvoke = () => Promise.resolve(mockWorkspace);

      const result = await removeRepositoryFromWorkspace('ws-1', '/repo/one');
      expect(lastInvokedCommand).to.equal('remove_repository_from_workspace');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.workspaceId).to.equal('ws-1');
      expect(args.path).to.equal('/repo/one');
      expect(result.success).to.be.true;
    });
  });

  describe('updateWorkspaceLastOpened', () => {
    it('invokes update_workspace_last_opened with workspaceId', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await updateWorkspaceLastOpened('ws-1');
      expect(lastInvokedCommand).to.equal('update_workspace_last_opened');
      expect((lastInvokedArgs as Record<string, unknown>).workspaceId).to.equal('ws-1');
      expect(result.success).to.be.true;
    });
  });

  describe('validateWorkspaceRepositories', () => {
    it('invokes validate_workspace_repositories with workspaceId', async () => {
      const mockStatuses: WorkspaceRepoStatus[] = [
        {
          path: '/repo/one',
          name: 'one',
          exists: true,
          isValidRepo: true,
          changedFilesCount: 3,
          currentBranch: 'main',
          ahead: 1,
          behind: 0,
        },
        {
          path: '/repo/two',
          name: 'two',
          exists: false,
          isValidRepo: false,
          changedFilesCount: 0,
          currentBranch: null,
          ahead: 0,
          behind: 0,
        },
      ];
      mockInvoke = () => Promise.resolve(mockStatuses);

      const result = await validateWorkspaceRepositories('ws-1');
      expect(lastInvokedCommand).to.equal('validate_workspace_repositories');
      expect((lastInvokedArgs as Record<string, unknown>).workspaceId).to.equal('ws-1');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
      expect(result.data?.[0].changedFilesCount).to.equal(3);
      expect(result.data?.[1].exists).to.be.false;
    });
  });
});
