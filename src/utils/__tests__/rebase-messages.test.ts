/**
 * Tests for the shared rebase success wording.
 *
 * A rebase drops commits whose patch is already on the target. `git rebase`
 * warns about each on stderr; a GUI has no stderr, so the toast is the only
 * place the user can learn their local commits disappeared.
 */
import { expect } from '@open-wc/testing';
import { rebasedOntoMessage, skippedCommitsSuffix } from '../rebase-messages.ts';

describe('rebasedOntoMessage', () => {
  it('reads as a plain success when nothing was skipped', () => {
    expect(rebasedOntoMessage('main', 0)).to.equal('Rebased onto main');
  });

  it('names the skipped commits so they do not vanish silently', () => {
    expect(rebasedOntoMessage('main', 1)).to.equal(
      'Rebased onto main, skipped 1 commit(s) already applied upstream'
    );
    expect(rebasedOntoMessage('origin/main', 3)).to.equal(
      'Rebased onto origin/main, skipped 3 commit(s) already applied upstream'
    );
  });

  // `CommandResult.data` is optional, and older mocks resolve `rebase` with
  // null — neither may turn the success toast into "skipped null".
  it('falls back to the plain success when the count is missing', () => {
    expect(rebasedOntoMessage('main')).to.equal('Rebased onto main');
    expect(rebasedOntoMessage('main', null)).to.equal('Rebased onto main');
  });
});

describe('skippedCommitsSuffix', () => {
  // The conflict-resolution dialog appends this to "Rebase completed", so it
  // must carry its own leading comma and name the noun on its own.
  it('names the count and the noun', () => {
    expect(skippedCommitsSuffix(2)).to.equal(
      ', skipped 2 commit(s) already applied upstream'
    );
  });

  it('is empty when nothing was skipped or the count is missing', () => {
    expect(skippedCommitsSuffix(0)).to.equal('');
    expect(skippedCommitsSuffix()).to.equal('');
    expect(skippedCommitsSuffix(null)).to.equal('');
  });
});
