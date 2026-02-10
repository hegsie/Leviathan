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

import {
  getMergeToolConfig,
  setMergeToolConfig,
  launchMergeTool,
  getAvailableMergeTools,
} from '../git.service.ts';

describe('git.service - Merge tool operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('getMergeToolConfig', () => {
    it('invokes get_merge_tool_config with correct arguments', async () => {
      const mockConfig = { toolName: 'kdiff3', toolCmd: null };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await getMergeToolConfig('/test/repo');
      expect(lastInvokedCommand).to.equal('get_merge_tool_config');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.toolName).to.equal('kdiff3');
    });

    it('returns null values when no tool configured', async () => {
      mockInvoke = () => Promise.resolve({ toolName: null, toolCmd: null });

      const result = await getMergeToolConfig('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.toolName).to.be.null;
      expect(result.data?.toolCmd).to.be.null;
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPOSITORY_NOT_FOUND', message: 'Repository not found' });

      const result = await getMergeToolConfig('/invalid/repo');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REPOSITORY_NOT_FOUND');
    });
  });

  describe('setMergeToolConfig', () => {
    it('invokes set_merge_tool_config with tool name', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await setMergeToolConfig('/test/repo', 'meld');
      expect(lastInvokedCommand).to.equal('set_merge_tool_config');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.toolName).to.equal('meld');
      expect(result.success).to.be.true;
    });

    it('invokes set_merge_tool_config with tool name and custom command', async () => {
      mockInvoke = () => Promise.resolve(null);

      await setMergeToolConfig('/test/repo', 'custom', '/usr/bin/custom-merge $LOCAL $REMOTE $MERGED');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.toolName).to.equal('custom');
      expect(args.toolCmd).to.equal('/usr/bin/custom-merge $LOCAL $REMOTE $MERGED');
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to set config' });

      const result = await setMergeToolConfig('/test/repo', 'meld');
      expect(result.success).to.be.false;
    });
  });

  describe('launchMergeTool', () => {
    it('invokes launch_merge_tool with correct arguments', async () => {
      const mockResult = { success: true, message: 'Merge tool completed successfully' };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await launchMergeTool('/test/repo', 'src/conflicted.ts');
      expect(lastInvokedCommand).to.equal('launch_merge_tool');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.filePath).to.equal('src/conflicted.ts');
      expect(result.success).to.be.true;
      expect(result.data?.success).to.be.true;
    });

    it('returns failure result when merge tool fails', async () => {
      const mockResult = { success: false, message: 'Merge tool exited with error' };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await launchMergeTool('/test/repo', 'src/file.ts');
      expect(result.success).to.be.true;
      expect(result.data?.success).to.be.false;
      expect(result.data?.message).to.equal('Merge tool exited with error');
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to launch merge tool' });

      const result = await launchMergeTool('/test/repo', 'file.ts');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('OPERATION_FAILED');
    });
  });

  describe('getAvailableMergeTools', () => {
    it('invokes get_available_merge_tools and returns tool list', async () => {
      const mockTools = [
        { name: 'kdiff3', displayName: 'KDiff3' },
        { name: 'meld', displayName: 'Meld' },
        { name: 'vscode', displayName: 'Visual Studio Code' },
      ];
      mockInvoke = () => Promise.resolve(mockTools);

      const result = await getAvailableMergeTools();
      expect(lastInvokedCommand).to.equal('get_available_merge_tools');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
      expect(result.data?.[0].name).to.equal('kdiff3');
      expect(result.data?.[0].displayName).to.equal('KDiff3');
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed' });

      const result = await getAvailableMergeTools();
      expect(result.success).to.be.false;
    });
  });
});
