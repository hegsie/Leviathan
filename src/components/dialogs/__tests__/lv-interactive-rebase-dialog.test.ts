import { expect } from '@open-wc/testing';
import type { RebaseAction } from '../../../types/git.types.ts';

// Mock Tauri API before importing any modules that use it
const mockRebaseCommits = [
  { oid: 'abc1234567890', shortId: 'abc1234', summary: 'Add feature A', action: 'pick' },
  { oid: 'def1234567890', shortId: 'def1234', summary: 'Fix bug in feature A', action: 'pick' },
  { oid: 'ghi1234567890', shortId: 'ghi1234', summary: 'Add feature B', action: 'pick' },
  { oid: 'jkl1234567890', shortId: 'jkl1234', summary: 'fixup! Add feature A', action: 'pick' },
  { oid: 'mno1234567890', shortId: 'mno1234', summary: 'squash! Add feature B', action: 'pick' },
];

const mockInvoke = (command: string): Promise<unknown> => {
  switch (command) {
    case 'get_rebase_commits':
      return Promise.resolve(mockRebaseCommits);
    case 'execute_interactive_rebase':
      return Promise.resolve(undefined);
    default:
      return Promise.resolve(null);
  }
};

// Mock the Tauri invoke function globally
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

interface EditableRebaseCommit {
  oid: string;
  shortId: string;
  summary: string;
  action: RebaseAction;
  newMessage?: string;
  originalIndex: number;
}

interface PreviewCommit {
  shortId: string;
  summary: string;
  isSquashed: boolean;
  isDropped: boolean;
  squashedFrom?: string[];
}

/**
 * Helper to create editable commits with default values
 */
function createEditableCommit(
  shortId: string,
  summary: string,
  action: RebaseAction = 'pick',
  originalIndex: number = 0,
  newMessage?: string
): EditableRebaseCommit {
  return {
    oid: `${shortId}00000000000`,
    shortId,
    summary,
    action,
    originalIndex,
    newMessage,
  };
}

/**
 * Generate preview of what commits will look like after rebase
 * This mirrors the logic in lv-interactive-rebase-dialog.ts
 */
function generatePreview(commits: EditableRebaseCommit[]): PreviewCommit[] {
  const preview: PreviewCommit[] = [];
  let i = 0;

  while (i < commits.length) {
    const commit = commits[i];

    if (commit.action === 'drop') {
      i++;
      continue;
    }

    const squashedFrom: string[] = [];
    let j = i + 1;
    while (j < commits.length &&
           (commits[j].action === 'squash' || commits[j].action === 'fixup')) {
      squashedFrom.push(commits[j].shortId);
      j++;
    }

    const summary = commit.action === 'reword' && commit.newMessage
      ? commit.newMessage.split('\n')[0]
      : commit.summary;

    preview.push({
      shortId: commit.shortId,
      summary,
      isSquashed: squashedFrom.length > 0,
      isDropped: false,
      squashedFrom: squashedFrom.length > 0 ? squashedFrom : undefined,
    });

    i = j > i + 1 ? j : i + 1;
  }

  return preview;
}

/**
 * Detect commits with fixup! or squash! prefixes
 */
function detectAutosquashCommits(commits: EditableRebaseCommit[]): boolean {
  return commits.some(
    c => c.summary.startsWith('fixup! ') || c.summary.startsWith('squash! ')
  );
}

/**
 * Apply autosquash: reorder and mark fixup!/squash! commits
 */
function applyAutosquash(commits: EditableRebaseCommit[]): EditableRebaseCommit[] {
  const newCommits: EditableRebaseCommit[] = [];
  const autosquashCommits: EditableRebaseCommit[] = [];

  for (const commit of commits) {
    if (commit.summary.startsWith('fixup! ') || commit.summary.startsWith('squash! ')) {
      autosquashCommits.push({ ...commit });
    } else {
      newCommits.push({ ...commit });
    }
  }

  for (const asCommit of autosquashCommits) {
    const isFixup = asCommit.summary.startsWith('fixup! ');
    const targetSummary = asCommit.summary.slice(isFixup ? 7 : 8);

    const targetIndex = newCommits.findIndex(c =>
      c.summary === targetSummary || c.summary.startsWith(targetSummary)
    );

    if (targetIndex !== -1) {
      asCommit.action = isFixup ? 'fixup' : 'squash';
      let insertIndex = targetIndex + 1;
      while (insertIndex < newCommits.length &&
             (newCommits[insertIndex].action === 'squash' ||
              newCommits[insertIndex].action === 'fixup')) {
        insertIndex++;
      }
      newCommits.splice(insertIndex, 0, asCommit);
    } else {
      newCommits.push(asCommit);
    }
  }

  return newCommits;
}

/**
 * Get statistics about the rebase operation
 */
function getStats(commits: EditableRebaseCommit[]): { kept: number; squashed: number; dropped: number; reworded: number } {
  let kept = 0;
  let squashed = 0;
  let dropped = 0;
  let reworded = 0;

  for (const commit of commits) {
    switch (commit.action) {
      case 'pick':
      case 'edit':
        kept++;
        break;
      case 'reword':
        reworded++;
        kept++;
        break;
      case 'squash':
      case 'fixup':
        squashed++;
        break;
      case 'drop':
        dropped++;
        break;
    }
  }

  return { kept, squashed, dropped, reworded };
}

describe('Interactive Rebase Dialog', () => {
  describe('Preview Generation', () => {
    it('should show all commits when all are pick', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Feature B', 'pick', 1),
        createEditableCommit('ghi1234', 'Feature C', 'pick', 2),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(3);
      expect(preview[0].shortId).to.equal('abc1234');
      expect(preview[1].shortId).to.equal('def1234');
      expect(preview[2].shortId).to.equal('ghi1234');
      expect(preview.every(p => !p.isSquashed)).to.be.true;
    });

    it('should hide dropped commits in preview', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Feature B', 'drop', 1),
        createEditableCommit('ghi1234', 'Feature C', 'pick', 2),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].shortId).to.equal('abc1234');
      expect(preview[1].shortId).to.equal('ghi1234');
    });

    it('should mark squashed commits correctly', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Fix for A', 'squash', 1),
        createEditableCommit('ghi1234', 'Feature B', 'pick', 2),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].isSquashed).to.be.true;
      expect(preview[0].squashedFrom).to.deep.equal(['def1234']);
      expect(preview[1].isSquashed).to.be.false;
    });

    it('should handle multiple squashed commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Fix 1', 'fixup', 1),
        createEditableCommit('ghi1234', 'Fix 2', 'squash', 2),
        createEditableCommit('jkl1234', 'Feature B', 'pick', 3),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].isSquashed).to.be.true;
      expect(preview[0].squashedFrom).to.deep.equal(['def1234', 'ghi1234']);
    });

    it('should use new message for reworded commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old message', 'reword', 0, 'New message'),
        createEditableCommit('def1234', 'Feature B', 'pick', 1),
      ];

      const preview = generatePreview(commits);

      expect(preview[0].summary).to.equal('New message');
      expect(preview[1].summary).to.equal('Feature B');
    });

    it('should handle all commits dropped', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'drop', 0),
        createEditableCommit('def1234', 'Feature B', 'drop', 1),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(0);
    });
  });

  describe('Autosquash Detection', () => {
    it('should detect fixup! commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'fixup! Feature A', 'pick', 1),
      ];

      expect(detectAutosquashCommits(commits)).to.be.true;
    });

    it('should detect squash! commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'squash! Feature A', 'pick', 1),
      ];

      expect(detectAutosquashCommits(commits)).to.be.true;
    });

    it('should return false when no autosquash commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Feature B', 'pick', 1),
      ];

      expect(detectAutosquashCommits(commits)).to.be.false;
    });
  });

  describe('Autosquash Application', () => {
    it('should reorder fixup! commits after their target', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Feature B', 'pick', 1),
        createEditableCommit('ghi1234', 'fixup! Feature A', 'pick', 2),
      ];

      const result = applyAutosquash(commits);

      expect(result).to.have.length(3);
      expect(result[0].shortId).to.equal('abc1234');
      expect(result[1].shortId).to.equal('ghi1234');
      expect(result[1].action).to.equal('fixup');
      expect(result[2].shortId).to.equal('def1234');
    });

    it('should reorder squash! commits after their target', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Feature B', 'pick', 1),
        createEditableCommit('ghi1234', 'squash! Feature A', 'pick', 2),
      ];

      const result = applyAutosquash(commits);

      expect(result).to.have.length(3);
      expect(result[0].shortId).to.equal('abc1234');
      expect(result[1].shortId).to.equal('ghi1234');
      expect(result[1].action).to.equal('squash');
      expect(result[2].shortId).to.equal('def1234');
    });

    it('should handle multiple autosquash commits for same target', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'fixup! Feature A', 'pick', 1),
        createEditableCommit('ghi1234', 'squash! Feature A', 'pick', 2),
      ];

      const result = applyAutosquash(commits);

      expect(result).to.have.length(3);
      expect(result[0].shortId).to.equal('abc1234');
      expect(result[1].shortId).to.equal('def1234');
      expect(result[1].action).to.equal('fixup');
      expect(result[2].shortId).to.equal('ghi1234');
      expect(result[2].action).to.equal('squash');
    });

    it('should keep autosquash commits at end if no target found', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'fixup! Unknown Feature', 'pick', 1),
      ];

      const result = applyAutosquash(commits);

      expect(result).to.have.length(2);
      expect(result[0].shortId).to.equal('abc1234');
      expect(result[1].shortId).to.equal('def1234');
      // Action stays as pick since no target found
      expect(result[1].action).to.equal('pick');
    });
  });

  describe('Statistics Calculation', () => {
    it('should count pick commits as kept', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Feature B', 'pick', 1),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(2);
      expect(stats.squashed).to.equal(0);
      expect(stats.dropped).to.equal(0);
      expect(stats.reworded).to.equal(0);
    });

    it('should count edit commits as kept', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'edit', 0),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(1);
    });

    it('should count reword commits as both kept and reworded', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'reword', 0),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(1);
      expect(stats.reworded).to.equal(1);
    });

    it('should count squash and fixup as squashed', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Fix 1', 'squash', 1),
        createEditableCommit('ghi1234', 'Fix 2', 'fixup', 2),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(1);
      expect(stats.squashed).to.equal(2);
    });

    it('should count dropped commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Remove me', 'drop', 1),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(1);
      expect(stats.dropped).to.equal(1);
    });

    it('should handle complex scenarios', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Feature B', 'reword', 1),
        createEditableCommit('ghi1234', 'Fix', 'squash', 2),
        createEditableCommit('jkl1234', 'Remove', 'drop', 3),
        createEditableCommit('mno1234', 'Edit this', 'edit', 4),
        createEditableCommit('pqr1234', 'Fixup', 'fixup', 5),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(3); // pick + reword + edit
      expect(stats.reworded).to.equal(1);
      expect(stats.squashed).to.equal(2); // squash + fixup
      expect(stats.dropped).to.equal(1);
    });
  });

  describe('RebaseAction Type', () => {
    it('should support all valid rebase actions', () => {
      const validActions: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

      expect(validActions).to.have.length(6);
      expect(validActions).to.include('pick');
      expect(validActions).to.include('reword');
      expect(validActions).to.include('edit');
      expect(validActions).to.include('squash');
      expect(validActions).to.include('fixup');
      expect(validActions).to.include('drop');
    });
  });

  describe('Todo File Generation', () => {
    /**
     * Generate todo file content matching the component logic
     * For reword with changed message, uses pick + exec git commit --amend
     */
    function generateTodo(commits: EditableRebaseCommit[]): string {
      const todoLines: string[] = [];

      for (const c of commits) {
        if (c.action === 'reword' && c.newMessage && c.newMessage !== c.summary) {
          // Use pick + exec to amend with new message
          todoLines.push(`pick ${c.shortId} ${c.summary}`);
          const escapedMessage = c.newMessage
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$')
            .replace(/`/g, '\\`');
          todoLines.push(`exec git commit --amend -m "${escapedMessage}"`);
        } else if (c.action === 'reword') {
          // Reword without message change - keep as pick
          todoLines.push(`pick ${c.shortId} ${c.summary}`);
        } else {
          todoLines.push(`${c.action} ${c.shortId} ${c.summary}`);
        }
      }

      return todoLines.join('\n');
    }

    it('should generate correct todo format for basic actions', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick', 0),
        createEditableCommit('def1234', 'Feature B', 'squash', 1),
        createEditableCommit('ghi1234', 'Feature C', 'drop', 2),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Feature A\n' +
        'squash def1234 Feature B\n' +
        'drop ghi1234 Feature C'
      );
    });

    it('should use pick + exec for reword with changed message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old message', 'reword', 0, 'New message'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old message\n' +
        'exec git commit --amend -m "New message"'
      );
    });

    it('should use pick for reword without message change', () => {
      const commits = [
        createEditableCommit('abc1234', 'Same message', 'reword', 0, 'Same message'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal('pick abc1234 Same message');
    });

    it('should use pick for reword without newMessage set', () => {
      const commits = [
        createEditableCommit('abc1234', 'Some message', 'reword', 0),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal('pick abc1234 Some message');
    });

    it('should escape special characters in reword message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 0, 'New "quoted" message'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        'exec git commit --amend -m "New \\"quoted\\" message"'
      );
    });

    it('should escape backslashes in reword message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 0, 'Path\\to\\file'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        'exec git commit --amend -m "Path\\\\to\\\\file"'
      );
    });

    it('should escape dollar signs in reword message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 0, 'Cost $100'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        'exec git commit --amend -m "Cost \\$100"'
      );
    });

    it('should escape backticks in reword message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 0, 'Use `code` here'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        'exec git commit --amend -m "Use \\`code\\` here"'
      );
    });

    it('should handle multiple reword commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'First', 'reword', 0, 'First reworded'),
        createEditableCommit('def1234', 'Second', 'pick', 1),
        createEditableCommit('ghi1234', 'Third', 'reword', 2, 'Third reworded'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 First\n' +
        'exec git commit --amend -m "First reworded"\n' +
        'pick def1234 Second\n' +
        'pick ghi1234 Third\n' +
        'exec git commit --amend -m "Third reworded"'
      );
    });

    it('should handle multiline reword messages', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 0, 'Line 1\nLine 2\nLine 3'),
      ];

      const todo = generateTodo(commits);

      // Multiline messages work with -m flag (git handles the newlines)
      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        'exec git commit --amend -m "Line 1\nLine 2\nLine 3"'
      );
    });
  });
});
