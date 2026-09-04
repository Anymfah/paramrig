import { Matrix4, Vector3 } from 'three'
import { localFromWorldPoint, worldMatrix } from '@/scene/objects'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'
import { cameraPosition } from '@/scene/viewport/view'
import type { SceneDocument, Vec3 } from '@/scene/types'

/**
 * Where a brush touches the model, and how a stroke is walked.
 *
 * Sculpting and painting differ in what they do with a dab and agree on everything before it: the
 * ray that finds the surface, the radius in pixels turned into the object's own units where the
 * brush actually is, and the walk from the last dab to the pointer at the brush's own spacing. All
 * of that is here so that the two tools cannot drift apart — a brush that felt different depending
 * on what it was painting would be a bug nobody could name.
 */

/** How far apart two dabs are, as a fraction of the radius: Blender's spacing, near enough. */
export const SPACING = 0.25

/** At most this many dabs in one frame, so a flick across the screen cannot stall it. */
export const MAX_DABS = 12

export type SurfaceContact = {
  objectId: string
  world: Vec3
  worldNormal: Vec3
  worldRadius: number
  local: Vec3
  localNormal: Vec3
  /** The radius in the object's own units, which is what the session works in. */
  radius: number
  /** The view direction in the object's own space, for "front faces only". */
  view: Vec3
}

/**
 * Where the ray meets the surface, in both spaces.
 *
 * The radius arrives in pixels, as Blender's does, and is turned into the object's own units where
 * the brush actually is — so a brush stays the same size on screen as the view moves, which is what
 * a person sizing it against the model expects.
 */
export function surfaceContact(
  instance: SceneViewport | null,
  document: SceneDocument | null,
  x: number,
  y: number,
  sizePixels: number,
): SurfaceContact | null {
  if (!instance || !document) return null
  const hit = instance.raycast(x, y)
  if (!hit) return null
  const object = document.objects.find((candidate) => candidate.id === hit.objectId)
  if (!object || object.data.kind !== 'mesh') return null
  const matrix = worldMatrix(document, object)
  const inverse = matrix.clone().invert()
  const local = localFromWorldPoint(matrix, hit.point)
  const worldRadius = instance.unitsPerPixelAt(hit.point) * sizePixels
  const localNormal = direction(hit.normal, inverse)
  const radius = worldRadius * scaleOf(matrix)
  const camera = cameraPosition(document.view)
  const toCamera: Vec3 = [camera[0] - hit.point[0], camera[1] - hit.point[1], camera[2] - hit.point[2]]
  return {
    objectId: hit.objectId,
    world: hit.point,
    worldNormal: hit.normal,
    worldRadius,
    local,
    localNormal,
    radius,
    view: direction([-toCamera[0], -toCamera[1], -toCamera[2]], inverse),
  }
}

/**
 * From the last dab to this point, at the brush's own spacing.
 *
 * The steps between are found by walking the straight line rather than by casting a ray for each,
 * which on a curved surface puts them slightly inside or outside it. At a quarter of the radius
 * apart that is a fraction of the brush's reach, and it is the difference between a stroke that
 * costs one raycast a frame and one that costs twelve.
 */
export function walkDabs(from: Vec3 | null, to: Vec3, radius: number, apply: (point: Vec3) => void): void {
  if (!from) {
    apply(to)
    return
  }
  const span = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
  const steps = Math.max(1, Math.min(MAX_DABS, Math.round(span / Math.max(1e-6, radius * SPACING))))
  for (let step = 1; step <= steps; step += 1) {
    const at = step / steps
    apply([
      from[0] + (to[0] - from[0]) * at,
      from[1] + (to[1] - from[1]) * at,
      from[2] + (to[2] - from[2]) * at,
    ])
  }
}

/** A direction taken through a matrix, normalised: the movement of a point rather than the point. */
export function direction(vector: Vec3, matrix: Matrix4): Vec3 {
  const found = new Vector3(vector[0], vector[1], vector[2]).transformDirection(matrix)
  return [found.x, found.y, found.z]
}

/**
 * How much wider a world unit is inside the object than outside it.
 *
 * A scaled object is brushed in its own space, so a brush fifty pixels wide on screen is not fifty
 * pixels wide in the mesh. The average of the three scales is used rather than any one of them: an
 * object scaled twice as wide as it is tall gets a round brush that acts slightly oval, which is
 * what sculpting a scaled object does in Blender too.
 */
export function scaleOf(matrix: Matrix4): number {
  const scale = new Vector3().setFromMatrixScale(matrix)
  const average = (scale.x + scale.y + scale.z) / 3
  return average > 1e-9 ? 1 / average : 1
}
