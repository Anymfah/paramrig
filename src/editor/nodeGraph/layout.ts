import {
  HEADER_HEIGHT, NODE_PADDING, NODE_WIDTH, ROW_HEIGHT,
  type GraphNode, type NodeGraph, type NodeTypeInfo,
} from '@/editor/nodeGraph/types'

/**
 * Where everything is, worked out rather than measured.
 *
 * Prismorphic measures its ports out of the DOM, which means a cable cannot be drawn until the
 * browser has laid the node out — so a dragged node's cables lag a frame behind it. Here a port's
 * place is arithmetic on the node's position and the port's index, which is known before anything
 * is drawn: the cable and the node move in the same frame, always.
 *
 * The order down a node is Blender's: the title, then the outputs, then the fields, then the
 * inputs. It reads left to right — what comes out is nearest the cables going right.
 */

export function nodeRows(info: NodeTypeInfo): number {
  return info.outputs.length + info.widgets + info.inputs.length
}

export function nodeHeight(info: NodeTypeInfo, node?: GraphNode): number {
  if (node?.collapsed) return HEADER_HEIGHT
  return HEADER_HEIGHT + nodeRows(info) * ROW_HEIGHT + NODE_PADDING
}

/** Which row a port sits on: outputs first, then the fields, then the inputs. */
export function portRow(info: NodeTypeInfo, side: 'in' | 'out', portId: string): number {
  if (side === 'out') return info.outputs.findIndex((port) => port.id === portId)
  const index = info.inputs.findIndex((port) => port.id === portId)
  return index < 0 ? -1 : info.outputs.length + info.widgets + index
}

/**
 * Where a port's dot is, in world pixels.
 *
 * A folded node gathers every one of its ports onto its title bar, which is what makes folding
 * safe: the cables stay attached, they simply all arrive at the same place.
 */
export function portPoint(
  node: GraphNode,
  info: NodeTypeInfo,
  side: 'in' | 'out',
  portId: string,
): { x: number; y: number } {
  const x = side === 'out' ? node.x + NODE_WIDTH : node.x
  if (node.collapsed) return { x, y: node.y + HEADER_HEIGHT / 2 }
  const row = portRow(info, side, portId)
  if (row < 0) return { x, y: node.y + HEADER_HEIGHT / 2 }
  return { x, y: node.y + HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2 }
}

/**
 * A cable as an SVG path: a cubic whose handles reach sideways.
 *
 * The reach grows with the gap and never shrinks below forty pixels, so a cable between two nodes
 * sitting on top of each other still leaves the socket horizontally — which is what makes it read
 * as a wire rather than as a crease.
 */
export function cablePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const reach = Math.max(40, Math.abs(to.x - from.x) * 0.5)
  return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`
}

/** The rectangle a node occupies, for a box selection and for the minimap. */
export function nodeBox(node: GraphNode, info: NodeTypeInfo): { x: number; y: number; width: number; height: number } {
  return { x: node.x, y: node.y, width: NODE_WIDTH, height: nodeHeight(info, node) }
}

/** Whether two rectangles touch at all, which is what a box selection asks. */
export function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Everything the graph covers, for framing it and for the minimap. */
export function graphBounds(
  graph: NodeGraph,
  infoOf: (type: string) => NodeTypeInfo | null,
): { x: number; y: number; width: number; height: number } {
  if (graph.nodes.length === 0 && graph.frames.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const take = (box: { x: number; y: number; width: number; height: number }) => {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  for (const node of graph.nodes) {
    const info = infoOf(node.type)
    if (info) take(nodeBox(node, info))
  }
  for (const frame of graph.frames) take(frame)
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

/** A position snapped to the grid, which is what ⌃ during a drag asks for. */
export function snapped(value: number, step: number): number {
  return step <= 0 ? value : Math.round(value / step) * step
}

/**
 * The graph laid out again: every node put in a column by how far it is from the output.
 *
 * It is the layered layout every node editor uses, and the reason is that a graph reads as a flow:
 * a node's column is one past the deepest column of anything feeding it, so cables only ever go
 * right. Within a column the nodes keep the vertical order they were in, so a person's own
 * arrangement survives as far as it can.
 */
export function autoLayout(
  graph: NodeGraph,
  infoOf: (type: string) => NodeTypeInfo | null,
  options: { columnGap?: number; rowGap?: number } = {},
): GraphNode[] {
  const columnGap = options.columnGap ?? 80
  const rowGap = options.rowGap ?? 30
  const feeders = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const list = feeders.get(edge.toNode) ?? []
    list.push(edge.fromNode)
    feeders.set(edge.toNode, list)
  }
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const sources = feeders.get(id) ?? []
    const found = sources.length === 0 ? 0 : Math.max(...sources.map((source) => depthOf(source) + 1))
    visiting.delete(id)
    depth.set(id, found)
    return found
  }
  for (const node of graph.nodes) depthOf(node.id)

  const columns = new Map<number, GraphNode[]>()
  for (const node of [...graph.nodes].sort((a, b) => a.y - b.y)) {
    const column = depth.get(node.id) ?? 0
    const list = columns.get(column) ?? []
    list.push(node)
    columns.set(column, list)
  }
  const placed: GraphNode[] = []
  let x = 0
  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    let y = 0
    for (const node of columns.get(column) ?? []) {
      const info = infoOf(node.type)
      placed.push({ ...node, x, y })
      y += (info ? nodeHeight(info, node) : HEADER_HEIGHT) + rowGap
    }
    x += NODE_WIDTH + columnGap
  }
  const order = new Map(placed.map((node) => [node.id, node]))
  return graph.nodes.map((node) => order.get(node.id) ?? node)
}
