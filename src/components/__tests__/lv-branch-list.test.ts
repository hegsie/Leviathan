import { expect } from '@open-wc/testing';
import type { Branch } from '../../types/git.types.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// --- Replicate pure logic from lv-branch-list.ts for testing ---

type BranchSortMode = 'name' | 'date' | 'date-asc';

interface LocalBranchGroup {
  prefix: string | null;
  displayName: string;
  branches: Branch[];
}

// Helper: create a Branch for testing
function createBranch(
  name: string,
  opts: Partial<Branch> = {},
): Branch {
  return {
    name,
    shorthand: opts.shorthand ?? name,
    isHead: opts.isHead ?? false,
    isRemote: opts.isRemote ?? false,
    upstream: opts.upstream ?? null,
    targetOid: opts.targetOid ?? 'abc123',
    lastCommitTimestamp: opts.lastCommitTimestamp ?? undefined,
    isStale: opts.isStale ?? false,
    ...opts,
  };
}

// Replicate filterBranches logic from lv-branch-list.ts
function filterBranches(branches: Branch[], filterText: string): Branch[] {
  let filtered = branches;

  if (filterText) {
    const lower = filterText.toLowerCase();
    filtered = filtered.filter(
      (b) => b.name.toLowerCase().includes(lower) || b.shorthand.toLowerCase().includes(lower),
    );
  }

  return filtered;
}

// Replicate sortBranches logic from lv-branch-list.ts
function sortBranches(branches: Branch[], sortMode: BranchSortMode): Branch[] {
  return [...branches].sort((a, b) => {
    // HEAD always first
    if (a.isHead) return -1;
    if (b.isHead) return 1;

    switch (sortMode) {
      case 'date':
        // Newest first
        return (b.lastCommitTimestamp ?? 0) - (a.lastCommitTimestamp ?? 0);
      case 'date-asc':
        // Oldest first
        return (a.lastCommitTimestamp ?? 0) - (b.lastCommitTimestamp ?? 0);
      case 'name':
      default:
        return a.name.localeCompare(b.name);
    }
  });
}

// Replicate groupLocalBranches logic from lv-branch-list.ts
function groupLocalBranches(localBranches: Branch[]): LocalBranchGroup[] {
  const localGroupMap = new Map<string | null, Branch[]>();

  for (const branch of localBranches) {
    const slashIndex = branch.name.indexOf('/');
    const prefix = slashIndex > 0 ? branch.name.substring(0, slashIndex) : null;

    if (!localGroupMap.has(prefix)) {
      localGroupMap.set(prefix, []);
    }
    localGroupMap.get(prefix)!.push(branch);
  }

  const sortedPrefixes = Array.from(localGroupMap.keys()).sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b);
  });

  return sortedPrefixes.map((prefix) => ({
    prefix,
    displayName: prefix ?? 'Branches',
    branches: localGroupMap.get(prefix)!.sort((a, b) => {
      if (a.isHead) return -1;
      if (b.isHead) return 1;
      return a.name.localeCompare(b.name);
    }),
  }));
}

// Replicate isBranchStale logic from lv-branch-list.ts
function isBranchStale(branch: Branch, staleBranchDays: number): boolean {
  if (staleBranchDays === 0) return false;
  if (branch.isHead) return false;
  if (!branch.lastCommitTimestamp) return false;

  const nowSeconds = Date.now() / 1000;
  const staleThresholdSeconds = staleBranchDays * 24 * 60 * 60;

  return branch.lastCommitTimestamp < nowSeconds - staleThresholdSeconds;
}

describe('lv-branch-list - filterBranches', () => {
  const branches = [
    createBranch('main', { isHead: true }),
    createBranch('develop'),
    createBranch('feature/login'),
    createBranch('feature/signup'),
    createBranch('fix/typo'),
    createBranch('hotfix/crash'),
  ];

  it('returns all branches when filter text is empty', () => {
    const result = filterBranches(branches, '');
    expect(result.length).to.equal(6);
  });

  it('filters branches by name (case insensitive)', () => {
    const result = filterBranches(branches, 'feature');
    expect(result.length).to.equal(2);
    expect(result[0].name).to.equal('feature/login');
    expect(result[1].name).to.equal('feature/signup');
  });

  it('filters branches by partial match', () => {
    const result = filterBranches(branches, 'log');
    expect(result.length).to.equal(1);
    expect(result[0].name).to.equal('feature/login');
  });

  it('is case insensitive', () => {
    const result = filterBranches(branches, 'MAIN');
    expect(result.length).to.equal(1);
    expect(result[0].name).to.equal('main');
  });

  it('returns empty array when no branches match', () => {
    const result = filterBranches(branches, 'nonexistent');
    expect(result.length).to.equal(0);
  });

  it('matches against shorthand as well', () => {
    const remoteBranch = createBranch('origin/feature/login', { shorthand: 'feature/login', isRemote: true });
    const result = filterBranches([remoteBranch], 'login');
    expect(result.length).to.equal(1);
  });

  it('filters with prefix slash', () => {
    const result = filterBranches(branches, 'fix/');
    expect(result.length).to.equal(2);
    expect(result.map((b) => b.name)).to.include('fix/typo');
    expect(result.map((b) => b.name)).to.include('hotfix/crash');
  });

  it('handles single character filter', () => {
    const result = filterBranches(branches, 'm');
    // 'main' contains 'm'
    expect(result.length).to.be.greaterThan(0);
    expect(result.map((b) => b.name)).to.include('main');
  });
});

describe('lv-branch-list - sortBranches', () => {
  const now = Math.floor(Date.now() / 1000);
  const branches = [
    createBranch('develop', { lastCommitTimestamp: now - 3600 }), // 1 hour ago
    createBranch('main', { isHead: true, lastCommitTimestamp: now - 7200 }), // 2 hours ago
    createBranch('feature/alpha', { lastCommitTimestamp: now - 86400 }), // 1 day ago
    createBranch('feature/beta', { lastCommitTimestamp: now - 1800 }), // 30 min ago
    createBranch('fix/old-bug', { lastCommitTimestamp: now - 604800 }), // 1 week ago
  ];

  it('sorts by name alphabetically (default)', () => {
    const result = sortBranches(branches, 'name');
    // HEAD (main) should be first
    expect(result[0].name).to.equal('main');
    // Rest should be alphabetical
    expect(result[1].name).to.equal('develop');
    expect(result[2].name).to.equal('feature/alpha');
    expect(result[3].name).to.equal('feature/beta');
    expect(result[4].name).to.equal('fix/old-bug');
  });

  it('always puts HEAD branch first regardless of sort mode', () => {
    const resultName = sortBranches(branches, 'name');
    const resultDate = sortBranches(branches, 'date');
    const resultDateAsc = sortBranches(branches, 'date-asc');

    expect(resultName[0].isHead).to.be.true;
    expect(resultDate[0].isHead).to.be.true;
    expect(resultDateAsc[0].isHead).to.be.true;
  });

  it('sorts by date newest first', () => {
    const result = sortBranches(branches, 'date');
    expect(result[0].name).to.equal('main'); // HEAD
    expect(result[1].name).to.equal('feature/beta'); // 30 min ago (newest)
    expect(result[2].name).to.equal('develop'); // 1 hour ago
    expect(result[3].name).to.equal('feature/alpha'); // 1 day ago
    expect(result[4].name).to.equal('fix/old-bug'); // 1 week ago (oldest)
  });

  it('sorts by date oldest first', () => {
    const result = sortBranches(branches, 'date-asc');
    expect(result[0].name).to.equal('main'); // HEAD
    expect(result[1].name).to.equal('fix/old-bug'); // 1 week ago (oldest)
    expect(result[2].name).to.equal('feature/alpha'); // 1 day ago
    expect(result[3].name).to.equal('develop'); // 1 hour ago
    expect(result[4].name).to.equal('feature/beta'); // 30 min ago (newest)
  });

  it('handles branches without timestamps in date sort', () => {
    const branchesNoTimestamp = [
      createBranch('main', { isHead: true }),
      createBranch('feature/no-time'), // undefined timestamp treated as 0
      createBranch('develop', { lastCommitTimestamp: now }),
    ];
    const result = sortBranches(branchesNoTimestamp, 'date');
    expect(result[0].name).to.equal('main'); // HEAD
    expect(result[1].name).to.equal('develop'); // has timestamp
    expect(result[2].name).to.equal('feature/no-time'); // no timestamp (0)
  });

  it('preserves original array (immutable sort)', () => {
    const original = [...branches];
    sortBranches(branches, 'date');
    expect(branches.map((b) => b.name)).to.deep.equal(original.map((b) => b.name));
  });
});

describe('lv-branch-list - groupLocalBranches', () => {
  it('groups branches by prefix', () => {
    const branches = [
      createBranch('main', { isHead: true }),
      createBranch('develop'),
      createBranch('feature/login'),
      createBranch('feature/signup'),
      createBranch('fix/typo'),
    ];
    const groups = groupLocalBranches(branches);

    // Ungrouped (null prefix) comes first
    expect(groups[0].prefix).to.be.null;
    expect(groups[0].displayName).to.equal('Branches');
    expect(groups[0].branches.length).to.equal(2);
    expect(groups[0].branches[0].name).to.equal('main'); // HEAD first

    // Then alphabetically by prefix
    expect(groups[1].prefix).to.equal('feature');
    expect(groups[1].branches.length).to.equal(2);

    expect(groups[2].prefix).to.equal('fix');
    expect(groups[2].branches.length).to.equal(1);
  });

  it('puts ungrouped branches first', () => {
    const branches = [
      createBranch('feature/x'),
      createBranch('main'),
    ];
    const groups = groupLocalBranches(branches);
    expect(groups[0].prefix).to.be.null;
    expect(groups[0].branches[0].name).to.equal('main');
  });

  it('sorts prefixed groups alphabetically', () => {
    const branches = [
      createBranch('fix/bug'),
      createBranch('chore/cleanup'),
      createBranch('feature/new'),
    ];
    const groups = groupLocalBranches(branches);
    expect(groups[0].prefix).to.equal('chore');
    expect(groups[1].prefix).to.equal('feature');
    expect(groups[2].prefix).to.equal('fix');
  });

  it('handles branches with no prefix', () => {
    const branches = [
      createBranch('main', { isHead: true }),
      createBranch('develop'),
      createBranch('staging'),
    ];
    const groups = groupLocalBranches(branches);
    expect(groups.length).to.equal(1);
    expect(groups[0].prefix).to.be.null;
    expect(groups[0].branches.length).to.equal(3);
  });

  it('handles empty branch list', () => {
    const groups = groupLocalBranches([]);
    expect(groups.length).to.equal(0);
  });

  it('sorts HEAD branch first within groups', () => {
    const branches = [
      createBranch('feature/z'),
      createBranch('feature/a', { isHead: true }),
      createBranch('feature/m'),
    ];
    const groups = groupLocalBranches(branches);
    expect(groups[0].branches[0].name).to.equal('feature/a'); // HEAD first
    expect(groups[0].branches[1].name).to.equal('feature/m');
    expect(groups[0].branches[2].name).to.equal('feature/z');
  });

  it('handles single-branch groups', () => {
    const branches = [
      createBranch('feature/only-one'),
      createBranch('fix/only-fix'),
      createBranch('release/v1'),
    ];
    const groups = groupLocalBranches(branches);
    expect(groups.length).to.equal(3);
    groups.forEach((g) => {
      expect(g.branches.length).to.equal(1);
    });
  });

  it('handles deeply nested branch names (only first slash is prefix)', () => {
    const branches = [
      createBranch('feature/auth/login'),
      createBranch('feature/auth/signup'),
    ];
    const groups = groupLocalBranches(branches);
    expect(groups.length).to.equal(1);
    expect(groups[0].prefix).to.equal('feature');
    expect(groups[0].branches.length).to.equal(2);
  });
});

describe('lv-branch-list - isBranchStale', () => {
  const now = Math.floor(Date.now() / 1000);

  it('returns false when staleBranchDays is 0 (disabled)', () => {
    const branch = createBranch('old', { lastCommitTimestamp: now - 365 * 86400 });
    expect(isBranchStale(branch, 0)).to.be.false;
  });

  it('returns false for HEAD branch', () => {
    const branch = createBranch('main', {
      isHead: true,
      lastCommitTimestamp: now - 365 * 86400,
    });
    expect(isBranchStale(branch, 90)).to.be.false;
  });

  it('returns false for branch without timestamp', () => {
    const branch = createBranch('no-timestamp');
    expect(isBranchStale(branch, 90)).to.be.false;
  });

  it('returns true for branch older than threshold', () => {
    const branch = createBranch('old-branch', {
      lastCommitTimestamp: now - 100 * 86400, // 100 days ago
    });
    expect(isBranchStale(branch, 90)).to.be.true;
  });

  it('returns false for recent branch', () => {
    const branch = createBranch('recent', {
      lastCommitTimestamp: now - 30 * 86400, // 30 days ago
    });
    expect(isBranchStale(branch, 90)).to.be.false;
  });

  it('returns false for branch within threshold', () => {
    // Branch at 89 days ago is within the 90-day threshold
    const branch = createBranch('edge-case', {
      lastCommitTimestamp: now - 89 * 86400,
    });
    expect(isBranchStale(branch, 90)).to.be.false;
  });

  it('handles very small staleBranchDays', () => {
    const branch = createBranch('recent', {
      lastCommitTimestamp: now - 2 * 86400, // 2 days ago
    });
    expect(isBranchStale(branch, 1)).to.be.true;
  });
});

describe('lv-branch-list - filter + sort combined', () => {
  const now = Math.floor(Date.now() / 1000);
  const branches = [
    createBranch('main', { isHead: true, lastCommitTimestamp: now - 7200 }),
    createBranch('develop', { lastCommitTimestamp: now - 3600 }),
    createBranch('feature/login', { lastCommitTimestamp: now - 86400 }),
    createBranch('feature/signup', { lastCommitTimestamp: now - 1800 }),
    createBranch('fix/typo', { lastCommitTimestamp: now - 604800 }),
  ];

  it('filters then sorts by name', () => {
    const filtered = filterBranches(branches, 'feature');
    const sorted = sortBranches(filtered, 'name');
    expect(sorted.length).to.equal(2);
    expect(sorted[0].name).to.equal('feature/login');
    expect(sorted[1].name).to.equal('feature/signup');
  });

  it('filters then sorts by date (newest)', () => {
    const filtered = filterBranches(branches, 'feature');
    const sorted = sortBranches(filtered, 'date');
    expect(sorted.length).to.equal(2);
    expect(sorted[0].name).to.equal('feature/signup'); // 30 min ago
    expect(sorted[1].name).to.equal('feature/login'); // 1 day ago
  });

  it('HEAD is preserved through filter and sort', () => {
    const filtered = filterBranches(branches, 'main');
    const sorted = sortBranches(filtered, 'date');
    expect(sorted.length).to.equal(1);
    expect(sorted[0].isHead).to.be.true;
  });

  it('handles filter with no results', () => {
    const filtered = filterBranches(branches, 'nonexistent');
    const sorted = sortBranches(filtered, 'name');
    expect(sorted.length).to.equal(0);
  });
});

describe('lv-branch-list - hidden branches toggle', () => {
  it('can toggle branch visibility', () => {
    const hiddenBranches = new Set<string>();

    // Hide a branch
    hiddenBranches.add('feature/login');
    expect(hiddenBranches.has('feature/login')).to.be.true;

    // Unhide it
    hiddenBranches.delete('feature/login');
    expect(hiddenBranches.has('feature/login')).to.be.false;
  });

  it('supports multiple hidden branches', () => {
    const hiddenBranches = new Set<string>();
    hiddenBranches.add('feature/login');
    hiddenBranches.add('fix/typo');

    expect(hiddenBranches.has('feature/login')).to.be.true;
    expect(hiddenBranches.has('fix/typo')).to.be.true;
    expect(hiddenBranches.has('main')).to.be.false;
  });

  it('toggling hidden branch that is already hidden removes it', () => {
    const hiddenBranches = new Set<string>(['feature/login']);

    // Toggle
    if (hiddenBranches.has('feature/login')) {
      hiddenBranches.delete('feature/login');
    } else {
      hiddenBranches.add('feature/login');
    }

    expect(hiddenBranches.has('feature/login')).to.be.false;
  });
});

describe('lv-branch-list - expanded groups toggle', () => {
  it('toggles group expansion state', () => {
    const expandedGroups = new Set<string>(['local', 'local-ungrouped']);

    // Expand a remote group
    expandedGroups.add('remote-origin');
    expect(expandedGroups.has('remote-origin')).to.be.true;

    // Collapse it
    expandedGroups.delete('remote-origin');
    expect(expandedGroups.has('remote-origin')).to.be.false;
  });

  it('supports multiple independent group expansions', () => {
    const expandedGroups = new Set<string>(['local', 'remote-origin', 'local-feature']);

    expandedGroups.delete('remote-origin');
    expect(expandedGroups.has('local')).to.be.true;
    expect(expandedGroups.has('remote-origin')).to.be.false;
    expect(expandedGroups.has('local-feature')).to.be.true;
  });

  it('handles prefix-based group IDs', () => {
    const expandedGroups = new Set<string>();

    const prefixes = ['feature', 'fix', 'hotfix', 'release'];
    for (const prefix of prefixes) {
      expandedGroups.add(`local-${prefix}`);
    }

    expect(expandedGroups.size).to.equal(4);
    expect(expandedGroups.has('local-feature')).to.be.true;
    expect(expandedGroups.has('local-fix')).to.be.true;
    expect(expandedGroups.has('local-hotfix')).to.be.true;
    expect(expandedGroups.has('local-release')).to.be.true;
  });
});
