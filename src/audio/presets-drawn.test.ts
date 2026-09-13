import { describe, expect, it } from 'vitest'
import { renderPatch } from './dsp/render'
import { applyMacros, macrosOf, setMacroValue } from './macros'
import { sanitizeAudioPatch } from './patch'
import { DRAWN_PRESETS } from './presets-drawn'
import { mutatePatch } from './shuffle'
import type { Stereo } from './types'

const RATE = 16000

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

describe('drawn presets', () => {
  it('gives each demonstration a name of its own and a seed you can draw again', () => {
    const ids = DRAWN_PRESETS.map((preset) => preset.id)
    const labels = DRAWN_PRESETS.map((preset) => preset.label)
    expect(new Set(ids).size).toBe(DRAWN_PRESETS.length)
    expect(new Set(labels).size).toBe(DRAWN_PRESETS.length)
    for (const preset of DRAWN_PRESETS) {
      expect(preset.build().seed).toBeGreaterThan(0)
    }
  })

  it.each(DRAWN_PRESETS)('$label round-trips, stays playable, and mutates as itself', (preset) => {
    const patch = { ...preset.build(), seed: preset.build().seed }
    const stored = sanitizeAudioPatch(JSON.parse(JSON.stringify(patch)))
    expect(stored.duration).toBe(patch.duration)
    expect(stored.seed).toBe(patch.seed)
    const macros = macrosOf(preset.rig(patch), patch)
    const active = macros.filter((slot) => slot.destinations.length)
    expect(active.length).toBeGreaterThanOrEqual(3)
    expect(active.every((slot) => slot.renamed && slot.label.trim().length > 0)).toBe(true)
    const baseline = renderPatch(stored, RATE, 128)
    const maximum = peak(baseline)
    expect(Number.isFinite(maximum), `${preset.label}: finite`).toBe(true)
    expect(maximum, `${preset.label}: audible`).toBeGreaterThan(0.05)
    expect(maximum, `${preset.label}: headroom`).toBeLessThan(0.98)
    const moved = mutatePatch(stored, 11, { amount: 'subtle', target: 'balanced' })
    expect(moved.duration).toBe(stored.duration)
    expect(moved.seed).toBe(stored.seed)
    expect(moved.layers.map((layer) => layer.source.kind)).toEqual(stored.layers.map((layer) => layer.source.kind))
    expect(moved).not.toEqual(stored)
    const first = applyMacros(stored, setMacroValue(macros, 0, 0), undefined, 0)
    const last = applyMacros(stored, setMacroValue(macros, 0, 1), undefined, 0)
    expect(difference(renderPatch(first, RATE), renderPatch(last, RATE)), `${active[0]!.label} is audible`).toBeGreaterThan(1e-4)
  }, 40_000)
})
