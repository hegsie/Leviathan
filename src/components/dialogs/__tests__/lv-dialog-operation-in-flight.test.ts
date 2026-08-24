/**
 * Every repo-scoped dialog must expose `operationInFlight`, and it must track
 * the SAME flag the dialog's own dismissal guard consults.
 *
 * The host's tab-close sweep is driven entirely off this getter. A dialog that
 * does not expose it (or exposes one wired to the wrong flag) is silently
 * force-dismissed mid-operation, and the sweep announces a cancellation that
 * never happened — "clean cancelled", then "Deleted 4,913 items".
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
let cbId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';

import '../lv-clean-dialog.ts';
import '../lv-interactive-rebase-dialog.ts';
import '../lv-cherry-pick-dialog.ts';
import '../lv-branch-cleanup-dialog.ts';
import '../lv-worktree-dialog.ts';
import '../lv-submodule-dialog.ts';
import '../lv-lfs-dialog.ts';
import '../lv-reflog-dialog.ts';
import '../lv-remote-dialog.ts';
import '../lv-config-dialog.ts';
import '../lv-hooks-dialog.ts';
import '../lv-create-tag-dialog.ts';
import '../lv-create-branch-dialog.ts';
import '../lv-credentials-dialog.ts';
import '../lv-repository-health-dialog.ts';
import '../lv-changelog-dialog.ts';
import '../lv-export-import-dialog.ts';

/**
 * tag → [private in-flight field, value that means "running"].
 *
 * The field named here is the one the dialog's own `dismiss()` /
 * `handleModalClose()` refuses on, so the two can never drift apart.
 */
const IN_FLIGHT_FIELDS: Array<[string, string, unknown]> = [
  ['lv-clean-dialog', 'cleaning', true],
  ['lv-interactive-rebase-dialog', 'executing', true],
  ['lv-cherry-pick-dialog', 'isExecuting', true],
  ['lv-branch-cleanup-dialog', 'deleting', true],
  ['lv-worktree-dialog', 'removingPath', '/repo/wt'],
  ['lv-submodule-dialog', 'removingPath', 'vendor/lib'],
  ['lv-lfs-dialog', 'pruning', true],
  ['lv-reflog-dialog', 'resetting', true],
  ['lv-remote-dialog', 'saving', true],
  ['lv-remote-dialog', 'pruningRemote', 'origin'],
  ['lv-remote-dialog', 'removingRemote', 'origin'],
  ['lv-remote-dialog', 'fetchingRemote', 'origin'],
  ['lv-config-dialog', 'saving', true],
  ['lv-hooks-dialog', 'saving', true],
  ['lv-create-tag-dialog', 'isCreating', true],
  ['lv-create-branch-dialog', 'isCreating', true],
  ['lv-credentials-dialog', 'testing', true],
  ['lv-repository-health-dialog', 'runningAction', 'gc'],
  ['lv-changelog-dialog', 'isGenerating', true],
  ['lv-export-import-dialog', 'operationRunning', true],
];

type Probe = HTMLElement & { operationInFlight?: boolean };

describe('repo-scoped dialogs expose operationInFlight', () => {
  for (const [tag, field, runningValue] of IN_FLIGHT_FIELDS) {
    it(`${tag} reports ${field} through operationInFlight`, () => {
      // Never appended: connectedCallback would kick off IPC loads this test
      // has no business simulating. The getter is pure state.
      const el = document.createElement(tag) as Probe;

      expect(
        'operationInFlight' in el,
        `${tag} must expose operationInFlight — the sweep reads nothing else`,
      ).to.be.true;
      expect(el.operationInFlight, `${tag} is idle on construction`).to.equal(false);

      (el as unknown as Record<string, unknown>)[field] = runningValue;
      expect(
        el.operationInFlight,
        `${tag}.operationInFlight must follow ${field}`,
      ).to.equal(true);
    });
  }

  it('every dialog that pins a repository also reports whether work is running', () => {
    // The pairing IS the contract: `pinnedRepositoryPathIfOpen` is what makes
    // the sweep act on a dialog, and `operationInFlight` is the only thing
    // stopping it from lying about the result.
    const pinned = new Set(IN_FLIGHT_FIELDS.map(([tag]) => tag));
    for (const tag of pinned) {
      const el = document.createElement(tag) as Probe & {
        pinnedRepositoryPathIfOpen?: string | null;
      };
      expect('pinnedRepositoryPathIfOpen' in el, `${tag} pins its repo`).to.be.true;
      expect('operationInFlight' in el, `${tag} reports in-flight work`).to.be.true;
    }
  });
});
