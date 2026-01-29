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
  getNote,
  getNotes,
  setNote,
  removeNote,
  getNotesRefs,
  type GitNote,
} from '../git.service.ts';

describe('git.service - Git Notes operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getNote', () => {
    it('invokes get_note command', async () => {
      const mockNote: GitNote = {
        commitOid: 'abc123',
        message: 'This is a note',
        notesRef: 'refs/notes/commits',
      };
      mockInvoke = () => Promise.resolve(mockNote);

      const result = await getNote('/test/repo', 'abc123');
      expect(lastInvokedCommand).to.equal('get_note');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.commitOid).to.equal('abc123');
      expect(result.success).to.be.true;
      expect(result.data?.message).to.equal('This is a note');
    });

    it('returns null for commit without note', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await getNote('/test/repo', 'abc123');
      expect(result.success).to.be.true;
      expect(result.data).to.be.null;
    });

    it('supports custom notes ref', async () => {
      mockInvoke = () => Promise.resolve(null);

      await getNote('/test/repo', 'abc123', 'refs/notes/custom');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.notesRef).to.equal('refs/notes/custom');
    });
  });

  describe('getNotes', () => {
    it('invokes get_notes command', async () => {
      const mockNotes: GitNote[] = [
        { commitOid: 'abc123', message: 'Note 1', notesRef: 'refs/notes/commits' },
        { commitOid: 'def456', message: 'Note 2', notesRef: 'refs/notes/commits' },
      ];
      mockInvoke = () => Promise.resolve(mockNotes);

      const result = await getNotes('/test/repo');
      expect(lastInvokedCommand).to.equal('get_notes');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array when no notes exist', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getNotes('/test/repo');
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('setNote', () => {
    it('invokes set_note command', async () => {
      const mockNote: GitNote = {
        commitOid: 'abc123',
        message: 'New note',
        notesRef: 'refs/notes/commits',
      };
      mockInvoke = () => Promise.resolve(mockNote);

      const result = await setNote('/test/repo', 'abc123', 'New note');
      expect(lastInvokedCommand).to.equal('set_note');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.commitOid).to.equal('abc123');
      expect(args.message).to.equal('New note');
      expect(result.success).to.be.true;
    });

    it('supports force overwrite', async () => {
      mockInvoke = () =>
        Promise.resolve({ commitOid: 'abc123', message: 'Updated', notesRef: 'refs/notes/commits' });

      await setNote('/test/repo', 'abc123', 'Updated', undefined, true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('supports custom notes ref', async () => {
      mockInvoke = () =>
        Promise.resolve({ commitOid: 'abc123', message: 'Note', notesRef: 'refs/notes/review' });

      await setNote('/test/repo', 'abc123', 'Note', 'refs/notes/review');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.notesRef).to.equal('refs/notes/review');
    });
  });

  describe('removeNote', () => {
    it('invokes remove_note command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await removeNote('/test/repo', 'abc123');
      expect(lastInvokedCommand).to.equal('remove_note');
      expect(result.success).to.be.true;
    });

    it('handles removing nonexistent note', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Note not found' });

      const result = await removeNote('/test/repo', 'abc123');
      expect(result.success).to.be.false;
    });
  });

  describe('getNotesRefs', () => {
    it('invokes get_notes_refs command', async () => {
      mockInvoke = () =>
        Promise.resolve(['refs/notes/commits', 'refs/notes/review']);

      const result = await getNotesRefs('/test/repo');
      expect(lastInvokedCommand).to.equal('get_notes_refs');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns default ref when no notes exist', async () => {
      mockInvoke = () => Promise.resolve(['refs/notes/commits']);

      const result = await getNotesRefs('/test/repo');
      expect(result.data).to.include('refs/notes/commits');
    });
  });
});
