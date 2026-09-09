import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AudioPattern } from '@/audio/AudioPattern'
import { STEP_COUNT } from '@/audio/fields'

const blank = () => Array.from({ length: STEP_COUNT }, () => 0)

describe('the performer\'s row', () => {
  it('is sixteen sliders to a keyboard, each moving its own step', () => {
    const onChange = vi.fn()
    render(<AudioPattern steps={blank()} shape="step" bipolar={false} width={320} height={200} name="Performer 1 row" onChange={onChange} />)
    const steps = screen.getAllByRole('slider')
    expect(steps).toHaveLength(STEP_COUNT)
    fireEvent.keyDown(steps[3]!, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(blank().map((level, at) => (at === 3 ? 0.05 : level)))
    fireEvent.keyDown(steps[3]!, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(blank().map((level, at) => (at === 3 ? 1 : level)))
  })

  it('takes the pointer\'s height for the step under it, and follows a drag', () => {
    const onChange = vi.fn()
    const start = vi.fn()
    const end = vi.fn()
    const { container } = render(<AudioPattern steps={blank()} shape="line" bipolar={false} width={320} height={200} name="Performer 1 row" onChange={onChange} onGestureStart={start} onGestureEnd={end} />)
    const plot = container.querySelector('.pattern__plot') as SVGSVGElement
    // jsdom lays nothing out: the plot says where it is.
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 200, right: 320, bottom: 200, x: 0, y: 0, toJSON: () => ({}) })
    plot.setPointerCapture = () => undefined
    // Step one (x 0..20), three quarters up.
    fireEvent.pointerDown(plot, { clientX: 10, clientY: 50, pointerId: 1, button: 0 })
    expect(start).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(blank().map((level, at) => (at === 0 ? 0.75 : level)))
    // Step five, halfway up. (A step already at the pointer's height is left alone: no call.)
    fireEvent.pointerMove(plot, { clientX: 90, clientY: 100, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(blank().map((level, at) => (at === 4 ? 0.5 : level)))
    fireEvent.pointerMove(plot, { clientX: 130, clientY: 200, pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(2)
    fireEvent.pointerUp(plot, { pointerId: 1 })
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('draws the row as it is read, and a rest line when bipolar', () => {
    const { container, rerender } = render(<AudioPattern steps={blank()} shape="step" bipolar={false} width={320} height={200} name="Performer 1 row" onChange={() => undefined} />)
    expect(container.querySelector('.pattern__read')?.getAttribute('d')).toMatch(/^M0\.00 200\.00/)
    expect(container.querySelector('.pattern__rest')).toBeNull()
    rerender(<AudioPattern steps={blank()} shape="step" bipolar width={320} height={200} name="Performer 1 row" onChange={() => undefined} />)
    expect(container.querySelector('.pattern__rest')).not.toBeNull()
  })
})
