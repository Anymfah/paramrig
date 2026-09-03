import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { meshOf } from '@/scene/document'
import type { SceneDocument, SceneObject, Transform, Vec3 } from '@/scene/types'

/**
 * Where an object actually is.
 *
 * The document stores a transform per object and a parent id; everything that has to know where
 * something *is* — the viewport, framing, the gizmos, snapping, export — needs the same answer to
 * the same question, so the answer is computed here and nowhere else.
 */

export type Box = { min: Vec3; max: Vec3 }

const scratchEuler = new Euler()

/**
 * Blender's Euler order in three's spelling, which is the same letters backwards.
 *
 * Blender turns about the *world's* axes in the order it names — XYZ means X first, then Y, then Z,
 * so the matrix is Rz·Ry·Rx — while three's `Euler` names its rotations in the order they are
 * applied to the object itself, so its 'XYZ' is Rx·Ry·Rz. The two spellings are reverses of each
 * other. Handing Blender's straight to three left every compound rotation subtly wrong, and the
 * startup camera — whose numbers are Blender's own — pointed somewhere other than at the cube.
 */
function threeOrder(order: string): 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX' {
  const reversed = [...order].reverse().join('')
  const known = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'] as const
  return known.find((entry) => entry === reversed) ?? 'ZYX'
}
const scratchQuaternion = new Quaternion()

/** One object's own transform, in the Euler order the object says it uses. */
export function localMatrix(object: Pick<SceneObject, 'transform' | 'origin'>): Matrix4 {
  const transform: Transform = object.transform
  const [x, y, z] = transform.position
  const [sx, sy, sz] = transform.scale
  if (transform.rotationMode === 'quaternion' && transform.quaternion) {
    const [qx, qy, qz, qw] = transform.quaternion
    scratchQuaternion.set(qx, qy, qz, qw)
  } else {
    const order = transform.rotationMode && transform.rotationMode !== 'quaternion' ? transform.rotationMode : 'XYZ'
    scratchEuler.set(
      (transform.rotation[0] * Math.PI) / 180,
      (transform.rotation[1] * Math.PI) / 180,
      (transform.rotation[2] * Math.PI) / 180,
      threeOrder(order),
    )
    scratchQuaternion.setFromEuler(scratchEuler)
  }
  // A zero scale would make the matrix singular and every child would collapse onto the origin.
  const matrix = new Matrix4().compose(
    new Vector3(x, y, z),
    scratchQuaternion,
    new Vector3(sx || 1e-6, sy || 1e-6, sz || 1e-6),
  )
  // An origin offset moves the data inside the object, not the object itself.
  if (object.origin) matrix.multiply(new Matrix4().makeTranslation(-object.origin[0], -object.origin[1], -object.origin[2]))
  return matrix
}

/** The object's place in the world, with every parent above it applied. */
export function worldMatrix(document: SceneDocument, object: SceneObject): Matrix4 {
  const matrix = localMatrix(object)
  const seen = new Set<string>([object.id])
  let parentId = object.parentId
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = document.objects.find((entry) => entry.id === parentId)
    if (!parent) break
    matrix.premultiply(localMatrix(parent))
    parentId = parent.parentId
  }
  return matrix
}

/** A point of an object's own data, in the world. */
export function worldPointOf(matrix: Matrix4, point: Vec3): Vec3 {
  const vector = new Vector3(point[0], point[1], point[2]).applyMatrix4(matrix)
  return [vector.x, vector.y, vector.z]
}

/** The same point coming back: what a vertex dragged in the world is, inside its own mesh. */
export function localFromWorldPoint(matrix: Matrix4, point: Vec3): Vec3 {
  const inverse = new Matrix4().copy(matrix).invert()
  const vector = new Vector3(point[0], point[1], point[2]).applyMatrix4(inverse)
  return [vector.x, vector.y, vector.z]
}

export function worldPosition(document: SceneDocument, object: SceneObject): Vec3 {
  const position = new Vector3().setFromMatrixPosition(worldMatrix(document, object))
  return [position.x, position.y, position.z]
}

/**
 * The box an object occupies in the world. An object with no geometry — a light, a camera, an
 * empty — is a point, which is what framing a light should do: put it in the middle, not fill the
 * screen with a glyph.
 */
export function objectBounds(document: SceneDocument, object: SceneObject): Box | null {
  const matrix = worldMatrix(document, object)
  const mesh = meshOf(document, object)
  if (!mesh || mesh.vertexIds.length === 0) {
    const point = new Vector3().setFromMatrixPosition(matrix)
    return { min: [point.x, point.y, point.z], max: [point.x, point.y, point.z] }
  }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const point = new Vector3()
  for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
    point.set(mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0)
    point.applyMatrix4(matrix)
    const values: Vec3 = [point.x, point.y, point.z]
    for (let axis = 0; axis < 3; axis += 1) {
      if (values[axis]! < min[axis]!) min[axis] = values[axis]!
      if (values[axis]! > max[axis]!) max[axis] = values[axis]!
    }
  }
  return { min, max }
}

export function unionBounds(a: Box | null, b: Box | null): Box | null {
  if (!a) return b
  if (!b) return a
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  }
}

/** The box around the whole scene, or around the objects named — what Home and `.` frame. */
export function sceneBounds(document: SceneDocument, objectIds?: string[]): Box | null {
  let box: Box | null = null
  for (const object of document.objects) {
    if (objectIds && !objectIds.includes(object.id)) continue
    if (!object.visible) continue
    box = unionBounds(box, objectBounds(document, object))
  }
  return box
}

/** A box that is a single point has no size to frame; give it one so the camera stops somewhere. */
export function paddedBounds(box: Box, minimum = 0.5): Box {
  const pad: Vec3 = [0, 1, 2].map((axis) => {
    const size = box.max[axis]! - box.min[axis]!
    return size < minimum ? (minimum - size) / 2 : 0
  }) as Vec3
  return {
    min: [box.min[0] - pad[0], box.min[1] - pad[1], box.min[2] - pad[2]],
    max: [box.max[0] + pad[0], box.max[1] + pad[1], box.max[2] + pad[2]],
  }
}

/** A matrix read back as the transform a document stores, in the Euler order it asks for. */
export function decomposeMatrix(matrix: Matrix4, order: Transform['rotationMode'] = 'XYZ'): Transform {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  // Read back in the same spelling it was composed in, or parenting would not be reversible.
  const euler = new Euler().setFromQuaternion(quaternion, threeOrder(order === 'quaternion' ? 'XYZ' : order))
  return {
    position: [position.x, position.y, position.z],
    rotation: [(euler.x * 180) / Math.PI, (euler.y * 180) / Math.PI, (euler.z * 180) / Math.PI],
    scale: [scale.x, scale.y, scale.z],
    rotationMode: order,
  }
}

/** An object's transform in world space, which is what a transform session works in. */
export function worldTransform(document: SceneDocument, object: SceneObject): Transform {
  const order = object.transform.rotationMode === 'quaternion' ? 'XYZ' : object.transform.rotationMode ?? 'XYZ'
  return decomposeMatrix(worldMatrix(document, object), order)
}

/**
 * The other direction: a world transform written back as the object's own, with whatever its
 * parents do taken out again. A child moved in world space must end up where the pointer left it,
 * not where its parent's rotation would have taken it.
 */
export function localFromWorld(document: SceneDocument, object: SceneObject, world: Transform): Transform {
  const order = object.transform.rotationMode === 'quaternion' ? 'XYZ' : object.transform.rotationMode ?? 'XYZ'
  const matrix = localMatrix({ transform: world })
  if (!object.parentId) {
    // The origin offset is part of the object's own matrix, so it has to come back out.
    if (object.origin) matrix.multiply(new Matrix4().makeTranslation(object.origin[0], object.origin[1], object.origin[2]))
    return decomposeMatrix(matrix, order)
  }
  const parent = document.objects.find((entry) => entry.id === object.parentId)
  if (!parent) return decomposeMatrix(matrix, order)
  matrix.premultiply(worldMatrix(document, parent).invert())
  if (object.origin) matrix.multiply(new Matrix4().makeTranslation(object.origin[0], object.origin[1], object.origin[2]))
  return decomposeMatrix(matrix, order)
}
