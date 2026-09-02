import { chains, chainToRun, runPathData, worldNetwork, type Run } from '@/vector/network'
import { walkRun } from '@/vector/strokeProfile'
import type { VectorElement, VectorPoint, VectorTextPath } from '@/vector/types'

/** The chain a text follows: the first one of the object it was attached to. */
export function pathRunOf(element: VectorElement): Run | null {
  if (element.kind === 'group' || element.kind === 'text' || element.kind === 'image') return null
  const world = worldNetwork(element)
  const chain = chains(world)[0]
  return chain ? chainToRun(world, chain) : null
}

export function pathDataOf(element: VectorElement): string {
  const run = pathRunOf(element)
  return run ? runPathData(run) : ''
}

export function sanitizeTextPath(value: unknown): VectorTextPath | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<VectorTextPath>
  if (typeof source.elementId !== 'string' || !source.elementId) return undefined
  const offset = typeof source.offset === 'number' && Number.isFinite(source.offset) ? Math.min(1, Math.max(0, source.offset)) : 0
  return {
    elementId: source.elementId,
    offset: Math.round(offset * 1000) / 1000,
    side: source.side === 'below' ? 'below' : 'above',
    align: source.align === 'center' || source.align === 'right' ? source.align : 'left',
    ...(typeof source.d === 'string' && source.d ? { d: source.d } : {}),
  }
}

/**
 * Keeps every attached text in step with the outline it rides on, and lets go of the ones whose
 * object is gone. The path data is copied onto the text for the same reason a linked style copies
 * its paints: the text has to draw itself in a file that no longer holds the object it came from.
 */
export function syncTextPaths(elements: VectorElement[]): VectorElement[] {
  if (!elements.some((element) => element.textPath)) return elements
  const byId = new Map(elements.map((element) => [element.id, element]))
  let changed = false
  const next = elements.map((element) => {
    if (!element.textPath) return element
    const target = byId.get(element.textPath.elementId)
    if (!target || !target.visible) {
      // The object is gone or hidden: the text keeps the shape it had, and its own box with it.
      return element
    }
    const d = pathDataOf(target)
    if (!d || d === element.textPath.d) return element
    changed = true
    const box = pathBounds(target)
    return { ...element, textPath: { ...element.textPath, d }, ...(box ?? {}) }
  })
  return changed ? next : elements
}

/** The box a text on a path occupies: the path's own, so selection and export follow it. */
export function pathBounds(target: VectorElement): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> | null {
  const run = pathRunOf(target)
  if (!run) return null
  const points = walkRun(run).map((entry) => entry.point)
  if (points.length === 0) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) }
}

/** Where a glyph sits when the text runs along a path: the point, and the angle to draw it at. */
export function placeOnPath(run: Run, distance: number): { point: VectorPoint; angle: number } | null {
  const walk = walkRun(run)
  if (walk.length < 2) return null
  const total = walkLength(walk)
  if (total <= 0) return null
  const target = Math.min(total, Math.max(0, distance))
  let travelled = 0
  for (let index = 1; index < walk.length; index += 1) {
    const from = walk[index - 1]!
    const to = walk[index]!
    const step = Math.hypot(to.point.x - from.point.x, to.point.y - from.point.y)
    if (travelled + step >= target || index === walk.length - 1) {
      const ratio = step <= 0 ? 0 : (target - travelled) / step
      const point = { x: from.point.x + (to.point.x - from.point.x) * ratio, y: from.point.y + (to.point.y - from.point.y) * ratio }
      const angle = (Math.atan2(to.point.y - from.point.y, to.point.x - from.point.x) * 180) / Math.PI
      return { point, angle }
    }
    travelled += step
  }
  return null
}

/**
 * Reads back the path data this module writes: only M, L, C and Z, absolute, which is all
 * `runPathData` ever emits. It is not a general SVG parser and does not pretend to be one.
 */
export function runFromPathData(data: string): Run | null {
  const tokens = data.match(/[MLCZ]|-?\d*\.?\d+/gi)
  if (!tokens) return null
  const points: Run['points'] = []
  let closed = false
  let index = 0
  const number = () => Number(tokens[index++])
  while (index < tokens.length) {
    const command = tokens[index++]
    if (command === 'M' || command === 'L') {
      points.push({ anchor: { x: number(), y: number() } })
    } else if (command === 'C') {
      const out = { x: number(), y: number() }
      const into = { x: number(), y: number() }
      const anchor = { x: number(), y: number() }
      const last = points[points.length - 1]
      if (last) last.out = out
      points.push({ anchor, in: into })
    } else if (command === 'Z' || command === 'z') {
      closed = true
    } else if (command && !Number.isNaN(Number(command))) {
      // A repeated command's extra pair: treat it as another line-to.
      index -= 1
      points.push({ anchor: { x: number(), y: number() } })
    }
  }
  if (points.length < 2) return null
  // A closed run repeats its first point at the end; drop it and let `closed` say so.
  if (closed && points.length > 2) {
    const first = points[0]!
    const last = points[points.length - 1]!
    if (Math.abs(first.anchor.x - last.anchor.x) < 0.01 && Math.abs(first.anchor.y - last.anchor.y) < 0.01) {
      if (last.in) first.in = last.in
      points.pop()
    }
  }
  return { points, closed }
}

export function pathLength(run: Run): number {
  return walkLength(walkRun(run))
}

function walkLength(walk: ReturnType<typeof walkRun>): number {
  let total = 0
  for (let index = 1; index < walk.length; index += 1) {
    total += Math.hypot(walk[index]!.point.x - walk[index - 1]!.point.x, walk[index]!.point.y - walk[index - 1]!.point.y)
  }
  return total
}
