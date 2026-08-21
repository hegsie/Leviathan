import { expect } from '@open-wc/testing';
import { samePath } from '../path-compare.ts';

describe('samePath', () => {
  it('matches a Windows path git spelled with forward slashes', () => {
    expect(samePath('C:/work/repo', 'C:\\work\\repo')).to.be.true;
  });

  it('matches Windows paths that differ only in case', () => {
    expect(samePath('c:/Work/Repo', 'C:\\work\\repo')).to.be.true;
  });

  it('matches a UNC share spelled with forward slashes and different case', () => {
    expect(samePath('//server/share/Repo', '\\\\server\\share\\repo')).to.be.true;
  });

  it('ignores a trailing separator', () => {
    expect(samePath('/srv/repo/', '/srv/repo')).to.be.true;
  });

  // POSIX paths are case-SENSITIVE — folding them would make the guard fire on
  // the wrong worktree and permanently disable a legitimate Remove.
  it('does not fold case on POSIX paths', () => {
    expect(samePath('/srv/Repo', '/srv/repo')).to.be.false;
  });

  // Worktrees are commonly siblings named `repo` and `repo-feature`.
  it('does not prefix-match a sibling worktree', () => {
    expect(samePath('/srv/repo', '/srv/repo-feature')).to.be.false;
    expect(samePath('/srv/repo-feature', '/srv/repo')).to.be.false;
  });

  it('never matches an empty path', () => {
    expect(samePath('', '/srv/repo')).to.be.false;
    expect(samePath('/srv/repo', '')).to.be.false;
    expect(samePath('', '')).to.be.false;
  });

  it('still matches the root directory with itself', () => {
    expect(samePath('/', '/')).to.be.true;
  });
});
