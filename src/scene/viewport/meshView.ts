import { BufferAttribute, BufferGeometry, Mesh, type Material } from 'three'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, type MeshBVH } from 'three-mesh-bvh'
import { activeUv, loopStarts } from '@/scene/mesh/uv'
import { meshFingerprint } from '@/scene/mesh/data'
import { faceNormals, vertexNormals } from '@/scene/mesh/normals'
import { cachedTriangulation, type Triangulation } from '@/scene/mesh/triangulate'
import type { MeshData } from '@/scene/types'

/**
 * Turning a stored polygon mesh into something three.js can draw.
 *
 * The geometry is not indexed. That costs memory, and buys three things worth more than it: a flat
 * face and a smooth face can sit side by side in one object, every triangle can carry the id of
 * the polygon it came from — which is what picking a face means — and a position update during a
 * drag is a straight write into one array with no index indirection to chase.
 */

// The accelerated raycast is opt-in per prototype; installing it here means every geometry this
// module builds can be hit-tested by a ray without the caller knowing about the BVH at all.
let installed = false
function installBVH(): void {
  if (installed) return
  installed = true
  BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
  BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
  Mesh.prototype.raycast = acceleratedRaycast
}

export type MeshGeometry = BufferGeometry & { boundsTree?: MeshBVH }

export type MeshView = {
  geometry: MeshGeometry
  /** Which face slot each triangle came from, for picking and for face selection. */
  triangleFace: Int32Array
  triangleCount: number
  /** The order the triangles were written in: by material slot, so each slot is one run. */
  order: Uint32Array
  /** One per material slot in use, in the form three.js draws them. */
  groups: Array<{ material: number; start: number; count: number }>
  fingerprint: string
  /** The mesh this view was built from, compared by identity before anything is measured. */
  source: MeshData | null
  /**
   * The UV array the buffer was filled from, compared by identity for the same reason.
   *
   * A map is replaced rather than written into — every operator builds a new array and hands it
   * over — so a different array is a different map, and the same array is the same map. Hashing
   * half a million numbers per frame to learn that would cost more than drawing the mesh.
   */
  uvSource: number[] | null
  dispose: () => void
}

/** The whole geometry, rebuilt. Called when the topology changes, not when a vertex moves. */
export function buildMeshView(mesh: MeshData): MeshView {
  installBVH()
  const triangulation = cachedTriangulation(mesh)
  const geometry = new BufferGeometry() as MeshGeometry
  const count = triangulation.triangleCount * 3
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const elements = new Float32Array(count)
  const uvs = new Float32Array(count * 2)
  /*
   * The triangles are written in order of the material slot their face names, so each slot's
   * triangles are one unbroken run and can be drawn with one material. Three.js has no other way of
   * giving two parts of a mesh two appearances, and a mesh with one material — which is most of
   * them — is left exactly as it was, in face order, with a single group over the whole of it.
   */
  const { order, groups } = groupByMaterial(mesh, triangulation)
  writeAttributes(mesh, triangulation, positions, normals, elements, uvs, order)
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  // Read by the picking material to write a face id, and by the overlay to tint a selected face.
  geometry.setAttribute('element', new BufferAttribute(elements, 1))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  for (const group of groups) geometry.addGroup(group.start * 3, group.count * 3, group.material)
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  if (triangulation.triangleCount > 0) geometry.computeBoundsTree?.()
  return {
    geometry,
    triangleFace: triangulation.triangleFace,
    triangleCount: triangulation.triangleCount,
    order,
    groups,
    fingerprint: meshFingerprint(mesh),
    source: mesh,
    uvSource: activeUv(mesh),
    dispose: () => {
      geometry.disposeBoundsTree?.()
      geometry.dispose()
    },
  }
}

/**
 * Positions only, written in place.
 *
 * During a drag the topology does not change, so nothing needs rebuilding: the same triangles get
 * new corners. The bounding volumes and the BVH are deliberately left stale until the gesture ends
 * — refitting them every frame is what makes a drag on a heavy mesh stutter, and a slightly wrong
 * bounding sphere for a few frames costs nothing but a culling test.
 */
export function updateMeshPositions(view: MeshView, mesh: MeshData): void {
  const triangulation = cachedTriangulation(mesh)
  if (triangulation.triangleCount !== view.triangleCount) return
  const position = view.geometry.getAttribute('position') as BufferAttribute
  const normal = view.geometry.getAttribute('normal') as BufferAttribute
  const element = view.geometry.getAttribute('element') as BufferAttribute
  const uv = view.geometry.getAttribute('uv') as BufferAttribute
  // The same order the view was built in: a drag moves corners, it does not reassign materials.
  writeAttributes(
    mesh,
    triangulation,
    position.array as Float32Array,
    normal.array as Float32Array,
    element.array as Float32Array,
    uv.array as Float32Array,
    view.order,
  )
  position.needsUpdate = true
  normal.needsUpdate = true
  // A vertex that moves changes the projection a mesh without a map of its own is drawn with.
  uv.needsUpdate = true
  /*
   * And the view now holds this map. Without this line the answer to "is this the map I drew" is
   * no for ever after the first update, and every later change to the document — a light moved, a
   * name typed — would rewrite every attribute of every mesh and rebuild its bounding tree.
   */
  view.uvSource = activeUv(mesh)
}

/** After a gesture: the bounds and the tree catch up with where the vertices actually are. */
export function refreshMeshBounds(view: MeshView): void {
  view.geometry.computeBoundingSphere()
  view.geometry.computeBoundingBox()
  view.geometry.disposeBoundsTree?.()
  if (view.triangleCount > 0) view.geometry.computeBoundsTree?.()
}

export function meshViewIsCurrent(view: MeshView, mesh: MeshData): boolean {
  /*
   * The same object is the same mesh. A fingerprint walks every face and every coordinate, which on
   * a hundred thousand vertices is milliseconds — and this is asked on every change to the
   * document, most of which are about something else entirely. A mesh is never written to in
   * place, so identity settles it without reading a single number.
   */
  if (view.uvSource !== activeUv(mesh)) return false
  if (view.source === mesh) return true
  return view.fingerprint === meshFingerprint(mesh)
}

function writeAttributes(
  mesh: MeshData,
  triangulation: Triangulation,
  positions: Float32Array,
  normals: Float32Array,
  elements: Float32Array,
  uvs: Float32Array,
  order: Uint32Array,
): void {
  const perFace = faceNormals(mesh)
  const perVertex = vertexNormals(mesh)
  const smooth = mesh.attributes.face.smooth
  /*
   * The UVs a texture is sampled with.
   *
   * A mesh with a map of its own is drawn with it. A mesh without one is drawn with a cube
   * projection rather than with nothing: an absent attribute reads as (0, 0) in the shader, which
   * makes every textured surface one flat texel of the image, and a projection at least shows what
   * the image is. Unwrapping replaces it with something a person chose.
   *
   * The fallback is computed here rather than by `cubeProjection` so that it can borrow the face
   * normals and the extent this loop already has: on a mesh of a hundred thousand vertices,
   * walking every face a second time to work them out again is a tenth of a second.
   */
  const uv = activeUv(mesh)
  const fallback = uv ? null : fallbackProjection(mesh, perFace)
  const starts = loopStarts(mesh)
  const { indices, triangleFace, triangleCorner, triangleCount } = triangulation
  for (let position = 0; position < triangleCount; position += 1) {
    const triangle = order[position]!
    const face = triangleFace[triangle]!
    const isSmooth = smooth[face] === true
    for (let corner = 0; corner < 3; corner += 1) {
      const slot = indices[triangle * 3 + corner]!
      const target = (position * 3 + corner) * 3
      positions[target] = mesh.vertices[slot * 3] ?? 0
      positions[target + 1] = mesh.vertices[slot * 3 + 1] ?? 0
      positions[target + 2] = mesh.vertices[slot * 3 + 2] ?? 0
      const source = isSmooth ? perVertex : perFace
      const from = (isSmooth ? slot : face) * 3
      normals[target] = source[from] ?? 0
      normals[target + 1] = source[from + 1] ?? 0
      normals[target + 2] = source[from + 2] ?? 1
      elements[position * 3 + corner] = face
      const loop = starts[face]! + triangleCorner[triangle * 3 + corner]!
      const map = uv ?? fallback!
      uvs[(position * 3 + corner) * 2] = map[loop * 2] ?? 0
      uvs[(position * 3 + corner) * 2 + 1] = map[loop * 2 + 1] ?? 0
    }
  }
}

/**
 * The cube projection a mesh with no UV map of its own is drawn with.
 *
 * The same arithmetic as `cubeProjection` in `@/scene/uv/project`, given the face normals the
 * caller has already computed: this runs on every rebuild of a heavy mesh, and the projection
 * module's own Newell pass is the one thing in it worth not doing twice.
 */
function fallbackProjection(mesh: MeshData, perFace: Float32Array): number[] {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    const x = mesh.vertices[index]!
    const y = mesh.vertices[index + 1]!
    const z = mesh.vertices[index + 2]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  if (!Number.isFinite(minX)) return []
  const centre = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
  const span = Math.max(1e-6, Math.max(maxX - minX, maxY - minY, maxZ - minZ))
  let total = 0
  for (const face of mesh.faces) total += face.length
  const data = new Array<number>(total * 2).fill(0)
  let loop = 0
  for (let face = 0; face < mesh.faces.length; face += 1) {
    const nx = perFace[face * 3] ?? 0
    const ny = perFace[face * 3 + 1] ?? 0
    const nz = perFace[face * 3 + 2] ?? 1
    const ax = Math.abs(nx)
    const ay = Math.abs(ny)
    const az = Math.abs(nz)
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2
    const sign = (axis === 0 ? nx : axis === 1 ? ny : nz) >= 0 ? 1 : -1
    for (const slot of mesh.faces[face]!) {
      const x = (mesh.vertices[slot * 3] ?? 0) - centre[0]!
      const y = (mesh.vertices[slot * 3 + 1] ?? 0) - centre[1]!
      const z = (mesh.vertices[slot * 3 + 2] ?? 0) - centre[2]!
      const u = axis === 0 ? (sign > 0 ? -y : y) : axis === 1 ? (sign > 0 ? x : -x) : x
      const v = axis === 2 ? (sign > 0 ? y : -y) : z
      data[loop * 2] = u / span + 0.5
      data[loop * 2 + 1] = v / span + 0.5
      loop += 1
    }
  }
  return data
}

/** The wireframe of a mesh: every edge once, as a flat list of segment endpoints. */
export function edgePositions(mesh: MeshData): Float32Array {
  const positions = new Float32Array(mesh.edges.length * 6)
  for (let index = 0; index < mesh.edges.length; index += 1) {
    const [a, b] = mesh.edges[index]!
    positions[index * 6] = mesh.vertices[a * 3] ?? 0
    positions[index * 6 + 1] = mesh.vertices[a * 3 + 1] ?? 0
    positions[index * 6 + 2] = mesh.vertices[a * 3 + 2] ?? 0
    positions[index * 6 + 3] = mesh.vertices[b * 3] ?? 0
    positions[index * 6 + 4] = mesh.vertices[b * 3 + 1] ?? 0
    positions[index * 6 + 5] = mesh.vertices[b * 3 + 2] ?? 0
  }
  return positions
}

export function createMesh(view: MeshView, material: Material | Material[]): Mesh {
  const object = new Mesh(view.geometry, material)
  object.matrixAutoUpdate = false
  return object
}

/**
 * The order to write the triangles in, and the runs that come out of it.
 *
 * A mesh whose faces all name slot zero — which is most of them — keeps its own order, so nothing
 * is paid for a feature it does not use, and the group is the whole of it.
 */
function groupByMaterial(
  mesh: MeshData,
  triangulation: Triangulation,
): { order: Uint32Array; groups: Array<{ material: number; start: number; count: number }> } {
  const { triangleFace, triangleCount } = triangulation
  const slots = mesh.attributes.face.material
  const order = new Uint32Array(triangleCount)
  let mixed = false
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    order[triangle] = triangle
    if ((slots[triangleFace[triangle]!] ?? 0) !== 0) mixed = true
  }
  if (!mixed) {
    return { order, groups: triangleCount > 0 ? [{ material: 0, start: 0, count: triangleCount }] : [] }
  }
  const byMaterial = [...order].sort((a, b) => (
    (slots[triangleFace[a]!] ?? 0) - (slots[triangleFace[b]!] ?? 0) || a - b
  ))
  const groups: Array<{ material: number; start: number; count: number }> = []
  for (let position = 0; position < byMaterial.length; position += 1) {
    order[position] = byMaterial[position]!
    const material = slots[triangleFace[byMaterial[position]!]!] ?? 0
    const last = groups[groups.length - 1]
    if (last && last.material === material) last.count += 1
    else groups.push({ material, start: position, count: 1 })
  }
  return { order, groups }
}
