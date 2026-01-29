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
  getTags,
  createTag,
  deleteTag,
  pushTag,
  getTagDetails,
  editTagMessage,
} from '../git.service.ts';

describe('git.service - Tag operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('getTags', () => {
    it('invokes get_tags command with path', async () => {
      const mockTags = [
        {
          name: 'v1.0.0',
          targetOid: 'abc123',
          message: 'Release 1.0.0',
          tagger: { name: 'Test User', email: 'test@test.com', timestamp: 1700000000 },
          isAnnotated: true,
        },
        {
          name: 'v0.9.0',
          targetOid: 'def456',
          message: null,
          tagger: null,
          isAnnotated: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTags);

      const result = await getTags('/test/repo');
      expect(lastInvokedCommand).to.equal('get_tags');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns annotated tags with messages', async () => {
      const mockTags = [
        {
          name: 'v2.0.0',
          targetOid: 'xyz789',
          message: 'Major release with breaking changes',
          tagger: { name: 'Release Manager', email: 'release@test.com', timestamp: 1700000000 },
          isAnnotated: true,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTags);

      const result = await getTags('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.[0].isAnnotated).to.be.true;
      expect(result.data?.[0].message).to.equal('Major release with breaking changes');
      expect(result.data?.[0].tagger?.name).to.equal('Release Manager');
    });

    it('returns lightweight tags without messages', async () => {
      const mockTags = [
        {
          name: 'temp-tag',
          targetOid: 'abc123',
          message: null,
          tagger: null,
          isAnnotated: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTags);

      const result = await getTags('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.[0].isAnnotated).to.be.false;
      expect(result.data?.[0].message).to.be.null;
      expect(result.data?.[0].tagger).to.be.null;
    });

    it('returns empty array for repository without tags', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getTags('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles repository not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPOSITORY_NOT_FOUND', message: 'Repository not found' });

      const result = await getTags('/invalid/repo');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REPOSITORY_NOT_FOUND');
    });
  });

  describe('createTag', () => {
    it('invokes create_tag with name only (lightweight tag)', async () => {
      const mockTag = {
        name: 'v1.0.0',
        targetOid: 'abc123',
        message: null,
        tagger: null,
        isAnnotated: false,
      };
      mockInvoke = () => Promise.resolve(mockTag);

      const result = await createTag({ path: '/test/repo', name: 'v1.0.0' });
      expect(lastInvokedCommand).to.equal('create_tag');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('v1.0.0');
      expect(result.success).to.be.true;
    });

    it('invokes create_tag with message (annotated tag)', async () => {
      const mockTag = {
        name: 'v2.0.0',
        targetOid: 'def456',
        message: 'Release version 2.0.0',
        tagger: { name: 'Test User', email: 'test@test.com', timestamp: 1700000000 },
        isAnnotated: true,
      };
      mockInvoke = () => Promise.resolve(mockTag);

      const result = await createTag({
        path: '/test/repo',
        name: 'v2.0.0',
        message: 'Release version 2.0.0',
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('v2.0.0');
      expect(args.message).to.equal('Release version 2.0.0');
      expect(result.success).to.be.true;
      expect(result.data?.isAnnotated).to.be.true;
    });

    it('invokes create_tag with target commit', async () => {
      const mockTag = {
        name: 'v1.5.0',
        targetOid: 'xyz789',
        message: null,
        tagger: null,
        isAnnotated: false,
      };
      mockInvoke = () => Promise.resolve(mockTag);

      await createTag({
        path: '/test/repo',
        name: 'v1.5.0',
        target: 'xyz789',
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.target).to.equal('xyz789');
    });

    it('creates tag with both target and message', async () => {
      const mockTag = {
        name: 'hotfix-v1.0.1',
        targetOid: 'abc123',
        message: 'Hotfix for critical bug',
        tagger: { name: 'Test User', email: 'test@test.com', timestamp: 1700000000 },
        isAnnotated: true,
      };
      mockInvoke = () => Promise.resolve(mockTag);

      const result = await createTag({
        path: '/test/repo',
        name: 'hotfix-v1.0.1',
        target: 'abc123',
        message: 'Hotfix for critical bug',
      });
      expect(result.success).to.be.true;
      expect(result.data?.targetOid).to.equal('abc123');
      expect(result.data?.message).to.equal('Hotfix for critical bug');
    });

    it('handles tag already exists error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'TAG_EXISTS', message: 'Tag already exists' });

      const result = await createTag({ path: '/test/repo', name: 'existing-tag' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('TAG_EXISTS');
    });

    it('handles invalid tag name error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_TAG_NAME', message: 'Invalid tag name' });

      const result = await createTag({ path: '/test/repo', name: '..invalid' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('INVALID_TAG_NAME');
    });

    it('handles target not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'TARGET_NOT_FOUND', message: 'Target commit not found' });

      const result = await createTag({
        path: '/test/repo',
        name: 'v3.0.0',
        target: 'invalidcommit',
      });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('TARGET_NOT_FOUND');
    });
  });

  describe('deleteTag', () => {
    it('invokes delete_tag with correct arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await deleteTag({ path: '/test/repo', name: 'v1.0.0' });
      expect(lastInvokedCommand).to.equal('delete_tag');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('v1.0.0');
      expect(result.success).to.be.true;
    });

    it('deletes lightweight tag', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await deleteTag({ path: '/test/repo', name: 'temp-tag' });
      expect(result.success).to.be.true;
    });

    it('deletes annotated tag', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await deleteTag({ path: '/test/repo', name: 'v2.0.0' });
      expect(result.success).to.be.true;
    });

    it('handles tag not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'TAG_NOT_FOUND', message: 'Tag not found' });

      const result = await deleteTag({ path: '/test/repo', name: 'nonexistent' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('TAG_NOT_FOUND');
    });

    it('handles repository not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPOSITORY_NOT_FOUND', message: 'Repository not found' });

      const result = await deleteTag({ path: '/invalid/repo', name: 'v1.0.0' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REPOSITORY_NOT_FOUND');
    });
  });

  describe('pushTag', () => {
    it('invokes push_tag with name only', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await pushTag({ path: '/test/repo', name: 'v1.0.0' });
      expect(lastInvokedCommand).to.equal('push_tag');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('v1.0.0');
      expect(result.success).to.be.true;
    });

    it('invokes push_tag with remote specified', async () => {
      mockInvoke = () => Promise.resolve(null);

      await pushTag({ path: '/test/repo', name: 'v1.0.0', remote: 'upstream' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.remote).to.equal('upstream');
    });

    it('invokes push_tag with force option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await pushTag({ path: '/test/repo', name: 'v1.0.0', force: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('invokes push_tag with all options', async () => {
      mockInvoke = () => Promise.resolve(null);

      await pushTag({
        path: '/test/repo',
        name: 'v2.0.0',
        remote: 'origin',
        force: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('v2.0.0');
      expect(args.remote).to.equal('origin');
      expect(args.force).to.be.true;
    });

    it('handles authentication error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'AUTHENTICATION_FAILED', message: 'Authentication failed' });

      const result = await pushTag({ path: '/test/repo', name: 'v1.0.0' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('AUTHENTICATION_FAILED');
    });

    it('handles remote not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REMOTE_NOT_FOUND', message: 'Remote not found' });

      const result = await pushTag({
        path: '/test/repo',
        name: 'v1.0.0',
        remote: 'nonexistent',
      });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REMOTE_NOT_FOUND');
    });

    it('handles tag rejected error without force', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'TAG_REJECTED', message: 'Remote tag already exists' });

      const result = await pushTag({ path: '/test/repo', name: 'v1.0.0' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('TAG_REJECTED');
    });

    it('handles network error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'NETWORK_ERROR', message: 'Network error' });

      const result = await pushTag({ path: '/test/repo', name: 'v1.0.0' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('NETWORK_ERROR');
    });
  });

  describe('getTagDetails', () => {
    it('invokes get_tag_details with correct arguments', async () => {
      const mockDetails = {
        name: 'v1.0.0',
        oid: 'tag-oid-123',
        targetOid: 'commit-abc123',
        isAnnotated: true,
        message: 'Release 1.0.0',
        taggerName: 'Test User',
        taggerEmail: 'test@test.com',
        taggerDate: 1700000000,
        isSigned: false,
      };
      mockInvoke = () => Promise.resolve(mockDetails);

      const result = await getTagDetails({ path: '/test/repo', name: 'v1.0.0' });
      expect(lastInvokedCommand).to.equal('get_tag_details');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('v1.0.0');
      expect(result.success).to.be.true;
      expect(result.data?.isAnnotated).to.be.true;
      expect(result.data?.message).to.equal('Release 1.0.0');
    });

    it('returns details for annotated tag with tagger info', async () => {
      const mockDetails = {
        name: 'v2.0.0',
        oid: 'tag-oid-456',
        targetOid: 'commit-def456',
        isAnnotated: true,
        message: 'Major release',
        taggerName: 'Release Manager',
        taggerEmail: 'release@test.com',
        taggerDate: 1700000000,
        isSigned: true,
      };
      mockInvoke = () => Promise.resolve(mockDetails);

      const result = await getTagDetails({ path: '/test/repo', name: 'v2.0.0' });
      expect(result.success).to.be.true;
      expect(result.data?.taggerName).to.equal('Release Manager');
      expect(result.data?.taggerEmail).to.equal('release@test.com');
      expect(result.data?.taggerDate).to.equal(1700000000);
      expect(result.data?.isSigned).to.be.true;
    });

    it('returns details for lightweight tag', async () => {
      const mockDetails = {
        name: 'temp-tag',
        oid: 'commit-abc123',
        targetOid: 'commit-abc123',
        isAnnotated: false,
        message: null,
        taggerName: null,
        taggerEmail: null,
        taggerDate: null,
        isSigned: false,
      };
      mockInvoke = () => Promise.resolve(mockDetails);

      const result = await getTagDetails({ path: '/test/repo', name: 'temp-tag' });
      expect(result.success).to.be.true;
      expect(result.data?.isAnnotated).to.be.false;
      expect(result.data?.message).to.be.null;
      expect(result.data?.taggerName).to.be.null;
      expect(result.data?.oid).to.equal(result.data?.targetOid);
    });

    it('handles tag not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'TAG_NOT_FOUND', message: 'Tag not found' });

      const result = await getTagDetails({ path: '/test/repo', name: 'nonexistent' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('TAG_NOT_FOUND');
    });
  });

  describe('editTagMessage', () => {
    it('invokes edit_tag_message with correct arguments', async () => {
      const mockDetails = {
        name: 'v1.0.0',
        oid: 'new-tag-oid',
        targetOid: 'commit-abc123',
        isAnnotated: true,
        message: 'Updated message',
        taggerName: 'Test User',
        taggerEmail: 'test@test.com',
        taggerDate: 1700000000,
        isSigned: false,
      };
      mockInvoke = () => Promise.resolve(mockDetails);

      const result = await editTagMessage({
        path: '/test/repo',
        name: 'v1.0.0',
        message: 'Updated message',
      });
      expect(lastInvokedCommand).to.equal('edit_tag_message');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('v1.0.0');
      expect(args.message).to.equal('Updated message');
      expect(result.success).to.be.true;
      expect(result.data?.message).to.equal('Updated message');
    });

    it('returns updated tag details after editing', async () => {
      const mockDetails = {
        name: 'v2.0.0',
        oid: 'new-tag-oid-789',
        targetOid: 'commit-xyz789',
        isAnnotated: true,
        message: 'New release notes for v2',
        taggerName: 'Editor',
        taggerEmail: 'editor@test.com',
        taggerDate: 1700001000,
        isSigned: false,
      };
      mockInvoke = () => Promise.resolve(mockDetails);

      const result = await editTagMessage({
        path: '/test/repo',
        name: 'v2.0.0',
        message: 'New release notes for v2',
      });
      expect(result.success).to.be.true;
      expect(result.data?.isAnnotated).to.be.true;
      expect(result.data?.targetOid).to.equal('commit-xyz789');
    });

    it('handles lightweight tag edit error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Cannot edit a lightweight tag' });

      const result = await editTagMessage({
        path: '/test/repo',
        name: 'lightweight-tag',
        message: 'Should fail',
      });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('OPERATION_FAILED');
    });

    it('handles tag not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'TAG_NOT_FOUND', message: 'Tag not found' });

      const result = await editTagMessage({
        path: '/test/repo',
        name: 'nonexistent',
        message: 'Should fail',
      });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('TAG_NOT_FOUND');
    });
  });
});
