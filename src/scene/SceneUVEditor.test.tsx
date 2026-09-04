import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_UV_EDITOR, DEFAULT_VIEW } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { withUvMaps } from '@/scene/mesh/uv'
import { SceneUVEditor } from '@/scene/SceneUVEditor'
import type { MeshData, SceneDocument, SceneObject, SceneSelection, UvEditorState } from '@/scene/types'

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

function setup(document: SceneDocument, uv: Partial<UvEditorState> = {}, selection: SceneSelection = everything(document)) {
  const onUv = vi.fn()
  const onClose = vi.fn()
  const onSelection = vi.fn()
  const onRunOperator = vi.fn()
  const edits: Array<{ label: string; mesh: MeshData }> = []
  const onEditDocument = vi.fn((edit: (current: SceneDocument) => SceneDocument, label: string) => {
    edits.push({ label, mesh: edit(document).meshes[MESH_ID]! })
  })
  const gestures: string[] = []
  render(
    <SceneUVEditor
      document={document}
      selection={selection}
      uv={{ ...DEFAULT_UV_EDITOR, open: true, ...uv }}
      onUv={onUv}
      onClose={onClose}
      onSelection={onSelection}
      onEditDocument={onEditDocument}
      onRunOperator={onRunOperator}
      context={null}
      onGestureStart={(label) => gestures.push(`start ${label}`)}
      onGestureEnd={(label) => gestures.push(`end ${label}`)}
      onGestureCancel={() => gestures.push('cancel')}
    />,
  )
  return { onUv, onClose, onSelection, onRunOperator, edits, gestures }
}

/** The viewport selection the editor reads: every face of the mesh, which is what A leaves. */
function everything(document: SceneDocument, uv: number[] = []): SceneSelection {
  const mesh = document.meshes[MESH_ID]!
  return {
    objectIds: ['a'],
    activeObjectId: 'a',
    editObjectIds: ['a'],
    elements: { a: { vertices: [], edges: [], faces: mesh.faceIds.map(String) } },
    ...(uv.length > 0 ? { uv: { a: uv } } : {}),
  }
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

/** A press and a release at one place, which is a click that is not a drag. */
function press(element: HTMLElement, at: [number, number], modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: at[0], clientY: at[1], ...modifiers })
  fireEvent.pointerUp(element, { pointerId: 1, clientX: at[0], clientY: at[1] })
}

describe('the UV editor', () => {
  it('shows the map of a mesh that is open for editing, and names it', () => {
    setup(scene('edit'))
    expect(screen.getAllByText('UVMap').length).toBeGreaterThan(0)
    // Twenty points for the cube's twenty-four corners: the merge, said out loud for a reader.
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'UV map UVMap, 20 points, 0 selected.')
    expect(screen.getByText('0 of 20 points')).toBeInTheDocument()
  })

  it('shows only the faces the viewport has selected, which is what sync off means', () => {
    const document = scene('edit')
    const mesh = document.meshes[MESH_ID]!
    setup(document, {}, {
      objectIds: ['a'],
      activeObjectId: 'a',
      editObjectIds: ['a'],
      elements: { a: { vertices: [], edges: [], faces: [String(mesh.faceIds[0]!)] } },
    })
    // One face of the cube: four corners, four points.
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'UV map UVMap, 4 points, 0 selected.')
  })

  it('says how to see the rest when nothing is selected in the viewport', () => {
    setup(scene('edit'), {}, { objectIds: ['a'], activeObjectId: 'a', editObjectIds: ['a'], elements: { a: { vertices: [], edges: [], faces: [] } } })
    expect(screen.getByText(/Select faces in the viewport/)).toBeInTheDocument()
  })

  it('shows the whole map with sync on, whatever the viewport has selected', () => {
    const document = scene('edit')
    setup(document, { sync: true }, { objectIds: ['a'], activeObjectId: 'a', editObjectIds: ['a'], elements: { a: { vertices: [], edges: [], faces: [] } } })
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'UV map UVMap, 20 points, 0 selected.')
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

  it('selects the point under a click, and every corner sitting on it', () => {
    const document = scene('edit')
    const { onSelection } = setup(document)
    const frame = screen.getByRole('application')
    // The fit puts UV (0, 0) — the bottom-left of the image — at this pixel.
    press(frame, [132, 368])
    const uv = onSelection.mock.calls[0]![0].uv!.a!
    expect(uv.length).toBeGreaterThan(0)
    const map = document.meshes[MESH_ID]!.attributes.loop!.uvMaps![0]!.data
    for (const loop of uv) {
      expect([map[loop * 2], map[loop * 2 + 1]]).toEqual([0, 0])
    }
  })

  it('adds to the selection with shift and takes away with control', () => {
    const document = scene('edit')
    const { onSelection } = setup(document, {}, everything(document, [9]))
    const frame = screen.getByRole('application')
    press(frame, [132, 368], { shiftKey: true })
    expect(onSelection.mock.calls[0]![0].uv!.a!).toContain(9)
    cleanup()
    const again = setup(document, {}, everything(document, [9]))
    press(screen.getByRole('application'), [132, 368], { ctrlKey: true })
    expect(again.onSelection.mock.calls[0]![0].uv!.a!).toContain(9)
  })

  it('takes everything inside a box that is dragged out', () => {
    const document = scene('edit')
    const { onSelection } = setup(document)
    const frame = screen.getByRole('application')
    fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 600, clientY: 400 })
    fireEvent.pointerUp(frame, { pointerId: 1, clientX: 600, clientY: 400 })
    // The box covers the whole image, so every corner of the cube is in it.
    expect(onSelection.mock.calls[0]![0].uv!.a!).toHaveLength(24)
  })

  it('changes what a click picks up, from the header and from the number keys', () => {
    const { onUv } = setup(scene('edit'))
    fireEvent.click(screen.getByRole('button', { name: 'Island' }))
    expect(onUv).toHaveBeenCalledWith({ selectMode: 'island' })
    fireEvent.keyDown(screen.getByRole('application'), { key: '3' })
    expect(onUv).toHaveBeenLastCalledWith({ selectMode: 'face' })
  })

  it('selects everything with A and nothing with alt A', () => {
    const document = scene('edit')
    const { onSelection } = setup(document)
    const frame = screen.getByRole('application')
    fireEvent.keyDown(frame, { key: 'a' })
    expect(onSelection.mock.calls[0]![0].uv!.a!).toHaveLength(24)
    fireEvent.keyDown(frame, { key: 'a', altKey: true })
    expect(onSelection.mock.calls[1]![0].uv!.a!).toHaveLength(0)
  })

  it('moves the selection with G, as one gesture and one entry', () => {
    const document = scene('edit')
    const { edits, gestures } = setup(document, {}, everything(document, [0, 1, 2, 3]))
    const frame = screen.getByRole('application')
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 300, clientY: 200 })
    fireEvent.keyDown(frame, { key: 'g' })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 384, clientY: 200 })
    fireEvent.pointerDown(frame, { button: 0, pointerId: 1, clientX: 384, clientY: 200 })
    expect(gestures).toEqual(['start Move UV', 'end Move UV'])
    const moved = edits.at(-1)!.mesh.attributes.loop!.uvMaps![0]!.data
    // Eighty-four pixels of a three-hundred-and-thirty-six-pixel image is a quarter of it.
    expect(moved[0]).toBeCloseTo(0.25, 3)
  })

  it('holding shift moves a tenth as far, as it does in the viewport', () => {
    const document = scene('edit')
    const { edits } = setup(document, {}, everything(document, [0, 1, 2, 3]))
    const frame = screen.getByRole('application')
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 300, clientY: 200 })
    fireEvent.keyDown(frame, { key: 'g' })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 384, clientY: 200, shiftKey: true })
    const moved = edits.at(-1)!.mesh.attributes.loop!.uvMaps![0]!.data
    expect(moved[0]).toBeCloseTo(0.025, 3)
  })

  it('puts the map back when a move is cancelled', () => {
    const document = scene('edit')
    const { edits, gestures } = setup(document, {}, everything(document, [0, 1, 2, 3]))
    const frame = screen.getByRole('application')
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 300, clientY: 200 })
    fireEvent.keyDown(frame, { key: 'g' })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 384, clientY: 200 })
    fireEvent.keyDown(frame, { key: 'Escape' })
    expect(gestures).toEqual(['start Move UV', 'cancel'])
    const back = edits.at(-1)!.mesh.attributes.loop!.uvMaps![0]!.data
    expect(back[0]).toBe(0)
  })

  it('says what a running gesture is doing, in the image’s own numbers', () => {
    const document = scene('edit')
    setup(document, {}, everything(document, [0, 1, 2, 3]))
    const frame = screen.getByRole('application')
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 300, clientY: 200 })
    fireEvent.keyDown(frame, { key: 'g' })
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 384, clientY: 200 })
    const status = screen.getByText(/Dx/)
    expect(status.textContent).toContain('0.25')
    expect(status.textContent).not.toContain(' m')
  })

  it('with sync on, a pick in the image selects the mesh itself', () => {
    const document = scene('edit')
    const { onSelection } = setup(document, { sync: true })
    press(screen.getByRole('application'), [132, 368])
    const next = onSelection.mock.calls[0]![0]
    expect(next.uv).toBeUndefined()
    // The corner that was picked names a vertex, and the mesh selection is what comes back.
    expect(next.elements!.a!.vertices.length).toBeGreaterThan(0)
  })

  it('with sync on, what the mesh has selected is what the image shows as selected', () => {
    const document = scene('edit')
    const mesh = document.meshes[MESH_ID]!
    setup(document, { sync: true }, {
      objectIds: ['a'],
      activeObjectId: 'a',
      editObjectIds: ['a'],
      elements: { a: { vertices: mesh.vertexIds.map(String), edges: [], faces: [] } },
    })
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'UV map UVMap, 20 points, 20 selected.')
  })

  it('closes when it is asked to', () => {
    const { onClose } = setup(scene('edit'))
    fireEvent.click(screen.getByRole('button', { name: 'Close the UV editor' }))
    expect(onClose).toHaveBeenCalled()
  })
})
