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
  getBranchRules,
  setBranchRule,
  deleteBranchRule,
} from '../git.service.ts';
import type { BranchRule } from '../git.service.ts';

const sampleRule: BranchRule = {
  pattern: 'main',
  preventDeletion: true,
  preventForcePush: true,
  requirePullRequest: false,
  preventDirectPush: false,
};

const sampleRules: BranchRule[] = [
  sampleRule,
  {
    pattern: 'release/*',
    preventDeletion: true,
    preventForcePush: true,
    requirePullRequest: true,
    preventDirectPush: true,
  },
];

describe('git.service - Branch Rules operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getBranchRules', () => {
    it('invokes get_branch_rules command with path', async () => {
      mockInvoke = () => Promise.resolve(sampleRules);

      const result = await getBranchRules('/path/to/repo');
      expect(lastInvokedCommand).to.equal('get_branch_rules');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/path/to/repo');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array when no rules exist', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getBranchRules('/path/to/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles errors', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'GIT_ERROR', message: 'Repository not found' });

      const result = await getBranchRules('/nonexistent');
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('not found');
    });
  });

  describe('setBranchRule', () => {
    it('invokes set_branch_rule with path and rule', async () => {
      mockInvoke = () => Promise.resolve([sampleRule]);

      const result = await setBranchRule('/path/to/repo', sampleRule);
      expect(lastInvokedCommand).to.equal('set_branch_rule');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/path/to/repo');
      expect(args.rule).to.deep.equal(sampleRule);
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('returns updated rules list after adding', async () => {
      mockInvoke = () => Promise.resolve(sampleRules);

      const result = await setBranchRule('/path/to/repo', sampleRules[1]);
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('handles empty pattern error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Branch rule pattern cannot be empty',
        });

      const emptyRule: BranchRule = {
        pattern: '',
        preventDeletion: false,
        preventForcePush: false,
        requirePullRequest: false,
        preventDirectPush: false,
      };

      const result = await setBranchRule('/path/to/repo', emptyRule);
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('empty');
    });
  });

  describe('deleteBranchRule', () => {
    it('invokes delete_branch_rule with path and pattern', async () => {
      mockInvoke = () => Promise.resolve([sampleRules[1]]);

      const result = await deleteBranchRule('/path/to/repo', 'main');
      expect(lastInvokedCommand).to.equal('delete_branch_rule');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/path/to/repo');
      expect(args.pattern).to.equal('main');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('handles rule not found error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'No branch rule found for pattern: nonexistent',
        });

      const result = await deleteBranchRule('/path/to/repo', 'nonexistent');
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('No branch rule found');
    });
  });

  describe('BranchRule interface', () => {
    it('has correct shape with all fields', () => {
      const rule: BranchRule = {
        pattern: 'develop',
        preventDeletion: true,
        preventForcePush: false,
        requirePullRequest: true,
        preventDirectPush: false,
      };

      expect(rule.pattern).to.equal('develop');
      expect(rule.preventDeletion).to.be.true;
      expect(rule.preventForcePush).to.be.false;
      expect(rule.requirePullRequest).to.be.true;
      expect(rule.preventDirectPush).to.be.false;
    });

    it('supports glob patterns', () => {
      const rule: BranchRule = {
        pattern: 'feature/*',
        preventDeletion: false,
        preventForcePush: false,
        requirePullRequest: false,
        preventDirectPush: false,
      };

      expect(rule.pattern).to.equal('feature/*');
    });
  });
});
