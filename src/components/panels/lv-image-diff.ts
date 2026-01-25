import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { ImageVersions } from '../../types/git.types.ts';

type ImageDiffMode = 'side-by-side' | 'onion-skin' | 'swipe' | 'difference';

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

      /* Difference mode */
      .difference-view {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-md);
      }

      .difference-container {
        display: flex;
        gap: var(--spacing-md);
        align-items: flex-start;
      }

      .difference-canvas-wrapper {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%)
          50% / 16px 16px;
      }

      .difference-canvas-wrapper canvas {
        display: block;
      }

      .difference-controls {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
      }

      .difference-legend {
        display: flex;
        gap: var(--spacing-md);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .legend-swatch {
        width: 16px;
        height: 16px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
      }

      .legend-swatch.added {
        background: rgba(0, 255, 0, 0.7);
      }

      .legend-swatch.removed {
        background: rgba(255, 0, 0, 0.7);
      }

      .legend-swatch.changed {
        background: rgba(255, 0, 255, 0.7);
      }

      .legend-swatch.unchanged {
        background: rgba(128, 128, 128, 0.3);
      }

      .threshold-slider {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .threshold-slider label {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        white-space: nowrap;
      }

      .threshold-slider input[type="range"] {
        width: 100px;
        cursor: pointer;
      }

      .threshold-value {
        min-width: 30px;
        text-align: center;
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
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
  @state() private differenceThreshold = 10;
  @state() private differenceDataUrl: string | null = null;
  @state() private differenceStats = { added: 0, removed: 0, changed: 0, unchanged: 0 };

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
    if (mode === 'difference') {
      this.computeDifference();
    }
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

  private handleThresholdChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.differenceThreshold = parseInt(input.value, 10);
    this.computeDifference();
  }

  private async computeDifference() {
    if (!this.imageData) return;

    const oldSrc = this.getImageSrc(
      this.imageData.oldData ?? null,
      this.imageData.imageType ?? null
    );
    const newSrc = this.getImageSrc(
      this.imageData.newData ?? null,
      this.imageData.imageType ?? null
    );

    if (!oldSrc && !newSrc) {
      this.differenceDataUrl = null;
      return;
    }

    // Load images
    const loadImage = (src: string): Promise<HTMLImageElement | null> => {
      if (!src) return Promise.resolve(null);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    };

    const [oldImg, newImg] = await Promise.all([
      loadImage(oldSrc),
      loadImage(newSrc),
    ]);

    // Determine canvas size (use the larger dimensions)
    const width = Math.max(oldImg?.width ?? 0, newImg?.width ?? 0);
    const height = Math.max(oldImg?.height ?? 0, newImg?.height ?? 0);

    if (width === 0 || height === 0) {
      this.differenceDataUrl = null;
      return;
    }

    // Create canvases
    const oldCanvas = document.createElement('canvas');
    const newCanvas = document.createElement('canvas');
    const diffCanvas = document.createElement('canvas');

    oldCanvas.width = newCanvas.width = diffCanvas.width = width;
    oldCanvas.height = newCanvas.height = diffCanvas.height = height;

    const oldCtx = oldCanvas.getContext('2d')!;
    const newCtx = newCanvas.getContext('2d')!;
    const diffCtx = diffCanvas.getContext('2d')!;

    // Draw images
    if (oldImg) {
      oldCtx.drawImage(oldImg, 0, 0);
    }
    if (newImg) {
      newCtx.drawImage(newImg, 0, 0);
    }

    // Get image data
    const oldData = oldCtx.getImageData(0, 0, width, height);
    const newData = newCtx.getImageData(0, 0, width, height);
    const diffData = diffCtx.createImageData(width, height);

    // Compute difference
    let added = 0;
    let removed = 0;
    let changed = 0;
    let unchanged = 0;
    const threshold = this.differenceThreshold;

    for (let i = 0; i < oldData.data.length; i += 4) {
      const oldR = oldData.data[i];
      const oldG = oldData.data[i + 1];
      const oldB = oldData.data[i + 2];
      const oldA = oldData.data[i + 3];

      const newR = newData.data[i];
      const newG = newData.data[i + 1];
      const newB = newData.data[i + 2];
      const newA = newData.data[i + 3];

      const oldIsTransparent = oldA < 10;
      const newIsTransparent = newA < 10;

      // Calculate color difference
      const diff =
        Math.abs(oldR - newR) +
        Math.abs(oldG - newG) +
        Math.abs(oldB - newB) +
        Math.abs(oldA - newA);

      if (oldIsTransparent && !newIsTransparent) {
        // Added pixel (green)
        diffData.data[i] = 0;
        diffData.data[i + 1] = 255;
        diffData.data[i + 2] = 0;
        diffData.data[i + 3] = 180;
        added++;
      } else if (!oldIsTransparent && newIsTransparent) {
        // Removed pixel (red)
        diffData.data[i] = 255;
        diffData.data[i + 1] = 0;
        diffData.data[i + 2] = 0;
        diffData.data[i + 3] = 180;
        removed++;
      } else if (diff > threshold) {
        // Changed pixel (magenta)
        diffData.data[i] = 255;
        diffData.data[i + 1] = 0;
        diffData.data[i + 2] = 255;
        diffData.data[i + 3] = 180;
        changed++;
      } else {
        // Unchanged pixel (show dimmed original)
        diffData.data[i] = newR;
        diffData.data[i + 1] = newG;
        diffData.data[i + 2] = newB;
        diffData.data[i + 3] = Math.floor(newA * 0.3);
        unchanged++;
      }
    }

    diffCtx.putImageData(diffData, 0, 0);
    this.differenceDataUrl = diffCanvas.toDataURL('image/png');
    this.differenceStats = { added, removed, changed, unchanged };
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

  private renderDifference() {
    if (!this.differenceDataUrl) {
      // Try to compute if we have image data
      if (this.imageData && (this.imageData.oldData || this.imageData.newData)) {
        this.computeDifference();
        return html`<div class="loading">Computing difference...</div>`;
      }
      return html`<div class="no-image">No images to compare</div>`;
    }

    const totalPixels =
      this.differenceStats.added +
      this.differenceStats.removed +
      this.differenceStats.changed +
      this.differenceStats.unchanged;

    const formatPercent = (count: number) =>
      totalPixels > 0 ? ((count / totalPixels) * 100).toFixed(1) : '0';

    return html`
      <div class="difference-view">
        <div class="difference-container">
          <div class="difference-canvas-wrapper">
            <img
              src=${this.differenceDataUrl}
              alt="Difference"
              style="transform: scale(${this.zoom / 100})"
            />
          </div>
        </div>
        <div class="difference-controls">
          <div class="threshold-slider">
            <label>Sensitivity:</label>
            <input
              type="range"
              min="0"
              max="100"
              .value=${String(this.differenceThreshold)}
              @input=${this.handleThresholdChange}
            />
            <span class="threshold-value">${this.differenceThreshold}</span>
          </div>
          <div class="difference-legend">
            <div class="legend-item">
              <span class="legend-swatch added"></span>
              <span>Added (${formatPercent(this.differenceStats.added)}%)</span>
            </div>
            <div class="legend-item">
              <span class="legend-swatch removed"></span>
              <span>Removed (${formatPercent(this.differenceStats.removed)}%)</span>
            </div>
            <div class="legend-item">
              <span class="legend-swatch changed"></span>
              <span>Changed (${formatPercent(this.differenceStats.changed)}%)</span>
            </div>
          </div>
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
            <button
              class="mode-btn ${this.mode === 'difference' ? 'active' : ''}"
              @click=${() => this.setMode('difference')}
              title="Highlight differences"
            >
              Difference
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
                : this.mode === 'swipe'
                  ? this.renderSwipe()
                  : this.renderDifference()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-image-diff': LvImageDiff;
  }
}
