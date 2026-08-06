/**
 * Error Suggestion Service
 * Maps common Git error messages to user-friendly suggestions with optional action buttons
 */

import { showToast } from './notification.service.ts';
import type { ToastAction } from '../stores/ui.store.ts';

export interface ErrorSuggestion {
  message: string;
  action?: ToastAction;
}

export interface ErrorContext {
  operation?: string;
  branchName?: string;
  /** Repo the failing operation ran against. Pinned into any suggested
   *  action, because a toast outlives a repository switch. */
  repoPath?: string;
}

/**
 * Match a Git error message to a user-friendly suggestion with optional action.
 * Returns null if no suggestion matches.
 */
export function getErrorSuggestion(
  errorMessage: string,
  context?: ErrorContext
): ErrorSuggestion | null {
  if (!errorMessage) return null;

  const msg = errorMessage.toLowerCase();

  // Push rejected (non-fast-forward)
  if (msg.includes('non-fast-forward') || (msg.includes('rejected') && context?.operation === 'push')) {
    return {
      message: 'Remote has newer changes. Pull before pushing.',
      action: {
        label: 'Pull Now',
        callback: () => window.dispatchEvent(new CustomEvent('trigger-pull')),
      },
    };
  }

  // Branch not fully merged
  if (msg.includes('not fully merged') || msg.includes('not yet merged')) {
    return {
      message: `Branch is not fully merged. Force delete if you're sure.`,
      action: {
        label: 'Force Delete',
        // repoPath travels with the branch name. The toast outlives a repo
        // switch (8s, and nothing clears toasts on switch), so resolving the
        // repo when the button is clicked force-deleted from whichever tab
        // happened to be active then — discarding unmerged commits in a repo
        // the user never aimed at.
        callback: () => window.dispatchEvent(new CustomEvent('force-delete-branch', {
          detail: { branchName: context?.branchName, repoPath: context?.repoPath },
        })),
      },
    };
  }

  // Authentication errors
  if (msg.includes('authentication') || msg.includes('auth') ||
      msg.includes('credentials') || msg.includes('permission denied')) {
    return {
      message: 'Authentication failed. Check your credentials or SSH keys.',
      action: {
        label: 'Open Settings',
        callback: () => window.dispatchEvent(new CustomEvent('open-settings')),
      },
    };
  }

  // Rebase in progress
  if (msg.includes('rebase in progress') || msg.includes('rebase already started')) {
    return {
      message: 'A rebase is already in progress. Resolve or abort it first.',
      action: {
        label: 'Abort Rebase',
        callback: () => window.dispatchEvent(new CustomEvent('trigger-abort')),
      },
    };
  }

  // No upstream branch
  if (msg.includes('no upstream') || msg.includes('no tracking') ||
      msg.includes('does not have a commit checked out') ||
      msg.includes('has no upstream branch')) {
    return {
      message: 'No upstream branch configured. Push with --set-upstream to create one.',
    };
  }

  // Operation timeout
  if (msg.includes('timed out') || msg.includes('operation_timeout')) {
    return {
      message: 'Operation timed out. You can increase the timeout in Settings > Behavior.',
      action: {
        label: 'Open Settings',
        callback: () => window.dispatchEvent(new CustomEvent('open-settings')),
      },
    };
  }

  // Operation cancelled
  if (msg.includes('operation_cancelled')) {
    return {
      message: 'Operation was cancelled.',
    };
  }

  // Repository lock. Matched on a word boundary: plain `includes('lock')` also
  // matches "blocked", so a security-gate refusal ("Operation blocked by
  // security settings") was diagnosed as a stuck index.lock and sent the user
  // hunting for a file that does not exist.
  if (/\block\b|\blocked\b|index\.lock/.test(msg)) {
    return {
      message: 'Repository is locked by another process. Wait or remove the lock file.',
    };
  }

  return null;
}

/**
 * Show an error toast with a suggestion if one matches, otherwise show a fallback message.
 */
export function showErrorWithSuggestion(
  errorMessage: string,
  fallbackMessage: string,
  context?: ErrorContext
): void {
  const suggestion = getErrorSuggestion(errorMessage, context);
  if (suggestion) {
    showToast(suggestion.message, 'error', 8000, suggestion.action);
  } else {
    showToast(errorMessage || fallbackMessage, 'error');
  }
}
