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
  getLineEndingConfig,
  setLineEndingConfig,
  getGitConfig,
  setGitConfig,
  getAllGitConfig,
  unsetGitConfig,
  type LineEndingConfig,
  type GitConfig,
} from '../git.service.ts';

describe('git.service - Line Ending & Encoding Configuration', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getLineEndingConfig', () => {
    it('invokes get_line_ending_config command', async () => {
      const mockConfig: LineEndingConfig = {
        coreAutocrlf: 'true',
        coreEol: 'native',
        coreSafecrlf: 'warn',
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await getLineEndingConfig('/test/repo');
      expect(lastInvokedCommand).to.equal('get_line_ending_config');
      expect(result.success).to.be.true;
      expect(result.data?.coreAutocrlf).to.equal('true');
      expect(result.data?.coreEol).to.equal('native');
      expect(result.data?.coreSafecrlf).to.equal('warn');
    });

    it('handles null values for unset config', async () => {
      const mockConfig: LineEndingConfig = {
        coreAutocrlf: null,
        coreEol: null,
        coreSafecrlf: null,
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await getLineEndingConfig('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.coreAutocrlf).to.be.null;
      expect(result.data?.coreEol).to.be.null;
      expect(result.data?.coreSafecrlf).to.be.null;
    });

    it('passes correct path argument', async () => {
      mockInvoke = () => Promise.resolve({ coreAutocrlf: null, coreEol: null, coreSafecrlf: null });

      await getLineEndingConfig('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });
  });

  describe('setLineEndingConfig', () => {
    it('invokes set_line_ending_config with all values', async () => {
      const mockConfig: LineEndingConfig = {
        coreAutocrlf: 'input',
        coreEol: 'lf',
        coreSafecrlf: 'true',
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await setLineEndingConfig('/test/repo', 'input', 'lf', 'true');
      expect(lastInvokedCommand).to.equal('set_line_ending_config');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.autocrlf).to.equal('input');
      expect(args.eol).to.equal('lf');
      expect(args.safecrlf).to.equal('true');
      expect(result.success).to.be.true;
    });

    it('handles partial updates', async () => {
      const mockConfig: LineEndingConfig = {
        coreAutocrlf: 'false',
        coreEol: null,
        coreSafecrlf: null,
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await setLineEndingConfig('/test/repo', 'false');
      expect(result.success).to.be.true;
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.autocrlf).to.equal('false');
      expect(args.eol).to.be.undefined;
      expect(args.safecrlf).to.be.undefined;
    });

    it('returns updated config', async () => {
      const mockConfig: LineEndingConfig = {
        coreAutocrlf: 'true',
        coreEol: 'crlf',
        coreSafecrlf: 'false',
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await setLineEndingConfig('/test/repo', 'true', 'crlf', 'false');
      expect(result.data?.coreAutocrlf).to.equal('true');
      expect(result.data?.coreEol).to.equal('crlf');
      expect(result.data?.coreSafecrlf).to.equal('false');
    });
  });

  describe('getGitConfig', () => {
    it('invokes get_git_config command', async () => {
      mockInvoke = () => Promise.resolve('Test User');

      const result = await getGitConfig('/test/repo', 'user.name');
      expect(lastInvokedCommand).to.equal('get_git_config');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.key).to.equal('user.name');
      expect(result.success).to.be.true;
      expect(result.data).to.equal('Test User');
    });

    it('returns null for missing keys', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await getGitConfig('/test/repo', 'nonexistent.key');
      expect(result.success).to.be.true;
      expect(result.data).to.be.null;
    });
  });

  describe('setGitConfig', () => {
    it('invokes set_git_config command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await setGitConfig('/test/repo', 'user.name', 'New User');
      expect(lastInvokedCommand).to.equal('set_git_config');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.key).to.equal('user.name');
      expect(args.value).to.equal('New User');
      expect(result.success).to.be.true;
    });

    it('supports global flag', async () => {
      mockInvoke = () => Promise.resolve(null);

      await setGitConfig('/test/repo', 'user.email', 'test@example.com', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.global).to.be.true;
    });

    it('defaults to local scope', async () => {
      mockInvoke = () => Promise.resolve(null);

      await setGitConfig('/test/repo', 'core.editor', 'vim');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.global).to.be.undefined;
    });
  });

  describe('getAllGitConfig', () => {
    it('invokes get_all_git_config command', async () => {
      const mockEntries: GitConfig[] = [
        { key: 'user.name', value: 'Test User', scope: 'local' },
        { key: 'user.email', value: 'test@example.com', scope: 'global' },
        { key: 'core.autocrlf', value: 'true', scope: 'system' },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      const result = await getAllGitConfig('/test/repo');
      expect(lastInvokedCommand).to.equal('get_all_git_config');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
    });

    it('returns entries with correct structure', async () => {
      const mockEntries: GitConfig[] = [
        { key: 'core.eol', value: 'lf', scope: 'local' },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      const result = await getAllGitConfig('/test/repo');
      const entry = result.data?.[0];
      expect(entry?.key).to.equal('core.eol');
      expect(entry?.value).to.equal('lf');
      expect(entry?.scope).to.equal('local');
    });

    it('handles empty config list', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getAllGitConfig('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('unsetGitConfig', () => {
    it('invokes unset_git_config command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await unsetGitConfig('/test/repo', 'test.key');
      expect(lastInvokedCommand).to.equal('unset_git_config');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.key).to.equal('test.key');
      expect(result.success).to.be.true;
    });

    it('supports global flag', async () => {
      mockInvoke = () => Promise.resolve(null);

      await unsetGitConfig('/test/repo', 'user.name', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.global).to.be.true;
    });

    it('handles error when key does not exist', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Key not found' });

      const result = await unsetGitConfig('/test/repo', 'missing.key');
      expect(result.success).to.be.false;
    });
  });
});
