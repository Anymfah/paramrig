import { describe, expect, it } from 'vitest'
import { TABLES, TABLE_NAMES, tableAt, tableOf, wavetable } from '@/audio/dsp/wavetable'

const SAMPLE_RATE = 44100
const N = 2048

/** One cycle-accurate stretch of a table, played at a pitch. */
function play(name: string, position: number, frequency: number): Float64Array {
  const table = wavetable(tableOf(name))
  const dt = frequency / SAMPLE_RATE
  const out = new Float64Array(N)
  let phase = 0
  for (let i = 0; i < N; i += 1) {
    out[i] = tableAt(table, phase, position, dt)
    phase = (phase + dt) % 1
  }
  return out
}

/**
 * Energy below the fundamental can only have folded down from above Nyquist, so it measures
 * aliasing directly. The same reading `osc.test.ts` uses on the band-limited shapes.
 */
function aliasRatio(samples: Float64Array, freq: number): number {
  const windowed = new Float64Array(N)
  let total = 0
  for (let i = 0; i < N; i += 1) {
    windowed[i] = (samples[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))
    total += (windowed[i] ?? 0) ** 2
  }
  const cut = Math.floor((freq * 0.9 * N) / SAMPLE_RATE)
  let below = 0
  for (let k = 2; k < cut; k += 1) {
    let re = 0
    let im = 0
    const step = (2 * Math.PI * k) / N
    for (let i = 0; i < N; i += 1) {
      re += (windowed[i] ?? 0) * Math.cos(step * i)
      im -= (windowed[i] ?? 0) * Math.sin(step * i)
    }
    below += (re * re + im * im) / N
  }
  return total > 0 ? below / total : 0
}

const peak = (samples: Float64Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0)

describe('the wavetable library', () => {
  it('makes a sound at every position of every table, and never above full scale', () => {
    for (const name of TABLE_NAMES) {
      for (const position of [0, 0.25, 0.5, 0.75, 1]) {
        const wave = play(name, position, 220)
        const loudest = peak(wave)
        expect(loudest, `${name} at ${position}`).toBeGreaterThan(0.08)
        expect(loudest, `${name} at ${position}`).toBeLessThanOrEqual(1.0001)
      }
    }
  })

  it('carries no harmonic it cannot hold, however high it is played', () => {
    // Four kilohertz leaves room for ten harmonics; a table read from its tallest band would fold
    // fifty of them back down. Every table has to pick the band that fits.
    for (const name of TABLE_NAMES) {
      expect(aliasRatio(play(name, 1, 4000), 4000), name).toBeLessThan(0.02)
      expect(aliasRatio(play(name, 0.5, 7000), 7000), name).toBeLessThan(0.02)
    }
  })

  it('moves without stepping when the position knob turns', () => {
    for (const name of TABLE_NAMES) {
      let worst = 0
      for (let position = 0; position < 0.98; position += 0.02) {
        const here = play(name, position, 220)
        const there = play(name, position + 0.02, 220)
        let apart = 0
        for (let i = 0; i < N; i += 1) apart = Math.max(apart, Math.abs((here[i] ?? 0) - (there[i] ?? 0)))
        worst = Math.max(worst, apart)
      }
      // A fiftieth of the knob may not move the wave by more than a fifth of its height.
      expect(worst, name).toBeLessThan(0.2)
    }
  })

  it('is the same table every time it is asked for', () => {
    const first = wavetable('sweep')
    const second = wavetable('sweep')
    expect(second).toBe(first)
    expect(Array.from(play('bell', 0.4, 330))).toEqual(Array.from(play('bell', 0.4, 330)))
  })

  it('refuses a name it does not know rather than guessing at one', () => {
    expect(tableOf('nothing-like-this')).toBe('sweep')
    expect(tableOf(undefined)).toBe('sweep')
    expect(tableOf('bell')).toBe('bell')
  })

  it('says what each table is, in one line, for the picker', () => {
    for (const name of TABLE_NAMES) {
      const table = TABLES[name]
      expect(table?.label.length, name).toBeGreaterThan(2)
      expect(table?.note.length, name).toBeGreaterThan(20)
    }
  })
})
