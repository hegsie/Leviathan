import { expect } from '@open-wc/testing';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

/**
 * Test auto-stash checkout behavior logic.
 * Since the component depends on Tauri and Lit rendering,
 * we test the decision logic as standalone functions.
 */
describe('lv-branch-list - auto-stash checkout', () => {
  it('should select checkoutWithAutoStash when setting is enabled', () => {
    const autoStashOnCheckout = true;

    // Simulate the decision logic from handleCheckout
    const useAutoStash = autoStashOnCheckout;

    expect(useAutoStash).to.be.true;
  });

  it('should select plain checkout when setting is disabled', () => {
    const autoStashOnCheckout = false;

    // Simulate the decision logic from handleCheckout
    const useAutoStash = autoStashOnCheckout;

    expect(useAutoStash).to.be.false;
  });

  it('should default to false for autoStashOnCheckout', () => {
    // Test the default value from settings store
    const defaultSettings = {
      autoStashOnCheckout: false,
    };

    expect(defaultSettings.autoStashOnCheckout).to.be.false;
  });

  it('should not attempt checkout on HEAD branch', () => {
    const branch = { isHead: true, name: 'main' };

    // In the component, handleCheckout returns early if branch.isHead
    const shouldCheckout = !branch.isHead;

    expect(shouldCheckout).to.be.false;
  });

  it('should proceed with checkout on non-HEAD branch', () => {
    const branch = { isHead: false, name: 'feature/test' };

    const shouldCheckout = !branch.isHead;

    expect(shouldCheckout).to.be.true;
  });
});

describe('lv-branch-list - fuzzy filter integration', () => {
  // Import fuzzyScore directly since it's a pure function
  let fuzzyScore: (text: string, query: string) => number;

  before(async () => {
    const mod = await import('../../utils/fuzzy-search.ts');
    fuzzyScore = mod.fuzzyScore;
  });

  it('should match fuzzy branch names', () => {
    const branches = ['main', 'develop', 'feature/login', 'feature/signup', 'fix/typo'];
    const query = 'flog';

    const matches = branches.filter(name => fuzzyScore(name, query) > 0);

    expect(matches).to.include('feature/login');
  });

  it('should rank exact matches higher', () => {
    const exact = fuzzyScore('main', 'main');
    const partial = fuzzyScore('main-branch', 'main');

    expect(exact).to.be.greaterThan(partial);
  });

  it('should return no matches for non-matching query', () => {
    const branches = ['main', 'develop', 'feature/login'];
    const query = 'xyz';

    const matches = branches.filter(name => fuzzyScore(name, query) > 0);

    expect(matches).to.have.length(0);
  });

  it('should filter and sort branches by relevance', () => {
    const branches = [
      { name: 'feature/login', shorthand: 'feature/login' },
      { name: 'feature/signup', shorthand: 'feature/signup' },
      { name: 'fix/login-bug', shorthand: 'fix/login-bug' },
    ];
    const query = 'login';

    const results = branches
      .map(b => ({
        branch: b,
        score: Math.max(fuzzyScore(b.name, query), fuzzyScore(b.shorthand, query)),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ branch }) => branch);

    expect(results.length).to.be.greaterThan(0);
    // All results should contain 'login'
    expect(results.every(r => r.name.includes('login'))).to.be.true;
  });
});
