import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BarField } from '@/ui/BarField'

const rect = (width: number) => () => ({ width, height: 32, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 32, toJSON: () => ({}) }) as DOMRect

describe('BarField', () => {
  it('fills from the track bounds and drags at the pointer\'s pace', () => {
    const onChange = vi.fn()
    render(<BarField label="Blur" value={50} min={0} max={200} step={1} unit="px" onChange={onChange} />)
    const gauge = screen.getByRole('spinbutton', { name: 'Blur' }).closest('.number-value') as HTMLElement
    expect(gauge.style.getPropertyValue('--p')).toBe('0.25')
    expect(gauge).not.toHaveAttribute('data-bipolar')
    gauge.getBoundingClientRect = rect(200)
    fireEvent.pointerDown(gauge, { button: 0, pointerId: 1, clientX: 50 })
    fireEvent.pointerMove(gauge, { buttons: 1, pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(gauge, { pointerId: 1, clientX: 100 })
    // A quarter of the box crossed is a quarter of the 200 px track: 50 + 50.
    expect(onChange).toHaveBeenLastCalledWith(100)
  })
  it('grows a bipolar gauge out of its zero', () => {
    render(<BarField label="Brightness" value={-40} min={-100} max={100} step={1} unit="%" onChange={() => undefined} />)
    const gauge = screen.getByRole('spinbutton', { name: 'Brightness' }).closest('.number-value') as HTMLElement
    expect(gauge).toHaveAttribute('data-bipolar')
    expect(gauge.style.getPropertyValue('--origin')).toBe('0.5')
    expect(gauge.style.getPropertyValue('--fill-start')).toBe('0.3')
    expect(gauge.style.getPropertyValue('--fill-span')).toBe('0.2')
    expect(gauge.querySelector('.number-value__mark[data-origin]')).toBeTruthy()
  })
})
