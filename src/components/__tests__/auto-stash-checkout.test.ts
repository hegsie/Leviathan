import { expect } from '@open-wc/testing';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Replicate the CheckoutWithStashResult interface for testing
interface CheckoutWithStashResult {
  success: boolean;
  stashed: boolean;
  stashApplied: boolean;
  stashConflict: boolean;
  message: string;
}

type ToastType = 'info' | 'warning' | 'error' | 'success';

// Replicate the auto-stash toast logic from app-shell.ts for unit testing
function getAutoStashToast(
  data: CheckoutWithStashResult,
  refName: string,
): { message: string; type: ToastType } | null {
  if (data.stashed && data.stashConflict) {
    return { message: `Switched to ${refName} — stash conflicts need resolution`, type: 'warning' };
  } else if (data.stashed && data.stashApplied) {
    return { message: `Switched to ${refName} (changes re-applied)`, type: 'info' };
  } else if (data.stashed && !data.stashApplied) {
    return { message: data.message, type: 'warning' };
  }
  return null;
}

describe('auto-stash checkout result handling', () => {
  it('should return no toast for clean checkout (no stash needed)', () => {
    const result: CheckoutWithStashResult = {
      success: true,
      stashed: false,
      stashApplied: false,
      stashConflict: false,
      message: 'Checked out main',
    };

    const toast = getAutoStashToast(result, 'main');
    expect(toast).to.be.null;
  });

  it('should return info toast when stash was applied successfully', () => {
    const result: CheckoutWithStashResult = {
      success: true,
      stashed: true,
      stashApplied: true,
      stashConflict: false,
      message: 'Checked out feature/branch with stash re-applied',
    };

    const toast = getAutoStashToast(result, 'feature/branch');
    expect(toast).to.not.be.null;
    expect(toast!.type).to.equal('info');
    expect(toast!.message).to.equal('Switched to feature/branch (changes re-applied)');
  });

  it('should return warning toast when stash had conflicts', () => {
    const result: CheckoutWithStashResult = {
      success: true,
      stashed: true,
      stashApplied: false,
      stashConflict: true,
      message: 'Stash apply had conflicts',
    };

    const toast = getAutoStashToast(result, 'develop');
    expect(toast).to.not.be.null;
    expect(toast!.type).to.equal('warning');
    expect(toast!.message).to.equal('Switched to develop — stash conflicts need resolution');
  });

  it('should return warning toast with message when stash was not applied (no conflict)', () => {
    const result: CheckoutWithStashResult = {
      success: true,
      stashed: true,
      stashApplied: false,
      stashConflict: false,
      message: 'Stash could not be re-applied',
    };

    const toast = getAutoStashToast(result, 'release/1.0');
    expect(toast).to.not.be.null;
    expect(toast!.type).to.equal('warning');
    expect(toast!.message).to.equal('Stash could not be re-applied');
  });

  it('should prioritize stashConflict over stashApplied when both are true', () => {
    const result: CheckoutWithStashResult = {
      success: true,
      stashed: true,
      stashApplied: true,
      stashConflict: true,
      message: 'Conflicts during stash apply',
    };

    const toast = getAutoStashToast(result, 'main');
    expect(toast).to.not.be.null;
    expect(toast!.type).to.equal('warning');
    expect(toast!.message).to.include('stash conflicts need resolution');
  });
});
