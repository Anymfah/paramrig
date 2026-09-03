import {
  AXIS_NAMES,
  NO_CONSTRAINT,
  combineAmounts,
  constraintAxes,
  constraintLabel,
  cycleConstraint,
  freeAxisNames,
  freeAxisVectors,
  isAxisKey,
  type AxisConstraint,
  type AxisName,
} from '@/scene/transform/constraints'
import {
  GLOBAL_BASIS,
  addVectors,
  angleDelta,
  applyMatrix3,
  applyMatrixAbout,
  axisScaleMatrix,
  dotProduct,
  eulerFromQuaternion,
  multiplyMatrix3,
  multiplyQuaternions,
  normalizeVector,
  quaternionFromAxisAngle,
  quaternionOf,
  rotatePointAround,
  rotationMatrix3,
  scaleRatio,
  scaleVector,
  screenAngle,
  screenAxisAmounts,
  subtractVectors,
  transformOrder,
  transposeMatrix3,
  vectorLength,
  type Basis,
  type QuaternionValue,
  type TransformUnit,
  type ViewBasis,
} from '@/scene/transform/math'
import {
  EMPTY_NUMERIC_ENTRY,
  formatAngle,
  formatFactor,
  formatLength,
  hasNumericInput,
  numericKey,
  numericValue,
  type NumericEntry,
} from '@/scene/transform/numeric'
import { localBasis, orientationBasis, orientationLabel } from '@/scene/transform/orientation'
import { pivotPoint, targetPivot } from '@/scene/transform/pivot'
import { snapIncrement, snapToIncrement } from '@/scene/transform/snap'
import type { PivotPoint, SceneUnits, Transform, TransformOrientation, Vec3 } from '@/scene/types'

/**
 * The modal transform: what G, R and S do between the key that starts them and the click that ends
 * them.
 *
 * A session is a value, not an object with a life of its own. `beginTransform` makes one,
 * `updateTransform` returns a new one for every pointer move and every key, and both the transforms
 * and the words on screen are read back out of it. Nothing here touches the DOM, three.js scene
 * graph or the document, which is what lets a test drive a whole gesture as a sequence of calls and
 * assert the numbers that come out.
 *
 * Two decisions run through all of it. The pointer is tracked twice — where it really is, and where
 * the session feels it to be — so that holding shift can slow the movement from that moment on
 * without the value leaping. And rotation is accumulated one step at a time rather than taken from a
 * difference of arc-tangents, so a sweep can pass half a turn and carry on.
 */

export type TransformMode = 'move' | 'rotate' | 'scale' | 'trackball'

export type TransformTarget = {
  id: string
  transform: Transform
  /** The target's own centre: an object's origin in object mode, an island's median in edit mode. */
  centre: Vec3
  /** World bounds, when the caller has measured them; the bounding-box pivot is exact with them. */
  bounds?: { min: Vec3; max: Vec3 }
  /** Proportional editing's share of the transform, 1 for anything fully selected. */
  weight?: number
}

export type TransformModifiers = { shift: boolean; ctrl: boolean; alt: boolean }

export type TransformInput = {
  /** Pointer in pixels, in the viewport's own coordinates. */
  cursor: [number, number]
  modifiers: TransformModifiers
  /** A key press the session consumes: 'x', 'y', 'z', a digit, '-', '.', 'Backspace', 'Tab', '/'. */
  key?: string
}

export type TransformResult = { id: string; transform: Transform }

export type TransformOutput = {
  /** The transform each target should have right now. */
  transforms: TransformResult[]
  /** "Dx: 0.5 m  Dy: 0  Dz: 0 (0.5 m) | global" — the modal header line. */
  header: string
  /** The short readout the HUD chip shows beside the cursor. */
  hud: string
  /** Which axes are drawn across the view, and in which colour role. */
  axes: AxisName[]
}

export type BeginTransformOptions = {
  mode: TransformMode
  targets: TransformTarget[]
  pivot: PivotPoint
  orientation: TransformOrientation
  view: ViewBasis
  /** Where the pointer was when the session opened. Nothing jumps, because everything starts here. */
  pointer: [number, number]
  /** The document's 3D cursor, for the cursor pivot. */
  sceneCursor?: Vec3
  /** The frame of the selection's average normal, which only the caller can work out. */
  normalBasis?: Basis | null
  /** The 3D cursor's own frame, likewise. */
  cursorBasis?: Basis | null
  /** The last-picked target, for the active pivot and for the header's numbers. */
  activeId?: string | null
  units?: SceneUnits
  /** Whether the header's snap toggle is on; holding control does the same while it is held. */
  snap?: boolean
  /**
   * A constraint the session starts with rather than waiting for a key. Dragging a gizmo's X arrow
   * is the same session as pressing G then X, and this is how the arrow says so.
   */
  constraint?: AxisConstraint
}

export type TransformSession = {
  mode: TransformMode
  /** The targets as they were when the session opened. Never written to. */
  targets: TransformTarget[]
  pivot: PivotPoint
  orientation: TransformOrientation
  view: ViewBasis
  units: SceneUnits
  sceneCursor: Vec3
  normalBasis: Basis | null
  cursorBasis: Basis | null
  activeId: string | null
  /** Where the pointer was when the session opened; every value is measured from here. */
  start: [number, number]
  /** Where the pointer really is, so each move is measured event by event. */
  pointer: [number, number]
  /** Where the session feels the pointer to be; precision slows this one and never the real one. */
  effective: [number, number]
  constraint: AxisConstraint
  numeric: NumericEntry
  modifiers: TransformModifiers
  snap: boolean
  /** Degrees swept around the pivot, unwrapped, so a sweep past 180 carries on to 200. */
  angle: number
  /** The transforms as they stand. Recomputed on every update so Euler continuity can chain. */
  results: TransformResult[]
  /** Whether anything has happened at all; a session that has not moved writes no history. */
  changed: boolean
}

/** Holding shift moves a tenth as far, from the moment it goes down. */
export const PRECISION_FACTOR = 0.1

/**
 * How fast a trackball drag turns.
 *
 * Blender scales this by the viewport's size; the session is handed a basis rather than a viewport,
 * so it turns at a fixed rate instead — half a degree of arc for every pixel, which puts a full turn
 * within one sweep of a large view.
 */
export const TRACKBALL_DEGREES_PER_PIXEL = 0.5

/** Nearer than this to the pivot the screen angle is noise, so the sweep stops accumulating. */
const MINIMUM_ANGLE_RADIUS = 2

const DEFAULT_UNITS: SceneUnits = { system: 'metric', scale: 1 }

/* --------------------------------------------------------------- session */

export function beginTransform(options: BeginTransformOptions): TransformSession {
  const targets = [...options.targets]
  return {
    mode: options.mode,
    targets,
    pivot: options.pivot,
    orientation: options.orientation,
    view: options.view,
    units: options.units ?? DEFAULT_UNITS,
    sceneCursor: options.sceneCursor ?? [0, 0, 0],
    normalBasis: options.normalBasis ?? null,
    cursorBasis: options.cursorBasis ?? null,
    activeId: options.activeId ?? targets[targets.length - 1]?.id ?? null,
    start: [options.pointer[0], options.pointer[1]],
    pointer: [options.pointer[0], options.pointer[1]],
    effective: [options.pointer[0], options.pointer[1]],
    constraint: options.constraint ?? NO_CONSTRAINT,
    numeric: EMPTY_NUMERIC_ENTRY,
    modifiers: { shift: false, ctrl: false, alt: false },
    snap: options.snap ?? false,
    angle: 0,
    results: targets.map((target) => ({ id: target.id, transform: target.transform })),
    changed: false,
  }
}

export function updateTransform(session: TransformSession, input: TransformInput): TransformSession {
  const factor = input.modifiers.shift ? PRECISION_FACTOR : 1
  const effective: [number, number] = [
    session.effective[0] + (input.cursor[0] - session.pointer[0]) * factor,
    session.effective[1] + (input.cursor[1] - session.pointer[1]) * factor,
  ]
  const angle = accumulateAngle(session, effective)
  const moved: TransformSession = {
    ...session,
    modifiers: input.modifiers,
    pointer: [input.cursor[0], input.cursor[1]],
    effective,
    angle,
  }
  const keyed = input.key ? applyKey(moved, input.key) : moved
  const changed =
    keyed.effective[0] !== keyed.start[0] ||
    keyed.effective[1] !== keyed.start[1] ||
    hasNumericInput(keyed.numeric)
  const settled: TransformSession = { ...keyed, changed }
  return { ...settled, results: computeResults(settled) }
}

/** The transforms to keep. Identical to the originals when nothing has happened. */
export function confirmTransform(session: TransformSession): TransformResult[] {
  return session.results
}

/** The transforms as they were, object for object. */
export function cancelTransform(session: TransformSession): TransformResult[] {
  return session.targets.map((target) => ({ id: target.id, transform: target.transform }))
}

/** Whether this session is worth an entry in the history. */
export function transformChanged(session: TransformSession): boolean {
  return session.changed
}

/** What the history calls the session: "Move", "Rotate 3 objects". */
export function transformLabel(session: TransformSession): string {
  const verb =
    session.mode === 'move' ? 'Move' : session.mode === 'scale' ? 'Scale' : session.mode === 'trackball' ? 'Trackball' : 'Rotate'
  return session.targets.length > 1 ? `${verb} ${session.targets.length} objects` : verb
}

export function transformOutput(session: TransformSession): TransformOutput {
  return {
    transforms: session.results,
    header: transformHeader(session),
    hud: transformHud(session),
    axes: session.mode === 'trackball' ? [] : constraintAxes(session.constraint),
  }
}

/* ------------------------------------------------------------------ keys */

function applyKey(session: TransformSession, key: string): TransformSession {
  const named = key.length === 1 ? key.toLowerCase() : key
  if (session.mode !== 'trackball' && isAxisKey(named)) {
    return { ...session, constraint: cycleConstraint(session.constraint, named, session.modifiers.shift) }
  }
  // Trackball has no axis to type a number about, so it hands digits back to the caller untouched.
  if (session.mode === 'trackball') return session
  const numeric = numericKey(session.numeric, key, numericFieldCount(session), numericUnit(session))
  return numeric ? { ...session, numeric } : session
}

function numericUnit(session: TransformSession): TransformUnit {
  if (session.mode === 'move') return 'length'
  return session.mode === 'scale' ? 'factor' : 'angle'
}

function numericFieldCount(session: TransformSession): number {
  if (session.mode === 'rotate' || session.mode === 'trackball') return 1
  const free = freeAxisNames(session.constraint)
  return free.length === 0 ? 3 : free.length
}

function accumulateAngle(session: TransformSession, effective: [number, number]): number {
  const pivot = session.view.pivotScreen
  const before = Math.hypot(session.effective[0] - pivot[0], session.effective[1] - pivot[1])
  const after = Math.hypot(effective[0] - pivot[0], effective[1] - pivot[1])
  if (before < MINIMUM_ANGLE_RADIUS || after < MINIMUM_ANGLE_RADIUS) return session.angle
  return session.angle + angleDelta(screenAngle(pivot, session.effective), screenAngle(pivot, effective))
}

/* ----------------------------------------------------------------- frames */

function activeTransform(session: TransformSession): Transform | null {
  const active = session.targets.find((target) => target.id === session.activeId)
  return (active ?? session.targets[0])?.transform ?? null
}

function orientationFrame(session: TransformSession): Basis {
  return orientationBasis(session.orientation, {
    active: activeTransform(session),
    view: session.view,
    normal: session.normalBasis,
    cursor: session.cursorBasis,
  })
}

/**
 * The frame an axis key means.
 *
 * The first press asks for the orientation the header has chosen — global unless it was changed —
 * and the second asks for the other one, which is the object's own frame unless the header was
 * already showing that, in which case it is global.
 */
function constraintFrame(session: TransformSession, target: TransformTarget): Basis {
  if (session.constraint.space === 'global') return orientationFrame(session)
  return session.orientation === 'local' ? GLOBAL_BASIS : localBasis(target.transform)
}

function constraintSpaceLabel(session: TransformSession): string {
  if (session.constraint.space === 'global') return orientationLabel(session.orientation)
  return session.orientation === 'local' ? 'global' : 'local'
}

/** The directions a movement or a scale is free along, and the axes numeric entry types into. */
function movementAxes(session: TransformSession, target: TransformTarget): Vec3[] {
  const frame = session.constraint.axis ? constraintFrame(session, target) : orientationFrame(session)
  const free = freeAxisVectors(session.constraint, frame)
  return free.length > 0 ? free : [frame.x, frame.y, frame.z]
}

function snapping(session: TransformSession): boolean {
  return session.snap || session.modifiers.ctrl
}

function travel(session: TransformSession): [number, number] {
  return [session.effective[0] - session.start[0], session.effective[1] - session.start[1]]
}

/* ------------------------------------------------------------ the values */

function moveDelta(session: TransformSession, target: TransformTarget): Vec3 {
  const axes = movementAxes(session, target)
  if (session.numeric.active) {
    return combineAmounts(
      axes.map((_, index) => numericValue(session.numeric, index, 'length') ?? 0),
      axes,
    )
  }
  const amounts = screenAxisAmounts(axes, travel(session), session.view)
  if (!snapping(session)) return combineAmounts(amounts, axes)
  const increment = snapIncrement('length', session.modifiers.shift)
  return combineAmounts(amounts.map((amount) => snapToIncrement(amount, increment)), axes)
}

function rotationAxis(session: TransformSession, target: TransformTarget): Vec3 {
  if (!session.constraint.axis || session.constraint.kind === 'plane') return normalizeVector(session.view.forward)
  return normalizeVector(constraintFrame(session, target)[session.constraint.axis])
}

function rotationAngle(session: TransformSession, axis: Vec3): number {
  if (session.numeric.active) return numericValue(session.numeric, 0, 'angle') ?? 0
  // The screen angle grows clockwise, which is a positive turn about an axis pointing away.
  const sign = dotProduct(axis, session.view.forward) >= 0 ? 1 : -1
  const swept = session.angle * sign
  return snapping(session) ? snapToIncrement(swept, snapIncrement('angle', session.modifiers.shift)) : swept
}

/** The two angles a trackball drag has swept: about the screen's up axis, then about its right. */
function trackballAngles(session: TransformSession): [number, number] {
  const pixels = travel(session)
  const raw: [number, number] = [
    pixels[0] * TRACKBALL_DEGREES_PER_PIXEL,
    pixels[1] * TRACKBALL_DEGREES_PER_PIXEL,
  ]
  if (!snapping(session)) return raw
  const increment = snapIncrement('angle', session.modifiers.shift)
  return [snapToIncrement(raw[0], increment), snapToIncrement(raw[1], increment)]
}

function trackballRotation(session: TransformSession, weight: number): QuaternionValue {
  const [aboutUp, aboutRight] = trackballAngles(session)
  return multiplyQuaternions(
    quaternionFromAxisAngle(session.view.right, aboutRight * weight),
    quaternionFromAxisAngle(session.view.up, aboutUp * weight),
  )
}

function pointerRatio(session: TransformSession): number {
  const raw = scaleRatio(session.view.pivotScreen, session.start, session.effective)
  return snapping(session) ? snapToIncrement(raw, snapIncrement('factor', session.modifiers.shift)) : raw
}

function scaleFactors(session: TransformSession, target: TransformTarget): { axes: Vec3[]; factors: number[] } {
  const axes = movementAxes(session, target)
  if (!session.numeric.active) {
    const ratio = pointerRatio(session)
    return { axes, factors: axes.map(() => ratio) }
  }
  // One number typed with nothing tabbed past it scales everything, the way S 2 does in Blender.
  const uniform = session.numeric.index === 0 && session.numeric.fields[1] === '' && session.numeric.fields[2] === ''
  const first = numericValue(session.numeric, 0, 'factor') ?? 1
  return {
    axes,
    factors: axes.map((_, index) => (uniform ? first : numericValue(session.numeric, index, 'factor') ?? 1)),
  }
}

/* ------------------------------------------------------------ the result */

function isDiagonal(rows: number[]): boolean {
  const off = [rows[1] ?? 0, rows[2] ?? 0, rows[3] ?? 0, rows[5] ?? 0, rows[6] ?? 0, rows[7] ?? 0]
  return off.every((value) => Math.abs(value) < 1e-9)
}

function scaledTransform(target: TransformTarget, pivot: Vec3, matrix: number[], previous: Vec3): Transform {
  const rotation = rotationMatrix3(target.transform)
  const inLocal = multiplyMatrix3(transposeMatrix3(rotation), multiplyMatrix3(matrix, rotation))
  if (isDiagonal(inLocal)) {
    // The stretch lines up with the object's own axes, so it lands in the scale vector untouched —
    // which is what keeps a mirror on Z reading as a negative Z and not as a rotated negative X.
    const scale: Vec3 = [
      target.transform.scale[0] * (inLocal[0] ?? 1),
      target.transform.scale[1] * (inLocal[4] ?? 1),
      target.transform.scale[2] * (inLocal[8] ?? 1),
    ]
    const offset = applyMatrix3(matrix, subtractVectors(target.transform.position, pivot))
    return { ...target.transform, position: addVectors(pivot, offset), scale }
  }
  const decomposed = applyMatrixAbout(target.transform, pivot, matrix, previous)
  return { ...target.transform, position: decomposed.position, rotation: decomposed.rotation, scale: decomposed.scale }
}

function rotatedTransform(target: TransformTarget, pivot: Vec3, rotation: QuaternionValue, previous: Vec3): Transform {
  const composed = multiplyQuaternions(rotation, quaternionOf(target.transform))
  const next: Transform = {
    ...target.transform,
    position: rotatePointAround(target.transform.position, pivot, rotation),
    rotation: eulerFromQuaternion(composed, transformOrder(target.transform), previous),
  }
  if (target.transform.rotationMode === 'quaternion') next.quaternion = composed
  return next
}

function computeResults(session: TransformSession): TransformResult[] {
  if (!session.changed) return session.targets.map((target) => ({ id: target.id, transform: target.transform }))
  const shared = pivotPoint(session.pivot, session.targets, { cursor: session.sceneCursor, activeId: session.activeId })
  return session.targets.map((target, index) => {
    const weight = target.weight ?? 1
    const pivot = targetPivot(session.pivot, target, shared)
    const previous = session.results[index]?.transform.rotation ?? target.transform.rotation
    return { id: target.id, transform: resultTransform(session, target, pivot, weight, previous) }
  })
}

function resultTransform(
  session: TransformSession,
  target: TransformTarget,
  pivot: Vec3,
  weight: number,
  previous: Vec3,
): Transform {
  switch (session.mode) {
    case 'move': {
      const delta = scaleVector(moveDelta(session, target), weight)
      return { ...target.transform, position: addVectors(target.transform.position, delta) }
    }
    case 'rotate': {
      const axis = rotationAxis(session, target)
      const degrees = rotationAngle(session, axis) * weight
      return rotatedTransform(target, pivot, quaternionFromAxisAngle(axis, degrees), previous)
    }
    case 'trackball':
      return rotatedTransform(target, pivot, trackballRotation(session, weight), previous)
    case 'scale': {
      const { axes, factors } = scaleFactors(session, target)
      const shared = factors.map((factor) => 1 + (factor - 1) * weight)
      return scaledTransform(target, pivot, axisScaleMatrix(axes, shared), previous)
    }
  }
}

/* --------------------------------------------------------------- wording */

function headerTarget(session: TransformSession): TransformTarget | null {
  return session.targets.find((target) => target.id === session.activeId) ?? session.targets[0] ?? null
}

function headerResult(session: TransformSession): Transform | null {
  const target = headerTarget(session)
  if (!target) return null
  return session.results.find((result) => result.id === target.id)?.transform ?? target.transform
}

/** The axis letters the numeric fields stand for, which the constraint may have cut down to one. */
function numericAxisNames(session: TransformSession): AxisName[] {
  if (session.mode === 'rotate') return []
  const free = freeAxisNames(session.constraint)
  return free.length === 0 ? AXIS_NAMES : free
}

function numericFieldText(session: TransformSession, index: number): string {
  const text = session.numeric.fields[index] ?? ''
  const shown = text === '' ? '0' : text
  return index === session.numeric.index ? `[${shown}]` : shown
}

function moveHeader(session: TransformSession): string {
  const suffix = constraintLabel(session.constraint, constraintSpaceLabel(session))
  if (session.numeric.active) {
    const fields = numericAxisNames(session).map(
      (name, index) => `D${name}: ${numericFieldText(session, index)}`,
    )
    return `${fields.join('  ')} | ${suffix}`
  }
  const target = headerTarget(session)
  const delta = target ? moveDelta(session, target) : ([0, 0, 0] as Vec3)
  const fields = AXIS_NAMES.map((name, index) => `D${name}: ${formatLength(delta[index] ?? 0, session.units)}`)
  return `${fields.join('  ')} (${formatLength(vectorLength(delta), session.units)}) | ${suffix}`
}

function rotateHeader(session: TransformSession): string {
  const suffix = constraintLabel(session.constraint, constraintSpaceLabel(session))
  if (session.numeric.active) return `Rot: ${numericFieldText(session, 0)}° | ${suffix}`
  const target = headerTarget(session)
  const axis = target ? rotationAxis(session, target) : ([0, 0, 1] as Vec3)
  return `Rot: ${formatAngle(rotationAngle(session, axis))} | ${suffix}`
}

function trackballHeader(session: TransformSession): string {
  const [aboutUp, aboutRight] = trackballAngles(session)
  return `Trackball: ${formatAngle(aboutUp)}  ${formatAngle(aboutRight)} | ${orientationLabel(session.orientation)}`
}

function scaleHeader(session: TransformSession): string {
  const suffix = constraintLabel(session.constraint, constraintSpaceLabel(session))
  if (session.numeric.active) {
    const fields = numericAxisNames(session).map(
      (name, index) => `S${name}: ${numericFieldText(session, index)}`,
    )
    return `${fields.join('  ')} | ${suffix}`
  }
  const target = headerTarget(session)
  const result = headerResult(session)
  const fields = AXIS_NAMES.map((name, index) => {
    const before = target?.transform.scale[index] ?? 1
    const after = result?.scale[index] ?? 1
    return `S${name}: ${formatFactor(before === 0 ? 1 : after / before)}`
  })
  return `${fields.join('  ')} (${formatFactor(pointerRatio(session))}) | ${suffix}`
}

function transformHeader(session: TransformSession): string {
  switch (session.mode) {
    case 'move':
      return moveHeader(session)
    case 'rotate':
      return rotateHeader(session)
    case 'trackball':
      return trackballHeader(session)
    case 'scale':
      return scaleHeader(session)
  }
}

function hudPrefix(session: TransformSession): string {
  const axes = constraintAxes(session.constraint)
  if (axes.length === 0 || axes.length === 3) return ''
  return `${axes.map((name) => name.toUpperCase()).join('')} `
}

function transformHud(session: TransformSession): string {
  const target = headerTarget(session)
  switch (session.mode) {
    case 'move': {
      const delta = target ? moveDelta(session, target) : ([0, 0, 0] as Vec3)
      return `${hudPrefix(session)}${formatLength(vectorLength(delta), session.units)}`
    }
    case 'rotate': {
      const axis = target ? rotationAxis(session, target) : ([0, 0, 1] as Vec3)
      return `${hudPrefix(session)}${formatAngle(rotationAngle(session, axis))}`
    }
    case 'trackball': {
      const [aboutUp, aboutRight] = trackballAngles(session)
      return `${formatAngle(aboutUp)}  ${formatAngle(aboutRight)}`
    }
    case 'scale': {
      const { factors } = target ? scaleFactors(session, target) : { factors: [1] }
      return `${hudPrefix(session)}${formatFactor(factors[0] ?? 1)}`
    }
  }
}

export type { AxisConstraint, AxisName } from '@/scene/transform/constraints'
export type { Basis, ViewBasis } from '@/scene/transform/math'
export type { NumericEntry } from '@/scene/transform/numeric'
