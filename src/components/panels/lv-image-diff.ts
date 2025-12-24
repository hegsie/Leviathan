import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { ImageVersions } from '../../types/git.types.ts';

type ImageDiffMode = 'side-by-side' | 'onion-skin' | 'swipe';

/**
 * Image diff component
 * Displays visual comparison of image changes with multiple comparison modes
 */
@customElement('lv-image-diff')
export class LvImageDiff extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .file-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .file-path {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .file-status {
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        font-size: 10px;
        font-weight: var(--font-weight-bold);
        text-transform: uppercase;
      }

      .file-status.new {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .file-status.modified {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }

      .file-status.deleted {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .controls {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
      }

      .mode-buttons {
        display: flex;
        gap: var(--spacing-xs);
      }

      .mode-btn {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: var(--font-size-xs);
        transition: all 0.15s ease;
      }

      .mode-btn:hover {
        background: var(--color-bg-hover);
      }

      .mode-btn.active {
        background: var(--color-accent-bg);
        border-color: var(--color-accent);
        color: var(--color-accent);
      }

      .zoom-controls {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .zoom-btn {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .zoom-btn:hover {
        background: var(--color-bg-hover);
      }

      .zoom-level {
        min-width: 45px;
        text-align: center;
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      .container {
        flex: 1;
        overflow: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-md);
        background: var(--color-bg-secondary);
      }

      /* Side by side mode */
      .side-by-side {
        display: flex;
        gap: var(--spacing-md);
        align-items: flex-start;
      }

      .image-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .image-label {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
      }

      .image-label.old {
        color: var(--color-error);
      }

      .image-label.new {
        color: var(--color-success);
      }

      .image-wrapper {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%)
          50% / 16px 16px;
      }

      .image-wrapper img {
        display: block;
        max-width: 100%;
        transition: transform 0.1s ease;
      }

      .no-image {
        width: 200px;
        height: 150px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        background: var(--color-bg-tertiary);
      }

      /* Onion skin mode */
      .onion-skin {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-md);
      }

      .onion-container {
        position: relative;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%)
          50% / 16px 16px;
      }

      .onion-container img {
        display: block;
      }

      .onion-container img.overlay {
        position: absolute;
        top: 0;
        left: 0;
        transition: opacity 0.1s ease;
      }

      .opacity-slider {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
      }

      .opacity-slider input[type="range"] {
        width: 200px;
        cursor: pointer;
      }

      .opacity-value {
        min-width: 40px;
        text-align: center;
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      /* Swipe mode */
      .swipe-container {
        position: relative;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%)
          50% / 16px 16px;
        cursor: ew-resize;
      }

      .swipe-container img {
        display: block;
      }

      .swipe-container .new-image {
        position: absolute;
        top: 0;
        left: 0;
        clip-path: inset(0 0 0 50%);
      }

      .swipe-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 4px;
        background: var(--color-accent);
        cursor: ew-resize;
        z-index: 10;
      }

      .swipe-handle::before,
      .swipe-handle::after {
        content: '';
        position: absolute;
        top: 50%;
        width: 12px;
        height: 12px;
        background: var(--color-accent);
        border-radius: 50%;
        transform: translateY(-50%);
      }

      .swipe-handle::before {
        left: -4px;
      }

      .swipe-handle::after {
        right: -4px;
      }

      .swipe-labels {
        position: absolute;
        top: var(--spacing-sm);
        left: var(--spacing-sm);
        right: var(--spacing-sm);
        display: flex;
        justify-content: space-between;
        pointer-events: none;
        z-index: 5;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--color-text-muted);
      }

      .error {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--color-error);
      }
    `,
  ];

  @property({ type: String }) repoPath = '';
  @property({ type: String }) filePath = '';
  @property({ type: String }) status: string = 'modified';
  @property({ type: Boolean }) staged = false;
  @property({ type: String }) commitOid?: string;

  @state() private mode: ImageDiffMode = 'side-by-side';
  @state() private zoom = 100;
  @state() private opacity = 50;
  @state() private swipePosition = 50;
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private imageData: ImageVersions | null = null;
  @state() private isDragging = false;

  async connectedCallback() {
    super.connectedCallback();
    await this.loadImageVersions();
  }

  async updated(changedProperties: Map<string, unknown>) {
    if (
      changedProperties.has('filePath') ||
      changedProperties.has('repoPath') ||
      changedProperties.has('staged') ||
      changedProperties.has('commitOid')
    ) {
      await this.loadImageVersions();
    }
  }

  private async loadImageVersions() {
    if (!this.repoPath || !this.filePath) return;

    this.loading = true;
    this.error = null;

    const result = await gitService.getImageVersions(
      this.repoPath,
      this.filePath,
      this.staged,
      this.commitOid
    );

    if (result.success && result.data) {
      this.imageData = result.data;
    } else {
      this.error = result.error?.message || 'Failed to load images';
    }

    this.loading = false;
  }

  private setMode(mode: ImageDiffMode) {
    this.mode = mode;
  }

  private zoomIn() {
    this.zoom = Math.min(this.zoom + 25, 400);
  }

  private zoomOut() {
    this.zoom = Math.max(this.zoom - 25, 25);
  }

  private zoomFit() {
    this.zoom = 100;
  }

  private handleOpacityChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.opacity = parseInt(input.value, 10);
  }

  private handleSwipeStart(e: MouseEvent) {
    this.isDragging = true;
    this.updateSwipePosition(e);
    document.addEventListener('mousemove', this.handleSwipeMove);
    document.addEventListener('mouseup', this.handleSwipeEnd);
  }

  private handleSwipeMove = (e: MouseEvent) => {
    if (!this.isDragging) return;
    this.updateSwipePosition(e);
  };

  private handleSwipeEnd = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleSwipeMove);
    document.removeEventListener('mouseup', this.handleSwipeEnd);
  };

  private updateSwipePosition(e: MouseEvent) {
    const container = this.shadowRoot?.querySelector('.swipe-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    this.swipePosition = Math.max(0, Math.min(100, (x / rect.width) * 100));
  }

  private getImageSrc(data: string | null, type: string | null): string {
    if (!data) return '';
    const mimeType = type === 'svg' ? 'image/svg+xml' : `image/${type || 'png'}`;
    return `data:${mimeType};base64,${data}`;
  }

  private renderSideBySide() {
    const oldSrc = this.getImageSrc(
      this.imageData?.oldData ?? null,
      this.imageData?.imageType ?? null
    );
    const newSrc = this.getImageSrc(
      this.imageData?.newData ?? null,
      this.imageData?.imageType ?? null
    );

    return html`
      <div class="side-by-side">
        <div class="image-panel">
          <span class="image-label old">Before</span>
          <div class="image-wrapper">
            ${oldSrc
              ? html`<img
                  src=${oldSrc}
                  alt="Before"
                  style="transform: scale(${this.zoom / 100})"
                />`
              : html`<div class="no-image">No previous version</div>`}
          </div>
        </div>
        <div class="image-panel">
          <span class="image-label new">After</span>
          <div class="image-wrapper">
            ${newSrc
              ? html`<img
                  src=${newSrc}
                  alt="After"
                  style="transform: scale(${this.zoom / 100})"
                />`
              : html`<div class="no-image">File deleted</div>`}
          </div>
        </div>
      </div>
    `;
  }

  private renderOnionSkin() {
    const oldSrc = this.getImageSrc(
      this.imageData?.oldData ?? null,
      this.imageData?.imageType ?? null
    );
    const newSrc = this.getImageSrc(
      this.imageData?.newData ?? null,
      this.imageData?.imageType ?? null
    );

    if (!oldSrc && !newSrc) {
      return html`<div class="no-image">No images to compare</div>`;
    }

    return html`
      <div class="onion-skin">
        <div class="onion-container" style="transform: scale(${this.zoom / 100})">
          ${oldSrc ? html`<img src=${oldSrc} alt="Before" />` : nothing}
          ${newSrc
            ? html`<img
                class="overlay"
                src=${newSrc}
                alt="After"
                style="opacity: ${this.opacity / 100}"
              />`
            : nothing}
        </div>
        <div class="opacity-slider">
          <span class="image-label old">Before</span>
          <input
            type="range"
            min="0"
            max="100"
            .value=${String(this.opacity)}
            @input=${this.handleOpacityChange}
          />
          <span class="image-label new">After</span>
          <span class="opacity-value">${this.opacity}%</span>
        </div>
      </div>
    `;
  }

  private renderSwipe() {
    const oldSrc = this.getImageSrc(
      this.imageData?.oldData ?? null,
      this.imageData?.imageType ?? null
    );
    const newSrc = this.getImageSrc(
      this.imageData?.newData ?? null,
      this.imageData?.imageType ?? null
    );

    if (!oldSrc && !newSrc) {
      return html`<div class="no-image">No images to compare</div>`;
    }

    return html`
      <div
        class="swipe-container"
        style="transform: scale(${this.zoom / 100})"
        @mousedown=${this.handleSwipeStart}
      >
        ${oldSrc ? html`<img src=${oldSrc} alt="Before" />` : nothing}
        ${newSrc
          ? html`<img
              class="new-image"
              src=${newSrc}
              alt="After"
              style="clip-path: inset(0 0 0 ${this.swipePosition}%)"
            />`
          : nothing}
        <div class="swipe-handle" style="left: ${this.swipePosition}%"></div>
        <div class="swipe-labels">
          <span class="image-label old">Before</span>
          <span class="image-label new">After</span>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="header">
        <div class="file-info">
          <span class="file-status ${this.status}">${this.status}</span>
          <span class="file-path">${this.filePath}</span>
        </div>
        <div class="controls">
          <div class="mode-buttons">
            <button
              class="mode-btn ${this.mode === 'side-by-side' ? 'active' : ''}"
              @click=${() => this.setMode('side-by-side')}
              title="Side by side"
            >
              Side by Side
            </button>
            <button
              class="mode-btn ${this.mode === 'onion-skin' ? 'active' : ''}"
              @click=${() => this.setMode('onion-skin')}
              title="Onion skin (opacity overlay)"
            >
              Onion Skin
            </button>
            <button
              class="mode-btn ${this.mode === 'swipe' ? 'active' : ''}"
              @click=${() => this.setMode('swipe')}
              title="Swipe comparison"
            >
              Swipe
            </button>
          </div>
          <div class="zoom-controls">
            <button class="zoom-btn" @click=${this.zoomOut} title="Zoom out">-</button>
            <span class="zoom-level">${this.zoom}%</span>
            <button class="zoom-btn" @click=${this.zoomIn} title="Zoom in">+</button>
            <button class="zoom-btn" @click=${this.zoomFit} title="Fit to view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div class="container">
        ${this.loading
          ? html`<div class="loading">Loading images...</div>`
          : this.error
            ? html`<div class="error">${this.error}</div>`
            : this.mode === 'side-by-side'
              ? this.renderSideBySide()
              : this.mode === 'onion-skin'
                ? this.renderOnionSkin()
                : this.renderSwipe()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-image-diff': LvImageDiff;
  }
}
