import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NumberField } from '@/ui/NumberField'
import { SCRUB_THRESHOLD_PX } from '@/ui/numeric'

describe('NumberField', () => {
  it('treats a short press as text editing', () => {
    const onChange = vi.fn()
    const onStart = vi.fn()
    render(
      <NumberField
        label="Lobes"
        value={6}
        min={3}
        max={16}
        step={1}
        variant="stepper"
        onChange={onChange}
        onGestureStart={onStart}
      />,
    )
    const value = document.querySelector('.number-value')
    expect(value).toBeTruthy()
    fireEvent.pointerDown(value!, { button: 0, clientX: 40, pointerId: 1 })
    fireEvent.pointerUp(value!, { button: 0, clientX: 41, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Lobes')).toHaveFocus()
  })

  it('scrubs after the pointer moves past the threshold', () => {
    const onChange = vi.fn()
    const onStart = vi.fn()
    const onEnd = vi.fn()
    render(
      <NumberField
        label="Lobes"
        value={6}
        min={3}
        max={16}
        step={1}
        variant="stepper"
        onChange={onChange}
        onGestureStart={onStart}
        onGestureEnd={onEnd}
      />,
    )
    const value = document.querySelector('.number-value')
    fireEvent.pointerDown(value!, { button: 0, clientX: 40, pointerId: 1 })
    fireEvent.pointerMove(value!, {
      buttons: 1,
      clientX: 40 + SCRUB_THRESHOLD_PX + 8,
      pointerId: 1,
    })
    fireEvent.pointerUp(value!, { button: 0, clientX: 52, pointerId: 1 })
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.every(([next]) => Number.isInteger(next as number))).toBe(true)
  })

  it('keeps scrubbing available after the exact input has focus', () => {
    const onChange = vi.fn()
    render(
      <NumberField
        label="Amplitude"
        value={40}
        min={0}
        max={100}
        step={0.01}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Amplitude' })
    const value = document.querySelector('.number-value')
    input.focus()
    expect(input).toHaveFocus()
    fireEvent.pointerDown(input, { button: 0, clientX: 100, pointerId: 7 })
    fireEvent.pointerMove(value!, {
      buttons: 1,
      clientX: 100 + SCRUB_THRESHOLD_PX + 20,
      pointerId: 7,
    })
    fireEvent.pointerUp(value!, { button: 0, clientX: 124, pointerId: 7 })
    expect(onChange).toHaveBeenCalled()
    expect(input).not.toHaveValue('40.00')
  })

  it('cancels a scrub with Escape without ending the gesture as a commit', () => {
    const onChange = vi.fn()
    const onStart = vi.fn()
    const onEnd = vi.fn()
    const onCancel = vi.fn()
    render(
      <NumberField
        label="Amplitude"
        value={0.18}
        min={0}
        max={0.6}
        step={0.01}
        onChange={onChange}
        onGestureStart={onStart}
        onGestureEnd={onEnd}
        onGestureCancel={onCancel}
      />,
    )
    const value = document.querySelector('.number-value')
    fireEvent.pointerDown(value!, { button: 0, clientX: 10, pointerId: 1 })
    fireEvent.pointerMove(value!, { buttons: 1, clientX: 40, pointerId: 1 })
    expect(onStart).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('keeps minus/plus as one gesture while held', () => {
    const onChange = vi.fn()
    const onStart = vi.fn()
    const onEnd = vi.fn()
    render(
      <NumberField
        label="Layers"
        value={38}
        min={4}
        max={64}
        step={1}
        variant="stepper"
        onChange={onChange}
        onGestureStart={onStart}
        onGestureEnd={onEnd}
      />,
    )
    const plus = screen.getByRole('button', { name: 'Increase Layers' })
    fireEvent.pointerDown(plus, { button: 0 })
    fireEvent.pointerUp(plus)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(39)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('puts the field label inside the value chip', () => {
    render(
      <NumberField label="R" value={184} min={0} max={255} step={1} variant="field" onChange={() => undefined} />,
    )
    const chip = document.querySelector('.number-value')
    expect(chip?.querySelector('.number-value__label')).toHaveTextContent('R')
    expect(screen.getByLabelText('R')).toBeInstanceOf(HTMLInputElement)
    expect(document.querySelector('.control__label')).toBeNull()
  })
})
