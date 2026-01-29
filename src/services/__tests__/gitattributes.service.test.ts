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
  getGitattributes,
  addGitattribute,
  removeGitattribute,
  updateGitattribute,
  getCommonAttributes,
  type GitAttribute,
  type CommonAttribute,
} from '../git.service.ts';

describe('git.service - Gitattributes management', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getGitattributes', () => {
    it('invokes get_gitattributes command', async () => {
      const mockEntries: GitAttribute[] = [
        {
          pattern: '*',
          attributes: [{ name: 'text', value: { type: 'value', value: 'auto' } }],
          lineNumber: 1,
          rawLine: '* text=auto',
        },
        {
          pattern: '*.png',
          attributes: [{ name: 'binary', value: { type: 'set' } }],
          lineNumber: 2,
          rawLine: '*.png binary',
        },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      const result = await getGitattributes('/test/repo');
      expect(lastInvokedCommand).to.equal('get_gitattributes');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array for repos without .gitattributes', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getGitattributes('/test/repo');
      expect(result.data).to.deep.equal([]);
    });

    it('passes repoPath as path argument', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getGitattributes('/my/repo');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
    });
  });

  describe('addGitattribute', () => {
    it('invokes add_gitattribute with pattern and attributes', async () => {
      const mockResult: GitAttribute[] = [
        {
          pattern: '*.txt',
          attributes: [{ name: 'text', value: { type: 'set' } }],
          lineNumber: 1,
          rawLine: '*.txt text',
        },
      ];
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await addGitattribute('/test/repo', '*.txt', 'text');
      expect(lastInvokedCommand).to.equal('add_gitattribute');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.pattern).to.equal('*.txt');
      expect(args.attributes).to.equal('text');
      expect(result.success).to.be.true;
    });

    it('returns updated list after adding', async () => {
      const mockResult: GitAttribute[] = [
        {
          pattern: '*.txt',
          attributes: [{ name: 'text', value: { type: 'set' } }],
          lineNumber: 1,
          rawLine: '*.txt text',
        },
        {
          pattern: '*.png',
          attributes: [{ name: 'binary', value: { type: 'set' } }],
          lineNumber: 2,
          rawLine: '*.png binary',
        },
      ];
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await addGitattribute('/test/repo', '*.png', 'binary');
      expect(result.data?.length).to.equal(2);
    });
  });

  describe('removeGitattribute', () => {
    it('invokes remove_gitattribute command', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await removeGitattribute('/test/repo', 2);
      expect(lastInvokedCommand).to.equal('remove_gitattribute');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.lineNumber).to.equal(2);
      expect(result.success).to.be.true;
    });

    it('handles error when .gitattributes does not exist', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: '.gitattributes does not exist' });

      const result = await removeGitattribute('/test/repo', 1);
      expect(result.success).to.be.false;
    });
  });

  describe('updateGitattribute', () => {
    it('invokes update_gitattribute command', async () => {
      const mockResult: GitAttribute[] = [
        {
          pattern: '*.md',
          attributes: [
            { name: 'text', value: { type: 'set' } },
            { name: 'diff', value: { type: 'value', value: 'markdown' } },
          ],
          lineNumber: 1,
          rawLine: '*.md text diff=markdown',
        },
      ];
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await updateGitattribute('/test/repo', 1, '*.md', 'text diff=markdown');
      expect(lastInvokedCommand).to.equal('update_gitattribute');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.lineNumber).to.equal(1);
      expect(args.pattern).to.equal('*.md');
      expect(args.attributes).to.equal('text diff=markdown');
      expect(result.success).to.be.true;
    });

    it('handles error for invalid line number', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Invalid line number: 99' });

      const result = await updateGitattribute('/test/repo', 99, '*.md', 'text');
      expect(result.success).to.be.false;
    });
  });

  describe('getCommonAttributes', () => {
    it('invokes get_common_attributes command', async () => {
      const mockAttrs: CommonAttribute[] = [
        { name: 'text', description: 'Text file line ending handling', example: '*.txt text' },
        { name: 'binary', description: 'Binary file (no diff, no merge)', example: '*.png binary' },
        { name: 'eol', description: 'Line ending style (lf, crlf)', example: '*.sh eol=lf' },
      ];
      mockInvoke = () => Promise.resolve(mockAttrs);

      const result = await getCommonAttributes();
      expect(lastInvokedCommand).to.equal('get_common_attributes');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
    });

    it('returns attributes with correct structure', async () => {
      mockInvoke = () =>
        Promise.resolve([
          { name: 'text', description: 'Text file line ending handling', example: '*.txt text' },
        ]);

      const result = await getCommonAttributes();
      const attr = result.data?.[0];
      expect(attr?.name).to.equal('text');
      expect(attr?.description).to.be.a('string');
      expect(attr?.example).to.be.a('string');
    });
  });
});
