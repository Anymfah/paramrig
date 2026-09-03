import { meshOf } from '@/scene/document'
import { editedObjectIds } from '@/scene/mesh/selection'
import { cachedTriangulation } from '@/scene/mesh/triangulate'
import type { SceneDocument, SceneSelection } from '@/scene/types'

/**
 * The numbers along the bottom in edit mode: how much is selected out of how much there is.
 *
 * Blender's counts are the whole of what is being edited rather than the whole scene, because that
 * is what a person in edit mode is working on — and they are the reason the status bar is worth
 * looking at at all: "Verts 4/8" is how you find out that the box select took four when you meant
 * eight.
 */

export type EditStats = {
  vertices: { selected: number; total: number }
  edges: { selected: number; total: number }
  faces: { selected: number; total: number }
  triangles: number
  /** How many meshes are open at once, which the header says when it is more than one. */
  objects: number
}

export function editStats(document: SceneDocument, selection: SceneSelection): EditStats {
  const stats: EditStats = {
    vertices: { selected: 0, total: 0 },
    edges: { selected: 0, total: 0 },
    faces: { selected: 0, total: 0 },
    triangles: 0,
    objects: 0,
  }
  for (const id of editedObjectIds(selection)) {
    const object = document.objects.find((candidate) => candidate.id === id)
    if (!object || object.data.kind !== 'mesh') continue
    const mesh = meshOf(document, object)
    if (!mesh) continue
    stats.objects += 1
    stats.vertices.total += mesh.vertexIds.length
    stats.edges.total += mesh.edges.length
    stats.faces.total += mesh.faces.length
    stats.triangles += cachedTriangulation(mesh).triangleCount
    const stored = selection.elements?.[id]
    if (!stored) continue
    // The stored ids may name geometry an operator has since removed; only what the mesh still
    // holds is counted, or the bar would say five of four.
    const vertexIds = new Set(mesh.vertexIds)
    const faceIds = new Set(mesh.faceIds)
    for (const entry of stored.vertices) if (vertexIds.has(Number(entry))) stats.vertices.selected += 1
    for (const entry of stored.faces) if (faceIds.has(Number(entry))) stats.faces.selected += 1
    const edgeKeys = new Set<string>()
    for (const [a, b] of mesh.edges) {
      const first = mesh.vertexIds[a] ?? -1
      const second = mesh.vertexIds[b] ?? -1
      edgeKeys.add(first < second ? `${first}:${second}` : `${second}:${first}`)
    }
    for (const entry of stored.edges) if (edgeKeys.has(entry)) stats.edges.selected += 1
  }
  return stats
}
