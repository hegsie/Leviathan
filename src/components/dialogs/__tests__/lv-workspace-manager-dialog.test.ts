import { expect } from '@open-wc/testing';
import type { Workspace, WorkspaceRepoStatus, WorkspaceSearchResult } from '../../../types/git.types.ts';

// Mock Tauri API
const mockWorkspaces: Workspace[] = [
  {
    id: 'ws-1',
    name: 'Backend',
    description: 'Backend services',
    color: '#4fc3f7',
    repositories: [
      { path: '/repos/api-gateway', name: 'api-gateway' },
      { path: '/repos/auth-service', name: 'auth-service' },
    ],
    createdAt: '2025-01-01T00:00:00Z',
    lastOpened: null,
  },
  {
    id: 'ws-2',
    name: 'Frontend',
    description: 'Frontend apps',
    color: '#81c784',
    repositories: [],
    createdAt: '2025-01-02T00:00:00Z',
    lastOpened: null,
  },
];

const mockStatuses: WorkspaceRepoStatus[] = [
  {
    path: '/repos/api-gateway',
    name: 'api-gateway',
    exists: true,
    isValidRepo: true,
    changedFilesCount: 2,
    currentBranch: 'main',
    ahead: 1,
    behind: 0,
  },
  {
    path: '/repos/auth-service',
    name: 'auth-service',
    exists: true,
    isValidRepo: true,
    changedFilesCount: 0,
    currentBranch: 'main',
    ahead: 0,
    behind: 0,
  },
];

const mockSearchResults: WorkspaceSearchResult[] = [
  {
    repoName: 'api-gateway',
    repoPath: '/repos/api-gateway',
    filePath: 'src/main.ts',
    lineNumber: 42,
    lineContent: 'const searchTerm = "hello";',
    matchStart: 22,
    matchEnd: 27,
  },
  {
    repoName: 'api-gateway',
    repoPath: '/repos/api-gateway',
    filePath: 'src/utils.ts',
    lineNumber: 10,
    lineContent: 'function hello() {}',
    matchStart: 9,
    matchEnd: 14,
  },
  {
    repoName: 'auth-service',
    repoPath: '/repos/auth-service',
    filePath: 'index.ts',
    lineNumber: 1,
    lineContent: '// hello world',
    matchStart: 3,
    matchEnd: 8,
  },
];

const mockExportedJson = JSON.stringify(mockWorkspaces[0], null, 2);

let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;

const mockInvoke = (command: string, args?: unknown): Promise<unknown> => {
  lastInvokedCommand = command;
  lastInvokedArgs = args;
  switch (command) {
    case 'get_workspaces':
      return Promise.resolve(mockWorkspaces);
    case 'get_workspace':
      return Promise.resolve(mockWorkspaces[0]);
    case 'save_workspace':
      return Promise.resolve((args as Record<string, unknown>).workspace ?? mockWorkspaces[0]);
    case 'delete_workspace':
      return Promise.resolve(null);
    case 'add_repository_to_workspace':
      return Promise.resolve(mockWorkspaces[0]);
    case 'remove_repository_from_workspace':
      return Promise.resolve(mockWorkspaces[0]);
    case 'update_workspace_last_opened':
      return Promise.resolve(null);
    case 'validate_workspace_repositories':
      return Promise.resolve(mockStatuses);
    case 'open_repository':
      return Promise.resolve({
        path: '/repos/api-gateway',
        name: 'api-gateway',
        isValid: true,
        isBare: false,
        headRef: 'main',
        state: 'clean',
      });
    case 'search_workspace':
      return Promise.resolve(mockSearchResults);
    case 'export_workspace':
      return Promise.resolve(mockExportedJson);
    case 'import_workspace':
      return Promise.resolve({
        ...mockWorkspaces[0],
        id: 'ws-imported',
        name: 'Imported Workspace',
      });
    default:
      return Promise.resolve(null);
  }
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('Workspace Manager Dialog Data', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('Workspace type', () => {
    it('has correct structure', () => {
      const ws = mockWorkspaces[0];
      expect(ws.id).to.equal('ws-1');
      expect(ws.name).to.equal('Backend');
      expect(ws.description).to.equal('Backend services');
      expect(ws.color).to.equal('#4fc3f7');
      expect(ws.repositories.length).to.equal(2);
      expect(ws.createdAt).to.be.a('string');
      expect(ws.lastOpened).to.be.null;
    });

    it('repositories have path and name', () => {
      const repos = mockWorkspaces[0].repositories;
      expect(repos[0].path).to.equal('/repos/api-gateway');
      expect(repos[0].name).to.equal('api-gateway');
    });

    it('supports empty repositories', () => {
      const ws = mockWorkspaces[1];
      expect(ws.repositories).to.deep.equal([]);
    });
  });

  describe('WorkspaceRepoStatus type', () => {
    it('has correct structure for valid repo', () => {
      const status = mockStatuses[0];
      expect(status.path).to.equal('/repos/api-gateway');
      expect(status.exists).to.be.true;
      expect(status.isValidRepo).to.be.true;
      expect(status.changedFilesCount).to.equal(2);
      expect(status.currentBranch).to.equal('main');
      expect(status.ahead).to.equal(1);
      expect(status.behind).to.equal(0);
    });

    it('has correct structure for clean repo', () => {
      const status = mockStatuses[1];
      expect(status.changedFilesCount).to.equal(0);
      expect(status.ahead).to.equal(0);
      expect(status.behind).to.equal(0);
    });

    it('supports missing repo', () => {
      const missingStatus: WorkspaceRepoStatus = {
        path: '/repos/missing',
        name: 'missing',
        exists: false,
        isValidRepo: false,
        changedFilesCount: 0,
        currentBranch: null,
        ahead: 0,
        behind: 0,
      };
      expect(missingStatus.exists).to.be.false;
      expect(missingStatus.isValidRepo).to.be.false;
      expect(missingStatus.currentBranch).to.be.null;
    });
  });

  describe('Tauri commands', () => {
    it('get_workspaces returns workspace list', async () => {
      const result = await mockInvoke('get_workspaces');
      expect(lastInvokedCommand).to.equal('get_workspaces');
      expect(result).to.deep.equal(mockWorkspaces);
    });

    it('save_workspace passes workspace object', async () => {
      const ws = mockWorkspaces[0];
      await mockInvoke('save_workspace', { workspace: ws });
      expect(lastInvokedCommand).to.equal('save_workspace');
      expect((lastInvokedArgs as Record<string, unknown>).workspace).to.deep.equal(ws);
    });

    it('delete_workspace passes workspaceId', async () => {
      await mockInvoke('delete_workspace', { workspaceId: 'ws-1' });
      expect(lastInvokedCommand).to.equal('delete_workspace');
      expect((lastInvokedArgs as Record<string, unknown>).workspaceId).to.equal('ws-1');
    });

    it('add_repository_to_workspace passes camelCase args', async () => {
      await mockInvoke('add_repository_to_workspace', {
        workspaceId: 'ws-1',
        path: '/new/repo',
        name: 'repo',
      });
      expect(lastInvokedCommand).to.equal('add_repository_to_workspace');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.workspaceId).to.equal('ws-1');
      expect(args.path).to.equal('/new/repo');
      expect(args.name).to.equal('repo');
    });

    it('remove_repository_from_workspace passes camelCase args', async () => {
      await mockInvoke('remove_repository_from_workspace', {
        workspaceId: 'ws-1',
        path: '/repos/api-gateway',
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.workspaceId).to.equal('ws-1');
      expect(args.path).to.equal('/repos/api-gateway');
    });

    it('validate_workspace_repositories passes workspaceId', async () => {
      const result = await mockInvoke('validate_workspace_repositories', {
        workspaceId: 'ws-1',
      });
      expect(lastInvokedCommand).to.equal('validate_workspace_repositories');
      expect(result).to.deep.equal(mockStatuses);
    });

    it('update_workspace_last_opened passes workspaceId', async () => {
      await mockInvoke('update_workspace_last_opened', { workspaceId: 'ws-1' });
      expect(lastInvokedCommand).to.equal('update_workspace_last_opened');
      expect((lastInvokedArgs as Record<string, unknown>).workspaceId).to.equal('ws-1');
    });
  });

  describe('Workspace color constants', () => {
    it('should have valid hex colors', () => {
      const colors = ['#4fc3f7', '#81c784', '#ef5350', '#ffb74d', '#ce93d8', '#4dd0e1', '#ff8a65', '#aed581'];
      for (const color of colors) {
        expect(color).to.match(/^#[0-9a-f]{6}$/);
      }
    });
  });

  describe('Workspace search', () => {
    it('search_workspace passes correct args', async () => {
      await mockInvoke('search_workspace', {
        workspaceId: 'ws-1',
        query: 'hello',
        caseSensitive: false,
        regex: false,
        maxResults: 200,
      });
      expect(lastInvokedCommand).to.equal('search_workspace');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.workspaceId).to.equal('ws-1');
      expect(args.query).to.equal('hello');
      expect(args.caseSensitive).to.equal(false);
    });

    it('search results have correct structure', async () => {
      const results = (await mockInvoke('search_workspace', {
        workspaceId: 'ws-1',
        query: 'hello',
      })) as WorkspaceSearchResult[];

      expect(results).to.have.lengthOf(3);

      const first = results[0];
      expect(first.repoName).to.equal('api-gateway');
      expect(first.repoPath).to.equal('/repos/api-gateway');
      expect(first.filePath).to.equal('src/main.ts');
      expect(first.lineNumber).to.equal(42);
      expect(first.lineContent).to.include('searchTerm');
      expect(first.matchStart).to.be.a('number');
      expect(first.matchEnd).to.be.a('number');
    });

    it('search results can be grouped by repo', () => {
      const grouped = new Map<string, WorkspaceSearchResult[]>();
      for (const r of mockSearchResults) {
        if (!grouped.has(r.repoName)) {
          grouped.set(r.repoName, []);
        }
        grouped.get(r.repoName)!.push(r);
      }

      expect(grouped.size).to.equal(2);
      expect(grouped.get('api-gateway')!.length).to.equal(2);
      expect(grouped.get('auth-service')!.length).to.equal(1);
    });
  });

  describe('Workspace export/import', () => {
    it('export_workspace returns JSON string', async () => {
      const result = await mockInvoke('export_workspace', { workspaceId: 'ws-1' });
      expect(lastInvokedCommand).to.equal('export_workspace');
      expect(result).to.be.a('string');
      const parsed = JSON.parse(result as string);
      expect(parsed.id).to.equal('ws-1');
      expect(parsed.name).to.equal('Backend');
    });

    it('import_workspace passes JSON data', async () => {
      const jsonData = JSON.stringify(mockWorkspaces[0]);
      const result = (await mockInvoke('import_workspace', { jsonData })) as Workspace;
      expect(lastInvokedCommand).to.equal('import_workspace');
      expect(result.id).to.equal('ws-imported');
      expect(result.name).to.equal('Imported Workspace');
    });

    it('imported workspace gets new ID', async () => {
      const jsonData = JSON.stringify(mockWorkspaces[0]);
      const result = (await mockInvoke('import_workspace', { jsonData })) as Workspace;
      expect(result.id).to.not.equal(mockWorkspaces[0].id);
    });
  });
});
