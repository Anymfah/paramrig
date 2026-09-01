import type { VectorElement, VectorNode, VectorPoint } from '@/vector/types'
import { absoluteNodes, neighbours, normalizeAbsoluteNodes, subpathFields, subpathOfNode, subpathRanges, worldNodes, type AbsoluteNode, type SubpathRange } from '@/vector/vectorPath'

type PathLike = Pick<VectorElement, 'closed' | 'subpaths'>

export { neighbours, subpathFields, subpathOfNode, subpathRanges, type SubpathRange }

export type NodeEdit = Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'closed' | 'subpaths'> & { vectorNodes: VectorNode[] }

/** Rebuilds the box from local nodes and re-attaches sub-path metadata. */
export function rebuild(element: VectorElement, absolute: AbsoluteNode[], ranges: SubpathRange[]): NodeEdit {
  return { ...normalizeAbsoluteNodes(element, absolute), ...subpathFields(ranges) }
}

/** Removes nodes, dropping sub-paths that fall below two nodes. Returns null when nothing remains. */
export function deleteNodes(element: VectorElement, nodes: VectorNode[], indices: number[]): NodeEdit | null {
  const removed = new Set(indices)
  const ranges = subpathRanges(element, nodes.length)
  const absolute = absoluteNodes(element, nodes)
  const kept: AbsoluteNode[] = []
  const nextRanges: SubpathRange[] = []
  for (const range of ranges) {
    const run: AbsoluteNode[] = []
    for (let index = range.start; index < range.end; index += 1) if (!removed.has(index)) run.push(absolute[index]!)
    if (run.length < 2) continue
    const closed = range.closed && run.length >= 3
    nextRanges.push({ start: kept.length, end: kept.length + run.length, closed })
    kept.push(...run)
  }
  if (kept.length === 0) return null
  return rebuild(element, kept, nextRanges)
}

/** Whether the node is a free end of an open sub-path. */
export function isEndpoint(element: PathLike, nodeCount: number, index: number): 'start' | 'end' | null {
  const range = subpathOfNode(element, nodeCount, index)
  if (!range || range.closed) return null
  if (index === range.start) return 'start'
  if (index === range.end - 1) return 'end'
  return null
}

/** Every free end of the element, in world space. */
export function openEndpoints(element: VectorElement, nodes = element.vectorNodes ?? []): Array<{ index: number; end: 'start' | 'end'; point: VectorPoint; subpath: number }> {
  if (!nodes.length) return []
  const world = worldNodes(element, nodes)
  const result: Array<{ index: number; end: 'start' | 'end'; point: VectorPoint; subpath: number }> = []
  subpathRanges(element, nodes.length).forEach((range, subpath) => {
    if (range.closed) return
    result.push({ index: range.start, end: 'start', point: world[range.start]!.anchor, subpath })
    result.push({ index: range.end - 1, end: 'end', point: world[range.end - 1]!.anchor, subpath })
  })
  return result
}

/**
 * Connects two free ends. On the same sub-path this closes it; across sub-paths the second is
 * re-ordered and appended so the join segment runs from `a` to `b`. Coincident ends merge into one node.
 */
export function joinNodes(element: VectorElement, nodes: VectorNode[], a: number, b: number): NodeEdit | null {
  const ranges = subpathRanges(element, nodes.length)
  const endA = isEndpoint(element, nodes.length, a)
  const endB = isEndpoint(element, nodes.length, b)
  if (!endA || !endB || a === b) return null
  const absolute = absoluteNodes(element, nodes)
  const rangeA = subpathOfNode(element, nodes.length, a)!
  const rangeB = subpathOfNode(element, nodes.length, b)!
  if (rangeA.start === rangeB.start) {
    return rebuild(element, absolute, ranges.map((range) => range.start === rangeA.start ? { ...range, closed: true } : range))
  }
  const runA = absolute.slice(rangeA.start, rangeA.end)
  const runB = absolute.slice(rangeB.start, rangeB.end)
  const orderedA = endA === 'end' ? runA : reverseRun(runA)
  const orderedB = endB === 'start' ? runB : reverseRun(runB)
  const last = orderedA[orderedA.length - 1]!
  const first = orderedB[0]!
  const coincident = Math.hypot(last.anchor.x - first.anchor.x, last.anchor.y - first.anchor.y) <= 0.5
  const merged = coincident
    ? [...orderedA.slice(0, -1), { anchor: last.anchor, ...(last.in ? { in: last.in } : {}), ...(first.out ? { out: first.out } : {}) }, ...orderedB.slice(1)]
    : [...orderedA, ...orderedB]
  const kept: AbsoluteNode[] = []
  const nextRanges: SubpathRange[] = []
  for (const range of ranges) {
    if (range.start === rangeA.start) {
      nextRanges.push({ start: kept.length, end: kept.length + merged.length, closed: false })
      kept.push(...merged)
    } else if (range.start === rangeB.start) {
      continue
    } else {
      nextRanges.push({ start: kept.length, end: kept.length + (range.end - range.start), closed: range.closed })
      kept.push(...absolute.slice(range.start, range.end))
    }
  }
  return rebuild(element, kept, nextRanges)
}

/** Opens a closed sub-path at a node, or cuts an open one into two sub-paths sharing a duplicated node. */
export function splitAtNode(element: VectorElement, nodes: VectorNode[], index: number): NodeEdit | null {
  const ranges = subpathRanges(element, nodes.length)
  const target = subpathOfNode(element, nodes.length, index)
  if (!target) return null
  const absolute = absoluteNodes(element, nodes)
  const run = absolute.slice(target.start, target.end)
  const local = index - target.start
  const node = run[local]!
  let replacement: AbsoluteNode[][]
  if (target.closed) {
    const rotated = [...run.slice(local), ...run.slice(0, local)]
    replacement = [[...rotated, { anchor: node.anchor, ...(node.in ? { in: node.in } : {}) }].map((item, position) => position === 0 ? { anchor: item.anchor, ...(item.out ? { out: item.out } : {}) } : item)]
  } else {
    if (local === 0 || local === run.length - 1) return null
    replacement = [
      [...run.slice(0, local), { anchor: node.anchor, ...(node.in ? { in: node.in } : {}) }],
      [{ anchor: node.anchor, ...(node.out ? { out: node.out } : {}) }, ...run.slice(local + 1)],
    ]
  }
  return replaceSubpath(element, absolute, ranges, target, replacement.map((run) => ({ run, closed: false })))
}

/** Deletes the segment that starts at `index`, opening or cutting its sub-path. */
export function breakSegment(element: VectorElement, nodes: VectorNode[], index: number): NodeEdit | null {
  const ranges = subpathRanges(element, nodes.length)
  const target = subpathOfNode(element, nodes.length, index)
  if (!target) return null
  const next = neighbours(element, nodes.length, index).next
  if (next === null) return null
  const absolute = absoluteNodes(element, nodes)
  const run = absolute.slice(target.start, target.end)
  const local = index - target.start
  if (target.closed) {
    const rotated = [...run.slice(local + 1), ...run.slice(0, local + 1)]
    return replaceSubpath(element, absolute, ranges, target, [{ run: rotated, closed: false }])
  }
  const head = run.slice(0, local + 1)
  const tail = run.slice(local + 1)
  return replaceSubpath(element, absolute, ranges, target, [{ run: head, closed: false }, { run: tail, closed: false }].filter((part) => part.run.length >= 2))
}

/** Sets the closed flag of the sub-path containing `index` (or every sub-path when index is null). */
export function setClosed(element: VectorElement, nodes: VectorNode[], index: number | null, closed: boolean): NodeEdit | null {
  const ranges = subpathRanges(element, nodes.length)
  const next = ranges.map((range) => {
    const applies = index === null || (index >= range.start && index < range.end)
    if (!applies) return range
    if (closed && range.end - range.start < 3) return range
    return { ...range, closed }
  })
  if (next.every((range, position) => range.closed === ranges[position]!.closed)) return null
  return rebuild(element, absoluteNodes(element, nodes), next)
}

function replaceSubpath(
  element: VectorElement,
  absolute: AbsoluteNode[],
  ranges: SubpathRange[],
  target: SubpathRange,
  replacement: Array<{ run: AbsoluteNode[]; closed: boolean }>,
): NodeEdit | null {
  const kept: AbsoluteNode[] = []
  const nextRanges: SubpathRange[] = []
  for (const range of ranges) {
    const parts = range.start === target.start ? replacement : [{ run: absolute.slice(range.start, range.end), closed: range.closed }]
    for (const part of parts) {
      if (part.run.length < 2) continue
      nextRanges.push({ start: kept.length, end: kept.length + part.run.length, closed: part.closed && part.run.length >= 3 })
      kept.push(...part.run)
    }
  }
  if (kept.length === 0) return null
  return rebuild(element, kept, nextRanges)
}

function reverseRun(run: AbsoluteNode[]): AbsoluteNode[] {
  return [...run].reverse().map((node) => ({ anchor: node.anchor, ...(node.out ? { in: node.out } : {}), ...(node.in ? { out: node.in } : {}) }))
}

/** Merges several path elements into one, baking each rotation into world-space nodes. */
export function combineElements(elements: VectorElement[], nodesOf: (element: VectorElement) => VectorNode[]): NodeEdit & { fillRule: VectorElement['fillRule'] } | null {
  const world: AbsoluteNode[] = []
  const ranges: SubpathRange[] = []
  for (const element of elements) {
    const nodes = nodesOf(element)
    if (nodes.length < 2) continue
    const absolute = worldNodes(element, nodes)
    for (const range of subpathRanges(element, nodes.length)) {
      ranges.push({ start: world.length, end: world.length + (range.end - range.start), closed: range.closed })
      world.push(...absolute.slice(range.start, range.end))
    }
  }
  if (world.length === 0) return null
  const box = normalizeAbsoluteNodes({ x: 0, y: 0, width: 0, height: 0, rotation: 0 }, world)
  return { ...box, ...subpathFields(ranges), fillRule: elements.length > 1 ? 'evenodd' : elements[0]?.fillRule }
}

/** Splits an element's sub-paths into separate world-space node sets. */
export function separateSubpaths(element: VectorElement, nodes: VectorNode[]): Array<NodeEdit> {
  const absolute = worldNodes(element, nodes)
  return subpathRanges(element, nodes.length).map((range) => {
    const run = absolute.slice(range.start, range.end)
    const box = normalizeAbsoluteNodes({ x: 0, y: 0, width: 0, height: 0, rotation: 0 }, run)
    return { ...box, ...subpathFields([{ start: 0, end: run.length, closed: range.closed }]) }
  })
}

/** Shifts sub-path starts after an insertion at `insertedIndex`. */
export function subpathsAfterInsert(element: PathLike, nodeCount: number, insertedIndex: number): Pick<VectorElement, 'closed' | 'subpaths'> {
  const ranges = subpathRanges(element, nodeCount)
  return subpathFields(ranges.map((range) => ({
    start: range.start >= insertedIndex ? range.start + 1 : range.start,
    end: range.end >= insertedIndex ? range.end + 1 : range.end,
    closed: range.closed,
  })))
}
