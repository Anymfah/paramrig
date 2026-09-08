import { describe, expect, it } from 'vitest'
import { createLfoState, LFO_RANGE, lfoAt, readLfoTarget } from '@/audio/dsp/lfo'
import { mulberry32 } from '@/audio/dsp/rng'
import { makeLayer, makeLfo, makePatch } from '@/audio/patch'
import { monoSum, renderPatch } from '@/audio/dsp/render'

const render = (patch: Parameters<typeof renderPatch>[0], rate = 22050) => monoSum(renderPatch(patch, rate))

const lfo = (over = {}) => makeLfo({ enabled: true, shape: 'sine', rate: 4, depth: 1, phase: 0, target: 'layers[0].gain', ...over })

describe('lfoAt', () => {
  it('stays between minus one and one, whatever the shape', () => {
    for (const shape of ['sine', 'triangle', 'square', 'saw', 'noise'] as const) {
      const state = createLfoState(mulberry32(1))
      const random = mulberry32(1)
      for (let step = 0; step < 400; step += 1) {
        const value = lfoAt(lfo({ shape }), step / 200, state, random)
        expect(Number.isFinite(value), shape).toBe(true)
        expect(Math.abs(value), shape).toBeLessThanOrEqual(1)
      }
    }
  })

  it('completes a cycle at the rate it is given', () => {
    const state = createLfoState(mulberry32(1))
    const random = mulberry32(1)
    const at = (t: number) => lfoAt(lfo({ shape: 'sine', rate: 2 }), t, state, random)
    expect(at(0)).toBeCloseTo(0, 6)
    expect(at(0.125)).toBeCloseTo(1, 6)
    expect(at(0.5)).toBeCloseTo(0, 6)
  })

  it('holds a noise value instead of hissing', () => {
    const state = createLfoState(mulberry32(3))
    const random = mulberry32(3)
    const shape = lfo({ shape: 'noise', rate: 4 })
    const first = lfoAt(shape, 0.01, state, random)
    expect(lfoAt(shape, 0.05, state, random)).toBe(first)
    expect(lfoAt(shape, 0.3, state, random)).not.toBe(first)
  })

  it('starts where the phase says', () => {
    const state = createLfoState(mulberry32(1))
    expect(lfoAt(lfo({ shape: 'sine', phase: 0.25 }), 0, state, mulberry32(1))).toBeCloseTo(1, 6)
  })
})

describe('readLfoTarget', () => {
  it('reads a layer and a destination, and refuses anything else', () => {
    expect(readLfoTarget('layers[1].cutoff')).toEqual({ layer: 1, destination: 'cutoff' })
    for (const bad of ['off', '', 'layers[1].nope', 'fx.tone', 'layers[].pitch']) {
      expect(readLfoTarget(bad), bad).toBeNull()
    }
  })

  it('publishes how far each destination travels, so the board and the ear agree', () => {
    expect(Object.keys(LFO_RANGE).sort()).toEqual(['cutoff', 'gain', 'pitch', 'pulseWidth'])
  })
})

describe('a modulated render', () => {
  const held = (over = {}, lfos: object[] = []) => makePatch(0.5, [makeLayer({
    gain: 0.7,
    source: { kind: 'tone', wave: 'saw', ...over },
    pitch: { start: 300 },
    filter: { kind: 'lowpass', cutoff: 2000, resonance: 0.3 },
    amp: { attack: 0.004, hold: 0.36, decay: 0.04, sustain: 0.9, release: 0.08, curve: 1.5 },
  })], {}, { limiter: 0 }, 1, lfos)

  /** How much the level wanders across the sound: a tremolo wanders, a held tone does not. */
  const wander = (samples: Float32Array) => {
    const window = 512
    const levels: number[] = []
    for (let at = 0; at + window < samples.length; at += window) {
      let sum = 0
      for (let i = at; i < at + window; i += 1) sum += (samples[i] ?? 0) ** 2
      levels.push(Math.sqrt(sum / window))
    }
    return Math.max(...levels) - Math.min(...levels)
  }

  it('does nothing at all while every modulator is off', () => {
    expect(Array.from(render(held()))).toEqual(Array.from(render(held({}, [makeLfo()]))))
  })

  it('does nothing when it is enabled but pointed at nothing', () => {
    const idle = held({}, [{ ...makeLfo(), enabled: true, target: 'off' }])
    expect(Array.from(render(idle))).toEqual(Array.from(render(held())))
  })

  it('moves the level when it is pointed at a gain', () => {
    const plain = wander(render(held()))
    const shaken = wander(render(held({}, [lfo({ rate: 8, depth: 0.8 })])))
    expect(shaken).toBeGreaterThan(plain * 1.5)
  })

  it('changes the sound when it is pointed at a cutoff', () => {
    const plain = render(held())
    const swept = render(held({}, [lfo({ target: 'layers[0].cutoff', rate: 4, depth: 0.9 })]))
    expect(Array.from(swept)).not.toEqual(Array.from(plain))
  })

  it('is reproducible, noise modulator included', () => {
    const shaken = () => render(held({}, [lfo({ shape: 'noise', target: 'layers[0].pitch' })]))
    expect(Array.from(shaken())).toEqual(Array.from(shaken()))
  })
})

describe('unison', () => {
  const voiced = (voices: number) => makePatch(0.4, [makeLayer({
    gain: 0.7,
    source: { kind: 'tone', wave: 'saw', voices, detune: 20 },
    pitch: { start: 300 },
    amp: { attack: 0.004, hold: 0.3, decay: 0.03, sustain: 0.9, release: 0.06, curve: 1.5 },
  })], {}, { limiter: 0 })

  it('is a different sound with more of them', () => {
    expect(Array.from(render(voiced(3)))).not.toEqual(Array.from(render(voiced(1))))
  })

  /** Adding voices should thicken a sound, not quieten it: the sum is balanced by root-n. */
  it('holds its loudness as voices are added', () => {
    const rms = (samples: Float32Array) => {
      let sum = 0
      for (let i = 0; i < samples.length; i += 1) sum += (samples[i] ?? 0) ** 2
      return Math.sqrt(sum / samples.length)
    }
    const one = rms(render(voiced(1)))
    const five = rms(render(voiced(5)))
    expect(five).toBeGreaterThan(one * 0.7)
    expect(five).toBeLessThan(one * 1.3)
  })
})
