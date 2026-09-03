import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEW } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { SceneSidebar } from '@/scene/SceneSidebar'
import type { SceneDocument, SceneObject, Transform } from '@/scene/types'

/*
 * The panel is handed the values it draws and the callbacks it calls, so a case is three lines of
 * setup: a document with a two-metre cube in it, and whichever objects count as selected.
 */

const MESH_ID = 'mesh-cube'

function cube(id: string, name: string, transform: Partial<Transform> = {}): SceneObject {
  return {
    id,
    name,
    kind: 'mesh',
    collectionId: 'scene-collection',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...transform },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: MESH_ID },
    modifiers: [],
    materialSlots: [],
  }
}

function scene(objects: SceneObject[]): SceneDocument {
  return {
    version: 1,
    id: 'scene-test',
    name: 'Test scene',
    objects,
    meshes: { [MESH_ID]: boxMesh(2) },
    collections: [{ id: 'scene-collection', name: 'Scene Collection' }],
    materials: [],
    world: { color: '#3b3b3b', strength: 1 },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    view: structuredClone(DEFAULT_VIEW),
    units: { system: 'metric', scale: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

type SidebarProps = ComponentProps<typeof SceneSidebar>

function setup(overrides: Partial<SidebarProps> = {}) {
  const objects = overrides.document?.objects ?? [cube('a', 'Cube')]
  const document = overrides.document ?? scene(objects)
  const active = document.objects[0] ?? null
  const props: SidebarProps = {
    open: true,
    tab: 'item',
    onTab: vi.fn(),
    onClose: vi.fn(),
    document,
    selection: { objectIds: active ? [active.id] : [], activeObjectId: active?.id ?? null },
    activeObject: active,
    selectedObjects: active ? [active] : [],
    onUpdateObject: vi.fn(),
    onEditDocument: vi.fn(),
    onView: vi.fn(),
    toolParams: {},
    onToolParams: vi.fn(),
    onGestureStart: vi.fn(),
    onGestureEnd: vi.fn(),
    ...overrides,
  }
  const view = render(<SceneSidebar {...props} />)
  return { ...view, props }
}

/** Typing into a field and leaving it is what commits a number. */
function type(name: string, value: string): void {
  const field = screen.getByRole('textbox', { name })
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

afterEach(cleanup)

describe('SceneSidebar', () => {
  it('draws nothing at all while it is closed, so opening it moves no layout', () => {
    const { container } = setup({ open: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows where the active object is, how it is turned, and how big its own box is', () => {
    const object = cube('a', 'Cube', { position: [1, 2, 3], rotation: [0, 0, 45] })
    setup({ document: scene([object]), activeObject: object, selectedObjects: [object] })

    expect(screen.getByText('Cube')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Location X' })).toHaveValue('1.00')
    expect(screen.getByRole('textbox', { name: 'Location Z' })).toHaveValue('3.00')
    expect(screen.getByRole('textbox', { name: 'Rotation Z' })).toHaveValue('45')
    expect(screen.getByRole('textbox', { name: 'Scale X' })).toHaveValue('1.00')
    // Turning the cube does not make it bigger: a dimension is the object's own box, not the box it sweeps.
    expect(screen.getByRole('textbox', { name: 'Dimensions X' })).toHaveValue('2.00')
  })

  it('says the selection is empty rather than showing an empty transform', () => {
    setup({ activeObject: null, selectedObjects: [], selection: { objectIds: [], activeObjectId: null } })
    expect(screen.getByText(/select an object/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Location X' })).not.toBeInTheDocument()
  })

  it('writes a typed location back on to the active object, under its own history label', () => {
    const { props } = setup()
    type('Location X', '4')
    expect(props.onUpdateObject).toHaveBeenCalledWith(
      'a',
      { transform: { position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      'Location',
    )
  })

  it('reads “Mixed” where two selected objects disagree, and moves both from one field', () => {
    const first = cube('a', 'Cube')
    const second = cube('b', 'Cube.001', { position: [1, 0, 0] })
    const document = scene([first, second])
    const { props } = setup({
      document,
      activeObject: first,
      selectedObjects: [first, second],
      selection: { objectIds: ['a', 'b'], activeObjectId: 'a' },
    })

    expect(screen.getByRole('textbox', { name: 'Location X' })).toHaveAttribute('placeholder', 'Mixed')
    // They agree about Y, so that field shows the number rather than hiding it behind "Mixed".
    expect(screen.getByRole('textbox', { name: 'Location Y' })).toHaveValue('0.00')

    type('Location X', '5')
    expect(props.onEditDocument).toHaveBeenCalledTimes(1)
    const [edit, label] = vi.mocked(props.onEditDocument).mock.calls[0]!
    expect(label).toBe('Location')
    const next = edit(document)
    expect(next.objects.map((object) => object.transform.position[0])).toEqual([5, 5])
  })

  it('turns a typed dimension into the scale that produces it', () => {
    const { props } = setup()
    type('Dimensions X', '4')
    expect(props.onUpdateObject).toHaveBeenCalledWith(
      'a',
      { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] } },
      'Dimensions',
    )
  })

  it('leaves a flat axis alone: a plane has no thickness to scale', () => {
    const flat = cube('a', 'Plane', { scale: [1, 1, 0] })
    const { props } = setup({ document: scene([flat]), activeObject: flat, selectedObjects: [flat] })
    expect(screen.getByRole('textbox', { name: 'Dimensions Z' })).toHaveValue('0.00')
    type('Dimensions Z', '3')
    expect(props.onUpdateObject).toHaveBeenCalledWith(
      'a',
      { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 0] } },
      'Dimensions',
    )
  })

  it('locks an axis, and the locked field stops taking values', () => {
    setup()
    const lock = screen.getByRole('button', { name: 'Lock location X' })
    expect(lock).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('textbox', { name: 'Location X' })).toBeEnabled()

    fireEvent.click(lock)
    expect(lock).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'Location X' })).toBeDisabled()
    // A dimension is the scale seen in metres, so locking the scale locks the dimension with it.
    fireEvent.click(screen.getByRole('button', { name: 'Lock scale Y' }))
    expect(screen.getByRole('textbox', { name: 'Dimensions Y' })).toBeDisabled()
  })

  it('shows a quaternion rotation without pretending it can be typed', () => {
    const turned = cube('a', 'Cube', { rotationMode: 'quaternion', quaternion: [0, 0, 0.7071, 0.7071] })
    setup({ document: scene([turned]), activeObject: turned, selectedObjects: [turned] })
    expect(screen.getByRole('textbox', { name: 'Rotation W' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Rotation X' })).toBeDisabled()
  })

  it('carries the tool options, and turns the snapping on from the Tool tab', () => {
    const { props } = setup({ tab: 'tool' })
    expect(screen.getByRole('combobox', { name: 'Mode' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Orientation' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Pivot point' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Snap with' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Proportional editing' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Snap' }))
    expect(props.onView).toHaveBeenCalledWith({ snapEnabled: true })
  })

  it('changes the lens and moves the 3D cursor from the View tab', () => {
    const { props } = setup({ tab: 'view' })
    type('Focal length', '85')
    expect(props.onView).toHaveBeenCalledWith({ focalLength: 85 })

    type('3D cursor location Y', '2')
    const [edit, label] = vi.mocked(props.onEditDocument).mock.calls[0]!
    expect(label).toBe('Move the 3D cursor')
    expect(edit(props.document).cursor.position).toEqual([0, 2, 0])
    expect(screen.getByRole('switch', { name: 'Lock camera to view' })).toBeInTheDocument()
  })

  it('asks for another tab, and to be closed', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'View' }))
    expect(props.onTab).toHaveBeenCalledWith('view')
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})
