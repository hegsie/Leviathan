import { expect } from '@open-wc/testing';
import { samePath } from '../path-compare.ts';

/**
 * Run `fn` as if the app were hosted on `ua`'s platform.
 *
 * `samePath` must answer from the SHAPE of the paths alone, so these two cases
 * pin that the host cannot change the answer. Frontend CI runs on Ubuntu, so
 * without the stub a host-sensitive implementation stays invisible here and
 * only breaks for users on Windows.
 */
async function withUserAgent(ua: string, fn: () => void): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(navigator, 'userAgent', original);
    else delete (navigator as unknown as Record<string, unknown>).userAgent;
  }
}

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';

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

  // The host must not decide: a POSIX-shaped pair names two directories on
  // every platform, including when the app is running on Windows.
  it('keeps POSIX paths case-sensitive even on a Windows host', async () => {
    await withUserAgent(WINDOWS_UA, () => {
      expect(samePath('/srv/Repo', '/srv/repo')).to.be.false;
      expect(samePath('/srv/repo', '/srv/repo')).to.be.true;
    });
  });

  // ...and the mirror: a Windows-shaped pair folds even when the app is not
  // running on Windows, which is how the E2E and unit suites see it.
  it('still folds Windows-shaped paths on a non-Windows host', async () => {
    await withUserAgent(LINUX_UA, () => {
      expect(samePath('c:/Work/Repo', 'C:\\work\\repo')).to.be.true;
      expect(samePath('//server/share/Repo', '\\\\server\\share\\repo')).to.be.true;
    });
  });
});
