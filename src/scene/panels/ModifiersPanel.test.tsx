import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '@/scene/modifiers'
import { DEFAULT_MATERIAL, DEFAULT_VIEW, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { ModifiersPanel } from '@/scene/panels/ModifiersPanel'
import type { Modifier, SceneDocument, SceneObject } from '@/scene/types'

/**
 * The panel is tested against the real registry rather than a fake one: half of what it does is
 * generate itself from a module's declared schema, and a fake module would test the generation
 * against a shape no modifier has.
 */

const MESH_ID = 'mesh-1'

function object(id: string, name: string, overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    name,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: MESH_ID },
    modifiers: [],
    materialSlots: [DEFAULT_MATERIAL.id],
    ...overrides,
  }
}

function modifier(patch: Partial<Modifier> = {}): Modifier {
  return {
    id: 'modifier-1',
    kind: 'mirror',
    name: 'Mirror',
    enabled: { viewport: true, render: true, editMode: true, onCage: false },
    params: { axisX: true },
    ...patch,
  }
}

function scene(objects: SceneObject[]): SceneDocument {
  return {
    version: 1,
    id: 'scene-test',
    name: 'Test scene',
    objects,
    meshes: { [MESH_ID]: boxMesh(2) },
    collections: [{ id: ROOT_COLLECTION_ID, name: 'Scene Collection' }],
    materials: [{ ...DEFAULT_MATERIAL }],
    world: { color: '#3b3b3b', strength: 1 },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    view: structuredClone(DEFAULT_VIEW),
    units: { system: 'metric', scale: 1 },
    createdAt: '2026-09-03T08:00:00.000Z',
    updatedAt: '2026-09-03T08:00:00.000Z',
  }
}

function show(options: { objects?: SceneObject[]; active?: string | null; errors?: Array<{ modifierId: string; message: string }> } = {}) {
  const objects = options.objects ?? [object('object-1', 'Cube')]
  const document = scene(objects)
  const active = objects.find((entry) => entry.id === (options.active ?? objects[0]?.id)) ?? null
  const spies = {
    onUpdateObject: vi.fn(),
    onUpdateObjects: vi.fn(),
    onApply: vi.fn(),
    onApplyAsShapeKey: vi.fn(),
    onGestureStart: vi.fn(),
    onGestureEnd: vi.fn(),
    onSection: vi.fn(),
  }
  render(
    <ModifiersPanel
      document={document}
      activeObject={active}
      selectedObjects={objects}
      errors={options.errors ?? []}
      onUpdateObject={spies.onUpdateObject}
      onUpdateObjects={spies.onUpdateObjects}
      onApply={spies.onApply}
      onApplyAsShapeKey={spies.onApplyAsShapeKey}
      onGestureStart={spies.onGestureStart}
      onGestureEnd={spies.onGestureEnd}
      isOpen={() => true}
      onSection={spies.onSection}
    />,
  )
  return spies
}

/** The stack the panel would have written, from the one call it made. */
function written(spy: ReturnType<typeof vi.fn>): Modifier[] {
  return spy.mock.calls[0]?.[1]?.modifiers as Modifier[]
}

describe('the modifiers panel', () => {
  it('says what the tab is for when the stack is empty', () => {
    show()
    expect(screen.getByText(/No modifiers/)).toBeInTheDocument()
  })

  it('turns away an object that cannot take one', () => {
    const light = object('object-1', 'Light', { kind: 'light', data: {
        kind: 'light',
        light: 'point',
        color: '#ffffff',
        power: 100,
        radius: 0.1,
        spotAngle: 45,
        spotBlur: 0.15,
        areaShape: 'square',
        areaSize: [1, 1],
        shadow: true,
        distance: 0,
      } })
    show({ objects: [light] })
    expect(screen.getByText(/only meshes take modifiers/)).toBeInTheDocument()
  })

  it('offers every registered modifier under its category, and adds the one chosen', async () => {
    const user = userEvent.setup()
    const spies = show()
    await user.click(screen.getByRole('button', { name: 'Add modifier' }))
    const menu = screen.getByRole('menu', { name: 'Add modifier' })
    expect(within(menu).getByText('Generate')).toBeInTheDocument()
    expect(within(menu).getByText('Deform')).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Mirror' }))
    const stack = written(spies.onUpdateObject)
    expect(stack).toHaveLength(1)
    expect(stack[0]!.kind).toBe('mirror')
    expect(stack[0]!.enabled).toEqual({ viewport: true, render: true, editMode: true, onCage: false })
    // The defaults come from the module, so the panel's fields have something to show at once.
    expect(stack[0]!.params.axisX).toBe(true)
  })

  it('numbers a second modifier of the same name rather than repeating it', async () => {
    const user = userEvent.setup()
    const spies = show({ objects: [object('object-1', 'Cube', { modifiers: [modifier()] })] })
    await user.click(screen.getByRole('button', { name: 'Add modifier' }))
    await user.click(within(screen.getByRole('menu', { name: 'Add modifier' })).getByRole('menuitem', { name: 'Mirror' }))
    expect(written(spies.onUpdateObject)[1]!.name).toBe('Mirror.001')
  })

  it('switches a modifier off for the viewport without touching the rest', async () => {
    const user = userEvent.setup()
    const spies = show({ objects: [object('object-1', 'Cube', { modifiers: [modifier()] })] })
    await user.click(screen.getByRole('button', { name: 'Show Mirror in the viewport' }))
    expect(written(spies.onUpdateObject)[0]!.enabled).toEqual({ viewport: false, render: true, editMode: true, onCage: false })
  })

  it('generates a field for each declared parameter and writes what it is set to', async () => {
    const user = userEvent.setup()
    const spies = show({ objects: [object('object-1', 'Cube', { modifiers: [modifier()] })] })
    await user.click(screen.getByRole('switch', { name: 'Axis Y' }))
    expect(written(spies.onUpdateObject)[0]!.params.axisY).toBe(true)
  })

  it('fills an object input from the scene rather than from the schema', () => {
    const objects = [object('object-1', 'Cube', { modifiers: [modifier()] }), object('object-2', 'Empty')]
    show({ objects })
    const field = screen.getByRole('radiogroup', { name: 'Mirror object' })
    expect(within(field).getByRole('radio', { name: 'Empty' })).toBeInTheDocument()
    // The object it is on is not offered: a mirror about itself is the identity.
    expect(within(field).queryByRole('radio', { name: 'Cube' })).not.toBeInTheDocument()
  })

  it('reorders the stack from the menu', async () => {
    const user = userEvent.setup()
    const stack = [modifier(), modifier({ id: 'modifier-2', kind: 'subsurf', name: 'Subdivision' })]
    const spies = show({ objects: [object('object-1', 'Cube', { modifiers: stack })] })
    await user.click(screen.getByRole('button', { name: 'Subdivision actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }))
    expect(written(spies.onUpdateObject).map((entry) => entry.name)).toEqual(['Subdivision', 'Mirror'])
  })

  it('applies through the operator rather than editing the mesh itself', async () => {
    const user = userEvent.setup()
    const spies = show({ objects: [object('object-1', 'Cube', { modifiers: [modifier()] })] })
    await user.click(screen.getByRole('button', { name: 'Mirror actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Apply ⌃A' }))
    expect(spies.onApply).toHaveBeenCalledWith('modifier-1')
    expect(spies.onUpdateObject).not.toHaveBeenCalled()
  })

  it('offers Blender’s other apply: the modifier kept, and what it does stored as a shape key', async () => {
    const user = userEvent.setup()
    const spies = show({ objects: [object('object-1', 'Cube', { modifiers: [modifier()] })] })
    await user.click(screen.getByRole('button', { name: 'Mirror actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Apply as shape key' }))
    expect(spies.onApplyAsShapeKey).toHaveBeenCalledWith('modifier-1')
  })

  it('writes what a modifier refused to do under it', () => {
    show({
      objects: [object('object-1', 'Cube', { modifiers: [modifier()] })],
      errors: [{ modifierId: 'modifier-1', message: 'The mirror object this modifier names is not in the scene any more.' }],
    })
    expect(screen.getByRole('alert')).toHaveTextContent('not in the scene any more')
  })

  it('deletes the modifier the keyboard is in on ⌃X', async () => {
    const user = userEvent.setup()
    const stack = [modifier(), modifier({ id: 'modifier-2', kind: 'subsurf', name: 'Subdivision' })]
    const spies = show({ objects: [object('object-1', 'Cube', { modifiers: stack })] })
    screen.getByRole('button', { name: 'Show Subdivision in the viewport' }).focus()
    await user.keyboard('{Control>}x{/Control}')
    expect(written(spies.onUpdateObject).map((entry) => entry.name)).toEqual(['Mirror'])
  })
})
