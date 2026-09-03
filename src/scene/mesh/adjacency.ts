import { EditMesh } from '@/scene/mesh/editMesh'
import type { MeshData } from '@/scene/types'

/**
 * One built adjacency, kept for whoever asks about the same mesh next.
 *
 * Building an `EditMesh` copies the mesh and walks every corner of it. Once is nothing; several
 * times a frame, on a mesh of twenty thousand vertices, is most of a second — and several times a
 * frame is exactly what happens, because the gizmo's pivot, the sidebar's median and the status
 * bar's counts all ask the same question about the same mesh between one render and the next.
 *
 * The cache is keyed on the *identity* of the `MeshData`, not on its contents: the document is
 * immutable, so a mesh that has changed is a different object and the entry is missed. That is what
 * makes this safe with no invalidation to remember.
 *
 * **The mesh handed back must not be mutated.** An operator that edits geometry builds its own
 * through `EditMesh.from`; this is for the questions that only read.
 */
let cached: { data: MeshData; mesh: EditMesh } | null = null

export function readOnlyAdjacency(data: MeshData): EditMesh {
  if (cached && cached.data === data) return cached.mesh
  const mesh = EditMesh.from(data)
  cached = { data, mesh }
  return mesh
}

/** Forgets what was kept. Only a test that mutates a mesh in place needs this. */
export function clearAdjacencyCache(): void {
  cached = null
}
