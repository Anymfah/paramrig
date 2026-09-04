import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '@/scene/modifiers'
import { createSceneDocument, DEFAULT_MATERIAL, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { SceneExposeContext, type SceneExposeContextValue } from '@/scene/exposeContext'
import { Exposable } from '@/scene/SceneExpose'
import type { SceneDocument, SceneObject } from '@/scene/types'

/**
 * The diamond, tested through what a person does with it: press it, fill the popover, press Expose.
 *
 * What comes back is a request, not a document — the page turns it into one — so the test asserts on
 * the request, which is the whole of the contract between a field and the rig.
 */

const MESH = 'mesh-1'

function object(patch: Partial<SceneObject> = {}): SceneObject {
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
    ...patch,
  }
}

function scene(objects: SceneObject[] = [object()]): SceneDocument {
  return { ...createSceneDocument(), objects, meshes: { [MESH]: boxMesh(2) } }
}

function show(options: {
  document?: SceneDocument
  property?: string
  objectId?: string
  bindings?: SceneExposeContextValue['bindings']
  parameters?: SceneExposeContextValue['parameters']
  groups?: SceneExposeContextValue['groups']
  provider?: boolean
} = {}) {
  const spies = {
    onExpose: vi.fn(),
    onUnbind: vi.fn(),
    onGoToControl: vi.fn(),
    onDropParameter: vi.fn(),
  }
  const context: SceneExposeContextValue = {
    document: options.document ?? scene(),
    groups: options.groups ?? [{ id: 'main', label: 'Main' }],
    parameters: options.parameters ?? [],
    bindings: options.bindings ?? [],
    ...spies,
  }
  const field = (
    <Exposable property={options.property ?? 'transform.position.z'} objectId={options.objectId ?? 'object-1'}>
      <input aria-label="Z" defaultValue="1.5" />
    </Exposable>
  )
  render(options.provider === false ? field : (
    <SceneExposeContext.Provider value={context}>{field}</SceneExposeContext.Provider>
  ))
  return spies
}

describe('the diamond beside a field', () => {
  it('draws the field alone when nothing provides a rig', () => {
    show({ provider: false })
    expect(screen.getByLabelText('Z')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws nothing extra for a property that cannot be driven', () => {
    show({ property: 'transform.wobble' })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws nothing for an object property with no object', () => {
    render(
      <SceneExposeContext.Provider value={{
        document: scene(), groups: [], parameters: [], bindings: [],
        onExpose: vi.fn(), onUnbind: vi.fn(), onGoToControl: vi.fn(),
      }}>
        <Exposable property="transform.position.z"><input aria-label="Z" /></Exposable>
      </SceneExposeContext.Provider>,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('asks for a control named after the field it is beside', async () => {
    const spies = show()
    await userEvent.click(screen.getByRole('button', { name: /Expose/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Expose' }))
    expect(spies.onExpose).toHaveBeenCalledWith(expect.objectContaining({
      objectId: 'object-1',
      property: 'transform.position.z',
      label: 'Cube · Location Z',
      group: 'main',
    }))
  })

  it('carries the range a person typed', async () => {
    const spies = show()
    await userEvent.click(screen.getByRole('button', { name: /Expose/ }))
    const max = screen.getByLabelText('Max')
    await userEvent.clear(max)
    await userEvent.type(max, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Expose' }))
    expect(spies.onExpose).toHaveBeenCalledWith(expect.objectContaining({ max: 4 }))
  })

  it('offers a switch, not a number, for a property that is one', async () => {
    show({ property: 'visible' })
    await userEvent.click(screen.getByRole('button', { name: /Expose/ }))
    expect(screen.getByText('switch')).toBeTruthy()
    expect(screen.queryByLabelText('Min')).toBeNull()
  })

  it('takes the bounds a modifier declares', async () => {
    const subdivided = object({
      modifiers: [{
        id: 'modifier-1',
        kind: 'subsurf',
        name: 'Subdivision',
        enabled: { viewport: true, render: true, editMode: true, onCage: false },
        params: { levels: 2 },
      }],
    })
    show({ document: scene([subdivided]), property: 'modifiers[modifier-1].levels' })
    await userEvent.click(screen.getByRole('button', { name: /Expose/ }))
    // The field prints itself to the popover's own step, so the value reads 6.0 rather than 6.
    expect(screen.getByLabelText('Max')).toHaveValue('6.0')
  })

  it('says which control drives it, and unbinds', async () => {
    const spies = show({
      parameters: [{ kind: 'number', id: 'lift', label: 'Lift', group: 'main', min: 0, max: 4, step: 0.1, defaultValue: 1 }],
      bindings: [{ id: 'binding-1', objectId: 'object-1', property: 'transform.position.z', parameterId: 'lift' }],
    })
    const diamond = screen.getByRole('button', { name: /driven by Lift/ })
    await userEvent.click(diamond)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unbind' }))
    expect(spies.onUnbind).toHaveBeenCalledWith(expect.objectContaining({ id: 'binding-1' }))
  })

  it('binds a control that is dropped on it', () => {
    const spies = show()
    const field = document.querySelector('.scene-exposable')!
    const data = new Map<string, string>([['application/x-paramrig-parameter', 'lift']])
    const dataTransfer = {
      types: [...data.keys()],
      getData: (type: string) => data.get(type) ?? '',
      dropEffect: '',
    }
    const drop = new Event('drop', { bubbles: true })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    field.dispatchEvent(drop)
    expect(spies.onDropParameter).toHaveBeenCalledWith('lift', { objectId: 'object-1', property: 'transform.position.z' })
  })
})
