import { expect } from '@open-wc/testing';
import type { Branch, StatusEntry, FileStatus } from '../git.types.ts';

/**
 * Tests for git types including stale branch detection
 */

describe('Git Types', () => {
  describe('Branch', () => {
    describe('isStale calculation', () => {
      const STALE_THRESHOLD_DAYS = 90;
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const SEC_PER_DAY = 24 * 60 * 60;

      function isStale(lastCommitTimestamp: number | undefined, isHead: boolean): boolean {
        if (isHead) return false; // Current branch is never stale
        if (!lastCommitTimestamp) return false;

        const now = Math.floor(Date.now() / 1000);
        const staleThreshold = now - STALE_THRESHOLD_DAYS * SEC_PER_DAY;
        return lastCommitTimestamp < staleThreshold;
      }

      it('should mark branch as stale if no commits in 90+ days', () => {
        const now = Math.floor(Date.now() / 1000);
        const lastCommit = now - 91 * SEC_PER_DAY; // 91 days ago

        expect(isStale(lastCommit, false)).to.be.true;
      });

      it('should not mark branch as stale if commits within 90 days', () => {
        const now = Math.floor(Date.now() / 1000);
        const lastCommit = now - 30 * SEC_PER_DAY; // 30 days ago

        expect(isStale(lastCommit, false)).to.be.false;
      });

      it('should not mark branch as stale at exactly 90 days', () => {
        const now = Math.floor(Date.now() / 1000);
        const lastCommit = now - 90 * SEC_PER_DAY; // Exactly 90 days

        // At exactly 90 days, not strictly less than threshold
        expect(isStale(lastCommit, false)).to.be.false;
      });

      it('should never mark HEAD branch as stale', () => {
        const now = Math.floor(Date.now() / 1000);
        const lastCommit = now - 365 * SEC_PER_DAY; // 1 year ago

        expect(isStale(lastCommit, true)).to.be.false;
      });

      it('should handle missing timestamp', () => {
        expect(isStale(undefined, false)).to.be.false;
      });
    });

    it('should have correct structure for local branch', () => {
      const branch: Branch = {
        name: 'feature/new-feature',
        shorthand: 'feature/new-feature',
        isHead: false,
        isRemote: false,
        upstream: 'origin/feature/new-feature',
        targetOid: 'abc123def456',
        aheadBehind: { ahead: 2, behind: 0 },
        lastCommitTimestamp: Math.floor(Date.now() / 1000),
        isStale: false,
      };

      expect(branch.isRemote).to.be.false;
      expect(branch.shorthand).to.equal('feature/new-feature');
      expect(branch.isStale).to.be.false;
    });

    it('should have correct structure for remote branch', () => {
      const branch: Branch = {
        name: 'origin/main',
        shorthand: 'main',
        isHead: false,
        isRemote: true,
        upstream: null,
        targetOid: 'abc123def456',
        aheadBehind: undefined,
        lastCommitTimestamp: Math.floor(Date.now() / 1000),
        isStale: false,
      };

      expect(branch.isRemote).to.be.true;
      expect(branch.shorthand).to.equal('main'); // Remote prefix stripped
      expect(branch.upstream).to.be.null;
    });

    it('should track ahead/behind counts', () => {
      const branch: Branch = {
        name: 'feature/behind-main',
        shorthand: 'feature/behind-main',
        isHead: true,
        isRemote: false,
        upstream: 'origin/feature/behind-main',
        targetOid: 'def456',
        aheadBehind: { ahead: 0, behind: 5 },
        lastCommitTimestamp: Math.floor(Date.now() / 1000),
        isStale: false,
      };

      expect(branch.aheadBehind).to.not.be.undefined;
      expect(branch.aheadBehind!.ahead).to.equal(0);
      expect(branch.aheadBehind!.behind).to.equal(5);
    });
  });

  describe('StatusEntry', () => {
    it('should have correct structure', () => {
      const entry: StatusEntry = {
        path: 'src/components/Button.tsx',
        status: 'modified',
        isStaged: true,
        isConflicted: false,
      };

      expect(entry.path).to.equal('src/components/Button.tsx');
      expect(entry.status).to.equal('modified');
      expect(entry.isStaged).to.be.true;
      expect(entry.isConflicted).to.be.false;
    });

    it('should represent untracked file', () => {
      const entry: StatusEntry = {
        path: 'new-file.txt',
        status: 'untracked',
        isStaged: false,
        isConflicted: false,
      };

      expect(entry.status).to.equal('untracked');
      expect(entry.isStaged).to.be.false;
    });

    it('should represent deleted file', () => {
      const entry: StatusEntry = {
        path: 'deleted-file.txt',
        status: 'deleted',
        isStaged: true,
        isConflicted: false,
      };

      expect(entry.status).to.equal('deleted');
    });

    it('should represent conflicted file', () => {
      const entry: StatusEntry = {
        path: 'conflicted.txt',
        status: 'conflicted',
        isStaged: false,
        isConflicted: true,
      };

      expect(entry.status).to.equal('conflicted');
      expect(entry.isConflicted).to.be.true;
    });

    it('should support all file statuses', () => {
      const statuses: FileStatus[] = [
        'new',
        'modified',
        'deleted',
        'renamed',
        'copied',
        'ignored',
        'untracked',
        'typechange',
        'conflicted',
      ];

      statuses.forEach((status) => {
        const entry: StatusEntry = {
          path: 'test.txt',
          status,
          isStaged: false,
          isConflicted: status === 'conflicted',
        };
        expect(entry.status).to.equal(status);
      });
    });
  });
});

describe('File Tree Building', () => {
  interface TreeNode {
    file?: StatusEntry;
    children: Map<string, TreeNode>;
  }

  function buildFileTree(files: StatusEntry[]): Map<string, TreeNode> {
    const root = new Map<string, TreeNode>();

    for (const file of files) {
      const parts = file.path.split('/');
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;

        if (!current.has(part)) {
          current.set(part, { children: new Map() });
        }

        const node = current.get(part)!;
        if (isFile) {
          node.file = file;
        }
        current = node.children;
      }
    }

    return root;
  }

  it('should build empty tree from empty list', () => {
    const tree = buildFileTree([]);
    expect(tree.size).to.equal(0);
  });

  it('should build tree with single file at root', () => {
    const files: StatusEntry[] = [
      { path: 'README.md', status: 'modified', isStaged: false, isConflicted: false },
    ];

    const tree = buildFileTree(files);
    expect(tree.size).to.equal(1);
    expect(tree.has('README.md')).to.be.true;
    expect(tree.get('README.md')!.file).to.not.be.undefined;
  });

  it('should build tree with nested files', () => {
    const files: StatusEntry[] = [
      { path: 'src/index.ts', status: 'modified', isStaged: true, isConflicted: false },
      { path: 'src/utils/helper.ts', status: 'new', isStaged: true, isConflicted: false },
    ];

    const tree = buildFileTree(files);
    expect(tree.has('src')).to.be.true;

    const srcNode = tree.get('src')!;
    expect(srcNode.children.has('index.ts')).to.be.true;
    expect(srcNode.children.has('utils')).to.be.true;

    const utilsNode = srcNode.children.get('utils')!;
    expect(utilsNode.children.has('helper.ts')).to.be.true;
  });

  it('should handle multiple files in same directory', () => {
    const files: StatusEntry[] = [
      { path: 'src/a.ts', status: 'modified', isStaged: false, isConflicted: false },
      { path: 'src/b.ts', status: 'modified', isStaged: false, isConflicted: false },
      { path: 'src/c.ts', status: 'new', isStaged: false, isConflicted: false },
    ];

    const tree = buildFileTree(files);
    const srcNode = tree.get('src')!;

    expect(srcNode.children.size).to.equal(3);
    expect(srcNode.children.has('a.ts')).to.be.true;
    expect(srcNode.children.has('b.ts')).to.be.true;
    expect(srcNode.children.has('c.ts')).to.be.true;
  });

  it('should handle deeply nested paths', () => {
    const files: StatusEntry[] = [
      { path: 'a/b/c/d/e/file.ts', status: 'modified', isStaged: false, isConflicted: false },
    ];

    const tree = buildFileTree(files);
    expect(tree.has('a')).to.be.true;

    let current = tree.get('a')!.children;
    expect(current.has('b')).to.be.true;
    current = current.get('b')!.children;
    expect(current.has('c')).to.be.true;
    current = current.get('c')!.children;
    expect(current.has('d')).to.be.true;
    current = current.get('d')!.children;
    expect(current.has('e')).to.be.true;
    current = current.get('e')!.children;
    expect(current.has('file.ts')).to.be.true;
  });
});

describe('Status Entry Comparison (Delta Updates)', () => {
  function areStatusEntriesEqual(a: StatusEntry[], b: StatusEntry[]): boolean {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      if (
        a[i].path !== b[i].path ||
        a[i].status !== b[i].status ||
        a[i].isStaged !== b[i].isStaged ||
        a[i].isConflicted !== b[i].isConflicted
      ) {
        return false;
      }
    }
    return true;
  }

  it('should detect equal lists', () => {
    const a: StatusEntry[] = [
      { path: 'file.ts', status: 'modified', isStaged: true, isConflicted: false },
    ];
    const b: StatusEntry[] = [
      { path: 'file.ts', status: 'modified', isStaged: true, isConflicted: false },
    ];

    expect(areStatusEntriesEqual(a, b)).to.be.true;
  });

  it('should detect different lengths', () => {
    const a: StatusEntry[] = [
      { path: 'file.ts', status: 'modified', isStaged: true, isConflicted: false },
    ];
    const b: StatusEntry[] = [];

    expect(areStatusEntriesEqual(a, b)).to.be.false;
  });

  it('should detect path difference', () => {
    const a: StatusEntry[] = [
      { path: 'file1.ts', status: 'modified', isStaged: true, isConflicted: false },
    ];
    const b: StatusEntry[] = [
      { path: 'file2.ts', status: 'modified', isStaged: true, isConflicted: false },
    ];

    expect(areStatusEntriesEqual(a, b)).to.be.false;
  });

  it('should detect status difference', () => {
    const a: StatusEntry[] = [
      { path: 'file.ts', status: 'modified', isStaged: true, isConflicted: false },
    ];
    const b: StatusEntry[] = [
      { path: 'file.ts', status: 'new', isStaged: true, isConflicted: false },
    ];

    expect(areStatusEntriesEqual(a, b)).to.be.false;
  });

  it('should detect staged difference', () => {
    const a: StatusEntry[] = [
      { path: 'file.ts', status: 'modified', isStaged: true, isConflicted: false },
    ];
    const b: StatusEntry[] = [
      { path: 'file.ts', status: 'modified', isStaged: false, isConflicted: false },
    ];

    expect(areStatusEntriesEqual(a, b)).to.be.false;
  });

  it('should detect conflicted difference', () => {
    const a: StatusEntry[] = [
      { path: 'file.ts', status: 'conflicted', isStaged: false, isConflicted: true },
    ];
    const b: StatusEntry[] = [
      { path: 'file.ts', status: 'conflicted', isStaged: false, isConflicted: false },
    ];

    expect(areStatusEntriesEqual(a, b)).to.be.false;
  });
});

describe('Status Label Mapping', () => {
  function getStatusLabel(status: FileStatus): string {
    const labels: Record<FileStatus, string> = {
      new: 'A',
      modified: 'M',
      deleted: 'D',
      renamed: 'R',
      copied: 'C',
      ignored: 'I',
      untracked: '?',
      typechange: 'T',
      conflicted: '!',
    };
    return labels[status] || '?';
  }

  it('should return correct labels for all statuses', () => {
    expect(getStatusLabel('new')).to.equal('A');
    expect(getStatusLabel('modified')).to.equal('M');
    expect(getStatusLabel('deleted')).to.equal('D');
    expect(getStatusLabel('renamed')).to.equal('R');
    expect(getStatusLabel('copied')).to.equal('C');
    expect(getStatusLabel('ignored')).to.equal('I');
    expect(getStatusLabel('untracked')).to.equal('?');
    expect(getStatusLabel('typechange')).to.equal('T');
    expect(getStatusLabel('conflicted')).to.equal('!');
  });
});

describe('File Path Parsing', () => {
  function getFileNameAndDir(path: string): { name: string; dir: string } {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) {
      return { name: path, dir: '' };
    }
    return {
      name: path.slice(lastSlash + 1),
      dir: path.slice(0, lastSlash),
    };
  }

  it('should parse root level file', () => {
    const result = getFileNameAndDir('README.md');
    expect(result.name).to.equal('README.md');
    expect(result.dir).to.equal('');
  });

  it('should parse nested file', () => {
    const result = getFileNameAndDir('src/components/Button.tsx');
    expect(result.name).to.equal('Button.tsx');
    expect(result.dir).to.equal('src/components');
  });

  it('should parse deeply nested file', () => {
    const result = getFileNameAndDir('src/components/forms/inputs/TextInput.tsx');
    expect(result.name).to.equal('TextInput.tsx');
    expect(result.dir).to.equal('src/components/forms/inputs');
  });
});
