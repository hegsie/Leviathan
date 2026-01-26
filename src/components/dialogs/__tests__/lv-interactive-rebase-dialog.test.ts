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
}

interface PreviewCommit {
  shortId: string;
  summary: string;
  isSquashed: boolean;
  squashedFrom?: string[];
  error?: string;
}

/**
 * Helper to create editable commits with default values
 */
function createEditableCommit(
  shortId: string,
  summary: string,
  action: RebaseAction = 'pick',
  newMessage?: string
): EditableRebaseCommit {
  return {
    oid: `${shortId}00000000000`,
    shortId,
    summary,
    action,
    newMessage,
  };
}

/*
 * ============================================================================
 * WARNING: DUPLICATED LOGIC - KEEP IN SYNC WITH COMPONENT
 * ============================================================================
 * The following functions (generatePreview, applyAutosquash, getStats,
 * generateTodo) duplicate logic from lv-interactive-rebase-dialog.ts.
 * This allows unit testing without mocking internal component methods.
 *
 * If you modify the corresponding logic in the component, you MUST update
 * these test functions to match. Failure to keep them in sync will cause
 * tests to pass while the actual component behavior differs.
 *
 * Consider extracting these into a shared utility module if the maintenance
 * burden becomes too high.
 * ============================================================================
 */

/**
 * Generate preview of what commits will look like after rebase
 * @see lv-interactive-rebase-dialog.ts generatePreview()
 */
function generatePreview(commits: EditableRebaseCommit[]): PreviewCommit[] {
  const preview: PreviewCommit[] = [];
  let i = 0;
  let hasBaseCommit = false;

  while (i < commits.length) {
    const commit = commits[i];

    if (commit.action === 'drop') {
      i++;
      continue;
    }

    // Check if this is an orphaned squash/fixup (no base commit before it)
    if ((commit.action === 'squash' || commit.action === 'fixup') && !hasBaseCommit) {
      preview.push({
        shortId: commit.shortId,
        summary: commit.summary,
        isSquashed: false,
        error: `Cannot ${commit.action}: no previous commit to combine with`,
      });
      i++;
      continue;
    }

    // This is a base commit (pick/reword/edit)
    hasBaseCommit = true;

    const squashedFrom: string[] = [];
    let j = i + 1;
    while (j < commits.length &&
           (commits[j].action === 'squash' || commits[j].action === 'fixup')) {
      squashedFrom.push(commits[j].shortId);
      j++;
    }

    let summary = commit.summary;
    if (commit.action === 'reword' && commit.newMessage !== undefined) {
      const firstLine = commit.newMessage.split('\n')[0].trim();
      summary = firstLine || '(empty message)';
    }

    preview.push({
      shortId: commit.shortId,
      summary,
      isSquashed: squashedFrom.length > 0,
      squashedFrom: squashedFrom.length > 0 ? squashedFrom : undefined,
    });

    i = j;
  }

  return preview;

}

/**
 * Check if the configuration has validation errors
 */
function hasValidationErrors(commits: EditableRebaseCommit[]): boolean {
  const preview = generatePreview(commits);
  return preview.some(p => p.error !== undefined);
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
 * @see lv-interactive-rebase-dialog.ts applyAutosquash()
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

    // Two-pass approach: exact match first, then prefix match (matches git's autosquash behavior)
    let targetIndex = newCommits.findIndex(c => c.summary === targetSummary);
    if (targetIndex === -1) {
      // No exact match, try prefix match
      targetIndex = newCommits.findIndex(c => c.summary.startsWith(targetSummary));
    }

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
 * @see lv-interactive-rebase-dialog.ts getStats()
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
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
        createEditableCommit('ghi1234', 'Feature C', 'pick'),
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
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'drop'),
        createEditableCommit('ghi1234', 'Feature C', 'pick'),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].shortId).to.equal('abc1234');
      expect(preview[1].shortId).to.equal('ghi1234');
    });

    it('should mark squashed commits correctly', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Fix for A', 'squash'),
        createEditableCommit('ghi1234', 'Feature B', 'pick'),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].isSquashed).to.be.true;
      expect(preview[0].squashedFrom).to.deep.equal(['def1234']);
      expect(preview[1].isSquashed).to.be.false;
    });

    it('should handle multiple squashed commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Fix 1', 'fixup'),
        createEditableCommit('ghi1234', 'Fix 2', 'squash'),
        createEditableCommit('jkl1234', 'Feature B', 'pick'),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].isSquashed).to.be.true;
      expect(preview[0].squashedFrom).to.deep.equal(['def1234', 'ghi1234']);
    });

    it('should use new message for reworded commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old message', 'reword', 'New message'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
      ];

      const preview = generatePreview(commits);

      expect(preview[0].summary).to.equal('New message');
      expect(preview[1].summary).to.equal('Feature B');
    });

    it('should use first line of multiline reword message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 'First line\nSecond line\nThird line'),
      ];

      const preview = generatePreview(commits);

      expect(preview[0].summary).to.equal('First line');
    });

    it('should show placeholder for empty reword message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', ''),
      ];

      const preview = generatePreview(commits);

      expect(preview[0].summary).to.equal('(empty message)');
    });

    it('should show placeholder for reword message starting with newline', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', '\nSecond line'),
      ];

      const preview = generatePreview(commits);

      expect(preview[0].summary).to.equal('(empty message)');
    });

    it('should trim whitespace from reword message first line', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', '  Trimmed message  \nSecond line'),
      ];

      const preview = generatePreview(commits);

      expect(preview[0].summary).to.equal('Trimmed message');
    });

    it('should handle all commits dropped', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'drop'),
        createEditableCommit('def1234', 'Feature B', 'drop'),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(0);
    });

    it('should mark squash at index 0 as error', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'squash'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].error).to.equal('Cannot squash: no previous commit to combine with');
      expect(preview[1].error).to.be.undefined;
    });

    it('should mark fixup at index 0 as error', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'fixup'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].error).to.equal('Cannot fixup: no previous commit to combine with');
      expect(preview[1].error).to.be.undefined;
    });

    it('should mark squash/fixup after all dropped commits as error', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'drop'),
        createEditableCommit('def1234', 'Feature B', 'drop'),
        createEditableCommit('ghi1234', 'Feature C', 'squash'),
        createEditableCommit('jkl1234', 'Feature D', 'pick'),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(2);
      expect(preview[0].shortId).to.equal('ghi1234');
      expect(preview[0].error).to.equal('Cannot squash: no previous commit to combine with');
      expect(preview[1].shortId).to.equal('jkl1234');
      expect(preview[1].error).to.be.undefined;
    });

    it('should mark multiple consecutive orphaned squash/fixup as errors', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'squash'),
        createEditableCommit('def1234', 'Feature B', 'fixup'),
        createEditableCommit('ghi1234', 'Feature C', 'pick'),
      ];

      const preview = generatePreview(commits);

      expect(preview).to.have.length(3);
      expect(preview[0].error).to.equal('Cannot squash: no previous commit to combine with');
      expect(preview[1].error).to.equal('Cannot fixup: no previous commit to combine with');
      expect(preview[2].error).to.be.undefined;
    });

    it('should validate hasValidationErrors returns true for orphaned squash', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'squash'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
      ];

      expect(hasValidationErrors(commits)).to.be.true;
    });

    it('should validate hasValidationErrors returns false for valid config', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'squash'),
      ];

      expect(hasValidationErrors(commits)).to.be.false;
    });
  });

  describe('Autosquash Detection', () => {
    it('should detect fixup! commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'fixup! Feature A', 'pick'),
      ];

      expect(detectAutosquashCommits(commits)).to.be.true;
    });

    it('should detect squash! commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'squash! Feature A', 'pick'),
      ];

      expect(detectAutosquashCommits(commits)).to.be.true;
    });

    it('should return false when no autosquash commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
      ];

      expect(detectAutosquashCommits(commits)).to.be.false;
    });
  });

  describe('Autosquash Application', () => {
    it('should reorder fixup! commits after their target', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
        createEditableCommit('ghi1234', 'fixup! Feature A', 'pick'),
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
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
        createEditableCommit('ghi1234', 'squash! Feature A', 'pick'),
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
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'fixup! Feature A', 'pick'),
        createEditableCommit('ghi1234', 'squash! Feature A', 'pick'),
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
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'fixup! Unknown Feature', 'pick'),
      ];

      const result = applyAutosquash(commits);

      expect(result).to.have.length(2);
      expect(result[0].shortId).to.equal('abc1234');
      expect(result[1].shortId).to.equal('def1234');
      // Action stays as pick since no target found
      expect(result[1].action).to.equal('pick');
    });

    it('should prefer exact match over prefix match', () => {
      // "Add feature" should match exactly, not "Add feature X" via prefix
      const commits = [
        createEditableCommit('abc1234', 'Add feature X', 'pick'),
        createEditableCommit('def1234', 'Add feature', 'pick'),
        createEditableCommit('ghi1234', 'fixup! Add feature', 'pick'),
      ];

      const result = applyAutosquash(commits);

      expect(result).to.have.length(3);
      // fixup should be placed after "Add feature" (exact match), not "Add feature X"
      expect(result[0].shortId).to.equal('abc1234');
      expect(result[0].summary).to.equal('Add feature X');
      expect(result[1].shortId).to.equal('def1234');
      expect(result[1].summary).to.equal('Add feature');
      expect(result[2].shortId).to.equal('ghi1234');
      expect(result[2].action).to.equal('fixup');
    });

    it('should fall back to prefix match when no exact match exists', () => {
      // "fixup! Add" should match "Add feature" via prefix when no exact "Add" exists
      const commits = [
        createEditableCommit('abc1234', 'Add feature', 'pick'),
        createEditableCommit('def1234', 'Other commit', 'pick'),
        createEditableCommit('ghi1234', 'fixup! Add', 'pick'),
      ];

      const result = applyAutosquash(commits);

      expect(result).to.have.length(3);
      // fixup should be placed after "Add feature" via prefix match
      expect(result[0].shortId).to.equal('abc1234');
      expect(result[1].shortId).to.equal('ghi1234');
      expect(result[1].action).to.equal('fixup');
      expect(result[2].shortId).to.equal('def1234');
    });

    it('should handle exact match even when prefix match appears first in list', () => {
      // "Add feature" appears after "Add feature - part 1" but should still be matched exactly
      const commits = [
        createEditableCommit('aaa1234', 'Add feature - part 1', 'pick'),
        createEditableCommit('bbb1234', 'Add feature - part 2', 'pick'),
        createEditableCommit('ccc1234', 'Add feature', 'pick'),
        createEditableCommit('ddd1234', 'squash! Add feature', 'pick'),
      ];

      const result = applyAutosquash(commits);

      expect(result).to.have.length(4);
      // squash should follow the exact "Add feature" match, not the first prefix match
      expect(result[0].shortId).to.equal('aaa1234');
      expect(result[1].shortId).to.equal('bbb1234');
      expect(result[2].shortId).to.equal('ccc1234');
      expect(result[3].shortId).to.equal('ddd1234');
      expect(result[3].action).to.equal('squash');
    });
  });

  describe('Statistics Calculation', () => {
    it('should count pick commits as kept', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'pick'),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(2);
      expect(stats.squashed).to.equal(0);
      expect(stats.dropped).to.equal(0);
      expect(stats.reworded).to.equal(0);
    });

    it('should count edit commits as kept', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'edit'),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(1);
    });

    it('should count reword commits as both kept and reworded', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'reword'),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(1);
      expect(stats.reworded).to.equal(1);
    });

    it('should count squash and fixup as squashed', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Fix 1', 'squash'),
        createEditableCommit('ghi1234', 'Fix 2', 'fixup'),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(1);
      expect(stats.squashed).to.equal(2);
    });

    it('should count dropped commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Remove me', 'drop'),
      ];

      const stats = getStats(commits);

      expect(stats.kept).to.equal(1);
      expect(stats.dropped).to.equal(1);
    });

    it('should handle complex scenarios', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'reword'),
        createEditableCommit('ghi1234', 'Fix', 'squash'),
        createEditableCommit('jkl1234', 'Remove', 'drop'),
        createEditableCommit('mno1234', 'Edit this', 'edit'),
        createEditableCommit('pqr1234', 'Fixup', 'fixup'),
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
     * Generate todo file content for interactive rebase
     * For reword with changed message, uses pick + exec git commit --amend
     * @see lv-interactive-rebase-dialog.ts handleExecute()
     */
    function generateTodo(commits: EditableRebaseCommit[]): string {
      const todoLines: string[] = [];

      for (const c of commits) {
        // Sanitize summary for todo file format (line-based, no newlines allowed)
        const sanitizedSummary = c.summary.replace(/[\r\n]+/g, ' ').trim();

        if (c.action === 'reword' && c.newMessage && c.newMessage !== c.summary) {
          // Use pick + exec to amend with new message
          todoLines.push(`pick ${c.shortId} ${sanitizedSummary}`);
          // Use printf for POSIX shell compatibility
          // Handle both \r\n (CRLF) and \r (CR) line endings
          const escapedMessage = c.newMessage
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "'\\''")
            .replace(/\r\n/g, '\\n')
            .replace(/\r/g, '\\n')
            .replace(/\n/g, '\\n');
          todoLines.push(`exec git commit --amend -m "$(printf '%b' '${escapedMessage}')"`);
        } else if (c.action === 'reword') {
          // Reword without message change - keep as pick
          todoLines.push(`pick ${c.shortId} ${sanitizedSummary}`);
        } else {
          todoLines.push(`${c.action} ${c.shortId} ${sanitizedSummary}`);
        }
      }

      return todoLines.join('\n');
    }

    it('should generate correct todo format for basic actions', () => {
      const commits = [
        createEditableCommit('abc1234', 'Feature A', 'pick'),
        createEditableCommit('def1234', 'Feature B', 'squash'),
        createEditableCommit('ghi1234', 'Feature C', 'drop'),
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
        createEditableCommit('abc1234', 'Old message', 'reword', 'New message'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old message\n' +
        "exec git commit --amend -m \"$(printf '%b' 'New message')\""
      );
    });

    it('should use pick for reword without message change', () => {
      const commits = [
        createEditableCommit('abc1234', 'Same message', 'reword', 'Same message'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal('pick abc1234 Same message');
    });

    it('should use pick for reword without newMessage set', () => {
      const commits = [
        createEditableCommit('abc1234', 'Some message', 'reword'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal('pick abc1234 Some message');
    });

    it('should escape single quotes in reword message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', "It's working"),
      ];

      const todo = generateTodo(commits);

      // Single quotes escaped using '\'' technique for shell compatibility
      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        "exec git commit --amend -m \"$(printf '%b' 'It'\\''s working')\""
      );
    });

    it('should escape backslashes in reword message', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 'Path\\to\\file'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        "exec git commit --amend -m \"$(printf '%b' 'Path\\\\to\\\\file')\""
      );
    });

    it('should not escape dollar signs in reword message', () => {
      // Single-quoted printf arg doesn't do variable expansion
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 'Cost $100'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        "exec git commit --amend -m \"$(printf '%b' 'Cost $100')\""
      );
    });

    it('should not escape backticks in reword message', () => {
      // Single-quoted printf arg doesn't do command substitution
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 'Use `code` here'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        `exec git commit --amend -m "$(printf '%b' 'Use \`code\` here')"`
      );
    });

    it('should handle multiple reword commits', () => {
      const commits = [
        createEditableCommit('abc1234', 'First', 'reword', 'First reworded'),
        createEditableCommit('def1234', 'Second', 'pick'),
        createEditableCommit('ghi1234', 'Third', 'reword', 'Third reworded'),
      ];

      const todo = generateTodo(commits);

      expect(todo).to.equal(
        'pick abc1234 First\n' +
        "exec git commit --amend -m \"$(printf '%b' 'First reworded')\"\n" +
        'pick def1234 Second\n' +
        'pick ghi1234 Third\n' +
        "exec git commit --amend -m \"$(printf '%b' 'Third reworded')\""
      );
    });

    it('should escape newlines in reword messages', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 'Line 1\nLine 2\nLine 3'),
      ];

      const todo = generateTodo(commits);

      // printf '%b' interprets \n as actual newlines
      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        "exec git commit --amend -m \"$(printf '%b' 'Line 1\\nLine 2\\nLine 3')\""
      );
    });

    it('should escape carriage returns in reword messages', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old', 'reword', 'Line 1\r\nLine 2\rLine 3'),
      ];

      const todo = generateTodo(commits);

      // Both \r\n and \r should be converted to \n for shell
      expect(todo).to.equal(
        'pick abc1234 Old\n' +
        "exec git commit --amend -m \"$(printf '%b' 'Line 1\\nLine 2\\nLine 3')\""
      );
    });

    it('should sanitize commit summaries containing newlines', () => {
      // Commit summaries with newlines would break todo file format
      // They should be sanitized to single line
      const commits = [
        createEditableCommit('abc1234', 'Feature A\nExtra line\rAnother line', 'pick'),
        createEditableCommit('def1234', 'Feature B\r\nWith CRLF', 'squash'),
      ];

      const todo = generateTodo(commits);

      // Newlines in summaries should be replaced with spaces
      expect(todo).to.equal(
        'pick abc1234 Feature A Extra line Another line\n' +
        'squash def1234 Feature B With CRLF'
      );
    });

    it('should sanitize reword commit summaries containing newlines', () => {
      const commits = [
        createEditableCommit('abc1234', 'Old\nwith newline', 'reword', 'New message'),
      ];

      const todo = generateTodo(commits);

      // The original summary in the todo line should be sanitized
      expect(todo).to.equal(
        'pick abc1234 Old with newline\n' +
        "exec git commit --amend -m \"$(printf '%b' 'New message')\""
      );
    });
  });
});
