import { expect } from '@open-wc/testing';
import { parseIssueReferences, isClosingKeyword } from '../git.service.ts';

// Mock Tauri API for tests that need invokeCommand
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

describe('git.service - parseIssueReferences', () => {
  it('parses standalone issue references', () => {
    const refs = parseIssueReferences('This references #123');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(123);
    expect(refs[0].keyword).to.be.null;
    expect(refs[0].fullMatch).to.equal('#123');
  });

  it('parses multiple issue references', () => {
    const refs = parseIssueReferences('See #123 and #456');
    expect(refs.length).to.equal(2);
    expect(refs[0].number).to.equal(123);
    expect(refs[1].number).to.equal(456);
  });

  it('parses "fixes" keyword', () => {
    const refs = parseIssueReferences('fixes #123');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(123);
    expect(refs[0].keyword).to.equal('fixes');
  });

  it('parses "closes" keyword', () => {
    const refs = parseIssueReferences('closes #456');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(456);
    expect(refs[0].keyword).to.equal('closes');
  });

  it('parses "resolves" keyword', () => {
    const refs = parseIssueReferences('resolves #789');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(789);
    expect(refs[0].keyword).to.equal('resolves');
  });

  it('parses mixed keywords and standalone references', () => {
    const refs = parseIssueReferences('fixes #123, see also #456 and closes #789');
    expect(refs.length).to.equal(3);
    expect(refs[0].number).to.equal(123);
    expect(refs[0].keyword).to.equal('fixes');
    expect(refs[1].number).to.equal(789);
    expect(refs[1].keyword).to.equal('closes');
    expect(refs[2].number).to.equal(456);
    expect(refs[2].keyword).to.be.null;
  });

  it('is case insensitive for keywords', () => {
    const refs = parseIssueReferences('FIXES #123 Closes #456 ResolVes #789');
    expect(refs.length).to.equal(3);
    expect(refs[0].keyword).to.equal('fixes');
    expect(refs[1].keyword).to.equal('closes');
    expect(refs[2].keyword).to.equal('resolves');
  });

  it('handles past tense keywords', () => {
    const refs = parseIssueReferences('fixed #123 closed #456 resolved #789');
    expect(refs.length).to.equal(3);
    expect(refs[0].keyword).to.equal('fixed');
    expect(refs[1].keyword).to.equal('closed');
    expect(refs[2].keyword).to.equal('resolved');
  });

  it('returns empty array for text without references', () => {
    const refs = parseIssueReferences('No issues here');
    expect(refs.length).to.equal(0);
  });

  it('does not duplicate issue numbers', () => {
    const refs = parseIssueReferences('fixes #123 and also #123');
    expect(refs.length).to.equal(1);
    expect(refs[0].number).to.equal(123);
  });

  it('handles multiline commit messages', () => {
    const message = `feat: add new feature

fixes #123
closes #456

Related to #789`;
    const refs = parseIssueReferences(message);
    expect(refs.length).to.equal(3);
  });
});

describe('git.service - isClosingKeyword', () => {
  it('returns true for "fixes"', () => {
    expect(isClosingKeyword('fixes')).to.be.true;
  });

  it('returns true for "closes"', () => {
    expect(isClosingKeyword('closes')).to.be.true;
  });

  it('returns true for "resolves"', () => {
    expect(isClosingKeyword('resolves')).to.be.true;
  });

  it('returns true for past tense variants', () => {
    expect(isClosingKeyword('fixed')).to.be.true;
    expect(isClosingKeyword('closed')).to.be.true;
    expect(isClosingKeyword('resolved')).to.be.true;
  });

  it('returns true for base form variants', () => {
    expect(isClosingKeyword('fix')).to.be.true;
    expect(isClosingKeyword('close')).to.be.true;
    expect(isClosingKeyword('resolve')).to.be.true;
  });

  it('returns false for null', () => {
    expect(isClosingKeyword(null)).to.be.false;
  });

  it('returns false for non-closing keywords', () => {
    expect(isClosingKeyword('see')).to.be.false;
    expect(isClosingKeyword('related')).to.be.false;
    expect(isClosingKeyword('ref')).to.be.false;
  });

  it('is case insensitive', () => {
    expect(isClosingKeyword('FIXES')).to.be.true;
    expect(isClosingKeyword('Closes')).to.be.true;
    expect(isClosingKeyword('RESOLVES')).to.be.true;
  });
});

describe('git.service - Tauri command invocations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    // Reset mock to return success by default
    mockInvoke = () => Promise.resolve({ success: true, data: null });
  });

  it('openRepository calls open_repository with correct args', async () => {
    const { openRepository } = await import('../git.service.ts');
    await openRepository({ path: '/test/path' });
    expect(lastInvokedCommand).to.equal('open_repository');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/path' });
  });

  it('getBranches calls get_branches with path', async () => {
    const { getBranches } = await import('../git.service.ts');
    await getBranches('/test/repo');
    expect(lastInvokedCommand).to.equal('get_branches');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('createBranch calls create_branch with correct args', async () => {
    const { createBranch } = await import('../git.service.ts');
    await createBranch('/test/repo', { name: 'feature-branch', startPoint: 'main', checkout: true });
    expect(lastInvokedCommand).to.equal('create_branch');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      name: 'feature-branch',
      startPoint: 'main',
      checkout: true,
    });
  });

  it('deleteBranch calls delete_branch with force option', async () => {
    const { deleteBranch } = await import('../git.service.ts');
    await deleteBranch('/test/repo', 'old-branch', true);
    expect(lastInvokedCommand).to.equal('delete_branch');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', name: 'old-branch', force: true });
  });

  it('getStatus calls get_status with path', async () => {
    const { getStatus } = await import('../git.service.ts');
    await getStatus('/test/repo');
    expect(lastInvokedCommand).to.equal('get_status');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('getTags calls get_tags with path', async () => {
    const { getTags } = await import('../git.service.ts');
    await getTags('/test/repo');
    expect(lastInvokedCommand).to.equal('get_tags');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('getStashes calls get_stashes with path', async () => {
    const { getStashes } = await import('../git.service.ts');
    await getStashes('/test/repo');
    expect(lastInvokedCommand).to.equal('get_stashes');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('getRemotes calls get_remotes with path', async () => {
    const { getRemotes } = await import('../git.service.ts');
    await getRemotes('/test/repo');
    expect(lastInvokedCommand).to.equal('get_remotes');
    expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
  });

  it('searchCommits passes camelCase params to Tauri', async () => {
    const { searchCommits } = await import('../git.service.ts');
    await searchCommits('/test/repo', {
      query: 'search',
      author: 'user',
      dateFrom: 1000,
      dateTo: 2000,
      filePath: 'file.ts',
      limit: 50,
    });
    expect(lastInvokedCommand).to.equal('search_commits');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      query: 'search',
      author: 'user',
      dateFrom: 1000,
      dateTo: 2000,
      filePath: 'file.ts',
      branch: undefined,
      limit: 50,
    });
  });

  it('amendCommit calls amend_commit with message and resetAuthor', async () => {
    const { amendCommit } = await import('../git.service.ts');
    await amendCommit('/test/repo', { message: 'New message', resetAuthor: true });
    expect(lastInvokedCommand).to.equal('amend_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      message: 'New message',
      resetAuthor: true,
      signAmend: undefined,
    });
  });

  it('amendCommit calls amend_commit with only message', async () => {
    const { amendCommit } = await import('../git.service.ts');
    await amendCommit('/test/repo', { message: 'Updated message' });
    expect(lastInvokedCommand).to.equal('amend_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      message: 'Updated message',
      resetAuthor: undefined,
      signAmend: undefined,
    });
  });

  it('amendCommit calls amend_commit without args', async () => {
    const { amendCommit } = await import('../git.service.ts');
    await amendCommit('/test/repo');
    expect(lastInvokedCommand).to.equal('amend_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      message: undefined,
      resetAuthor: undefined,
      signAmend: undefined,
    });
  });

  it('amendCommit calls amend_commit with signAmend', async () => {
    const { amendCommit } = await import('../git.service.ts');
    await amendCommit('/test/repo', { message: 'Signed amend', signAmend: true });
    expect(lastInvokedCommand).to.equal('amend_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      message: 'Signed amend',
      resetAuthor: undefined,
      signAmend: true,
    });
  });

  it('getCommitMessage calls get_commit_message with path and oid', async () => {
    const { getCommitMessage } = await import('../git.service.ts');
    await getCommitMessage('/test/repo', 'abc123');
    expect(lastInvokedCommand).to.equal('get_commit_message');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      oid: 'abc123',
    });
  });

  it('rewordCommit calls reword_commit with path, oid, and message', async () => {
    const { rewordCommit } = await import('../git.service.ts');
    await rewordCommit('/test/repo', 'abc123', 'Reworded message');
    expect(lastInvokedCommand).to.equal('reword_commit');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
      oid: 'abc123',
      message: 'Reworded message',
    });
  });

  it('getSigningStatus calls get_signing_status with path', async () => {
    const { getSigningStatus } = await import('../git.service.ts');
    await getSigningStatus('/test/repo');
    expect(lastInvokedCommand).to.equal('get_signing_status');
    expect(lastInvokedArgs).to.deep.equal({
      path: '/test/repo',
    });
  });
});
