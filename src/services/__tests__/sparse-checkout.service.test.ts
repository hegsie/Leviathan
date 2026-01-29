import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    return mockInvoke(command, args);
  },
};

import {
  getSparseCheckoutConfig,
  enableSparseCheckout,
  disableSparseCheckout,
  setSparseCheckoutPatterns,
  addSparseCheckoutPatterns,
  type SparseCheckoutConfig,
} from '../git.service.ts';

describe('git.service - Sparse checkout', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getSparseCheckoutConfig', () => {
    it('invokes get_sparse_checkout_config command', async () => {
      const mockConfig: SparseCheckoutConfig = {
        enabled: false,
        coneMode: false,
        patterns: [],
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await getSparseCheckoutConfig('/test/repo');
      expect(lastInvokedCommand).to.equal('get_sparse_checkout_config');
      expect(result.success).to.be.true;
      expect(result.data?.enabled).to.be.false;
      expect(result.data?.patterns).to.deep.equal([]);
    });

    it('returns enabled config with patterns', async () => {
      const mockConfig: SparseCheckoutConfig = {
        enabled: true,
        coneMode: true,
        patterns: ['src', 'docs'],
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await getSparseCheckoutConfig('/test/repo');
      expect(result.data?.enabled).to.be.true;
      expect(result.data?.coneMode).to.be.true;
      expect(result.data?.patterns).to.deep.equal(['src', 'docs']);
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () =>
        Promise.resolve({ enabled: false, coneMode: false, patterns: [] });

      await getSparseCheckoutConfig('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });
  });

  describe('enableSparseCheckout', () => {
    it('invokes enable_sparse_checkout with cone mode', async () => {
      const mockConfig: SparseCheckoutConfig = {
        enabled: true,
        coneMode: true,
        patterns: [],
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await enableSparseCheckout('/test/repo', true);
      expect(lastInvokedCommand).to.equal('enable_sparse_checkout');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.coneMode).to.be.true;
      expect(result.success).to.be.true;
      expect(result.data?.enabled).to.be.true;
      expect(result.data?.coneMode).to.be.true;
    });

    it('invokes enable_sparse_checkout without cone mode', async () => {
      const mockConfig: SparseCheckoutConfig = {
        enabled: true,
        coneMode: false,
        patterns: [],
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await enableSparseCheckout('/test/repo', false);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.coneMode).to.be.false;
      expect(result.data?.coneMode).to.be.false;
    });
  });

  describe('disableSparseCheckout', () => {
    it('invokes disable_sparse_checkout command', async () => {
      const mockConfig: SparseCheckoutConfig = {
        enabled: false,
        coneMode: false,
        patterns: [],
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await disableSparseCheckout('/test/repo');
      expect(lastInvokedCommand).to.equal('disable_sparse_checkout');
      expect(result.success).to.be.true;
      expect(result.data?.enabled).to.be.false;
    });

    it('handles error when sparse checkout cannot be disabled', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to disable' });

      const result = await disableSparseCheckout('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('setSparseCheckoutPatterns', () => {
    it('invokes set_sparse_checkout_patterns with patterns', async () => {
      const mockConfig: SparseCheckoutConfig = {
        enabled: true,
        coneMode: true,
        patterns: ['src', 'docs', 'tests'],
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await setSparseCheckoutPatterns('/test/repo', ['src', 'docs', 'tests']);
      expect(lastInvokedCommand).to.equal('set_sparse_checkout_patterns');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.patterns).to.deep.equal(['src', 'docs', 'tests']);
      expect(result.success).to.be.true;
      expect(result.data?.patterns).to.deep.equal(['src', 'docs', 'tests']);
    });

    it('handles single pattern', async () => {
      mockInvoke = () =>
        Promise.resolve({ enabled: true, coneMode: true, patterns: ['src'] });

      await setSparseCheckoutPatterns('/test/repo', ['src']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect((args.patterns as string[]).length).to.equal(1);
    });

    it('handles error for empty patterns', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'At least one pattern is required' });

      const result = await setSparseCheckoutPatterns('/test/repo', []);
      expect(result.success).to.be.false;
    });
  });

  describe('addSparseCheckoutPatterns', () => {
    it('invokes add_sparse_checkout_patterns with patterns', async () => {
      const mockConfig: SparseCheckoutConfig = {
        enabled: true,
        coneMode: true,
        patterns: ['src', 'docs'],
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await addSparseCheckoutPatterns('/test/repo', ['docs']);
      expect(lastInvokedCommand).to.equal('add_sparse_checkout_patterns');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.patterns).to.deep.equal(['docs']);
      expect(result.success).to.be.true;
    });

    it('handles error for empty patterns', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'At least one pattern is required' });

      const result = await addSparseCheckoutPatterns('/test/repo', []);
      expect(result.success).to.be.false;
    });

    it('passes correct path and patterns', async () => {
      mockInvoke = () =>
        Promise.resolve({ enabled: true, coneMode: true, patterns: ['lib', 'bin'] });

      await addSparseCheckoutPatterns('/my/repo', ['lib', 'bin']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.patterns).to.deep.equal(['lib', 'bin']);
    });
  });
});
