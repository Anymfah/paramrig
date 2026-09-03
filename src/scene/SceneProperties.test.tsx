import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { HistoryStep } from '@/editor/history'
import { DEFAULT_MATERIAL, DEFAULT_VIEW, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import type { PropertiesTab } from '@/scene/prefs'
import { SceneProperties } from '@/scene/SceneProperties'
import type { SceneDocument, SceneObject, SceneVersion } from '@/scene/types'

const MESH_ID = 'mesh-1'

function cube(id: string, name: string, overrides: Partial<SceneObject> = {}): SceneObject {
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

function camera(id: string, name: string, active: boolean): SceneObject {
  return {
    id,
    name,
    kind: 'camera',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'camera', projection: 'perspective', focalLength: 50, sensor: 36, orthoScale: 6, clipStart: 0.1, clipEnd: 100, active },
    modifiers: [],
    materialSlots: [],
  }
}

function sceneWith(objects: SceneObject[]): SceneDocument {
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

function show(options: {
  objects?: SceneObject[]
  selected?: string[]
  active?: string | null
  tab?: PropertiesTab
  steps?: HistoryStep[]
  index?: number
  versions?: SceneVersion[]
} = {}) {
  const objects = options.objects ?? [cube('object-1', 'Cube')]
  const document = sceneWith(objects)
  const selectedIds = options.selected ?? objects.map((object) => object.id)
  const selectedObjects = objects.filter((object) => selectedIds.includes(object.id))
  const activeId = options.active === undefined ? selectedObjects[0]?.id ?? null : options.active
  const spies = {
    onTab: vi.fn(),
    onUpdateObject: vi.fn(),
    onUpdateObjects: vi.fn(),
    onEditDocument: vi.fn(),
    onGestureStart: vi.fn(),
    onGestureEnd: vi.fn(),
    onSection: vi.fn(),
    onGoTo: vi.fn(),
    onRestoreVersion: vi.fn(),
    onDeleteVersion: vi.fn(),
    onSaveVersion: vi.fn(),
  }
  render(
    <SceneProperties
      document={document}
      selection={{ objectIds: selectedIds, activeObjectId: activeId }}
      selectedObjects={selectedObjects}
      activeObject={objects.find((object) => object.id === activeId) ?? null}
      tab={options.tab ?? 'object'}
      onTab={spies.onTab}
      onUpdateObject={spies.onUpdateObject}
      onUpdateObjects={spies.onUpdateObjects}
      onEditDocument={spies.onEditDocument}
      onGestureStart={spies.onGestureStart}
      onGestureEnd={spies.onGestureEnd}
      isOpen={() => true}
      onSection={spies.onSection}
      history={{
        steps: options.steps ?? [],
        index: options.index ?? 0,
        onGoTo: spies.onGoTo,
        versions: options.versions ?? [],
        onRestoreVersion: spies.onRestoreVersion,
        onDeleteVersion: spies.onDeleteVersion,
        onSaveVersion: spies.onSaveVersion,
      }}
    />,
  )
  return { ...spies, document }
}

/** The one field of one axis of one channel, since X appears four times in the Object tab. */
function axisField(channel: string, axis: 'X' | 'Y' | 'Z'): HTMLInputElement {
  const group = screen.getByRole('group', { name: channel })
  return within(group).getByLabelText(axis)
}

async function typeInto(field: HTMLInputElement, text: string) {
  const user = userEvent.setup()
  await user.clear(field)
  await user.type(field, `${text}{Enter}`)
}

describe('the properties editor by context', () => {
  it('says what to do when nothing is selected', () => {
    show({ selected: [], active: null })
    expect(screen.getByText('No object selected. Click one in the viewport, or pick it in the outliner.')).toBeInTheDocument()
  })

  it('shows one object its transform, and writes what is typed into a field', async () => {
    const object = cube('object-1', 'Cube', { transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } })
    const { onUpdateObject } = show({ objects: [object] })

    expect(axisField('Location', 'X')).toHaveValue('1.00')
    expect(axisField('Location', 'Z')).toHaveValue('3.00')

    await typeInto(axisField('Location', 'X'), '4')

    expect(onUpdateObject).toHaveBeenCalledWith(
      'object-1',
      { transform: { position: [4, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      'Move',
    )
  })

  it('reads Mixed where two objects disagree, and sets both when one is typed into', async () => {
    const first = cube('object-1', 'Cube', { transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } })
    const second = cube('object-2', 'Cube.001', { transform: { position: [5, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } })
    const { onUpdateObjects } = show({ objects: [first, second] })

    expect(axisField('Location', 'X')).toHaveAttribute('placeholder', 'Mixed')
    expect(axisField('Location', 'X')).toHaveValue('')
    // The axis they agree on is not mixed, so it still reads its number.
    expect(axisField('Location', 'Y')).toHaveValue('2.00')

    await typeInto(axisField('Location', 'X'), '7')

    expect(onUpdateObjects).toHaveBeenCalledWith(
      [
        { id: 'object-1', patch: { transform: { position: [7, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } } },
        { id: 'object-2', patch: { transform: { position: [7, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } } },
      ],
      'Move 2 objects',
    )
  })

  it('changes the scale when a dimension is typed, and leaves the mesh alone', async () => {
    const { onUpdateObject, onEditDocument, document } = show()
    const before = JSON.stringify(document.meshes[MESH_ID])

    // A two-metre cube at scale one measures two metres.
    expect(axisField('Dimensions', 'X')).toHaveValue('2.00')

    await typeInto(axisField('Dimensions', 'X'), '4')

    expect(onUpdateObject).toHaveBeenCalledWith(
      'object-1',
      { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] } },
      'Resize',
    )
    expect(onEditDocument).not.toHaveBeenCalled()
    expect(JSON.stringify(document.meshes[MESH_ID])).toBe(before)
  })

  it('keeps the sign of a mirrored scale when a dimension is typed', async () => {
    const object = cube('object-1', 'Cube', { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [-1, 1, 1] } })
    const { onUpdateObject } = show({ objects: [object] })

    expect(axisField('Dimensions', 'X')).toHaveValue('2.00')
    await typeInto(axisField('Dimensions', 'X'), '3')

    expect(onUpdateObject).toHaveBeenCalledWith(
      'object-1',
      { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [-1.5, 1, 1] } },
      'Resize',
    )
  })

  it('locks an axis out of reach and back again', async () => {
    const user = userEvent.setup()
    show()
    expect(axisField('Location', 'X')).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Lock location X' }))
    expect(axisField('Location', 'X')).toBeDisabled()
    expect(axisField('Location', 'Y')).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Lock location X' }))
    expect(axisField('Location', 'X')).toBeEnabled()
  })

  it('turns a visibility switch off for the whole selection', async () => {
    const user = userEvent.setup()
    const { onUpdateObjects } = show({ objects: [cube('object-1', 'Cube'), cube('object-2', 'Cube.001')] })

    await user.click(screen.getByRole('switch', { name: 'Show in viewport' }))

    expect(onUpdateObjects).toHaveBeenCalledWith(
      [{ id: 'object-1', patch: { visible: false } }, { id: 'object-2', patch: { visible: false } }],
      'Hide 2 objects',
    )
  })
})

describe('the tabs', () => {
  it('moves to another tab when one is clicked', async () => {
    const user = userEvent.setup()
    const { onTab } = show()
    await user.click(screen.getByRole('tab', { name: 'Data' }))
    expect(onTab).toHaveBeenCalledWith('data')
  })

  it('walks the strip with the arrow keys', async () => {
    const user = userEvent.setup()
    const { onTab } = show({ tab: 'scene' })
    screen.getByRole('tab', { name: 'Scene' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(onTab).toHaveBeenCalledWith('world')
  })

  it('says what the tabs that are not written yet are waiting for', () => {
    show({ tab: 'modifiers' })
    expect(screen.getByText('No modifiers. They arrive with the modifier prompt.')).toBeInTheDocument()
  })

  it('says what the Controls tab is for before a rig exists', () => {
    show({ tab: 'controls' })
    expect(screen.getByText(/No controls yet\./)).toBeInTheDocument()
  })
})

describe('the scene, world and data tabs', () => {
  it('edits the document when the unit scale is typed', async () => {
    const { onEditDocument } = show({ tab: 'scene' })
    await typeInto(screen.getByLabelText('Unit scale'), '2')
    expect(onEditDocument).toHaveBeenCalledWith(expect.any(Function), 'Unit scale')
  })

  it('makes another camera the active one, and clears the one that was', async () => {
    const user = userEvent.setup()
    const objects = [camera('camera-1', 'Camera', true), camera('camera-2', 'Camera.001', false)]
    const { onEditDocument, document } = show({ objects, tab: 'scene', selected: [] })

    const cameras = screen.getByRole('radiogroup', { name: 'Active camera' })
    await user.click(within(cameras).getByRole('radio', { name: 'Camera.001' }))

    const edit = onEditDocument.mock.calls[0]?.[0] as (current: SceneDocument) => SceneDocument
    const next = edit(document)
    expect(next.objects.map((object) => object.data.kind === 'camera' && object.data.active === true)).toEqual([false, true])
  })

  it('reads out the mesh counts without offering to change them', () => {
    show({ tab: 'data' })
    const mesh = window.document.querySelector('[data-section="data-mesh"]')
    expect(mesh?.textContent).toContain('Vertices')
    expect(mesh?.textContent).toContain('8')
    expect(screen.getByRole('switch', { name: 'Auto smooth' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('edits a light where it is editable', async () => {
    const light: SceneObject = {
      ...cube('object-1', 'Light'),
      kind: 'light',
      data: { kind: 'light', light: 'point', color: '#ffffff', power: 1000, radius: 0.1, spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true },
    }
    const { onUpdateObject } = show({ objects: [light], tab: 'data' })

    await typeInto(screen.getByLabelText('Power'), '500')

    expect(onUpdateObject).toHaveBeenCalledWith(
      'object-1',
      { data: expect.objectContaining({ kind: 'light', power: 500 }) },
      'Light power',
    )
  })
})

describe('the history tab', () => {
  const steps: HistoryStep[] = [
    { index: 0, label: 'Opened', at: 1_756_886_400_000 },
    { index: 1, label: 'Move', at: 1_756_886_460_000 },
    { index: 2, label: 'Scale', at: 1_756_886_520_000 },
  ]

  it('marks the step the document is standing on', () => {
    show({ tab: 'history', steps, index: 1 })
    const list = screen.getByRole('list', { name: 'History steps' })
    const buttons = within(list).getAllByRole('button')
    // Newest first, so the step that has been undone is at the top.
    expect(buttons.map((button) => button.getAttribute('data-step'))).toEqual(['2', '1', '0'])
    expect(buttons[1]).toHaveAttribute('aria-current', 'true')
    expect(buttons[0]).toHaveAttribute('data-undone', 'true')
  })

  it('travels to a step when it is clicked', async () => {
    const user = userEvent.setup()
    const { onGoTo } = show({ tab: 'history', steps, index: 2 })
    await user.click(screen.getByRole('button', { name: /Opened/ }))
    expect(onGoTo).toHaveBeenCalledWith(0)
  })

  it('saves a named version and offers to restore or drop one', async () => {
    const user = userEvent.setup()
    const versions: SceneVersion[] = [
      { id: 'version-1', name: 'Blocked out', createdAt: '2026-09-03T08:02:00.000Z', objects: [], meshes: {}, collections: [], materials: [] },
    ]
    const { onSaveVersion, onRestoreVersion, onDeleteVersion } = show({ tab: 'history', steps, index: 2, versions })

    await user.type(screen.getByLabelText('Version name'), 'Before the bevel')
    await user.click(screen.getByRole('button', { name: 'Save version' }))
    expect(onSaveVersion).toHaveBeenCalledWith('Before the bevel')

    await user.click(screen.getByRole('button', { name: 'Restore' }))
    expect(onRestoreVersion).toHaveBeenCalledWith('version-1')

    await user.click(screen.getByRole('button', { name: 'Delete version Blocked out' }))
    expect(onDeleteVersion).toHaveBeenCalledWith('version-1')
  })
})
