import type { MeshData, UvMap, Vec2 } from '@/scene/types'

/**
 * The corner domain: how a UV map is read, written and kept in step with the faces under it.
 *
 * A mesh's faces are lists of vertex slots, and a corner — Blender calls it a loop — is one entry
 * of one of those lists. Numbering them from the first corner of the first face gives every corner
 * an index, and a UV map is two floats per index. That is why a UV map has to be rebuilt whenever
 * the faces change: inserting a face in the middle moves every corner after it.
 *
 * Nothing here mutates: each function returns the map or the mesh that should replace the one it
 * was given, which is what lets an operator build its result and hand it over in one piece.
 */

/** The name a first map gets, as Blender does. */
export const DEFAULT_UV_NAME = 'UVMap'

/** At most this many maps: a name each, and a file that stays a file. */
export const MAX_UV_MAPS = 8

/** How many corners a mesh has: the sum of its face lengths. */
export function loopCount(mesh: Pick<MeshData, 'faces'>): number {
  let total = 0
  for (const face of mesh.faces) total += face.length
  return total
}

/**
 * Where each face's corners start, plus one past the end.
 *
 * Every read and every rebuild wants this, and computing it once per operation rather than per
 * corner is the difference between a linear pass and a quadratic one on a heavy mesh.
 */
export function loopStarts(mesh: Pick<MeshData, 'faces'>): number[] {
  const starts = new Array<number>(mesh.faces.length + 1)
  let at = 0
  for (let face = 0; face < mesh.faces.length; face += 1) {
    starts[face] = at
    at += mesh.faces[face]!.length
  }
  starts[mesh.faces.length] = at
  return starts
}

export function uvMapsOf(mesh: MeshData): UvMap[] {
  return mesh.attributes.loop?.uvMaps ?? []
}

/** Which map the viewport samples, held inside the list it indexes. */
export function activeUvIndex(mesh: MeshData): number {
  const maps = uvMapsOf(mesh)
  if (maps.length === 0) return -1
  const wanted = mesh.attributes.loop?.activeUv ?? 0
  return Math.min(maps.length - 1, Math.max(0, Math.floor(wanted)))
}

/** The active map's data, or null when the mesh has none. */
export function activeUv(mesh: MeshData): number[] | null {
  const index = activeUvIndex(mesh)
  return index < 0 ? null : uvMapsOf(mesh)[index]?.data ?? null
}

export function hasUvs(mesh: MeshData): boolean {
  return activeUv(mesh) !== null
}

/** One corner's [u, v] from a map, or [0, 0] past its end. */
export function uvAt(data: number[], loop: number): Vec2 {
  return [data[loop * 2] ?? 0, data[loop * 2 + 1] ?? 0]
}

/** The same mesh with these maps, and the active one held inside them. */
export function withUvMaps(mesh: MeshData, maps: UvMap[], active = mesh.attributes.loop?.activeUv ?? 0): MeshData {
  const kept = maps.slice(0, MAX_UV_MAPS)
  return {
    ...mesh,
    attributes: {
      ...mesh.attributes,
      loop: kept.length === 0
        ? {}
        : { uvMaps: kept, activeUv: Math.min(kept.length - 1, Math.max(0, Math.floor(active))) },
    },
  }
}

/** The same mesh with the active map replaced, or given one when it had none. */
export function withActiveUv(mesh: MeshData, data: number[], name = DEFAULT_UV_NAME): MeshData {
  const maps = uvMapsOf(mesh)
  if (maps.length === 0) return withUvMaps(mesh, [{ name, data }], 0)
  const index = activeUvIndex(mesh)
  return withUvMaps(mesh, maps.map((map, at) => (at === index ? { ...map, data } : map)), index)
}

/** A name no other map in the list has, numbered the way Blender numbers a repeat. */
export function uniqueUvName(maps: UvMap[], wanted = DEFAULT_UV_NAME): string {
  const taken = new Set(maps.map((map) => map.name))
  if (!taken.has(wanted)) return wanted
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${wanted}.${String(index).padStart(3, '0')}`
    if (!taken.has(candidate)) return candidate
  }
  return `${wanted}.${maps.length}`
}

/**
 * Every map rebuilt corner by corner, from a plan that says where each new corner's UV comes from.
 *
 * An operator that changes the faces says, for each corner of the mesh it is building, which corner
 * of the old mesh it came from — or a pair of them and a fraction, for a corner made by a cut. That
 * is the whole of UV preservation: the operators do not know what a UV is, they know where their
 * corners came from.
 */
export type LoopSource =
  /** Straight from one old corner. */
  | number
  /** Between two old corners: `at` of the way from `from` to `to`. */
  | { from: number; to: number; at: number }
  /** Nothing to inherit — a corner of a face made out of nowhere. */
  | null

export function remapUvs(mesh: MeshData, sources: LoopSource[]): UvMap[] {
  const maps = uvMapsOf(mesh)
  if (maps.length === 0) return []
  return maps.map((map) => ({ name: map.name, data: remapOne(map.data, sources) }))
}

function remapOne(data: number[], sources: LoopSource[]): number[] {
  const next = new Array<number>(sources.length * 2).fill(0)
  for (let loop = 0; loop < sources.length; loop += 1) {
    const source = sources[loop]
    if (source === null || source === undefined) continue
    if (typeof source === 'number') {
      next[loop * 2] = data[source * 2] ?? 0
      next[loop * 2 + 1] = data[source * 2 + 1] ?? 0
      continue
    }
    const at = Math.min(1, Math.max(0, source.at))
    const [ax, ay] = uvAt(data, source.from)
    const [bx, by] = uvAt(data, source.to)
    next[loop * 2] = ax + (bx - ax) * at
    next[loop * 2 + 1] = ay + (by - ay) * at
  }
  return next
}

/** The mesh's own extent, which a projection scales itself by. */
export function meshExtent(mesh: MeshData): { min: [number, number, number]; size: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.vertices[index + axis] ?? 0
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], size: [1, 1, 1] }
  return { min, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

/* ------------------------------------------------------- managing the maps */

/**
 * A new map, copied from the active one and made active — which is what Blender's + does.
 *
 * Copying rather than starting empty is the useful default by a distance: a second map is nearly
 * always a variation on the first, made to be packed differently or to hold a lightmap, and an
 * empty one would throw away the unwrap that the person is about to vary.
 */
export function addUvMap(mesh: MeshData, name = DEFAULT_UV_NAME): MeshData {
  const maps = uvMapsOf(mesh)
  if (maps.length >= MAX_UV_MAPS) return mesh
  const source = activeUv(mesh)
  const loops = loopCount(mesh)
  const data = source ? source.slice(0, loops * 2) : new Array<number>(loops * 2).fill(0)
  while (data.length < loops * 2) data.push(0)
  return withUvMaps(mesh, [...maps, { name: uniqueUvName(maps, name), data }], maps.length)
}

/** The mesh without that map. Removing the last one leaves a mesh with no UVs, as Blender's does. */
export function removeUvMap(mesh: MeshData, index: number): MeshData {
  const maps = uvMapsOf(mesh)
  if (index < 0 || index >= maps.length) return mesh
  const kept = maps.filter((_, at) => at !== index)
  const active = activeUvIndex(mesh)
  // The map after the removed one takes its place, so removing down a list keeps the finger still.
  return withUvMaps(mesh, kept, Math.min(kept.length - 1, active > index ? active - 1 : active))
}

export function renameUvMap(mesh: MeshData, index: number, name: string): MeshData {
  const maps = uvMapsOf(mesh)
  const wanted = name.trim().slice(0, 64)
  if (index < 0 || index >= maps.length || wanted.length === 0) return mesh
  if (maps[index]!.name === wanted) return mesh
  const unique = uniqueUvName(maps.filter((_, at) => at !== index), wanted)
  return withUvMaps(mesh, maps.map((map, at) => (at === index ? { ...map, name: unique } : map)), activeUvIndex(mesh))
}

export function setActiveUvMap(mesh: MeshData, index: number): MeshData {
  const maps = uvMapsOf(mesh)
  if (index < 0 || index >= maps.length) return mesh
  return withUvMaps(mesh, maps, index)
}
