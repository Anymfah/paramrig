import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AudioKnob } from '@/audio/AudioKnob'
import type { ParameterDef } from '@/rigs/types'

const cutoff: Extract<ParameterDef, { kind: 'number' }> = { kind: 'number', id: 'cutoff', label: 'Cutoff', group: '', min: 0, max: 1, step: 0.01, defaultValue: 0.5 }

describe('AudioKnob', () => {
  it('wears a modulator as a coloured stretch of its arc, and says so', () => {
    const { container } = render(<AudioKnob param={cutoff} value={0.5} onChange={() => undefined} target="layers[0].cutoff" mods={[{ id: 'mods[0]', name: 'L4', colour: '#6fb904', depth: 0.3, onDepth: () => undefined }]} />)
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
    render(<AudioKnob param={cutoff} value={0.5} onChange={onChange} mods={[{ id: 'mods[0]', name: 'L4', colour: '#6fb904', depth: 0.3, onDepth }]} />)
    const dial = screen.getByRole('slider', { name: 'Cutoff' })
    fireEvent.keyDown(dial, { key: 'ArrowUp', altKey: true })
    expect(onDepth).toHaveBeenCalledWith(0.32)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(0.52)
  })
})

describe('the modulation slot', () => {
  it('is there for a control a source could take, and reads the amount once one has', () => {
    const { container, rerender } = render(<AudioKnob param={cutoff} value={0.5} onChange={() => undefined} target="layers[0].cutoff" />)
    const slot = container.querySelector('.fp-knob__slot')
    expect(slot).not.toBeNull()
    expect(slot?.textContent).toBe('')
    rerender(<AudioKnob param={cutoff} value={0.5} onChange={() => undefined} target="layers[0].cutoff" mods={[{ id: 'mods[0]', name: 'L4', colour: '#6fb904', depth: 0.7, onDepth: () => undefined }]} />)
    expect(container.querySelector('.fp-knob__slot')?.textContent).toBe('0.70')
    expect(container.querySelector('.fp-knob__slot')?.getAttribute('style')).toMatch(/6fb904|111, 185, 4/)
  })

  it('has no slot on a control nothing can be pointed at', () => {
    const { container } = render(<AudioKnob param={cutoff} value={0.5} onChange={() => undefined} />)
    expect(container.querySelector('.fp-knob__slot')).toBeNull()
  })

  it('empties on a double-click, and pushes one way for an envelope', () => {
    const onClear = vi.fn()
    const { container } = render(<AudioKnob param={cutoff} value={0.5} onChange={() => undefined} target="layers[0].cutoff" mods={[{ id: 'mods[0]', name: 'L4', colour: '#4576c4', depth: -0.5, bipolar: false, onDepth: () => undefined, onClear }]} />)
    fireEvent.doubleClick(container.querySelector('.fp-knob__slot') as Element)
    expect(onClear).toHaveBeenCalled()
    // A negative envelope depth draws its stretch before the value, none after it.
    const d = container.querySelector('.fp-knob__mod')?.getAttribute('d') ?? ''
    expect(d).toMatch(/^M/)
    expect(container.querySelector('.fp-knob__slot')?.textContent).toBe('-0.50')
  })
})
