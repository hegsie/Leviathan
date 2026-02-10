import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
const mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    return mockInvoke(command, args);
  },
};

import { LvCommitPanel } from '../lv-commit-panel.ts';

describe('lv-commit-panel template variable expansion', () => {
  let panel: LvCommitPanel;

  beforeEach(() => {
    panel = new LvCommitPanel();
  });

  it('replaces ${branch} with current branch name', () => {
    (panel as unknown as { currentBranch: string }).currentBranch = 'feature/my-branch';
    const result = panel.expandTemplateVariables('Working on ${branch}');
    expect(result).to.equal('Working on feature/my-branch');
  });

  it('replaces ${date} with YYYY-MM-DD format', () => {
    const result = panel.expandTemplateVariables('Date: ${date}');
    const today = new Date().toISOString().slice(0, 10);
    expect(result).to.equal(`Date: ${today}`);
  });

  it('replaces ${datetime} with YYYY-MM-DD HH:MM format', () => {
    const result = panel.expandTemplateVariables('At: ${datetime}');
    expect(result).to.match(/^At: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('replaces ${author} with git user name', () => {
    (panel as unknown as { cachedAuthor: string }).cachedAuthor = 'Jane Doe';
    const result = panel.expandTemplateVariables('Author: ${author}');
    expect(result).to.equal('Author: Jane Doe');
  });

  it('leaves unknown variables as-is', () => {
    const result = panel.expandTemplateVariables('Unknown: ${unknown}');
    expect(result).to.equal('Unknown: ${unknown}');
  });

  it('expands multiple variables in one template', () => {
    (panel as unknown as { currentBranch: string }).currentBranch = 'main';
    (panel as unknown as { cachedAuthor: string }).cachedAuthor = 'Dev';
    const today = new Date().toISOString().slice(0, 10);
    const result = panel.expandTemplateVariables('[${branch}] ${date} by ${author}');
    expect(result).to.equal(`[main] ${today} by Dev`);
  });

  it('handles empty branch gracefully', () => {
    (panel as unknown as { currentBranch: string }).currentBranch = '';
    const result = panel.expandTemplateVariables('Branch: ${branch}');
    expect(result).to.equal('Branch: ');
  });

  it('handles multiple occurrences of the same variable', () => {
    (panel as unknown as { currentBranch: string }).currentBranch = 'dev';
    const result = panel.expandTemplateVariables('${branch} and ${branch}');
    expect(result).to.equal('dev and dev');
  });

  it('handles template with no variables', () => {
    const result = panel.expandTemplateVariables('No variables here');
    expect(result).to.equal('No variables here');
  });
});
