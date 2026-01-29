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
  getGitignore,
  addToGitignore,
  removeFromGitignore,
  isIgnored,
  getGitignoreTemplates,
  checkIgnore,
  checkIgnoreVerbose,
  type GitignoreEntry,
  type GitignoreTemplate,
  type IgnoreCheckResult,
  type IgnoreCheckVerboseResult,
} from '../git.service.ts';

describe('git.service - Gitignore management', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getGitignore', () => {
    it('invokes get_gitignore command', async () => {
      const mockEntries: GitignoreEntry[] = [
        { pattern: '# Comment', lineNumber: 1, isComment: true, isNegation: false, isEmpty: false },
        { pattern: 'node_modules/', lineNumber: 2, isComment: false, isNegation: false, isEmpty: false },
        { pattern: '', lineNumber: 3, isComment: false, isNegation: false, isEmpty: true },
        { pattern: '!important.txt', lineNumber: 4, isComment: false, isNegation: true, isEmpty: false },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      const result = await getGitignore('/test/repo');
      expect(lastInvokedCommand).to.equal('get_gitignore');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(4);
    });

    it('returns empty array for repos without .gitignore', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getGitignore('/test/repo');
      expect(result.data).to.deep.equal([]);
    });

    it('correctly identifies comment lines', async () => {
      mockInvoke = () =>
        Promise.resolve([
          { pattern: '# Build output', lineNumber: 1, isComment: true, isNegation: false, isEmpty: false },
        ]);

      const result = await getGitignore('/test/repo');
      expect(result.data?.[0].isComment).to.be.true;
    });

    it('correctly identifies negation patterns', async () => {
      mockInvoke = () =>
        Promise.resolve([
          { pattern: '!keep-this.txt', lineNumber: 1, isComment: false, isNegation: true, isEmpty: false },
        ]);

      const result = await getGitignore('/test/repo');
      expect(result.data?.[0].isNegation).to.be.true;
    });
  });

  describe('addToGitignore', () => {
    it('invokes add_to_gitignore with patterns', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await addToGitignore('/test/repo', ['node_modules/', '.env', 'dist/']);
      expect(lastInvokedCommand).to.equal('add_to_gitignore');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.patterns).to.deep.equal(['node_modules/', '.env', 'dist/']);
      expect(result.success).to.be.true;
    });

    it('handles single pattern', async () => {
      mockInvoke = () => Promise.resolve(null);

      await addToGitignore('/test/repo', ['*.log']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect((args.patterns as string[]).length).to.equal(1);
    });
  });

  describe('removeFromGitignore', () => {
    it('invokes remove_from_gitignore command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await removeFromGitignore('/test/repo', 'node_modules/');
      expect(lastInvokedCommand).to.equal('remove_from_gitignore');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.pattern).to.equal('node_modules/');
      expect(result.success).to.be.true;
    });

    it('handles error when .gitignore does not exist', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: '.gitignore does not exist' });

      const result = await removeFromGitignore('/test/repo', 'pattern');
      expect(result.success).to.be.false;
    });
  });

  describe('isIgnored', () => {
    it('invokes is_ignored command', async () => {
      mockInvoke = () => Promise.resolve(true);

      const result = await isIgnored('/test/repo', 'node_modules/package.json');
      expect(lastInvokedCommand).to.equal('is_ignored');
      expect(result.success).to.be.true;
      expect(result.data).to.be.true;
    });

    it('returns false for non-ignored files', async () => {
      mockInvoke = () => Promise.resolve(false);

      const result = await isIgnored('/test/repo', 'src/main.ts');
      expect(result.data).to.be.false;
    });
  });

  describe('getGitignoreTemplates', () => {
    it('invokes get_gitignore_templates command', async () => {
      const mockTemplates: GitignoreTemplate[] = [
        { name: 'Node.js', patterns: ['node_modules/', 'dist/', '.env'] },
        { name: 'Rust', patterns: ['/target/', 'Cargo.lock'] },
        { name: 'Python', patterns: ['__pycache__/', '*.py[cod]', '.venv/'] },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getGitignoreTemplates();
      expect(lastInvokedCommand).to.equal('get_gitignore_templates');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
    });

    it('returns templates with correct structure', async () => {
      mockInvoke = () =>
        Promise.resolve([
          { name: 'Node.js', patterns: ['node_modules/', 'dist/'] },
        ]);

      const result = await getGitignoreTemplates();
      const template = result.data?.[0];
      expect(template?.name).to.equal('Node.js');
      expect(template?.patterns).to.include('node_modules/');
    });
  });

  describe('checkIgnore', () => {
    it('invokes check_ignore command with file paths', async () => {
      const mockResults: IgnoreCheckResult[] = [
        { path: 'test.log', isIgnored: true },
        { path: 'src/main.ts', isIgnored: false },
        { path: 'build/output.js', isIgnored: true },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await checkIgnore('/test/repo', ['test.log', 'src/main.ts', 'build/output.js']);
      expect(lastInvokedCommand).to.equal('check_ignore');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
    });

    it('passes correct arguments', async () => {
      mockInvoke = () => Promise.resolve([]);

      await checkIgnore('/test/repo', ['file1.txt', 'file2.txt']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.filePaths).to.deep.equal(['file1.txt', 'file2.txt']);
    });

    it('returns ignored status for each file', async () => {
      const mockResults: IgnoreCheckResult[] = [
        { path: 'node_modules/pkg/index.js', isIgnored: true },
        { path: 'src/app.ts', isIgnored: false },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await checkIgnore('/test/repo', ['node_modules/pkg/index.js', 'src/app.ts']);
      expect(result.data?.[0].isIgnored).to.be.true;
      expect(result.data?.[0].path).to.equal('node_modules/pkg/index.js');
      expect(result.data?.[1].isIgnored).to.be.false;
      expect(result.data?.[1].path).to.equal('src/app.ts');
    });

    it('handles empty file list', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await checkIgnore('/test/repo', []);
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('checkIgnoreVerbose', () => {
    it('invokes check_ignore_verbose command', async () => {
      const mockResults: IgnoreCheckVerboseResult[] = [
        {
          path: 'test.log',
          isIgnored: true,
          sourceFile: '.gitignore',
          sourceLine: 1,
          pattern: '*.log',
          isNegated: false,
        },
        {
          path: 'src/main.ts',
          isIgnored: false,
          sourceFile: null,
          sourceLine: null,
          pattern: null,
          isNegated: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await checkIgnoreVerbose('/test/repo', ['test.log', 'src/main.ts']);
      expect(lastInvokedCommand).to.equal('check_ignore_verbose');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('passes correct arguments', async () => {
      mockInvoke = () => Promise.resolve([]);

      await checkIgnoreVerbose('/test/repo', ['file1.txt']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.filePaths).to.deep.equal(['file1.txt']);
    });

    it('returns verbose details for ignored files', async () => {
      const mockResults: IgnoreCheckVerboseResult[] = [
        {
          path: 'debug.log',
          isIgnored: true,
          sourceFile: '.gitignore',
          sourceLine: 3,
          pattern: '*.log',
          isNegated: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await checkIgnoreVerbose('/test/repo', ['debug.log']);
      const entry = result.data?.[0];
      expect(entry?.isIgnored).to.be.true;
      expect(entry?.sourceFile).to.equal('.gitignore');
      expect(entry?.sourceLine).to.equal(3);
      expect(entry?.pattern).to.equal('*.log');
      expect(entry?.isNegated).to.be.false;
    });

    it('returns null fields for non-ignored files', async () => {
      const mockResults: IgnoreCheckVerboseResult[] = [
        {
          path: 'src/main.ts',
          isIgnored: false,
          sourceFile: null,
          sourceLine: null,
          pattern: null,
          isNegated: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await checkIgnoreVerbose('/test/repo', ['src/main.ts']);
      const entry = result.data?.[0];
      expect(entry?.isIgnored).to.be.false;
      expect(entry?.sourceFile).to.be.null;
      expect(entry?.sourceLine).to.be.null;
      expect(entry?.pattern).to.be.null;
    });

    it('handles negated patterns', async () => {
      const mockResults: IgnoreCheckVerboseResult[] = [
        {
          path: 'important.log',
          isIgnored: false,
          sourceFile: '.gitignore',
          sourceLine: 5,
          pattern: '!important.log',
          isNegated: true,
        },
      ];
      mockInvoke = () => Promise.resolve(mockResults);

      const result = await checkIgnoreVerbose('/test/repo', ['important.log']);
      const entry = result.data?.[0];
      expect(entry?.isIgnored).to.be.false;
      expect(entry?.isNegated).to.be.true;
      expect(entry?.pattern).to.equal('!important.log');
    });

    it('handles error from backend', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'GIT_ERROR', message: 'Not a git repository' });

      const result = await checkIgnoreVerbose('/not/a/repo', ['file.txt']);
      expect(result.success).to.be.false;
    });
  });
});
