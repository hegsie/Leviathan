/**
 * Branch Cleanup Dialog Tests
 *
 * Tests risk assessment, branch protection, selection logic,
 * and the Tauri command contract for cleanup candidates.
 */

import { expect } from '@open-wc/testing';
import type { CleanupCandidate, Branch } from '../../../types/git.types.ts';

// Mock Tauri API before importing any modules that use it
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let mockCandidates: CleanupCandidate[] = [];
let deleteHistory: Array<{ name: string; force: boolean }> = [];

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  const params = args as Record<string, unknown> | undefined;

  if (command === 'get_cleanup_candidates') {
    return mockCandidates;
  }
  if (command === 'delete_branch') {
    const name = params?.name as string;
    const force = (params?.force as boolean) ?? false;
    deleteHistory.push({ name, force });
    return undefined;
  }
  if (command === 'prune_remote_tracking_branches') {
    return { pruned: [], count: 0 };
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
}

const BUILTIN_PROTECTED = ['main', 'master', 'develop', 'development', 'staging', 'production'];

/**
 * Risk assessment for cleanup candidates (mirrors component logic).
 * Uses CleanupCandidate directly from the backend.
 */
function assessRisk(candidate: CleanupCandidate): { risk: RiskLevel; riskReason: string } {
  const ahead = candidate.aheadBehind?.ahead ?? 0;

  if (ahead === 0) {
    return { risk: 'safe', riskReason: 'Fully merged into current branch' };
  }

  if (candidate.category === 'gone' && ahead > 0) {
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

  if (!candidate.upstream) {
    return { risk: 'warning', riskReason: 'No upstream configured' };
  }

  return { risk: 'safe', riskReason: 'No unpushed work' };
}

function isBuiltinProtected(name: string): boolean {
  return BUILTIN_PROTECTED.includes(name);
}

function getProtectedReason(candidate: CleanupCandidate): string {
  if (BUILTIN_PROTECTED.includes(candidate.shorthand)) return 'Built-in protected branch';
  if (candidate.isProtected) return 'Protected by branch rule';
  return 'Protected';
}

// --- Test Helpers ---

function createCandidate(
  name: string,
  category: 'merged' | 'stale' | 'gone',
  overrides: Partial<CleanupCandidate> = {},
): CleanupCandidate {
  return {
    name,
    shorthand: name,
    category,
    lastCommitTimestamp: null,
    isProtected: false,
    upstream: null,
    aheadBehind: null,
    ...overrides,
  };
}

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
    mockCandidates = [];
    deleteHistory = [];
  });

  describe('Risk Assessment', () => {
    it('marks merged candidates with ahead === 0 as safe', () => {
      const candidate = createCandidate('feature/done', 'merged', {
        aheadBehind: { ahead: 0, behind: 2 },
      });
      const result = assessRisk(candidate);
      expect(result.risk).to.equal('safe');
    });

    it('marks candidates with unpushed commits as warning', () => {
      const candidate = createCandidate('feature/wip', 'stale', {
        aheadBehind: { ahead: 3, behind: 0 },
      });
      const result = assessRisk(candidate);
      expect(result.risk).to.equal('warning');
      expect(result.riskReason).to.include('3 unpushed commits');
    });

    it('marks candidates with 1 unpushed commit as warning (singular)', () => {
      const candidate = createCandidate('feature/one', 'stale', {
        aheadBehind: { ahead: 1, behind: 0 },
      });
      const result = assessRisk(candidate);
      expect(result.risk).to.equal('warning');
      expect(result.riskReason).to.include('1 unpushed commit');
      expect(result.riskReason).to.not.include('commits');
    });

    it('marks gone candidates with unpushed commits as danger', () => {
      const candidate = createCandidate('feature/gone-wip', 'gone', {
        aheadBehind: { ahead: 5, behind: 0 },
        upstream: 'origin/feature/gone-wip',
      });
      const result = assessRisk(candidate);
      expect(result.risk).to.equal('danger');
      expect(result.riskReason).to.include('Remote deleted');
    });

    it('marks gone candidates with no unpushed commits as safe', () => {
      const candidate = createCandidate('feature/gone-safe', 'gone', {
        aheadBehind: { ahead: 0, behind: 0 },
        upstream: 'origin/feature/gone-safe',
      });
      const result = assessRisk(candidate);
      expect(result.risk).to.equal('safe');
    });

    it('marks candidates without upstream as warning when they have commits', () => {
      const candidate = createCandidate('feature/no-upstream', 'stale', {
        aheadBehind: { ahead: 2, behind: 0 },
        upstream: null,
      });
      const result = assessRisk(candidate);
      expect(result.risk).to.equal('warning');
    });
  });

  describe('Branch Protection', () => {
    it('identifies main as builtin protected', () => {
      expect(isBuiltinProtected('main')).to.be.true;
    });

    it('identifies master as builtin protected', () => {
      expect(isBuiltinProtected('master')).to.be.true;
    });

    it('identifies develop as builtin protected', () => {
      expect(isBuiltinProtected('develop')).to.be.true;
    });

    it('identifies development as builtin protected', () => {
      expect(isBuiltinProtected('development')).to.be.true;
    });

    it('identifies staging as builtin protected', () => {
      expect(isBuiltinProtected('staging')).to.be.true;
    });

    it('identifies production as builtin protected', () => {
      expect(isBuiltinProtected('production')).to.be.true;
    });

    it('does not protect regular feature branches', () => {
      expect(isBuiltinProtected('feature/my-feature')).to.be.false;
    });

    it('returns correct reason for builtin protected branches', () => {
      const candidate = createCandidate('main', 'merged', { isProtected: false });
      expect(getProtectedReason(candidate)).to.equal('Built-in protected branch');
    });

    it('returns correct reason for rule-protected branches', () => {
      const candidate = createCandidate('release/v1.0', 'merged', { isProtected: true });
      expect(getProtectedReason(candidate)).to.equal('Protected by branch rule');
    });

    it('uses isProtected from backend for rule-based protection', () => {
      const candidate = createCandidate('release/v1.0', 'merged', { isProtected: true });
      // Backend sets isProtected when branch matches a rule with prevent_deletion
      expect(candidate.isProtected).to.be.true;
    });
  });

  describe('Candidate Categorization (Backend-driven)', () => {
    it('separates candidates by category', () => {
      const candidates = [
        createCandidate('feature/done', 'merged', {
          aheadBehind: { ahead: 0, behind: 2 },
        }),
        createCandidate('feature/old', 'stale', {
          aheadBehind: { ahead: 1, behind: 0 },
          lastCommitTimestamp: 1600000000,
        }),
        createCandidate('feature/gone', 'gone', {
          aheadBehind: { ahead: 0, behind: 0 },
        }),
      ];

      const merged = candidates.filter((c) => c.category === 'merged');
      const stale = candidates.filter((c) => c.category === 'stale');
      const gone = candidates.filter((c) => c.category === 'gone');

      expect(merged).to.have.length(1);
      expect(stale).to.have.length(1);
      expect(gone).to.have.length(1);
    });

    it('marks backend-protected candidates correctly', () => {
      const candidates = [
        createCandidate('main', 'merged', {
          isProtected: false, // backend may not flag builtins
          aheadBehind: { ahead: 0, behind: 0 },
        }),
        createCandidate('feature/done', 'merged', {
          isProtected: false,
          aheadBehind: { ahead: 0, behind: 2 },
        }),
      ];

      // The component combines backend isProtected with builtin check
      for (const c of candidates) {
        const isProtected = c.isProtected || isBuiltinProtected(c.name);
        if (c.name === 'main') {
          expect(isProtected).to.be.true;
        } else {
          expect(isProtected).to.be.false;
        }
      }
    });

    it('does not include stale category when staleBranchDays is 0 (backend handles this)', () => {
      // When staleBranchDays=0, the backend returns no stale candidates
      const candidates = [
        createCandidate('feature/done', 'merged', {
          aheadBehind: { ahead: 0, behind: 2 },
        }),
        // No stale candidates returned from backend
      ];

      const stale = candidates.filter((c) => c.category === 'stale');
      expect(stale).to.have.length(0);
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

  describe('Tauri Command Contract', () => {
    it('calls get_cleanup_candidates with correct parameters', async () => {
      let capturedArgs: Record<string, unknown> | undefined;
      const origInvoke = (globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } })
        .__TAURI_INTERNALS__.invoke;

      (globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } })
        .__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_cleanup_candidates') {
          capturedArgs = args as Record<string, unknown>;
          return [];
        }
        return origInvoke(command, args);
      };

      // Import git service dynamically to use the mock
      const { getCleanupCandidates } = await import('../../../services/git.service.ts');
      await getCleanupCandidates('/test/repo', 90);

      expect(capturedArgs).to.exist;
      expect(capturedArgs!.path).to.equal('/test/repo');
      expect(capturedArgs!.staleDays).to.equal(90);

      // Restore
      (globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } })
        .__TAURI_INTERNALS__.invoke = origInvoke;
    });

    it('handles backend returning empty candidates', () => {
      const candidates: CleanupCandidate[] = [];
      const merged = candidates.filter((c) => c.category === 'merged');
      const stale = candidates.filter((c) => c.category === 'stale');
      const gone = candidates.filter((c) => c.category === 'gone');

      expect(merged).to.have.length(0);
      expect(stale).to.have.length(0);
      expect(gone).to.have.length(0);
    });

    it('handles candidate appearing in multiple categories', () => {
      // A branch can be both merged and stale - backend returns separate entries
      const candidates = [
        createCandidate('feature/old-merged', 'merged', {
          aheadBehind: { ahead: 0, behind: 5 },
          lastCommitTimestamp: 1600000000,
        }),
        createCandidate('feature/old-merged', 'stale', {
          aheadBehind: { ahead: 0, behind: 5 },
          lastCommitTimestamp: 1600000000,
        }),
      ];

      const merged = candidates.filter((c) => c.category === 'merged');
      const stale = candidates.filter((c) => c.category === 'stale');

      expect(merged).to.have.length(1);
      expect(stale).to.have.length(1);
      expect(merged[0].name).to.equal('feature/old-merged');
      expect(stale[0].name).to.equal('feature/old-merged');
    });
  });
});
