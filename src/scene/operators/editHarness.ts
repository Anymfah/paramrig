import { DEFAULT_MATERIAL, DEFAULT_UNITS, DEFAULT_VIEW, DEFAULT_WORLD, ROOT_COLLECTION_ID } from '@/scene/document'
import { edgeKey } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import type { OperatorContext, OperatorResult } from '@/scene/operators/types'
import type {
  EdgeKey,
  ElementRef,
  MeshData,
  SceneDocument,
  SceneObject,
  SceneSelection,
  SelectMode,
  Vec3,
  ViewState,
} from '@/scene/types'

/**
 * A scene in edit mode, in one call, for the tests of the mesh operators.
 *
 * Eighty operators need the same thing to be tested: a document holding one mesh, that mesh open
 * for editing, and some of it selected. Written out once each, that is eighty chances to build the
 * context slightly differently and to test eighty slightly different editors. It is written here
 * once instead, and the operators' tests say only what they are about.
 *
 * Nothing here is used by the editor itself; it is a fixture, and it lives beside the operators
 * because that is what it is a fixture for.
 */

export const HARNESS_MESH_ID = 'mesh-under-test'
export const HARNESS_OBJECT_ID = 'object-under-test'

export type EditFixture = {
  mesh: MeshData
  /** Vertex ids, edge keys and face ids — the form a document stores a selection in. */
  vertices?: number[]
  edges?: EdgeKey[]
  faces?: number[]
  active?: { kind: SelectMode; id: string }
  selectMode?: SelectMode[]
  /** More objects in the scene, for the operators that read the rest of it. */
  others?: Array<{ id: string; mesh: MeshData; transform?: SceneObject['transform']; selected?: boolean }>
  cursor?: Vec3
  /** The editor's mode. Edit unless a test is about an operator that runs on whole objects. */
  mode?: 'object' | 'edit' | 'sculpt'
  view?: Partial<ViewState>
  pointer?: OperatorContext['pointer']
}

function object(id: string, meshId: string, transform?: SceneObject['transform']): SceneObject {
  return {
    id,
    name: id,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId },
    modifiers: [],
    materialSlots: [DEFAULT_MATERIAL.id],
  }
}

/** The context an edit-mode operator runs in, built around one mesh. */
export function editContext(fixture: EditFixture): OperatorContext {
  const objects: SceneObject[] = [object(HARNESS_OBJECT_ID, HARNESS_MESH_ID)]
  const meshes: Record<string, MeshData> = { [HARNESS_MESH_ID]: fixture.mesh }
  const selectedObjects = [HARNESS_OBJECT_ID]
  for (const other of fixture.others ?? []) {
    objects.push(object(other.id, `mesh-${other.id}`, other.transform))
    meshes[`mesh-${other.id}`] = other.mesh
    if (other.selected) selectedObjects.push(other.id)
  }
  const view: ViewState = {
    ...structuredClone(DEFAULT_VIEW),
    mode: fixture.mode ?? 'edit',
    selectMode: fixture.selectMode ?? ['vertex'],
    ...fixture.view,
  }
  const document: SceneDocument = {
    version: 1,
    id: 'scene-under-test',
    name: 'Test',
    objects,
    meshes,
    collections: [{ id: ROOT_COLLECTION_ID, name: 'Scene Collection' }],
    materials: [{ ...DEFAULT_MATERIAL }],
    world: { ...DEFAULT_WORLD },
    cursor: { position: fixture.cursor ?? [0, 0, 0], rotation: [0, 0, 0] },
    view,
    units: { ...DEFAULT_UNITS },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const active: ElementRef | null = fixture.active
    ? { kind: fixture.active.kind, objectId: HARNESS_OBJECT_ID, id: fixture.active.id }
    : null
  const selection: SceneSelection = {
    objectIds: selectedObjects,
    activeObjectId: HARNESS_OBJECT_ID,
    editObjectIds: [HARNESS_OBJECT_ID],
    elements: {
      [HARNESS_OBJECT_ID]: {
        vertices: (fixture.vertices ?? []).map(String),
        edges: fixture.edges ?? [],
        faces: (fixture.faces ?? []).map(String),
      },
    },
    active,
    elementHistory: active ? [active] : [],
  }
  return {
    document,
    selection,
    mode: fixture.mode ?? 'edit',
    view,
    cursor: document.cursor,
    active: objects[0]!,
    ...(fixture.pointer ? { pointer: fixture.pointer } : {}),
  }
}

/** The mesh an operator left behind, as data. */
export function resultMesh(result: OperatorResult, meshId = HARNESS_MESH_ID): MeshData {
  const mesh = result.document?.meshes[meshId]
  if (!mesh) throw new Error(result.error ?? 'The operator answered with no document.')
  return mesh
}

/** The mesh an operator left behind, with its adjacency built, which is what most assertions read. */
export function resultEdit(result: OperatorResult, meshId = HARNESS_MESH_ID): EditMesh {
  return EditMesh.from(resultMesh(result, meshId))
}

/** What is selected afterwards, by id, sorted — the form an assertion can compare against. */
export function resultSelection(result: OperatorResult, objectId = HARNESS_OBJECT_ID) {
  const stored = result.selection?.elements?.[objectId]
  return {
    vertices: [...(stored?.vertices ?? [])].map(Number).sort((a, b) => a - b),
    edges: [...(stored?.edges ?? [])].sort(),
    faces: [...(stored?.faces ?? [])].map(Number).sort((a, b) => a - b),
  }
}

/** Every edge carries two faces: the mesh is a closed surface, with no rim anywhere. */
export function isClosed(mesh: EditMesh): boolean {
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    if (mesh.edgeFaces(edge).length !== 2) return false
  }
  return true
}

/** V − E + F: 2 for anything sphere-like, which is the cheapest check that a cut stayed sane. */
export function euler(mesh: EditMesh): number {
  return mesh.vertexCount - mesh.edgeCount + mesh.faceCount
}

/** No face repeats a corner, and no face has fewer than three: nothing degenerate was left behind. */
export function isWellFormed(mesh: EditMesh): boolean {
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    if (loop.length < 3) return false
    if (new Set(loop).size !== loop.length) return false
    for (let index = 0; index < loop.length; index += 1) {
      if (mesh.edgeSlot(loop[index]!, loop[(index + 1) % loop.length]!) < 0) return false
    }
  }
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    if (a < 0 || b < 0 || a === b) return false
  }
  return true
}

/**
 * The volume a closed mesh encloses, signed by its winding: positive when the faces face outwards.
 * The sign is the cheapest test that an operator did not turn a mesh inside out, which no count and
 * no `isClosed` can see.
 */
export function signedVolume(mesh: EditMesh): number {
  let total = 0
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    for (let index = 1; index + 1 < loop.length; index += 1) {
      const a = mesh.position(loop[0]!)
      const b = mesh.position(loop[index]!)
      const c = mesh.position(loop[index + 1]!)
      total += (
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6
    }
  }
  return total
}

/** The same, as a size. */
export function meshVolume(mesh: EditMesh): number {
  return Math.abs(signedVolume(mesh))
}

/**
 * Every face wound the same way round its shared edges: what "outward normals" really means.
 * A closed mesh whose walls were built the wrong way round passes `isClosed` and fails this.
 */
export function isConsistentlyWound(mesh: EditMesh): boolean {
  const seen = new Set<string>()
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    for (let index = 0; index < loop.length; index += 1) {
      const key = `${loop[index]}>${loop[(index + 1) % loop.length]}`
      if (seen.has(key)) return false
      seen.add(key)
    }
  }
  return true
}

/** Every id of a kind, for the tests that select all of something. */
export function allIds(mesh: MeshData, kind: 'vertex' | 'face'): number[] {
  return kind === 'vertex' ? [...mesh.vertexIds] : [...mesh.faceIds]
}

/** Every edge of a mesh as a key, in the form a selection stores one. */
export function allEdgeKeys(mesh: MeshData): EdgeKey[] {
  return mesh.edges.map(([a, b]) => edgeKey(mesh.vertexIds[a]!, mesh.vertexIds[b]!))
}

/** One edge as a key, by the slots of its ends — the way a test names an edge it just found. */
export function keyOf(mesh: EditMesh, a: number, b: number): EdgeKey {
  return edgeKey(mesh.vertexId(a), mesh.vertexId(b))
}
