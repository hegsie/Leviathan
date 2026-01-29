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
  validateCommitMessage,
  getCommitMessageRules,
  setCommitMessageRules,
} from '../git.service.ts';
import type {
  CommitMessageRules,
  CommitValidationResult,
} from '../git.service.ts';

const defaultRules: CommitMessageRules = {
  maxSubjectLength: 72,
  maxBodyLineLength: 100,
  requireBlankLineBeforeBody: true,
  requireConventionalFormat: false,
  allowedTypes: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
  requireScope: false,
  requireBody: false,
  forbiddenPhrases: [],
};

const validResult: CommitValidationResult = {
  isValid: true,
  errors: [],
  warnings: [],
};

const invalidResult: CommitValidationResult = {
  isValid: false,
  errors: [
    {
      rule: 'max_subject_length',
      message: 'Subject line is 80 characters, maximum is 72',
      line: 1,
    },
  ],
  warnings: [],
};

describe('git.service - Commit Message Validation', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('validateCommitMessage', () => {
    it('invokes validate_commit_message command with message and rules', async () => {
      mockInvoke = () => Promise.resolve(validResult);

      const result = await validateCommitMessage('feat: add feature', defaultRules);
      expect(lastInvokedCommand).to.equal('validate_commit_message');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.message).to.equal('feat: add feature');
      expect(args.rules).to.deep.equal(defaultRules);
      expect(result.success).to.be.true;
      expect(result.data?.isValid).to.be.true;
    });

    it('returns validation errors for invalid messages', async () => {
      mockInvoke = () => Promise.resolve(invalidResult);

      const result = await validateCommitMessage('a very long message', defaultRules);
      expect(result.success).to.be.true;
      expect(result.data?.isValid).to.be.false;
      expect(result.data?.errors.length).to.equal(1);
      expect(result.data?.errors[0].rule).to.equal('max_subject_length');
    });

    it('returns warnings separately from errors', async () => {
      const resultWithWarnings: CommitValidationResult = {
        isValid: true,
        errors: [],
        warnings: [
          {
            rule: 'max_body_line_length',
            message: 'Line 3 is 110 characters, maximum is 100',
            line: 3,
          },
        ],
      };
      mockInvoke = () => Promise.resolve(resultWithWarnings);

      const result = await validateCommitMessage('Subject\n\nLong body line...', defaultRules);
      expect(result.success).to.be.true;
      expect(result.data?.isValid).to.be.true;
      expect(result.data?.warnings.length).to.equal(1);
      expect(result.data?.warnings[0].rule).to.equal('max_body_line_length');
    });

    it('handles backend errors', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Validation failed' });

      const result = await validateCommitMessage('test', defaultRules);
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('Validation failed');
    });
  });

  describe('getCommitMessageRules', () => {
    it('invokes get_commit_message_rules command with path', async () => {
      mockInvoke = () => Promise.resolve(defaultRules);

      const result = await getCommitMessageRules('/path/to/repo');
      expect(lastInvokedCommand).to.equal('get_commit_message_rules');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/path/to/repo');
      expect(result.success).to.be.true;
      expect(result.data?.maxSubjectLength).to.equal(72);
    });

    it('returns null when no rules are configured', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await getCommitMessageRules('/path/to/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.be.null;
    });

    it('handles errors for invalid repo path', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'GIT_ERROR', message: 'Repository not found' });

      const result = await getCommitMessageRules('/nonexistent');
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('not found');
    });
  });

  describe('setCommitMessageRules', () => {
    it('invokes set_commit_message_rules with path and rules', async () => {
      mockInvoke = () => Promise.resolve(defaultRules);

      const result = await setCommitMessageRules('/path/to/repo', defaultRules);
      expect(lastInvokedCommand).to.equal('set_commit_message_rules');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/path/to/repo');
      expect(args.rules).to.deep.equal(defaultRules);
      expect(result.success).to.be.true;
    });

    it('returns the saved rules', async () => {
      const customRules: CommitMessageRules = {
        ...defaultRules,
        maxSubjectLength: 50,
        requireConventionalFormat: true,
        requireBody: true,
      };
      mockInvoke = () => Promise.resolve(customRules);

      const result = await setCommitMessageRules('/path/to/repo', customRules);
      expect(result.success).to.be.true;
      expect(result.data?.maxSubjectLength).to.equal(50);
      expect(result.data?.requireConventionalFormat).to.be.true;
      expect(result.data?.requireBody).to.be.true;
    });

    it('handles errors', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'IO_ERROR', message: 'Failed to write file' });

      const result = await setCommitMessageRules('/path/to/repo', defaultRules);
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('Failed to write');
    });
  });

  describe('CommitMessageRules interface', () => {
    it('has all expected fields', () => {
      const rules: CommitMessageRules = {
        maxSubjectLength: 72,
        maxBodyLineLength: 100,
        requireBlankLineBeforeBody: true,
        requireConventionalFormat: false,
        allowedTypes: ['feat', 'fix'],
        requireScope: false,
        requireBody: false,
        forbiddenPhrases: ['WIP'],
      };

      expect(rules.maxSubjectLength).to.equal(72);
      expect(rules.maxBodyLineLength).to.equal(100);
      expect(rules.requireBlankLineBeforeBody).to.be.true;
      expect(rules.requireConventionalFormat).to.be.false;
      expect(rules.allowedTypes).to.deep.equal(['feat', 'fix']);
      expect(rules.requireScope).to.be.false;
      expect(rules.requireBody).to.be.false;
      expect(rules.forbiddenPhrases).to.deep.equal(['WIP']);
    });

    it('supports null for optional length fields', () => {
      const rules: CommitMessageRules = {
        ...defaultRules,
        maxSubjectLength: null,
        maxBodyLineLength: null,
      };

      expect(rules.maxSubjectLength).to.be.null;
      expect(rules.maxBodyLineLength).to.be.null;
    });
  });

  describe('CommitValidationResult interface', () => {
    it('has correct shape for valid result', () => {
      const result: CommitValidationResult = {
        isValid: true,
        errors: [],
        warnings: [],
      };

      expect(result.isValid).to.be.true;
      expect(result.errors).to.be.empty;
      expect(result.warnings).to.be.empty;
    });

    it('has correct shape for invalid result with errors and warnings', () => {
      const result: CommitValidationResult = {
        isValid: false,
        errors: [
          { rule: 'conventional_format', message: 'Must follow conventional format', line: 1 },
          { rule: 'require_body', message: 'Body is required', line: null },
        ],
        warnings: [
          { rule: 'max_body_line_length', message: 'Line too long', line: 3 },
        ],
      };

      expect(result.isValid).to.be.false;
      expect(result.errors.length).to.equal(2);
      expect(result.warnings.length).to.equal(1);
      expect(result.errors[0].line).to.equal(1);
      expect(result.errors[1].line).to.be.null;
    });
  });
});
