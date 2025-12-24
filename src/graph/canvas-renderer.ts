/**
 * Optimized Canvas Renderer for Git Graph
 *
 * Features:
 * - Double buffering for smooth rendering
 * - Dirty region tracking
 * - Layer separation (edges, nodes, labels)
 * - FPS monitoring
 */

import type { RenderData } from './virtual-scroll.ts';
import type { RefInfo, RefType } from '../types/git.types.ts';
import { md5 } from '../utils/md5.ts';

export interface RenderConfig {
  /** Row height in pixels */
  rowHeight: number;
  /** Lane width in pixels */
  laneWidth: number;
  /** Node radius in pixels */
  nodeRadius: number;
  /** Minimum node radius for size scaling */
  minNodeRadius: number;
  /** Maximum node radius for size scaling */
  maxNodeRadius: number;
  /** Line width for edges */
  lineWidth: number;
  /** Show node labels */
  showLabels: boolean;
  /** Show FPS counter */
  showFps: boolean;
  /** Show avatars inside nodes */
  showAvatars: boolean;
  /** Show icons in ref labels */
  showRefIcons: boolean;
}

export interface RenderTheme {
  /** Background color */
  background: string;
  /** Node colors by lane */
  laneColors: string[];
  /** Text color */
  textColor: string;
  /** Selected node color */
  selectedColor: string;
  /** Hovered node color */
  hoveredColor: string;
  /** FPS counter color */
  fpsColor: string;
  /** Ref label colors */
  refColors: {
    localBranch: string;
    localBranchText: string;
    remoteBranch: string;
    remoteBranchText: string;
    tag: string;
    tagText: string;
    head: string;
    headText: string;
  };
}

const DEFAULT_CONFIG: RenderConfig = {
  rowHeight: 28,
  laneWidth: 24,
  nodeRadius: 6,
  minNodeRadius: 5,
  maxNodeRadius: 10,
  lineWidth: 2,
  showLabels: false,
  showFps: false,
  showAvatars: false,
  showRefIcons: true,
};

/**
 * Get a CSS variable value from the document root
 */
function getCSSVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Build theme from CSS variables for dynamic light/dark mode support
 */
export function getThemeFromCSS(): RenderTheme {
  return {
    background: getCSSVar('--color-bg-primary', '#1e1e1e'),
    laneColors: [
      getCSSVar('--color-branch-1', '#4fc3f7'),
      getCSSVar('--color-branch-2', '#81c784'),
      getCSSVar('--color-branch-3', '#ef5350'),
      getCSSVar('--color-branch-4', '#ffb74d'),
      getCSSVar('--color-branch-5', '#ce93d8'),
      getCSSVar('--color-branch-6', '#4dd0e1'),
      getCSSVar('--color-branch-7', '#ff8a65'),
      getCSSVar('--color-branch-8', '#aed581'),
      // Extended colors - derived from base colors
      getCSSVar('--color-branch-1', '#4fc3f7'),
      getCSSVar('--color-branch-2', '#81c784'),
      getCSSVar('--color-branch-3', '#ef5350'),
      getCSSVar('--color-branch-4', '#ffb74d'),
      getCSSVar('--color-branch-5', '#ce93d8'),
      getCSSVar('--color-branch-6', '#4dd0e1'),
      getCSSVar('--color-branch-7', '#ff8a65'),
      getCSSVar('--color-branch-8', '#aed581'),
    ],
    textColor: getCSSVar('--graph-text-color', '#c8c8c8'),
    selectedColor: getCSSVar('--graph-selected-color', '#ffffff'),
    hoveredColor: getCSSVar('--graph-hover-color', '#e0e0e0'),
    fpsColor: getCSSVar('--color-warning', '#fbbc04'),
    refColors: {
      localBranch: getCSSVar('--ref-local-bg', '#2e5730'),
      localBranchText: getCSSVar('--ref-local-text', '#a5d6a7'),
      remoteBranch: getCSSVar('--ref-remote-bg', '#1a3a5c'),
      remoteBranchText: getCSSVar('--ref-remote-text', '#90caf9'),
      tag: getCSSVar('--ref-tag-bg', '#5c4020'),
      tagText: getCSSVar('--ref-tag-text', '#ffe082'),
      head: getCSSVar('--ref-head-bg', '#5c3020'),
      headText: getCSSVar('--ref-head-text', '#ffab91'),
    },
  };
}

// Fallback theme for SSR or when CSS vars aren't available
const DEFAULT_THEME: RenderTheme = {
  background: '#1e1e1e',
  laneColors: [
    '#4fc3f7', '#81c784', '#ef5350', '#ffb74d',
    '#ce93d8', '#4dd0e1', '#ff8a65', '#aed581',
    '#4fc3f7', '#81c784', '#ef5350', '#ffb74d',
    '#ce93d8', '#4dd0e1', '#ff8a65', '#aed581',
  ],
  textColor: '#c8c8c8',
  selectedColor: '#ffffff',
  hoveredColor: '#e0e0e0',
  fpsColor: '#fbbc04',
  refColors: {
    localBranch: '#2e5730',
    localBranchText: '#a5d6a7',
    remoteBranch: '#1a3a5c',
    remoteBranchText: '#90caf9',
    tag: '#5c4020',
    tagText: '#ffe082',
    head: '#5c3020',
    headText: '#ffab91',
  },
};

/**
 * Performance monitor for FPS tracking
 */
export class PerformanceMonitor {
  private frameTimes: number[] = [];
  private lastFrameTime = 0;
  private maxSamples = 60;

  /**
   * Record a frame
   */
  recordFrame(): void {
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      this.frameTimes.push(now - this.lastFrameTime);
      if (this.frameTimes.length > this.maxSamples) {
        this.frameTimes.shift();
      }
    }
    this.lastFrameTime = now;
  }

  /**
   * Get current FPS
   */
  getFps(): number {
    if (this.frameTimes.length === 0) return 0;
    const avgFrameTime =
      this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return Math.round(1000 / avgFrameTime);
  }

  /**
   * Get frame time statistics
   */
  getStats(): { fps: number; avgMs: number; minMs: number; maxMs: number } {
    if (this.frameTimes.length === 0) {
      return { fps: 0, avgMs: 0, minMs: 0, maxMs: 0 };
    }

    const avgMs =
      this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const minMs = Math.min(...this.frameTimes);
    const maxMs = Math.max(...this.frameTimes);

    return {
      fps: Math.round(1000 / avgMs),
      avgMs: Math.round(avgMs * 100) / 100,
      minMs: Math.round(minMs * 100) / 100,
      maxMs: Math.round(maxMs * 100) / 100,
    };
  }

  reset(): void {
    this.frameTimes = [];
    this.lastFrameTime = 0;
  }
}

/**
 * High-performance canvas renderer for git graphs
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: RenderConfig;
  private theme: RenderTheme;
  private dpr: number;

  private perfMonitor = new PerformanceMonitor();

  // Selection state
  private selectedOid: string | null = null;
  private hoveredOid: string | null = null;

  // Dirty tracking
  private isDirty = true;
  private pendingFrame: number = 0;

  // Avatar cache
  private avatarCache: Map<string, HTMLImageElement | null> = new Map();
  private avatarLoadingSet: Set<string> = new Set();

  // Commit stats for size scaling (oid -> number of changes)
  private commitStats: Map<string, number> = new Map();

  constructor(
    canvas: HTMLCanvasElement,
    config: Partial<RenderConfig> = {},
    theme: Partial<RenderTheme> = {}
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.theme = { ...DEFAULT_THEME, ...theme };
    this.dpr = window.devicePixelRatio || 1;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<RenderConfig>): void {
    this.config = { ...this.config, ...config };
    this.markDirty();
  }

  /**
   * Update theme
   */
  setTheme(theme: Partial<RenderTheme>): void {
    this.theme = { ...this.theme, ...theme };
    this.markDirty();
  }

  /**
   * Set selection state
   */
  setSelection(selectedOid: string | null, hoveredOid: string | null): void {
    if (this.selectedOid !== selectedOid || this.hoveredOid !== hoveredOid) {
      this.selectedOid = selectedOid;
      this.hoveredOid = hoveredOid;
      this.markDirty();
    }
  }

  /**
   * Set commit stats for size-based node scaling
   */
  setCommitStats(stats: Map<string, number>): void {
    this.commitStats = stats;
    this.markDirty();
  }

  /**
   * Get Gravatar URL from email using proper MD5 hash
   */
  private getGravatarUrl(email: string, size: number = 64): string {
    const hash = md5(email.toLowerCase().trim());
    return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon`;
  }

  /**
   * Load avatar image for an email
   */
  private loadAvatar(email: string): void {
    if (this.avatarCache.has(email) || this.avatarLoadingSet.has(email)) {
      return;
    }

    this.avatarLoadingSet.add(email);
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      this.avatarCache.set(email, img);
      this.avatarLoadingSet.delete(email);
      this.markDirty();
    };

    img.onerror = () => {
      this.avatarCache.set(email, null);
      this.avatarLoadingSet.delete(email);
    };

    img.src = this.getGravatarUrl(email, 64);
  }

  /**
   * Get node radius based on commit stats (if available)
   */
  private getNodeRadius(oid: string): number {
    const stats = this.commitStats.get(oid);
    if (!stats) {
      return this.config.nodeRadius;
    }

    // Scale based on number of changes (log scale to prevent huge nodes)
    const minRadius = this.config.minNodeRadius;
    const maxRadius = this.config.maxNodeRadius;
    const logStats = Math.log10(stats + 1);
    const normalizedSize = Math.min(logStats / 4, 1); // 10000 changes = max size

    return minRadius + (maxRadius - minRadius) * normalizedSize;
  }

  /**
   * Mark canvas as needing redraw
   */
  markDirty(): void {
    this.isDirty = true;
  }

  /**
   * Resize canvas
   */
  resize(width: number, height: number): void {
    // Setting canvas dimensions resets the context state, including transforms
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    // Re-apply DPR scaling after dimension change
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.markDirty();
  }

  /**
   * Ensure canvas context is in correct state for rendering
   */
  private prepareContext(): void {
    // Reset transform to identity, then apply DPR scale
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Render the graph
   */
  render(data: RenderData): void {
    if (!this.isDirty) return;

    this.perfMonitor.recordFrame();

    // Ensure context is in correct state before rendering
    this.prepareContext();

    const { ctx, config, theme } = this;
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;

    // Clear canvas
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    // Draw edges (behind nodes)
    this.renderEdges(data);

    // Draw nodes
    this.renderNodes(data);

    // Draw ref labels (on top of nodes)
    this.renderRefLabels(data);

    // Draw FPS counter
    if (config.showFps) {
      this.renderFps();
    }

    this.isDirty = false;
  }

  /**
   * Render edges
   */
  private renderEdges(data: RenderData): void {
    const { ctx, config } = this;
    const { edges, offsetX, offsetY, maxLane } = data;

    ctx.lineWidth = config.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Graph is mirrored: lane 0 is on the right, higher lanes extend left
    const graphEndX = offsetX + (maxLane + 1) * config.laneWidth;

    for (const edge of edges) {
      const fromX = graphEndX - (edge.fromLane + 1) * config.laneWidth + config.laneWidth / 2;
      const fromY = offsetY + edge.fromRow * config.rowHeight;
      const toX = graphEndX - (edge.toLane + 1) * config.laneWidth + config.laneWidth / 2;
      const toY = offsetY + edge.toRow * config.rowHeight;

      ctx.strokeStyle = this.getLaneColor(edge.fromLane);
      ctx.beginPath();

      if (edge.fromLane === edge.toLane) {
        // Straight line
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
      } else {
        // Angular elbow curve (like GitKraken)
        const cornerRadius = 5;
        const goingRight = toX > fromX;
        const goingDown = toY > fromY;

        ctx.moveTo(fromX, fromY);

        if (goingDown) {
          // Going down: vertical first, then horizontal
          const turnY = toY - cornerRadius;

          // Vertical segment
          ctx.lineTo(fromX, turnY);

          // Rounded corner
          if (goingRight) {
            ctx.arcTo(fromX, toY, fromX + cornerRadius, toY, cornerRadius);
          } else {
            ctx.arcTo(fromX, toY, fromX - cornerRadius, toY, cornerRadius);
          }

          // Horizontal segment to target
          ctx.lineTo(toX, toY);
        } else {
          // Going up: horizontal first, then vertical
          const turnY = fromY;

          // Horizontal segment
          if (goingRight) {
            ctx.lineTo(toX - cornerRadius, turnY);
            ctx.arcTo(toX, turnY, toX, turnY - cornerRadius, cornerRadius);
          } else {
            ctx.lineTo(toX + cornerRadius, turnY);
            ctx.arcTo(toX, turnY, toX, turnY - cornerRadius, cornerRadius);
          }

          // Vertical segment to target
          ctx.lineTo(toX, toY);
        }
      }

      ctx.stroke();
    }
  }

  /**
   * Render nodes with avatars
   */
  private renderNodes(data: RenderData): void {
    const { ctx, config, theme } = this;
    const { nodes, offsetX, offsetY, authorEmails, maxLane } = data;

    // Graph is mirrored: lane 0 is on the right, higher lanes extend left
    const graphEndX = offsetX + (maxLane + 1) * config.laneWidth;

    for (const node of nodes) {
      const x = graphEndX - (node.lane + 1) * config.laneWidth + config.laneWidth / 2;
      const y = offsetY + node.row * config.rowHeight;
      const color = this.getLaneColor(node.lane);
      const radius = this.getNodeRadius(node.oid);

      const isSelected = node.oid === this.selectedOid;
      const isHovered = node.oid === this.hoveredOid;

      // Get author email for avatar
      const authorEmail = authorEmails?.[node.oid];

      // Try to draw avatar if enabled and email available
      let avatarDrawn = false;
      if (config.showAvatars && authorEmail) {
        const avatar = this.avatarCache.get(authorEmail);
        if (avatar) {
          // Draw circular avatar
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, radius - 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(avatar, x - radius + 2, y - radius + 2, (radius - 2) * 2, (radius - 2) * 2);
          ctx.restore();
          avatarDrawn = true;
        } else {
          // Trigger avatar load
          this.loadAvatar(authorEmail);
        }
      }

      // Draw node circle (border or full if no avatar)
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);

      if (isSelected) {
        // Selected: white fill with thick colored border
        if (!avatarDrawn) {
          ctx.fillStyle = theme.selectedColor;
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (isHovered) {
        // Hovered: colored fill with white border
        if (!avatarDrawn) {
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.strokeStyle = theme.hoveredColor;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        // Normal: colored fill or border around avatar
        if (avatarDrawn) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.fill();
        }
      }

      // Draw initials if no avatar and node is large enough
      if (!avatarDrawn && radius >= 12 && authorEmail) {
        const initials = this.getInitials(node.commit.author);
        ctx.fillStyle = isSelected ? color : '#ffffff';
        ctx.font = `bold ${Math.floor(radius * 0.8)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials, x, y + 1);
      }

      // Draw label for selected/hovered (to the left since graph is mirrored)
      if ((isSelected || isHovered) && config.showLabels) {
        ctx.fillStyle = theme.textColor;
        ctx.font = '11px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.oid.substring(0, 7), x - radius - 6, y);
      }
    }
  }

  /**
   * Get initials from author name
   */
  private getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  /**
   * Render ref labels and commit messages in fixed columns
   */
  private renderRefLabels(data: RenderData): void {
    const { ctx, config, theme } = this;
    const { nodes, offsetX, offsetY, refsByCommit, maxLane } = data;

    const labelHeight = 18;
    const labelPadding = 6;
    const labelGap = 4;
    const labelRadius = 4;
    const iconSize = 12;
    const iconPadding = 3;

    // Fixed column positions based on global maxLane - tight spacing
    const graphEndX = offsetX + (maxLane + 1) * config.laneWidth;
    const avatarColumnX = graphEndX + 10;
    const avatarSize = 22;
    const messageColumnX = avatarColumnX + avatarSize + 10;
    const messageColumnWidth = 360;  // Fixed width for message column
    const labelColumnX = messageColumnX + messageColumnWidth + 10;

    for (const node of nodes) {
      const y = offsetY + node.row * config.rowHeight;
      const refs = refsByCommit?.[node.oid] ?? [];
      const hasRefs = refs.length > 0;
      const laneColor = this.getLaneColor(node.lane);

      // Render avatar in avatar column
      const authorEmail = data.authorEmails?.[node.oid];
      const avatarRadius = avatarSize / 2;
      const avatarCenterX = avatarColumnX + avatarRadius;

      if (authorEmail) {
        const avatar = this.avatarCache.get(authorEmail);
        if (avatar) {
          // Draw circular avatar
          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarCenterX, y, avatarRadius - 1, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(avatar, avatarCenterX - avatarRadius + 1, y - avatarRadius + 1, avatarSize - 2, avatarSize - 2);
          ctx.restore();
        } else {
          // Trigger avatar load and show initials
          this.loadAvatar(authorEmail);
          // Draw initials circle
          ctx.beginPath();
          ctx.arc(avatarCenterX, y, avatarRadius - 1, 0, Math.PI * 2);
          ctx.fillStyle = laneColor;
          ctx.fill();
          // Draw initials
          const initials = this.getInitials(node.commit.author);
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.floor(avatarSize * 0.45)}px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(initials, avatarCenterX, y + 1);
        }
      } else {
        // No email - draw colored circle with initials
        ctx.beginPath();
        ctx.arc(avatarCenterX, y, avatarRadius - 1, 0, Math.PI * 2);
        ctx.fillStyle = laneColor;
        ctx.fill();
        const initials = this.getInitials(node.commit.author);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.floor(avatarSize * 0.45)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials, avatarCenterX, y + 1);
      }

      // Render commit message (in message column)
      // Use the lane color for the message text (like GitKraken)
      const message = node.commit.message;
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = laneColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      // Allow message to extend into label column if no refs
      const maxWidth = hasRefs ? messageColumnWidth - 8 : messageColumnWidth + 300;

      // Truncate message to fit available space
      let displayMessage = message;
      if (ctx.measureText(displayMessage).width > maxWidth) {
        while (ctx.measureText(displayMessage + '…').width > maxWidth && displayMessage.length > 0) {
          displayMessage = displayMessage.slice(0, -1);
        }
        displayMessage += '…';
      }
      ctx.fillText(displayMessage, messageColumnX, y);

      // Render refs in label column (after message)
      let currentX = labelColumnX;
      for (const ref of refs) {
        const label = ref.shorthand;

        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
        const textWidth = ctx.measureText(label).width;

        const hasIcon = config.showRefIcons;
        const pillWidth = textWidth + labelPadding * 2 + (hasIcon ? iconSize + iconPadding : 0);

        const { bgColor, textColor } = this.getRefColors(ref);

        // Draw pill background
        ctx.fillStyle = bgColor;
        this.drawRoundedRect(currentX, y - labelHeight / 2, pillWidth, labelHeight, labelRadius);

        // Draw HEAD indicator
        if (ref.isHead) {
          ctx.strokeStyle = theme.refColors.head;
          ctx.lineWidth = 2;
          this.strokeRoundedRect(currentX, y - labelHeight / 2, pillWidth, labelHeight, labelRadius);
        }

        // Draw icon
        let textStartX = currentX + labelPadding;
        if (hasIcon) {
          // Use a contrasting color for icon - darken or lighten based on background
          const iconColor = this.getContrastingIconColor(bgColor);
          ctx.strokeStyle = iconColor;
          ctx.fillStyle = iconColor;
          this.drawRefIcon(ref.refType, currentX + labelPadding, y, iconSize);
          textStartX = currentX + labelPadding + iconSize + iconPadding;
        }

        // Draw label text
        ctx.fillStyle = textColor;
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, textStartX, y);

        currentX += pillWidth + labelGap;
      }
    }
  }

  /**
   * Draw an icon for a ref type - matches sidebar branch icons exactly
   * SVG viewBox is 0 0 24 24, scaled to iconSize
   */
  private drawRefIcon(refType: RefType, x: number, y: number, size: number): void {
    const { ctx } = this;
    const s = size / 24;  // Scale factor from SVG viewBox (24x24) to icon size
    const top = y - size / 2;  // Top of icon area
    const left = x;  // Left of icon area

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (refType) {
      case 'localBranch':
        // Matches sidebar exactly:
        // <line x1="6" y1="3" x2="6" y2="15"></line>
        // <circle cx="18" cy="6" r="3"></circle>
        // <circle cx="6" cy="18" r="3"></circle>
        // <path d="M18 9a9 9 0 01-9 9"></path>

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(left + 6 * s, top + 3 * s);
        ctx.lineTo(left + 6 * s, top + 15 * s);
        ctx.stroke();

        // Top-right circle (stroked, not filled)
        ctx.beginPath();
        ctx.arc(left + 18 * s, top + 6 * s, 3 * s, 0, Math.PI * 2);
        ctx.stroke();

        // Bottom-left circle (stroked)
        ctx.beginPath();
        ctx.arc(left + 6 * s, top + 18 * s, 3 * s, 0, Math.PI * 2);
        ctx.stroke();

        // Curved path from (18, 9) arcing to (9, 18)
        // SVG: M18 9a9 9 0 01-9 9 is an arc from (18,9) to (9,18) with radius 9
        ctx.beginPath();
        ctx.moveTo(left + 18 * s, top + 9 * s);
        ctx.bezierCurveTo(
          left + 18 * s, top + 14 * s,  // control point 1
          left + 14 * s, top + 18 * s,  // control point 2
          left + 9 * s, top + 18 * s    // end point
        );
        ctx.stroke();
        break;

      case 'remoteBranch':
        // Same structure as local branch with arrow indicator
        // Vertical line
        ctx.beginPath();
        ctx.moveTo(left + 6 * s, top + 3 * s);
        ctx.lineTo(left + 6 * s, top + 15 * s);
        ctx.stroke();

        // Top-right circle
        ctx.beginPath();
        ctx.arc(left + 18 * s, top + 6 * s, 3 * s, 0, Math.PI * 2);
        ctx.stroke();

        // Bottom-left circle
        ctx.beginPath();
        ctx.arc(left + 6 * s, top + 18 * s, 3 * s, 0, Math.PI * 2);
        ctx.stroke();

        // Curved path
        ctx.beginPath();
        ctx.moveTo(left + 18 * s, top + 9 * s);
        ctx.bezierCurveTo(
          left + 18 * s, top + 14 * s,
          left + 14 * s, top + 18 * s,
          left + 9 * s, top + 18 * s
        );
        ctx.stroke();

        // Small arrow indicating remote (up-right)
        ctx.beginPath();
        ctx.moveTo(left + 21 * s, top + 3 * s);
        ctx.lineTo(left + 23 * s, top + 1 * s);
        ctx.moveTo(left + 23 * s, top + 1 * s);
        ctx.lineTo(left + 21 * s, top + 1 * s);
        ctx.moveTo(left + 23 * s, top + 1 * s);
        ctx.lineTo(left + 23 * s, top + 3 * s);
        ctx.stroke();
        break;

      case 'tag': {
        // Tag icon - pentagon shape with hole
        const cx = left + size / 2;
        const cy = y;
        const ts = size / 11;  // Tag-specific scale

        ctx.beginPath();
        ctx.moveTo(cx + 4 * ts, cy - 4 * ts);
        ctx.lineTo(cx + 4 * ts, cy + 1 * ts);
        ctx.lineTo(cx, cy + 5 * ts);
        ctx.lineTo(cx - 4 * ts, cy + 1 * ts);
        ctx.lineTo(cx - 4 * ts, cy - 4 * ts);
        ctx.closePath();
        ctx.stroke();
        // Small hole in tag
        ctx.beginPath();
        ctx.arc(cx, cy - 2 * ts, 1.5 * ts, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      default:
        // Default: simple circle
        ctx.beginPath();
        ctx.arc(left + size / 2, y, size / 4, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Get a contrasting icon color based on the background
   */
  private getContrastingIconColor(bgColor: string): string {
    // Parse the background color to get luminance
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return dark color for light backgrounds, light for dark
    if (luminance > 0.5) {
      // Light background - use darker version of the color
      return `rgb(${Math.floor(r * 0.4)}, ${Math.floor(g * 0.4)}, ${Math.floor(b * 0.4)})`;
    } else {
      // Dark background - use lighter/white
      return '#ffffff';
    }
  }

  /**
   * Get colors for a ref based on its type
   */
  private getRefColors(ref: RefInfo): { bgColor: string; textColor: string } {
    const { theme } = this;

    if (ref.isHead) {
      // HEAD gets special treatment - use local branch color with head indicator
      return {
        bgColor: theme.refColors.localBranch,
        textColor: theme.refColors.localBranchText,
      };
    }

    switch (ref.refType) {
      case 'localBranch':
        return {
          bgColor: theme.refColors.localBranch,
          textColor: theme.refColors.localBranchText,
        };
      case 'remoteBranch':
        return {
          bgColor: theme.refColors.remoteBranch,
          textColor: theme.refColors.remoteBranchText,
        };
      case 'tag':
        return {
          bgColor: theme.refColors.tag,
          textColor: theme.refColors.tagText,
        };
      default:
        return {
          bgColor: theme.refColors.localBranch,
          textColor: theme.refColors.localBranchText,
        };
    }
  }

  /**
   * Draw a filled rounded rectangle
   */
  private drawRoundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Stroke a rounded rectangle
   */
  private strokeRoundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Render FPS counter
   */
  private renderFps(): void {
    const { ctx, theme } = this;
    const stats = this.perfMonitor.getStats();

    ctx.fillStyle = stats.fps >= 55 ? theme.fpsColor : stats.fps >= 30 ? '#f59e0b' : '#ef4444';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${stats.fps} FPS`, 8, 8);

    ctx.fillStyle = theme.textColor;
    ctx.font = '10px monospace';
    ctx.fillText(`${stats.avgMs.toFixed(1)}ms`, 8, 24);
  }

  /**
   * Get color for a lane
   */
  private getLaneColor(lane: number): string {
    return this.theme.laneColors[lane % this.theme.laneColors.length];
  }

  /**
   * Get performance stats
   */
  getPerformanceStats(): ReturnType<PerformanceMonitor['getStats']> {
    return this.perfMonitor.getStats();
  }

  /**
   * Reset performance monitoring
   */
  resetPerformance(): void {
    this.perfMonitor.reset();
  }

  /**
   * Schedule a render on next animation frame
   */
  scheduleRender(data: RenderData): void {
    if (this.pendingFrame) return;

    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = 0;
      this.render(data);
    });
  }

  /**
   * Cancel pending render
   */
  cancelRender(): void {
    if (this.pendingFrame) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = 0;
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.cancelRender();
  }
}
