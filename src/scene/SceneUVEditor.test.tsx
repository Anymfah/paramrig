import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_UV_EDITOR, DEFAULT_VIEW } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { withUvMaps } from '@/scene/mesh/uv'
import { SceneUVEditor } from '@/scene/SceneUVEditor'
import type { SceneDocument, SceneObject, UvEditorState } from '@/scene/types'

/**
 * The second space, checked as a person meets it: what it says when there is nothing to show, what
 * it says when there is, and whether its controls report the choices they are given.
 *
 * The canvas itself is not drawn here — jsdom has no 2D context — which is why the drawing has its
 * own test against a recorder. What is checked here is everything around it, including the sentence
 * a screen reader is given in place of the picture.
 */

const MESH_ID = 'mesh-cube'

function cube(): SceneObject {
  return {
    id: 'a',
    name: 'Cube',
    kind: 'mesh',
    collectionId: 'scene-collection',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: MESH_ID },
    modifiers: [],
    materialSlots: [],
  }
}

function scene(mode: 'object' | 'edit', mesh = boxMesh(2)): SceneDocument {
  return {
    version: 1,
    id: 'scene-test',
    name: 'Test scene',
    objects: [cube()],
    meshes: { [MESH_ID]: mesh },
    collections: [{ id: 'scene-collection', name: 'Scene Collection' }],
    materials: [],
    world: { color: '#3b3b3b', strength: 1 },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    view: { ...structuredClone(DEFAULT_VIEW), mode },
    units: { system: 'metric', scale: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function setup(document: SceneDocument, uv: Partial<UvEditorState> = {}) {
  const onUv = vi.fn()
  const onClose = vi.fn()
  render(
    <SceneUVEditor
      document={document}
      selection={{ objectIds: ['a'], activeObjectId: 'a' }}
      uv={{ ...DEFAULT_UV_EDITOR, open: true, ...uv }}
      onUv={onUv}
      onClose={onClose}
    />,
  )
  return { onUv, onClose }
}

beforeEach(() => {
  // jsdom measures nothing, and a canvas of no size never gets a view to draw with.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('the UV editor', () => {
  it('shows the map of a mesh that is open for editing, and names it', () => {
    setup(scene('edit'))
    expect(screen.getAllByText('UVMap').length).toBeGreaterThan(0)
    // Twenty points for the cube's twenty-four corners: the merge, said out loud for a reader.
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'UV map UVMap, 20 points.')
    expect(screen.getByText('20 points')).toBeInTheDocument()
  })

  it('says how to reach the map when the mesh is not open for editing', () => {
    setup(scene('object'))
    expect(screen.getByText(/Open the mesh for editing with Tab/)).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('not open for editing'))
  })

  it('says a mesh has no map rather than drawing an empty one', () => {
    setup(scene('edit', withUvMaps(boxMesh(2), [])))
    expect(screen.getByText(/no UV map yet/)).toBeInTheDocument()
    expect(screen.getByText('No UV map')).toBeInTheDocument()
  })

  it('offers the backgrounds, the grid and the stretch overlays, and reports a choice', () => {
    const { onUv } = setup(scene('edit'))
    fireEvent.click(screen.getByRole('button', { name: 'Display' }))
    expect(screen.getByRole('menuitemradio', { name: 'Checker' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Material texture' }))
    expect(onUv).toHaveBeenCalledWith({ background: 'texture' })
  })

  it('turns the grid off from the same menu', () => {
    const { onUv } = setup(scene('edit'))
    fireEvent.click(screen.getByRole('button', { name: 'Display' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Grid' }))
    expect(onUv).toHaveBeenCalledWith({ grid: false })
  })

  it('zooms, and says how big the image is on screen', () => {
    setup(scene('edit'))
    // The fit puts the 400-pixel side, less its margins, across the image.
    expect(screen.getByText('336 px')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('420 px')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(screen.getByText('336 px')).toBeInTheDocument()
  })

  it('frames the map rather than the image when there is a map to frame', () => {
    // Every face on the whole image, so framing the map and framing the image agree; what is being
    // checked is that the button answers at all rather than throwing on a null view.
    setup(scene('edit'))
    fireEvent.click(screen.getByRole('button', { name: 'Frame the map' }))
    expect(screen.getByText('336 px')).toBeInTheDocument()
  })

  it('closes when it is asked to', () => {
    const { onClose } = setup(scene('edit'))
    fireEvent.click(screen.getByRole('button', { name: 'Close the UV editor' }))
    expect(onClose).toHaveBeenCalled()
  })
})
