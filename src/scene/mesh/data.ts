import { DEFAULT_UV_NAME, MAX_UV_MAPS } from '@/scene/mesh/uv'
import type { EdgeKey, MeshAttributes, MeshData, UvMap, Vec3 } from '@/scene/types'

/**
 * The mesh as it is stored, and the small operations every other module needs to read it.
 *
 * Slots renumber whenever geometry is added or removed; ids do not. Anything a person can select,
 * or a rig can point at, is named by id — which is why an edge is named by the ids of its ends
 * rather than by a position in a list.
 */

/** An edge's name: its two vertex ids, smallest first. */
export function edgeKey(a: number, b: number): EdgeKey {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

export function parseEdgeKey(key: EdgeKey): [number, number] | null {
  const parts = key.split(':')
  if (parts.length !== 2) return null
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return null
  return [a, b]
}

export function emptyAttributes(faces: number, edges: number): MeshAttributes {
  return {
    face: { smooth: new Array<boolean>(faces).fill(false), material: new Array<number>(faces).fill(0) },
    edge: { seam: new Array<boolean>(edges).fill(false), sharp: new Array<boolean>(edges).fill(false), crease: new Array<number>(edges).fill(0), bevelWeight: new Array<number>(edges).fill(0) },
    vertex: {},
    // A mesh has no UV map until something gives it one; an empty map would be a lie about the size.
    loop: {},
  }
}

export function emptyMesh(): MeshData {
  return {
    vertices: [],
    vertexIds: [],
    nextVertexId: 0,
    edges: [],
    faces: [],
    faceIds: [],
    nextFaceId: 0,
    attributes: emptyAttributes(0, 0),
  }
}

/**
 * A mesh from bare geometry: positions and the faces that use them. Edges are derived from the
 * face loops, ids are handed out in order, and every attribute starts at its default.
 */
export function meshFromPolygons(positions: Vec3[], faces: number[][], options: { smooth?: boolean } = {}): MeshData {
  const vertices: number[] = []
  for (const point of positions) vertices.push(point[0], point[1], point[2])
  const seen = new Map<string, [number, number]>()
  const edges: Array<[number, number]> = []
  const kept: number[][] = []
  for (const loop of faces) {
    const clean = dedupeLoop(loop, positions.length)
    if (clean.length < 3) continue
    kept.push(clean)
    for (let index = 0; index < clean.length; index += 1) {
      const a = clean[index]!
      const b = clean[(index + 1) % clean.length]!
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seen.has(key)) continue
      const pair: [number, number] = a < b ? [a, b] : [b, a]
      seen.set(key, pair)
      edges.push(pair)
    }
  }
  const attributes = emptyAttributes(kept.length, edges.length)
  if (options.smooth) attributes.face.smooth = new Array<boolean>(kept.length).fill(true)
  return {
    vertices,
    vertexIds: positions.map((_, index) => index),
    nextVertexId: positions.length,
    edges,
    faces: kept,
    faceIds: kept.map((_, index) => index),
    nextFaceId: kept.length,
    attributes,
  }
}

/** A loop with its repeats and out-of-range slots removed, keeping the winding. */
function dedupeLoop(loop: number[], vertexCount: number): number[] {
  const clean: number[] = []
  for (const slot of loop) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= vertexCount) continue
    if (clean.includes(slot)) continue
    clean.push(slot)
  }
  return clean
}

/** Loose edges are the ones no face uses; a mesh may legitimately carry them. */
export function meshCounts(mesh: MeshData): { vertices: number; edges: number; faces: number; triangles: number } {
  let triangles = 0
  for (const face of mesh.faces) triangles += Math.max(0, face.length - 2)
  return { vertices: mesh.vertexIds.length, edges: mesh.edges.length, faces: mesh.faces.length, triangles }
}

export function vertexPosition(mesh: MeshData, slot: number): Vec3 {
  return [mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0]
}

export function setVertexPosition(mesh: MeshData, slot: number, point: Vec3): void {
  mesh.vertices[slot * 3] = point[0]
  mesh.vertices[slot * 3 + 1] = point[1]
  mesh.vertices[slot * 3 + 2] = point[2]
}

/** Slot for each vertex id, for turning a stored selection back into positions. */
export function vertexSlots(mesh: MeshData): Map<number, number> {
  const slots = new Map<number, number>()
  for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) slots.set(mesh.vertexIds[slot]!, slot)
  return slots
}

export function faceSlots(mesh: MeshData): Map<number, number> {
  const slots = new Map<number, number>()
  for (let slot = 0; slot < mesh.faceIds.length; slot += 1) slots.set(mesh.faceIds[slot]!, slot)
  return slots
}

export function cloneMesh(mesh: MeshData): MeshData {
  return {
    vertices: mesh.vertices.slice(),
    vertexIds: mesh.vertexIds.slice(),
    nextVertexId: mesh.nextVertexId,
    edges: mesh.edges.map((edge) => [edge[0], edge[1]] as [number, number]),
    faces: mesh.faces.map((face) => face.slice()),
    faceIds: mesh.faceIds.slice(),
    nextFaceId: mesh.nextFaceId,
    attributes: {
      face: { smooth: mesh.attributes.face.smooth.slice(), material: mesh.attributes.face.material.slice() },
      edge: {
        ...(mesh.attributes.edge.seam ? { seam: mesh.attributes.edge.seam.slice() } : {}),
        ...(mesh.attributes.edge.sharp ? { sharp: mesh.attributes.edge.sharp.slice() } : {}),
        ...(mesh.attributes.edge.crease ? { crease: mesh.attributes.edge.crease.slice() } : {}),
        ...(mesh.attributes.edge.bevelWeight ? { bevelWeight: mesh.attributes.edge.bevelWeight.slice() } : {}),
      },
      vertex: {
        ...(mesh.attributes.vertex.color ? { color: mesh.attributes.vertex.color.slice() } : {}),
      },
      loop: {
        ...(mesh.attributes.loop?.uvMaps
          ? { uvMaps: mesh.attributes.loop.uvMaps.map((map) => ({ name: map.name, data: map.data.slice() })) }
          : {}),
        ...(mesh.attributes.loop?.activeUv === undefined ? {} : { activeUv: mesh.attributes.loop.activeUv }),
        ...(mesh.attributes.loop?.pinned ? { pinned: mesh.attributes.loop.pinned.slice() } : {}),
      },
    },
    ...(mesh.autoSmooth ? { autoSmooth: { ...mesh.autoSmooth } } : {}),
  }
}

/**
 * Reads a mesh from anything, or says no.
 *
 * A stored file is not trusted: lengths that disagree, an edge that names the same vertex twice, a
 * face with fewer than three distinct corners, a repeated id — each one is a mesh the editor could
 * not draw, so each one is repaired where the repair is obvious and dropped where it is not.
 */
/**
 * The meshes this build has already read and found sound.
 *
 * Validating a mesh walks every coordinate, every edge and every corner of it, which is right for
 * something that has just come off a disk and wasteful for one the editor itself made a moment ago
 * — and the sanitiser runs on every save. A mesh is never written to in place, so an object that
 * has been validated once is still valid; the set holds them weakly, so nothing is kept alive by
 * having been checked.
 */
const validated = new WeakSet<object>()

export function validateMeshData(value: unknown): MeshData | null {
  if (!value || typeof value !== 'object') return null
  if (validated.has(value)) return value as MeshData
  const source = value as Partial<MeshData>
  const rawVertices = Array.isArray(source.vertices) ? source.vertices : null
  if (!rawVertices) return null
  const count = Math.floor(rawVertices.length / 3)
  const vertices: number[] = []
  for (let index = 0; index < count * 3; index += 1) {
    const number = Number(rawVertices[index])
    vertices.push(Number.isFinite(number) ? number : 0)
  }

  const seenIds = new Set<number>()
  const rawIds = Array.isArray(source.vertexIds) ? source.vertexIds : []
  const vertexIds: number[] = []
  let nextVertexId = Number.isInteger(source.nextVertexId) ? Number(source.nextVertexId) : 0
  for (let slot = 0; slot < count; slot += 1) {
    const candidate = rawIds[slot]
    const id = Number.isInteger(candidate) && !seenIds.has(Number(candidate)) ? Number(candidate) : nextVertexId
    while (seenIds.has(nextVertexId)) nextVertexId += 1
    const chosen = seenIds.has(id) ? nextVertexId : id
    seenIds.add(chosen)
    vertexIds.push(chosen)
    if (chosen >= nextVertexId) nextVertexId = chosen + 1
  }

  const edgeSeen = new Set<string>()
  const edges: Array<[number, number]> = []
  const edgeKeep: number[] = []
  const rawEdges = Array.isArray(source.edges) ? source.edges : []
  for (let index = 0; index < rawEdges.length; index += 1) {
    const edge = rawEdges[index]
    if (!Array.isArray(edge) || edge.length < 2) continue
    const a = Number(edge[0])
    const b = Number(edge[1])
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) continue
    if (a < 0 || b < 0 || a >= count || b >= count) continue
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    const key = `${low}|${high}`
    if (edgeSeen.has(key)) continue
    edgeSeen.add(key)
    edges.push([low, high])
    edgeKeep.push(index)
  }

  const faceSeen = new Set<number>()
  const faces: number[][] = []
  const faceKeep: number[] = []
  const rawFaces = Array.isArray(source.faces) ? source.faces : []
  for (let index = 0; index < rawFaces.length; index += 1) {
    const loop = rawFaces[index]
    if (!Array.isArray(loop)) continue
    const clean = dedupeLoop(loop.map((slot) => Number(slot)), count)
    if (clean.length < 3) continue
    faces.push(clean)
    faceKeep.push(index)
  }
  const rawFaceIds = Array.isArray(source.faceIds) ? source.faceIds : []
  let nextFaceId = Number.isInteger(source.nextFaceId) ? Number(source.nextFaceId) : 0
  const faceIds: number[] = []
  for (const index of faceKeep) {
    const candidate = rawFaceIds[index]
    let id = Number.isInteger(candidate) ? Number(candidate) : nextFaceId
    while (faceSeen.has(id)) id = nextFaceId
    while (faceSeen.has(nextFaceId)) nextFaceId += 1
    if (faceSeen.has(id)) id = nextFaceId
    faceSeen.add(id)
    faceIds.push(id)
    if (id >= nextFaceId) nextFaceId = id + 1
  }

  // Every edge named by a face has to exist, or the wireframe would have gaps the file did not ask for.
  for (const face of faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index]!
      const b = face[(index + 1) % face.length]!
      const low = Math.min(a, b)
      const high = Math.max(a, b)
      const key = `${low}|${high}`
      if (edgeSeen.has(key)) continue
      edgeSeen.add(key)
      edges.push([low, high])
      edgeKeep.push(-1)
    }
  }

  const attributes = readAttributes(source.attributes, faces.length, edges.length, faceKeep, edgeKeep, faces.reduce((total, face) => total + face.length, 0))
  const autoSmooth = source.autoSmooth && typeof source.autoSmooth === 'object'
    ? { enabled: !!source.autoSmooth.enabled, angle: clampNumber(source.autoSmooth.angle, 0, 180, 30) }
    : undefined

  return markValidated({
    vertices,
    vertexIds,
    nextVertexId: highest(vertexIds, nextVertexId),
    edges,
    faces,
    faceIds,
    nextFaceId: highest(faceIds, nextFaceId),
    attributes,
    ...(autoSmooth ? { autoSmooth } : {}),
  })
}

function readAttributes(value: unknown, faceCount: number, edgeCount: number, faceKeep: number[], edgeKeep: number[], loops: number): MeshAttributes {
  const attributes = emptyAttributes(faceCount, edgeCount)
  if (!value || typeof value !== 'object') return attributes
  const source = value as Partial<MeshAttributes>
  const face = source.face
  if (face && typeof face === 'object') {
    if (Array.isArray(face.smooth)) attributes.face.smooth = faceKeep.map((index) => !!face.smooth![index])
    if (Array.isArray(face.material)) attributes.face.material = faceKeep.map((index) => Math.max(0, Math.floor(Number(face.material![index]) || 0)))
  }
  const edge = source.edge
  if (edge && typeof edge === 'object') {
    const pick = <T>(list: unknown, read: (value: unknown) => T, fallback: T): T[] =>
      edgeKeep.map((index) => (index >= 0 && Array.isArray(list) ? read((list as unknown[])[index]) : fallback))
    if (Array.isArray(edge.seam)) attributes.edge.seam = pick(edge.seam, (item) => !!item, false)
    if (Array.isArray(edge.sharp)) attributes.edge.sharp = pick(edge.sharp, (item) => !!item, false)
    if (Array.isArray(edge.crease)) attributes.edge.crease = pick(edge.crease, (item) => clampNumber(item, 0, 1, 0), 0)
    if (Array.isArray(edge.bevelWeight)) attributes.edge.bevelWeight = pick(edge.bevelWeight, (item) => clampNumber(item, 0, 1, 0), 0)
  }
  const vertex = source.vertex
  if (vertex && typeof vertex === 'object') {
    if (Array.isArray(vertex.color)) attributes.vertex.color = vertex.color.map((item) => clampNumber(item, 0, 1, 1))
  }
  attributes.loop = readLoop(source.loop, loops)
  return attributes
}

/**
 * The corner domain of a file.
 *
 * A map whose length does not match the corners the faces actually have is not repaired, because
 * there is no way to know which corners it lost: a UV map that is the wrong length is a UV map
 * about a different mesh. It is dropped, and the mesh keeps its shape.
 *
 * A hand-written file may say `loop.uv` and mean "the one map"; that is read as a map named UVMap,
 * so that the format a person writes is the shorter one.
 */
function readLoop(value: unknown, loops: number): MeshAttributes['loop'] {
  if (!value || typeof value !== 'object') return {}
  const source = value as { uvMaps?: unknown; activeUv?: unknown; uv?: unknown; pinned?: unknown }
  const raw: unknown[] = Array.isArray(source.uvMaps)
    ? source.uvMaps
    : Array.isArray(source.uv) ? [{ name: DEFAULT_UV_NAME, data: source.uv }] : []
  const maps: UvMap[] = []
  for (const entry of raw.slice(0, MAX_UV_MAPS)) {
    if (!entry || typeof entry !== 'object') continue
    const map = entry as { name?: unknown; data?: unknown }
    if (!Array.isArray(map.data) || map.data.length !== loops * 2) continue
    const name = typeof map.name === 'string' && map.name.trim() ? map.name.trim().slice(0, 60) : DEFAULT_UV_NAME
    maps.push({ name, data: map.data.map((item) => (Number.isFinite(Number(item)) ? Number(item) : 0)) })
  }
  // Pins are read on their own terms: a mesh may be pinned before it has ever been unwrapped, and
  // a list of the wrong length is about a different mesh, so it goes the way a wrong map goes.
  const pinned = Array.isArray(source.pinned) && source.pinned.length === loops
    ? source.pinned.map((item) => item === true)
    : null
  const pins = pinned?.some(Boolean) ? { pinned } : {}
  if (maps.length === 0) return pins
  const active = Math.min(maps.length - 1, Math.max(0, Math.floor(Number(source.activeUv) || 0)))
  return { uvMaps: maps, activeUv: active, ...pins }
}

/** One past the largest id, without spreading a list a big mesh would overflow the stack with. */
function highest(ids: number[], floor: number): number {
  let top = Math.max(0, floor)
  for (const id of ids) if (id + 1 > top) top = id + 1
  return top
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/**
 * A cheap stamp of the mesh's shape. Two meshes with the same stamp draw the same, so the viewport
 * can keep its triangulation and its BVH instead of rebuilding them every frame.
 */
/** Marks a mesh as sound without re-reading it: for the ones this build has just constructed. */
export function markValidated(mesh: MeshData): MeshData {
  validated.add(mesh)
  return mesh
}

export function meshFingerprint(mesh: MeshData): string {
  let hash = 2166136261
  const mix = (value: number) => {
    hash ^= value
    hash = Math.imul(hash, 16777619)
  }
  mix(mesh.vertexIds.length)
  mix(mesh.edges.length)
  mix(mesh.faces.length)
  for (const face of mesh.faces) {
    mix(face.length)
    for (const slot of face) mix(slot)
  }
  for (let index = 0; index < mesh.vertices.length; index += 1) mix(Math.round(mesh.vertices[index]! * 1e5))
  for (let index = 0; index < mesh.attributes.face.smooth.length; index += 1) mix(mesh.attributes.face.smooth[index] ? 1 : 0)
  for (let index = 0; index < mesh.attributes.face.material.length; index += 1) mix(mesh.attributes.face.material[index]!)
  /*
   * UVs are deliberately not hashed. This fingerprint is the key of the triangulation cache, and a
   * triangulation does not depend on a texture coordinate; hashing a map of half a million numbers
   * on every frame to answer a question about the shape would be the most expensive thing in it.
   * The drawn view notices a UV change by identity instead — see `meshViewIsCurrent`.
   */
  return (hash >>> 0).toString(36)
}
