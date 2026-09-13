import { meshOf } from '@/scene/model'
import { readOnlyAdjacency } from '@/scene/mesh/adjacency'
import { editedObjectIds } from '@/scene/mesh/selection'
import { worldMatrix, worldPointOf } from '@/scene/objects'
import { loopCutPreview } from '@/scene/operators/loopCut'
import type { SceneDocument, SceneSelection, Vec3 } from '@/scene/types'

/**
 * What a tool draws before it has done anything.
 *
 * A loop cut shows where it would cut while the pointer is still choosing which ring to cut, and
 * the whole value of that is that nothing has happened yet: the mesh is untouched, the lines are
 * drawn over it, and moving to another edge moves them. So the geometry here is a pure function of
 * the document and the edge under the pointer, computed on every pointer move — which is why it
 * has to stay cheap, and why the operator exports the walk rather than hiding it.
 */

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
  const mesh = readOnlyAdjacency(data)
  if (!mesh.hasEdge(edge)) return []
  const matrix = worldMatrix(document, object)
  return loopCutPreview(mesh, edge, cuts, factor).map((line) => line.map((point) => worldPointOf(matrix, point)))
}

/**
 * Where an element is in the world, for the tools that snap to one.
 *
 * A knife point that lands on a vertex has to land on it exactly, or the cut mints a second vertex
 * a hair away from the first and the mesh gains a crack nobody can see and everybody trips over.
 * So the snap works from the geometry rather than from the pixels: the id buffer says which element
 * the pointer is over, and this says where that element actually is.
 */
export function elementWorldPoints(
  document: SceneDocument,
  objectId: string,
  kind: 'vertex' | 'edge' | 'face',
  slot: number,
): Vec3[] {
  const object = document.objects.find((candidate) => candidate.id === objectId)
  if (!object || object.data.kind !== 'mesh') return []
  const data = meshOf(document, object)
  if (!data) return []
  const matrix = worldMatrix(document, object)
  const at = (corner: number): Vec3 => worldPointOf(matrix, [
    data.vertices[corner * 3] ?? 0,
    data.vertices[corner * 3 + 1] ?? 0,
    data.vertices[corner * 3 + 2] ?? 0,
  ])
  if (kind === 'vertex') return slot >= 0 && slot < data.vertexIds.length ? [at(slot)] : []
  if (kind === 'edge') {
    const edge = data.edges[slot]
    return edge ? [at(edge[0]), at(edge[1])] : []
  }
  const loop = data.faces[slot]
  return loop ? loop.map(at) : []
}
