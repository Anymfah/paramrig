import { describe, expect, it } from 'vitest'
import { renderPatch } from './dsp/render'
import { applyMacros, macrosOf, setMacroValue } from './macros'
import { sanitizeAudioPatch } from './patch'
import { MECHANICAL_PRESETS } from './presets-mechanical'
import type { Stereo } from './types'

const RATE = 48000

function peak(audio: Stereo): number {
  let value = 0
  for (const channel of [audio.left, audio.right]) {
    for (const sample of channel) value = Math.max(value, Math.abs(sample))
  }
  return value
}

function difference(a: Stereo, b: Stereo): number {
  let sum = 0
  for (let i = 0; i < a.left.length; i++) {
    sum += (a.left[i]! - b.left[i]!) ** 2 + (a.right[i]! - b.right[i]!) ** 2
  }
  return Math.sqrt(sum / (a.left.length * 2))
}

function expectPlayable(audio: Stereo, label: string): void {
  const maximum = peak(audio)
  expect(Number.isFinite(maximum), `${label}: finite output`).toBe(true)
  expect(maximum, `${label}: audible output`).toBeGreaterThan(0.05)
  expect(maximum, `${label}: stereo headroom`).toBeLessThan(0.98)
  for (const channel of [audio.left, audio.right]) {
    expect(Math.abs(channel[0]!)).toBe(0)
    expect(Math.abs(channel.at(-1)!)).toBe(0)
  }
}

describe('mechanical presets', () => {
  it('calibrates the signal checks against known samples', () => {
    const quiet = { left: new Float32Array(4), right: new Float32Array(4) }
    const quarter = { left: new Float32Array([0.25, -0.25, 0.25, -0.25]), right: new Float32Array([0.25, -0.25, 0.25, -0.25]) }
    expect(peak(quiet)).toBe(0)
    expect(peak(quarter)).toBe(0.25)
    expect(difference(quiet, quarter)).toBe(0.25)
    expect(peak({ left: new Float32Array([NaN]), right: new Float32Array([0]) })).toBeNaN()
  })

  it.each(MECHANICAL_PRESETS)('$label survives saving and its macros change the signal with headroom', (preset) => {
    // The editor preserves the document's seed when changing presets.
    const patch = { ...preset.build(), seed: 1 }
    const stored = sanitizeAudioPatch(JSON.parse(JSON.stringify(patch)))
    expect(stored).toEqual(patch)
    const macros = macrosOf(preset.rig(patch), patch)
    const active = macros.filter((slot) => slot.destinations.length)
    expect(active).toHaveLength(4)
    const baseline = renderPatch(stored, RATE, 128)
    expectPlayable(baseline, preset.label)
    for (const seed of [7, 21]) expectPlayable(renderPatch({ ...stored, seed }, RATE), `${preset.label}: seed ${seed}`)
    expect(difference(baseline, renderPatch(applyMacros(stored, macros), RATE))).toBeLessThan(1e-5)

    for (let index = 0; index < active.length; index++) {
      for (const value of [0, 1]) {
        const changed = applyMacros(stored, setMacroValue(macros, index, value), undefined, index)
        const audio = renderPatch(changed, RATE)
        expectPlayable(audio, `${preset.label}: ${active[index]!.label} = ${value}`)
        expect(difference(baseline, audio), `${active[index]!.label} changes the signal`).toBeGreaterThan(1e-4)
      }
    }
    for (const value of [0, 1]) {
      const extreme = macros.map((slot) => ({ ...slot, value }))
      expectPlayable(renderPatch(applyMacros(stored, extreme), RATE), `${preset.label}: combined extremes`)
    }
  }, 45_000)
})
