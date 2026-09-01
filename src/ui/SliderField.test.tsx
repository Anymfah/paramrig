import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SliderField } from '@/ui/SliderField'

describe('SliderField', () => {
  it('marks overflow when the value sits outside the track', () => {
    const { container } = render(
      <SliderField label="Twist" value={80} min={-120} max={120} step={1} unit="°" sliderMin={-60} sliderMax={60} onChange={() => undefined} />,
    )
    expect(container.querySelector('.slider-wrap')).toHaveAttribute('data-overflow', 'end')
  })

  it('nudges by a fine step when Shift is held', () => {
    const onChange = vi.fn()
    render(
      <SliderField label="Twist" value={24} min={-120} max={120} step={1} unit="°" sliderMin={-60} sliderMax={60} onChange={onChange} />,
    )
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Twist slider' }), { key: 'ArrowLeft', shiftKey: true })
    expect(onChange).toHaveBeenCalledWith(23.9)
  })
})
