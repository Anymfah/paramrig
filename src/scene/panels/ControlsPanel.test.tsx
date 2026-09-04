import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createSceneDocument, DEFAULT_MATERIAL, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { ControlsPanel } from '@/scene/panels/ControlsPanel'
import type { SceneRig } from '@/scene/rig'
import type { SceneDocument, SceneObject } from '@/scene/types'

/**
 * The Controls tab: what a rig's author sees of the rig they are building.
 *
 * The inspector itself is the workbench's and is tested there, so what is checked here is the part
 * this panel adds — the switch, the rows, and the menu that renames, moves and deletes.
 */

const MESH = 'mesh-1'

function object(): SceneObject {
  return {
    id: 'object-1',
    name: 'Cube',
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 1.5], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: MESH },
    modifiers: [],
    materialSlots: [DEFAULT_MATERIAL.id],
  }
}

const RIG: SceneRig = {
  groups: [{ id: 'main', label: 'Main' }, { id: 'shape', label: 'Shape' }],
  parameters: [{ kind: 'number', id: 'lift', label: 'Lift', group: 'main', min: 0, max: 4, step: 0.1, defaultValue: 1.5 }],
  bindings: [{ id: 'binding-1', objectId: 'object-1', property: 'transform.position.z', parameterId: 'lift' }],
}

function scene(rig?: SceneRig): SceneDocument {
  return {
    ...createSceneDocument(),
    objects: [object()],
    meshes: { [MESH]: boxMesh(2) },
    ...(rig ? { rig } : {}),
  }
}

function show(rig?: SceneRig, mode: 'edit' | 'tune' = 'edit') {
  const spies = {
    onMode: vi.fn(),
    onAddControl: vi.fn(),
    onRenameControl: vi.fn(),
    onMoveControl: vi.fn(),
    onRemoveControl: vi.fn(),
    onGoToBinding: vi.fn(),
    onSection: vi.fn(),
  }
  render(
    <ControlsPanel
      document={scene(rig)}
      session={null}
      mode={mode}
      isOpen={() => true}
      {...spies}
    />,
  )
  return spies
}

describe('the controls tab', () => {
  it('says how a rig is started when there is none', async () => {
    const spies = show()
    expect(screen.getByText(/Press the ◇ beside any field/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add control' }))
    expect(spies.onAddControl).toHaveBeenCalled()
  })

  it('names each control and what it drives', () => {
    show(RIG)
    expect(screen.getByText('Lift')).toBeTruthy()
    expect(screen.getByText('Cube · Location Z')).toBeTruthy()
  })

  it('says so when a control drives nothing yet', () => {
    show({ ...RIG, bindings: [] })
    expect(screen.getByText('Nothing yet')).toBeTruthy()
  })

  it('switches between building the rig and using it', async () => {
    const spies = show(RIG)
    await userEvent.click(screen.getByRole('button', { name: 'Tune' }))
    expect(spies.onMode).toHaveBeenCalledWith('tune')
  })

  it('renames a control from its menu', async () => {
    const spies = show(RIG)
    await userEvent.click(screen.getByRole('button', { name: 'Lift actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByLabelText('Rename Lift')
    await userEvent.clear(input)
    await userEvent.type(input, 'Height{Enter}')
    expect(spies.onRenameControl).toHaveBeenCalledWith('lift', 'Height')
  })

  it('moves it to another group, and only offers the others', async () => {
    const spies = show(RIG)
    await userEvent.click(screen.getByRole('button', { name: 'Lift actions' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Main' })).toBeNull()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Shape' }))
    expect(spies.onMoveControl).toHaveBeenCalledWith('lift', 'shape')
  })

  it('goes to what it drives, and cannot when it drives nothing', async () => {
    const spies = show(RIG)
    await userEvent.click(screen.getByRole('button', { name: 'Lift actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Go to what it drives' }))
    expect(spies.onGoToBinding).toHaveBeenCalledWith('lift')
  })

  it('deletes one', async () => {
    const spies = show(RIG)
    await userEvent.click(screen.getByRole('button', { name: 'Lift actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(spies.onRemoveControl).toHaveBeenCalledWith('lift')
  })

  it('hands a dragged control the id a field listens for', () => {
    show(RIG)
    const name = screen.getByText('Lift')
    expect(name.getAttribute('draggable')).toBe('true')
  })
})
