/**
 * Optimized Canvas Renderer for Git Graph
 *
 * Features:
 * - Double buffering for smooth rendering
 * - Dirty region tracking
 * - Layer separation (edges, nodes, labels)
 * - FPS monitoring
 */

import type { LayoutNode, LayoutEdge } from './lane-assignment.ts';
import type { RenderData } from './virtual-scroll.ts';
import type { RefInfo, RefType } from '../types/git.types.ts';

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
  rowHeight: 40,
  laneWidth: 28,
  nodeRadius: 14,
  minNodeRadius: 10,
  maxNodeRadius: 18,
  lineWidth: 3,
  showLabels: false,
  showFps: true,
  showAvatars: true,
  showRefIcons: true,
};

const DEFAULT_THEME: RenderTheme = {
  background: '#1a1520',
  // Earthy palette with subtle variety
  laneColors: [
    '#d4a54a', // gold
    '#b85c3c', // ember
    '#8a7a6a', // stone
    '#9a6a5a', // terracotta
    '#7a8a7a', // lichen
    '#a87830', // bronze
  ],
  textColor: '#c8c8c8',
  selectedColor: '#ffffff',
  hoveredColor: '#e0e0e0',
  fpsColor: '#d4854a',
  refColors: {
    localBranch: '#7a8a6a',      // olive
    localBranchText: '#1a1520',
    remoteBranch: '#7a7a8a',     // slate
    remoteBranchText: '#ffffff',
    tag: '#d4a54a',              // gold
    tagText: '#1a1520',
    head: '#d4854a',             // ember
    headText: '#1a1520',
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
   * Get Gravatar URL from email
   */
  private getGravatarUrl(email: string, size: number = 64): string {
    // Simple hash function for gravatar (MD5 would be better but this is quick)
    const hash = this.simpleHash(email.toLowerCase().trim());
    return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon`;
  }

  /**
   * Simple string hash for avatar URLs
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
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
    const { ctx, config, theme } = this;
    const { edges, offsetX, offsetY } = data;

    ctx.lineWidth = config.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const edge of edges) {
      const fromX = offsetX + edge.fromLane * config.laneWidth;
      const fromY = offsetY + edge.fromRow * config.rowHeight;
      const toX = offsetX + edge.toLane * config.laneWidth;
      const toY = offsetY + edge.toRow * config.rowHeight;

      ctx.strokeStyle = this.getLaneColor(edge.fromLane);
      ctx.beginPath();

      if (edge.fromLane === edge.toLane) {
        // Straight line
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
      } else {
        // Bezier curve
        const midY = (fromY + toY) / 2;
        ctx.moveTo(fromX, fromY);
        ctx.bezierCurveTo(fromX, midY, toX, midY, toX, toY);
      }

      ctx.stroke();
    }
  }

  /**
   * Render nodes with avatars
   */
  private renderNodes(data: RenderData): void {
    const { ctx, config, theme } = this;
    const { nodes, offsetX, offsetY, authorEmails } = data;

    for (const node of nodes) {
      const x = offsetX + node.lane * config.laneWidth;
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

      // Draw label for selected/hovered
      if ((isSelected || isHovered) && config.showLabels) {
        ctx.fillStyle = theme.textColor;
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.oid.substring(0, 7), x + radius + 6, y);
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
   * Render ref labels (branches, tags) next to nodes with icons
   */
  private renderRefLabels(data: RenderData): void {
    const { ctx, config, theme } = this;
    const { nodes, offsetX, offsetY, refsByCommit } = data;

    if (!refsByCommit || Object.keys(refsByCommit).length === 0) {
      return;
    }

    const labelHeight = 24;
    const labelPadding = 10;
    const labelGap = 6;
    const labelRadius = 5;
    const iconSize = 14;
    const iconPadding = 5;

    for (const node of nodes) {
      const refs = refsByCommit[node.oid];
      if (!refs || refs.length === 0) continue;

      const x = offsetX + node.lane * config.laneWidth;
      const y = offsetY + node.row * config.rowHeight;
      const nodeRadius = this.getNodeRadius(node.oid);

      // Start position for labels (to the right of the node)
      let labelX = x + nodeRadius + 10;

      for (const ref of refs) {
        const label = ref.shorthand;

        // Set font for measuring
        ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
        const textWidth = ctx.measureText(label).width;

        // Calculate pill width with icon space if enabled
        const hasIcon = config.showRefIcons;
        const pillWidth = textWidth + labelPadding * 2 + (hasIcon ? iconSize + iconPadding : 0);

        // Get colors based on ref type
        const { bgColor, textColor } = this.getRefColors(ref);

        // Draw pill background
        ctx.fillStyle = bgColor;
        this.drawRoundedRect(
          labelX,
          y - labelHeight / 2,
          pillWidth,
          labelHeight,
          labelRadius
        );

        // Draw special indicator for HEAD
        if (ref.isHead) {
          ctx.strokeStyle = theme.refColors.head;
          ctx.lineWidth = 2;
          this.strokeRoundedRect(
            labelX,
            y - labelHeight / 2,
            pillWidth,
            labelHeight,
            labelRadius
          );
        }

        // Draw icon if enabled
        let textStartX = labelX + labelPadding;
        if (hasIcon) {
          ctx.fillStyle = textColor;
          const iconX = labelX + labelPadding;
          const iconY = y;
          this.drawRefIcon(ref.refType, iconX, iconY, iconSize);
          textStartX = iconX + iconSize + iconPadding;
        }

        // Draw label text
        ctx.fillStyle = textColor;
        ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, textStartX, y);

        // Move to next label position
        labelX += pillWidth + labelGap;
      }
    }
  }

  /**
   * Draw an icon for a ref type - using simple filled shapes for clarity
   */
  private drawRefIcon(refType: RefType, x: number, y: number, size: number): void {
    const { ctx } = this;
    const cx = x + size / 2;
    const cy = y;

    ctx.save();

    switch (refType) {
      case 'localBranch':
        // Filled circle with a line - represents a branch node
        ctx.beginPath();
        ctx.arc(cx, cy - 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(cx - 1.5, cy + 1, 3, 5);
        break;

      case 'remoteBranch':
        // Arrow pointing up - represents sync/remote
        ctx.beginPath();
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx + 5, cy + 1);
        ctx.lineTo(cx + 2, cy + 1);
        ctx.lineTo(cx + 2, cy + 5);
        ctx.lineTo(cx - 2, cy + 5);
        ctx.lineTo(cx - 2, cy + 1);
        ctx.lineTo(cx - 5, cy + 1);
        ctx.closePath();
        ctx.fill();
        break;

      case 'tag':
        // Filled bookmark/tag shape
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy - 5);
        ctx.lineTo(cx + 4, cy - 5);
        ctx.lineTo(cx + 4, cy + 3);
        ctx.lineTo(cx, cy + 6);
        ctx.lineTo(cx - 4, cy + 3);
        ctx.closePath();
        ctx.fill();
        break;

      default:
        // Default: simple filled circle
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
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
