import { addVectors, dotProduct, scaleVector, subtractVectors, type Basis } from '@/scene/transform/math'
import type { Vec3 } from '@/scene/types'

/**
 * The axis cycle a modal transform runs on, and what a constraint does to a free movement.
 *
 * Pressing X once holds the movement to the global X axis, twice to the object's own X, a third
 * time lets it go again; holding shift asks for the plane that excludes X instead, on its own cycle.
 * The state is a value, so the session can carry it and a test can drive the cycle a press at a
 * time.
 *
 * Blender starts that cycle from whichever transform orientation the header has chosen and only
 * then falls back to global. Here the cycle is literally global then local, whatever the
 * orientation, because that is the rule the editor documents to the person using it; the chosen
 * orientation still governs unconstrained movement and the axes numeric entry types into.
 */

export type AxisName = 'x' | 'y' | 'z'

/** 'axis' keeps the named axis alone; 'plane' keeps the two it is not. */
export type ConstraintKind = 'axis' | 'plane'

export type ConstraintSpace = 'global' | 'local'

export type AxisConstraint = {
  /** The axis the key named, or null when nothing is held. */
  axis: AxisName | null
  kind: ConstraintKind
  space: ConstraintSpace
}

export const NO_CONSTRAINT: AxisConstraint = { axis: null, kind: 'axis', space: 'global' }

export const AXIS_NAMES: AxisName[] = ['x', 'y', 'z']

export function isAxisKey(key: string): key is AxisName {
  return key === 'x' || key === 'y' || key === 'z'
}

/**
 * The constraint after one press of an axis key.
 *
 * The same key and the same kind advance the cycle; a different key or a different kind starts a
 * fresh one, so shift+X after X asks a new question rather than continuing the old answer.
 */
export function cycleConstraint(constraint: AxisConstraint, axis: AxisName, exclude: boolean): AxisConstraint {
  const kind: ConstraintKind = exclude ? 'plane' : 'axis'
  if (constraint.axis === axis && constraint.kind === kind) {
    return constraint.space === 'global' ? { axis, kind, space: 'local' } : NO_CONSTRAINT
  }
  return { axis, kind, space: 'global' }
}

/** The axes the movement is free along: one for an axis constraint, two for a plane, none for free. */
export function freeAxisNames(constraint: AxisConstraint): AxisName[] {
  if (!constraint.axis) return []
  if (constraint.kind === 'axis') return [constraint.axis]
  return AXIS_NAMES.filter((name) => name !== constraint.axis)
}

/** Which axes the viewport draws across the view, in their own colour role. */
export function constraintAxes(constraint: AxisConstraint): AxisName[] {
  return freeAxisNames(constraint)
}

export function axisVector(axis: AxisName, basis: Basis): Vec3 {
  return basis[axis]
}

/** The world directions the movement is free along, in the basis the constraint is expressed in. */
export function freeAxisVectors(constraint: AxisConstraint, basis: Basis): Vec3[] {
  return freeAxisNames(constraint).map((name) => axisVector(name, basis))
}

/**
 * A free movement held to the constraint: kept along one axis, flattened into a plane, or left
 * alone. The basis is assumed orthonormal, which every basis this module is handed is.
 */
export function projectDelta(delta: Vec3, constraint: AxisConstraint, basis: Basis): Vec3 {
  if (!constraint.axis) return delta
  const axis = axisVector(constraint.axis, basis)
  const along = scaleVector(axis, dotProduct(delta, axis))
  return constraint.kind === 'axis' ? along : subtractVectors(delta, along)
}

/** A movement rebuilt from an amount along each free axis. */
export function combineAmounts(amounts: number[], axes: Vec3[]): Vec3 {
  return axes.reduce<Vec3>((total, axis, index) => addVectors(total, scaleVector(axis, amounts[index] ?? 0)), [0, 0, 0])
}

/** How the header names the constraint: "global X", "local YZ", or the bare space on its own. */
export function constraintLabel(constraint: AxisConstraint, spaceLabel: string): string {
  if (!constraint.axis) return spaceLabel
  const axes = freeAxisNames(constraint).map((name) => name.toUpperCase()).join('')
  return `${spaceLabel} ${axes}`
}
