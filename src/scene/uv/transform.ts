import type { UvGeometry } from '@/scene/uv/geometry'
import { uvToScreen, type UvView } from '@/scene/uv/view'
import type { TransformResult, TransformTarget } from '@/scene/transform/session'
import type { ViewBasis } from '@/scene/transform/math'
import type { SceneUnits, Vec2 } from '@/scene/types'

/**
 * G, R and S in the image, on the same session the viewport uses.
 *
 * A transform session knows how to move targets about a pivot given a camera; it has never heard of
 * a viewport, and the UV editor is simply a camera looking straight at the plane z = 0 with one
 * pixel worth one over the zoom. Everything else follows: the axis constraints become U and V, the
 * numeric entry works, shift still slows the pointer, and a rotation about the median is the same
 * arithmetic here as it is there.
 *
 * The targets are points rather than corners. Several corners can sit on one point, and they have
 * to move as one or a seam would tear open under the hand; so a point moves, and every corner on it
 * is written from where the point ended up.
 */

/** A UV has no unit, so the readout must not offer one: "0.25", not "0.25 m". */
export const UV_UNITS: SceneUnits = { system: 'none', scale: 1 }

/** The camera the session is handed: the image, seen flat on. */
export function uvViewBasis(view: UvView, pivot: Vec2): ViewBasis {
  return {
    right: [1, 0, 0],
    up: [0, 1, 0],
    // Away from the viewer, which for a plane seen flat on is into the screen.
    forward: [0, 0, -1],
    unitsPerPixel: 1 / Math.max(1e-9, view.zoom),
    pivotScreen: uvToScreen(view, pivot),
  }
}

/** One target per selected point: where it is, and its own centre, which for a point is itself. */
export function uvTargets(geometry: UvGeometry, points: Iterable<number>): TransformTarget[] {
  const targets: TransformTarget[] = []
  for (const point of points) {
    const u = geometry.points[point * 2]
    const v = geometry.points[point * 2 + 1]
    if (u === undefined || v === undefined) continue
    targets.push({
      id: String(point),
      transform: { position: [u, v, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      centre: [u, v, 0],
    })
  }
  return targets
}

/** The middle of a set of points, which is what a rotation turns about and a scale grows from. */
export function uvMedian(geometry: UvGeometry, points: Iterable<number>): Vec2 {
  let u = 0
  let v = 0
  let count = 0
  for (const point of points) {
    u += geometry.points[point * 2] ?? 0
    v += geometry.points[point * 2 + 1] ?? 0
    count += 1
  }
  return count === 0 ? [0.5, 0.5] : [u / count, v / count]
}

/**
 * The map with the session's answers written into it: every corner of every moved point.
 *
 * The array handed in is not touched; a gesture that is cancelled has nothing to undo because
 * nothing was written.
 */
export function applyUvResults(data: number[], geometry: UvGeometry, results: TransformResult[]): number[] {
  const next = data.slice()
  for (const result of results) {
    const point = Number(result.id)
    if (!Number.isInteger(point)) continue
    const start = geometry.pointStart[point]
    const count = geometry.pointCount[point]
    if (start === undefined || count === undefined) continue
    const [u, v] = result.transform.position
    for (let index = 0; index < count; index += 1) {
      const loop = geometry.pointLoops[start + index] ?? 0
      next[loop * 2] = u
      next[loop * 2 + 1] = v
    }
  }
  return next
}

/**
 * Every corner kept inside the image, for Blender's "constrain to image bounds".
 *
 * It is applied to the whole map rather than to the moved points alone, because the option means
 * "this map stays inside the image" rather than "this gesture did".
 */
export function clampToImage(data: number[]): number[] {
  return data.map((value) => Math.min(1, Math.max(0, value)))
}
