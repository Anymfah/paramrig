import type { PivotPoint, Vec3 } from '@/scene/types'

/**
 * Where a rotation or a scale turns about.
 *
 * The five pivots differ only in which point they name, so they are worth one small module: the
 * session asks for the shared point once and then asks, per target, whether that target uses its
 * own instead.
 */

export type PivotTarget = {
  id: string
  /** The target's own centre: an object's origin in object mode, an island's median in edit mode. */
  centre: Vec3
  /** World-space bounds, when the caller has them; the bounding-box pivot is exact with them. */
  bounds?: { min: Vec3; max: Vec3 }
}

export type PivotSources = {
  /** The 3D cursor, for the cursor pivot. */
  cursor: Vec3
  /** The last-picked target, for the active pivot. */
  activeId?: string | null
}

export function isIndividualPivot(pivot: PivotPoint): boolean {
  return pivot === 'individual'
}

export function medianPoint(targets: PivotTarget[]): Vec3 {
  if (targets.length === 0) return [0, 0, 0]
  const total = targets.reduce<Vec3>(
    (sum, target) => [sum[0] + target.centre[0], sum[1] + target.centre[1], sum[2] + target.centre[2]],
    [0, 0, 0],
  )
  return [total[0] / targets.length, total[1] / targets.length, total[2] / targets.length]
}

/**
 * The centre of the box that holds everything selected.
 *
 * A target that carries its own bounds contributes them; one that does not contributes its centre,
 * which is the honest answer when the caller has not measured the geometry.
 */
export function boundingBoxCentre(targets: PivotTarget[]): Vec3 {
  if (targets.length === 0) return [0, 0, 0]
  const low: Vec3 = [Infinity, Infinity, Infinity]
  const high: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const target of targets) {
    const min = target.bounds?.min ?? target.centre
    const max = target.bounds?.max ?? target.centre
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis] ?? Infinity, min[axis] ?? 0)
      high[axis] = Math.max(high[axis] ?? -Infinity, max[axis] ?? 0)
    }
  }
  return [((low[0] ?? 0) + (high[0] ?? 0)) / 2, ((low[1] ?? 0) + (high[1] ?? 0)) / 2, ((low[2] ?? 0) + (high[2] ?? 0)) / 2]
}

/** The one point every target turns about, before the individual pivot overrides it per target. */
export function pivotPoint(pivot: PivotPoint, targets: PivotTarget[], sources: PivotSources): Vec3 {
  switch (pivot) {
    case 'cursor':
      return sources.cursor
    case 'bounding-box':
      return boundingBoxCentre(targets)
    case 'active': {
      const active = targets.find((target) => target.id === sources.activeId)
      return active ? active.centre : medianPoint(targets)
    }
    case 'individual':
    case 'median':
      return medianPoint(targets)
  }
}

/** The point one target turns about: its own with individual origins, the shared one otherwise. */
export function targetPivot(pivot: PivotPoint, target: PivotTarget, shared: Vec3): Vec3 {
  return isIndividualPivot(pivot) ? target.centre : shared
}
