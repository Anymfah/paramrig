import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AudioKnob } from '@/audio/AudioKnob'
import type { ParameterDef } from '@/rigs/types'

const cutoff: Extract<ParameterDef, { kind: 'number' }> = { kind: 'number', id: 'cutoff', label: 'Cutoff', group: '', min: 0, max: 1, step: 0.01, defaultValue: 0.5 }

describe('AudioKnob', () => {
  it('wears a modulator as a coloured stretch of its arc, and says so', () => {
    const { container } = render(<AudioKnob param={cutoff} value={0.5} onChange={() => undefined} target="layers[0].cutoff" mod={{ colour: '#6fb904', depth: 0.3, onDepth: () => undefined }} />)
    const arc = container.querySelector('.fp-knob__mod')
    expect(arc).not.toBeNull()
    expect(arc?.getAttribute('style')).toMatch(/6fb904|111, 185, 4/)
    const dial = screen.getByRole('slider', { name: 'Cutoff' })
    expect(dial).toHaveAttribute('data-target', 'layers[0].cutoff')
    expect(dial).toHaveAttribute('aria-valuetext', expect.stringContaining('modulated 30 per cent'))
  })

  it('draws no stretch, and offers no handle, when nothing is pointed at it', () => {
    const { container } = render(<AudioKnob param={cutoff} value={0.5} onChange={() => undefined} target="layers[0].cutoff" />)
    expect(container.querySelector('.fp-knob__mod')).toBeNull()
    expect(container.querySelector('.fp-knob__hit')).toBeNull()
  })

  it('moves the swing, not the value, when Alt is held with an arrow', () => {
    const onDepth = vi.fn()
    const onChange = vi.fn()
    render(<AudioKnob param={cutoff} value={0.5} onChange={onChange} mod={{ colour: '#6fb904', depth: 0.3, onDepth }} />)
    const dial = screen.getByRole('slider', { name: 'Cutoff' })
    fireEvent.keyDown(dial, { key: 'ArrowUp', altKey: true })
    expect(onDepth).toHaveBeenCalledWith(0.32)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(0.52)
  })
})
