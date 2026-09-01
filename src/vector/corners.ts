import type { VectorElement, VectorPoint } from '@/vector/types'
import type { AbsoluteNode } from '@/vector/vectorPath'

const KAPPA = 0.5522847498

export function cornerRadii(element: Pick<VectorElement, 'cornerRadius' | 'width' | 'height'>): [number, number, number, number] {
  const raw = element.cornerRadius
  const values: [number, number, number, number] = typeof raw === 'number' ? [raw, raw, raw, raw] : raw ? [...raw] : [0, 0, 0, 0]
  const limit = Math.min(element.width, element.height) / 2
  return values.map((value) => Math.max(0, Math.min(limit, value))) as [number, number, number, number]
}

/** Rectangle outline as absolute nodes, expanding rounded corners into arcs. */
export function rectangleNodes(element: Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'cornerRadius' | 'cornerSmoothing'>): AbsoluteNode[] {
  const radii = cornerRadii({ ...element, width: element.width, height: element.height })
  const corners: AbsoluteNode[] = [
    { anchor: { x: element.x, y: element.y }, radius: radii[0] },
    { anchor: { x: element.x + element.width, y: element.y }, radius: radii[1] },
    { anchor: { x: element.x + element.width, y: element.y + element.height }, radius: radii[2] },
    { anchor: { x: element.x, y: element.y + element.height }, radius: radii[3] },
  ]
  return roundCorners(corners, true, element.cornerSmoothing ?? 0)
}

/**
 * Replaces every corner node that carries a radius with an arc. Smoothing stretches the arc's
 * tangent handles along the edges so the transition eases in, close to the iOS "continuous" corner.
 */
export function roundCorners(nodes: AbsoluteNode[], closed: boolean, smoothing = 0): AbsoluteNode[] {
  const count = nodes.length
  if (count < 3) return nodes
  const result: AbsoluteNode[] = []
  const half = (index: number, other: number) => {
    const a = nodes[index]!.anchor
    const b = nodes[other]!.anchor
    return Math.hypot(b.x - a.x, b.y - a.y) / 2
  }
  nodes.forEach((node, index) => {
    const previousIndex = index === 0 ? (closed ? count - 1 : -1) : index - 1
    const nextIndex = index === count - 1 ? (closed ? 0 : -1) : index + 1
    const radius = node.radius ?? 0
    if (radius <= 0 || node.in || node.out || previousIndex < 0 || nextIndex < 0) {
      const { radius: _radius, ...plain } = node
      result.push(plain)
      return
    }
    const previous = nodes[previousIndex]!.anchor
    const next = nodes[nextIndex]!.anchor
    const toPrevious = unit(previous, node.anchor)
    const toNext = unit(next, node.anchor)
    const angle = Math.acos(Math.max(-1, Math.min(1, toPrevious.x * toNext.x + toPrevious.y * toNext.y)))
    if (!Number.isFinite(angle) || angle < 1e-3 || Math.abs(angle - Math.PI) < 1e-3) {
      result.push({ anchor: node.anchor })
      return
    }
    const cut = Math.min(radius / Math.tan(angle / 2), half(index, previousIndex), half(index, nextIndex))
    const start: VectorPoint = { x: node.anchor.x + toPrevious.x * cut, y: node.anchor.y + toPrevious.y * cut }
    const end: VectorPoint = { x: node.anchor.x + toNext.x * cut, y: node.anchor.y + toNext.y * cut }
    const chordHandle = cut * KAPPA * (1 + smoothing * 0.6)
    const eased = smoothing * Math.min(cut, half(index, previousIndex) - cut, half(index, nextIndex) - cut) * 0.8
    const startAnchor = { x: start.x + toPrevious.x * eased, y: start.y + toPrevious.y * eased }
    const endAnchor = { x: end.x + toNext.x * eased, y: end.y + toNext.y * eased }
    result.push({
      anchor: tidy(startAnchor),
      out: tidy({ x: start.x - toPrevious.x * chordHandle, y: start.y - toPrevious.y * chordHandle }),
    })
    result.push({
      anchor: tidy(endAnchor),
      in: tidy({ x: end.x - toNext.x * chordHandle, y: end.y - toNext.y * chordHandle }),
    })
  })
  return result
}

function tidy(point: VectorPoint): VectorPoint {
  return { x: Math.round(point.x * 10000) / 10000, y: Math.round(point.y * 10000) / 10000 }
}

function unit(to: VectorPoint, from: VectorPoint): VectorPoint {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return { x: dx / length, y: dy / length }
}
