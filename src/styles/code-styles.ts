import { css } from 'lit';

/**
 * Shared code rendering styles
 * Used across diff-view, merge-editor, and blame-view components
 * for consistent diff colors, line numbers, whitespace highlights,
 * and conflict block styling.
 *
 * Import into component static styles array before component-specific CSS
 * so that component overrides naturally win via source order specificity.
 */
export const codeStyles = css`
  /* Line number styling */
  .code-line-no {
    color: var(--color-text-muted);
    background: var(--color-bg-secondary);
    text-align: right;
    border-right: 1px solid var(--color-border);
    user-select: none;
  }

  /* Line content styling */
  .code-line-content {
    padding: 0 var(--spacing-sm);
    white-space: pre;
  }

  /* Addition (green) */
  .code-addition {
    background: var(--color-diff-add-bg);
  }

  .code-addition .code-line-no,
  .code-addition .line-no,
  .code-addition .split-line-no,
  .code-addition .line-number {
    background: var(--color-diff-add-line-bg);
  }

  .code-addition .line-content,
  .code-addition .split-line-content {
    background: var(--color-diff-add-bg);
  }

  /* Deletion (red) */
  .code-deletion {
    background: var(--color-diff-del-bg);
  }

  .code-deletion .code-line-no,
  .code-deletion .line-no,
  .code-deletion .split-line-no,
  .code-deletion .line-number {
    background: var(--color-diff-del-line-bg);
  }

  .code-deletion .line-content,
  .code-deletion .split-line-content {
    background: var(--color-diff-del-bg);
  }

  /* Whitespace-only change (yellow) */
  .code-ws-change {
    background: var(--color-diff-ws-bg);
  }

  .code-ws-change .code-line-no,
  .code-ws-change .line-no,
  .code-ws-change .split-line-no,
  .code-ws-change .line-number {
    background: var(--color-diff-ws-bg);
  }

  .code-ws-change .line-content,
  .code-ws-change .split-line-content {
    background: var(--color-diff-ws-bg);
  }

  /* Inline whitespace highlight marker */
  .code-ws-highlight {
    background: var(--color-diff-ws-highlight);
    border-radius: 2px;
  }

  /* Conflict buttons */
  .code-conflict-btn-ours {
    background: rgba(var(--color-success-rgb, 34, 197, 94), 0.15);
    border: 1px solid var(--color-success);
    color: var(--color-success);
  }

  .code-conflict-btn-ours:hover {
    background: rgba(var(--color-success-rgb, 34, 197, 94), 0.25);
  }

  .code-conflict-btn-theirs {
    background: rgba(var(--color-info-rgb, 59, 130, 246), 0.15);
    border: 1px solid var(--color-info);
    color: var(--color-info);
  }

  .code-conflict-btn-theirs:hover {
    background: rgba(var(--color-info-rgb, 59, 130, 246), 0.25);
  }

  .code-conflict-btn-both {
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid #a855f7;
    color: #a855f7;
  }

  .code-conflict-btn-both:hover {
    background: rgba(168, 85, 247, 0.25);
  }

  /* Conflict block container */
  .code-conflict-block {
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-sm);
    margin: 2px 0;
    overflow: hidden;
  }

  /* Conflict header bar */
  .code-conflict-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: rgba(234, 179, 8, 0.15);
    border-bottom: 1px solid var(--color-warning);
    font-size: var(--font-size-xs);
    color: var(--color-warning);
    font-weight: var(--font-weight-semibold);
  }

  /* Action button container in conflict header */
  .code-conflict-header-actions {
    display: flex;
    gap: var(--spacing-xs);
  }

  /* Green-tinted ours section */
  .code-conflict-side-ours {
    background: rgba(34, 197, 94, 0.08);
  }

  .code-conflict-side-ours .code-conflict-side-label {
    color: var(--color-success);
  }

  /* Blue-tinted theirs section */
  .code-conflict-side-theirs {
    background: rgba(59, 130, 246, 0.08);
  }

  .code-conflict-side-theirs .code-conflict-side-label {
    color: var(--color-info);
  }

  /* Small bold uppercase label */
  .code-conflict-side-label {
    padding: 2px 8px;
    font-size: 10px;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
  }

  /* 1px separator line */
  .code-conflict-divider {
    height: 1px;
    background: var(--color-border);
  }
`;
