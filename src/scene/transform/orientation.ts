import { Quaternion, Vector3 } from 'three'
import {
  GLOBAL_BASIS,
  crossProduct,
  normalizeVector,
  scaleVector,
  toRadians,
  transformAxes,
  transformOrder,
  type Basis,
  type ViewBasis,
} from '@/scene/transform/math'
import type { Transform, TransformOrientation, Vec3 } from '@/scene/types'

/**
 * Turning the orientation a person picks in the header into three world directions.
 *
 * Global and local are read off the active object, gimbal is read off its rotation order, and view
 * is read off the camera. Normal and cursor cannot be worked out from a transform alone — one comes
 * from the selected geometry, the other from the 3D cursor's own rotation — so the session is
 * handed those two ready-made and this module only chooses between them.
 */

export type OrientationSources = {
  /** The active target, whose own rotation is the local and gimbal frame. */
  active: Transform | null
  view: ViewBasis
  /** The frame of the selection's average normal, supplied by the caller in edit mode. */
  normal?: Basis | null
  /** The 3D cursor's frame, supplied by the caller from `document.cursor.rotation`. */
  cursor?: Basis | null
}

export function localBasis(transform: Transform): Basis {
  return transformAxes(transform)
}

/**
 * The three axes a gimbal actually turns about.
 *
 * Only the first angle of an Euler triple turns about a world axis; the second turns about an axis
 * the first has already moved, and the third about one both have moved. That is what makes gimbal
 * lock visible, and drawing anything else would be a lie about the numbers in the sidebar.
 */
export function gimbalBasis(transform: Transform): Basis {
  const order = transformOrder(transform)
  const angles: Record<string, number> = {
    X: transform.rotation[0],
    Y: transform.rotation[1],
    Z: transform.rotation[2],
  }
  const worldAxis: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }
  const basis: Basis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
  const accumulated = new Quaternion()
  for (const letter of order) {
    const axis = worldAxis[letter] ?? [0, 0, 1]
    const turned = new Vector3(...axis).applyQuaternion(accumulated)
    const slot = letter.toLowerCase() as 'x' | 'y' | 'z'
    basis[slot] = [turned.x, turned.y, turned.z]
    accumulated.multiply(new Quaternion().setFromAxisAngle(new Vector3(...axis), toRadians(angles[letter] ?? 0)))
  }
  return basis
}

/** The camera's own frame, with z towards the viewer so the three axes stay right-handed. */
export function viewOrientationBasis(view: ViewBasis): Basis {
  const right = normalizeVector(view.right)
  const up = normalizeVector(view.up)
  return { x: right, y: up, z: scaleVector(normalizeVector(view.forward), -1) }
}

/** A frame built from one direction, used to turn a normal or a cursor rotation into a basis. */
export function basisFromNormal(normal: Vec3, hint: Vec3 = [0, 0, 1]): Basis {
  const z = normalizeVector(normal)
  const guess = Math.abs(z[2]) > 0.9 ? ([0, 1, 0] as Vec3) : hint
  const x = normalizeVector(crossProduct(guess, z))
  const y = crossProduct(z, x)
  return { x, y, z }
}

/** A frame from a rotation in degrees, which is how the 3D cursor stores its own orientation. */
export function basisFromRotation(rotation: Vec3): Basis {
  return transformAxes({ position: [0, 0, 0], rotation, scale: [1, 1, 1] })
}

export function orientationBasis(orientation: TransformOrientation, sources: OrientationSources): Basis {
  switch (orientation) {
    case 'local':
      return sources.active ? localBasis(sources.active) : GLOBAL_BASIS
    case 'gimbal':
      return sources.active ? gimbalBasis(sources.active) : GLOBAL_BASIS
    case 'view':
      return viewOrientationBasis(sources.view)
    case 'normal':
      // Falling back to local matches Blender, where Normal is local until geometry defines it.
      return sources.normal ?? (sources.active ? localBasis(sources.active) : GLOBAL_BASIS)
    case 'cursor':
      return sources.cursor ?? GLOBAL_BASIS
    case 'global':
      return GLOBAL_BASIS
  }
}

export function orientationLabel(orientation: TransformOrientation): string {
  return orientation
}
