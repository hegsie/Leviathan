/**
 * Unit tests for canvas-renderer utility functions.
 * Covers sortRefsForDisplay (most important refs shown first when the refs
 * column has limited space), renderer state getters used by graph export,
 * and the avatar cache (LRU + failure retry + fetch opt-out).
 */
import { expect } from '@open-wc/testing';
import { CanvasRenderer, sortRefsForDisplay } from '../canvas-renderer.ts';
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

// ── Renderer state (export support + avatar cache) ─────────────────────────
type RendererInternals = {
  avatarCache: Map<string, HTMLImageElement>;
  failedAvatars: Map<string, number>;
  avatarLoadingSet: Set<string>;
  loadAvatar(email: string): void;
  getCachedAvatar(email: string): HTMLImageElement | undefined;
};

function makeRenderer(config: Record<string, unknown> = {}): CanvasRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  return new CanvasRenderer(canvas, config);
}

describe('CanvasRenderer state getters', () => {
  it('returns commit stats set via setCommitStats (used by PNG export)', () => {
    const renderer = makeRenderer();
    const stats = new Map([
      ['abc', { additions: 5, deletions: 2, filesChanged: 1 }],
    ]);
    renderer.setCommitStats(stats);
    expect(renderer.getCommitStats().get('abc')).to.deep.equal({
      additions: 5,
      deletions: 2,
      filesChanged: 1,
    });
    renderer.destroy();
  });

  it('returns commit signatures set via setCommitSignatures (used by PNG export)', () => {
    const renderer = makeRenderer();
    const sigs = new Map([['abc', { signed: true, valid: true }]]);
    renderer.setCommitSignatures(sigs);
    expect(renderer.getCommitSignatures().get('abc')).to.deep.equal({
      signed: true,
      valid: true,
    });
    renderer.destroy();
  });
});

describe('CanvasRenderer text truncation cache', () => {
  type TruncationInternals = {
    ctx: CanvasRenderingContext2D;
    truncationCache: Map<string, string>;
    truncateToWidth(text: string, maxWidth: number): string;
  };

  it('truncates long text with an ellipsis and caches the result', () => {
    const renderer = makeRenderer();
    const internals = renderer as unknown as TruncationInternals;
    internals.ctx.font = '13px sans-serif';

    const longText = 'A very long commit message that cannot possibly fit';
    const truncated = internals.truncateToWidth(longText, 60);
    expect(truncated.endsWith('…')).to.be.true;
    expect(truncated.length).to.be.lessThan(longText.length);
    expect(internals.truncationCache.size).to.equal(1);

    // Second call is served from the cache
    expect(internals.truncateToWidth(longText, 60)).to.equal(truncated);
    expect(internals.truncationCache.size).to.equal(1);
    renderer.destroy();
  });

  it('returns short text unchanged', () => {
    const renderer = makeRenderer();
    const internals = renderer as unknown as TruncationInternals;
    internals.ctx.font = '13px sans-serif';

    expect(internals.truncateToWidth('short', 500)).to.equal('short');
    renderer.destroy();
  });

  it('keys the cache on width so resizes re-truncate', () => {
    const renderer = makeRenderer();
    const internals = renderer as unknown as TruncationInternals;
    internals.ctx.font = '13px sans-serif';

    const text = 'A very long commit message that cannot possibly fit';
    const narrow = internals.truncateToWidth(text, 60);
    const wide = internals.truncateToWidth(text, 200);
    expect(wide.length).to.be.greaterThan(narrow.length);
    expect(internals.truncationCache.size).to.equal(2);
    renderer.destroy();
  });
});

describe('CanvasRenderer avatar cache', () => {
  it('does not start avatar loads when fetchAvatars is false', () => {
    const renderer = makeRenderer({ fetchAvatars: false });
    const internals = renderer as unknown as RendererInternals;

    internals.loadAvatar('someone@example.com');
    expect(internals.avatarLoadingSet.size).to.equal(0);
    renderer.destroy();
  });

  it('does not retry a recently failed avatar load', () => {
    const renderer = makeRenderer();
    const internals = renderer as unknown as RendererInternals;

    internals.failedAvatars.set('someone@example.com', Date.now());
    internals.loadAvatar('someone@example.com');
    expect(internals.avatarLoadingSet.size).to.equal(0);
    renderer.destroy();
  });

  it('retries a failed avatar load after the retry window has passed', () => {
    const renderer = makeRenderer();
    const internals = renderer as unknown as RendererInternals;

    // Failure recorded 10 minutes ago — outside the 5-minute retry window
    internals.failedAvatars.set('someone@example.com', Date.now() - 10 * 60 * 1000);
    internals.loadAvatar('someone@example.com');
    expect(internals.avatarLoadingSet.has('someone@example.com')).to.be.true;
    renderer.destroy();
  });

  it('refreshes LRU position when a cached avatar is read', () => {
    const renderer = makeRenderer();
    const internals = renderer as unknown as RendererInternals;

    internals.avatarCache.set('first@example.com', new Image());
    internals.avatarCache.set('second@example.com', new Image());

    // Reading the oldest entry moves it to the most-recent end
    internals.getCachedAvatar('first@example.com');
    const keys = [...internals.avatarCache.keys()];
    expect(keys).to.deep.equal(['second@example.com', 'first@example.com']);
    renderer.destroy();
  });

  it('returns undefined for uncached avatars without touching the cache', () => {
    const renderer = makeRenderer();
    const internals = renderer as unknown as RendererInternals;

    expect(internals.getCachedAvatar('missing@example.com')).to.be.undefined;
    expect(internals.avatarCache.size).to.equal(0);
    renderer.destroy();
  });
});
