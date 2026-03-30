/**
 * Tests for lv-command-palette component
 *
 * Tests command palette core behavior: rendering, keyboard navigation,
 * search filtering, command execution, recent commands, and event dispatching.
 */

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

import { expect, fixture, html } from '@open-wc/testing';
import '../lv-command-palette.ts';
import type { LvCommandPalette, PaletteCommand } from '../lv-command-palette.ts';
import type { Branch, Commit } from '../../../types/git.types.ts';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCommand(overrides: Partial<PaletteCommand> = {}): PaletteCommand {
  return {
    id: 'test-cmd',
    label: 'Test Command',
    category: 'action',
    action: () => {},
    ...overrides,
  };
}

function makeBranch(name: string): Branch {
  return {
    name,
    shorthand: name,
    isHead: false,
    isRemote: false,
    upstream: null,
    targetOid: 'abc123',
    isStale: false,
  };
}

function makeCommit(oid: string, summary: string): Commit {
  return {
    oid,
    shortId: oid.substring(0, 7),
    message: summary,
    summary,
    body: null,
    author: { name: 'Test', email: 'test@test.com', timestamp: 0 },
    committer: { name: 'Test', email: 'test@test.com', timestamp: 0 },
    parentIds: [],
    timestamp: 0,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('lv-command-palette', () => {
  let el: LvCommandPalette;

  const testCommands: PaletteCommand[] = [
    makeCommand({ id: 'fetch', label: 'Fetch from remote', icon: 'fetch' }),
    makeCommand({ id: 'push', label: 'Push to remote', icon: 'push' }),
    makeCommand({ id: 'pull', label: 'Pull from remote', icon: 'pull' }),
    makeCommand({ id: 'settings', label: 'Open Settings', icon: 'settings', shortcut: '⌘,' }),
  ];

  const testBranches: Branch[] = [
    makeBranch('main'),
    makeBranch('feature/login'),
    makeBranch('bugfix/crash'),
  ];

  beforeEach(async () => {
    // Clear localStorage between tests
    localStorage.removeItem('leviathan-recent-commands');

    el = await fixture<LvCommandPalette>(html`
      <lv-command-palette
        .commands=${testCommands}
        .branches=${testBranches}
        .files=${[]}
        .commits=${[]}
      ></lv-command-palette>
    `);
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders without errors', () => {
      expect(el).to.exist;
      expect(el.tagName.toLowerCase()).to.equal('lv-command-palette');
    });

    it('renders search input', () => {
      const input = el.shadowRoot!.querySelector('.search-input');
      expect(input).to.exist;
      expect(input!.getAttribute('placeholder')).to.include('Search');
    });

    it('renders results container', () => {
      const results = el.shadowRoot!.querySelector('.results');
      expect(results).to.exist;
    });

    it('renders footer with keyboard hints', () => {
      const footer = el.shadowRoot!.querySelector('.footer');
      expect(footer).to.exist;
      expect(footer!.textContent).to.include('navigate');
      expect(footer!.textContent).to.include('select');
      expect(footer!.textContent).to.include('close');
    });

    it('shows command shortcuts when defined', async () => {
      el.open = true;
      await el.updateComplete;

      const shortcuts = el.shadowRoot!.querySelectorAll('.command-shortcut');
      const shortcutTexts = Array.from(shortcuts).map(s => s.textContent!.trim());
      expect(shortcutTexts).to.include('⌘,');
    });
  });

  // ── Open/Close behavior ────────────────────────────────────────────────
  describe('open/close', () => {
    it('starts closed (display:none via :host)', () => {
      expect(el.open).to.be.false;
    });

    it('resets search query when opened', async () => {
      // Set some state first
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.value = 'test search';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      // Verify state was set
      const internal = el as unknown as { searchQuery: string };
      expect(internal.searchQuery).to.equal('test search');

      // Close and reopen
      el.open = false;
      await el.updateComplete;
      el.open = true;
      await el.updateComplete;
      // Wait for requestAnimationFrame focus callback
      await new Promise(r => requestAnimationFrame(r));
      await el.updateComplete;

      expect(internal.searchQuery).to.equal('');
    });

    it('resets selected index when opened', async () => {
      el.open = true;
      await el.updateComplete;

      const internal = el as unknown as { selectedIndex: number };
      expect(internal.selectedIndex).to.equal(0);
    });

    it('dispatches close event when close() is called', async () => {
      el.open = true;
      await el.updateComplete;

      let closeFired = false;
      el.addEventListener('close', () => { closeFired = true; });

      el.close();
      expect(closeFired).to.be.true;
      expect(el.open).to.be.false;
    });

    it('closes when overlay is clicked', async () => {
      el.open = true;
      await el.updateComplete;

      const overlay = el.shadowRoot!.querySelector('.overlay') as HTMLElement;
      overlay.click();
      expect(el.open).to.be.false;
    });
  });

  // ── Filtering ──────────────────────────────────────────────────────────
  describe('filtering', () => {
    it('shows action and branch commands when query is empty', async () => {
      el.open = true;
      await el.updateComplete;

      const internal = el as unknown as { filteredCommands: Array<{ category: string }> };
      const categories = new Set(internal.filteredCommands.map(c => c.category));
      expect(categories.has('action') || categories.has('branch') || categories.has('recent')).to.be.true;
      expect(categories.has('file')).to.be.false;
      expect(categories.has('commit')).to.be.false;
    });

    it('filters commands by search query', async () => {
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.value = 'push';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const internal = el as unknown as { filteredCommands: Array<{ label: string }> };
      expect(internal.filteredCommands.length).to.be.greaterThan(0);
      expect(internal.filteredCommands.some(c => c.label.toLowerCase().includes('push'))).to.be.true;
    });

    it('shows "No matching commands" when nothing matches', async () => {
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.value = 'zzzzznonexistent';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const empty = el.shadowRoot!.querySelector('.empty');
      expect(empty).to.exist;
      expect(empty!.textContent).to.include('No matching commands');
    });

    it('includes file commands when query has 2+ characters', async () => {
      el.files = ['src/main.ts', 'src/app.ts'];
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.value = 'main';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const internal = el as unknown as { filteredCommands: Array<{ category: string }> };
      expect(internal.filteredCommands.some(c => c.category === 'file')).to.be.true;
    });

    it('excludes file and commit commands with single char query', async () => {
      el.files = ['src/main.ts'];
      el.commits = [makeCommit('abc123def', 'Fix bug')];
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.value = 'm';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const internal = el as unknown as { filteredCommands: Array<{ category: string }> };
      expect(internal.filteredCommands.every(c => c.category !== 'file' && c.category !== 'commit')).to.be.true;
    });

    it('caps results at 50', async () => {
      const manyFiles = Array.from({ length: 100 }, (_, i) => `src/component-${i}.ts`);
      el.files = manyFiles;
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.value = 'component';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const internal = el as unknown as { filteredCommands: Array<{ id: string }> };
      expect(internal.filteredCommands.length).to.be.at.most(50);
    });
  });

  // ── Keyboard navigation ────────────────────────────────────────────────
  describe('keyboard navigation', () => {
    it('moves selection down with ArrowDown', async () => {
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await el.updateComplete;

      const internal = el as unknown as { selectedIndex: number };
      expect(internal.selectedIndex).to.equal(1);
    });

    it('moves selection up with ArrowUp', async () => {
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      // Move down first
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await el.updateComplete;

      const internal = el as unknown as { selectedIndex: number };
      expect(internal.selectedIndex).to.equal(2);

      // Move up
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await el.updateComplete;
      expect(internal.selectedIndex).to.equal(1);
    });

    it('does not go below 0 with ArrowUp', async () => {
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await el.updateComplete;

      const internal = el as unknown as { selectedIndex: number };
      expect(internal.selectedIndex).to.equal(0);
    });

    it('closes on Escape key', async () => {
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(el.open).to.be.false;
    });

    it('executes selected command on Enter', async () => {
      let executed = false;
      el.commands = [makeCommand({ id: 'test', label: 'Test', action: () => { executed = true; } })];
      el.open = true;
      await el.updateComplete;

      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(executed).to.be.true;
    });
  });

  // ── Command execution ──────────────────────────────────────────────────
  describe('command execution', () => {
    it('closes palette after executing command', async () => {
      el.commands = [makeCommand({ id: 'test', label: 'Test Action' })];
      el.open = true;
      await el.updateComplete;

      const command = el.shadowRoot!.querySelector('.command') as HTMLElement;
      command?.click();

      expect(el.open).to.be.false;
    });

    it('dispatches checkout-branch event for branch commands', async () => {
      el.open = true;
      await el.updateComplete;

      let eventDetail: { branch: string } | null = null;
      el.addEventListener('checkout-branch', ((e: CustomEvent) => {
        eventDetail = e.detail;
      }) as EventListener);

      // Find and execute a branch command
      const internal = el as unknown as {
        filteredCommands: Array<{ id: string; category: string; action: () => void }>;
      };
      const branchCmd = internal.filteredCommands.find(c => c.category === 'branch');
      expect(branchCmd).to.exist;
      branchCmd!.action();

      expect(eventDetail).to.not.be.null;
      expect(eventDetail!.branch).to.be.a('string');
    });

    it('dispatches open-file event for file commands', async () => {
      el.files = ['src/utils.ts'];
      el.open = true;
      await el.updateComplete;

      let eventDetail: { path: string } | null = null;
      el.addEventListener('open-file', ((e: CustomEvent) => {
        eventDetail = e.detail;
      }) as EventListener);

      const allCommands = (el as unknown as {
        getAllCommands: () => Array<{ category: string; action: () => void }>;
      }).getAllCommands();
      const fileCmd = allCommands.find(c => c.category === 'file');
      fileCmd!.action();

      expect(eventDetail).to.not.be.null;
      expect(eventDetail!.path).to.equal('src/utils.ts');
    });

    it('dispatches navigate-to-commit event for commit commands', async () => {
      el.commits = [makeCommit('abc123def456', 'Initial commit')];
      el.open = true;
      await el.updateComplete;

      let eventDetail: { oid: string } | null = null;
      el.addEventListener('navigate-to-commit', ((e: CustomEvent) => {
        eventDetail = e.detail;
      }) as EventListener);

      const allCommands = (el as unknown as {
        getAllCommands: () => Array<{ category: string; action: () => void }>;
      }).getAllCommands();
      const commitCmd = allCommands.find(c => c.category === 'commit');
      commitCmd!.action();

      expect(eventDetail).to.not.be.null;
      expect(eventDetail!.oid).to.equal('abc123def456');
    });
  });

  // ── Recent commands ────────────────────────────────────────────────────
  describe('recent commands', () => {
    it('saves executed command to recent list', async () => {
      el.commands = [makeCommand({ id: 'fetch', label: 'Fetch' })];
      el.open = true;
      await el.updateComplete;

      // Execute the command
      const input = el.shadowRoot!.querySelector('.search-input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const stored = JSON.parse(localStorage.getItem('leviathan-recent-commands') || '[]');
      expect(stored).to.include('fetch');
    });

    it('shows recent commands when query is empty', async () => {
      // Pre-populate recent commands
      localStorage.setItem('leviathan-recent-commands', JSON.stringify(['fetch']));

      el = await fixture<LvCommandPalette>(html`
        <lv-command-palette
          .commands=${testCommands}
          .branches=${testBranches}
          .files=${[]}
          .commits=${[]}
        ></lv-command-palette>
      `);

      el.open = true;
      await el.updateComplete;

      const internal = el as unknown as { filteredCommands: Array<{ category: string }> };
      expect(internal.filteredCommands.some(c => c.category === 'recent')).to.be.true;
    });

    it('limits recent commands to 5', async () => {
      // Pre-populate with 6 commands
      localStorage.setItem('leviathan-recent-commands', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']));

      el = await fixture<LvCommandPalette>(html`
        <lv-command-palette
          .commands=${testCommands}
          .branches=${[]}
          .files=${[]}
          .commits=${[]}
        ></lv-command-palette>
      `);

      const internal = el as unknown as { recentCommands: string[] };
      // loadRecentCommands reads from localStorage as-is; saveRecentCommand slices to 5
      // But the loaded list might still have 6 since it's raw read
      // After executing a command, it gets trimmed
      const saveRecentCommand = (el as unknown as {
        saveRecentCommand: (id: string) => void;
      }).saveRecentCommand.bind(el);

      saveRecentCommand('new-cmd');
      const stored = JSON.parse(localStorage.getItem('leviathan-recent-commands') || '[]');
      expect(stored.length).to.be.at.most(5);
    });

    it('deduplicates recent commands', async () => {
      const saveRecentCommand = (el as unknown as {
        saveRecentCommand: (id: string) => void;
      }).saveRecentCommand.bind(el);

      saveRecentCommand('fetch');
      saveRecentCommand('push');
      saveRecentCommand('fetch'); // duplicate

      const stored = JSON.parse(localStorage.getItem('leviathan-recent-commands') || '[]');
      const fetchCount = stored.filter((id: string) => id === 'fetch').length;
      expect(fetchCount).to.equal(1);
      // Most recent should be first
      expect(stored[0]).to.equal('fetch');
    });
  });

  // ── Category labels ────────────────────────────────────────────────────
  describe('category labels', () => {
    it('returns correct labels for all categories', () => {
      const getCategoryLabel = (el as unknown as {
        getCategoryLabel: (cat: string) => string;
      }).getCategoryLabel.bind(el);

      expect(getCategoryLabel('recent')).to.equal('Recent');
      expect(getCategoryLabel('action')).to.equal('Actions');
      expect(getCategoryLabel('branch')).to.equal('Branches');
      expect(getCategoryLabel('navigation')).to.equal('Navigation');
      expect(getCategoryLabel('file')).to.equal('Files');
      expect(getCategoryLabel('commit')).to.equal('Commits');
    });
  });

  // ── Command grouping ──────────────────────────────────────────────────
  describe('command grouping', () => {
    it('groups commands by category in rendered output', async () => {
      el.open = true;
      await el.updateComplete;

      const categories = el.shadowRoot!.querySelectorAll('.category');
      expect(categories.length).to.be.greaterThan(0);
    });

    it('marks selected command with selected class', async () => {
      el.open = true;
      await el.updateComplete;

      const selected = el.shadowRoot!.querySelector('.command.selected');
      expect(selected).to.exist;
    });

    it('updates selection on mouse enter', async () => {
      el.open = true;
      await el.updateComplete;

      const commands = el.shadowRoot!.querySelectorAll('.command');
      if (commands.length > 1) {
        (commands[1] as HTMLElement).dispatchEvent(new MouseEvent('mouseenter'));
        await el.updateComplete;

        const internal = el as unknown as { selectedIndex: number };
        expect(internal.selectedIndex).to.equal(1);
      }
    });
  });
});
