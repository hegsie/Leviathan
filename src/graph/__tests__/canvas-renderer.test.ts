/**
 * Unit tests for canvas-renderer utility functions.
 * Focused on sortRefsForDisplay — ensures the most important refs
 * are shown first when the refs column has limited space.
 */
import { expect } from '@open-wc/testing';
import { sortRefsForDisplay } from '../canvas-renderer.ts';
import type { RefInfo } from '../../types/git.types.ts';

function makeRef(overrides: Partial<RefInfo>): RefInfo {
  return {
    name: `refs/heads/${overrides.shorthand ?? 'main'}`,
    shorthand: 'main',
    refType: 'localBranch',
    isHead: false,
    ...overrides,
  };
}

describe('sortRefsForDisplay', () => {
  it('returns the same array for 0 or 1 refs', () => {
    expect(sortRefsForDisplay([])).to.deep.equal([]);

    const single = [makeRef({ shorthand: 'main', isHead: true })];
    expect(sortRefsForDisplay(single)).to.deep.equal(single);
  });

  it('puts HEAD branch first', () => {
    const refs = [
      makeRef({ shorthand: 'origin/main', refType: 'remoteBranch', isHead: false }),
      makeRef({ shorthand: 'develop', isHead: false }),
      makeRef({ shorthand: 'main', isHead: true }),
    ];

    const sorted = sortRefsForDisplay(refs);
    expect(sorted[0].shorthand).to.equal('main');
    expect(sorted[0].isHead).to.be.true;
  });

  it('puts local branches before remote branches', () => {
    const refs = [
      makeRef({ shorthand: 'origin/feature/foo', refType: 'remoteBranch' }),
      makeRef({ shorthand: 'feature/foo', refType: 'localBranch' }),
    ];

    const sorted = sortRefsForDisplay(refs);
    expect(sorted[0].refType).to.equal('localBranch');
    expect(sorted[1].refType).to.equal('remoteBranch');
  });

  it('puts remote-only branches before remote duplicates of local branches', () => {
    // Scenario: feature/github-azure-devops-interop (local, HEAD) +
    // origin/feature/github-azure-devops-interop (remote duplicate) +
    // origin/new-nonprod-cert-dv3 (remote-only, no local counterpart)
    const refs = [
      makeRef({
        shorthand: 'feature/github-azure-devops-interop-vhDvn',
        refType: 'localBranch',
        isHead: true,
      }),
      makeRef({
        shorthand: 'origin/feature/github-azure-devops-interop-vhDvn',
        refType: 'remoteBranch',
      }),
      makeRef({
        shorthand: 'origin/new-nonprod-cert-dv3',
        refType: 'remoteBranch',
      }),
    ];

    const sorted = sortRefsForDisplay(refs);

    // HEAD local branch first
    expect(sorted[0].shorthand).to.equal('feature/github-azure-devops-interop-vhDvn');
    expect(sorted[0].isHead).to.be.true;

    // Remote-only branch (dv3) second — this is the crucial fix
    expect(sorted[1].shorthand).to.equal('origin/new-nonprod-cert-dv3');
    expect(sorted[1].refType).to.equal('remoteBranch');

    // Remote duplicate last
    expect(sorted[2].shorthand).to.equal('origin/feature/github-azure-devops-interop-vhDvn');
  });

  it('puts tags after branches', () => {
    const refs = [
      makeRef({ shorthand: 'v1.0.0', refType: 'tag' }),
      makeRef({ shorthand: 'main', refType: 'localBranch' }),
      makeRef({ shorthand: 'origin/main', refType: 'remoteBranch' }),
    ];

    const sorted = sortRefsForDisplay(refs);
    expect(sorted[0].refType).to.equal('localBranch');
    expect(sorted[1].refType).to.equal('remoteBranch');
    expect(sorted[2].refType).to.equal('tag');
  });

  it('within the same priority, shorter names come first', () => {
    const refs = [
      makeRef({ shorthand: 'origin/very-long-branch-name', refType: 'remoteBranch' }),
      makeRef({ shorthand: 'origin/short', refType: 'remoteBranch' }),
    ];

    const sorted = sortRefsForDisplay(refs);
    expect(sorted[0].shorthand).to.equal('origin/short');
    expect(sorted[1].shorthand).to.equal('origin/very-long-branch-name');
  });

  it('handles multiple local branches sorted by length', () => {
    const refs = [
      makeRef({ shorthand: 'feature/very-long-name', refType: 'localBranch' }),
      makeRef({ shorthand: 'main', refType: 'localBranch', isHead: true }),
      makeRef({ shorthand: 'dev', refType: 'localBranch' }),
    ];

    const sorted = sortRefsForDisplay(refs);
    expect(sorted[0].shorthand).to.equal('main'); // HEAD first
    expect(sorted[1].shorthand).to.equal('dev'); // shorter name
    expect(sorted[2].shorthand).to.equal('feature/very-long-name');
  });

  it('does not mutate the original array', () => {
    const refs = [
      makeRef({ shorthand: 'origin/main', refType: 'remoteBranch' }),
      makeRef({ shorthand: 'main', refType: 'localBranch', isHead: true }),
    ];
    const original = [...refs];

    sortRefsForDisplay(refs);

    expect(refs[0].shorthand).to.equal(original[0].shorthand);
    expect(refs[1].shorthand).to.equal(original[1].shorthand);
  });

  it('handles remote-only branch without slash in shorthand', () => {
    // Edge case: remote shorthand with no slash (shouldn't happen in practice
    // but should not crash)
    const refs = [
      makeRef({ shorthand: 'main', refType: 'localBranch' }),
      makeRef({ shorthand: 'somebranch', refType: 'remoteBranch' }),
    ];

    const sorted = sortRefsForDisplay(refs);
    expect(sorted[0].refType).to.equal('localBranch');
    // Remote branch 'somebranch' matches local 'main'? No.
    // With no slash, branchName = shorthand = 'somebranch' — not in local set
    // So it's remote-only (priority 2)
    expect(sorted[1].refType).to.equal('remoteBranch');
  });

  it('full scenario: multiple branch types on same commit', () => {
    const refs = [
      makeRef({ shorthand: 'v2.0', refType: 'tag', isAnnotated: true }),
      makeRef({ shorthand: 'origin/release/v2', refType: 'remoteBranch' }),
      makeRef({ shorthand: 'origin/main', refType: 'remoteBranch' }),
      makeRef({ shorthand: 'main', refType: 'localBranch', isHead: true }),
      makeRef({ shorthand: 'release/v2', refType: 'localBranch' }),
    ];

    const sorted = sortRefsForDisplay(refs);

    expect(sorted[0].shorthand).to.equal('main'); // HEAD
    expect(sorted[1].shorthand).to.equal('release/v2'); // local branch
    expect(sorted[2].shorthand).to.equal('origin/main'); // remote duplicate (main exists locally)
    expect(sorted[3].shorthand).to.equal('origin/release/v2'); // remote duplicate (release/v2 exists locally)
    expect(sorted[4].shorthand).to.equal('v2.0'); // tag
  });
});
