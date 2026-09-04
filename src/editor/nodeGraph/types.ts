/**
 * A node graph, as an editor needs one.
 *
 * Deliberately not a shader graph: the editor knows nodes, ports, cables and frames, and nothing
 * about what they compile to. What a node *is* comes from a registry the caller passes in, and what
 * a node's fields look like comes from a `renderWidget` the caller passes in — so the same editor
 * can draw a material graph, and one day something else, without either knowing about the other.
 */

export type NodeSocketTone = 'scalar' | 'vector' | 'color' | 'shader'

export type NodeSocket = { id: string; label: string; tone: NodeSocketTone }

/** What the editor needs to know about a kind of node. The caller's registry answers it. */
export type NodeTypeInfo = {
  type: string
  label: string
  category: string
  inputs: NodeSocket[]
  outputs: NodeSocket[]
  /** How many rows of fields the node reserves between its outputs and its inputs. */
  widgets: number
  description?: string
}

export type GraphNode = {
  id: string
  type: string
  /** World pixels. Not percentages: a node keeps its size when the graph is zoomed. */
  x: number
  y: number
  /** Folded nodes draw their header and their cables and nothing else. */
  collapsed?: boolean
  /** Which frame the node belongs to, when it belongs to one. */
  frame?: string
}

export type GraphEdge = {
  id: string
  fromNode: string
  fromPort: string
  toNode: string
  toPort: string
  tone: NodeSocketTone
}

export type GraphFrame = {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  /** One of the kit's tones, or nothing for the plain one. */
  tone?: string
}

export type NodeGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  frames: GraphFrame[]
}

export type NodeGraphSelection = { nodes: string[]; edges: string[]; frames: string[] }

export const EMPTY_SELECTION: NodeGraphSelection = { nodes: [], edges: [], frames: [] }

/* ------------------------------------------------------------- the metrics */

/** A node is this wide, always: a column of equal cards reads faster than a ragged one. */
export const NODE_WIDTH = 220

/** The title bar, and every row under it. */
export const HEADER_HEIGHT = 30
export const ROW_HEIGHT = 26
export const NODE_PADDING = 8

/** The socket's glyph, and the target a pointer is allowed to be sloppy within. */
export const PORT_RADIUS = 5
export const PORT_TARGET = 32

/** How far the grid snaps a dragged node, in world pixels. */
export const GRID_STEP = 20
