import { describe, expect, it } from 'vitest'
import type { AmpSettings } from '@/audio/types'
import { envelopeAt, fitEnvelope } from '@/audio/dsp/envelope'

const amp = (over: Partial<AmpSettings> = {}): AmpSettings => ({
  attack: 0.01, hold: 0.01, decay: 0.1, sustain: 0.3, release: 0.05, curve: 2, ...over,
})

describe('fitEnvelope', () => {
  it('leaves stages alone when they fit', () => {
    const fitted = fitEnvelope(amp(), 1)
    expect(fitted).toEqual({ attack: 0.01, hold: 0.01, decay: 0.1, release: 0.05 })
  })

  it('scales stages together rather than truncating when they overrun', () => {
    const fitted = fitEnvelope(amp({ attack: 1, hold: 0, decay: 1, release: 2 }), 1)
    expect(fitted.attack + fitted.hold + fitted.decay + fitted.release).toBeCloseTo(1, 6)
    expect(fitted.release / fitted.attack).toBeCloseTo(2, 6)
  })

  it('refuses negative stages', () => {
    const fitted = fitEnvelope(amp({ attack: -1, decay: -2 }), 1)
    expect(fitted.attack).toBe(0)
    expect(fitted.decay).toBe(0)
  })
})

describe('envelopeAt', () => {
  it('starts and ends at exactly zero, which is what keeps a sound from clicking', () => {
    const settings = amp()
    const fitted = fitEnvelope(settings, 0.5)
    expect(envelopeAt(settings, fitted, 0, 0.5)).toBe(0)
    expect(envelopeAt(settings, fitted, 0.5, 0.5)).toBeCloseTo(0, 9)
  })

  it('is silent outside the layer life', () => {
    const settings = amp()
    const fitted = fitEnvelope(settings, 0.5)
    expect(envelopeAt(settings, fitted, -0.1, 0.5)).toBe(0)
    expect(envelopeAt(settings, fitted, 0.6, 0.5)).toBe(0)
  })

  it('reaches full level at the end of the attack and holds there', () => {
    const settings = amp()
    const fitted = fitEnvelope(settings, 0.5)
    expect(envelopeAt(settings, fitted, 0.01, 0.5)).toBeCloseTo(1, 6)
    expect(envelopeAt(settings, fitted, 0.015, 0.5)).toBeCloseTo(1, 6)
  })

  it('settles on the sustain level between decay and release', () => {
    const settings = amp()
    const fitted = fitEnvelope(settings, 0.5)
    expect(envelopeAt(settings, fitted, 0.2, 0.5)).toBeCloseTo(0.3, 6)
  })

  it('never leaves the unit interval, whatever the settings', () => {
    const settings = amp({ curve: 6, sustain: 1 })
    const fitted = fitEnvelope(settings, 0.4)
    for (let i = 0; i <= 400; i += 1) {
      const value = envelopeAt(settings, fitted, (i / 400) * 0.4, 0.4)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('falls faster than linear when the curve is raised', () => {
    const soft = amp({ sustain: 0, curve: 1, attack: 0, hold: 0, decay: 1, release: 0 })
    const hard = amp({ sustain: 0, curve: 4, attack: 0, hold: 0, decay: 1, release: 0 })
    expect(envelopeAt(hard, fitEnvelope(hard, 1), 0.5, 1)).toBeLessThan(envelopeAt(soft, fitEnvelope(soft, 1), 0.5, 1))
  })
})
