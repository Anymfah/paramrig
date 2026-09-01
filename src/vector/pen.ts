import { createVectorElement } from '@/vector/document'
import type { VectorElement, VectorPoint } from '@/vector/types'
import { elementFromWorldNodes, normalizeAbsoluteNodes, subpathFields, subpathRanges, worldNodes, type AbsoluteNode, type SubpathRange } from '@/vector/vectorPath'

export type PenDraft = {
  /** World-space nodes placed so far. */
  nodes: AbsoluteNode[]
  closed: boolean
  /** Set when the draft extends an existing open sub-path. */
  continue?: { id: string; end: 'start' | 'end'; subpath: number; element: VectorElement }
}

export function penStart(point: VectorPoint): PenDraft {
  return { nodes: [{ anchor: point }], closed: false }
}

export function penAddAnchor(draft: PenDraft, point: VectorPoint): PenDraft {
  return { ...draft, nodes: [...draft.nodes, { anchor: point }] }
}

/**
 * Drags the out handle of node `index` to `point`. The in handle mirrors it unless `alt`
 * is held, in which case an existing in handle stays put (a cusp).
 */
export function penDragHandle(draft: PenDraft, index: number, point: VectorPoint, alt = false): PenDraft {
  const node = draft.nodes[index]
  if (!node) return draft
  const anchor = node.anchor
  const moved = Math.hypot(point.x - anchor.x, point.y - anchor.y) > 0.5
  const out = moved ? point : undefined
  const mirrored = moved ? { x: anchor.x * 2 - point.x, y: anchor.y * 2 - point.y } : undefined
  const next: AbsoluteNode = {
    anchor,
    ...(alt && node.in ? { in: node.in } : mirrored ? { in: mirrored } : {}),
    ...(out ? { out } : {}),
  }
  const nodes = [...draft.nodes]
  nodes[index] = next
  return { ...draft, nodes }
}

export function penRemoveLast(draft: PenDraft): PenDraft | null {
  if (draft.nodes.length <= 1) return null
  return { ...draft, nodes: draft.nodes.slice(0, -1) }
}

export function penClose(draft: PenDraft): PenDraft {
  return { ...draft, closed: true }
}

/** Whether a click at `point` would close the path on its first anchor. */
export function penCanClose(draft: PenDraft, point: VectorPoint, threshold: number): boolean {
  if (draft.nodes.length < 3) return false
  const first = draft.nodes[0]!.anchor
  return Math.hypot(point.x - first.x, point.y - first.y) <= threshold
}

/** Starts a draft from an open sub-path so new anchors extend it from `end`. */
export function penFromElement(element: VectorElement, end: 'start' | 'end', subpath = 0): PenDraft | null {
  if (!element.vectorNodes || element.vectorNodes.length < 2) return null
  const ranges = subpathRanges(element, element.vectorNodes.length)
  const range = ranges[subpath]
  if (!range || range.closed) return null
  const nodes = worldNodes(element).slice(range.start, range.end)
  const ordered = end === 'end' ? nodes : [...nodes].reverse().map((node) => ({ ...node, ...(node.out ? { in: node.out } : { in: undefined }), ...(node.in ? { out: node.in } : { out: undefined }) })).map(stripUndefined)
  return { nodes: ordered, closed: false, continue: { id: element.id, end, subpath, element } }
}

function stripUndefined(node: AbsoluteNode): AbsoluteNode {
  return { anchor: node.anchor, ...(node.in ? { in: node.in } : {}), ...(node.out ? { out: node.out } : {}), ...(node.handles ? { handles: node.handles } : {}), ...(node.radius ? { radius: node.radius } : {}) }
}

export type PenStyle = Pick<VectorElement, 'fill' | 'stroke' | 'strokeWidth'>

/** A new element for a fresh draft, or a geometry patch for a continued one. Returns null for a single lonely anchor. */
export function penCommit(draft: PenDraft, style?: Partial<PenStyle>): { element: VectorElement } | { id: string; patch: Partial<VectorElement> } | null {
  if (draft.nodes.length < 2) return null
  const built = elementFromWorldNodes(draft.nodes)
  if (draft.continue) {
    const source = draft.continue.element
    const sourceNodes = source.vectorNodes ?? []
    const world = worldNodes(source, sourceNodes)
    const ranges = subpathRanges(source, sourceNodes.length)
    const merged: AbsoluteNode[] = []
    const nextRanges: SubpathRange[] = []
    ranges.forEach((range, position) => {
      const run = position === draft.continue!.subpath ? draft.nodes : world.slice(range.start, range.end)
      const closed = position === draft.continue!.subpath ? draft.closed : range.closed
      nextRanges.push({ start: merged.length, end: merged.length + run.length, closed })
      merged.push(...run)
    })
    const box = normalizeAbsoluteNodes({ x: 0, y: 0, width: 0, height: 0, rotation: 0 }, merged)
    return { id: draft.continue.id, patch: { ...box, ...subpathFields(nextRanges), rotation: 0, kind: 'path' } }
  }
  const element = createVectorElement('path', built, { ...style, vectorNodes: built.vectorNodes, closed: draft.closed })
  return { element }
}

/** Path data for the placed segments plus the rubber-band segment towards the cursor. */
export function penPreviewData(draft: PenDraft, cursor?: VectorPoint | null): string {
  const nodes = draft.nodes
  if (nodes.length === 0) return ''
  const commands = [`M ${round(nodes[0]!.anchor.x)} ${round(nodes[0]!.anchor.y)}`]
  for (let index = 1; index < nodes.length; index += 1) {
    commands.push(segment(nodes[index - 1]!, nodes[index]!))
  }
  if (draft.closed && nodes.length > 2) {
    commands.push(segment(nodes[nodes.length - 1]!, nodes[0]!))
    commands.push('Z')
  } else if (cursor) {
    commands.push(segment(nodes[nodes.length - 1]!, { anchor: cursor }))
  }
  return commands.join(' ')
}

function segment(from: AbsoluteNode, to: AbsoluteNode): string {
  if (!from.out && !to.in) return `L ${round(to.anchor.x)} ${round(to.anchor.y)}`
  const a = from.out ?? from.anchor
  const b = to.in ?? to.anchor
  return `C ${round(a.x)} ${round(a.y)} ${round(b.x)} ${round(b.y)} ${round(to.anchor.x)} ${round(to.anchor.y)}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
