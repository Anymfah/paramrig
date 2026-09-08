import { describe, expect, it } from 'vitest'
import { renderPatch } from '@/audio/dsp/render'
import { PRESETS, coin, makeLayer, silentLayer, uiClick } from '@/audio/presets'

const SAMPLE_RATE = 44100

const peak = (samples: Float32Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0)

describe('renderPatch', () => {
  it('gives back the same buffer for the same patch, every time', () => {
    const first = renderPatch(uiClick(), SAMPLE_RATE)
    const second = renderPatch(uiClick(), SAMPLE_RATE)
    expect(Array.from(first)).toEqual(Array.from(second))
  })

  it('moves when the seed moves, which is the point of the seed', () => {
    const one = renderPatch({ ...uiClick(), seed: 1 }, SAMPLE_RATE)
    const two = renderPatch({ ...uiClick(), seed: 2 }, SAMPLE_RATE)
    expect(Array.from(one)).not.toEqual(Array.from(two))
  })

  it('is exactly as long as the patch says', () => {
    const patch = { ...coin(), duration: 0.25 }
    expect(renderPatch(patch, SAMPLE_RATE)).toHaveLength(Math.round(0.25 * SAMPLE_RATE))
    expect(renderPatch(patch, 48000)).toHaveLength(Math.round(0.25 * 48000))
  })

  it('opens and closes on silence, so nothing clicks at either end', () => {
    for (const preset of PRESETS) {
      const samples = renderPatch(preset.build(), SAMPLE_RATE)
      expect(Math.abs(samples[0] ?? 1)).toBe(0)
      expect(Math.abs(samples[samples.length - 1] ?? 1)).toBe(0)
    }
  })

  it('never leaves full scale and never goes non-finite', () => {
    for (const preset of PRESETS) {
      const samples = renderPatch(preset.build(), SAMPLE_RATE)
      for (let i = 0; i < samples.length; i += 1) {
        const value = samples[i] ?? 0
        expect(Number.isFinite(value)).toBe(true)
        expect(Math.abs(value)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('makes a sound for every preset', () => {
    for (const preset of PRESETS) {
      expect(peak(renderPatch(preset.build(), SAMPLE_RATE))).toBeGreaterThan(0.05)
    }
  })

  it('renders silence when every layer is off', () => {
    const patch = { ...coin(), layers: [silentLayer(), silentLayer(), silentLayer()] }
    expect(peak(renderPatch(patch, SAMPLE_RATE))).toBe(0)
  })

  it('ignores a layer whose offset lands past the end rather than failing', () => {
    const patch = { ...coin(), duration: 0.2, layers: [makeLayer({ offset: 5 }), silentLayer(), silentLayer()] }
    const samples = renderPatch(patch, SAMPLE_RATE)
    expect(samples).toHaveLength(Math.round(0.2 * SAMPLE_RATE))
    expect(peak(samples)).toBe(0)
  })

  it('survives a patch built out of nonsense', () => {
    const patch = {
      ...coin(),
      duration: 0,
      seed: -1,
      layers: [makeLayer({ gain: 1e6, pitch: { start: -50, slide: 900 }, amp: { attack: -1, decay: -1, release: -1 } })],
    }
    const samples = renderPatch(patch, SAMPLE_RATE)
    for (let i = 0; i < samples.length; i += 1) expect(Number.isFinite(samples[i] ?? 0)).toBe(true)
  })

  it('holds its level when the rate changes, so a preset sounds the same at 48k', () => {
    const at44 = peak(renderPatch(coin(), 44100))
    const at48 = peak(renderPatch(coin(), 48000))
    expect(Math.abs(at44 - at48)).toBeLessThan(0.12)
  })
})
