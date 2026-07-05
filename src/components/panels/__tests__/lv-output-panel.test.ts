import { expect, fixture, html } from '@open-wc/testing';

import '../lv-output-panel.ts';
import type { LvOutputPanel } from '../lv-output-panel.ts';
import {
  logGitCommand,
  clearLogEntries,
} from '../../../services/output-log.service.ts';

describe('lv-output-panel', () => {
  beforeEach(() => {
    clearLogEntries();
  });

  it('shows the empty state with no entries', async () => {
    const el = await fixture<LvOutputPanel>(html`<lv-output-panel></lv-output-panel>`);
    const empty = el.shadowRoot!.querySelector('.empty');
    expect(empty).to.exist;
    expect(empty!.textContent).to.contain('No output yet');
  });

  it('renders logged commands live, newest first, with status', async () => {
    const el = await fixture<LvOutputPanel>(html`<lv-output-panel></lv-output-panel>`);

    logGitCommand('checkout', '', true);
    logGitCommand('push', 'authentication failed', false);
    await el.updateComplete;

    const commands = Array.from(
      el.shadowRoot!.querySelectorAll('.entry-command'),
    ).map((n) => n.textContent?.trim());
    expect(commands).to.deep.equal(['push', 'checkout']);
    expect(el.shadowRoot!.querySelector('.status-dot.failure')).to.exist;
    expect(el.shadowRoot!.querySelector('.status-dot.success')).to.exist;
  });

  it('expands a failed entry to show its output', async () => {
    const el = await fixture<LvOutputPanel>(html`<lv-output-panel></lv-output-panel>`);
    logGitCommand('push', 'authentication failed', false);
    await el.updateComplete;

    (el.shadowRoot!.querySelector('.entry-header') as HTMLElement).click();
    await el.updateComplete;

    const output = el.shadowRoot!.querySelector('.entry-output');
    expect(output).to.exist;
    expect(output!.textContent).to.contain('authentication failed');
  });

  it('Clear empties the list', async () => {
    const el = await fixture<LvOutputPanel>(html`<lv-output-panel></lv-output-panel>`);
    logGitCommand('merge', '', true);
    await el.updateComplete;

    (el.shadowRoot!.querySelector('.clear-btn') as HTMLElement).click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(0);
    expect(el.shadowRoot!.querySelector('.empty')).to.exist;
  });

  it('scopes entries to repositoryPath in multi-repo sessions', async () => {
    const el = await fixture<LvOutputPanel>(
      html`<lv-output-panel .repositoryPath=${'/repo/a'}></lv-output-panel>`,
    );

    logGitCommand('checkout', '', true, '/repo/a');
    logGitCommand('merge', '', true, '/repo/b');
    logGitCommand('store_github_token', '', true); // repo-independent
    await el.updateComplete;

    const commands = Array.from(
      el.shadowRoot!.querySelectorAll('.entry-command'),
    ).map((n) => n.textContent?.trim());
    // Other repos' entries are hidden; repo-independent entries stay visible
    expect(commands).to.deep.equal(['store_github_token', 'checkout']);

    // Switching the active repository re-scopes the list
    el.repositoryPath = '/repo/b';
    await el.updateComplete;
    const commandsB = Array.from(
      el.shadowRoot!.querySelectorAll('.entry-command'),
    ).map((n) => n.textContent?.trim());
    expect(commandsB).to.deep.equal(['store_github_token', 'merge']);
  });

  it('shows all entries when repositoryPath is unset', async () => {
    const el = await fixture<LvOutputPanel>(html`<lv-output-panel></lv-output-panel>`);
    logGitCommand('checkout', '', true, '/repo/a');
    logGitCommand('merge', '', true, '/repo/b');
    await el.updateComplete;

    expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(2);
  });

  it('renders no close button by default (injected/standalone usage)', async () => {
    const el = await fixture<LvOutputPanel>(html`<lv-output-panel></lv-output-panel>`);
    expect(el.shadowRoot!.querySelector('.close-btn')).to.not.exist;
  });

  it('closable renders a close button that dispatches a composed close event', async () => {
    const el = await fixture<LvOutputPanel>(html`<lv-output-panel closable></lv-output-panel>`);

    let closed = false;
    el.addEventListener('close', () => {
      closed = true;
    });

    const btn = el.shadowRoot!.querySelector('.close-btn') as HTMLElement;
    expect(btn).to.exist;
    btn.click();
    expect(closed).to.be.true;
  });
});
