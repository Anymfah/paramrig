import { emptyAttributes, meshFromPolygons } from '@/scene/mesh/data'
import { resolveHandles } from '@/scene/curve/spline'
import type { CurveData, CurveHandleType, CurvePoint, MeshData, Vec3 } from '@/scene/types'

/**
 * The curve as something the edit tools can already handle.
 *
 * Editing a curve is editing its knots and its handles, and every tool for moving points about —
 * click and box selection, G, R and S, the pivots, snapping, proportional editing — is already
 * written, once, against a mesh. So a curve opened for editing puts on a *cage*: a mesh whose
 * vertices are the knots and the handles and whose edges are the two little arms of each knot.
 * The tools move the cage; this module reads the cage back into the curve.
 *
 * It is not a trick. Blender's own curve edit mode is the same set of gestures on the same widgets,
 * and doing it this way is what stops a curve from having a second, worse version of them.
 */

/** How many knots one spline may hold before its ids would run into the next spline's. */
const POINTS_PER_SPLINE = 65_536

export type CageSlot = 'knot' | 'left' | 'right'

const SLOTS: CageSlot[] = ['knot', 'left', 'right']

/** A cage vertex's id: which spline, which knot, and which of the three points of it. */
export function cageId(spline: number, point: number, slot: CageSlot): number {
  return (spline * POINTS_PER_SPLINE + point) * 3 + SLOTS.indexOf(slot)
}

export function readCageId(id: number): { spline: number; point: number; slot: CageSlot } | null {
  if (!Number.isInteger(id) || id < 0) return null
  const slot = SLOTS[id % 3]
  if (!slot) return null
  const rest = (id - (id % 3)) / 3
  return { spline: Math.floor(rest / POINTS_PER_SPLINE), point: rest % POINTS_PER_SPLINE, slot }
}

/**
 * The cage of a curve: every knot, and for a Bézier its two handles.
 *
 * A poly spline has no handles, so its knots stand alone and its edges join them — which is exactly
 * what a poly spline *is*. A Bézier's edges are the handle arms only: the curve between two knots
 * is not a straight line, and drawing the chord there would be drawing something that is not
 * the curve. The viewport draws the evaluated line over the top.
 */
export function curveCage(data: CurveData): MeshData {
  const positions: Vec3[] = []
  const ids: number[] = []
  const edges: Array<[number, number]> = []
  data.splines.forEach((spline, splineIndex) => {
    const knots = resolveHandles(spline)
    const first = positions.length
    knots.forEach((point, pointIndex) => {
      const base = positions.length
      positions.push(point.co)
      ids.push(cageId(splineIndex, pointIndex, 'knot'))
      if (spline.kind !== 'bezier') return
      positions.push(point.left, point.right)
      ids.push(cageId(splineIndex, pointIndex, 'left'), cageId(splineIndex, pointIndex, 'right'))
      edges.push([base, base + 1], [base, base + 2])
    })
    if (spline.kind !== 'poly') return
    for (let index = 1; index < knots.length; index += 1) edges.push([first + index - 1, first + index])
    if (spline.cyclic && knots.length > 2) edges.push([first + knots.length - 1, first])
  })
  const mesh = meshFromPolygons(positions, [])
  mesh.vertexIds = ids
  mesh.nextVertexId = ids.length > 0 ? Math.max(...ids) + 1 : 0
  mesh.edges = edges
  mesh.attributes = emptyAttributes(0, edges.length)
  return mesh
}

/* ------------------------------------------------------------ writing back */

/** Every knot the ids name, without repeats, in the order they appear in the curve. */
export function knotsOf(data: CurveData, ids: Iterable<number>): Array<{ spline: number; point: number }> {
  const seen = new Set<string>()
  const found: Array<{ spline: number; point: number }> = []
  for (const id of ids) {
    const read = readCageId(id)
    if (!read) continue
    const spline = data.splines[read.spline]
    if (!spline || !spline.points[read.point]) continue
    const key = `${read.spline}:${read.point}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ spline: read.spline, point: read.point })
  }
  found.sort((a, b) => (a.spline - b.spline) || (a.point - b.point))
  return found
}

/**
 * The curve with the cage's moved points written back into it.
 *
 * A knot carries its handles: dragging the middle of a Bézier point in Blender moves the arms with
 * it, and it would be a strange curve that did not. A handle that was dragged in the same gesture
 * is left where the gesture put it rather than moved twice.
 *
 * Dragging a handle that was automatic makes it aligned, which is Blender's rule and the only one
 * that can hold: an automatic handle is computed from its neighbours, so a dragged one would spring
 * back the moment anything else moved.
 */
export function writeCagePositions(data: CurveData, moved: ReadonlyArray<{ vertexId: number; point: Vec3 }>): CurveData {
  const byPoint = new Map<string, Partial<Record<CageSlot, Vec3>>>()
  for (const { vertexId, point } of moved) {
    const read = readCageId(vertexId)
    if (!read) continue
    const key = `${read.spline}:${read.point}`
    const entry = byPoint.get(key) ?? {}
    entry[read.slot] = point
    byPoint.set(key, entry)
  }
  if (byPoint.size === 0) return data
  return {
    ...data,
    splines: data.splines.map((spline, splineIndex) => ({
      ...spline,
      points: spline.points.map((point, pointIndex) => {
        const entry = byPoint.get(`${splineIndex}:${pointIndex}`)
        if (!entry) return point
        return movePoint(point, entry)
      }),
    })),
  }
}

function movePoint(point: CurvePoint, moved: Partial<Record<CageSlot, Vec3>>): CurvePoint {
  const co = moved.knot ?? point.co
  const drift: Vec3 = [co[0] - point.co[0], co[1] - point.co[1], co[2] - point.co[2]]
  const carried = (handle: Vec3): Vec3 => [handle[0] + drift[0], handle[1] + drift[1], handle[2] + drift[2]]
  return {
    ...point,
    co,
    left: moved.left ?? carried(point.left),
    right: moved.right ?? carried(point.right),
    leftType: moved.left ? loosened(point.leftType) : point.leftType,
    rightType: moved.right ? loosened(point.rightType) : point.rightType,
  }
}

/** What a handle's type becomes when it is dragged: a computed one stops being computed. */
function loosened(type: CurveHandleType): CurveHandleType {
  return type === 'auto' || type === 'vector' ? 'aligned' : type
}
