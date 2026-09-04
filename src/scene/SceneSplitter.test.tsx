import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneSplitter } from '@/scene/SceneSplitter'

/**
 * A splitter is a control with a value, so it is tested as one: the keyboard moves it, the pointer
 * moves it, and neither can push it past the ends.
 */

afterEach(cleanup)

function mount(value = 0.5, onChange = vi.fn()) {
  const view = render(
    <div style={{ width: '1000px' }}>
      <SceneSplitter label="Viewport and UV editor" value={value} onChange={onChange} />
    </div>,
  )
  const bar = view.getByRole('separator')
  // jsdom measures nothing, so the parent is given the box a real one would have.
  const parent = bar.parentElement!
  parent.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}) })
  return { view, bar, onChange }
}

describe('the splitter', () => {
  it('says where it is, in the terms a screen reader reads', () => {
    const { bar } = mount(0.35)
    expect(bar).toHaveAttribute('aria-valuenow', '35')
    expect(bar).toHaveAttribute('aria-valuemin', '20')
    expect(bar).toHaveAttribute('aria-valuemax', '80')
    expect(bar).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('moves by a step on the arrows, and by a bigger one with shift', () => {
    const { bar, onChange } = mount(0.5)
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(0.52)
    fireEvent.keyDown(bar, { key: 'ArrowLeft', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(0.4)
  })

  it('goes to the ends on Home and End, and no further', () => {
    const { bar, onChange } = mount(0.5)
    fireEvent.keyDown(bar, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(0.2)
    fireEvent.keyDown(bar, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(0.8)
  })

  it('will not be dragged past its ends', () => {
    const { bar, onChange } = mount(0.5)
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    const first = onChange.mock.calls[0]![0]
    expect(first).toBeCloseTo(0.48, 6)
    cleanup()
    const { bar: low, onChange: onLow } = mount(0.2)
    fireEvent.keyDown(low, { key: 'ArrowLeft' })
    expect(onLow).toHaveBeenLastCalledWith(0.2)
  })

  it('follows a drag against the parent it divides', () => {
    const { bar, onChange } = mount(0.5)
    bar.setPointerCapture = vi.fn()
    bar.hasPointerCapture = () => true
    bar.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 700 })
    expect(onChange).toHaveBeenLastCalledWith(0.7)
    fireEvent.pointerUp(bar, { pointerId: 1 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 300 })
    // Let go, and the bar stops following the pointer.
    expect(onChange).toHaveBeenLastCalledWith(0.7)
  })

  it('ignores a drag that did not start on it, and buttons that are not the first', () => {
    const { bar, onChange } = mount(0.5)
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 700 })
    fireEvent.pointerDown(bar, { button: 2, pointerId: 1, clientX: 700 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 800 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('puts the arrangement back on a double click, when there is one to put back', () => {
    const onReset = vi.fn()
    render(<SceneSplitter label="Split" value={0.7} onChange={vi.fn()} onReset={onReset} />)
    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(onReset).toHaveBeenCalled()
  })
})
