import { describe, expect, it } from 'vitest'
import { mutatePatch, mutateSound, randomPatch } from '@/audio/shuffle'
import { SOUND_FAMILIES, chooseFamily } from '@/audio/shuffle-architectures'
import { mulberry32 } from '@/audio/dsp/rng'
import { LAYER_SECTIONS, AUDIO_FIELDS, FX_SLOTS, type LayerSection } from '@/audio/fields'
import { renderPatch } from '@/audio/dsp/render'
import { applyMacros, bindMacro, emptyMacros, impliedDestinationAmount, inactiveMacroDestinations, macroIsParked, prepareMacroMove, reanchorMacro, syncMacrosToPatch } from '@/audio/macros'
import { coin } from '@/audio/presets'
import { TABLE_NAMES } from '@/audio/dsp/wavetable'

const SAMPLE_RATE = 16000
const peak = (samples: Float32Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0)

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
  for (const slot of FX_SLOTS) check(AUDIO_FIELDS.fxSlot, patch.fx[slot] as unknown as Record<string, unknown>, `fx.${slot}`)
  patch.mods.forEach((mod, index) => check(AUDIO_FIELDS.mod, mod as unknown as Record<string, unknown>, `mods[${index}]`))
  patch.performers.forEach((performer, index) => check(AUDIO_FIELDS.performer, performer as unknown as Record<string, unknown>, `performers[${index}]`))
  patch.layers.forEach((layer, index) => {
    for (const section of Object.keys(LAYER_SECTIONS) as LayerSection[]) {
      const source = (section === 'root' ? layer : layer[section]) as unknown as Record<string, unknown>
      check(LAYER_SECTIONS[section], source, `layers[${index}].${section}`)
    }
  })
  return found
}

const draw = (seed: number) => randomPatch(seed, SAMPLE_RATE, { settle: false })

describe('randomPatch', () => {
  it('gives the same patch back for the same seed', () => {
    expect(randomPatch(7, SAMPLE_RATE, { settle: false })).toEqual(randomPatch(7, SAMPLE_RATE, { settle: false }))
    expect(randomPatch(7, SAMPLE_RATE, { settle: false })).not.toEqual(randomPatch(8, SAMPLE_RATE, { settle: false }))
  })

  it('never leaves a field outside its declared range', () => {
    for (let seed = 0; seed < 80; seed += 1) expect(offences(draw(seed)), `seed ${seed}`).toEqual([])
  })

  it('always has at least one layer switched on', () => {
    for (let seed = 0; seed < 80; seed += 1) {
      expect(draw(seed).layers.some((layer) => layer.enabled), `seed ${seed}`).toBe(true)
    }
  })

  it('does not mutate a caller-owned object', () => {
    const first = draw(11)
    const copy = structuredClone(first)
    randomPatch(11, SAMPLE_RATE, { settle: false })
    expect(first).toEqual(copy)
  })

  it('can run for several seconds and use all four layers', () => {
    const long = [...Array(80).keys()].map(draw).filter((patch) => patch.duration >= 1.5)
    const full = [...Array(80).keys()].map(draw).filter((patch) => patch.layers.filter((layer) => layer.enabled).length === 4)
    expect(long.length).toBeGreaterThan(4)
    expect(full.length).toBeGreaterThan(2)
  })

  it('spreads Any across the six families', () => {
    const counts = Object.fromEntries(SOUND_FAMILIES.map((family) => [family, 0])) as Record<string, number>
    for (let seed = 0; seed < 600; seed += 1) {
      const family = chooseFamily(mulberry32(seed), 'any')
      counts[family] = (counts[family] ?? 0) + 1
    }
    for (const family of SOUND_FAMILIES) {
      expect(counts[family], family).toBeGreaterThan(40)
    }
  })

  it('visits the major modules across seeds', () => {
    const patches = [...Array(120).keys()].map(draw)
    expect(patches.some((patch) => patch.layers.some((layer) => layer.enabled && layer.source.kind === 'table' && TABLE_NAMES.includes(layer.source.table)))).toBe(true)
    expect(patches.some((patch) => patch.layers.some((layer) => layer.enabled && layer.source.fmIndex > 0.4))).toBe(true)
    expect(patches.some((patch) => patch.layers.some((layer) => layer.enabled && layer.source.pmFrom.startsWith('layer')))).toBe(true)
    expect(patches.some((patch) => patch.layers.some((layer) => layer.enabled && layer.routing !== 'single'))).toBe(true)
    expect(patches.some((patch) => patch.layers.some((layer) => layer.enabled && layer.filterA.kind === 'formant'))).toBe(true)
    expect(patches.some((patch) => patch.layers.some((layer) => layer.insertA.kind === 'ring' || layer.insertB.kind === 'ring'))).toBe(true)
    expect(patches.some((patch) => patch.layers.some((layer) => [layer.insertA, layer.insertB, layer.insertC].some((slot) => slot.kind === 'fold')))).toBe(true)
    expect(patches.some((patch) => patch.layers.some((layer) => layer.insertC.kind === 'body' && layer.insertC.profile && layer.insertC.profile !== 'bar'))).toBe(true)
    expect(patches.some((patch) => patch.mods.some((mod) => mod.enabled && mod.target !== 'off'))).toBe(true)
    expect(patches.some((patch) => patch.performers.some((performer) => performer.enabled && performer.target !== 'off'))).toBe(true)
    expect(patches.some((patch) => ['chorus', 'phaser', 'widener'].includes(patch.fx.x.kind) || ['chorus', 'phaser', 'widener'].includes(patch.fx.y.kind))).toBe(true)
    expect(Math.max(...patches.map((patch) => patch.duration))).toBeGreaterThan(2)
  })

  it('makes a sound you can hear and cannot clip, on a representative corpus', () => {
    for (const seed of [0, 3, 7, 11, 18, 25, 40, 55]) {
      const patch = randomPatch(seed, SAMPLE_RATE)
      const stereo = renderPatch(patch, SAMPLE_RATE)
      const left = peak(stereo.left)
      const right = peak(stereo.right)
      expect(Math.max(left, right), `seed ${seed} is silent`).toBeGreaterThan(0.05)
      expect(left, `seed ${seed} left clips`).toBeLessThanOrEqual(1)
      expect(right, `seed ${seed} right clips`).toBeLessThanOrEqual(1)
      expect(Number.isFinite(left) && Number.isFinite(right)).toBe(true)
    }
  }, 60_000)

  it('stays inside the engine’s length', () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const { duration } = draw(seed)
      expect(duration).toBeGreaterThanOrEqual(0.02)
      expect(duration).toBeLessThanOrEqual(4)
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
    expect(after.layers[0]?.source.wave).toBe(before.layers[0]?.source.wave)
    expect(after.layers[0]?.enabled).toBe(before.layers[0]?.enabled)
    expect(after.layers[1]?.filterA.kind).toBe(before.layers[1]?.filterA.kind)
    expect(after.duration).toBe(before.duration)
    expect(after.seed).toBe(before.seed)
    expect(after.scene).toBe(before.scene)
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

  it('leaves disabled modules asleep', () => {
    const before = coin()
    const silent = before.layers[3]
    expect(silent?.enabled).toBe(false)
    const after = mutatePatch(before, 9, { amount: 'strong', target: 'timbre' })
    expect(after.layers[3]).toEqual(silent)
  })

  it('does not raise a zero depth in subtle', () => {
    const before = coin()
    expect(before.layers[0]?.source.fmIndex).toBe(0)
    const after = mutatePatch(before, 4, { amount: 'subtle', target: 'timbre' })
    expect(after.layers[0]?.source.fmIndex).toBe(0)
  })

  it('keeps Timbre away from envelopes and Space away from filters', () => {
    const before = coin()
    const timbre = mutatePatch(before, 8, { amount: 'medium', target: 'timbre' })
    expect(timbre.layers[0]?.amp).toEqual(before.layers[0]?.amp)
    const space = mutatePatch(before, 8, { amount: 'medium', target: 'space' })
    expect(space.layers[0]?.filterA.cutoff).toBe(before.layers[0]?.filterA.cutoff)
    expect(space.layers[0]?.amp).toEqual(before.layers[0]?.amp)
  })
})

describe('what a variation leaves alone', () => {
  it('never moves the length, the seed or the pattern, however many times it is asked', () => {
    let patch = coin()
    const { duration, seed, scene } = patch
    for (let step = 0; step < 25; step += 1) patch = mutatePatch(patch, step, 0.4)
    expect(patch.duration).toBe(duration)
    expect(patch.seed).toBe(seed)
    expect(patch.scene).toBe(scene)
  })

  it('moves what the sound is made of, including the parts that move it', () => {
    const before = coin()
    const after = mutatePatch(before, 5, { amount: 'medium', target: 'balanced' })
    expect(after.master.gain).not.toBe(before.master.gain)
    const moved = (a: object, b: object) => JSON.stringify(a) !== JSON.stringify(b)
    expect(moved(after.layers[0]!.source, before.layers[0]!.source) || moved(after.layers[0]!.filterA, before.layers[0]!.filterA) || moved(after.fx, before.fx)).toBe(true)
  })

  it('comes back at about the level it went in at, and never clipped', () => {
    const loudest = (patch: ReturnType<typeof coin>) => {
      const stereo = renderPatch(patch, SAMPLE_RATE)
      return Math.max(peak(stereo.left), peak(stereo.right))
    }
    let patch = coin()
    const before = loudest(patch)
    for (let step = 0; step < 8; step += 1) {
      patch = mutatePatch(patch, step, undefined, SAMPLE_RATE)
      const now = loudest(patch)
      expect(now, `step ${step}`).toBeLessThanOrEqual(1)
      expect(now, `step ${step}`).toBeGreaterThan(before * 0.35)
      expect(now, `step ${step}`).toBeLessThan(before * 2.8)
    }
  }, 30_000)
})

describe('macros after a draw', () => {
  it('does not double-mutate a macro’s destinations', () => {
    const patch = coin()
    let table = bindMacro(emptyMacros(), 0, 'layers[0].filterA.cutoff', patch)
    table = bindMacro(table, 0, 'fx.tone', patch)
    const cutoff = patch.layers[0]!.filterA.cutoff
    const result = mutateSound(patch, 6, { amount: 'medium', target: 'timbre', macros: table }, SAMPLE_RATE)
    const dests = result.macros![0]!.destinations.map((dest) => dest.property)
    expect(dests).toEqual(['layers[0].filterA.cutoff', 'fx.tone'])
    expect(result.patch.layers[0]!.filterA.cutoff).not.toBe(cutoff)
  })

  it('parks a mapped macro when the patch no longer sits on one amount, then resumes without a jump', () => {
    const patch = coin()
    let table = bindMacro(emptyMacros(), 0, 'layers[0].filterA.cutoff', patch)
    table = bindMacro(table, 0, 'layers[0].gain', patch)
    const drawn = {
      ...patch,
      layers: patch.layers.map((layer, index) => (
        index === 0 ? { ...layer, gain: 0.12, filterA: { ...layer.filterA, cutoff: 220 } } : layer
      )),
    }
    const synced = syncMacrosToPatch(table, drawn)
    expect(macroIsParked(synced[0]!, drawn)).toBe(true)
    expect(inactiveMacroDestinations(synced[0]!, drawn).length).toBeGreaterThan(0)
    const moved = prepareMacroMove(synced, 0, synced[0]!.value, drawn)
    const heard = applyMacros(drawn, moved, undefined, 0)
    expect(heard.layers[0]!.gain).toBeCloseTo(0.12, 3)
    expect(heard.layers[0]!.filterA.cutoff).toBeCloseTo(220, 0)
    const anchored = reanchorMacro(synced[0]!, drawn)
    const atRest = impliedDestinationAmount(anchored.destinations[0]!, drawn.layers[0]!.filterA.cutoff, 'log')
    expect(Math.abs(atRest - synced[0]!.value)).toBeLessThan(0.08)
  })
})
