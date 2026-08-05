/**
 * Every dialog registers its own document-level Escape listener, so a single
 * keypress ran all of them: dismissing the command palette opened over the
 * clean dialog also dismissed the clean dialog, discarding the file selection
 * the user had built. The stack decides which overlay owns the key.
 */

import { expect } from '@open-wc/testing';
import {
  pushOverlay,
  removeOverlay,
  isTopOverlay,
  resetOverlayStack,
} from '../overlay-stack.ts';

describe('overlay-stack', () => {
  beforeEach(() => {
    resetOverlayStack();
  });

  it('treats an unregistered overlay as owning the key', () => {
    // A dialog that never announces itself must keep working, not go dead.
    expect(isTopOverlay({})).to.be.true;
  });

  it('gives the key to the last overlay opened', () => {
    const dialog = {};
    const palette = {};

    pushOverlay(dialog);
    expect(isTopOverlay(dialog)).to.be.true;

    pushOverlay(palette);
    expect(isTopOverlay(palette), 'palette on top').to.be.true;
    expect(isTopOverlay(dialog), 'dialog underneath must ignore Escape').to.be.false;
  });

  it('returns the key to the dialog underneath when the top one closes', () => {
    const dialog = {};
    const palette = {};
    pushOverlay(dialog);
    pushOverlay(palette);

    removeOverlay(palette);

    expect(isTopOverlay(dialog), 'dialog owns the key again').to.be.true;
  });

  it('does not register the same overlay twice', () => {
    const dialog = {};
    const other = {};
    pushOverlay(dialog);
    pushOverlay(other);
    // Re-opening without closing must not leave a stale duplicate behind.
    pushOverlay(other);

    removeOverlay(other);

    expect(isTopOverlay(dialog)).to.be.true;
  });

  it('ignores removal of an overlay that never registered', () => {
    const dialog = {};
    pushOverlay(dialog);

    removeOverlay({});

    expect(isTopOverlay(dialog)).to.be.true;
  });

  it('re-pushing an open overlay moves it to the top', () => {
    const a = {};
    const b = {};
    pushOverlay(a);
    pushOverlay(b);

    pushOverlay(a);

    expect(isTopOverlay(a)).to.be.true;
    expect(isTopOverlay(b)).to.be.false;
  });
});
