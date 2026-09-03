import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MATERIAL, DEFAULT_VIEW, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { MaterialPanel } from '@/scene/panels/MaterialPanel'
import type { EditorMode, Material, SceneDocument, SceneObject } from '@/scene/types'

/**
 * The panel is a view of the slots and a writer of operator calls: what it must not do is edit the
 * mesh itself, and what it must do is only offer Assign while a mesh is open for editing.
 */

const MESH_ID = 'mesh-1'

function object(slots: string[]): SceneObject {
  return {
    id: 'object-1',
    name: 'Cube',
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: MESH_ID },
    modifiers: [],
    materialSlots: slots,
  }
}

function material(id: string, name: string, baseColor = '#cccccc'): Material {
  return { ...DEFAULT_MATERIAL, id, name, baseColor }
}

function scene(materials: Material[], objects: SceneObject[]): SceneDocument {
  return {
    version: 1,
    id: 'scene-test',
    name: 'Test scene',
    objects,
    meshes: { [MESH_ID]: boxMesh(2) },
    collections: [{ id: ROOT_COLLECTION_ID, name: 'Scene Collection' }],
    materials,
    world: { color: '#3b3b3b', strength: 1 },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    view: structuredClone(DEFAULT_VIEW),
    units: { system: 'metric', scale: 1 },
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-04T08:00:00.000Z',
  }
}

function show(options: { mode?: EditorMode; slots?: string[]; activeSlot?: number; materials?: Material[]; objects?: SceneObject[] } = {}) {
  const materials = options.materials ?? [material('material-a', 'Red', '#ff0000'), material('material-b', 'Blue', '#0000ff')]
  const objects = options.objects ?? [object(options.slots ?? ['material-a', 'material-b'])]
  const spies = {
    onActiveSlot: vi.fn(),
    onUpdateObject: vi.fn(),
    onEditDocument: vi.fn(),
    onRunOperator: vi.fn(),
    onGestureStart: vi.fn(),
    onGestureEnd: vi.fn(),
    onSection: vi.fn(),
  }
  render(
    <MaterialPanel
      document={scene(materials, objects)}
      activeObject={objects[0] ?? null}
      mode={options.mode ?? 'object'}
      activeSlot={options.activeSlot ?? 0}
      onActiveSlot={spies.onActiveSlot}
      onUpdateObject={spies.onUpdateObject}
      onEditDocument={spies.onEditDocument}
      onRunOperator={spies.onRunOperator}
      onGestureStart={spies.onGestureStart}
      onGestureEnd={spies.onGestureEnd}
      isOpen={() => true}
      onSection={spies.onSection}
    />,
  )
  return spies
}

/** The document the panel's edit would produce, from the callback it passed up. */
function edited(spy: ReturnType<typeof vi.fn>, document: SceneDocument): SceneDocument {
  const edit = spy.mock.calls[0]?.[0] as (current: SceneDocument) => SceneDocument
  return edit(document)
}

describe('the material panel', () => {
  it('lists the object’s slots and marks the active one', () => {
    show({ activeSlot: 1 })
    const list = screen.getByRole('listbox', { name: 'Material slots' })
    const rows = within(list).getAllByRole('option')
    expect(rows.map((row) => row.textContent)).toEqual(['Red', 'Blue'])
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('changes the active slot rather than the document when a row is clicked', async () => {
    const user = userEvent.setup()
    const spies = show()
    await user.click(screen.getByRole('option', { name: 'Blue' }))
    expect(spies.onActiveSlot).toHaveBeenCalledWith(1)
    expect(spies.onEditDocument).not.toHaveBeenCalled()
  })

  it('runs an operator for every slot action, and edits no mesh itself', async () => {
    const user = userEvent.setup()
    const spies = show()
    await user.click(screen.getByRole('button', { name: 'Add material slot' }))
    await user.click(screen.getByRole('button', { name: 'Remove material slot' }))
    expect(spies.onRunOperator.mock.calls.map((call) => call[0])).toEqual(['material.addSlot', 'material.removeSlot'])
  })

  it('offers Assign, Select and Deselect only while a mesh is open for editing', () => {
    show({ mode: 'object' })
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument()
  })

  it('offers them in edit mode, and runs them as operators', async () => {
    const user = userEvent.setup()
    const spies = show({ mode: 'edit' })
    await user.click(screen.getByRole('button', { name: 'Assign' }))
    await user.click(screen.getByRole('button', { name: 'Select' }))
    expect(spies.onRunOperator.mock.calls.map((call) => call[0])).toEqual(['material.assign', 'material.select'])
  })

  it('writes a changed colour into the material, not into the object', async () => {
    const user = userEvent.setup()
    const document = scene([material('material-a', 'Red', '#ff0000')], [object(['material-a'])])
    const spies = show({ materials: [material('material-a', 'Red', '#ff0000')], slots: ['material-a'] })
    const field = screen.getByLabelText('Base colour')
    await user.clear(field)
    await user.type(field, '#123456{Enter}')
    expect(spies.onEditDocument).toHaveBeenCalled()
    expect(edited(spies.onEditDocument, document).materials[0]!.baseColor).toBe('#123456')
    expect(spies.onUpdateObject).not.toHaveBeenCalled()
  })

  it('says how many objects a material is shared by, before a change surprises anyone', () => {
    const shared = [object(['material-a']), { ...object(['material-a']), id: 'object-2', name: 'Cube.001' }]
    show({ objects: shared, slots: ['material-a'] })
    expect(screen.getByText(/Used by 2 objects/)).toBeInTheDocument()
  })

  it('points the slot at another material through the object rather than the document', async () => {
    const user = userEvent.setup()
    const spies = show()
    await user.click(screen.getByRole('radio', { name: 'Blue' }))
    expect(spies.onUpdateObject).toHaveBeenCalledWith(
      'object-1',
      { materialSlots: ['material-b', 'material-b'] },
      'Material slot',
    )
  })
})
