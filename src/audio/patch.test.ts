import { LAYER_COUNT, MOD_ENVELOPE_COUNT, LFO_COUNT, PERFORMER_COUNT, SCENE_COUNT, STEP_COUNT } from '@/audio/fields'
import { describe, expect, it } from 'vitest'
import { defaultPatch, makeLayer, makePatch, sanitizeAudioPatch, silentLayer } from '@/audio/patch'
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

describe('the free envelopes', () => {
  it('are always there, off and pointed at nothing, however old the patch', () => {
    const read = sanitizeAudioPatch({ version: 1, duration: 0.5 })
    expect(read.envelopes).toHaveLength(MOD_ENVELOPE_COUNT)
    expect(read.envelopes.every((envelope) => !envelope.enabled && envelope.target === 'off')).toBe(true)
    expect(read.lfos).toHaveLength(LFO_COUNT)
  })

  it('keep what a patch says about them', () => {
    const written = makePatch(0.5, [], {}, {}, 1, [], [{ enabled: true, target: 'layers[1].cutoff', depth: -0.4 }])
    const read = sanitizeAudioPatch(JSON.parse(JSON.stringify(written)))
    expect(read.envelopes[0]).toMatchObject({ enabled: true, target: 'layers[1].cutoff', depth: -0.4 })
  })
})
