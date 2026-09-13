import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_GROUPS } from '@/audio/presets'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import type { AudioPatch } from '@/audio/types'

/**
 * The family that could not be written before.
 *
 * The rest of the library is guarded by the sweeps in `render.test.ts` — silence at both ends,
 * inside full scale, audible — and these are guarded by those too. What is checked here is the
 * other thing: that the sounds still reach for the subsystems they exist to show. A change that
 * quietly turned every wavetable back into a square would pass every other test in the repository.
 */

// Measured at the rate a file is exported at: a one-millisecond strike lands on fewer samples at
// half of it, so a bell that is right at forty-four reads as quiet at twenty-two.
const RATE = 44100
const morph = PRESETS.filter((preset) => preset.group === 'Morph')
const built = morph.map((preset) => ({ id: preset.id, patch: preset.build() }))

const layers = (patch: AudioPatch) => patch.layers.filter((layer) => layer.enabled)
const slots = (patch: AudioPatch) => layers(patch).flatMap((layer) => [layer.insertA, layer.insertB, layer.insertC])

describe('the Morph family', () => {
  it('is a family the browser can show, with a sound each', () => {
    expect(PRESET_GROUPS).toContain('Morph')
    expect(morph.length).toBeGreaterThanOrEqual(14)
    expect(new Set(morph.map((preset) => preset.id)).size).toBe(morph.length)
  })

  it('plays a wavetable, which nothing else in the library does', () => {
    const tables = built.filter(({ patch }) => layers(patch).some((layer) => layer.source.kind === 'table'))
    expect(tables.length).toBeGreaterThanOrEqual(4)
    // And more than one of them, or it is a demonstration of one table rather than of wavetables.
    const named = new Set(tables.flatMap(({ patch }) => layers(patch).filter((l) => l.source.kind === 'table').map((l) => l.source.table)))
    expect(named.size).toBeGreaterThanOrEqual(4)
  })

  it('reaches every one of the filter models the plate offers past the first three', () => {
    const kinds = new Set(built.flatMap(({ patch }) => layers(patch).flatMap((layer) => [layer.filterA.kind, layer.filterB.kind])))
    for (const model of ['ladder', 'notch', 'peak', 'formant']) expect(kinds, model).toContain(model)
  })

  it('puts the two filters in both of the arrangements that are not one filter', () => {
    const ways = new Set(built.flatMap(({ patch }) => layers(patch).map((layer) => layer.routing)))
    for (const way of ['series', 'parallel']) expect(ways, way).toContain(way)
  })

  it('holds every insert kind that is not a migrated one', () => {
    const kinds = new Set(built.flatMap(({ patch }) => slots(patch).map((slot) => slot.kind)))
    for (const kind of ['ring', 'fold', 'comb', 'crusher', 'body', 'drive']) expect(kinds, kind).toContain(kind)
  })

  it('puts a layer through another layer, and the three effects that were not there', () => {
    expect(built.some(({ patch }) => layers(patch).some((layer) => layer.source.pmFrom !== 'internal'))).toBe(true)
    const effects = new Set(built.flatMap(({ patch }) => [patch.fx.x, patch.fx.y, patch.fx.z].map((slot) => slot.kind)))
    for (const kind of ['chorus', 'phaser', 'widener']) expect(effects, kind).toContain(kind)
  })

  it('draws a performer on a grid, with a step held', () => {
    const drawn = built.flatMap(({ patch }) => patch.performers.filter((performer) => performer.enabled))
    expect(drawn.some((performer) => performer.grid >= 2)).toBe(true)
    expect(drawn.some((performer) => performer.curves.some((row) => row.some((one) => one < 1)))).toBe(true)
  })

  it('sits where the rest of the library sits, loud enough to hear and short of the ceiling', () => {
    for (const { id, patch } of built) {
      const out = monoSum(renderPatch(patch, RATE))
      let peak = 0
      let energy = 0
      for (const value of out) {
        peak = Math.max(peak, Math.abs(value))
        energy += value * value
      }
      const rms = Math.sqrt(energy / out.length)
      expect(peak, `${id} is too quiet to sit beside the others`).toBeGreaterThan(0.25)
      expect(peak, `${id} is at the ceiling`).toBeLessThan(0.96)
      expect(rms, `${id} is a click with nothing behind it`).toBeGreaterThan(0.005)
    }
  }, 20_000)
})
