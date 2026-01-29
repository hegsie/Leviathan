import { html, LitElement, TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import {
  initHighlighter,
  detectLanguage,
  highlightLineSync,
  preloadLanguage,
} from '../utils/shiki-highlighter.ts';
import type { BundledLanguage } from 'shiki';
import type { InlineDiffSegment } from '../utils/diff-utils.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = object> = new (...args: any[]) => T;

export interface CodeRenderMixinInterface {
  codeLanguage: BundledLanguage | null;
  initCodeLanguage(filePath: string): Promise<void>;
  renderHighlightedContent(content: string): TemplateResult;
  renderInlineWhitespaceContent(segments: InlineDiffSegment[]): TemplateResult;
}

/**
 * Lit mixin providing shared syntax highlighting and code rendering logic.
 *
 * Adds:
 * - `codeLanguage` reactive state property
 * - `initCodeLanguage(filePath)` to initialize the highlighter and detect language
 * - `renderHighlightedContent(content)` to render syntax-highlighted spans
 * - `renderInlineWhitespaceContent(segments)` to render inline whitespace diff segments
 */
export const CodeRenderMixin = <T extends Constructor<LitElement>>(
  superClass: T,
) => {
  class CodeRenderMixinClass extends superClass {
    @state() codeLanguage: BundledLanguage | null = null;

    /**
     * Initialize the Shiki highlighter and detect language from file path.
     * Call this in your component's data-loading method.
     */
    async initCodeLanguage(filePath: string): Promise<void> {
      await initHighlighter();
      this.codeLanguage = detectLanguage(filePath);
      if (this.codeLanguage) {
        await preloadLanguage(this.codeLanguage);
      }
    }

    /**
     * Render a line of code with syntax highlighting.
     * Returns a TemplateResult with colored spans for each token.
     */
    renderHighlightedContent(content: string): TemplateResult {
      const tokens = highlightLineSync(content, this.codeLanguage);
      return html`${tokens.map(
        (token) => html`<span style="color: ${token.color}">${token.content}</span>`,
      )}`;
    }

    /**
     * Render inline whitespace diff segments.
     * Unchanged segments get syntax highlighting; added/removed segments
     * get the `.code-ws-highlight` class with appropriate visual treatment.
     */
    renderInlineWhitespaceContent(segments: InlineDiffSegment[]): TemplateResult {
      return html`${segments.map((seg) => {
        if (seg.type === 'unchanged') {
          return html`${this.renderHighlightedContent(seg.text)}`;
        }
        if (seg.type === 'added') {
          return html`<span class="code-ws-highlight">${seg.text || '\u00a0'}</span>`;
        }
        // 'removed' segments: show as highlighted strikethrough
        return html`<span class="code-ws-highlight" style="text-decoration: line-through; opacity: 0.6;">${seg.text || '\u00a0'}</span>`;
      })}`;
    }
  }

  return CodeRenderMixinClass as Constructor<CodeRenderMixinInterface> & T;
};
