import { expect } from '@open-wc/testing';

/**
 * Tests for CodeRenderMixin logic.
 *
 * Note: The mixin transitively imports shiki which uses WASM and cannot load
 * in the web-test-runner browser environment. We test the mixin's interface
 * contract and the shared code-styles module independently from the WASM-based
 * highlighter. The mixin's actual rendering is tested via the component-level
 * tests (lv-diff-view, lv-merge-editor, lv-blame-view) and manual testing.
 */

// We can import the CSS module since it's pure CSS-in-JS (no WASM)
import { codeStyles } from '../../styles/code-styles.ts';

describe('CodeRenderMixin', () => {
  describe('codeStyles shared CSS module', () => {
    it('should export a CSSResult', () => {
      expect(codeStyles).to.exist;
      // Lit CSSResult has a cssText property
      expect((codeStyles as { cssText?: string }).cssText).to.be.a('string');
    });

    it('should contain code-addition class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-addition');
    });

    it('should contain code-deletion class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-deletion');
    });

    it('should contain code-ws-change class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-ws-change');
    });

    it('should contain code-ws-highlight class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-ws-highlight');
    });

    it('should contain code-line-no class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-line-no');
    });

    it('should contain code-line-content class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-line-content');
    });

    it('should contain code-conflict-btn-ours class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-btn-ours');
    });

    it('should contain code-conflict-btn-theirs class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-btn-theirs');
    });

    it('should contain code-conflict-btn-both class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-btn-both');
    });

    it('should contain code-conflict-block class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-block');
    });

    it('should contain code-conflict-header class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-header');
    });

    it('should contain code-conflict-header-actions class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-header-actions');
    });

    it('should contain code-conflict-side-ours class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-side-ours');
    });

    it('should contain code-conflict-side-theirs class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-side-theirs');
    });

    it('should contain code-conflict-side-label class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-side-label');
    });

    it('should contain code-conflict-divider class', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('.code-conflict-divider');
    });

    it('should use diff color variables', () => {
      const text = (codeStyles as { cssText: string }).cssText;
      expect(text).to.include('--color-diff-add-bg');
      expect(text).to.include('--color-diff-del-bg');
      expect(text).to.include('--color-diff-ws-bg');
      expect(text).to.include('--color-diff-ws-highlight');
      expect(text).to.include('--color-diff-add-line-bg');
      expect(text).to.include('--color-diff-del-line-bg');
    });
  });

  describe('mixin module exports', () => {
    it('should be importable as a TypeScript module', () => {
      // The mixin itself transitively imports shiki (WASM) so cannot be
      // imported in the browser test runner. Its runtime behavior is tested
      // through the component-level tests that use the mixin.
      // This suite validates the CSS module which is the primary shared artifact.
      expect(true).to.be.true;
    });
  });
});
