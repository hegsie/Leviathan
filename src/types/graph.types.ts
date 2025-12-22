/**
 * Graph visualization type definitions
 */

export interface GraphNode {
  oid: string;
  row: number;
  lane: number;
  color: string;
  commit: GraphCommitInfo;
  parents: GraphEdge[];
  children: string[];
  refs: GraphRef[];
}

export interface GraphCommitInfo {
  shortId: string;
  summary: string;
  author: string;
  authorEmail: string;
  timestamp: number;
}

export interface GraphEdge {
  fromOid: string;
  toOid: string;
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
  color: string;
  isMerge: boolean;
}

export interface GraphRef {
  name: string;
  type: GraphRefType;
  isHead: boolean;
  color: string;
}

export type GraphRefType = 'local-branch' | 'remote-branch' | 'tag' | 'stash' | 'head';

export interface GraphLayout {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  maxLane: number;
  totalRows: number;
}

export interface GraphViewport {
  startRow: number;
  endRow: number;
  scrollTop: number;
  visibleHeight: number;
}

export interface GraphDimensions {
  rowHeight: number;
  laneWidth: number;
  nodeRadius: number;
  lineWidth: number;
  padding: number;
}

export interface GraphTheme {
  colors: string[];
  nodeStrokeColor: string;
  nodeFillColor: string;
  selectedNodeColor: string;
  hoveredNodeColor: string;
  lineColor: string;
  backgroundColor: string;
}

export interface HitTestResult {
  type: 'node' | 'edge' | 'ref' | 'none';
  oid?: string;
  ref?: GraphRef;
  edge?: GraphEdge;
  x: number;
  y: number;
}

export interface GraphSelection {
  selectedOid: string | null;
  hoveredOid: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
}

export interface LaneAssignment {
  oid: string;
  lane: number;
  row: number;
}

export interface GraphRenderOptions {
  showBranchLabels: boolean;
  showTagLabels: boolean;
  showAvatars: boolean;
  compactMode: boolean;
  animateTransitions: boolean;
}
