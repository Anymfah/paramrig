import { meshOf } from '@/scene/document'
import { readOnlyAdjacency } from '@/scene/mesh/adjacency'
import { editedObjectIds, toElements } from '@/scene/mesh/selection'
import { elementSlot } from '@/scene/operators/edit'
import { worldMatrix, worldPointOf } from '@/scene/objects'
import type { OverlayFlags, SceneDocument, SceneSelection, SceneUnits, Vec3 } from '@/scene/types'

/**
 * The numbers Blender writes over a mesh: the indices of its elements, and the size of what is
 * selected.
 *
 * They are text, so they are drawn in the DOM rather than in the canvas — a browser draws a legible
 * number at any device ratio and a canvas has to be taught how. What is computed here is where each
 * one belongs *in the world*; the viewport turns that into a place on screen, because it is the only
 * thing that knows where the camera is.
 *
 * Only the selection is measured. Blender does the same, and for the same reason: a length written
 * over every edge of a mesh is not information, it is a wall of digits.
 */

export type EditLabel = {
  /** Where it belongs, in world metres. */
  at: Vec3
  text: string
  kind: 'index' | 'length' | 'angle' | 'area'
}

/** How many labels are worth drawing at once; past this it is a wall of digits, not a measurement. */
export const MAX_LABELS = 400

export function editLabels(
  document: SceneDocument,
  selection: SceneSelection,
  overlays: OverlayFlags,
  units: SceneUnits,
): EditLabel[] {
  const wanted = overlays.indices || overlays.edgeLength || overlays.edgeAngle || overlays.faceArea
  if (!wanted || document.view.mode !== 'edit') return []
  const labels: EditLabel[] = []
  const modes = document.view.selectMode
  for (const objectId of editedObjectIds(selection)) {
    if (labels.length >= MAX_LABELS) break
    const object = document.objects.find((candidate) => candidate.id === objectId)
    if (!object || object.data.kind !== 'mesh') continue
    const data = meshOf(document, object)
    if (!data) continue
    const stored = selection.elements?.[objectId]
    if (!stored) continue
    if (stored.vertices.length + stored.edges.length + stored.faces.length === 0) continue
    const mesh = readOnlyAdjacency(data)
    const matrix = worldMatrix(document, object)
    const elements = toElements(selection, objectId)

    if (overlays.indices && modes.includes('vertex')) {
      for (const id of elements.vertices) {
        if (labels.length >= MAX_LABELS) break
        const slot = mesh.slotOfVertex(id)
        if (slot < 0) continue
        labels.push({ at: worldPointOf(matrix, mesh.position(slot)), text: String(id), kind: 'index' })
      }
    }

    for (const key of elements.edges) {
      if (labels.length >= MAX_LABELS) break
      const slot = elementSlot(mesh, 'edge', key)
      if (slot < 0) continue
      const [a, b] = mesh.edgeVertices(slot)
      if (a < 0 || b < 0) continue
      const middle = mesh.median([a, b])
      const at = worldPointOf(matrix, middle)
      if (overlays.indices && modes.includes('edge')) labels.push({ at, text: key, kind: 'index' })
      if (overlays.edgeLength) labels.push({ at, text: length(mesh.edgeLength(slot), units), kind: 'length' })
      if (overlays.edgeAngle) {
        // Blender's edge angle is the fold across it, which is only there when two faces meet.
        const faces = mesh.edgeFaces(slot)
        if (faces.length === 2) {
          const degrees = 180 - (mesh.dihedral(slot) * 180) / Math.PI
          labels.push({ at, text: `${degrees.toFixed(1)}°`, kind: 'angle' })
        }
      }
    }

    for (const id of elements.faces) {
      if (labels.length >= MAX_LABELS) break
      const slot = mesh.slotOfFace(id)
      if (slot < 0) continue
      const at = worldPointOf(matrix, mesh.faceCentre(slot))
      if (overlays.indices && modes.includes('face')) labels.push({ at, text: String(id), kind: 'index' })
      if (overlays.faceArea) labels.push({ at, text: area(mesh.faceArea(slot), units), kind: 'area' })
    }
  }
  return labels
}

/** A length in the document's own units, at the precision a person reads. */
function length(metres: number, units: SceneUnits): string {
  if (units.system === 'none') return metres.toFixed(3)
  if (units.system === 'imperial') return `${(metres * 3.28084).toFixed(2)} ft`
  const scaled = metres * units.scale
  return Math.abs(scaled) < 1 ? `${(scaled * 100).toFixed(1)} cm` : `${scaled.toFixed(3)} m`
}

function area(square: number, units: SceneUnits): string {
  if (units.system === 'none') return square.toFixed(3)
  if (units.system === 'imperial') return `${(square * 10.7639).toFixed(2)} ft²`
  const scaled = square * units.scale * units.scale
  return Math.abs(scaled) < 1 ? `${(scaled * 10000).toFixed(1)} cm²` : `${scaled.toFixed(3)} m²`
}
