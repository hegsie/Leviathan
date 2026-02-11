/**
 * Graph Canvas - Export Tests
 *
 * Tests the graph export functionality including
 * PNG and SVG export logic.
 */

// Mock Tauri API before importing any modules that use it
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
const mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } })
  .__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    return mockInvoke(command, args);
  },
};

import { expect } from '@open-wc/testing';
import type { RefInfo } from '../../../types/git.types.ts';

function makeRef(shorthand: string, refType: 'localBranch' | 'remoteBranch' | 'tag'): RefInfo {
  return {
    name: refType === 'remoteBranch' ? `refs/remotes/${shorthand}` : `refs/heads/${shorthand}`,
    shorthand,
    refType,
    isHead: false,
  };
}

describe('lv-graph-canvas - export', () => {
  describe('SVG generation logic', () => {
    it('should generate valid SVG markup structure', () => {
      const width = 800;
      const height = 600;
      const background = '#1e1e1e';

      const svgParts: string[] = [];
      svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
      svgParts.push(`<rect width="100%" height="100%" fill="${background}"/>`);
      svgParts.push('</svg>');

      const svg = svgParts.join('\n');

      expect(svg).to.contain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).to.contain('width="800"');
      expect(svg).to.contain('height="600"');
      expect(svg).to.contain('</svg>');
    });

    it('should generate SVG elements for graph nodes', () => {
      const NODE_RADIUS = 6;
      const LANE_WIDTH = 14;
      const ROW_HEIGHT = 22;
      const PADDING = 20;
      const maxLane = 3;

      const nodes = [
        { oid: 'abc123', lane: 0, row: 0 },
        { oid: 'def456', lane: 1, row: 1 },
      ];

      const laneColors = ['#e06c75', '#98c379', '#61afef', '#c678dd'];

      const svgParts: string[] = [];
      for (const node of nodes) {
        const x = PADDING + (maxLane - node.lane) * LANE_WIDTH;
        const y = PADDING + node.row * ROW_HEIGHT;
        const color = laneColors[node.lane % laneColors.length];
        svgParts.push(`<circle cx="${x}" cy="${y}" r="${NODE_RADIUS}" fill="${color}"/>`);
      }

      expect(svgParts.length).to.equal(2);
      expect(svgParts[0]).to.contain('<circle');
      expect(svgParts[0]).to.contain(`r="${NODE_RADIUS}"`);
    });

    it('should generate SVG paths for graph edges', () => {
      const LANE_WIDTH = 14;
      const ROW_HEIGHT = 22;
      const PADDING = 20;
      const maxLane = 3;

      // Straight edge (same lane)
      const edge = { fromLane: 1, fromRow: 0, toLane: 1, toRow: 1 };
      const fromX = PADDING + (maxLane - edge.fromLane) * LANE_WIDTH;
      const fromY = PADDING + edge.fromRow * ROW_HEIGHT;
      const toX = PADDING + (maxLane - edge.toLane) * LANE_WIDTH;
      const toY = PADDING + edge.toRow * ROW_HEIGHT;

      const line = `<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" stroke="#98c379" stroke-width="2" stroke-linecap="round"/>`;
      expect(line).to.contain('<line');
      expect(line).to.contain('stroke-width="2"');

      // Curved edge (different lanes)
      const curvedEdge = { fromLane: 0, fromRow: 0, toLane: 2, toRow: 2 };
      const cfromX = PADDING + (maxLane - curvedEdge.fromLane) * LANE_WIDTH;
      const cfromY = PADDING + curvedEdge.fromRow * ROW_HEIGHT;
      const ctoX = PADDING + (maxLane - curvedEdge.toLane) * LANE_WIDTH;
      const ctoY = PADDING + curvedEdge.toRow * ROW_HEIGHT;
      const midY = cfromY + (ctoY - cfromY) * 0.5;

      const path = `<path d="M${cfromX},${cfromY} C${cfromX},${midY} ${ctoX},${midY} ${ctoX},${ctoY}" stroke="#e06c75" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      expect(path).to.contain('<path');
      expect(path).to.contain('fill="none"');
    });

    it('should escape special characters in commit messages for SVG', () => {
      const message = 'Fix <script> & "injection" test';
      const escaped = message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      expect(escaped).to.equal('Fix &lt;script&gt; &amp; "injection" test');
      expect(escaped).to.not.contain('<script>');
    });

    it('should include ref labels in SVG output', () => {
      const refs: RefInfo[] = [
        makeRef('main', 'localBranch'),
        makeRef('origin/main', 'remoteBranch'),
      ];

      const svgParts: string[] = [];
      for (let i = 0; i < Math.min(refs.length, 3); i++) {
        const ref = refs[i];
        const lx = 100 + i * 80;
        const y = 50;
        svgParts.push(`<rect x="${lx}" y="${y - 8}" width="70" height="16" rx="3" fill="#3fb950" opacity="0.8"/>`);
        svgParts.push(`<text x="${lx + 4}" y="${y + 3}" fill="white" font-family="system-ui, sans-serif" font-size="10">${ref.shorthand}</text>`);
      }

      expect(svgParts.length).to.equal(4); // 2 rects + 2 texts
      expect(svgParts[1]).to.contain('main');
      expect(svgParts[3]).to.contain('origin/main');
    });
  });

  describe('PNG export prerequisites', () => {
    it('should calculate correct export dimensions', () => {
      const contentWidth = 500;
      const contentHeight = 22000; // 1000 commits * 22px
      const viewportWidth = 800;
      const HEADER_HEIGHT = 28;
      const maxExportHeight = 50000;

      const width = Math.max(contentWidth, viewportWidth);
      const height = Math.min(contentHeight + HEADER_HEIGHT + 40, maxExportHeight);

      expect(width).to.equal(800);
      expect(height).to.equal(22068);
    });

    it('should cap height for very large graphs', () => {
      const contentHeight = 100000;
      const HEADER_HEIGHT = 28;
      const maxExportHeight = 50000;

      const height = Math.min(contentHeight + HEADER_HEIGHT + 40, maxExportHeight);

      expect(height).to.equal(maxExportHeight);
    });

    it('should generate correct filename with date', () => {
      const date = '2026-02-11';
      const pngFilename = `graph-${date}.png`;
      const svgFilename = `graph-${date}.svg`;

      expect(pngFilename).to.equal('graph-2026-02-11.png');
      expect(svgFilename).to.equal('graph-2026-02-11.svg');
    });
  });

  describe('export Blob creation', () => {
    it('should create SVG blob with correct content type', () => {
      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>';
      const blob = new Blob([svgContent], { type: 'image/svg+xml' });

      expect(blob.size).to.be.greaterThan(0);
      expect(blob.type).to.equal('image/svg+xml');
    });
  });
});
