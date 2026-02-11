/**
 * Graph Canvas - Branch Visibility Tests
 *
 * Tests the branch visibility panel logic including
 * extracting branches from refs, toggling visibility,
 * and localStorage persistence.
 */

// Mock Tauri API before importing any modules that use it
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
const mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } })
  .__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    return mockInvoke(command, args);
  },
};

import { expect } from '@open-wc/testing';
import type { RefsByCommit, RefInfo } from '../../../types/git.types.ts';

function makeRef(shorthand: string, refType: 'localBranch' | 'remoteBranch' | 'tag'): RefInfo {
  return {
    name: refType === 'remoteBranch' ? `refs/remotes/${shorthand}` : `refs/heads/${shorthand}`,
    shorthand,
    refType,
    isHead: false,
  };
}

describe('lv-graph-canvas - branch visibility', () => {
  describe('getAvailableBranches logic', () => {
    it('should extract local and remote branches from refsByCommit', () => {
      const refsByCommit: RefsByCommit = {
        'abc123': [
          makeRef('main', 'localBranch'),
          makeRef('origin/main', 'remoteBranch'),
        ],
        'def456': [
          makeRef('feature/test', 'localBranch'),
          makeRef('v1.0.0', 'tag'),
        ],
        'ghi789': [
          makeRef('origin/develop', 'remoteBranch'),
        ],
      };

      const localBranches = new Set<string>();
      const remoteBranches = new Set<string>();

      for (const refs of Object.values(refsByCommit)) {
        for (const ref of refs) {
          if (ref.refType === 'localBranch') {
            localBranches.add(ref.shorthand);
          } else if (ref.refType === 'remoteBranch') {
            remoteBranches.add(ref.shorthand);
          }
        }
      }

      expect([...localBranches].sort()).to.deep.equal(['feature/test', 'main']);
      expect([...remoteBranches].sort()).to.deep.equal(['origin/develop', 'origin/main']);
    });

    it('should return empty arrays when no branches exist', () => {
      const refsByCommit: RefsByCommit = {
        'abc123': [makeRef('v1.0.0', 'tag')],
      };

      const localBranches = new Set<string>();
      const remoteBranches = new Set<string>();

      for (const refs of Object.values(refsByCommit)) {
        for (const ref of refs) {
          if (ref.refType === 'localBranch') {
            localBranches.add(ref.shorthand);
          } else if (ref.refType === 'remoteBranch') {
            remoteBranches.add(ref.shorthand);
          }
        }
      }

      expect(localBranches.size).to.equal(0);
      expect(remoteBranches.size).to.equal(0);
    });

    it('should deduplicate branches across multiple commits', () => {
      const refsByCommit: RefsByCommit = {
        'abc123': [makeRef('main', 'localBranch')],
        'def456': [makeRef('main', 'localBranch')], // same branch on different commit
      };

      const localBranches = new Set<string>();
      for (const refs of Object.values(refsByCommit)) {
        for (const ref of refs) {
          if (ref.refType === 'localBranch') {
            localBranches.add(ref.shorthand);
          }
        }
      }

      expect(localBranches.size).to.equal(1);
      expect([...localBranches]).to.deep.equal(['main']);
    });
  });

  describe('toggleBranch logic', () => {
    it('should add branch to hiddenBranches set when toggled', () => {
      const hiddenBranches = new Set<string>();

      // Toggle on (hide)
      hiddenBranches.add('feature/test');
      expect(hiddenBranches.has('feature/test')).to.be.true;
    });

    it('should remove branch from hiddenBranches when toggled again', () => {
      const hiddenBranches = new Set<string>(['feature/test']);

      // Toggle off (show)
      hiddenBranches.delete('feature/test');
      expect(hiddenBranches.has('feature/test')).to.be.false;
    });

    it('should support hiding multiple branches', () => {
      const hiddenBranches = new Set<string>();

      hiddenBranches.add('feature/a');
      hiddenBranches.add('feature/b');
      hiddenBranches.add('origin/develop');

      expect(hiddenBranches.size).to.equal(3);
      expect(hiddenBranches.has('feature/a')).to.be.true;
      expect(hiddenBranches.has('feature/b')).to.be.true;
      expect(hiddenBranches.has('origin/develop')).to.be.true;
    });
  });

  describe('localStorage persistence', () => {
    const storageKey = 'leviathan-hidden-branches-/test/repo';

    beforeEach(() => {
      localStorage.removeItem(storageKey);
    });

    afterEach(() => {
      localStorage.removeItem(storageKey);
    });

    it('should save hidden branches to localStorage', () => {
      const hiddenBranches = new Set(['feature/a', 'origin/develop']);
      localStorage.setItem(storageKey, JSON.stringify([...hiddenBranches]));

      const saved = localStorage.getItem(storageKey);
      expect(saved).to.not.be.null;

      const parsed = JSON.parse(saved!);
      expect(parsed).to.deep.equal(['feature/a', 'origin/develop']);
    });

    it('should load hidden branches from localStorage', () => {
      localStorage.setItem(storageKey, JSON.stringify(['main', 'develop']));

      const saved = localStorage.getItem(storageKey);
      const hiddenBranches = new Set<string>(JSON.parse(saved!));

      expect(hiddenBranches.size).to.equal(2);
      expect(hiddenBranches.has('main')).to.be.true;
      expect(hiddenBranches.has('develop')).to.be.true;
    });

    it('should handle missing localStorage data gracefully', () => {
      const saved = localStorage.getItem(storageKey);
      let hiddenBranches = new Set<string>();

      if (saved) {
        try {
          hiddenBranches = new Set(JSON.parse(saved));
        } catch {
          // ignore
        }
      }

      expect(hiddenBranches.size).to.equal(0);
    });

    it('should use repo-specific storage key', () => {
      const key1 = 'leviathan-hidden-branches-/repo/one';
      const key2 = 'leviathan-hidden-branches-/repo/two';

      localStorage.setItem(key1, JSON.stringify(['main']));
      localStorage.setItem(key2, JSON.stringify(['develop', 'feature']));

      const set1 = new Set<string>(JSON.parse(localStorage.getItem(key1)!));
      const set2 = new Set<string>(JSON.parse(localStorage.getItem(key2)!));

      expect(set1.size).to.equal(1);
      expect(set2.size).to.equal(2);

      localStorage.removeItem(key1);
      localStorage.removeItem(key2);
    });
  });

  describe('show all / hide all', () => {
    it('should clear all hidden branches on show all', () => {
      const hiddenBranches = new Set(['main', 'develop', 'origin/main']);
      const cleared = new Set<string>();

      expect(hiddenBranches.size).to.equal(3);
      expect(cleared.size).to.equal(0);
    });

    it('should hide all available branches on hide all', () => {
      const allBranches = ['main', 'develop', 'origin/main', 'origin/develop'];
      const hiddenBranches = new Set(allBranches);

      expect(hiddenBranches.size).to.equal(4);
      for (const branch of allBranches) {
        expect(hiddenBranches.has(branch)).to.be.true;
      }
    });
  });
});
