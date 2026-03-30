import { expect } from '@open-wc/testing';

// Mock Tauri API before importing modules that use @tauri-apps/plugin-shell
if (!(globalThis as Record<string, unknown>).__TAURI_INTERNALS__) {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: (_command: string): Promise<unknown> => Promise.resolve(null),
  };
}

import { handleExternalLink, openExternalUrl } from '../external-link.ts';

describe('external-link', () => {
  describe('handleExternalLink', () => {
    it('should prevent default event behavior', () => {
      let defaultPrevented = false;
      const event = {
        preventDefault: () => { defaultPrevented = true; },
        currentTarget: {
          href: 'https://example.com',
        } as HTMLAnchorElement,
      } as unknown as Event;

      handleExternalLink(event);
      expect(defaultPrevented).to.be.true;
    });

    it('should not throw when href is empty', () => {
      const event = {
        preventDefault: () => {},
        currentTarget: {
          href: '',
        } as HTMLAnchorElement,
      } as unknown as Event;

      expect(() => handleExternalLink(event)).to.not.throw();
    });

    it('should not throw when href is a valid URL', () => {
      const event = {
        preventDefault: () => {},
        currentTarget: {
          href: 'https://github.com/test/repo',
        } as HTMLAnchorElement,
      } as unknown as Event;

      expect(() => handleExternalLink(event)).to.not.throw();
    });
  });

  describe('openExternalUrl', () => {
    it('should not throw for a valid URL', async () => {
      // In test environment, Tauri open will fail but it should fall back to window.open
      await openExternalUrl('https://example.com');
    });

    it('should not throw for empty string', async () => {
      await openExternalUrl('');
    });

    it('should handle various URL protocols', async () => {
      await openExternalUrl('https://example.com');
      await openExternalUrl('http://example.com');
    });
  });
});
