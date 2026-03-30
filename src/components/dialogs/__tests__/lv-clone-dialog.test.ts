/**
 * Tests for lv-clone-dialog component
 *
 * Tests URL parsing, form validation, clone flow, progress tracking,
 * error handling, and event dispatching.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// Mock the Tauri event plugin internals (used by @tauri-apps/api/event)
(globalThis as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  convertCallback: (callback: unknown, once: boolean) => { void once; void callback; return 0; },
  unregisterListener: (_event: string, _eventId: number) => {},
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import '../lv-clone-dialog.ts';
import type { LvCloneDialog } from '../lv-clone-dialog.ts';

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-clone-dialog', () => {
  let el: LvCloneDialog;

  beforeEach(async () => {
    mockInvoke = () => Promise.resolve(null);

    el = await fixture<LvCloneDialog>(html`
      <lv-clone-dialog></lv-clone-dialog>
    `);
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders without errors', () => {
      expect(el).to.exist;
      expect(el.tagName.toLowerCase()).to.equal('lv-clone-dialog');
    });

    it('renders URL input field', () => {
      const urlInput = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      expect(urlInput).to.exist;
      expect(urlInput.placeholder).to.include('github.com');
    });

    it('renders destination input field', () => {
      const destInput = el.shadowRoot!.querySelector('#destination') as HTMLInputElement;
      expect(destInput).to.exist;
    });

    it('renders Browse button', () => {
      const browseBtn = el.shadowRoot!.querySelector('.browse-btn') as HTMLButtonElement;
      expect(browseBtn).to.exist;
      expect(browseBtn.textContent).to.include('Browse');
    });

    it('renders Clone and Cancel buttons', () => {
      const buttons = el.shadowRoot!.querySelectorAll('.btn');
      const buttonTexts = Array.from(buttons).map(b => b.textContent!.trim());
      expect(buttonTexts).to.include('Cancel');
      expect(buttonTexts).to.include('Clone');
    });

    it('renders shallow clone depth field', () => {
      const depthInput = el.shadowRoot!.querySelector('#depth') as HTMLInputElement;
      expect(depthInput).to.exist;
      expect(depthInput.type).to.equal('number');
    });

    it('renders partial clone filter select', () => {
      const filterSelect = el.shadowRoot!.querySelector('#filter') as HTMLSelectElement;
      expect(filterSelect).to.exist;
      const options = filterSelect.querySelectorAll('option');
      expect(options.length).to.be.greaterThanOrEqual(3);
    });

    it('renders single-branch checkbox', () => {
      const checkbox = el.shadowRoot!.querySelector('#single-branch') as HTMLInputElement;
      expect(checkbox).to.exist;
      expect(checkbox.type).to.equal('checkbox');
    });
  });

  // ── URL parsing ────────────────────────────────────────────────────────
  describe('URL parsing', () => {
    it('extracts repo name from HTTPS URL', async () => {
      const input = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      input.value = 'https://github.com/user/my-repo.git';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const preview = el.shadowRoot!.querySelector('.repo-name-preview');
      expect(preview).to.exist;
      expect(preview!.textContent).to.include('my-repo');
    });

    it('extracts repo name from SSH URL', async () => {
      const input = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      input.value = 'git@github.com:user/my-repo.git';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const preview = el.shadowRoot!.querySelector('.repo-name-preview');
      expect(preview).to.exist;
      expect(preview!.textContent).to.include('my-repo');
    });

    it('extracts repo name without .git suffix', async () => {
      const input = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      input.value = 'https://github.com/user/repo-name';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const preview = el.shadowRoot!.querySelector('.repo-name-preview');
      expect(preview!.textContent).to.include('repo-name');
    });

    it('handles trailing slash in URL', async () => {
      const input = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      input.value = 'https://github.com/user/my-repo/';
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const preview = el.shadowRoot!.querySelector('.repo-name-preview');
      expect(preview!.textContent).to.include('my-repo');
    });

    it('returns empty repo name for empty URL', () => {
      const extractRepoName = (el as unknown as {
        extractRepoName: (url: string) => string;
      }).extractRepoName.bind(el);

      expect(extractRepoName('')).to.equal('');
    });
  });

  // ── Form validation ────────────────────────────────────────────────────
  describe('form validation', () => {
    it('disables Clone button when URL is empty', async () => {
      const cloneBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(cloneBtn.disabled).to.be.true;
    });

    it('disables Clone button when destination is empty', async () => {
      const urlInput = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      urlInput.value = 'https://github.com/user/repo.git';
      urlInput.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const cloneBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(cloneBtn.disabled).to.be.true;
    });

    it('enables Clone button when URL and destination are provided', async () => {
      const urlInput = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      urlInput.value = 'https://github.com/user/repo.git';
      urlInput.dispatchEvent(new Event('input'));

      const destInput = el.shadowRoot!.querySelector('#destination') as HTMLInputElement;
      destInput.value = '/home/user/projects';
      destInput.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const cloneBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(cloneBtn.disabled).to.be.false;
    });

    it('shows error when cloning with empty URL', async () => {
      // Directly call handleClone
      const handleClone = (el as unknown as {
        handleClone: () => Promise<void>;
      }).handleClone.bind(el);

      await handleClone();
      await el.updateComplete;

      const error = el.shadowRoot!.querySelector('.error-message');
      expect(error).to.exist;
      expect(error!.textContent).to.include('URL');
    });

    it('shows error when cloning with empty destination', async () => {
      // Set URL but not destination
      const internal = el as unknown as { url: string; destination: string };
      internal.url = 'https://github.com/user/repo.git';
      internal.destination = '';

      const handleClone = (el as unknown as {
        handleClone: () => Promise<void>;
      }).handleClone.bind(el);

      await handleClone();
      await el.updateComplete;

      const error = el.shadowRoot!.querySelector('.error-message');
      expect(error).to.exist;
      expect(error!.textContent).to.include('destination');
    });

    it('clears error when URL is changed', async () => {
      // Set error first
      const internal = el as unknown as { error: string };
      internal.error = 'Some error';
      await el.updateComplete;

      const urlInput = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      urlInput.value = 'https://github.com/user/repo.git';
      urlInput.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const error = el.shadowRoot!.querySelector('.error-message');
      expect(error).to.not.exist;
    });
  });

  // ── Full path computation ──────────────────────────────────────────────
  describe('full path', () => {
    it('computes full path with repo name', async () => {
      const internal = el as unknown as { url: string; destination: string; repoName: string };
      internal.url = 'https://github.com/user/my-repo.git';
      internal.repoName = 'my-repo';
      internal.destination = '/home/user/projects';
      await el.updateComplete;

      const fullPath = (el as unknown as { fullPath: string }).fullPath;
      expect(fullPath).to.equal('/home/user/projects/my-repo');
    });

    it('returns just destination when no repo name', () => {
      const internal = el as unknown as { destination: string; repoName: string };
      internal.destination = '/home/user/projects';
      internal.repoName = '';

      const fullPath = (el as unknown as { fullPath: string }).fullPath;
      expect(fullPath).to.equal('/home/user/projects');
    });

    it('returns empty string when no destination', () => {
      const internal = el as unknown as { destination: string };
      internal.destination = '';

      const fullPath = (el as unknown as { fullPath: string }).fullPath;
      expect(fullPath).to.equal('');
    });
  });

  // ── Clone state ────────────────────────────────────────────────────────
  describe('clone state', () => {
    it('disables inputs during clone', async () => {
      const internal = el as unknown as { isCloning: boolean };
      internal.isCloning = true;
      await el.updateComplete;

      const urlInput = el.shadowRoot!.querySelector('#url') as HTMLInputElement;
      const destInput = el.shadowRoot!.querySelector('#destination') as HTMLInputElement;
      const browseBtn = el.shadowRoot!.querySelector('.browse-btn') as HTMLButtonElement;

      expect(urlInput.disabled).to.be.true;
      expect(destInput.disabled).to.be.true;
      expect(browseBtn.disabled).to.be.true;
    });

    it('shows progress section during clone', async () => {
      const internal = el as unknown as { isCloning: boolean; progressText: string; progress: number };
      internal.isCloning = true;
      internal.progressText = 'Receiving objects: 50/100';
      internal.progress = 50;
      await el.updateComplete;

      const progressSection = el.shadowRoot!.querySelector('.progress-section');
      expect(progressSection).to.exist;

      const progressText = el.shadowRoot!.querySelector('.progress-text');
      expect(progressText!.textContent).to.include('50/100');
    });

    it('shows progress bar with correct width', async () => {
      const internal = el as unknown as { isCloning: boolean; progress: number; progressText: string };
      internal.isCloning = true;
      internal.progress = 75;
      internal.progressText = 'Cloning...';
      await el.updateComplete;

      const fill = el.shadowRoot!.querySelector('.progress-bar-fill') as HTMLElement;
      expect(fill.style.width).to.equal('75%');
    });

    it('shows "Cloning..." button text during clone', async () => {
      const internal = el as unknown as { isCloning: boolean; url: string; destination: string };
      internal.isCloning = true;
      internal.url = 'https://github.com/user/repo.git';
      internal.destination = '/path';
      await el.updateComplete;

      const cloneBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(cloneBtn.textContent!.trim()).to.include('Cloning');
    });
  });

  // ── Depth and options ──────────────────────────────────────────────────
  describe('depth and options', () => {
    it('sets depth from input', async () => {
      const depthInput = el.shadowRoot!.querySelector('#depth') as HTMLInputElement;
      depthInput.value = '5';
      depthInput.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const internal = el as unknown as { depth: number | null };
      expect(internal.depth).to.equal(5);
    });

    it('sets depth to null for empty input', async () => {
      const depthInput = el.shadowRoot!.querySelector('#depth') as HTMLInputElement;
      depthInput.value = '';
      depthInput.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const internal = el as unknown as { depth: number | null };
      expect(internal.depth).to.be.null;
    });

    it('sets depth to null for non-numeric input', async () => {
      const depthInput = el.shadowRoot!.querySelector('#depth') as HTMLInputElement;
      depthInput.value = 'abc';
      depthInput.dispatchEvent(new Event('input'));
      await el.updateComplete;

      const internal = el as unknown as { depth: number | null };
      expect(internal.depth).to.be.null;
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────────
  describe('reset', () => {
    it('resets all state when reset is called', async () => {
      const internal = el as unknown as {
        url: string;
        destination: string;
        repoName: string;
        depth: number | null;
        isCloning: boolean;
        progress: number;
        progressText: string;
        error: string;
        reset: () => void;
      };

      // Set some state
      internal.url = 'https://github.com/user/repo.git';
      internal.destination = '/path';
      internal.repoName = 'repo';
      internal.depth = 5;
      internal.error = 'some error';
      internal.progress = 50;
      internal.progressText = 'cloning';

      internal.reset();

      expect(internal.url).to.equal('');
      expect(internal.destination).to.equal('');
      expect(internal.repoName).to.equal('');
      expect(internal.depth).to.be.null;
      expect(internal.isCloning).to.be.false;
      expect(internal.progress).to.equal(0);
      expect(internal.progressText).to.equal('');
      expect(internal.error).to.equal('');
    });
  });

  // ── formatBytes ────────────────────────────────────────────────────────
  describe('formatBytes', () => {
    it('formats bytes correctly', () => {
      const formatBytes = (el as unknown as {
        formatBytes: (bytes: number) => string;
      }).formatBytes.bind(el);

      expect(formatBytes(500)).to.equal('500 B');
      expect(formatBytes(1024)).to.equal('1.0 KB');
      expect(formatBytes(1536)).to.equal('1.5 KB');
      expect(formatBytes(1048576)).to.equal('1.0 MB');
      expect(formatBytes(2621440)).to.equal('2.5 MB');
    });
  });

  // ── Modal close behavior ───────────────────────────────────────────────
  describe('modal close', () => {
    it('does not reset when cloning is in progress', async () => {
      const internal = el as unknown as {
        isCloning: boolean;
        url: string;
        handleModalClose: () => void;
      };

      internal.isCloning = true;
      internal.url = 'https://github.com/user/repo.git';

      internal.handleModalClose();

      // URL should still be set since cloning is in progress
      expect(internal.url).to.equal('https://github.com/user/repo.git');
    });

    it('resets when not cloning', async () => {
      const internal = el as unknown as {
        isCloning: boolean;
        url: string;
        handleModalClose: () => void;
      };

      internal.isCloning = false;
      internal.url = 'https://github.com/user/repo.git';

      internal.handleModalClose();

      expect(internal.url).to.equal('');
    });
  });
});
