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
  getCustomActions,
  saveCustomAction,
  deleteCustomAction,
  runCustomAction,
  type CustomAction,
  type ActionResult,
} from '../git.service.ts';

function makeAction(overrides: Partial<CustomAction> = {}): CustomAction {
  return {
    id: '1',
    name: 'Build',
    command: 'cargo build',
    arguments: null,
    workingDirectory: null,
    shortcut: null,
    showInToolbar: false,
    openInTerminal: false,
    confirmBeforeRun: false,
    ...overrides,
  };
}

describe('git.service - Custom Actions', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getCustomActions', () => {
    it('invokes get_custom_actions command', async () => {
      const mockActions: CustomAction[] = [
        makeAction({ id: '1', name: 'Build', command: 'cargo build' }),
        makeAction({ id: '2', name: 'Test', command: 'cargo test' }),
      ];
      mockInvoke = () => Promise.resolve(mockActions);

      const result = await getCustomActions('/test/repo');
      expect(lastInvokedCommand).to.equal('get_custom_actions');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array when no actions configured', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getCustomActions('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(0);
    });

    it('passes repo path correctly', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getCustomActions('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });
  });

  describe('saveCustomAction', () => {
    it('invokes save_custom_action command', async () => {
      const action = makeAction();
      const mockResult = [action];
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await saveCustomAction('/test/repo', action);
      expect(lastInvokedCommand).to.equal('save_custom_action');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('passes action data correctly', async () => {
      const action = makeAction({
        name: 'Deploy',
        command: 'deploy.sh',
        arguments: '--prod',
        showInToolbar: true,
        confirmBeforeRun: true,
      });
      mockInvoke = () => Promise.resolve([action]);

      await saveCustomAction('/test/repo', action);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      const sentAction = args.action as CustomAction;
      expect(sentAction.name).to.equal('Deploy');
      expect(sentAction.command).to.equal('deploy.sh');
      expect(sentAction.arguments).to.equal('--prod');
      expect(sentAction.showInToolbar).to.be.true;
      expect(sentAction.confirmBeforeRun).to.be.true;
    });

    it('handles update of existing action', async () => {
      const action = makeAction({ id: '1', name: 'Updated Build', command: 'cargo build --release' });
      mockInvoke = () => Promise.resolve([action]);

      const result = await saveCustomAction('/test/repo', action);
      expect(result.success).to.be.true;
      expect(result.data?.[0].name).to.equal('Updated Build');
    });
  });

  describe('deleteCustomAction', () => {
    it('invokes delete_custom_action command', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await deleteCustomAction('/test/repo', 'action-1');
      expect(lastInvokedCommand).to.equal('delete_custom_action');
      expect(result.success).to.be.true;
    });

    it('passes action ID correctly', async () => {
      mockInvoke = () => Promise.resolve([]);

      await deleteCustomAction('/test/repo', 'my-action-id');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.actionId).to.equal('my-action-id');
    });

    it('returns remaining actions', async () => {
      const remaining = [makeAction({ id: '2', name: 'Test' })];
      mockInvoke = () => Promise.resolve(remaining);

      const result = await deleteCustomAction('/test/repo', '1');
      expect(result.data?.length).to.equal(1);
      expect(result.data?.[0].id).to.equal('2');
    });
  });

  describe('runCustomAction', () => {
    it('invokes run_custom_action command', async () => {
      const mockResult: ActionResult = {
        exitCode: 0,
        stdout: 'Build succeeded',
        stderr: '',
        success: true,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await runCustomAction('/test/repo', 'action-1');
      expect(lastInvokedCommand).to.equal('run_custom_action');
      expect(result.success).to.be.true;
      expect(result.data?.exitCode).to.equal(0);
      expect(result.data?.stdout).to.equal('Build succeeded');
    });

    it('passes action ID correctly', async () => {
      const mockResult: ActionResult = {
        exitCode: 0,
        stdout: '',
        stderr: '',
        success: true,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await runCustomAction('/test/repo', 'my-action-id');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.actionId).to.equal('my-action-id');
    });

    it('handles failed command execution', async () => {
      const mockResult: ActionResult = {
        exitCode: 1,
        stdout: '',
        stderr: 'Error: build failed',
        success: false,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await runCustomAction('/test/repo', 'action-1');
      expect(result.success).to.be.true; // The invoke succeeded
      expect(result.data?.success).to.be.false; // The action itself failed
      expect(result.data?.exitCode).to.equal(1);
      expect(result.data?.stderr).to.equal('Error: build failed');
    });

    it('handles action not found error', async () => {
      mockInvoke = () => Promise.reject(new Error('Action not found'));

      const result = await runCustomAction('/test/repo', 'nonexistent');
      expect(result.success).to.be.false;
    });
  });
});
