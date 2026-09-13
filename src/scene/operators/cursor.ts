import { Matrix3, Vector3 } from 'three'
import { objectById } from '@/scene/model'
import { worldMatrix, worldPosition } from '@/scene/objects'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam, vectorParam, type OperatorContext } from '@/scene/operators/types'
import type { SceneDocument, SceneObject, Vec3 } from '@/scene/types'

/**
 * The 3D cursor, and the eight ways things snap to it.
 *
 * The cursor is where new objects appear, what the cursor pivot turns around, and the one point in
 * the scene a person places by hand — so it is part of the document rather than of the view, and it
 * carries a rotation as well as a position, which is what lets an object added on a sloping face
 * arrive lying on it.
 *
 * The family runs in both directions: half of it moves the cursor onto the geometry, half moves the
 * geometry onto the cursor. Moving geometry is the delicate half. An object's position is stored in
 * its parent's space, so a world-space move is turned back into a local one through the inverse of
 * the parent's matrix; and a selected object whose parent is also selected is left alone, because
 * the parent's move already carries it and moving it again would apply the offset twice. Blender
 * makes the same exclusion, for the same reason.
 */

const NOTHING_SELECTED = 'Nothing is selected to move.'

function withCursor(document: SceneDocument, position: Vec3, rotation: Vec3): SceneDocument {
  return { ...document, cursor: { position, rotation } }
}

function vec3(value: number[]): Vec3 {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]
}

/**
 * Blender calls the average of a set of origins the "median point", and its pivot menu uses the
 * same word; the arithmetic is the mean, and the name is Blender's, kept so that a person reading
 * the status bar recognises what they asked for.
 */
function median(points: Vec3[]): Vec3 {
  const total = points.reduce<Vec3>((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0])
  return [total[0] / points.length, total[1] / points.length, total[2] / points.length]
}

function snapToGrid(point: Vec3, increment: number): Vec3 {
  const step = increment > 0 ? increment : 1
  // Rounded again at a millionth: 0.3 / 0.1 is not 3 in binary floating point, and a cursor that
  // reads 0.30000000000000004 in the sidebar has not landed on the grid as far as anyone can tell.
  const snap = (value: number) => Math.round((Math.round(value / step) * step) * 1e6) / 1e6
  return [snap(point[0]), snap(point[1]), snap(point[2])]
}

/** A world-space move written in the space the object's position is actually stored in. */
function localDelta(document: SceneDocument, object: SceneObject, delta: Vec3): Vec3 {
  const parent = object.parentId ? objectById(document, object.parentId) : null
  if (!parent) return delta
  // Only the linear part of the parent's inverse: a delta is a direction, and running it through
  // the whole matrix would subtract the parent's own position from it as well.
  const linear = new Matrix3().setFromMatrix4(worldMatrix(document, parent).invert())
  const moved = new Vector3(delta[0], delta[1], delta[2]).applyMatrix3(linear)
  return [moved.x, moved.y, moved.z]
}

function selectedObjects(context: OperatorContext): SceneObject[] {
  return context.document.objects.filter((object) => context.selection.objectIds.includes(object.id))
}

/** The selected objects that no other selected object carries. */
function movingObjects(context: OperatorContext): SceneObject[] {
  const selected = new Set(context.selection.objectIds)
  return selectedObjects(context).filter((object) => {
    const seen = new Set<string>([object.id])
    let parentId = object.parentId
    while (parentId && !seen.has(parentId)) {
      if (selected.has(parentId)) return false
      seen.add(parentId)
      parentId = objectById(context.document, parentId)?.parentId
    }
    return true
  })
}

/**
 * The document with each of `moving` sent to the world position `targetFor` asks for. Every target
 * is read from the document as it was, before anything has moved, so the objects are independent of
 * each other and of the order they happen to be in.
 */
function movedDocument(document: SceneDocument, moving: SceneObject[], targetFor: (object: SceneObject, world: Vec3) => Vec3): SceneDocument {
  const deltas = new Map<string, Vec3>()
  for (const object of moving) {
    const world = worldPosition(document, object)
    const target = targetFor(object, world)
    deltas.set(object.id, localDelta(document, object, [target[0] - world[0], target[1] - world[1], target[2] - world[2]]))
  }
  const objects = document.objects.map((object) => {
    const delta = deltas.get(object.id)
    if (!delta) return object
    const [x, y, z] = object.transform.position
    const position: Vec3 = [x + delta[0], y + delta[1], z + delta[2]]
    return { ...object, transform: { ...object.transform, position } }
  })
  return { ...document, objects }
}

const GRID = numberParam('increment', 'Grid', { min: 0.001, max: 1000, step: 0.001, defaultValue: 1, unit: 'm', scale: 'log' })

/* ------------------------------------------------------- moving the cursor */

/**
 * ⇧C and the pie's "Cursor to World Origin" are the same operation under two names, one a keystroke
 * and one a slice, so they are registered from one place rather than written out twice.
 */
function originOperator(id: string, label: string, shortcut?: string): void {
  registerOperator({
    id,
    label,
    section: 'Object',
    icon: 'cursor',
    ...(shortcut ? { shortcut } : {}),
    description: 'Put the 3D cursor back at the world origin, facing the world axes.',
    params: [],
    defaults: {},
    available: () => true,
    run: (context) => ({ document: withCursor(context.document, [0, 0, 0], [0, 0, 0]), label: 'Cursor to world origin' }),
  })
}

originOperator('cursor.reset', 'Reset cursor', '⇧C')
originOperator('cursor.toWorldOrigin', 'Cursor to world origin')

registerOperator({
  id: 'cursor.toSelected',
  label: 'Cursor to selected',
  section: 'Object',
  icon: 'cursor',
  description: 'Put the 3D cursor at the middle of the selection.',
  params: [],
  defaults: {},
  available: (context) => (context.selection.objectIds.length > 0 ? true : 'Nothing is selected.'),
  run: (context) => {
    const objects = selectedObjects(context)
    if (objects.length === 0) return { error: 'Nothing is selected.' }
    const point = median(objects.map((object) => worldPosition(context.document, object)))
    return { document: withCursor(context.document, point, context.cursor.rotation), label: 'Cursor to selected' }
  },
})

registerOperator({
  id: 'cursor.toActive',
  label: 'Cursor to active',
  section: 'Object',
  icon: 'cursor',
  description: 'Put the 3D cursor on the active object.',
  params: [],
  defaults: {},
  available: (context) => (context.active ? true : 'Nothing is active.'),
  run: (context) => {
    const active = context.active
    if (!active) return { error: 'Nothing is active.' }
    return { document: withCursor(context.document, worldPosition(context.document, active), context.cursor.rotation), label: 'Cursor to active' }
  },
})

registerOperator({
  id: 'cursor.toGrid',
  label: 'Cursor to grid',
  section: 'Object',
  icon: 'cursor',
  description: 'Move the 3D cursor to the nearest grid point.',
  params: [GRID],
  defaults: { increment: 1 },
  available: () => true,
  run: (context, params) => ({
    document: withCursor(context.document, snapToGrid(context.cursor.position, params.increment), context.cursor.rotation),
    label: 'Cursor to grid',
  }),
})

registerOperator<{ position: number[]; rotation: number[] }>({
  id: 'cursor.place',
  label: 'Place cursor',
  section: 'Object',
  icon: 'cursor',
  description: 'Put the 3D cursor where it is told, with the orientation it is given.',
  params: [
    vectorParam('position', 'Position', { defaultValue: [0, 0, 0], unit: 'm' }),
    vectorParam('rotation', 'Rotation', { defaultValue: [0, 0, 0], unit: '°', view: 'rotation' }),
  ],
  // A ⇧-right-click on a surface passes the point it hit and, when the cursor is set to orient to
  // the surface, the normal there as Euler angles. Without a normal it passes none, and the zero
  // default is the world orientation — which is what Blender leaves the cursor at in that case.
  defaults: { position: [0, 0, 0], rotation: [0, 0, 0] },
  available: () => true,
  run: (context, params) => ({
    document: withCursor(context.document, vec3(params.position), vec3(params.rotation)),
    label: 'Place cursor',
  }),
})

/* ---------------------------------------------------- moving the selection */

registerOperator({
  id: 'cursor.selectionToCursor',
  label: 'Selection to cursor',
  section: 'Object',
  icon: 'cursor',
  description: 'Move the selection onto the 3D cursor.',
  params: [switchParam('keepOffset', 'Keep offset', true)],
  // Keeping the offset is Blender's own default: a group of objects that arrives on the cursor in
  // the arrangement it left is almost always what was wanted, and stacking them all on one point
  // is the deliberate exception.
  defaults: { keepOffset: true },
  available: (context) => (context.selection.objectIds.length > 0 ? true : NOTHING_SELECTED),
  run: (context, params) => {
    const moving = movingObjects(context)
    if (moving.length === 0) return { error: NOTHING_SELECTED }
    const cursor = context.cursor.position
    if (!params.keepOffset) {
      return { document: movedDocument(context.document, moving, () => cursor), label: 'Selection to cursor' }
    }
    // The median of everything selected, not only of what moves: a child carried by its parent is
    // still part of the arrangement being centred.
    const centre = median(selectedObjects(context).map((object) => worldPosition(context.document, object)))
    const offset: Vec3 = [cursor[0] - centre[0], cursor[1] - centre[1], cursor[2] - centre[2]]
    return {
      document: movedDocument(context.document, moving, (_object, world) => [world[0] + offset[0], world[1] + offset[1], world[2] + offset[2]]),
      label: 'Selection to cursor, keeping the offset',
    }
  },
})

registerOperator({
  id: 'cursor.selectionToGrid',
  label: 'Selection to grid',
  section: 'Object',
  icon: 'cursor',
  description: 'Move each selected object to the nearest grid point.',
  params: [GRID],
  defaults: { increment: 1 },
  available: (context) => (context.selection.objectIds.length > 0 ? true : NOTHING_SELECTED),
  run: (context, params) => {
    const moving = movingObjects(context)
    if (moving.length === 0) return { error: NOTHING_SELECTED }
    return {
      document: movedDocument(context.document, moving, (_object, world) => snapToGrid(world, params.increment)),
      label: 'Selection to grid',
    }
  },
})

registerOperator({
  id: 'cursor.selectionToActive',
  label: 'Selection to active',
  section: 'Object',
  icon: 'cursor',
  description: 'Stack the selection on the active object.',
  params: [],
  defaults: {},
  available: (context) => {
    if (!context.active) return 'Nothing is active to move onto.'
    return context.selection.objectIds.length > 0 ? true : NOTHING_SELECTED
  },
  run: (context) => {
    const active = context.active
    if (!active) return { error: 'Nothing is active to move onto.' }
    const target = worldPosition(context.document, active)
    const moving = movingObjects(context).filter((object) => object.id !== active.id)
    if (moving.length === 0) return { error: 'Nothing but the active object is selected.' }
    return { document: movedDocument(context.document, moving, () => target), label: 'Selection to active' }
  },
})

/* -------------------------------------------------------------- the ⇧S pie */

/**
 * The eight slices ⇧S opens, in the order Blender lays them out.
 *
 * `cursor.selectionToCursor` appears twice because Blender's pie carries it twice: the fourth slice
 * keeps the offset and the eighth does not, which in this registry is one operator run with two
 * values of `keepOffset`. A list of ids alone cannot say which, so the pie that consumes this must
 * key its slices on the index and pass `{ keepOffset: false }` to the last one.
 */
export const SNAP_PIE: string[] = [
  'cursor.toGrid',
  'cursor.selectionToGrid',
  'cursor.toSelected',
  'cursor.selectionToCursor',
  'cursor.selectionToActive',
  'cursor.toWorldOrigin',
  'cursor.toActive',
  'cursor.selectionToCursor',
]
