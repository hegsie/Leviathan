import { expect } from '@open-wc/testing';
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
