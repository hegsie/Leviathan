/**
 * Describe Dialog Tests
 *
 * Covers the three answers `git describe` can give a commit: a name, nothing
 * (an untagged repository — an empty state, not a failure), and a real error.
 */

type DescribeFailure = { code: string; message: string } | null;

let describeArgs: Record<string, unknown> | undefined;
let describeFailure: DescribeFailure = null;
let describeResponse: unknown = {
  description: 'v1.0.0-3-gabc1234',
  tag: 'v1.0.0',
  commitsAhead: 3,
  commitHash: 'abc1234',
  isDirty: false,
};

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (command === 'describe') {
    describeArgs = args as Record<string, unknown>;
    if (describeFailure) throw describeFailure;
    return describeResponse;
  }

  return null;
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

import { expect, fixture, html } from '@open-wc/testing';
import '../lv-describe-dialog.ts';
import type { LvDescribeDialog } from '../lv-describe-dialog.ts';

/** Open the dialog and let its describe round trip settle. */
async function openAndSettle(
  el: LvDescribeDialog,
  commitish?: string,
  summary?: string,
): Promise<void> {
  el.open(commitish, summary);
  // One microtask for the invoke, then the render it schedules.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe('lv-describe-dialog', () => {
  let el: LvDescribeDialog;

  beforeEach(async () => {
    describeArgs = undefined;
    describeFailure = null;
    describeResponse = {
      description: 'v1.0.0-3-gabc1234',
      tag: 'v1.0.0',
      commitsAhead: 3,
      commitHash: 'abc1234',
      isDirty: false,
    };
    el = await fixture<LvDescribeDialog>(
      html`<lv-describe-dialog .repositoryPath=${'/test/repo'}></lv-describe-dialog>`,
    );
  });

  it('describes the commit it was opened for and shows tag, distance and hash', async () => {
    await openAndSettle(el, 'abc1234def5678', 'Add feature');

    expect(describeArgs?.commitish).to.equal('abc1234def5678');
    expect(describeArgs?.path).to.equal('/test/repo');

    const text = el.shadowRoot!.textContent ?? '';
    expect(el.shadowRoot!.querySelector('.description')!.textContent).to.contain('v1.0.0-3-gabc1234');
    expect(text).to.contain('v1.0.0');
    expect(text).to.contain('3 commits');
    expect(text).to.contain('abc1234');
    // The commit being described is identified in the header.
    expect(text).to.contain('Add feature');
  });

  it('describes HEAD when opened with no commit', async () => {
    await openAndSettle(el);

    expect(describeArgs).to.not.be.undefined;
    expect(describeArgs?.commitish).to.equal(undefined);
    expect(el.shadowRoot!.textContent).to.contain('HEAD');
  });

  it('reads a single commit of distance in the singular', async () => {
    describeResponse = {
      description: 'v1.0.0-1-gabc1234',
      tag: 'v1.0.0',
      commitsAhead: 1,
      commitHash: 'abc1234',
      isDirty: false,
    };
    await openAndSettle(el, 'abc1234def5678');

    const text = el.shadowRoot!.textContent ?? '';
    expect(text).to.contain('1 commit');
    expect(text).to.not.contain('1 commits');
  });

  it('says so when the commit is the tag itself', async () => {
    describeResponse = {
      description: 'v1.0.0',
      tag: 'v1.0.0',
      commitsAhead: 0,
      commitHash: null,
      isDirty: false,
    };
    await openAndSettle(el, 'abc1234def5678');

    expect(el.shadowRoot!.textContent).to.contain('On the tag exactly');
  });

  it('shows an empty state, not an error, when no tag reaches the commit', async () => {
    describeFailure = { code: 'NO_TAGS_REACHABLE', message: 'No tags reachable from abc1234' };
    await openAndSettle(el, 'abc1234def5678');

    const empty = el.shadowRoot!.querySelector('.empty-state');
    expect(empty).to.not.be.null;
    expect(empty!.textContent).to.contain('No tags reachable from this commit');
    // The empty case must not be dressed as a failure.
    expect(el.shadowRoot!.querySelector('.error-message')).to.be.null;
    // ...and it must offer the way out of it.
    expect(empty!.textContent).to.contain('lightweight');
    expect(empty!.textContent).to.contain('Create a tag here');
  });

  it('asks the host to create a tag on the described commit from the empty state', async () => {
    describeFailure = { code: 'NO_TAGS_REACHABLE', message: 'No tags reachable' };
    await openAndSettle(el, 'abc1234def5678');

    let detail: { target?: string } | undefined;
    el.addEventListener('describe-create-tag', (e) => {
      detail = (e as CustomEvent<{ target?: string }>).detail;
    });

    const button = Array.from(el.shadowRoot!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Create a tag here'),
    );
    expect(button).to.not.be.undefined;
    button!.click();

    expect(detail?.target).to.equal('abc1234def5678');
    // The dialog steps aside so the create-tag dialog is not opened behind it.
    expect(el.pinnedRepositoryPathIfOpen).to.be.null;
  });

  it('shows a real failure inline and offers a retry', async () => {
    describeFailure = { code: 'OPERATION_FAILED', message: 'git describe failed: bad revision' };
    await openAndSettle(el, 'abc1234def5678');

    const error = el.shadowRoot!.querySelector('.error-message');
    expect(error).to.not.be.null;
    expect(error!.textContent).to.contain('bad revision');
    expect(el.shadowRoot!.querySelector('.empty-state')).to.be.null;

    // Retrying after the cause is gone replaces the error with the answer.
    describeFailure = null;
    const retry = Array.from(el.shadowRoot!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Try again'),
    );
    retry!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.error-message')).to.be.null;
    expect(el.shadowRoot!.querySelector('.description')!.textContent).to.contain('v1.0.0-3-gabc1234');
  });

  it('re-runs with --tags when lightweight tags are included', async () => {
    await openAndSettle(el, 'abc1234def5678');
    expect(describeArgs?.tags).to.equal(false);

    const checkbox = el.shadowRoot!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(describeArgs?.tags).to.equal(true);
    // Still aimed at the same commit.
    expect(describeArgs?.commitish).to.equal('abc1234def5678');
  });

  it('re-aims at the new commit when reopened from another entry point', async () => {
    await openAndSettle(el, 'abc1234def5678', 'Add feature');
    await openAndSettle(el, 'fed4321cba8765', 'Fix bug');

    expect(describeArgs?.commitish).to.equal('fed4321cba8765');
    const text = el.shadowRoot!.textContent ?? '';
    expect(text).to.contain('Fix bug');
    expect(text).to.not.contain('Add feature');
  });

  it('pins the repository it was opened for so a tab switch cannot redirect it', async () => {
    await openAndSettle(el, 'abc1234def5678');
    expect(el.pinnedRepositoryPathIfOpen).to.equal('/test/repo');

    // The host rebinds this property when the active tab changes.
    el.repositoryPath = '/other/repo';
    await el.updateComplete;

    const checkbox = el.shadowRoot!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(describeArgs?.path).to.equal('/test/repo');
  });

  it('never reports work in flight — describe only reads', async () => {
    expect(el.operationInFlight).to.be.false;
    el.open('abc1234def5678');
    expect(el.operationInFlight).to.be.false;
  });
});
