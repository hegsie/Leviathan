/**
 * Commit Details — Git Notes section
 *
 * Covers the full note lifecycle reachable from the commit details panel:
 * reading, adding, editing and removing a note, the notes-ref selector, the
 * all-notes overview, and the error path of every one of them.
 */

import { expect, fixture, html, oneEvent } from '@open-wc/testing';
import type { Commit } from '../../../types/git.types.ts';

interface MockNote {
  commitOid: string;
  message: string;
  notesRef: string;
}

let cbId = 0;
let notesByRef: Record<string, MockNote[]> = {};
let notesRefs: string[] = ['refs/notes/commits'];
let failingCommands: Set<string> = new Set();
let confirmAnswer = 'Ok';
let invoked: Array<{ command: string; args?: Record<string, unknown> }> = [];
/** Commands parked mid-flight, so a response can be made to land late. */
let gates: Map<string, Promise<void>> = new Map();

/** Hold `command` open. Returns the release; never calling it strands it. */
function gate(command: string): () => void {
  let release!: () => void;
  gates.set(
    command,
    new Promise<void>((r) => {
      release = r;
    }),
  );
  return () => {
    gates.delete(command);
    release();
  };
}

const mockInvoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (command === 'plugin:notification|is_permission_granted') return false;
  invoked.push({ command, args });

  const held = gates.get(command);
  if (held) await held;

  if (command === 'plugin:dialog|message') return confirmAnswer;

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: `${command} failed` };
  }

  switch (command) {
    case 'get_commit_files':
      return [];
    case 'get_notes_refs':
      return notesRefs;
    case 'get_notes':
      return notesByRef[(args?.notesRef as string) ?? 'refs/notes/commits'] ?? [];
    case 'get_note': {
      const ref = (args?.notesRef as string) ?? 'refs/notes/commits';
      return (notesByRef[ref] ?? []).find((n) => n.commitOid === args?.commitOid) ?? null;
    }
    case 'set_note': {
      const ref = (args?.notesRef as string) ?? 'refs/notes/commits';
      const note: MockNote = {
        commitOid: args?.commitOid as string,
        message: args?.message as string,
        notesRef: ref,
      };
      const list = (notesByRef[ref] ??= []);
      const existing = list.findIndex((n) => n.commitOid === note.commitOid);
      if (existing >= 0) list[existing] = note;
      else list.push(note);
      return note;
    }
    case 'remove_note': {
      const ref = (args?.notesRef as string) ?? 'refs/notes/commits';
      notesByRef[ref] = (notesByRef[ref] ?? []).filter((n) => n.commitOid !== args?.commitOid);
      return null;
    }
    default:
      return null;
  }
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// Import AFTER the mock is installed
import '../lv-commit-details.ts';
import type { LvCommitDetails } from '../lv-commit-details.ts';

const mockCommit: Commit = {
  oid: 'abc123def4567890',
  shortId: 'abc123d',
  summary: 'Test commit',
  message: 'Test commit',
  body: null,
  timestamp: 1700000000,
  author: { name: 'Test User', email: 'test@example.com', timestamp: 1700000000 },
  committer: { name: 'Test User', email: 'test@example.com', timestamp: 1700000000 },
  parentIds: [],
};

/** The commit the user clicks over to while a write is still in flight. */
const otherCommit: Commit = {
  ...mockCommit,
  oid: 'fee9900112233445',
  shortId: 'fee9900',
  summary: 'Another commit',
  message: 'Another commit',
};

async function settle(el: LvCommitDetails): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await el.updateComplete;
}

async function mount(commit: Commit = mockCommit): Promise<LvCommitDetails> {
  const el = await fixture<LvCommitDetails>(
    html`<lv-commit-details .repositoryPath=${'/test/repo'} .commit=${commit}></lv-commit-details>`,
  );
  await settle(el);
  return el;
}

function q<T extends Element>(el: LvCommitDetails, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

function buttonWithText(el: LvCommitDetails, text: string): HTMLButtonElement {
  const match = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.note-btn')].find((b) =>
    (b.textContent ?? '').trim().startsWith(text),
  );
  expect(match, `expected a note button labelled "${text}"`).to.not.be.undefined;
  return match!;
}

async function typeNote(el: LvCommitDetails, text: string): Promise<void> {
  const editor = q<HTMLTextAreaElement>(el, '.note-editor')!;
  editor.value = text;
  editor.dispatchEvent(new Event('input'));
  await settle(el);
}

describe('lv-commit-details notes section', () => {
  beforeEach(() => {
    notesByRef = {};
    notesRefs = ['refs/notes/commits'];
    failingCommands = new Set();
    confirmAnswer = 'Ok';
    invoked = [];
    gates = new Map();
  });

  it('renders the note attached to the selected commit', async () => {
    notesByRef['refs/notes/commits'] = [
      { commitOid: mockCommit.oid, message: 'Reviewed by QA', notesRef: 'refs/notes/commits' },
    ];

    const el = await mount();

    expect(q(el, '.note-body')!.textContent).to.contain('Reviewed by QA');
    expect(q(el, '.note-empty')).to.be.null;
  });

  it('shows an empty state with an add affordance when the commit has no note', async () => {
    const el = await mount();

    expect(q(el, '.note-empty')!.textContent).to.contain('refs/notes/commits');
    expect(buttonWithText(el, 'Add note')).to.exist;
  });

  it('surfaces a read failure and retries on demand', async () => {
    failingCommands.add('get_note');

    const el = await mount();

    const error = q(el, '.note-error');
    expect(error, 'read failure must be visible').to.not.be.null;
    expect(error!.textContent).to.contain('get_note failed');
    // A failed read must not be reported as "no note" — the commit may well
    // have one, so the only offer is to try again.
    expect(q(el, '.note-empty')).to.be.null;

    failingCommands.delete('get_note');
    notesByRef['refs/notes/commits'] = [
      { commitOid: mockCommit.oid, message: 'Recovered', notesRef: 'refs/notes/commits' },
    ];
    buttonWithText(el, 'Retry').click();
    await settle(el);

    expect(q(el, '.note-body')!.textContent).to.contain('Recovered');
  });

  it('adds a note and reports it with a notes-changed event', async () => {
    const el = await mount();

    buttonWithText(el, 'Add note').click();
    await settle(el);
    await typeNote(el, 'Backported to 1.x');

    const changed = oneEvent(el, 'notes-changed');
    buttonWithText(el, 'Save note').click();
    const event = await changed;
    await settle(el);

    expect(event.detail).to.deep.equal({
      action: 'added',
      commitOid: mockCommit.oid,
      notesRef: 'refs/notes/commits',
    });

    const call = invoked.find((c) => c.command === 'set_note');
    expect(call, 'set_note must be invoked').to.not.be.undefined;
    expect(call!.args).to.include({
      path: '/test/repo',
      commitOid: mockCommit.oid,
      message: 'Backported to 1.x',
      notesRef: 'refs/notes/commits',
      force: true,
    });
    expect(q(el, '.note-body')!.textContent).to.contain('Backported to 1.x');
  });

  it('reports an edit as an update and keeps the note visible', async () => {
    notesByRef['refs/notes/commits'] = [
      { commitOid: mockCommit.oid, message: 'First', notesRef: 'refs/notes/commits' },
    ];
    const el = await mount();

    buttonWithText(el, 'Edit').click();
    await settle(el);
    expect(q<HTMLTextAreaElement>(el, '.note-editor')!.value).to.equal('First');

    await typeNote(el, 'Second');
    const changed = oneEvent(el, 'notes-changed');
    buttonWithText(el, 'Save note').click();
    const event = await changed;
    await settle(el);

    expect(event.detail.action).to.equal('updated');
    expect(q(el, '.note-body')!.textContent).to.contain('Second');
  });

  it('keeps the typed note and shows the error when the write fails', async () => {
    const el = await mount();

    buttonWithText(el, 'Add note').click();
    await settle(el);
    await typeNote(el, 'Will not save');

    let dispatched = false;
    el.addEventListener('notes-changed', () => {
      dispatched = true;
    });

    failingCommands.add('set_note');
    buttonWithText(el, 'Save note').click();
    await settle(el);

    expect(q(el, '.note-error')!.textContent).to.contain('set_note failed');
    expect(q<HTMLTextAreaElement>(el, '.note-editor')!.value).to.equal('Will not save');
    expect(dispatched, 'a failed write must not announce a change').to.be.false;
  });

  it('refuses to save an empty note', async () => {
    const el = await mount();

    buttonWithText(el, 'Add note').click();
    await settle(el);
    await typeNote(el, '   ');

    expect(buttonWithText(el, 'Save note').disabled).to.be.true;
    expect(invoked.some((c) => c.command === 'set_note')).to.be.false;
  });

  it('removes a note once confirmed', async () => {
    notesByRef['refs/notes/commits'] = [
      { commitOid: mockCommit.oid, message: 'Obsolete', notesRef: 'refs/notes/commits' },
    ];
    const el = await mount();

    const changed = oneEvent(el, 'notes-changed');
    buttonWithText(el, 'Remove').click();
    const event = await changed;
    await settle(el);

    expect(event.detail.action).to.equal('removed');
    expect(invoked.some((c) => c.command === 'remove_note')).to.be.true;
    expect(q(el, '.note-body')).to.be.null;
    expect(q(el, '.note-empty')).to.not.be.null;
  });

  it('leaves the note alone when the removal is declined', async () => {
    notesByRef['refs/notes/commits'] = [
      { commitOid: mockCommit.oid, message: 'Keep me', notesRef: 'refs/notes/commits' },
    ];
    confirmAnswer = 'Cancel';
    const el = await mount();

    buttonWithText(el, 'Remove').click();
    await settle(el);

    expect(invoked.some((c) => c.command === 'remove_note')).to.be.false;
    expect(q(el, '.note-body')!.textContent).to.contain('Keep me');
  });

  it('surfaces a removal failure', async () => {
    notesByRef['refs/notes/commits'] = [
      { commitOid: mockCommit.oid, message: 'Stuck', notesRef: 'refs/notes/commits' },
    ];
    const el = await mount();

    failingCommands.add('remove_note');
    buttonWithText(el, 'Remove').click();
    await settle(el);

    expect(q(el, '.note-error')!.textContent).to.contain('remove_note failed');
    expect(q(el, '.note-body')!.textContent).to.contain('Stuck');
  });

  it('lists every notes ref and reads the selected one', async () => {
    notesRefs = ['refs/notes/commits', 'refs/notes/review'];
    notesByRef['refs/notes/review'] = [
      { commitOid: mockCommit.oid, message: 'Review note', notesRef: 'refs/notes/review' },
    ];
    const el = await mount();

    const select = q<HTMLSelectElement>(el, '.notes-ref-select')!;
    expect([...select.options].map((o) => o.value)).to.deep.equal([
      'refs/notes/commits',
      'refs/notes/review',
    ]);
    expect(q(el, '.note-empty')).to.not.be.null;

    select.value = 'refs/notes/review';
    select.dispatchEvent(new Event('change'));
    await settle(el);

    expect(q(el, '.note-body')!.textContent).to.contain('Review note');
    const reads = invoked.filter((c) => c.command === 'get_note');
    expect(reads[reads.length - 1].args!.notesRef).to.equal('refs/notes/review');
  });

  it('lists all notes in the ref and navigates to the commit behind one', async () => {
    notesByRef['refs/notes/commits'] = [
      { commitOid: mockCommit.oid, message: 'This commit', notesRef: 'refs/notes/commits' },
      { commitOid: 'fedcba9876543210', message: 'Another commit\nsecond line', notesRef: 'refs/notes/commits' },
    ];
    const el = await mount();

    const toggle = q<HTMLButtonElement>(el, '.notes-overview-toggle')!;
    expect(toggle.textContent).to.contain('2 notes');

    toggle.click();
    await settle(el);

    const items = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.notes-overview-item')];
    expect(items).to.have.lengthOf(2);
    // Only the first line of a multi-line note belongs in a one-row summary
    expect(items[1].querySelector('.notes-overview-text')!.textContent).to.contain('Another commit');
    expect(items[1].querySelector('.notes-overview-text')!.textContent).to.not.contain('second line');

    const shown = oneEvent(el, 'show-commit');
    items[1].click();
    const event = await shown;
    expect(event.detail.oid).to.equal('fedcba9876543210');
  });

  it('keeps an unsaved draft when the user visits another commit and returns', async () => {
    const otherCommit: Commit = { ...mockCommit, oid: 'fedcba9876543210', shortId: 'fedcba9' };
    const el = await mount();

    buttonWithText(el, 'Add note').click();
    await settle(el);
    await typeNote(el, 'Half-written thought');

    // Clicking another commit in the graph swaps the panel's commit out
    el.commit = otherCommit;
    await settle(el);
    expect(q(el, '.note-editor'), 'the other commit starts with no editor open').to.be.null;

    el.commit = mockCommit;
    await settle(el);

    expect(q<HTMLTextAreaElement>(el, '.note-editor')!.value).to.equal('Half-written thought');
  });

  it('discards a finished save once the panel has moved to another commit', async () => {
    const el = await mount();

    buttonWithText(el, 'Add note').click();
    await settle(el);
    await typeNote(el, 'Note for the first commit');

    const seen: Array<Record<string, unknown>> = [];
    el.addEventListener('notes-changed', (e) => seen.push((e as CustomEvent).detail));

    // Park the write, then click another commit in the graph while it is in
    // flight — nothing can intercept that click.
    const releaseSave = gate('set_note');
    buttonWithText(el, 'Save note').click();
    await settle(el);

    el.commit = otherCommit;
    await settle(el);
    // The second commit has finished its own read: it genuinely has no note.
    expect(q(el, '.note-empty') !== null, 'the new commit has loaded').to.be.true;

    // Stall the post-write refresh so what is sampled below is the state the
    // save response left behind, not a later re-read that hides it. Sample
    // first and release before asserting, so a failure cannot strand the gate.
    const releaseRefs = gate('get_notes_refs');
    releaseSave();
    await settle(el);

    const noteBodyWhileStale = q(el, '.note-body')?.textContent ?? null;
    const emptyStateWhileStale = q(el, '.note-empty') !== null;

    releaseRefs();
    await settle(el);

    expect(
      noteBodyWhileStale,
      'the first commit\u2019s note must not appear under the second',
    ).to.be.null;
    expect(emptyStateWhileStale, 'the second commit keeps its own empty state').to.be.true;
    // The write did land, so it is still announced — against the commit it
    // was actually written to.
    expect(seen).to.deep.equal([
      { action: 'added', commitOid: mockCommit.oid, notesRef: 'refs/notes/commits' },
    ]);
  });

  it('does not show a failed save under the commit the user moved to', async () => {
    const el = await mount();

    buttonWithText(el, 'Add note').click();
    await settle(el);
    await typeNote(el, 'Note for the first commit');

    failingCommands.add('set_note');
    const releaseSave = gate('set_note');
    buttonWithText(el, 'Save note').click();
    await settle(el);

    el.commit = otherCommit;
    await settle(el);

    releaseSave();
    await settle(el);

    // Sampled as plain values: handing chai a live DOM node makes a failure
    // stringify the whole tree instead of reporting.
    const errorText = q(el, '.note-error')?.textContent ?? null;
    const showsEmptyState = q(el, '.note-empty') !== null;

    // Nothing refreshes after a failed write, so an error adopted here would
    // sit under the wrong commit until the user navigated away again.
    expect(errorText, 'the first commit\u2019s save error must not follow the user').to.be.null;
    expect(showsEmptyState, 'the second commit keeps its own empty state').to.be.true;
  });

  it('does not show a failed removal under the commit the user moved to', async () => {
    notesByRef['refs/notes/commits'] = [
      { commitOid: mockCommit.oid, message: 'Obsolete', notesRef: 'refs/notes/commits' },
    ];
    const el = await mount();

    failingCommands.add('remove_note');
    const releaseRemove = gate('remove_note');
    buttonWithText(el, 'Remove').click();
    await settle(el);

    el.commit = otherCommit;
    await settle(el);

    releaseRemove();
    await settle(el);

    const errorText = q(el, '.note-error')?.textContent ?? null;
    const showsEmptyState = q(el, '.note-empty') !== null;

    expect(errorText, 'the first commit\u2019s removal error must not follow the user').to.be.null;
    expect(showsEmptyState, 'the second commit keeps its own empty state').to.be.true;
  });

  it('surfaces a failure to list the notes in the ref', async () => {
    failingCommands.add('get_notes');
    const el = await mount();

    const errors = [...el.shadowRoot!.querySelectorAll('.note-error')].map((e) => e.textContent);
    expect(errors.join(' ')).to.contain('get_notes failed');
    expect(q(el, '.notes-overview-toggle')).to.be.null;
  });
});
