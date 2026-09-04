import { vertexSlots } from '@/scene/mesh/data'
import type { MeshData, ShapeKey, Vec3 } from '@/scene/types'

/**
 * Shape keys: the same mesh, stored once and shown in several shapes at a time.
 *
 * A key is a list of offsets from the mesh as it is stored — Blender calls that the basis — and a
 * value that says how much of it to use. The mesh in the document never changes as a key is
 * scrubbed: what changes is the *evaluated* mesh, which is why a shape key can be animated, driven
 * by a rig controller and mixed with other keys, and why turning every key back to nought gives
 * back exactly the model that was modelled.
 *
 * The offsets are keyed by vertex *id* rather than by slot, so a key survives everything that
 * renumbers the mesh. What it cannot survive is a vertex that stops existing, and the rule for that
 * is here too: an offset with nobody to apply it to is dropped rather than quietly applied to
 * whichever vertex inherited the slot.
 */

/** Below this a key is off, and mixing it in would be arithmetic with no effect. */
const NOTHING = 1e-9

export function shapeKeysOf(object: { shapeKeys?: ShapeKey[] }): ShapeKey[] {
  return object.shapeKeys ?? []
}

/** A key's value, held inside the range it declares. */
export function keyValue(key: ShapeKey): number {
  return Math.min(key.max, Math.max(key.min, key.value))
}

/** Whether any key would move anything: what says the mesh can be handed back untouched. */
export function keysActive(keys: ShapeKey[]): boolean {
  return keys.some((key) => Math.abs(keyValue(key)) > NOTHING && Object.keys(key.offsets).length > 0)
}

/**
 * The mesh with its keys mixed in.
 *
 * The same object is handed back when nothing is on, which is what keeps the evaluation free for
 * the objects that have no keys — every mesh in most scenes.
 */
export function applyShapeKeys(mesh: MeshData, keys: ShapeKey[] | undefined): MeshData {
  const wanted = keys ?? []
  if (!keysActive(wanted)) return mesh
  const vertices = mesh.vertices.slice()
  const slots = vertexSlots(mesh)
  for (const key of wanted) {
    const amount = keyValue(key)
    if (Math.abs(amount) <= NOTHING) continue
    for (const [id, offset] of Object.entries(key.offsets)) {
      const slot = slots.get(Number(id))
      if (slot === undefined) continue
      vertices[slot * 3] = (vertices[slot * 3] ?? 0) + offset[0] * amount
      vertices[slot * 3 + 1] = (vertices[slot * 3 + 1] ?? 0) + offset[1] * amount
      vertices[slot * 3 + 2] = (vertices[slot * 3 + 2] ?? 0) + offset[2] * amount
    }
  }
  return { ...mesh, vertices }
}

/**
 * The shaped mesh, remembered.
 *
 * `applyShapeKeys` builds a new mesh, and the evaluation asks for one on every change to the
 * document — a light moved, a name typed. Without this the answer would be a different object every
 * time, and everything downstream that compares meshes by identity would decide the mesh had
 * changed and redo its work. The cache is weak on the stored mesh, so it holds nothing alive.
 */
const shaped = new WeakMap<MeshData, { signature: string; mesh: MeshData }>()

export function shapedMesh(mesh: MeshData, keys: ShapeKey[] | undefined): MeshData {
  const wanted = keys ?? []
  if (!keysActive(wanted)) return mesh
  const signature = wanted.map((key) => `${key.name}:${keyValue(key)}:${Object.keys(key.offsets).length}`).join('|')
  const kept = shaped.get(mesh)
  if (kept && kept.signature === signature) return kept.mesh
  const built = applyShapeKeys(mesh, wanted)
  shaped.set(mesh, { signature, mesh: built })
  return built
}

/** What the keys make of one vertex, for a caller that wants a place rather than a mesh. */
export function shapedPosition(mesh: MeshData, keys: ShapeKey[], slot: number): Vec3 {
  const id = mesh.vertexIds[slot]
  const base: Vec3 = [mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0]
  if (id === undefined) return base
  for (const key of keys) {
    const amount = keyValue(key)
    const offset = key.offsets[String(id)]
    if (!offset || Math.abs(amount) <= NOTHING) continue
    base[0] += offset[0] * amount
    base[1] += offset[1] * amount
    base[2] += offset[2] * amount
  }
  return base
}

/** A name no other key has, numbered the way Blender numbers a repeat. */
export function uniqueKeyName(keys: ShapeKey[], wanted: string): string {
  const taken = new Set(keys.map((key) => key.name))
  if (!taken.has(wanted)) return wanted
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${wanted}.${String(index).padStart(3, '0')}`
    if (!taken.has(candidate)) return candidate
  }
  return `${wanted}.${keys.length}`
}

/**
 * A key made from a shape: the difference between where the vertices are and where the basis has
 * them.
 *
 * Only the vertices that actually moved are written down. A key of a hundred thousand offsets of
 * nought is a key that costs a megabyte and says nothing.
 */
export function keyFromShape(mesh: MeshData, shape: MeshData, name: string, keys: ShapeKey[]): ShapeKey {
  const offsets: Record<string, Vec3> = {}
  const slots = vertexSlots(shape)
  for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
    const id = mesh.vertexIds[slot]!
    const other = slots.get(id)
    if (other === undefined) continue
    const dx = (shape.vertices[other * 3] ?? 0) - (mesh.vertices[slot * 3] ?? 0)
    const dy = (shape.vertices[other * 3 + 1] ?? 0) - (mesh.vertices[slot * 3 + 1] ?? 0)
    const dz = (shape.vertices[other * 3 + 2] ?? 0) - (mesh.vertices[slot * 3 + 2] ?? 0)
    if (Math.abs(dx) <= NOTHING && Math.abs(dy) <= NOTHING && Math.abs(dz) <= NOTHING) continue
    offsets[String(id)] = [dx, dy, dz]
  }
  return { name: uniqueKeyName(keys, name), value: 0, min: 0, max: 1, offsets }
}

/** An empty key: the basis again, ready to be sculpted or edited into something. */
export function emptyKey(name: string, keys: ShapeKey[]): ShapeKey {
  return { name: uniqueKeyName(keys, name), value: 0, min: 0, max: 1, offsets: {} }
}

/**
 * The keys after an edit that changed which vertices exist.
 *
 * An offset whose vertex has gone is dropped: it has nothing to move. A vertex that has arrived has
 * no offset, which is the right answer — a new vertex belongs to the basis until somebody shapes
 * it — and it is also the honest one, because a cut that made it has no way of knowing what it
 * should have been in a shape it was never part of.
 */
export function remapShapeKeys(keys: ShapeKey[] | undefined, mesh: MeshData): ShapeKey[] | undefined {
  if (!keys || keys.length === 0) return keys
  const alive = new Set(mesh.vertexIds)
  let changed = false
  const kept = keys.map((key) => {
    const offsets: Record<string, Vec3> = {}
    for (const [id, offset] of Object.entries(key.offsets)) {
      if (!alive.has(Number(id))) {
        changed = true
        continue
      }
      offsets[id] = offset
    }
    return changed ? { ...key, offsets } : key
  })
  return changed ? kept : keys
}

/** The mix of every key at its current value, as a key of its own: Blender's "New from mix". */
export function keyFromMix(mesh: MeshData, keys: ShapeKey[], name: string): ShapeKey {
  return keyFromShape(mesh, applyShapeKeys(mesh, keys), name, keys)
}
