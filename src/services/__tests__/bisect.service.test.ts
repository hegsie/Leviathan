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
  getBisectStatus,
  bisectStart,
  bisectBad,
  bisectGood,
  bisectSkip,
  bisectReset,
  type BisectStatus,
  type BisectStepResult,
  type CulpritCommit,
} from '../git.service.ts';

describe('git.service - Bisect operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
  });

  describe('getBisectStatus', () => {
    it('invokes get_bisect_status command', async () => {
      const mockStatus: BisectStatus = {
        active: false,
        currentCommit: null,
        badCommit: null,
        goodCommit: null,
        remaining: null,
        totalSteps: null,
        currentStep: null,
        log: [],
      };
      mockInvoke = () => Promise.resolve(mockStatus);

      const result = await getBisectStatus('/test/repo');
      expect(lastInvokedCommand).to.equal('get_bisect_status');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
    });

    it('returns inactive status for repo not in bisect', async () => {
      mockInvoke = () =>
        Promise.resolve({
          active: false,
          currentCommit: null,
          badCommit: null,
          goodCommit: null,
          remaining: null,
          totalSteps: null,
          currentStep: null,
          log: [],
        });

      const result = await getBisectStatus('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.active).to.be.false;
    });

    it('returns active status during bisect session', async () => {
      mockInvoke = () =>
        Promise.resolve({
          active: true,
          currentCommit: 'abc123',
          badCommit: 'def456',
          goodCommit: 'ghi789',
          remaining: 3,
          totalSteps: 5,
          currentStep: 2,
          log: [
            { commitOid: 'def456', action: 'bad', message: null },
            { commitOid: 'ghi789', action: 'good', message: null },
          ],
        });

      const result = await getBisectStatus('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.active).to.be.true;
      expect(result.data?.currentCommit).to.equal('abc123');
      expect(result.data?.remaining).to.equal(3);
    });

    it('handles error response', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Repository not found' });

      const result = await getBisectStatus('/nonexistent/repo');
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('Repository not found');
    });
  });

  describe('bisectStart', () => {
    it('invokes bisect_start command with no commits', async () => {
      const mockResult: BisectStepResult = {
        status: {
          active: true,
          currentCommit: null,
          badCommit: null,
          goodCommit: null,
          remaining: null,
          totalSteps: null,
          currentStep: null,
          log: [],
        },
        culprit: null,
        message: 'Bisect started',
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await bisectStart('/test/repo');
      expect(lastInvokedCommand).to.equal('bisect_start');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.badCommit).to.be.undefined;
      expect(args.goodCommit).to.be.undefined;
      expect(result.success).to.be.true;
    });

    it('invokes bisect_start with bad commit', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: true, currentCommit: null, badCommit: 'bad123', goodCommit: null, remaining: null, totalSteps: null, currentStep: null, log: [] },
          culprit: null,
          message: 'Bisect started with bad commit',
        });

      await bisectStart('/test/repo', 'bad123');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.badCommit).to.equal('bad123');
    });

    it('invokes bisect_start with both bad and good commits', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: true, currentCommit: 'mid456', badCommit: 'bad123', goodCommit: 'good789', remaining: 5, totalSteps: 5, currentStep: 1, log: [] },
          culprit: null,
          message: 'Bisecting: 5 revisions left to test',
        });

      const result = await bisectStart('/test/repo', 'bad123', 'good789');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.badCommit).to.equal('bad123');
      expect(args.goodCommit).to.equal('good789');
      expect(result.data?.status.currentCommit).to.equal('mid456');
    });

    it('handles error when commits are invalid', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_ARGUMENT', message: 'Invalid commit reference' });

      const result = await bisectStart('/test/repo', 'invalid');
      expect(result.success).to.be.false;
    });
  });

  describe('bisectBad', () => {
    it('invokes bisect_bad command without commit', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: true, currentCommit: 'next123', badCommit: 'curr456', goodCommit: 'good789', remaining: 3, totalSteps: 5, currentStep: 2, log: [] },
          culprit: null,
          message: 'Bisecting: 3 revisions left',
        });

      const result = await bisectBad('/test/repo');
      expect(lastInvokedCommand).to.equal('bisect_bad');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.commit).to.be.undefined;
      expect(result.success).to.be.true;
    });

    it('invokes bisect_bad with specific commit', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: true, currentCommit: 'next123', badCommit: 'specific456', goodCommit: 'good789', remaining: 2, totalSteps: 5, currentStep: 3, log: [] },
          culprit: null,
          message: 'Bisecting: 2 revisions left',
        });

      await bisectBad('/test/repo', 'specific456');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.commit).to.equal('specific456');
    });

    it('returns culprit when found', async () => {
      const culprit: CulpritCommit = {
        oid: 'culprit123',
        summary: 'Introduced the bug',
        author: 'John Doe',
        email: 'john@example.com',
      };
      mockInvoke = () =>
        Promise.resolve({
          status: { active: false, currentCommit: null, badCommit: 'culprit123', goodCommit: 'good789', remaining: 0, totalSteps: 5, currentStep: 5, log: [] },
          culprit,
          message: 'culprit123 is the first bad commit',
        });

      const result = await bisectBad('/test/repo');
      expect(result.data?.culprit).to.not.be.null;
      expect(result.data?.culprit?.oid).to.equal('culprit123');
      expect(result.data?.culprit?.summary).to.equal('Introduced the bug');
    });

    it('handles error when not in bisect session', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Not in a bisect session' });

      const result = await bisectBad('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('bisectGood', () => {
    it('invokes bisect_good command without commit', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: true, currentCommit: 'next123', badCommit: 'bad456', goodCommit: 'curr789', remaining: 3, totalSteps: 5, currentStep: 2, log: [] },
          culprit: null,
          message: 'Bisecting: 3 revisions left',
        });

      const result = await bisectGood('/test/repo');
      expect(lastInvokedCommand).to.equal('bisect_good');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.commit).to.be.undefined;
      expect(result.success).to.be.true;
    });

    it('invokes bisect_good with specific commit', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: true, currentCommit: 'next123', badCommit: 'bad456', goodCommit: 'specific789', remaining: 2, totalSteps: 5, currentStep: 3, log: [] },
          culprit: null,
          message: 'Bisecting: 2 revisions left',
        });

      await bisectGood('/test/repo', 'specific789');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.commit).to.equal('specific789');
    });

    it('returns culprit when found after good', async () => {
      const culprit: CulpritCommit = {
        oid: 'culprit123',
        summary: 'Bug introduction',
        author: 'Jane Doe',
        email: 'jane@example.com',
      };
      mockInvoke = () =>
        Promise.resolve({
          status: { active: false, currentCommit: null, badCommit: 'culprit123', goodCommit: 'good789', remaining: 0, totalSteps: 5, currentStep: 5, log: [] },
          culprit,
          message: 'culprit123 is the first bad commit',
        });

      const result = await bisectGood('/test/repo');
      expect(result.data?.culprit?.oid).to.equal('culprit123');
    });

    it('handles error when not in bisect session', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Not in a bisect session' });

      const result = await bisectGood('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('bisectSkip', () => {
    it('invokes bisect_skip command without commit', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: true, currentCommit: 'next123', badCommit: 'bad456', goodCommit: 'good789', remaining: 3, totalSteps: 5, currentStep: 2, log: [] },
          culprit: null,
          message: 'Bisecting: 3 revisions left (skipped current)',
        });

      const result = await bisectSkip('/test/repo');
      expect(lastInvokedCommand).to.equal('bisect_skip');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.commit).to.be.undefined;
      expect(result.success).to.be.true;
    });

    it('invokes bisect_skip with specific commit', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: true, currentCommit: 'next123', badCommit: 'bad456', goodCommit: 'good789', remaining: 3, totalSteps: 5, currentStep: 2, log: [] },
          culprit: null,
          message: 'Skipped commit specific456',
        });

      await bisectSkip('/test/repo', 'specific456');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.commit).to.equal('specific456');
    });

    it('handles skip resulting in ambiguous culprit', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: false, currentCommit: null, badCommit: null, goodCommit: null, remaining: 0, totalSteps: 5, currentStep: 5, log: [] },
          culprit: null,
          message: 'Due to skipped commits, the first bad commit could be any of: abc123, def456',
        });

      const result = await bisectSkip('/test/repo');
      expect(result.data?.culprit).to.be.null;
      expect(result.data?.message).to.include('skipped commits');
    });

    it('handles error when not in bisect session', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Not in a bisect session' });

      const result = await bisectSkip('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('bisectReset', () => {
    it('invokes bisect_reset command', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: false, currentCommit: null, badCommit: null, goodCommit: null, remaining: null, totalSteps: null, currentStep: null, log: [] },
          culprit: null,
          message: 'Bisect reset',
        });

      const result = await bisectReset('/test/repo');
      expect(lastInvokedCommand).to.equal('bisect_reset');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
    });

    it('returns inactive status after reset', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: false, currentCommit: null, badCommit: null, goodCommit: null, remaining: null, totalSteps: null, currentStep: null, log: [] },
          culprit: null,
          message: 'Bisect session terminated',
        });

      const result = await bisectReset('/test/repo');
      expect(result.data?.status.active).to.be.false;
    });

    it('handles reset when not in bisect session', async () => {
      mockInvoke = () =>
        Promise.resolve({
          status: { active: false, currentCommit: null, badCommit: null, goodCommit: null, remaining: null, totalSteps: null, currentStep: null, log: [] },
          culprit: null,
          message: 'No bisect session to reset',
        });

      const result = await bisectReset('/test/repo');
      expect(result.success).to.be.true;
    });

    it('handles error during reset', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to reset bisect' });

      const result = await bisectReset('/test/repo');
      expect(result.success).to.be.false;
    });
  });
});
