import { describe, expect, it } from 'vitest'
import { mutatePatch, randomPatch } from '@/audio/shuffle'
import { LAYER_SECTIONS, AUDIO_FIELDS, type LayerSection } from '@/audio/fields'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import { coin } from '@/audio/presets'

const SAMPLE_RATE = 22050
const peak = (samples: Float32Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0)

/** Every number in a patch, so a test can assert the whole thing is inside its declared ranges. */
function offences(patch: ReturnType<typeof randomPatch>): string[] {
  const found: string[] = []
  const check = (table: Record<string, { type: string; min?: number; max?: number }>, source: Record<string, unknown>, path: string) => {
    for (const [field, spec] of Object.entries(table)) {
      if (spec.type !== 'number') continue
      const value = source[field]
      if (typeof value !== 'number' || !Number.isFinite(value)) { found.push(`${path}.${field} is not a number`); continue }
      if (value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity)) found.push(`${path}.${field} = ${value}`)
    }
  }
  check(AUDIO_FIELDS.patch, patch as unknown as Record<string, unknown>, 'patch')
  check(AUDIO_FIELDS.fx, patch.fx as unknown as Record<string, unknown>, 'fx')
  check(AUDIO_FIELDS.master, patch.master as unknown as Record<string, unknown>, 'master')
  patch.layers.forEach((layer, index) => {
    for (const section of Object.keys(LAYER_SECTIONS) as LayerSection[]) {
      const source = (section === 'root' ? layer : layer[section]) as unknown as Record<string, unknown>
      check(LAYER_SECTIONS[section], source, `layers[${index}].${section}`)
    }
  })
  return found
}

describe('randomPatch', () => {
  it('gives the same patch back for the same seed', () => {
    expect(randomPatch(7)).toEqual(randomPatch(7))
    expect(randomPatch(7)).not.toEqual(randomPatch(8))
  })

  it('never leaves a field outside its declared range', () => {
    for (let seed = 0; seed < 60; seed += 1) expect(offences(randomPatch(seed)), `seed ${seed}`).toEqual([])
  })

  it('always has a first layer switched on, so it always makes a sound', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      expect(randomPatch(seed).layers[0]?.enabled, `seed ${seed}`).toBe(true)
    }
  })

  /**
   * The claim the file makes about itself. A uniform draw lands outside every musical range at
   * once and produces silence or noise; these have to be audible and not clipped, every time.
   */
  it('makes an audible, unclipped sound on every seed', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const loudest = peak(monoSum(renderPatch(randomPatch(seed), SAMPLE_RATE)))
      expect(loudest, `seed ${seed} is silent`).toBeGreaterThan(0.05)
      expect(loudest, `seed ${seed} clips`).toBeLessThanOrEqual(1)
    }
  })

  it('stays inside a length worth calling an effect', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const { duration } = randomPatch(seed)
      expect(duration).toBeGreaterThanOrEqual(0.09)
      expect(duration).toBeLessThanOrEqual(1.2)
    }
  })
})

describe('mutatePatch', () => {
  it('gives the same result for the same seed', () => {
    expect(mutatePatch(coin(), 3)).toEqual(mutatePatch(coin(), 3))
  })

  it('moves the sound without becoming another one', () => {
    const before = coin()
    const after = mutatePatch(before, 5)
    expect(after).not.toEqual(before)
    // Switches and options are what make a sound a different sound, so they are left alone.
    expect(after.layers[0]?.source.wave).toBe(before.layers[0]?.source.wave)
    expect(after.layers[0]?.enabled).toBe(before.layers[0]?.enabled)
    expect(after.layers[1]?.filter.kind).toBe(before.layers[1]?.filter.kind)
  })

  it('never leaves a field outside its range, however much it is asked to move', () => {
    let patch = coin()
    for (let step = 0; step < 40; step += 1) {
      patch = mutatePatch(patch, step, 0.9)
      expect(offences(patch), `step ${step}`).toEqual([])
    }
  })

  it('does not mutate the patch it was given', () => {
    const before = coin()
    const copy = structuredClone(before)
    mutatePatch(before, 11)
    expect(before).toEqual(copy)
  })
})
