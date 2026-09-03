import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createSceneDocument, ROOT_COLLECTION_ID } from '@/scene/document'
import { SceneLightHandles } from '@/scene/SceneLightHandles'
import type { LightData, SceneDocument, SceneObject, Vec3 } from '@/scene/types'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'

/**
 * The handle is arithmetic on screen distances, so it is tested with a viewport that projects by a
 * rule rather than with a renderer: a world point becomes a pixel by dropping Z and scaling, which
 * is enough for a drag to be measured and keeps the test away from WebGL.
 */

/** x and y as pixels, a hundred to the metre, with the origin in the middle of an 800×600 region. */
const projector = { project: (point: Vec3) => [400 + point[0] * 100, 300 - point[1] * 100] as [number, number] }

function light(data: Partial<LightData>): SceneObject {
  return {
    id: 'light-1',
    name: 'Light',
    kind: 'light',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: {
      kind: 'light',
      light: 'spot',
      color: '#ffffff',
      power: 100,
      radius: 0.1,
      spotAngle: 45,
      spotBlur: 0.15,
      areaShape: 'square',
      areaSize: [1, 1],
      shadow: true,
      distance: 0,
      ...data,
    } as LightData,
    modifiers: [],
    materialSlots: [],
  }
}

function show(object: SceneObject) {
  const document: SceneDocument = { ...createSceneDocument(), objects: [object], meshes: {} }
  const onEditDocument = vi.fn()
  render(
    <SceneLightHandles
      document={document}
      selection={{ objectIds: [object.id], activeObjectId: object.id }}
      viewport={projector as unknown as SceneViewport}
      onEditDocument={onEditDocument}
      onGestureStart={vi.fn()}
      onGestureEnd={vi.fn()}
    />,
  )
  return { document, onEditDocument }
}

/** The light as the panel's edit would leave it. */
function edited(spy: ReturnType<typeof vi.fn>, document: SceneDocument): LightData {
  const edit = spy.mock.calls.at(-1)?.[0] as (current: SceneDocument) => SceneDocument
  return edit(document).objects[0]!.data as LightData
}

describe('a light’s own handle', () => {
  it('offers one on a spot, on the rim of its cone', () => {
    show(light({ light: 'spot', spotAngle: 90 }))
    const grip = document.querySelector('.scene-light-handles__grip')
    expect(grip).not.toBeNull()
    // A 90° cone drawn two metres down is two metres wide at the rim: 200 pixels from the axis.
    expect(Number(grip!.getAttribute('cx'))).toBeCloseTo(400 + 200, 3)
  })

  it('offers none on a point light, which has no shape to drag', () => {
    show(light({ light: 'point' }))
    expect(document.querySelector('.scene-light-handles__grip')).toBeNull()
  })

  it('widens the cone when the handle is dragged away from the axis', () => {
    const object = light({ light: 'spot', spotAngle: 45 })
    const { document: scene, onEditDocument } = show(object)
    // The drag starts where the pointer is pressed and doubles its distance from the axis.
    const grip = window.document.querySelector('.scene-light-handles__grip')!
    fireEvent.pointerDown(grip, { clientX: 500, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 600, clientY: 300, pointerId: 1 })
    const data = edited(onEditDocument, scene)
    // The radius doubled, so the half-angle is the arctangent of twice what it was.
    const before = Math.tan((45 / 2) * (Math.PI / 180)) * 2
    expect(data.spotAngle).toBeCloseTo((2 * Math.atan((before * 2) / 2) * 180) / Math.PI, 3)
  })

  it('keeps a square area square while it is resized', () => {
    const object = light({ light: 'area', areaShape: 'square', areaSize: [2, 2] })
    const { document: scene, onEditDocument } = show(object)
    const grip = window.document.querySelector('.scene-light-handles__grip')!
    fireEvent.pointerDown(grip, { clientX: 500, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 600, clientY: 300, pointerId: 1 })
    const data = edited(onEditDocument, scene)
    expect(data.areaSize[0]).toBeCloseTo(data.areaSize[1], 6)
    expect(data.areaSize[0]).toBeGreaterThan(2)
  })

  it('draws nothing when no light is active', () => {
    const object = light({})
    const scene: SceneDocument = { ...createSceneDocument(), objects: [object], meshes: {} }
    render(
      <SceneLightHandles
        document={scene}
        selection={{ objectIds: [], activeObjectId: null }}
        viewport={projector as unknown as SceneViewport}
        onEditDocument={vi.fn()}
        onGestureStart={vi.fn()}
        onGestureEnd={vi.fn()}
      />,
    )
    expect(screen.queryByRole('presentation')).toBeNull()
    expect(window.document.querySelectorAll('.scene-light-handles__grip')).toHaveLength(0)
  })
})
