import { expect } from '@open-wc/testing';

// Track mock calls
const invokeCallArgs: Array<{ command: string; args: Record<string, unknown> }> = [];

// Mock Tauri API before importing any modules that use it
const mockInvoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  invokeCallArgs.push({ command, args: args || {} });

  switch (command) {
    case 'build_search_index':
      return Promise.resolve(500);
    case 'search_index':
      return Promise.resolve([
        {
          oid: 'abc1234567890',
          shortOid: 'abc1234',
          summary: 'Test commit',
          messageLower: 'test commit',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          authorDate: 1700000000,
          parentCount: 1,
        },
      ]);
    case 'refresh_search_index':
      return Promise.resolve(502);
    default:
      return Promise.resolve(null);
  }
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import after mock is set up - need to get a fresh instance
// Since the module exports a singleton, we test through the singleton
import { searchIndexService } from '../search-index.service.ts';

describe('SearchIndexService', () => {
  beforeEach(() => {
    invokeCallArgs.length = 0;
    searchIndexService.invalidate();
  });

  describe('buildIndex', () => {
    it('should call build_search_index command', async () => {
      await searchIndexService.buildIndex('/path/to/repo');

      const buildCall = invokeCallArgs.find((c) => c.command === 'build_search_index');
      expect(buildCall).to.not.be.undefined;
      expect(buildCall!.args.path).to.equal('/path/to/repo');
    });

    it('should set index as ready after building', async () => {
      expect(searchIndexService.isReady()).to.be.false;
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady()).to.be.true;
    });

    it('should track the repo path', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady('/path/to/repo')).to.be.true;
      expect(searchIndexService.isReady('/other/repo')).to.be.false;
    });
  });

  describe('search', () => {
    it('should return null when index not ready', async () => {
      const result = await searchIndexService.search('/path/to/repo', { query: 'test' });
      expect(result).to.be.null;
    });

    it('should search via search_index command when ready', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      invokeCallArgs.length = 0;

      const result = await searchIndexService.search('/path/to/repo', { query: 'test' });
      expect(result).to.not.be.null;
      expect(result!.length).to.equal(1);
      expect(result![0].oid).to.equal('abc1234567890');

      const searchCall = invokeCallArgs.find((c) => c.command === 'search_index');
      expect(searchCall).to.not.be.undefined;
    });

    it('should cache search results', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      invokeCallArgs.length = 0;

      // First search
      await searchIndexService.search('/path/to/repo', { query: 'test' });
      const firstCallCount = invokeCallArgs.filter((c) => c.command === 'search_index').length;
      expect(firstCallCount).to.equal(1);

      // Second search with same params should hit cache
      await searchIndexService.search('/path/to/repo', { query: 'test' });
      const secondCallCount = invokeCallArgs.filter((c) => c.command === 'search_index').length;
      expect(secondCallCount).to.equal(1); // Should not increase
    });
  });

  describe('invalidate', () => {
    it('should reset index ready state', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady()).to.be.true;

      searchIndexService.invalidate();
      expect(searchIndexService.isReady()).to.be.false;
    });

    it('should clear cache on invalidate', async () => {
      await searchIndexService.buildIndex('/path/to/repo');

      // Fill cache
      await searchIndexService.search('/path/to/repo', { query: 'test' });

      searchIndexService.invalidate();

      // After invalidate, search should return null (not from cache)
      const result = await searchIndexService.search('/path/to/repo', { query: 'test' });
      expect(result).to.be.null;
    });
  });

  describe('isReady', () => {
    it('should return false initially', () => {
      expect(searchIndexService.isReady()).to.be.false;
    });

    it('should return false for wrong repo path', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady('/other/repo')).to.be.false;
    });

    it('should return true for correct repo path', async () => {
      await searchIndexService.buildIndex('/path/to/repo');
      expect(searchIndexService.isReady('/path/to/repo')).to.be.true;
    });
  });
});
