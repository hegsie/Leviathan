import { expect } from '@open-wc/testing';
import { formatShortcut, matchesShortcut } from '../platform.ts';

describe('platform', () => {
  describe('formatShortcut', () => {
    it('should format simple key names', () => {
      // On non-macOS (linux test env), should use + separator
      const result = formatShortcut(['ctrl', 's']);
      expect(result).to.be.a('string');
      expect(result.length).to.be.greaterThan(0);
    });

    it('should handle single key', () => {
      const result = formatShortcut(['escape']);
      expect(result).to.be.a('string');
    });

    it('should handle multiple keys', () => {
      const result = formatShortcut(['ctrl', 'shift', 'p']);
      expect(result).to.be.a('string');
      expect(result.length).to.be.greaterThan(0);
    });

    it('should handle empty array', () => {
      const result = formatShortcut([]);
      expect(result).to.equal('');
    });
  });

  describe('matchesShortcut', () => {
    function createKeyEvent(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
      return new KeyboardEvent('keydown', {
        key,
        ctrlKey: opts.ctrlKey ?? false,
        altKey: opts.altKey ?? false,
        shiftKey: opts.shiftKey ?? false,
        metaKey: opts.metaKey ?? false,
      });
    }

    it('should match a simple key press', () => {
      const event = createKeyEvent('a');
      expect(matchesShortcut(event, 'a')).to.be.true;
    });

    it('should not match wrong key', () => {
      const event = createKeyEvent('b');
      expect(matchesShortcut(event, 'a')).to.be.false;
    });

    it('should match with ctrl modifier', () => {
      const event = createKeyEvent('s', { ctrlKey: true });
      expect(matchesShortcut(event, 's', { ctrl: true })).to.be.true;
    });

    it('should not match when ctrl is expected but not pressed', () => {
      const event = createKeyEvent('s');
      expect(matchesShortcut(event, 's', { ctrl: true })).to.be.false;
    });

    it('should not match when ctrl is not expected but pressed', () => {
      const event = createKeyEvent('s', { ctrlKey: true });
      expect(matchesShortcut(event, 's')).to.be.false;
    });

    it('should match with shift modifier', () => {
      const event = createKeyEvent('p', { ctrlKey: true, shiftKey: true });
      expect(matchesShortcut(event, 'p', { ctrl: true, shift: true })).to.be.true;
    });

    it('should match with alt modifier', () => {
      const event = createKeyEvent('x', { altKey: true });
      expect(matchesShortcut(event, 'x', { alt: true })).to.be.true;
    });

    it('should match with meta modifier', () => {
      const event = createKeyEvent('c', { metaKey: true });
      expect(matchesShortcut(event, 'c', { meta: true })).to.be.true;
    });

    it('should be case-insensitive for key', () => {
      const event = createKeyEvent('A');
      expect(matchesShortcut(event, 'a')).to.be.true;
    });

    it('should match all modifiers combined', () => {
      const event = createKeyEvent('z', { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true });
      expect(matchesShortcut(event, 'z', { ctrl: true, alt: true, shift: true, meta: true })).to.be.true;
    });
  });
});
