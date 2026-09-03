import { requireEdit, runOnMeshes } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { vectorParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * ⇧D in edit mode: the selected geometry, copied where it stands.
 *
 * Blender leaves the copy selected and starts a move, so that the gesture reads as one action. Here
 * the copy is made with an offset the pointer drives, which is the same thing said as a pure
 * function: at an offset of nothing the copy sits exactly on the original, and the drag takes it
 * away. Nothing is welded back: two vertices in the same place are what a duplicate *is*, and
 * merging them is `mesh.mergeByDistance`, a decision of its own.
 */

type DuplicateParams = { offset: Vec3 }

registerOperator<DuplicateParams>({
  id: 'mesh.duplicate',
  label: 'Duplicate',
  section: 'Mesh',
  shortcut: '⇧D',
  icon: 'mesh',
  description: 'Copy the selected geometry and move the copy.',
  params: [vectorParam('offset', 'Move', { defaultValue: [0, 0, 0], unit: 'm' })],
  defaults: { offset: [0, 0, 0] },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const faces = [...target.faces]
    const edges = [...target.edges]
    const vertices = new Set<number>(target.vertices)
    for (const face of faces) for (const corner of target.mesh.faceVertices(face)) vertices.add(corner)
    for (const edge of edges) for (const end of target.mesh.edgeVertices(edge)) if (end >= 0) vertices.add(end)
    if (vertices.size === 0) return null
    const copies = new Map<number, number>()
    const offset = params.offset
    for (const slot of vertices) {
      const point = target.mesh.position(slot)
      copies.set(slot, target.mesh.addVertex([point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]]))
    }
    const newFaces: number[] = []
    for (const face of faces) {
      const loop = target.mesh.faceVertices(face).map((corner) => copies.get(corner) ?? corner)
      const added = target.mesh.addFace(loop)
      if (added < 0) continue
      target.mesh.copyFaceAttributes(face, added)
      newFaces.push(added)
    }
    const newEdges: number[] = []
    for (const edge of edges) {
      const [a, b] = target.mesh.edgeVertices(edge)
      const copy = target.mesh.addEdge(copies.get(a) ?? a, copies.get(b) ?? b)
      if (copy >= 0) newEdges.push(copy)
    }
    // The copy is what stays selected, so the move that follows takes it and not the original.
    return { select: { vertices: [...copies.values()], edges: newEdges, faces: newFaces } }
  }, { label: 'Duplicate' }),
})
