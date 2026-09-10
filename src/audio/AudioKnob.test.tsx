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
    const onChange = vi.fn()
    const { container } = render(<AudioKnob param={cutoff} value={0.5} onChange={onChange} target="layers[0].cutoff" mods={[{ id: 'mods[0]', name: 'L4', colour: '#4576c4', depth: -0.5, bipolar: false, onDepth: () => undefined, onClear }]} />)
    fireEvent.doubleClick(container.querySelector('.fp-knob__slot') as Element)
    expect(onClear).toHaveBeenCalled()
    // And only that: the same gesture used to keep going to the body's own double-click and put
    // the parameter back to the blank patch's value — one gesture, two edits, one unasked for.
    expect(onChange).not.toHaveBeenCalled()
    // A negative envelope depth draws its stretch before the value, none after it.
    const d = container.querySelector('.fp-knob__mod')?.getAttribute('d') ?? ''
    expect(d).toMatch(/^M/)
    expect(container.querySelector('.fp-knob__slot')?.textContent).toBe('-0.50')
  })

  /**
   * The arrows, which were dead on most of the instrument.
   *
   * The nudge used to move the *fraction* by a fiftieth and then round the result onto the
   * parameter's own step, so on anything with fewer than twenty-five steps across its range the
   * press landed back where it started — and shift, a tenth of that, was dead on nearly every
   * dial on the plate. Nothing accumulated either, since the fraction was recomputed from the
   * unchanged value every press.
   */
  describe('the arrows', () => {
    const step = (param: Extract<ParameterDef, { kind: 'number' }>, value: number, key: string, shiftKey = false) => {
      const onChange = vi.fn()
      // Its own tree each time, so several presses in one test do not leave several dials behind.
      const view = render(<AudioKnob param={param} value={value} onChange={onChange} />)
      fireEvent.keyDown(view.getByRole('slider', { name: param.label }), { key, shiftKey })
      view.unmount()
      return onChange.mock.calls[0]?.[0] as number | undefined
    }

    it('moves a short-range dial, where a fraction of the range rounds to nothing', () => {
      const voices: Extract<ParameterDef, { kind: 'number' }> = { kind: 'number', id: 'voices', label: 'Voices', group: '', min: 1, max: 5, step: 1, defaultValue: 1 }
      expect(step(voices, 1, 'ArrowUp')).toBe(2)
      expect(step(voices, 2, 'ArrowDown')).toBe(1)
      expect(step(voices, 5, 'ArrowUp')).toBe(5)
    })

    it('gives shift the fine press and the bare arrow the coarse one', () => {
      expect(step(cutoff, 0.5, 'ArrowUp', true)).toBeCloseTo(0.51, 6)
      expect(step(cutoff, 0.5, 'ArrowUp')).toBeCloseTo(0.52, 6)
      expect(step(cutoff, 0.5, 'ArrowDown', true)).toBeCloseTo(0.49, 6)
    })

    it('keeps a fraction of the sweep on a logarithmic dial, where a step in hertz means two things', () => {
      const corner: Extract<ParameterDef, { kind: 'number' }> = { kind: 'number', id: 'cut', label: 'Cutoff', group: '', min: 20, max: 20000, step: 1, scale: 'log', defaultValue: 800 }
      const up = step(corner, 800, 'ArrowUp') ?? 0
      expect(up).toBeGreaterThan(800)
      expect(up).toBeLessThan(1000)
      const fine = step(corner, 800, 'ArrowUp', true) ?? 0
      expect(fine).toBeGreaterThan(800)
      expect(fine).toBeLessThan(up)
    })
  })
})
