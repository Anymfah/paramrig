import { describe, expect, it } from 'vitest'
import { renderPatch } from '@paramrig/audio'
import { fft } from './analysis'
import { CHORD_LAYERS } from './harmony'
import { DEFAULT_DISCOVERY_CRITERIA, LAB_CHORDS, LAB_VOICINGS, labChordCatalog, chordIntervals, supportsChord,
  generateSound, describeLabRecipe, sanitizeCriteria, sanitizeLabSound, sanitizeLabSession,
  validateLabCriteria, labCriteriaKey, renderCandidate, createLabBatch, varySound, fuseSounds,
  type LabCriteria, type LabSound } from './sdk'

const fixed: LabCriteria = { ...DEFAULT_DISCOVERY_CRITERIA, type: 'keys', chord: 'major', voicing: 'close',
  rootNote: 60, material: 'wood', character: 'clean', minMs: 650, maxMs: 650 }
const hz = (note: number) => 440 * 2 ** ((note - 69) / 12)
function assertNotes(sound: LabSound, root: number, intervals: number[]) {
  CHORD_LAYERS.forEach((index, n) => {
    const layer = sound.patch.layers[index]!
    expect(layer.enabled).toBe(true)
    expect(layer.source.kind).not.toBe('noise')
    expect(layer.source.pmFrom).toBe('internal')
    expect(layer.pitch.start).toBeCloseTo(root * 2 ** (intervals[n]! / 12), 7)
    expect(layer.pitch.slide).toBe(0)
    expect(layer.pitch.arpeggioRatio).toBe(1)
    expect(sound.roles[index]).toBe('body')
  })
}

describe('musical harmony', () => {
  it('exposes isolated metadata and explicit close/open intervals', () => {
    expect(LAB_CHORDS).toEqual(['none', 'auto', 'major', 'minor', 'sus2', 'sus4', 'dissonant'])
    expect(LAB_VOICINGS).toEqual(['auto', 'close', 'open'])
    expect(chordIntervals('major', 'close')).toEqual([0, 4, 7])
    expect(chordIntervals('minor', 'open')).toEqual([0, 7, 15])
    expect(chordIntervals('sus4', 'open')).toEqual([0, 7, 17])
    const metadata = labChordCatalog()
    metadata[0]!.intervals[0] = 99 as never
    expect(labChordCatalog()[0]!.intervals[0]).toBe(0)
    expect(supportsChord('percussion', 'marimba')).toBe(true)
    expect(supportsChord('percussion', 'tom')).toBe(false)
  })

  it('validates intent, repairs stale imports and preserves old no-chord draws', () => {
    for (const input of [
      { chord: 'maj7' }, { chord: 'toString' }, { voicing: 'wide' }, { chord: 'none' },
      { type: 'engine' }, { type: 'percussion', subtype: 'tom' },
      { type: 'any', pool: { families: ['water', 'kick'] } },
      { type: 'any', subtype: 'bark' }, { type: 'any', gesture: 'fracture' },
    ]) expect(() => validateLabCriteria({ ...fixed, ...input }), JSON.stringify(input)).toThrow()
    for (const input of [{ type: 'engine' }, { type: 'any', pool: { families: ['water'] } }, { type: 'percussion', subtype: 'tom' }]) {
      const restored = sanitizeCriteria({ ...fixed, ...input })
      expect(restored.chord).toBeUndefined(); expect(restored.voicing).toBeUndefined()
      expect(() => validateLabCriteria(restored)).not.toThrow()
    }
    const stale = sanitizeCriteria({ ...fixed, type: 'any', gesture: 'fracture', pool: { families: ['keys', 'impact'] } })
    expect(stale).toMatchObject({ chord: 'major', gesture: 'auto' })
    expect(() => validateLabCriteria(stale)).not.toThrow()
    expect(labCriteriaKey(fixed)).not.toBe(labCriteriaKey({ ...fixed, chord: 'minor' }))
    expect(labCriteriaKey(fixed)).not.toBe(labCriteriaKey({ ...fixed, voicing: 'open' }))
    const old = { ...DEFAULT_DISCOVERY_CRITERIA, type: 'water' as const }
    expect(generateSound(old, 171).patch).toEqual(generateSound({ ...old, chord: 'none' }, 171).patch)
    expect(labCriteriaKey(old)).toBe(labCriteriaKey({ ...old, chord: 'none' }))
    expect(describeLabRecipe('discovery-v3/percussion/fm/chord/wood/clean/single-hit/tom/major/close')).toBeNull()
    expect(describeLabRecipe('discovery-v3/keys/fm/chord/wood/clean/strum/-/toString/open')).toBeNull()
  })

  it('keeps three actual notes at pitch boundaries across musical families, controls and voicings', () => {
    for (const type of ['bass', 'lead', 'pad', 'pluck', 'bell', 'keys', 'bowed', 'wind-instrument', 'choir', 'percussion'] as const) {
      for (const { id: chord } of labChordCatalog()) for (const voicing of ['close', 'open'] as const) for (const rootNote of [24, 60, 96]) {
        const sound = generateSound({ ...fixed, type, chord, voicing, rootNote, density: 0, texture: 'airy', material: 'rubber', character: 'alien' }, 171)
        assertNotes(sound, hz(rootNote), chordIntervals(chord, voicing))
        expect(sound.patch.layers[1]!.source.kind).toBe('noise')
        expect(describeLabRecipe(sound.origin.recipe)).toMatchObject({ family: type, layout: 'chord', chord, voicing })
      }
    }
    for (const register of ['low', 'mid', 'high', 'full'] as const) {
      const sound = generateSound({ ...fixed, rootNote: undefined, register, texture: 'pure', voicing: 'open' }, 7919)
      assertNotes(sound, sound.patch.layers[0]!.pitch.start, [0, 7, 16])
      expect(sound.patch.layers[1]!.pitch.start).toBe(sound.patch.layers[0]!.pitch.start)
    }
  }, 30000)

  it('draws Auto harmony only from compatible families/subtypes and keeps requested intent', () => {
    const recent: string[] = [], chords = new Set(), families = new Set(), subtypes = new Set()
    for (let seed = 0; seed < 40; seed++) {
      const criteria: LabCriteria = { ...fixed, type: 'any', chord: 'auto', voicing: 'auto', scale: 'minor', pool: { families: ['water', 'keys', 'percussion'] } }
      const sound = generateSound(criteria, 171 + seed * 7919, recent), recipe = describeLabRecipe(sound.origin.recipe)!
      expect(['keys', 'percussion']).toContain(recipe.family)
      expect(['minor', 'sus2', 'sus4']).toContain(recipe.chord)
      if (recipe.family === 'percussion') { expect(['marimba', 'vibraphone', 'handpan']).toContain(recipe.subtype); subtypes.add(recipe.subtype) }
      expect(sound.criteria).toMatchObject({ chord: 'auto', voicing: 'auto', type: 'any' })
      expect(generateSound(criteria, 171 + seed * 7919, recent)).toEqual(sound)
      chords.add(recipe.chord); families.add(recipe.family); recent.push(sound.origin.recipe)
    }
    expect(chords.size).toBe(3); expect(families.size).toBe(2); expect(subtypes.size).toBe(3)
  })

  it('renders all harmony qualities across timbres and duration extremes', () => {
    const cases: Partial<LabCriteria>[] = ['bass', 'lead', 'pad', 'pluck', 'bell', 'keys', 'bowed', 'wind-instrument', 'choir'].map((type) => ({ type: type as LabCriteria['type'] }))
    cases.push(...(['marimba', 'vibraphone', 'handpan'] as const).map((subtype) => ({ type: 'percussion' as const, subtype })))
    const rejected: string[] = []
    for (const [n, details] of cases.entries()) for (const [c, { id: chord }] of labChordCatalog().entries()) for (const voicing of ['close', 'open'] as const) {
      const criteria: LabCriteria = { ...fixed, ...details, chord, voicing,
        texture: ['auto', 'airy', 'vocal', 'pure', 'gritty'][c] as LabCriteria['texture'],
        material: ['glass', 'fabric', 'wood', 'electrical'][n % 4] as LabCriteria['material'],
        character: ['clean', 'corrupted', 'acoustic', 'ethereal'][n % 4] as LabCriteria['character'], density: c === 0 ? 0 : 1 }
      const result = renderCandidate(generateSound(criteria, 171 + n * 997 + c * 7919), 16000)
      if (!result) { rejected.push(`${details.type}/${details.subtype ?? '-'}/${chord}/${voicing}`); continue }
      expect(result.peak).toBeLessThan(0.99); expect(result.rms).toBeGreaterThan(0.001)
      assertNotes(result.sound, hz(60), chordIntervals(chord, voicing))
    }
    expect(rejected).toEqual([])
    for (const details of cases) for (const ms of [20, 4000]) {
      const result = createLabBatch({ mode: 'create', count: 1, seed: 7919, criteria: { ...fixed, ...details, minMs: ms, maxMs: ms, avoid: ['click', 'sub', 'piercing', 'reverb'] } }, 16000)
      expect(result.issue, `${details.type}/${ms}`).toBe('')
      expect(result.results[0]!.samples.left).toHaveLength(ms * 16)
    }
  }, 180000)

  it('measures all three audible notes using a calibrated spectrum probe', () => {
    const rate = 16000, size = 8192
    const energyAt = (samples: Float32Array, frequency: number) => {
      const re = Float32Array.from({ length: size }, (_, i) => samples[i + 1600]! * (0.5 - 0.5 * Math.cos(i * Math.PI * 2 / (size - 1))))
      const im = new Float32Array(size); fft(re, im)
      const centre = Math.round(frequency * size / rate)
      return [centre - 1, centre, centre + 1].reduce((sum, i) => sum + re[i]! ** 2 + im[i]! ** 2, 0)
    }
    const pure = Float32Array.from({ length: 24000 }, (_, i) => Math.sin(i * Math.PI * 2 * hz(60) / rate))
    expect(energyAt(pure, hz(60))).toBeGreaterThan(energyAt(pure, hz(64)) * 10000)
    for (const chord of ['major', 'minor', 'sus2', 'sus4', 'dissonant'] as const) {
      const generated = generateSound({ ...fixed, type: 'keys', gesture: 'sustain', chord, minMs: 1500, maxMs: 1500 }, 171)
      // Find the energy gained by each actual note, compared with the same saved patch muted at that voice.
      const full = renderPatch(generated.patch, rate)
      const mono = Float32Array.from(full.left, (v, i) => (v + full.right[i]!) * 0.5)
      for (const index of CHORD_LAYERS) {
        const muted = structuredClone(generated.patch); muted.layers[index]!.enabled = false
        const without = renderPatch(muted, rate)
        const other = Float32Array.from(without.left, (v, i) => (v + without.right[i]!) * 0.5)
        const frequency = generated.patch.layers[index]!.pitch.start
        expect(energyAt(mono, frequency), `${chord}/${index}`).toBeGreaterThan(energyAt(other, frequency) * 1.4)
      }
    }
  }, 30000)

  it('keeps chord tones through strums, arpeggiation, macros, variation and fusion', () => {
    for (const gesture of ['strum', 'arpeggiate'] as const) {
      const criteria: LabCriteria = { ...fixed, gesture, chord: 'minor', voicing: 'open', minMs: 1000, maxMs: 1000 }
      const reference = renderCandidate(generateSound(criteria, 171), 16000)!.sound
      assertNotes(reference, hz(60), [0, 7, 15])
      expect(reference.patch.performers.slice(0, 3).map((lane) => lane.target)).toEqual(['layers[0].gain', 'layers[2].gain', 'layers[3].gain'])
      expect(reference.patch.performers[0]!.patterns).not.toEqual(reference.patch.performers[2]!.patterns)
      const variant = varySound({ mode: 'vary', criteria, reference, seed: 7919, amount: 'strong', values: [0.1, 0.9, 0.2, 0.5] }, 7919)
      assertNotes(variant, hz(60), [0, 7, 15])
      expect(renderCandidate(variant, 16000)).not.toBeNull()
      const donor = generateSound({ ...DEFAULT_DISCOVERY_CRITERIA, type: 'texture', subtype: 'vinyl', material: 'air', character: 'clean', minMs: 1000, maxMs: 1000 }, 931)
      const before = structuredClone([reference, donor])
      const fused = fuseSounds({ mode: 'fuse', criteria, reference, contributor: donor, contribution: 'motion', seed: 999 }, 999)
      assertNotes(fused, hz(60), [0, 7, 15])
      expect([reference, donor]).toEqual(before)
      expect(renderCandidate(fused, 16000)).not.toBeNull()
      expect(() => varySound({ mode: 'vary', criteria: { ...criteria, chord: 'major' }, reference, seed: 99 }, 99)).toThrow()
    }
    const reference = renderCandidate(generateSound(fixed, 171), 16000)!.sound
    const donor = generateSound({ ...DEFAULT_DISCOVERY_CRITERIA, subtype: 'radio-static', minMs: 650, maxMs: 650 }, 7919)
    const fused = fuseSounds({ mode: 'fuse', criteria: fixed, reference, contributor: donor, contribution: 'texture', seed: 999 }, 999)
    assertNotes(fused, hz(60), [0, 4, 7])
    expect(renderCandidate(fused, 16000)).not.toBeNull()
  }, 30000)

  it('replays chord saves exactly at 48 kHz, including recipe metadata and sessions', () => {
    for (const subtype of ['electric-piano', 'rubbed-glass', 'whisper-choir', 'vibraphone'] as const) {
      const criteria: LabCriteria = { ...fixed, type: 'any', subtype, chord: 'dissonant', voicing: 'open' }
      const rendered = renderCandidate(generateSound(criteria, 171), 48000)!
      expect(rendered, subtype).not.toBeNull()
      const restored = sanitizeLabSound(JSON.parse(JSON.stringify(rendered.sound)))!
      expect(restored.origin).toEqual(rendered.sound.origin)
      expect(restored.criteria).toEqual(rendered.sound.criteria)
      const replay = renderPatch(restored.patch, 48000)
      expect(replay.left).toEqual(rendered.samples.left); expect(replay.right).toEqual(rendered.samples.right)
      const session = sanitizeLabSession({ version: 1, criteria, reserve: [restored], history: [restored], reference: restored })
      expect(session.reference!.criteria.chord).toBe('dissonant')
      expect(session.reserve[0]!.origin.recipe).toBe(rendered.sound.origin.recipe)
    }
    const high = generateSound({ ...fixed, rootNote: 96, voicing: 'open' }, 171)
    expect(renderCandidate(high, 8000)).toBeNull()
    expect(renderCandidate(high, 48000)).not.toBeNull()
  }, 60000)
})
