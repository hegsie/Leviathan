import { expect } from '@open-wc/testing';

// Mock Tauri API before importing modules that use @tauri-apps/plugin-shell
if (!(globalThis as Record<string, unknown>).__TAURI_INTERNALS__) {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: (_command: string): Promise<unknown> => Promise.resolve(null),
  };
}

import { handleExternalLink } from '../external-link.ts';

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
  });
});
