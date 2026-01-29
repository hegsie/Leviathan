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
  getBookmarks,
  addBookmark,
  removeBookmark,
  updateBookmark,
  getRecentRepos,
  recordRepoOpened,
} from '../git.service.ts';
import type { RepoBookmark } from '../git.service.ts';

const sampleBookmark: RepoBookmark = {
  path: '/home/user/project',
  name: 'My Project',
  group: 'Work',
  pinned: true,
  lastOpened: 1700000000,
  color: '#ff0000',
};

const sampleBookmarks: RepoBookmark[] = [
  sampleBookmark,
  {
    path: '/home/user/other',
    name: 'Other Project',
    group: null,
    pinned: false,
    lastOpened: 1700000100,
    color: null,
  },
];

describe('git.service - Bookmark operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getBookmarks', () => {
    it('invokes get_bookmarks command', async () => {
      mockInvoke = () => Promise.resolve(sampleBookmarks);

      const result = await getBookmarks();
      expect(lastInvokedCommand).to.equal('get_bookmarks');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array when no bookmarks', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getBookmarks();
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles errors', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to read bookmarks' });

      const result = await getBookmarks();
      expect(result.success).to.be.false;
    });
  });

  describe('addBookmark', () => {
    it('invokes add_bookmark with path and name', async () => {
      mockInvoke = () => Promise.resolve(sampleBookmarks);

      const result = await addBookmark('/home/user/project', 'My Project');
      expect(lastInvokedCommand).to.equal('add_bookmark');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/home/user/project');
      expect(args.name).to.equal('My Project');
      expect(args.group).to.be.null;
      expect(result.success).to.be.true;
    });

    it('invokes add_bookmark with group', async () => {
      mockInvoke = () => Promise.resolve(sampleBookmarks);

      await addBookmark('/home/user/project', 'My Project', 'Work');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.group).to.equal('Work');
    });

    it('handles duplicate bookmark error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Bookmark already exists for path: /home/user/project',
        });

      const result = await addBookmark('/home/user/project', 'My Project');
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('already exists');
    });
  });

  describe('removeBookmark', () => {
    it('invokes remove_bookmark with path', async () => {
      mockInvoke = () => Promise.resolve([sampleBookmarks[1]]);

      const result = await removeBookmark('/home/user/project');
      expect(lastInvokedCommand).to.equal('remove_bookmark');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/home/user/project');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });
  });

  describe('updateBookmark', () => {
    it('invokes update_bookmark with bookmark object', async () => {
      mockInvoke = () => Promise.resolve(sampleBookmarks);

      const result = await updateBookmark(sampleBookmark);
      expect(lastInvokedCommand).to.equal('update_bookmark');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.bookmark).to.deep.equal(sampleBookmark);
      expect(result.success).to.be.true;
    });

    it('handles bookmark not found error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Bookmark not found',
        });

      const result = await updateBookmark(sampleBookmark);
      expect(result.success).to.be.false;
    });
  });

  describe('getRecentRepos', () => {
    it('invokes get_recent_repos command', async () => {
      mockInvoke = () => Promise.resolve(sampleBookmarks);

      const result = await getRecentRepos();
      expect(lastInvokedCommand).to.equal('get_recent_repos');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns repos sorted by lastOpened', async () => {
      const sorted = [...sampleBookmarks].sort((a, b) => b.lastOpened - a.lastOpened);
      mockInvoke = () => Promise.resolve(sorted);

      const result = await getRecentRepos();
      expect(result.success).to.be.true;
      if (result.data && result.data.length >= 2) {
        expect(result.data[0].lastOpened).to.be.greaterThanOrEqual(result.data[1].lastOpened);
      }
    });
  });

  describe('recordRepoOpened', () => {
    it('invokes record_repo_opened with path and name', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await recordRepoOpened('/home/user/project', 'My Project');
      expect(lastInvokedCommand).to.equal('record_repo_opened');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/home/user/project');
      expect(args.name).to.equal('My Project');
      expect(result.success).to.be.true;
    });
  });
});
