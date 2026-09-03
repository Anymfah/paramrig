import type { Vec3, ViewState } from '@/scene/types'

/**
 * Where the view camera is, from the four numbers that describe it.
 *
 * A viewport camera is stored as a turntable — a target, two angles and a distance — rather than
 * as a position and a rotation. That is what makes an axis view exact, a saved view reproducible,
 * and an orbit unable to drift into a roll the user never asked for. The world is Z-up, as
 * Blender's is: yaw turns around Z, pitch lifts off the XY plane.
 */

/**
 * How far the view can look up or down. Exactly ninety degrees is the pole: the up vector has no
 * answer there and the view flips, so the top view stops a hundredth of a degree short of it.
 */
export const MAX_PITCH = 89.9

export const DEG = Math.PI / 180

/** Where the camera sits, given the four numbers. Yaw 0, pitch 0 is the front view, from -Y. */
export function cameraPosition(view: Pick<ViewState, 'target' | 'yaw' | 'pitch' | 'distance'>): Vec3 {
  const direction = cameraDirection(view.yaw, view.pitch)
  return [
    view.target[0] - direction[0] * view.distance,
    view.target[1] - direction[1] * view.distance,
    view.target[2] - direction[2] * view.distance,
  ]
}

/** The unit vector the camera looks along, from its position towards the target. */
export function cameraDirection(yaw: number, pitch: number): Vec3 {
  const y = yaw * DEG
  const p = pitch * DEG
  return [-Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), -Math.sin(p)]
}

/** The camera's right and up vectors, with no roll: right stays level with the XY plane. */
export function cameraBasis(yaw: number, pitch: number): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = cameraDirection(yaw, pitch)
  const y = yaw * DEG
  const right: Vec3 = [Math.cos(y), Math.sin(y), 0]
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  // Right and forward are already at right angles and unit length, so their cross product is too.
  // Looking downwards tilts the up vector forwards, which is what right × forward gives.
  return { right, up, forward }
}

/** Pitch never reaches the pole: at exactly 90° the up vector is undefined and the view flips. */
export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch))
}

/** Yaw wrapped to (-180, 180], so a saved view never carries a thousand turns. */
export function wrapYaw(yaw: number): number {
  const wrapped = ((yaw + 180) % 360 + 360) % 360 - 180
  return wrapped === -180 ? 180 : wrapped
}

export type AxisView = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'

/** Blender's numeric pad, exactly: 1 front, 3 right, 7 top, and Ctrl for the opposite. */
export const AXIS_VIEWS: Record<AxisView, { yaw: number; pitch: number }> = {
  front: { yaw: 0, pitch: 0 },
  back: { yaw: 180, pitch: 0 },
  right: { yaw: 90, pitch: 0 },
  left: { yaw: -90, pitch: 0 },
  top: { yaw: 0, pitch: MAX_PITCH },
  bottom: { yaw: 0, pitch: -MAX_PITCH },
}

/** Whether the view is looking exactly down an axis, which is when Blender turns off perspective. */
export function isAxisView(yaw: number, pitch: number, tolerance = 0.5): AxisView | null {
  for (const [name, angles] of Object.entries(AXIS_VIEWS) as Array<[AxisView, { yaw: number; pitch: number }]>) {
    const dYaw = Math.abs(wrapYaw(yaw - angles.yaw))
    const dPitch = Math.abs(pitch - angles.pitch)
    if (Math.abs(angles.pitch) > 45) {
      // Looking straight up or down, yaw is a roll and does not decide which view this is.
      if (dPitch <= tolerance) return name
      continue
    }
    if (dYaw <= tolerance && dPitch <= tolerance) return name
  }
  return null
}

export type Box = { min: Vec3; max: Vec3 }

export function boxCentre(box: Box): Vec3 {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2]
}

export function boxRadius(box: Box): number {
  const dx = box.max[0] - box.min[0]
  const dy = box.max[1] - box.min[1]
  const dz = box.max[2] - box.min[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 2
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b
  if (!b) return a
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  }
}

/**
 * Where to put the camera so a box fills the view.
 *
 * "Fills" is 70 % of the smaller of the two field-of-view angles: a box that touched the edges
 * would have nowhere for the outline, the gizmos or the header to sit without covering it.
 */
export function frameBox(box: Box, options: { fovDegrees: number; aspect: number; fill?: number }): { target: Vec3; distance: number } {
  const fill = options.fill ?? 0.7
  const radius = Math.max(boxRadius(box), 1e-4)
  const vertical = options.fovDegrees * DEG
  // The horizontal angle is the one that runs out first on a narrow viewport.
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(options.aspect, 1e-3))
  const angle = Math.min(vertical, horizontal) / 2
  return { target: boxCentre(box), distance: Math.max(radius / Math.max(Math.tan(angle) * fill, 1e-4), 1e-3) }
}

/** The orthographic half-height that shows the same thing a perspective view at this distance does. */
export function orthoHeight(distance: number, fovDegrees: number): number {
  return Math.tan((fovDegrees * DEG) / 2) * distance
}

/** The vertical field of view a focal length gives on a 36 mm sensor, which is what Blender shows. */
export function fovFromFocalLength(focalLength: number, sensor = 36): number {
  return 2 * Math.atan(sensor / 2 / Math.max(focalLength, 1e-3)) / DEG
}

export function focalLengthFromFov(fovDegrees: number, sensor = 36): number {
  return sensor / 2 / Math.tan((fovDegrees * DEG) / 2)
}

/**
 * The distance after a wheel notch. Zoom is multiplicative — every notch changes the distance by
 * the same proportion — because a fixed step is unusable at both ends of the range: it crawls when
 * far away and jumps through the object when close.
 */
export function zoomDistance(distance: number, delta: number, options: { min?: number; max?: number; speed?: number } = {}): number {
  const speed = options.speed ?? 0.0015
  const next = distance * Math.exp(delta * speed)
  return Math.min(options.max ?? 1e6, Math.max(options.min ?? 1e-3, next))
}

/**
 * Where the target has to move so the point under the pointer stays under it while zooming.
 *
 * The pointer ray is fixed in world space; after the camera moves along it towards or away from
 * the target, the target slides along the same ray by the same proportion.
 */
export function zoomToPoint(target: Vec3, point: Vec3, before: number, after: number): Vec3 {
  const ratio = before === 0 ? 0 : 1 - after / before
  return [
    target[0] + (point[0] - target[0]) * ratio,
    target[1] + (point[1] - target[1]) * ratio,
    target[2] + (point[2] - target[2]) * ratio,
  ]
}

/**
 * Critically damped smoothing towards a value: the view catches up over about `tau` milliseconds
 * whatever the frame rate, so an orbit feels the same on a slow frame as on a fast one.
 */
export function damp(current: number, target: number, tau: number, deltaMs: number): number {
  if (tau <= 0) return target
  const factor = 1 - Math.exp(-deltaMs / tau)
  return current + (target - current) * factor
}

export function dampVec3(current: Vec3, target: Vec3, tau: number, deltaMs: number): Vec3 {
  return [
    damp(current[0], target[0], tau, deltaMs),
    damp(current[1], target[1], tau, deltaMs),
    damp(current[2], target[2], tau, deltaMs),
  ]
}

/** Damping an angle takes the short way round, or a turn past 180° unwinds the wrong way. */
export function dampAngle(current: number, target: number, tau: number, deltaMs: number): number {
  return current + wrapYaw(target - current) * (tau <= 0 ? 1 : 1 - Math.exp(-deltaMs / tau))
}
