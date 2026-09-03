import { describe, expect, it } from 'vitest'
import { DEFAULT_UNITS } from '@/scene/document'
import { edgeKey } from '@/scene/mesh/data'
import { boxMesh } from '@/scene/mesh/primitives'
import { editLabels } from '@/scene/editLabels'
import { editContext } from '@/scene/operators/editHarness'
import type { OverlayFlags } from '@/scene/types'

/*
 * The labels are a pure function of a document, a selection and which overlays are on — which is
 * what lets the placing be tested without a camera, and the projection be the viewport's own
 * business.
 */

function overlays(patch: Partial<OverlayFlags>): OverlayFlags {
  return { ...editContext({ mesh: boxMesh(2) }).document.view.overlays, ...patch }
}

describe('the measurement overlays', () => {
  it('says nothing when none of them is on', () => {
    const context = editContext({ mesh: boxMesh(2), faces: [0] })
    expect(editLabels(context.document, context.selection, overlays({}), DEFAULT_UNITS)).toEqual([])
  })

  it('says nothing about a selection of nothing', () => {
    const context = editContext({ mesh: boxMesh(2) })
    expect(editLabels(context.document, context.selection, overlays({ faceArea: true }), DEFAULT_UNITS)).toEqual([])
  })

  it('measures a selected face at its middle, in the document’s units', () => {
    const mesh = boxMesh(2)
    const context = editContext({ mesh, faces: [mesh.faceIds[0]!], selectMode: ['face'] })

    const found = editLabels(context.document, context.selection, overlays({ faceArea: true }), DEFAULT_UNITS)

    expect(found).toHaveLength(1)
    // Two metres across, so four square metres, at the middle of that face.
    expect(found[0]!.text).toBe('4.000 m²')
    expect(found[0]!.kind).toBe('area')
    const loop = mesh.faces[0]!
    const centre = [0, 1, 2].map((axis) => (
      loop.reduce((total, corner) => total + mesh.vertices[corner * 3 + axis]!, 0) / loop.length
    ))
    for (const axis of [0, 1, 2]) expect(found[0]!.at[axis]).toBeCloseTo(centre[axis]!, 10)
  })

  it('measures a selected edge, and the fold across it', () => {
    const mesh = boxMesh(2)
    const [a, b] = mesh.edges[0]!
    const key = edgeKey(mesh.vertexIds[a]!, mesh.vertexIds[b]!)
    const context = editContext({ mesh, edges: [key], selectMode: ['edge'] })

    const found = editLabels(context.document, context.selection, overlays({ edgeLength: true, edgeAngle: true }), DEFAULT_UNITS)

    expect(found.map((label) => label.kind).sort()).toEqual(['angle', 'length'])
    expect(found.find((label) => label.kind === 'length')!.text).toBe('2.000 m')
    // Two faces of a cube meet at a right angle, which Blender writes as ninety degrees.
    expect(found.find((label) => label.kind === 'angle')!.text).toBe('90.0°')
  })

  it('writes an index only for the kind being selected', () => {
    const mesh = boxMesh(2)
    const context = editContext({ mesh, faces: [mesh.faceIds[1]!], selectMode: ['face'] })

    const found = editLabels(context.document, context.selection, overlays({ indices: true }), DEFAULT_UNITS)

    expect(found).toHaveLength(1)
    expect(found[0]!.text).toBe(String(mesh.faceIds[1]))

    const asVertices = editLabels(
      { ...context.document, view: { ...context.document.view, selectMode: ['vertex'] } },
      context.selection,
      overlays({ indices: true }),
      DEFAULT_UNITS,
    )
    expect(asVertices).toEqual([])
  })

  it('measures in centimetres below a metre, and in feet in an imperial document', () => {
    const mesh = boxMesh(0.4)
    const [a, b] = mesh.edges[0]!
    const key = edgeKey(mesh.vertexIds[a]!, mesh.vertexIds[b]!)
    const context = editContext({ mesh, edges: [key], selectMode: ['edge'] })
    const flags = overlays({ edgeLength: true })

    expect(editLabels(context.document, context.selection, flags, DEFAULT_UNITS)[0]!.text).toBe('40.0 cm')
    expect(editLabels(context.document, context.selection, flags, { system: 'imperial', scale: 1 })[0]!.text)
      .toBe('1.31 ft')
    expect(editLabels(context.document, context.selection, flags, { system: 'none', scale: 1 })[0]!.text)
      .toBe('0.400')
  })

  it('stops at the point where numbers stop being a measurement', () => {
    const mesh = boxMesh(2)
    const context = editContext({
      mesh,
      vertices: [...mesh.vertexIds],
      edges: mesh.edges.map(([a, b]) => edgeKey(mesh.vertexIds[a]!, mesh.vertexIds[b]!)),
      faces: [...mesh.faceIds],
      selectMode: ['vertex', 'edge', 'face'],
    })

    const found = editLabels(
      context.document,
      context.selection,
      overlays({ indices: true, edgeLength: true, edgeAngle: true, faceArea: true }),
      DEFAULT_UNITS,
    )

    expect(found.length).toBeLessThanOrEqual(400)
    expect(found.length).toBeGreaterThan(8)
  })
})
