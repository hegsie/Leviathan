/**
 * Integration tests for Tauri invoke parameter naming.
 *
 * These tests verify that all parameters passed to Tauri's invoke function
 * use camelCase (as Tauri automatically converts Rust's snake_case to camelCase).
 *
 * This catches issues where TypeScript code uses snake_case (e.g., source_ref)
 * but Tauri expects camelCase (e.g., sourceRef).
 */

import { expect } from '@open-wc/testing';

// Track all invoke calls
const invokeCalls: Array<{ command: string; args: Record<string, unknown> }> = [];

// Mock the Tauri invoke function to capture calls
const mockInvoke = async (command: string, args?: Record<string, unknown>) => {
  invokeCalls.push({ command, args: args || {} });
  // Return appropriate mock data based on command
  switch (command) {
    case 'merge':
    case 'reset':
    case 'create_stash':
    case 'apply_stash':
    case 'cherry_pick':
    case 'revert':
      return null;
    default:
      return null;
  }
};

// Set up the mock before importing modules
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
  transformCallback: () => 0,
  convertFileSrc: (path: string) => path,
};

// Import after mocking
import * as gitService from '../git.service.js';

/**
 * Check if a string contains snake_case (has underscore followed by lowercase letter)
 */
function hasSnakeCase(str: string): boolean {
  return /_[a-z]/.test(str);
}

/**
 * Get all snake_case keys from an object
 */
function getSnakeCaseKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter(hasSnakeCase);
}

describe('Tauri Invoke Parameter Naming', () => {
  beforeEach(() => {
    // Clear invoke calls before each test
    invokeCalls.length = 0;
  });

  describe('Merge command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.merge({
        path: '/test/repo',
        sourceRef: 'feature-branch',
        noFf: true,
        squash: false,
        message: 'Merge commit',
      });

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('merge');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );

      // Verify specific parameters are camelCase
      expect(invokeCalls[0].args).to.have.property('sourceRef');
      expect(invokeCalls[0].args).to.have.property('noFf');
      expect(invokeCalls[0].args).to.not.have.property('source_ref');
      expect(invokeCalls[0].args).to.not.have.property('no_ff');
    });
  });

  describe('Reset command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.reset({
        path: '/test/repo',
        targetRef: 'abc123',
        mode: 'hard',
      });

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('reset');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );

      // Verify specific parameters are camelCase
      expect(invokeCalls[0].args).to.have.property('targetRef');
      expect(invokeCalls[0].args).to.not.have.property('target_ref');
    });
  });

  describe('Create stash command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.createStash({
        path: '/test/repo',
        message: 'WIP',
        includeUntracked: true,
      });

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('create_stash');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );

      // Verify specific parameters are camelCase
      expect(invokeCalls[0].args).to.have.property('includeUntracked');
      expect(invokeCalls[0].args).to.not.have.property('include_untracked');
    });
  });

  describe('Apply stash command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.applyStash({
        path: '/test/repo',
        index: 0,
        dropAfter: true,
      });

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('apply_stash');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );

      // Verify specific parameters are camelCase
      expect(invokeCalls[0].args).to.have.property('dropAfter');
      expect(invokeCalls[0].args).to.not.have.property('drop_after');
    });
  });

  describe('Cherry-pick command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.cherryPick({
        path: '/test/repo',
        commitOid: 'abc123',
        noCommit: true,
      });

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('cherry_pick');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );

      // Verify specific parameters are camelCase
      expect(invokeCalls[0].args).to.have.property('commitOid');
      expect(invokeCalls[0].args).to.have.property('noCommit');
      expect(invokeCalls[0].args).to.not.have.property('commit_oid');
      expect(invokeCalls[0].args).to.not.have.property('no_commit');
    });
  });

  describe('Revert command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.revert({
        path: '/test/repo',
        commitOid: 'abc123',
      });

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('revert');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );

      // Verify specific parameters are camelCase
      expect(invokeCalls[0].args).to.have.property('commitOid');
      expect(invokeCalls[0].args).to.not.have.property('commit_oid');
    });
  });

  describe('getMergeToolConfig command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.getMergeToolConfig('/test/repo');

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('get_merge_tool_config');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );
    });
  });

  describe('setMergeToolConfig command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.setMergeToolConfig('/test/repo', 'kdiff3', '/usr/bin/kdiff3');

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('set_merge_tool_config');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );

      // Verify specific parameters are camelCase
      expect(invokeCalls[0].args).to.have.property('toolName');
      expect(invokeCalls[0].args).to.have.property('toolCmd');
      expect(invokeCalls[0].args).to.not.have.property('tool_name');
      expect(invokeCalls[0].args).to.not.have.property('tool_cmd');
    });
  });

  describe('launchMergeTool command', () => {
    it('should use camelCase for all parameters', async () => {
      await gitService.launchMergeTool('/test/repo', 'src/file.ts');

      expect(invokeCalls.length).to.equal(1);
      expect(invokeCalls[0].command).to.equal('launch_merge_tool');

      const snakeCaseKeys = getSnakeCaseKeys(invokeCalls[0].args);
      expect(snakeCaseKeys).to.deep.equal(
        [],
        `Found snake_case parameters: ${snakeCaseKeys.join(', ')}`
      );

      // Verify specific parameters are camelCase
      expect(invokeCalls[0].args).to.have.property('filePath');
      expect(invokeCalls[0].args).to.not.have.property('file_path');
    });
  });

  describe('All commands - generic snake_case check', () => {
    it('should never pass snake_case parameters to any Tauri command', async () => {
      // Call various commands to populate invokeCalls
      await gitService.merge({ path: '/test', sourceRef: 'main' });
      await gitService.reset({ path: '/test', targetRef: 'abc', mode: 'hard' });
      await gitService.createStash({ path: '/test' });
      await gitService.applyStash({ path: '/test', index: 0 });
      await gitService.cherryPick({ path: '/test', commitOid: 'abc' });
      await gitService.revert({ path: '/test', commitOid: 'abc' });
      await gitService.getMergeToolConfig('/test');
      await gitService.setMergeToolConfig('/test', 'kdiff3', '/usr/bin/kdiff3');
      await gitService.launchMergeTool('/test', 'file.ts');
      await gitService.getAvailableMergeTools();

      // Check all calls for snake_case
      const violations: string[] = [];
      for (const call of invokeCalls) {
        const snakeCaseKeys = getSnakeCaseKeys(call.args);
        if (snakeCaseKeys.length > 0) {
          violations.push(`${call.command}: ${snakeCaseKeys.join(', ')}`);
        }
      }

      expect(violations).to.deep.equal(
        [],
        `Found snake_case parameters in Tauri commands:\n${violations.join('\n')}`
      );
    });
  });
});
