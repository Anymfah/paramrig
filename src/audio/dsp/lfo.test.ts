import { describe, expect, it } from 'vitest'
import { createLfoState, LFO_RANGE, lfoAt, readLfoTarget } from '@/audio/dsp/lfo'
import { LFO_DESTINATIONS } from '@/audio/fields'
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
    // Two lists kept by hand: what the engine can move, and what the board offers to point at it.
    // A destination in one and not the other is either a target that does nothing or a thing that
    // moves and cannot be reached, and both have happened here.
    expect(Object.keys(LFO_RANGE).sort()).toEqual([...LFO_DESTINATIONS].sort())
    for (const destination of LFO_DESTINATIONS) expect(LFO_RANGE[destination], destination).toBeGreaterThan(0)
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

  /** The held part of the sound, with the envelope's own attack and release left out of it. */
  const sustained = (samples: Float32Array) =>
    samples.slice(Math.round(samples.length * 0.15), Math.round(samples.length * 0.7))

  it('moves the level when it is pointed at a gain', () => {
    // Measured across the held part rather than the whole sound. The envelope moves the level too,
    // and by more than a tremolo does — this used to compare the whole buffer, and passed only
    // because a layer with no gain modulator was rendering six decibels down, which made the
    // modulated one look louder. What a gain modulator adds is movement where there was none.
    const plain = wander(sustained(render(held())))
    const shaken = wander(sustained(render(held({}, [lfo({ rate: 8, depth: 0.8 })]))))
    expect(shaken).toBeGreaterThan(plain * 1.5)
  })

  it('only ever ducks, so pointing something at a gain cannot make a layer louder', () => {
    const loudest = (samples: Float32Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0)
    const plain = loudest(render(held()))
    for (const depth of [0.2, 0.5, 0.8, 1]) {
      expect(loudest(render(held({}, [lfo({ rate: 8, depth })]))), `depth ${depth}`).toBeLessThanOrEqual(plain)
    }
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

describe('the destinations the plate gained', () => {
  const pointed = (target: string, depth = 1) => makePatch(0.4, [makeLayer({
    gain: 0.7,
    // A square, because the duty cycle is the one destination a saw cannot answer.
    source: { kind: 'tone', wave: 'square', pulseWidth: 0.4, voices: 3, detune: 20, fmRatio: 2, fmIndex: 1 },
    pitch: { start: 300 },
    filter: { kind: 'lowpass', cutoff: 1400, resonance: 0.4 },
    // All three slots hold something, since the amount of an empty slot is nothing to move.
    insertA: { kind: 'drive', place: 'pre', amount: 0.5, drive: 0.9 },
    insertB: { kind: 'crusher', place: 'pre', amount: 0.5, bitDepth: 5, crush: 0.3 },
    insertC: { kind: 'body', place: 'post', amount: 0.5, frequency: 900, spread: 0.5, decay: 0.2, partials: 3 },
    amp: { attack: 0.005, hold: 0.1, decay: 0.2, sustain: 0.4, release: 0.05, curve: 1 },
  })], {}, { limiter: 0 }, 1, [{ enabled: true, shape: 'sine', rate: 6, depth, target }])

  const still = renderPatch(pointed('off'), 22050)

  it('moves the sound for every one of them, and for none of them when nothing is pointed', () => {
    for (const where of LFO_DESTINATIONS) {
      const moved = renderPatch(pointed(`layers[0].${where}`), 22050)
      const apart = moved.left.reduce((sum, value, at) => sum + Math.abs(value - (still.left[at] ?? 0)), 0)
      expect(apart, where).toBeGreaterThan(0.5)
      for (const value of moved.left) expect(Number.isFinite(value), where).toBe(true)
    }
  })

  it('leaves the two channels turned when a modulator is pointed at the pan and not otherwise', () => {
    const level = (out: { left: Float32Array; right: Float32Array }) => {
      let apart = 0
      for (let at = 0; at < out.left.length; at += 1) apart += Math.abs(Math.abs(out.left[at] ?? 0) - Math.abs(out.right[at] ?? 0))
      return apart
    }
    expect(level(renderPatch(pointed('layers[0].pan'), 22050))).toBeGreaterThan(level(still))
  })
})
