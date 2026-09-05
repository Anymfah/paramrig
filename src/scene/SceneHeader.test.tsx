import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneDocument } from '@/scene/document'
import type { OperatorContext } from '@/scene/operators/types'
import { SceneHeader } from '@/scene/SceneHeader'
import { EMPTY_SELECTION, type EditorMode, type SceneSelection, type ViewState } from '@/scene/types'
import '@/scene/operators'

/*
 * The header is generated, not written out, so these tests are about the generation: that the ids
 * declared in the file reach the registry, that what the registry refuses stays visible and says
 * why, and that every control on the right writes the view rather than the document.
 */

function renderHeader(options: { mode?: EditorMode; view?: Partial<ViewState>; selection?: SceneSelection } = {}) {
  const scene = createSceneDocument('Header')
  const view: ViewState = { ...scene.view, mode: options.mode ?? 'object', ...options.view }
  const selection = options.selection ?? EMPTY_SELECTION
  const context: OperatorContext = {
    document: { ...scene, view },
    selection,
    mode: view.mode,
    view,
    cursor: scene.cursor,
    active: scene.objects.find((object) => object.id === selection.activeObjectId) ?? null,
  }
  const onRunOperator = vi.fn()
  const onView = vi.fn()
  const onMode = vi.fn()
  const onCommand = vi.fn()
  const rendered = render(headerElement({ view, context, onRunOperator, onView, onMode, onCommand }))
  return { ...rendered, headerElement, onRunOperator, onView, onMode, onCommand, scene, view }
}

/** The header as an element, so a test can hand the same mounted one a different mode. */
function headerElement({ view, context, onRunOperator, onView, onMode, onCommand }: {
  view: ViewState
  context: OperatorContext
  onRunOperator: (id: string) => void
  onView: (patch: Partial<ViewState>) => void
  onMode: (mode: EditorMode) => void
  onCommand: (id: string) => void
}) {
  return (
    <SceneHeader
      view={view}
      mode={view.mode}
      context={context}
      onRunOperator={onRunOperator}
      onView={onView}
      onMode={onMode}
      onCommand={onCommand}
    />
  )
}

function openMenu(name: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.getByRole('menu', { name })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the scene editor header', () => {
  it('is one toolbar with a single tab stop that the arrows walk', () => {
    renderHeader()
    const bar = screen.getByRole('toolbar', { name: 'Scene tools' })
    const buttons = within(bar).getAllByRole('button')

    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1)

    const first = screen.getByRole('button', { name: 'Object mode' })
    first.focus()
    // The mode, then straight to View: the Edit menu moved to the topbar, beside File.
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: 'View' })).toHaveFocus()
  })

  it('names the menus of the mode it is in', () => {
    renderHeader()

    for (const name of ['View', 'Select', 'Add', 'Object']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    for (const name of ['Mesh', 'Vertex', 'Edge', 'Face']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('swaps the menus and offers the three element modes in edit mode', () => {
    renderHeader({ mode: 'edit' })

    for (const name of ['Mesh', 'Vertex', 'Edge', 'Face']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vertex select' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Face select' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('runs the operator a menu entry stands for', () => {
    const { onRunOperator } = renderHeader()
    const menu = openMenu('Select')

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'All A' }))
    expect(onRunOperator).toHaveBeenCalledWith('select.all')
    expect(screen.queryByRole('menu', { name: 'Select' })).not.toBeInTheDocument()
  })

  it('keeps an entry it cannot run visible and greyed, with the reason in its tooltip', async () => {
    const user = userEvent.setup()
    const { onRunOperator } = renderHeader()
    const menu = openMenu('Select')
    const refused = within(menu).getByRole('menuitem', { name: 'None ⌥A' })

    expect(refused).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(refused)
    expect(onRunOperator).not.toHaveBeenCalled()

    await user.hover(refused)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nothing is selected.')
  })

  it('filters an open menu as the letters arrive, and runs what Enter lands on', () => {
    const { onRunOperator } = renderHeader()
    const menu = openMenu('View')

    for (const letter of ['f', 'r', 'a', 'm', 'e']) fireEvent.keyDown(menu, { key: letter })

    const left = within(menu).getAllByRole('menuitem').map((entry) => entry.textContent)
    expect(left).toEqual(['Frame selected Numpad .', 'Frame all Home'])

    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onRunOperator).toHaveBeenCalledWith('view.frameSelected')
  })

  it('walks a filtered menu with the arrows and takes back a letter with Backspace', () => {
    const { onRunOperator } = renderHeader()
    const menu = openMenu('View')

    for (const letter of ['f', 'r', 'a', 'm', 'e', 'x']) fireEvent.keyDown(menu, { key: letter })
    expect(within(menu).queryAllByRole('menuitem')).toHaveLength(0)
    expect(within(menu).getByText('Nothing here matches that.')).toBeInTheDocument()

    fireEvent.keyDown(menu, { key: 'Backspace' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onRunOperator).toHaveBeenCalledWith('view.frameAll')
  })

  /*
   * The panel is measured before it is shown, and is transparent until it has been placed. If the
   * placing and the clearing ever fought each other the menu would open invisible, which no query
   * in these tests would notice — hence this one, which watches the mark that says it was placed.
   */
  it('places a menu before showing it, and opens the second time with the filter cleared', () => {
    renderHeader()
    const menu = openMenu('View')
    expect(menu).toHaveAttribute('data-placed')

    for (const letter of ['f', 'r', 'a']) fireEvent.keyDown(menu, { key: letter })
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)
    fireEvent.keyDown(menu, { key: 'Escape' })

    const again = openMenu('View')
    expect(again).toHaveAttribute('data-placed')
    expect(within(again).queryByText('Filter')).not.toBeInTheDocument()
    expect(within(again).getAllByRole('menuitem').length).toBeGreaterThan(2)
  })

  it('closes a menu with Escape and gives the keyboard back to its button', async () => {
    renderHeader()
    const trigger = screen.getByRole('button', { name: 'View' })
    const menu = openMenu('View')

    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'View' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('offers the three modes and marks the one in use', () => {
    const { onMode } = renderHeader()
    const menu = openMenu('Object mode')

    expect(within(menu).getByRole('menuitemradio', { name: /Object mode/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Sculpt mode' }))
    expect(onMode).toHaveBeenCalledWith('sculpt')

    fireEvent.click(within(openMenu('Object mode')).getByRole('menuitemradio', { name: /Edit mode/ }))
    expect(onMode).toHaveBeenCalledWith('edit')
  })

  it('writes the view rather than the document from every control on the right', () => {
    const { onView, onRunOperator } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'X-ray' }))
    expect(onView).toHaveBeenCalledWith({ xray: true })

    fireEvent.click(screen.getByRole('button', { name: 'Wireframe' }))
    expect(onView).toHaveBeenCalledWith({ shading: 'wireframe' })

    fireEvent.click(screen.getByRole('button', { name: 'Snapping' }))
    expect(onView).toHaveBeenCalledWith({ snapEnabled: true })

    expect(onRunOperator).not.toHaveBeenCalled()
  })

  it('shows the shading in use as the pressed button', () => {
    renderHeader({ view: { shading: 'material' } })

    expect(screen.getByRole('button', { name: 'Material preview' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Solid' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('picks a pivot point and a transform orientation from their menus', () => {
    const { onView } = renderHeader()

    const pivots = openMenu('Pivot point')
    expect(within(pivots).getByRole('menuitemradio', { name: 'Median point' })).toHaveAttribute('aria-checked', 'true')
    expect(within(pivots).getByRole('menuitemradio', { name: 'Bounding box centre' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(within(pivots).getByRole('menuitemradio', { name: '3D cursor' }))
    expect(onView).toHaveBeenCalledWith({ pivot: 'cursor' })

    const orientations = openMenu('Transform orientation')
    fireEvent.click(within(orientations).getByRole('menuitemradio', { name: 'Normal' }))
    expect(onView).toHaveBeenCalledWith({ orientation: 'normal' })
  })

  it('toggles one overlay without disturbing the others', () => {
    const { onView, view } = renderHeader()
    const menu = openMenu('Overlays')
    const floor = within(menu).getByRole('menuitemcheckbox', { name: 'Floor' })

    expect(floor).toHaveAttribute('aria-checked', String(view.overlays.floor))
    fireEvent.click(floor)
    expect(onView).toHaveBeenCalledWith({ overlays: { ...view.overlays, floor: !view.overlays.floor } })
  })

  it('adds the edit-mode overlays only in edit mode', () => {
    renderHeader({ mode: 'edit' })
    const menu = openMenu('Overlays')

    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Face orientation' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Normals' })).toBeInTheDocument()
  })

  it('fills the edit-mode menus from the registry', () => {
    renderHeader({ mode: 'edit' })
    const menu = openMenu('Vertex')

    // The lists name operators from several families; what matters is that the ids in the list and
    // the ids in the registry are the same ones, which is what an entry appearing proves.
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(4)
    expect(within(menu).queryByText('Nothing in this menu yet.')).not.toBeInTheDocument()
  })

  it('sends the editor’s own actions on, rather than running them as operators', () => {
    const { onCommand, onRunOperator } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keymap sheet' }))
    expect(onCommand).toHaveBeenNthCalledWith(1, 'palette')
    expect(onCommand).toHaveBeenNthCalledWith(2, 'keymapSheet')
    expect(onRunOperator).not.toHaveBeenCalled()
  })

  /**
   * The header folds on its own overflow, not on a width: it holds eleven controls in object mode
   * and nineteen in edit mode, so there is no one width at which it stops fitting. jsdom lays
   * nothing out, so the two numbers the hook reads are the ones to fake.
   */
  const measuring = (client: number, scroll: number | (() => number)) => {
    const scrollOf = typeof scroll === 'function' ? scroll : () => scroll
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => client })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: scrollOf })
    return () => {
      for (const name of ['clientWidth', 'scrollWidth']) {
        Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => 0 })
      }
    }
  }

  it('folds the view settings into one popover when they do not fit', async () => {
    const restore = measuring(420, 640)
    try {
      const { onView } = renderHeader()

      expect(screen.queryByRole('button', { name: 'X-ray' })).not.toBeInTheDocument()
      const settings = screen.getByRole('button', { name: 'View settings' })
      fireEvent.click(settings)

      const panel = await screen.findByRole('dialog', { name: 'View settings' })
      expect(panel).toHaveAttribute('data-placed')
      fireEvent.click(within(panel).getByRole('button', { name: 'X-ray' }))
      expect(onView).toHaveBeenCalledWith({ xray: true })

      fireEvent.keyDown(panel, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'View settings' })).not.toBeInTheDocument())
      expect(settings).toHaveFocus()
    } finally {
      restore()
    }
  })

  it('keeps every control reachable, folding the editor’s own buttons when even that is not enough', () => {
    // Measured at 1440 with both panels open, edit mode wanted 1,473 pixels of an 880-pixel row;
    // what used to happen to the difference was nothing, silently.
    const restore = measuring(880, 1473)
    try {
      renderHeader()
      // Both stages have folded, and nothing has gone: the two triggers are in the bar…
      expect(screen.getByRole('button', { name: 'View settings' })).toBeInTheDocument()
      const editor = screen.getByRole('button', { name: 'Editor' })
      fireEvent.click(editor)
      // …and what the second one holds is still one click away rather than off the end of the row.
      expect(screen.getByRole('button', { name: 'Command palette' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'UV editor' })).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  /**
   * The regression that shipped: the fold remembered what edit mode had needed, and object mode
   * could never satisfy it again, so Tab and Tab back left four buttons a click deep for the rest
   * of the session. No campaign script does a mode round trip and then looks in the bar.
   */
  it('unfolds again once the mode that needed the room is left', () => {
    /*
     * The width has to shrink as the header folds, the way it does in a browser: with a constant
     * one the fold settles against the stage cap rather than against the room, and the memory this
     * is about is never consulted. Three hundred pixels is roughly what each stage puts away.
     */
    let wanted = 1473
    const folded = () => Number(document.querySelector('.scene-header')?.getAttribute('data-fold') ?? 0)
    const restore = measuring(880, () => wanted - folded() * 300)
    try {
      const { rerender, headerElement: element, view, onRunOperator, onView, onMode, onCommand, scene } = renderHeader({ mode: 'edit' })
      expect(screen.getByRole('button', { name: 'Editor' })).toBeInTheDocument()

      /*
       * The same mounted header, handed object mode — not a fresh one, which would forget whatever
       * it had learnt and pass whether or not the bug is there. Tab and Tab back is one component
       * seeing two modes, and that is the only shape in which this fails.
       */
      wanted = 1000
      const next: ViewState = { ...view, mode: 'object' }
      rerender(element({
        view: next,
        context: { ...scene, view: next, document: { ...scene, view: next }, selection: EMPTY_SELECTION, mode: 'object', cursor: scene.cursor, active: null } as OperatorContext,
        onRunOperator,
        onView,
        onMode,
        onCommand,
      }))

      expect(screen.queryByRole('button', { name: 'Editor' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Command palette' })).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('folds nothing when the row is wide enough', () => {
    const restore = measuring(1200, 900)
    try {
      renderHeader()
      expect(screen.queryByRole('button', { name: 'View settings' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'X-ray' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Command palette' })).toBeInTheDocument()
    } finally {
      restore()
    }
  })
})
