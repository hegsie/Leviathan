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
  getAvatarUrl,
  getAvatarUrls,
} from '../git.service.ts';

import type { AvatarInfo } from '../../types/git.types.ts';

describe('git.service - Avatar operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getAvatarUrl', () => {
    it('invokes get_avatar_url command', async () => {
      const mockAvatar: AvatarInfo = {
        email: 'test@example.com',
        gravatarUrl: 'https://www.gravatar.com/avatar/abc123?s=40&d=404',
        initials: 'T',
        color: '#ab12cd',
      };
      mockInvoke = () => Promise.resolve(mockAvatar);

      const result = await getAvatarUrl({ email: 'test@example.com' });
      expect(lastInvokedCommand).to.equal('get_avatar_url');
      expect(result.success).to.be.true;
      expect(result.data?.email).to.equal('test@example.com');
      expect(result.data?.gravatarUrl).to.include('gravatar.com');
    });

    it('supports custom size', async () => {
      mockInvoke = () =>
        Promise.resolve({
          email: 'test@example.com',
          gravatarUrl: 'https://www.gravatar.com/avatar/abc123?s=80&d=404',
          initials: 'T',
          color: '#ab12cd',
        });

      await getAvatarUrl({ email: 'test@example.com', size: 80 });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.email).to.equal('test@example.com');
      expect(args.size).to.equal(80);
    });

    it('generates initials from email', async () => {
      mockInvoke = () =>
        Promise.resolve({
          email: 'alice@example.com',
          gravatarUrl: 'https://www.gravatar.com/avatar/abc?s=40&d=404',
          initials: 'A',
          color: '#123456',
        });

      const result = await getAvatarUrl({ email: 'alice@example.com' });
      expect(result.data?.initials).to.equal('A');
    });
  });

  describe('getAvatarUrls', () => {
    it('invokes get_avatar_urls command', async () => {
      const mockAvatars: AvatarInfo[] = [
        {
          email: 'alice@example.com',
          gravatarUrl: 'https://www.gravatar.com/avatar/abc?s=40&d=404',
          initials: 'A',
          color: '#123456',
        },
        {
          email: 'bob@example.com',
          gravatarUrl: 'https://www.gravatar.com/avatar/def?s=40&d=404',
          initials: 'B',
          color: '#654321',
        },
      ];
      mockInvoke = () => Promise.resolve(mockAvatars);

      const result = await getAvatarUrls({
        emails: ['alice@example.com', 'bob@example.com'],
      });
      expect(lastInvokedCommand).to.equal('get_avatar_urls');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array for no emails', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getAvatarUrls({ emails: [] });
      expect(result.data).to.deep.equal([]);
    });
  });
});
