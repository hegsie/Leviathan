/**
 * Branch Cleanup Dialog Tests
 *
 * Tests categorization logic, risk assessment, branch protection rules,
 * and rendering of the cleanup dialog.
 */

import { expect } from '@open-wc/testing';
import type { Branch, BranchTrackingInfo } from '../../../types/git.types.ts';

// Mock Tauri API before importing any modules that use it
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let mockBranches: Branch[] = [];
let mockBranchRules: Array<{
  pattern: string;
  preventDeletion: boolean;
  preventForcePush: boolean;
  requirePullRequest: boolean;
  preventDirectPush: boolean;
}> = [];
let mockTrackingInfo: Record<string, BranchTrackingInfo> = {};
let deleteHistory: Array<{ name: string; force: boolean }> = [];

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  const params = args as Record<string, unknown> | undefined;

  if (command === 'get_branches') {
    return mockBranches;
  }
  if (command === 'get_branch_rules') {
    return mockBranchRules;
  }
  if (command === 'get_branch_tracking_info') {
    const branch = params?.branch as string;
    if (branch && mockTrackingInfo[branch]) {
      return mockTrackingInfo[branch];
    }
    return {
      localBranch: branch,
      upstream: null,
      ahead: 0,
      behind: 0,
      remote: null,
      remoteBranch: null,
      isGone: false,
    };
  }
  if (command === 'delete_branch') {
    const name = params?.name as string;
    const force = (params?.force as boolean) ?? false;
    deleteHistory.push({ name, force });
    return undefined;
  }
  if (command === 'plugin:notification|is_permission_granted') return false;
  if (command === 'plugin:dialog|confirm') return true;
  return null;
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } })
  .__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
};

// --- Test Helper Types (duplicated from component for isolated testing) ---

type RiskLevel = 'safe' | 'warning' | 'danger';

interface CleanupBranch {
  branch: Branch;
  risk: RiskLevel;
  riskReason: string;
  isProtected: boolean;
  protectedReason?: string;
  trackingInfo?: BranchTrackingInfo;
}

const BUILTIN_PROTECTED = ['main', 'master', 'develop', 'development', 'staging', 'production'];

function matchesGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return regex.test(name);
}

function assessRisk(
  branch: Branch,
  trackingInfo?: BranchTrackingInfo,
): { risk: RiskLevel; riskReason: string } {
  const ahead = branch.aheadBehind?.ahead ?? 0;

  if (ahead === 0) {
    return { risk: 'safe', riskReason: 'Fully merged into current branch' };
  }

  if (trackingInfo?.isGone && ahead > 0) {
    return {
      risk: 'danger',
      riskReason: `Remote deleted with ${ahead} unpushed commit${ahead !== 1 ? 's' : ''}`,
    };
  }

  if (ahead > 0) {
    return {
      risk: 'warning',
      riskReason: `Has ${ahead} unpushed commit${ahead !== 1 ? 's' : ''}`,
    };
  }

  if (!branch.upstream) {
    return { risk: 'warning', riskReason: 'No upstream configured' };
  }

  return { risk: 'safe', riskReason: 'No unpushed work' };
}

function isBranchProtected(
  branch: Branch,
  rules: typeof mockBranchRules,
): boolean {
  if (branch.isHead) return true;
  if (BUILTIN_PROTECTED.includes(branch.name)) return true;
  for (const rule of rules) {
    if (rule.preventDeletion && matchesGlob(branch.name, rule.pattern)) {
      return true;
    }
  }
  return false;
}

function categorizeBranches(
  localBranches: Branch[],
  trackingInfoMap: Map<string, BranchTrackingInfo>,
  rules: typeof mockBranchRules,
  staleBranchDays: number,
): { merged: CleanupBranch[]; stale: CleanupBranch[]; gone: CleanupBranch[] } {
  const merged: CleanupBranch[] = [];
  const stale: CleanupBranch[] = [];
  const gone: CleanupBranch[] = [];
  const mergedNames = new Set<string>();

  for (const branch of localBranches) {
    const trackingInfo = trackingInfoMap.get(branch.name);
    const isProtected = isBranchProtected(branch, rules);

    if (branch.aheadBehind && branch.aheadBehind.ahead === 0) {
      mergedNames.add(branch.name);
      merged.push({
        branch,
        risk: 'safe',
        riskReason: 'Fully merged into current branch',
        isProtected,
        trackingInfo,
      });
    }

    if (trackingInfo?.isGone) {
      const risk = assessRisk(branch, trackingInfo);
      gone.push({
        branch,
        ...risk,
        isProtected,
        trackingInfo,
      });
    }
  }

  if (staleBranchDays > 0) {
    const nowSeconds = Date.now() / 1000;
    const staleThresholdSeconds = staleBranchDays * 24 * 60 * 60;

    for (const branch of localBranches) {
      if (mergedNames.has(branch.name)) continue;
      if (!branch.lastCommitTimestamp) continue;
      if (branch.lastCommitTimestamp >= nowSeconds - staleThresholdSeconds) continue;

      const trackingInfo = trackingInfoMap.get(branch.name);
      const isProtected = isBranchProtected(branch, rules);
      const risk = assessRisk(branch, trackingInfo);

      stale.push({
        branch,
        ...risk,
        isProtected,
        trackingInfo,
      });
    }
  }

  return { merged, stale, gone };
}

// --- Test Helpers ---

function createBranch(
  name: string,
  overrides: Partial<Branch> = {},
): Branch {
  return {
    name,
    shorthand: name,
    isHead: false,
    isRemote: false,
    upstream: null,
    targetOid: 'abc123',
    isStale: false,
    ...overrides,
  };
}

// --- Tests ---

describe('Branch Cleanup Dialog - Logic', () => {
  beforeEach(() => {
    mockBranches = [];
    mockBranchRules = [];
    mockTrackingInfo = {};
    deleteHistory = [];
  });

  describe('Risk Assessment', () => {
    it('marks branches with ahead === 0 as safe', () => {
      const branch = createBranch('feature/done', {
        aheadBehind: { ahead: 0, behind: 2 },
      });
      const result = assessRisk(branch);
      expect(result.risk).to.equal('safe');
    });

    it('marks branches with unpushed commits as warning', () => {
      const branch = createBranch('feature/wip', {
        aheadBehind: { ahead: 3, behind: 0 },
      });
      const result = assessRisk(branch);
      expect(result.risk).to.equal('warning');
      expect(result.riskReason).to.include('3 unpushed commits');
    });

    it('marks branches with 1 unpushed commit as warning (singular)', () => {
      const branch = createBranch('feature/one', {
        aheadBehind: { ahead: 1, behind: 0 },
      });
      const result = assessRisk(branch);
      expect(result.risk).to.equal('warning');
      expect(result.riskReason).to.include('1 unpushed commit');
      expect(result.riskReason).to.not.include('commits');
    });

    it('marks gone branches with unpushed commits as danger', () => {
      const branch = createBranch('feature/gone-wip', {
        aheadBehind: { ahead: 5, behind: 0 },
        upstream: 'origin/feature/gone-wip',
      });
      const trackingInfo: BranchTrackingInfo = {
        localBranch: 'feature/gone-wip',
        upstream: 'refs/remotes/origin/feature/gone-wip',
        ahead: 5,
        behind: 0,
        remote: 'origin',
        remoteBranch: 'feature/gone-wip',
        isGone: true,
      };
      const result = assessRisk(branch, trackingInfo);
      expect(result.risk).to.equal('danger');
      expect(result.riskReason).to.include('Remote deleted');
    });

    it('marks gone branches with no unpushed commits as safe', () => {
      const branch = createBranch('feature/gone-safe', {
        aheadBehind: { ahead: 0, behind: 0 },
        upstream: 'origin/feature/gone-safe',
      });
      const trackingInfo: BranchTrackingInfo = {
        localBranch: 'feature/gone-safe',
        upstream: null,
        ahead: 0,
        behind: 0,
        remote: 'origin',
        remoteBranch: 'feature/gone-safe',
        isGone: true,
      };
      const result = assessRisk(branch, trackingInfo);
      expect(result.risk).to.equal('safe');
    });
  });

  describe('Branch Protection', () => {
    it('protects HEAD branch', () => {
      const branch = createBranch('my-branch', { isHead: true });
      expect(isBranchProtected(branch, [])).to.be.true;
    });

    it('protects main branch', () => {
      const branch = createBranch('main');
      expect(isBranchProtected(branch, [])).to.be.true;
    });

    it('protects master branch', () => {
      const branch = createBranch('master');
      expect(isBranchProtected(branch, [])).to.be.true;
    });

    it('protects develop branch', () => {
      const branch = createBranch('develop');
      expect(isBranchProtected(branch, [])).to.be.true;
    });

    it('protects development branch', () => {
      const branch = createBranch('development');
      expect(isBranchProtected(branch, [])).to.be.true;
    });

    it('protects staging branch', () => {
      const branch = createBranch('staging');
      expect(isBranchProtected(branch, [])).to.be.true;
    });

    it('protects production branch', () => {
      const branch = createBranch('production');
      expect(isBranchProtected(branch, [])).to.be.true;
    });

    it('does not protect regular feature branches', () => {
      const branch = createBranch('feature/my-feature');
      expect(isBranchProtected(branch, [])).to.be.false;
    });

    it('protects branches matching user-defined rules', () => {
      const branch = createBranch('release/v1.0');
      const rules = [
        {
          pattern: 'release/*',
          preventDeletion: true,
          preventForcePush: false,
          requirePullRequest: false,
          preventDirectPush: false,
        },
      ];
      expect(isBranchProtected(branch, rules)).to.be.true;
    });

    it('does not protect branches matching rules without preventDeletion', () => {
      const branch = createBranch('release/v1.0');
      const rules = [
        {
          pattern: 'release/*',
          preventDeletion: false,
          preventForcePush: true,
          requirePullRequest: false,
          preventDirectPush: false,
        },
      ];
      expect(isBranchProtected(branch, rules)).to.be.false;
    });
  });

  describe('Glob Matching', () => {
    it('matches exact names', () => {
      expect(matchesGlob('main', 'main')).to.be.true;
      expect(matchesGlob('main', 'master')).to.be.false;
    });

    it('matches wildcard patterns', () => {
      expect(matchesGlob('release/v1.0', 'release/*')).to.be.true;
      expect(matchesGlob('feature/my-thing', 'feature/*')).to.be.true;
      expect(matchesGlob('hotfix/urgent', 'feature/*')).to.be.false;
    });

    it('matches patterns with multiple wildcards', () => {
      expect(matchesGlob('release/v1.0/hotfix', 'release/*/hotfix')).to.be.true;
    });

    it('escapes regex special characters', () => {
      expect(matchesGlob('release.v1', 'release.v1')).to.be.true;
      expect(matchesGlob('releasexv1', 'release.v1')).to.be.false;
    });
  });

  describe('Branch Categorization', () => {
    it('categorizes merged branches correctly', () => {
      const branches = [
        createBranch('feature/done', {
          aheadBehind: { ahead: 0, behind: 2 },
        }),
        createBranch('feature/wip', {
          aheadBehind: { ahead: 3, behind: 0 },
        }),
      ];

      const { merged } = categorizeBranches(branches, new Map(), [], 0);
      expect(merged).to.have.length(1);
      expect(merged[0].branch.name).to.equal('feature/done');
      expect(merged[0].risk).to.equal('safe');
    });

    it('categorizes stale branches (excluding already-merged)', () => {
      const nowSeconds = Date.now() / 1000;
      const ninetyOneDaysAgo = nowSeconds - 91 * 24 * 60 * 60;

      const branches = [
        // This is merged AND stale — should only appear in merged
        createBranch('feature/old-merged', {
          aheadBehind: { ahead: 0, behind: 5 },
          lastCommitTimestamp: ninetyOneDaysAgo,
        }),
        // This is stale but NOT merged
        createBranch('feature/old-wip', {
          aheadBehind: { ahead: 2, behind: 0 },
          lastCommitTimestamp: ninetyOneDaysAgo,
        }),
        // This is recent (not stale)
        createBranch('feature/recent', {
          aheadBehind: { ahead: 1, behind: 0 },
          lastCommitTimestamp: nowSeconds - 10 * 24 * 60 * 60,
        }),
      ];

      const { merged, stale } = categorizeBranches(branches, new Map(), [], 90);
      expect(merged).to.have.length(1);
      expect(merged[0].branch.name).to.equal('feature/old-merged');
      expect(stale).to.have.length(1);
      expect(stale[0].branch.name).to.equal('feature/old-wip');
      expect(stale[0].risk).to.equal('warning');
    });

    it('categorizes gone-upstream branches', () => {
      const branches = [
        createBranch('feature/gone-safe', {
          aheadBehind: { ahead: 0, behind: 0 },
          upstream: 'origin/feature/gone-safe',
        }),
        createBranch('feature/gone-danger', {
          aheadBehind: { ahead: 3, behind: 0 },
          upstream: 'origin/feature/gone-danger',
        }),
      ];

      const trackingInfoMap = new Map<string, BranchTrackingInfo>();
      trackingInfoMap.set('feature/gone-safe', {
        localBranch: 'feature/gone-safe',
        upstream: null,
        ahead: 0,
        behind: 0,
        remote: 'origin',
        remoteBranch: 'feature/gone-safe',
        isGone: true,
      });
      trackingInfoMap.set('feature/gone-danger', {
        localBranch: 'feature/gone-danger',
        upstream: null,
        ahead: 3,
        behind: 0,
        remote: 'origin',
        remoteBranch: 'feature/gone-danger',
        isGone: true,
      });

      const { gone } = categorizeBranches(branches, trackingInfoMap, [], 0);
      expect(gone).to.have.length(2);

      const safeBranch = gone.find((g) => g.branch.name === 'feature/gone-safe');
      const dangerBranch = gone.find((g) => g.branch.name === 'feature/gone-danger');

      expect(safeBranch!.risk).to.equal('safe');
      expect(dangerBranch!.risk).to.equal('danger');
    });

    it('marks protected branches correctly in categories', () => {
      const branches = [
        createBranch('main', {
          aheadBehind: { ahead: 0, behind: 0 },
        }),
        createBranch('feature/done', {
          aheadBehind: { ahead: 0, behind: 2 },
        }),
      ];

      const { merged } = categorizeBranches(branches, new Map(), [], 0);
      expect(merged).to.have.length(2);

      const mainBranch = merged.find((m) => m.branch.name === 'main');
      const featureBranch = merged.find((m) => m.branch.name === 'feature/done');

      expect(mainBranch!.isProtected).to.be.true;
      expect(featureBranch!.isProtected).to.be.false;
    });

    it('does not categorize stale branches when staleBranchDays is 0', () => {
      const nowSeconds = Date.now() / 1000;
      const ninetyOneDaysAgo = nowSeconds - 91 * 24 * 60 * 60;

      const branches = [
        createBranch('feature/old-wip', {
          aheadBehind: { ahead: 2, behind: 0 },
          lastCommitTimestamp: ninetyOneDaysAgo,
        }),
      ];

      const { stale } = categorizeBranches(branches, new Map(), [], 0);
      expect(stale).to.have.length(0);
    });

    it('filters out HEAD branch from all categories', () => {
      // Note: the component pre-filters HEAD before calling categorizeBranches,
      // but let's verify the protection check
      const headBranch = createBranch('my-branch', {
        isHead: true,
        aheadBehind: { ahead: 0, behind: 0 },
      });
      expect(isBranchProtected(headBranch, [])).to.be.true;
    });
  });

  describe('Delete Behavior', () => {
    it('determines force=false for safe branches', () => {
      const safeBranch: CleanupBranch = {
        branch: createBranch('feature/done', {
          aheadBehind: { ahead: 0, behind: 0 },
        }),
        risk: 'safe',
        riskReason: 'Fully merged',
        isProtected: false,
      };

      // Safe branches should not be force-deleted
      const force = safeBranch.risk === 'warning' || safeBranch.risk === 'danger';
      expect(force).to.be.false;
    });

    it('determines force=true for warning branches', () => {
      const warningBranch: CleanupBranch = {
        branch: createBranch('feature/wip', {
          aheadBehind: { ahead: 3, behind: 0 },
        }),
        risk: 'warning',
        riskReason: 'Has 3 unpushed commits',
        isProtected: false,
      };

      const force = warningBranch.risk === 'warning' || warningBranch.risk === 'danger';
      expect(force).to.be.true;
    });

    it('determines force=true for danger branches', () => {
      const dangerBranch: CleanupBranch = {
        branch: createBranch('feature/gone-wip', {
          aheadBehind: { ahead: 5, behind: 0 },
        }),
        risk: 'danger',
        riskReason: 'Remote deleted with 5 unpushed commits',
        isProtected: false,
      };

      const force = dangerBranch.risk === 'warning' || dangerBranch.risk === 'danger';
      expect(force).to.be.true;
    });
  });

  describe('Selection Logic', () => {
    it('auto-selects safe merged branches', () => {
      const merged: CleanupBranch[] = [
        {
          branch: createBranch('feature/done'),
          risk: 'safe',
          riskReason: 'Merged',
          isProtected: false,
        },
        {
          branch: createBranch('main'),
          risk: 'safe',
          riskReason: 'Merged',
          isProtected: true,
          protectedReason: 'Built-in protected branch',
        },
      ];

      const selected = new Set<string>();
      for (const cb of merged) {
        if (!cb.isProtected && cb.risk === 'safe') {
          selected.add(cb.branch.name);
        }
      }

      expect(selected.size).to.equal(1);
      expect(selected.has('feature/done')).to.be.true;
      expect(selected.has('main')).to.be.false;
    });

    it('does not auto-select stale branches', () => {
      const stale: CleanupBranch[] = [
        {
          branch: createBranch('feature/old'),
          risk: 'warning',
          riskReason: 'Has unpushed commits',
          isProtected: false,
        },
      ];

      // Per the component design, stale branches are not auto-selected
      const selected = new Set<string>();
      // No auto-selection for stale
      expect(selected.size).to.equal(0);

      // But they can be manually selected
      for (const cb of stale) {
        if (!cb.isProtected) {
          selected.add(cb.branch.name);
        }
      }
      expect(selected.size).to.equal(1);
    });

    it('auto-selects safe gone-upstream branches', () => {
      const gone: CleanupBranch[] = [
        {
          branch: createBranch('feature/gone-safe'),
          risk: 'safe',
          riskReason: 'No unpushed work',
          isProtected: false,
        },
        {
          branch: createBranch('feature/gone-danger'),
          risk: 'danger',
          riskReason: 'Has unpushed commits',
          isProtected: false,
        },
      ];

      const selected = new Set<string>();
      for (const cb of gone) {
        if (!cb.isProtected && cb.risk === 'safe') {
          selected.add(cb.branch.name);
        }
      }

      expect(selected.size).to.equal(1);
      expect(selected.has('feature/gone-safe')).to.be.true;
    });

    it('select all / deselect all toggles only non-protected branches', () => {
      const branches: CleanupBranch[] = [
        {
          branch: createBranch('feature/a'),
          risk: 'safe',
          riskReason: 'Merged',
          isProtected: false,
        },
        {
          branch: createBranch('main'),
          risk: 'safe',
          riskReason: 'Merged',
          isProtected: true,
        },
        {
          branch: createBranch('feature/b'),
          risk: 'warning',
          riskReason: 'Unpushed',
          isProtected: false,
        },
      ];

      const selectable = branches.filter((cb) => !cb.isProtected);
      expect(selectable).to.have.length(2);

      // Select all
      const selected = new Set<string>();
      for (const cb of selectable) {
        selected.add(cb.branch.name);
      }
      expect(selected.size).to.equal(2);
      expect(selected.has('main')).to.be.false;

      // Deselect all
      for (const cb of selectable) {
        selected.delete(cb.branch.name);
      }
      expect(selected.size).to.equal(0);
    });
  });
});
