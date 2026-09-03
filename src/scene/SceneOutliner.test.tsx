import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_MATERIAL, DEFAULT_UNITS, DEFAULT_VIEW, DEFAULT_WORLD, ROOT_COLLECTION_ID, ROOT_COLLECTION_NAME } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { SceneOutliner, type SceneOutlinerProps } from '@/scene/SceneOutliner'
import type { SceneDocument, SceneObject, SceneSelection } from '@/scene/types'

/*
 * The outliner is drawn from a document and a selection and answers with callbacks, so every test
 * here is: hand it a scene, do one thing to it, and read the callback. The fixture is the smallest
 * scene that still has all four shapes the tree has to fold — a nested collection, an object in it,
 * a parented object, and an object's own data rows.
 */

const ROW_HEIGHT = 30

function object(partial: Partial<SceneObject> & { id: string; name: string }): SceneObject {
  return {
    kind: 'empty',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'empty', display: 'plain-axes', size: 1 },
    modifiers: [],
    materialSlots: [],
    ...partial,
  }
}

function scene(): SceneDocument {
  return {
    version: 1,
    id: 'scene-1',
    name: 'Test scene',
    objects: [
      object({
        id: 'cube',
        name: 'Cube',
        kind: 'mesh',
        data: { kind: 'mesh', meshId: 'mesh-cube' },
        modifiers: [{ id: 'modifier-1', kind: 'bevel', name: 'Bevel', enabled: { viewport: true, render: true, editMode: false, onCage: false }, params: {} }],
        materialSlots: [DEFAULT_MATERIAL.id],
      }),
      object({ id: 'bolt', name: 'Bolt', parentId: 'cube' }),
      object({ id: 'light', name: 'Light', kind: 'light', data: { kind: 'light', light: 'point', color: '#ffffff', power: 1000, radius: 0.1, spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true } }),
      object({ id: 'crate', name: 'Crate', collectionId: 'props' }),
    ],
    meshes: { 'mesh-cube': boxMesh(2) },
    collections: [
      { id: ROOT_COLLECTION_ID, name: ROOT_COLLECTION_NAME },
      { id: 'props', name: 'Props' },
    ],
    materials: [{ ...DEFAULT_MATERIAL }],
    world: { ...DEFAULT_WORLD },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    view: structuredClone(DEFAULT_VIEW),
    units: { ...DEFAULT_UNITS },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

const NO_SELECTION: SceneSelection = { objectIds: [], activeObjectId: null }

type Handlers = Pick<SceneOutlinerProps,
  'onNavigate' | 'onSelect' | 'onRename' | 'onRenameCollection' | 'onReparent'
  | 'onUpdateObject' | 'onUpdateCollection' | 'onRunOperator' | 'onOpenTab'>

function handlers(): Handlers {
  return {
    onNavigate: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onRenameCollection: vi.fn(),
    onReparent: vi.fn(),
    onUpdateObject: vi.fn(),
    onUpdateCollection: vi.fn(),
    onRunOperator: vi.fn(),
    onOpenTab: vi.fn(),
  }
}

function renderOutliner(overrides: Partial<SceneOutlinerProps> = {}) {
  const calls = handlers()
  const props: SceneOutlinerProps = {
    document: scene(),
    selection: NO_SELECTION,
    compact: false,
    inert: false,
    ...calls,
    ...overrides,
  }
  const view = render(<MemoryRouter><SceneOutliner {...props} /></MemoryRouter>)
  return { ...view, ...calls, props }
}

const names = () => screen.getAllByRole('treeitem').map((row) => row.getAttribute('aria-label'))

/** jsdom measures nothing, so the rows are given the geometry the drop hit test reads. */
function layoutRows(): HTMLElement[] {
  const rows = screen.getAllByRole('treeitem')
  rows.forEach((row, index) => {
    const top = index * ROW_HEIGHT
    row.getBoundingClientRect = (): DOMRect => ({
      x: 0,
      y: top,
      top,
      bottom: top + ROW_HEIGHT,
      left: 0,
      right: 220,
      width: 220,
      height: ROW_HEIGHT,
      toJSON: () => ({}),
    })
  })
  return rows
}

const middleOf = (index: number) => index * ROW_HEIGHT + ROW_HEIGHT / 2

describe('SceneOutliner', () => {
  it('nests collections, their objects and an object under its parent', () => {
    renderOutliner()
    expect(names()).toEqual(['Scene Collection', 'Props', 'Crate', 'Cube', 'Light'])
    expect(screen.getByRole('treeitem', { name: 'Scene Collection' })).toHaveAttribute('aria-level', '1')
    expect(screen.getByRole('treeitem', { name: 'Crate' })).toHaveAttribute('aria-level', '3')

    // An object arrives folded, and unfolding shows its data before its children, as Blender does.
    fireEvent.click(screen.getByRole('button', { name: 'Expand Cube' }))
    expect(names()).toEqual(['Scene Collection', 'Props', 'Crate', 'Cube', 'Mesh', 'Bevel', 'Material', 'Bolt', 'Light'])
    expect(screen.getByRole('treeitem', { name: 'Bolt' })).toHaveAttribute('aria-level', '3')
  })

  it('opens the properties tab a data row belongs to, and selects the object that owns it', () => {
    const { onOpenTab, onSelect } = renderOutliner()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Cube' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Bevel' }))
    expect(onOpenTab).toHaveBeenCalledWith('modifiers')
    expect(onSelect).toHaveBeenCalledWith(['cube'], 'cube')
  })

  it('renames a row on double-click and commits it with Enter', () => {
    const { onRename } = renderOutliner()
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'Cube' }))
    const field = screen.getByRole('textbox', { name: 'Rename Cube' })
    fireEvent.change(field, { target: { value: 'Wheel' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('cube', 'Wheel')
  })

  it('renames a collection through the collection callback, not the object one', () => {
    const { onRename, onRenameCollection } = renderOutliner()
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'Props' }))
    const field = screen.getByRole('textbox', { name: 'Rename Props' })
    fireEvent.change(field, { target: { value: 'Set dressing' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRenameCollection).toHaveBeenCalledWith('props', 'Set dressing')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('opens the rename field on F2 and puts the name back on Escape', () => {
    const { onRename } = renderOutliner()
    const row = screen.getByRole('treeitem', { name: 'Cube' })
    fireEvent.keyDown(row, { key: 'F2' })
    const field = screen.getByRole('textbox', { name: 'Rename Cube' })
    fireEvent.change(field, { target: { value: 'Nonsense' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Rename Cube' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('treeitem', { name: 'Cube' })).getByText('Cube')).toBeInTheDocument()
  })

  it('turns each of the three switches into its own patch, without selecting the row', () => {
    const { onUpdateObject, onSelect } = renderOutliner()
    fireEvent.click(screen.getByRole('button', { name: 'Hide Cube' }))
    expect(onUpdateObject).toHaveBeenCalledWith('cube', { visible: false })
    fireEvent.click(screen.getByRole('button', { name: 'Make Cube unselectable' }))
    expect(onUpdateObject).toHaveBeenCalledWith('cube', { selectable: false })
    fireEvent.click(screen.getByRole('button', { name: 'Leave Cube out of renders' }))
    expect(onUpdateObject).toHaveBeenCalledWith('cube', { renderable: false })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('gives a collection row the eye, the exclusion checkbox and the selectability switch', () => {
    const { onUpdateCollection } = renderOutliner()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Props in the view' }))
    expect(onUpdateCollection).toHaveBeenCalledWith('props', { excluded: true })
    fireEvent.click(screen.getByRole('button', { name: 'Hide Props' }))
    expect(onUpdateCollection).toHaveBeenCalledWith('props', { hidden: true })
    fireEvent.click(screen.getByRole('button', { name: 'Make Props unselectable' }))
    expect(onUpdateCollection).toHaveBeenCalledWith('props', { selectable: false })
  })

  it('extends the selection over a range with shift, and toggles one row with the meta key', () => {
    const selection: SceneSelection = { objectIds: ['crate'], activeObjectId: 'crate' }
    const { onSelect } = renderOutliner({ selection })
    fireEvent.click(screen.getByRole('treeitem', { name: 'Light' }), { shiftKey: true })
    expect(onSelect).toHaveBeenCalledWith(['crate', 'cube', 'light'], 'light')

    fireEvent.click(screen.getByRole('treeitem', { name: 'Crate' }), { metaKey: true })
    expect(onSelect).toHaveBeenLastCalledWith([], null)
  })

  it('replaces the selection on a plain click', () => {
    const { onSelect } = renderOutliner({ selection: { objectIds: ['crate'], activeObjectId: 'crate' } })
    fireEvent.click(screen.getByRole('treeitem', { name: 'Light' }))
    expect(onSelect).toHaveBeenCalledWith(['light'], 'light')
  })

  it('keeps the ancestors of whatever the filter matches, folded or not', () => {
    renderOutliner()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter the outliner' }), { target: { value: 'bolt' } })
    expect(names()).toEqual(['Scene Collection', 'Cube', 'Bolt'])
  })

  it('says so when nothing matches the filter', () => {
    renderOutliner()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter the outliner' }), { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0)
    expect(screen.getByText(/Nothing here matches/)).toBeInTheDocument()
  })

  it('offers the outliner operators on the context menu of an object', async () => {
    const { onRunOperator, onSelect } = renderOutliner()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Cube' }))
    expect(await screen.findByRole('menuitem', { name: 'Select hierarchy' })).toBeInTheDocument()
    for (const label of ['Duplicate · ⇧D', 'Delete', 'Delete hierarchy', 'Rename · F2', 'Hide · H', 'New collection', 'Move to collection · M']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate · ⇧D' }))
    expect(onRunOperator).toHaveBeenCalledWith('object.duplicate')
    expect(onSelect).toHaveBeenCalledWith(['cube'], 'cube')
  })

  it('sends the hierarchy entries the ids under the row', async () => {
    const { onSelect, onRunOperator } = renderOutliner({ selection: { objectIds: ['cube'], activeObjectId: 'cube' } })
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Cube' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Select hierarchy' }))
    expect(onSelect).toHaveBeenCalledWith(['cube', 'bolt'], 'cube')

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Cube' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete hierarchy' }))
    expect(onRunOperator).toHaveBeenCalledWith('object.delete', { hierarchy: true })
  })

  it('walks the tree with the arrow keys and folds with the left one', () => {
    renderOutliner()
    const rows = screen.getAllByRole('treeitem')
    act(() => rows[0]?.focus())
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Props' }))

    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Props' }), { key: 'ArrowLeft' })
    expect(names()).toEqual(['Scene Collection', 'Props', 'Cube', 'Light'])

    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Props' }), { key: 'ArrowRight' })
    expect(names()).toEqual(['Scene Collection', 'Props', 'Crate', 'Cube', 'Light'])

    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Props' }), { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Light' }))

    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Light' }), { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Scene Collection' }))
  })

  it('selects the focused row with Enter, and only the focused row is tabbable', () => {
    const { onSelect } = renderOutliner()
    const cube = screen.getByRole('treeitem', { name: 'Cube' })
    expect(screen.getByRole('treeitem', { name: 'Scene Collection' })).toHaveAttribute('tabindex', '0')
    expect(cube).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(cube, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(['cube'], 'cube')
    expect(screen.getByRole('treeitem', { name: 'Cube' })).toHaveAttribute('tabindex', '0')
  })

  it('drops an object into a collection and says so while the pointer is over it', () => {
    const { onReparent } = renderOutliner()
    const rows = layoutRows()
    const cube = rows[3] as HTMLElement
    fireEvent.pointerDown(cube, { pointerId: 1, button: 0, clientX: 10, clientY: middleOf(3) })
    fireEvent.pointerMove(cube, { pointerId: 1, clientX: 10, clientY: middleOf(1) })
    expect(screen.getByRole('status')).toHaveTextContent('Move Cube into Props')
    fireEvent.pointerUp(cube, { pointerId: 1, clientX: 10, clientY: middleOf(1) })
    expect(onReparent).toHaveBeenCalledWith('cube', { collectionId: 'props', parentId: null }, false)
  })

  it('parents one object to another, keeping the transform when shift is held', () => {
    const { onReparent } = renderOutliner()
    const rows = layoutRows()
    const light = rows[4] as HTMLElement
    fireEvent.pointerDown(light, { pointerId: 2, button: 0, clientX: 10, clientY: middleOf(4) })
    fireEvent.pointerMove(light, { pointerId: 2, clientX: 10, clientY: middleOf(3), shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('Parent Light to Cube · keeping its transform')
    fireEvent.pointerUp(light, { pointerId: 2, clientX: 10, clientY: middleOf(3), shiftKey: true })
    expect(onReparent).toHaveBeenCalledWith('light', { parentId: 'cube' }, true)
  })

  it('drops above a row as a sibling of it, with the index it lands on', () => {
    const { onReparent } = renderOutliner()
    const rows = layoutRows()
    const crate = rows[2] as HTMLElement
    fireEvent.pointerDown(crate, { pointerId: 3, button: 0, clientX: 10, clientY: middleOf(2) })
    // The top eighth of the Light row: above it, not into it.
    fireEvent.pointerMove(crate, { pointerId: 3, clientX: 10, clientY: 4 * ROW_HEIGHT + 2 })
    fireEvent.pointerUp(crate, { pointerId: 3, clientX: 10, clientY: 4 * ROW_HEIGHT + 2 })
    expect(onReparent).toHaveBeenCalledWith('crate', { parentId: null, collectionId: ROOT_COLLECTION_ID, index: 1 }, false)
  })

  it('nests one collection inside another through the collection operator', () => {
    const document = scene()
    document.collections.push({ id: 'rigging', name: 'Rigging' })
    const { onRunOperator } = renderOutliner({ document })
    expect(names()).toEqual(['Scene Collection', 'Props', 'Crate', 'Rigging', 'Cube', 'Light'])
    const rows = layoutRows()
    const rigging = rows[3] as HTMLElement
    fireEvent.pointerDown(rigging, { pointerId: 7, button: 0, clientX: 10, clientY: middleOf(3) })
    fireEvent.pointerMove(rigging, { pointerId: 7, clientX: 10, clientY: middleOf(1) })
    fireEvent.pointerUp(rigging, { pointerId: 7, clientX: 10, clientY: middleOf(1) })
    expect(onRunOperator).toHaveBeenCalledWith('collection.nest', { collectionId: 'rigging', intoId: 'props' })
  })

  it('offers a collection its own entries, and refuses to delete the scene collection', async () => {
    const { onRunOperator } = renderOutliner()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Props' }))
    expect(await screen.findByRole('menuitem', { name: 'Select objects' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New collection' }))
    expect(onRunOperator).toHaveBeenCalledWith('collection.new', { parentId: 'props' })

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Props' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete collection' }))
    expect(onRunOperator).toHaveBeenCalledWith('collection.delete', { collectionId: 'props' })

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Scene Collection' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete collection' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('refuses to drop an object onto something below it in its own hierarchy', () => {
    const { onReparent } = renderOutliner()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Cube' }))
    const rows = layoutRows()
    const cube = rows[3] as HTMLElement
    const bolt = rows.findIndex((row) => row.getAttribute('aria-label') === 'Bolt')
    fireEvent.pointerDown(cube, { pointerId: 4, button: 0, clientX: 10, clientY: middleOf(3) })
    fireEvent.pointerMove(cube, { pointerId: 4, clientX: 10, clientY: middleOf(bolt) })
    fireEvent.pointerUp(cube, { pointerId: 4, clientX: 10, clientY: middleOf(bolt) })
    expect(onReparent).not.toHaveBeenCalled()
  })

  it('treats a two-pixel press as a click rather than a drag', () => {
    const { onReparent, onSelect } = renderOutliner()
    const rows = layoutRows()
    const cube = rows[3] as HTMLElement
    fireEvent.pointerDown(cube, { pointerId: 5, button: 0, clientX: 10, clientY: middleOf(3) })
    fireEvent.pointerMove(cube, { pointerId: 5, clientX: 12, clientY: middleOf(3) })
    fireEvent.pointerUp(cube, { pointerId: 5, clientX: 12, clientY: middleOf(3) })
    fireEvent.click(cube, { clientX: 12, clientY: middleOf(3) })
    expect(onReparent).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(['cube'], 'cube')
  })

  it('does not select the row the drag ended on', () => {
    const { onSelect } = renderOutliner()
    const rows = layoutRows()
    const cube = rows[3] as HTMLElement
    fireEvent.pointerDown(cube, { pointerId: 6, button: 0, clientX: 10, clientY: middleOf(3) })
    fireEvent.pointerMove(cube, { pointerId: 6, clientX: 10, clientY: middleOf(1) })
    fireEvent.pointerUp(cube, { pointerId: 6, clientX: 10, clientY: middleOf(1) })
    fireEvent.click(cube, { clientX: 10, clientY: middleOf(1) })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('unfolds and reveals an object selected somewhere else', () => {
    const { rerender, props } = renderOutliner()
    expect(screen.queryByRole('treeitem', { name: 'Bolt' })).not.toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <SceneOutliner {...props} selection={{ objectIds: ['bolt'], activeObjectId: 'bolt' }} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('treeitem', { name: 'Bolt' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows icons alone when the rail is compact', () => {
    renderOutliner({ compact: true })
    expect(screen.getByRole('treeitem', { name: 'Cube' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide Cube' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Filter the outliner' })).not.toBeInTheDocument()
  })
})
