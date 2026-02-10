import { expect } from '@open-wc/testing';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

import { DiffVirtualScrollManager, DIFF_LINE_HEIGHT } from '../panels/diff-virtual-scroll.ts';

describe('DiffVirtualScrollManager', () => {
  let manager: DiffVirtualScrollManager;

  beforeEach(() => {
    manager = new DiffVirtualScrollManager();
  });

  describe('shouldVirtualize', () => {
    it('should not virtualize small diffs', () => {
      manager.setTotalLines(100);
      expect(manager.shouldVirtualize()).to.be.false;
    });

    it('should not virtualize diffs at threshold boundary', () => {
      manager.setTotalLines(5000);
      expect(manager.shouldVirtualize()).to.be.false;
    });

    it('should virtualize diffs above threshold', () => {
      manager.setTotalLines(5001);
      expect(manager.shouldVirtualize()).to.be.true;
    });

    it('should virtualize very large diffs', () => {
      manager.setTotalLines(50000);
      expect(manager.shouldVirtualize()).to.be.true;
    });
  });

  describe('getContentHeight', () => {
    it('should return 0 for empty diff', () => {
      manager.setTotalLines(0);
      expect(manager.getContentHeight()).to.equal(0);
    });

    it('should return correct height based on line count', () => {
      manager.setTotalLines(100);
      expect(manager.getContentHeight()).to.equal(100 * DIFF_LINE_HEIGHT);
    });

    it('should return correct height for large diffs', () => {
      manager.setTotalLines(10000);
      expect(manager.getContentHeight()).to.equal(10000 * DIFF_LINE_HEIGHT);
    });
  });

  describe('getVisibleRange', () => {
    it('should return range starting from 0 when scrolled to top', () => {
      manager.setTotalLines(10000);
      const range = manager.getVisibleRange({ scrollTop: 0, clientHeight: 600 });
      expect(range.startLine).to.equal(0);
      expect(range.endLine).to.be.greaterThan(0);
    });

    it('should include overscan lines', () => {
      manager.setTotalLines(10000);
      const range = manager.getVisibleRange({ scrollTop: 0, clientHeight: 600 });
      const visibleLines = Math.ceil(600 / DIFF_LINE_HEIGHT);
      // End should be more than just visible lines (due to overscan)
      expect(range.endLine).to.be.greaterThan(visibleLines);
    });

    it('should calculate correct range when scrolled', () => {
      manager.setTotalLines(10000);
      const scrollTop = 2000;
      const range = manager.getVisibleRange({ scrollTop, clientHeight: 600 });
      const expectedStart = Math.floor(scrollTop / DIFF_LINE_HEIGHT) - 30; // 30 overscan
      expect(range.startLine).to.equal(Math.max(0, expectedStart));
    });

    it('should not exceed total lines', () => {
      manager.setTotalLines(100);
      const range = manager.getVisibleRange({ scrollTop: 0, clientHeight: 10000 });
      expect(range.endLine).to.be.at.most(99);
    });

    it('should clamp start to 0', () => {
      manager.setTotalLines(10000);
      const range = manager.getVisibleRange({ scrollTop: 0, clientHeight: 600 });
      expect(range.startLine).to.be.at.least(0);
    });
  });

  describe('getTotalLines', () => {
    it('should return set total lines', () => {
      manager.setTotalLines(42);
      expect(manager.getTotalLines()).to.equal(42);
    });

    it('should default to 0', () => {
      expect(manager.getTotalLines()).to.equal(0);
    });
  });
});
