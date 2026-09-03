import { meshOf } from '@/scene/document'
import { EditMesh } from '@/scene/mesh/editMesh'
import { editedObjectIds } from '@/scene/mesh/selection'
import { worldMatrix, worldPointOf } from '@/scene/objects'
import { loopCutPreview } from '@/scene/operators/loopCut'
import type { MeshData, SceneDocument, SceneSelection, Vec3 } from '@/scene/types'

/**
 * What a tool draws before it has done anything.
 *
 * A loop cut shows where it would cut while the pointer is still choosing which ring to cut, and
 * the whole value of that is that nothing has happened yet: the mesh is untouched, the lines are
 * drawn over it, and moving to another edge moves them. So the geometry here is a pure function of
 * the document and the edge under the pointer, computed on every pointer move — which is why it
 * has to stay cheap, and why the operator exports the walk rather than hiding it.
 */

/**
 * The last mesh a preview was built from, and its adjacency.
 *
 * Building an `EditMesh` copies the mesh and walks all of it, which on a hundred thousand corners
 * is several milliseconds — once is nothing, sixty times a second is the difference between a
 * preview that follows the pointer and one that lags behind it. Nothing is cut while the preview is
 * running, so the mesh it was built from is the same object on the next move, and comparing
 * identity is enough to know it.
 */
let cached: { data: MeshData; mesh: EditMesh } | null = null

function adjacencyOf(data: MeshData): EditMesh {
  if (cached && cached.data === data) return cached.mesh
  const mesh = EditMesh.from(data)
  cached = { data, mesh }
  return mesh
}

/** Forgets the cached adjacency, which a test that mutates a mesh in place has to do. */
export function clearPreviewCache(): void {
  cached = null
}

/** The polylines a loop cut would leave, in world space, ready to be projected and drawn. */
export function loopCutPolylines(
  document: SceneDocument,
  selection: SceneSelection,
  edge: number,
  cuts: number,
  factor: number,
): Vec3[][] {
  const objectId = editedObjectIds(selection)[0]
  const object = document.objects.find((candidate) => candidate.id === objectId)
  if (!object || object.data.kind !== 'mesh') return []
  const data = meshOf(document, object)
  if (!data) return []
  const mesh = adjacencyOf(data)
  if (!mesh.hasEdge(edge)) return []
  const matrix = worldMatrix(document, object)
  return loopCutPreview(mesh, edge, cuts, factor).map((line) => line.map((point) => worldPointOf(matrix, point)))
}
