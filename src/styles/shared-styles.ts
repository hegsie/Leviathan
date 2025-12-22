import { css } from 'lit';

/**
 * Shared styles for Lit components
 * Import into component static styles array
 */
export const sharedStyles = css`
  :host {
    box-sizing: border-box;
  }

  :host *,
  :host *::before,
  :host *::after {
    box-sizing: inherit;
  }

  /* Focus styles */
  :focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  /* Button reset */
  button {
    font-family: inherit;
    font-size: inherit;
    border: none;
    background: none;
    cursor: pointer;
    padding: 0;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* Input reset */
  input,
  textarea,
  select {
    font-family: inherit;
    font-size: inherit;
  }

  /* Link reset */
  a {
    color: var(--color-primary);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  /* Utility classes */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-family-mono);
  }
`;

/**
 * Button styles mixin
 */
export const buttonStyles = css`
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    transition: all var(--transition-fast);
  }

  .btn-primary {
    background: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  .btn-secondary {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--color-bg-hover);
  }

  .btn-ghost {
    background: transparent;
    color: var(--color-text-primary);
  }

  .btn-ghost:hover:not(:disabled) {
    background: var(--color-bg-hover);
  }

  .btn-icon {
    padding: var(--spacing-xs);
    border-radius: var(--radius-md);
  }
`;

/**
 * Input styles mixin
 */
export const inputStyles = css`
  .input {
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    transition: border-color var(--transition-fast);
  }

  .input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .input::placeholder {
    color: var(--color-text-muted);
  }

  .input:disabled {
    background: var(--color-bg-tertiary);
    cursor: not-allowed;
  }
`;
