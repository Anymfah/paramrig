import { selectionBounds, type Bounds } from '@/vector/geometry'
import type { VectorElement, VectorGuide, VectorPoint } from '@/vector/types'
import { worldNetwork } from '@/vector/network'

export type SnapAxis = 'x' | 'y'
export type SnapKind = 'edge' | 'center' | 'page' | 'guide' | 'node'

export type SnapTarget = {
  axis: SnapAxis
  value: number
  kind: SnapKind
  /** Extent of the source along the other axis, used to draw the smart guide. */
  span: [number, number]
}

/** A line to draw: vertical at `x = value` when axis is 'x', spanning `from..to` on the other axis. */
export type SnapMatch = { axis: SnapAxis; value: number; kind: SnapKind; from: number; to: number }

export type SnapOptions = {
  objects: boolean
  guides: boolean
  pixel: boolean
}

export function collectSnapTargets(
  elements: VectorElement[],
  excludeIds: string[],
  page: { width: number; height: number } | null,
  guides: VectorGuide[],
  options: Pick<SnapOptions, 'objects' | 'guides'> & { nodes?: boolean },
): SnapTarget[] {
  const targets: SnapTarget[] = []
  if (options.objects) {
    const excluded = new Set(excludeIds)
    for (const element of elements) {
      if (excluded.has(element.id) || !element.visible || element.kind === 'group') continue
      if (element.parentId && excluded.has(element.parentId)) continue
      const bounds = selectionBounds([element])
      pushBounds(targets, bounds, 'edge', 'center')
      if (options.nodes && element.network && element.network.nodes.length <= 512) {
        const world = worldNetwork(element)
        const byId = new Map(world.nodes.map((node) => [node.id, node.point]))
        for (const node of world.nodes) pushPoint(targets, node.point)
        for (const segment of world.segments) {
          if (segment.ah || segment.bh) continue
          const a = byId.get(segment.a)!
          const b = byId.get(segment.b)!
          pushPoint(targets, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
        }
      }
    }
    if (page) {
      const bounds = { x: 0, y: 0, width: page.width, height: page.height }
      pushBounds(targets, bounds, 'page', 'page')
    }
  }
  if (options.guides) {
    for (const guide of guides) {
      targets.push({ axis: guide.axis, value: guide.position, kind: 'guide', span: [-1e5, 1e5] })
    }
  }
  return targets
}

function pushPoint(targets: SnapTarget[], point: VectorPoint) {
  targets.push({ axis: 'x', value: point.x, kind: 'node', span: [point.y, point.y] }, { axis: 'y', value: point.y, kind: 'node', span: [point.x, point.x] })
}

function pushBounds(targets: SnapTarget[], bounds: Bounds, edgeKind: SnapKind, centerKind: SnapKind) {
  const xSpan: [number, number] = [bounds.y, bounds.y + bounds.height]
  const ySpan: [number, number] = [bounds.x, bounds.x + bounds.width]
  targets.push(
    { axis: 'x', value: bounds.x, kind: edgeKind, span: xSpan },
    { axis: 'x', value: bounds.x + bounds.width / 2, kind: centerKind, span: xSpan },
    { axis: 'x', value: bounds.x + bounds.width, kind: edgeKind, span: xSpan },
    { axis: 'y', value: bounds.y, kind: edgeKind, span: ySpan },
    { axis: 'y', value: bounds.y + bounds.height / 2, kind: centerKind, span: ySpan },
    { axis: 'y', value: bounds.y + bounds.height, kind: edgeKind, span: ySpan },
  )
}

type AxisSnap = { offset: number; matches: SnapMatch[] } | null

/**
 * Finds the smallest shift that brings one of `candidates` (positions along `axis`) onto a target.
 * `movingSpan` is the moving object's extent on the other axis, used to size the guide line.
 */
function snapAxis(axis: SnapAxis, candidates: number[], targets: SnapTarget[], threshold: number, movingSpan: [number, number]): AxisSnap {
  let best: { offset: number; value: number; distance: number } | null = null
  for (const candidate of candidates) {
    for (const target of targets) {
      if (target.axis !== axis) continue
      const distance = Math.abs(target.value - candidate)
      if (distance > threshold) continue
      if (!best || distance < best.distance - 1e-6) best = { offset: target.value - candidate, value: target.value, distance }
    }
  }
  if (!best) return null
  const value = best.value
  const matches: SnapMatch[] = []
  for (const target of targets) {
    if (target.axis !== axis || Math.abs(target.value - value) > 1e-6) continue
    const from = Math.min(target.span[0], movingSpan[0])
    const to = Math.max(target.span[1], movingSpan[1])
    const existing = matches.find((match) => match.kind === target.kind)
    if (existing) {
      existing.from = Math.min(existing.from, from)
      existing.to = Math.max(existing.to, to)
    } else {
      matches.push({ axis, value, kind: target.kind, from, to })
    }
  }
  return { offset: best.offset, matches }
}

/** Snaps a moving box: returns the adjusted delta and the guide lines to draw. */
export function snapBoundsDelta(
  bounds: Bounds,
  delta: VectorPoint,
  targets: SnapTarget[],
  threshold: number,
  options: Pick<SnapOptions, 'pixel'> = { pixel: false },
): { dx: number; dy: number; matches: SnapMatch[] } {
  const moved = { x: bounds.x + delta.x, y: bounds.y + delta.y, width: bounds.width, height: bounds.height }
  const xs = [moved.x, moved.x + moved.width / 2, moved.x + moved.width]
  const ys = [moved.y, moved.y + moved.height / 2, moved.y + moved.height]
  const snapX = snapAxis('x', xs, targets, threshold, [moved.y, moved.y + moved.height])
  const snapY = snapAxis('y', ys, targets, threshold, [moved.x, moved.x + moved.width])
  let dx = delta.x + (snapX?.offset ?? 0)
  let dy = delta.y + (snapY?.offset ?? 0)
  if (options.pixel) {
    if (!snapX) dx = Math.round(bounds.x + dx) - bounds.x
    if (!snapY) dy = Math.round(bounds.y + dy) - bounds.y
  }
  const matches = [...(snapX?.matches ?? []), ...(snapY?.matches ?? [])]
  if (snapY && snapX) {
    for (const match of matches) {
      if (match.axis === 'x') { match.from = Math.min(match.from, moved.y + dy - delta.y); match.to = Math.max(match.to, moved.y + moved.height + dy - delta.y) }
      else { match.from = Math.min(match.from, moved.x + dx - delta.x); match.to = Math.max(match.to, moved.x + moved.width + dx - delta.x) }
    }
  }
  return { dx: round(dx), dy: round(dy), matches }
}

/** Snaps a free point (pen anchors, node drags, guides). */
export function snapPoint(
  point: VectorPoint,
  targets: SnapTarget[],
  threshold: number,
  options: Pick<SnapOptions, 'pixel'> = { pixel: false },
): { point: VectorPoint; matches: SnapMatch[] } {
  const snapX = snapAxis('x', [point.x], targets, threshold, [point.y, point.y])
  const snapY = snapAxis('y', [point.y], targets, threshold, [point.x, point.x])
  let x = point.x + (snapX?.offset ?? 0)
  let y = point.y + (snapY?.offset ?? 0)
  if (options.pixel) {
    if (!snapX) x = Math.round(x)
    if (!snapY) y = Math.round(y)
  }
  return { point: { x: round(x), y: round(y) }, matches: [...(snapX?.matches ?? []), ...(snapY?.matches ?? [])] }
}

/** Snaps a single edge coordinate while resizing. */
export function snapEdge(
  axis: SnapAxis,
  value: number,
  targets: SnapTarget[],
  threshold: number,
  movingSpan: [number, number],
  options: Pick<SnapOptions, 'pixel'> = { pixel: false },
): { value: number; matches: SnapMatch[] } {
  const snapped = snapAxis(axis, [value], targets, threshold, movingSpan)
  if (snapped) return { value: round(value + snapped.offset), matches: snapped.matches }
  return { value: options.pixel ? Math.round(value) : round(value), matches: [] }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
