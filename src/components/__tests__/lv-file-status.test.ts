import { expect } from '@open-wc/testing';
import type { StatusEntry, FileStatus } from '../../types/git.types.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Replicate the tree node type used by the component
interface TreeNode {
  file?: StatusEntry;
  children: Map<string, TreeNode>;
}

// Helper: create a StatusEntry for testing
function createEntry(
  path: string,
  status: FileStatus = 'modified',
  isStaged = false,
): StatusEntry {
  return { path, status, isStaged, isConflicted: false };
}

// Replicate buildFileTree logic from lv-file-status.ts
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

// Replicate countTreeNodeFiles logic from lv-file-status.ts
function countTreeNodeFiles(node: TreeNode): number {
  if (node.file) return 1;
  let count = 0;
  for (const child of node.children.values()) {
    count += countTreeNodeFiles(child);
  }
  return count;
}

// Replicate getFilesUnderPath logic from lv-file-status.ts
function getFilesUnderPath(
  files: StatusEntry[],
  dirPath: string,
): StatusEntry[] {
  const prefix = dirPath + '/';
  return files.filter((f) => f.path.startsWith(prefix) || f.path === dirPath);
}

// Replicate getFileNameAndDir logic from lv-file-status.ts
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

// Replicate getStatusLabel logic from lv-file-status.ts
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

// Replicate collectVisibleFromNode logic for tree keyboard navigation
function collectVisibleTreeFiles(
  sectionFiles: StatusEntry[],
  expandedFolders: Set<string>,
): StatusEntry[] {
  const result: StatusEntry[] = [];
  const tree = buildFileTree(sectionFiles);
  collectVisibleFromNode(tree, '', result, expandedFolders);
  return result;
}

function collectVisibleFromNode(
  children: Map<string, TreeNode>,
  parentPath: string,
  result: StatusEntry[],
  expandedFolders: Set<string>,
): void {
  for (const [name, node] of children.entries()) {
    const nodePath = parentPath ? `${parentPath}/${name}` : name;
    if (node.file) {
      result.push(node.file);
    } else {
      // It's a folder - only recurse if expanded
      if (expandedFolders.has(nodePath)) {
        collectVisibleFromNode(node.children, nodePath, result, expandedFolders);
      }
    }
  }
}

describe('lv-file-status - buildFileTree', () => {
  it('builds an empty tree from no files', () => {
    const tree = buildFileTree([]);
    expect(tree.size).to.equal(0);
  });

  it('builds a flat tree from root-level files', () => {
    const files = [
      createEntry('README.md'),
      createEntry('package.json'),
    ];
    const tree = buildFileTree(files);
    expect(tree.size).to.equal(2);
    expect(tree.has('README.md')).to.be.true;
    expect(tree.has('package.json')).to.be.true;
    expect(tree.get('README.md')!.file).to.exist;
    expect(tree.get('package.json')!.file).to.exist;
  });

  it('builds a nested tree from files in subdirectories', () => {
    const files = [
      createEntry('src/index.ts'),
      createEntry('src/utils/helper.ts'),
    ];
    const tree = buildFileTree(files);
    expect(tree.size).to.equal(1);
    expect(tree.has('src')).to.be.true;

    const srcNode = tree.get('src')!;
    expect(srcNode.file).to.be.undefined;
    expect(srcNode.children.size).to.equal(2);
    expect(srcNode.children.has('index.ts')).to.be.true;
    expect(srcNode.children.has('utils')).to.be.true;

    const utilsNode = srcNode.children.get('utils')!;
    expect(utilsNode.children.has('helper.ts')).to.be.true;
    expect(utilsNode.children.get('helper.ts')!.file).to.exist;
  });

  it('groups files from the same directory together', () => {
    const files = [
      createEntry('src/a.ts'),
      createEntry('src/b.ts'),
      createEntry('src/c.ts'),
    ];
    const tree = buildFileTree(files);
    expect(tree.size).to.equal(1);
    const srcNode = tree.get('src')!;
    expect(srcNode.children.size).to.equal(3);
  });

  it('handles deeply nested paths', () => {
    const files = [createEntry('a/b/c/d/e.ts')];
    const tree = buildFileTree(files);
    expect(tree.has('a')).to.be.true;
    const aNode = tree.get('a')!;
    const bNode = aNode.children.get('b')!;
    const cNode = bNode.children.get('c')!;
    const dNode = cNode.children.get('d')!;
    expect(dNode.children.has('e.ts')).to.be.true;
    expect(dNode.children.get('e.ts')!.file!.path).to.equal('a/b/c/d/e.ts');
  });
});

describe('lv-file-status - countTreeNodeFiles', () => {
  it('returns 1 for a file node', () => {
    const node: TreeNode = {
      file: createEntry('test.ts'),
      children: new Map(),
    };
    expect(countTreeNodeFiles(node)).to.equal(1);
  });

  it('returns 0 for an empty folder', () => {
    const node: TreeNode = { children: new Map() };
    expect(countTreeNodeFiles(node)).to.equal(0);
  });

  it('counts files in nested folders', () => {
    const files = [
      createEntry('src/a.ts'),
      createEntry('src/b.ts'),
      createEntry('src/utils/c.ts'),
    ];
    const tree = buildFileTree(files);
    const srcNode = tree.get('src')!;
    expect(countTreeNodeFiles(srcNode)).to.equal(3);
  });

  it('counts files across multiple directories', () => {
    const files = [
      createEntry('src/index.ts'),
      createEntry('lib/util.ts'),
      createEntry('README.md'),
    ];
    const tree = buildFileTree(files);
    // Count from root level - each root entry
    let totalCount = 0;
    for (const node of tree.values()) {
      totalCount += countTreeNodeFiles(node);
    }
    expect(totalCount).to.equal(3);
  });
});

describe('lv-file-status - getFilesUnderPath', () => {
  const files = [
    createEntry('src/index.ts'),
    createEntry('src/utils/helper.ts'),
    createEntry('src/utils/format.ts'),
    createEntry('lib/core.ts'),
    createEntry('README.md'),
  ];

  it('returns files matching directory prefix', () => {
    const result = getFilesUnderPath(files, 'src');
    expect(result.length).to.equal(3);
    expect(result.map((f) => f.path)).to.include('src/index.ts');
    expect(result.map((f) => f.path)).to.include('src/utils/helper.ts');
    expect(result.map((f) => f.path)).to.include('src/utils/format.ts');
  });

  it('returns files in a subdirectory', () => {
    const result = getFilesUnderPath(files, 'src/utils');
    expect(result.length).to.equal(2);
    expect(result.map((f) => f.path)).to.include('src/utils/helper.ts');
    expect(result.map((f) => f.path)).to.include('src/utils/format.ts');
  });

  it('returns empty array for non-matching prefix', () => {
    const result = getFilesUnderPath(files, 'test');
    expect(result.length).to.equal(0);
  });

  it('does not match partial directory names', () => {
    // "sr" should not match "src/..."
    const result = getFilesUnderPath(files, 'sr');
    expect(result.length).to.equal(0);
  });

  it('returns files from lib directory', () => {
    const result = getFilesUnderPath(files, 'lib');
    expect(result.length).to.equal(1);
    expect(result[0].path).to.equal('lib/core.ts');
  });
});

describe('lv-file-status - getFileNameAndDir', () => {
  it('returns name only for root-level files', () => {
    const { name, dir } = getFileNameAndDir('README.md');
    expect(name).to.equal('README.md');
    expect(dir).to.equal('');
  });

  it('returns name and dir for nested files', () => {
    const { name, dir } = getFileNameAndDir('src/utils/helper.ts');
    expect(name).to.equal('helper.ts');
    expect(dir).to.equal('src/utils');
  });

  it('handles single-level nesting', () => {
    const { name, dir } = getFileNameAndDir('src/index.ts');
    expect(name).to.equal('index.ts');
    expect(dir).to.equal('src');
  });
});

describe('lv-file-status - getStatusLabel', () => {
  it('returns A for new files', () => {
    expect(getStatusLabel('new')).to.equal('A');
  });

  it('returns M for modified files', () => {
    expect(getStatusLabel('modified')).to.equal('M');
  });

  it('returns D for deleted files', () => {
    expect(getStatusLabel('deleted')).to.equal('D');
  });

  it('returns R for renamed files', () => {
    expect(getStatusLabel('renamed')).to.equal('R');
  });

  it('returns C for copied files', () => {
    expect(getStatusLabel('copied')).to.equal('C');
  });

  it('returns ? for untracked files', () => {
    expect(getStatusLabel('untracked')).to.equal('?');
  });

  it('returns ! for conflicted files', () => {
    expect(getStatusLabel('conflicted')).to.equal('!');
  });

  it('returns T for typechange files', () => {
    expect(getStatusLabel('typechange')).to.equal('T');
  });

  it('returns I for ignored files', () => {
    expect(getStatusLabel('ignored')).to.equal('I');
  });
});

describe('lv-file-status - tree view keyboard navigation (visible files)', () => {
  const files = [
    createEntry('src/index.ts'),
    createEntry('src/utils/helper.ts'),
    createEntry('lib/core.ts'),
    createEntry('README.md'),
  ];

  it('returns all files when all folders are expanded', () => {
    const expanded = new Set(['src', 'src/utils', 'lib']);
    const visible = collectVisibleTreeFiles(files, expanded);
    expect(visible.length).to.equal(4);
  });

  it('hides files in collapsed folders', () => {
    const expanded = new Set(['lib']); // src is collapsed
    const visible = collectVisibleTreeFiles(files, expanded);
    // Only lib/core.ts and README.md should be visible
    expect(visible.length).to.equal(2);
    expect(visible.map((f) => f.path)).to.include('lib/core.ts');
    expect(visible.map((f) => f.path)).to.include('README.md');
  });

  it('hides files in collapsed sub-folders', () => {
    const expanded = new Set(['src', 'lib']); // src/utils is collapsed
    const visible = collectVisibleTreeFiles(files, expanded);
    // src/index.ts, lib/core.ts, and README.md should be visible
    expect(visible.length).to.equal(3);
    expect(visible.map((f) => f.path)).to.include('src/index.ts');
    expect(visible.map((f) => f.path)).to.include('lib/core.ts');
    expect(visible.map((f) => f.path)).to.include('README.md');
  });

  it('returns only root-level files when no folders are expanded', () => {
    const expanded = new Set<string>();
    const visible = collectVisibleTreeFiles(files, expanded);
    // Only README.md is at root level
    expect(visible.length).to.equal(1);
    expect(visible[0].path).to.equal('README.md');
  });

  it('handles empty file list', () => {
    const expanded = new Set<string>();
    const visible = collectVisibleTreeFiles([], expanded);
    expect(visible.length).to.equal(0);
  });
});

describe('lv-file-status - view mode toggle logic', () => {
  it('should toggle between flat and tree modes', () => {
    let viewMode: 'flat' | 'tree' = 'flat';
    viewMode = viewMode === 'flat' ? 'tree' : 'flat';
    expect(viewMode).to.equal('tree');
    viewMode = viewMode === 'flat' ? 'tree' : 'flat';
    expect(viewMode).to.equal('flat');
  });

  it('should collect all folder paths when switching to tree view', () => {
    const files = [
      createEntry('src/index.ts'),
      createEntry('src/utils/helper.ts'),
      createEntry('src/utils/format.ts'),
      createEntry('lib/core.ts'),
    ];

    const allFolders = new Set<string>();
    for (const file of files) {
      const parts = file.path.split('/');
      let path = '';
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        allFolders.add(path);
      }
    }

    expect(allFolders.has('src')).to.be.true;
    expect(allFolders.has('src/utils')).to.be.true;
    expect(allFolders.has('lib')).to.be.true;
    expect(allFolders.size).to.equal(3);
  });
});

describe('lv-file-status - folder collapse/expand', () => {
  it('should toggle folder expansion state', () => {
    const expandedFolders = new Set<string>();

    // Expand a folder
    expandedFolders.add('src');
    expect(expandedFolders.has('src')).to.be.true;

    // Collapse it
    expandedFolders.delete('src');
    expect(expandedFolders.has('src')).to.be.false;
  });

  it('should support multiple expanded folders independently', () => {
    const expandedFolders = new Set(['src', 'lib']);
    expect(expandedFolders.has('src')).to.be.true;
    expect(expandedFolders.has('lib')).to.be.true;

    expandedFolders.delete('src');
    expect(expandedFolders.has('src')).to.be.false;
    expect(expandedFolders.has('lib')).to.be.true;
  });
});

describe('lv-file-status - directory stage/unstage operations', () => {
  it('identifies files under a directory for staging', () => {
    const unstagedFiles = [
      createEntry('src/a.ts', 'modified', false),
      createEntry('src/b.ts', 'modified', false),
      createEntry('lib/c.ts', 'modified', false),
    ];

    const filesToStage = getFilesUnderPath(unstagedFiles, 'src');
    expect(filesToStage.length).to.equal(2);
    const paths = filesToStage.map((f) => f.path);
    expect(paths).to.include('src/a.ts');
    expect(paths).to.include('src/b.ts');
  });

  it('identifies files under a directory for unstaging', () => {
    const stagedFiles = [
      createEntry('src/a.ts', 'modified', true),
      createEntry('src/b.ts', 'new', true),
      createEntry('lib/c.ts', 'modified', true),
    ];

    const filesToUnstage = getFilesUnderPath(stagedFiles, 'src');
    expect(filesToUnstage.length).to.equal(2);
    const paths = filesToUnstage.map((f) => f.path);
    expect(paths).to.include('src/a.ts');
    expect(paths).to.include('src/b.ts');
  });

  it('does not include files from sibling directories', () => {
    const files = [
      createEntry('src-tauri/main.rs', 'modified', false),
      createEntry('src/index.ts', 'modified', false),
    ];

    const result = getFilesUnderPath(files, 'src');
    expect(result.length).to.equal(1);
    expect(result[0].path).to.equal('src/index.ts');
  });
});
