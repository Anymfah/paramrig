import { LAYER_COUNT, MOD_COUNT, PERFORMER_COUNT, SCENE_COUNT, STEP_COUNT } from '@/audio/fields'
import { describe, expect, it } from 'vitest'
import { PATCH_VERSION, defaultPatch, makeLayer, makePatch, sanitizeAudioPatch, silentLayer } from '@/audio/patch'
import { coin } from '@/audio/presets'

describe('makePatch', () => {
  it('always has as many layers as the instrument has, padding with silent ones', () => {
    const patch = makePatch(0.3, [makeLayer()])
    expect(patch.layers).toHaveLength(LAYER_COUNT)
    expect(patch.layers[1]?.enabled).toBe(false)
  })
})

describe('sanitizeAudioPatch', () => {
  it('reads a patch it wrote back unchanged', () => {
    const before = coin()
    expect(sanitizeAudioPatch(JSON.parse(JSON.stringify(before)))).toEqual(before)
  })

  it('gives a default patch for anything that is not one', () => {
    for (const value of [null, undefined, 4, 'patch', []]) {
      expect(sanitizeAudioPatch(value)).toEqual(defaultPatch())
    }
  })

  it('holds every number to its field rather than refusing the file', () => {
    const patch = sanitizeAudioPatch({
      duration: 900,
      seed: 3,
      layers: [{ gain: -12, pitch: { start: 1e9 }, filter: { cutoff: -4, kind: 'trapdoor' } }],
      fx: { delayFeedback: 4, tone: -80 },
      master: { gain: 1e6 },
    })
    expect(patch.duration).toBe(4)
    expect(patch.layers[0]?.gain).toBe(0)
    expect(patch.layers[0]?.pitch.start).toBe(12000)
    expect(patch.layers[0]?.filter.cutoff).toBe(20)
    expect(patch.layers[0]?.filter.kind).toBe('off')
    expect(patch.fx.delayFeedback).toBe(0.95)
    expect(patch.fx.tone).toBe(-1)
    expect(patch.master.gain).toBe(3)
  })

  it('keeps a curve that is one and replaces a curve that is not', () => {
    const good = { type: 'cubic-bezier', p0: [0, 0], p1: [0.2, 1], p2: [0.4, 1], p3: [1, 1] }
    expect(sanitizeAudioPatch({ layers: [{ pitch: { slideCurve: good } }] }).layers[0]?.pitch.slideCurve).toEqual(good)
    const bad = sanitizeAudioPatch({ layers: [{ pitch: { slideCurve: { type: 'spiral' } } }] })
    expect(bad.layers[0]?.pitch.slideCurve.type).toBe('cubic-bezier')
  })

  it('pads a short layer list and ignores extra layers', () => {
    expect(sanitizeAudioPatch({ layers: [] }).layers).toHaveLength(LAYER_COUNT)
    expect(sanitizeAudioPatch({ layers: [{}, {}, {}, {}, {}, {}] }).layers).toHaveLength(LAYER_COUNT)
  })

  it('never comes back with a non-finite number in it', () => {
    const patch = sanitizeAudioPatch({ duration: NaN, seed: Infinity, layers: [{ gain: NaN }], master: { gain: -Infinity } })
    expect(Number.isFinite(patch.duration)).toBe(true)
    expect(Number.isFinite(patch.seed)).toBe(true)
    expect(Number.isFinite(patch.layers[0]?.gain ?? NaN)).toBe(true)
    expect(Number.isFinite(patch.master.gain)).toBe(true)
  })
})

describe('silentLayer', () => {
  it('is a layer that is switched off', () => {
    expect(silentLayer().enabled).toBe(false)
  })
})

describe('the performers', () => {
  it('are three, off and at rest, with twelve empty rows each, and the patch plays the first row', () => {
    const read = sanitizeAudioPatch({})
    expect(read.performers).toHaveLength(PERFORMER_COUNT)
    expect(read.scene).toBe(0)
    for (const performer of read.performers) {
      expect(performer).toMatchObject({ enabled: false, target: 'off', shape: 'step', bipolar: false })
      expect(performer.patterns).toHaveLength(SCENE_COUNT)
      expect(performer.patterns.every((row) => row.length === STEP_COUNT && row.every((level) => level === 0))).toBe(true)
    }
  })

  it('keep what a file drew, held to the floor and the top, and pad what it did not', () => {
    const read = sanitizeAudioPatch({ scene: 4, performers: [{ enabled: true, target: 'layers[0].cutoff', shape: 'curve', bipolar: true, patterns: [[0.5, 2, -1, 'x']] }] })
    expect(read.scene).toBe(4)
    expect(read.performers[0]).toMatchObject({ enabled: true, target: 'layers[0].cutoff', shape: 'curve', bipolar: true })
    expect(read.performers[0]?.patterns[0]?.slice(0, 4)).toEqual([0.5, 1, 0, 0])
    expect(read.performers[0]?.patterns[0]).toHaveLength(STEP_COUNT)
    expect(read.performers[0]?.patterns).toHaveLength(SCENE_COUNT)
    expect(read.performers[1]?.enabled).toBe(false)
  })
})

describe('the modulation slots', () => {
  it('are eight, off and pointed at nothing, two envelopes then six oscillators', () => {
    const read = sanitizeAudioPatch({})
    expect(read.mods).toHaveLength(MOD_COUNT)
    expect(read.mods.map((slot) => slot.kind)).toEqual(['envelope', 'envelope', 'lfo', 'lfo', 'lfo', 'lfo', 'lfo', 'lfo'])
    expect(read.mods.every((slot) => !slot.enabled && slot.target === 'off')).toBe(true)
  })

  it('hold the settings of the kind they are not, so switching and switching back loses nothing', () => {
    const read = sanitizeAudioPatch({ mods: [{ kind: 'lfo', rate: 12, decay: 0.44 }] })
    expect(read.mods[0]).toMatchObject({ kind: 'lfo', rate: 12, decay: 0.44 })
  })

  it('carries a patch written as two lists into the one, in the order the bar showed', () => {
    const older = {
      version: 1,
      envelopes: [{ enabled: true, target: 'layers[1].cutoff', depth: -0.4, decay: 0.3 }, {}],
      lfos: [{ enabled: true, shape: 'square', rate: 9, target: 'layers[0].gain' }, {}, {}, {}, {}, {}],
    }
    const read = sanitizeAudioPatch(older)
    expect(read.version).toBe(PATCH_VERSION)
    // The first free envelope was E2 and is the first slot; the first oscillator was L4, the third.
    expect(read.mods[0]).toMatchObject({ kind: 'envelope', enabled: true, target: 'layers[1].cutoff', depth: -0.4, decay: 0.3 })
    expect(read.mods[2]).toMatchObject({ kind: 'lfo', enabled: true, shape: 'square', rate: 9, target: 'layers[0].gain' })
    expect(read.mods[1]?.kind).toBe('envelope')
    expect(read.mods[3]?.kind).toBe('lfo')
  })
})

describe('carrying an older patch forward', () => {
  it('stamps what this build writes, whatever the file claimed', () => {
    expect(sanitizeAudioPatch({}).version).toBe(PATCH_VERSION)
    expect(sanitizeAudioPatch({ version: 0 }).version).toBe(PATCH_VERSION)
    expect(sanitizeAudioPatch({ version: 'yesterday' }).version).toBe(PATCH_VERSION)
  })

  it('reads a patch from a version it does not know as the current shape rather than dropping it', () => {
    const read = sanitizeAudioPatch({ version: 99, duration: 0.3, seed: 7 })
    expect(read.duration).toBeCloseTo(0.3, 6)
    expect(read.seed).toBe(7)
  })

  it('keeps what an older file said while it carries it forward', () => {
    const read = sanitizeAudioPatch({ version: 1, layers: [{ gain: 0.25, pitch: { start: 220 } }] })
    expect(read.layers[0]?.gain).toBeCloseTo(0.25, 6)
    expect(read.layers[0]?.pitch.start).toBeCloseTo(220, 6)
  })
})
