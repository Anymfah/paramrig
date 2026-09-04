import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ScenePieMenu, type ScenePieItem } from '@/scene/ScenePieMenu'

const PIVOTS: ScenePieItem[] = [
  { id: 'bounding-box', label: 'Bounding box centre' },
  { id: 'cursor', label: '3D cursor' },
  { id: 'individual', label: 'Individual origins' },
  { id: 'median', label: 'Median point' },
]

const AT = { x: 400, y: 300 }

const REFUSED_REASON = 'The 3D cursor is off screen.'

const WITH_A_REFUSAL: ScenePieItem[] = [
  { id: 'bounding-box', label: 'Bounding box centre' },
  { id: 'cursor', label: '3D cursor', disabled: true, reason: REFUSED_REASON },
]

function openPie(items: ScenePieItem[] = PIVOTS) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<ScenePieMenu open at={AT} label="Pivot point" items={items} onPick={onPick} onClose={onClose} />)
  const menu = screen.getByRole('menu', { name: 'Pivot point' })
  return { menu, onPick, onClose, entries: within(menu).getAllByRole('menuitem') }
}

/** A pie that can be closed, so the focus it hands back has somewhere to go. */
function PieHarness({ open, onPick, onClose }: { open: boolean; onPick: () => void; onClose: () => void }) {
  return (
    <>
      <button type="button">Viewport</button>
      <ScenePieMenu open={open} at={AT} label="Pivot point" items={PIVOTS} onPick={onPick} onClose={onClose} />
    </>
  )
}

describe('the scene editor pie menu', () => {
  it('lays its entries on a circle, the first at the top and the rest clockwise', () => {
    const { entries } = openPie()

    expect(entries.map((entry) => [entry.style.left, entry.style.top])).toEqual([
      ['0px', '-96px'],
      ['96px', '0px'],
      ['0px', '96px'],
      ['-96px', '0px'],
    ])
  })

  it('highlights the entry the pointer moves towards, and picks it when the pointer is released', () => {
    const { menu, entries, onPick, onClose } = openPie()

    fireEvent.pointerMove(menu, { clientX: AT.x + 80, clientY: AT.y - 4 })
    expect(entries[1]).toHaveAttribute('data-highlighted', 'true')
    expect(entries[0]).not.toHaveAttribute('data-highlighted')

    fireEvent.pointerUp(menu)
    expect(onPick).toHaveBeenCalledWith('cursor', undefined)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('leaves the entry alone while the pointer is still inside the dead zone', () => {
    const { menu, entries, onPick, onClose } = openPie()

    fireEvent.pointerMove(menu, { clientX: AT.x + 6, clientY: AT.y + 6 })
    expect(entries[0]).toHaveAttribute('data-highlighted', 'true')

    fireEvent.pointerUp(menu)
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('walks the circle with the arrows and with Tab, and picks with Enter', () => {
    const { menu, entries, onPick } = openPie()

    fireEvent.keyDown(menu, { key: 'ArrowRight' })
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(entries[2]).toHaveAttribute('data-highlighted', 'true')

    fireEvent.keyDown(menu, { key: 'ArrowLeft' })
    expect(entries[1]).toHaveAttribute('data-highlighted', 'true')

    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('cursor', undefined)
  })

  it('picks an entry by its number, counting from the top', () => {
    const { menu, onPick } = openPie()
    fireEvent.keyDown(menu, { key: '2' })
    expect(onPick).toHaveBeenCalledWith(PIVOTS[1]!.id, undefined)
  })

  it('hands over the settings a slice carries, for two slices of one operator', () => {
    const onPick = vi.fn()
    const items = [
      { id: 'cursor.selectionToCursor', label: 'Selection to cursor' },
      { id: 'cursor.selectionToCursor', label: 'Selection to cursor, all on it', params: { keepOffset: false } },
    ]
    render(<ScenePieMenu open at={AT} label="Snap" items={items} onPick={onPick} onClose={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Snap' }), { key: '2' })
    expect(onPick).toHaveBeenCalledWith('cursor.selectionToCursor', { keepOffset: false })
  })

  it('ignores a number with no entry under it', () => {
    const { menu, onPick } = openPie()
    fireEvent.keyDown(menu, { key: '8' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('picks an entry from a single tap', () => {
    const { menu, onPick } = openPie()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Individual origins' }))
    expect(onPick).toHaveBeenCalledWith('individual', undefined)
  })

  it('opens with the first entry under the keyboard, closes on Escape and hands the focus back', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(<PieHarness open={false} onPick={onPick} onClose={onClose} />)
    const viewport = screen.getByRole('button', { name: 'Viewport' })
    viewport.focus()

    rerender(<PieHarness open onPick={onPick} onClose={onClose} />)
    const menu = screen.getByRole('menu', { name: 'Pivot point' })
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus())

    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()

    rerender(<PieHarness open={false} onPick={onPick} onClose={onClose} />)
    expect(viewport).toHaveFocus()
  })

  it('keeps an entry it cannot offer visible, and says why', async () => {
    const user = userEvent.setup()
    const { menu, onPick, onClose } = openPie(WITH_A_REFUSAL)
    const refused = within(menu).getByRole('menuitem', { name: '3D cursor' })

    expect(refused).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(refused)
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    await user.hover(refused)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REFUSED_REASON)
  })

  it('refuses to pick a disabled entry by direction either', () => {
    const { menu, onPick } = openPie(WITH_A_REFUSAL)

    fireEvent.pointerMove(menu, { clientX: AT.x, clientY: AT.y + 90 })
    fireEvent.pointerUp(menu)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('draws nothing at all while it is closed', () => {
    render(<ScenePieMenu open={false} at={AT} label="Pivot point" items={PIVOTS} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  /*
   * The state a pie is opened in has to survive being opened twice from different places: the
   * second opening must not inherit the first one's highlight, or a flick that chose nothing would
   * still pick whatever the last one landed on.
   */
  it('starts each opening at the first entry', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(<PieHarness open onPick={onPick} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Pivot point' }), { key: 'ArrowRight' })

    rerender(<PieHarness open={false} onPick={onPick} onClose={onClose} />)
    rerender(<PieHarness open onPick={onPick} onClose={onClose} />)

    const entries = within(screen.getByRole('menu', { name: 'Pivot point' })).getAllByRole('menuitem')
    expect(entries[0]).toHaveAttribute('data-highlighted', 'true')
  })
})

/** A pie opened from a key, the way the viewport opens one, to prove the whole round trip. */
function PivotPie() {
  const [open, setOpen] = useState(false)
  const [pivot, setPivot] = useState('bounding-box')
  return (
    <div
      tabIndex={-1}
      data-testid="viewport"
      onKeyDown={(event) => {
        if (event.key === '.') setOpen(true)
      }}
    >
      <p>{pivot}</p>
      <ScenePieMenu
        open={open}
        at={AT}
        label="Pivot point"
        items={PIVOTS}
        onPick={setPivot}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}

describe('a pie opened from the viewport', () => {
  it('closes itself and reports the entry that was picked', () => {
    render(<PivotPie />)
    const viewport = screen.getByTestId('viewport')

    fireEvent.keyDown(viewport, { key: '.' })
    const menu = screen.getByRole('menu', { name: 'Pivot point' })
    fireEvent.keyDown(menu, { key: 'ArrowRight' })
    fireEvent.keyDown(menu, { key: 'Enter' })

    expect(screen.queryByRole('menu', { name: 'Pivot point' })).not.toBeInTheDocument()
    expect(screen.getByText('cursor')).toBeInTheDocument()
  })
})
