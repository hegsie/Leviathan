/**
 * Diff Virtual Scroll Manager
 * Handles virtualization of large diffs for performance
 */

export interface DiffViewport {
  scrollTop: number;
  clientHeight: number;
}

export interface VisibleRange {
  startLine: number;
  endLine: number;
}

export const DIFF_LINE_HEIGHT = 20;
const OVERSCAN_LINES = 30;
const LARGE_DIFF_THRESHOLD = 5000;

/**
 * Manager for diff view virtualization
 */
export class DiffVirtualScrollManager {
  private totalLines = 0;

  /**
   * Set the total number of lines in the diff
   */
  setTotalLines(count: number): void {
    this.totalLines = count;
  }

  /**
   * Get the total content height for the virtual container
   */
  getContentHeight(): number {
    return this.totalLines * DIFF_LINE_HEIGHT;
  }

  /**
   * Whether this diff should be virtualized
   */
  shouldVirtualize(): boolean {
    return this.totalLines > LARGE_DIFF_THRESHOLD;
  }

  /**
   * Get the visible line range for the current viewport
   */
  getVisibleRange(viewport: DiffViewport): VisibleRange {
    const startLine = Math.max(
      0,
      Math.floor(viewport.scrollTop / DIFF_LINE_HEIGHT) - OVERSCAN_LINES
    );
    const visibleLines = Math.ceil(viewport.clientHeight / DIFF_LINE_HEIGHT);
    const endLine = Math.min(
      this.totalLines - 1,
      startLine + visibleLines + OVERSCAN_LINES * 2
    );

    return { startLine, endLine };
  }

  /**
   * Get the total line count
   */
  getTotalLines(): number {
    return this.totalLines;
  }
}
