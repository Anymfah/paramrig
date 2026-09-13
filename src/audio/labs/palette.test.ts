import { describe, expect, it } from 'vitest'
import { DEFAULT_CRITERIA, type LabCriteria } from './model'
import { SOUND_FAMILIES } from './catalog'
import { labSubtypeCatalog } from './subtypes'
import { validateLabCriteria } from './criteria'
import { labCriteriaKey } from './selections'
import { paletteSelection, paletteGestures, paletteSummary, updatePaletteCriteria } from './palette'

const change = (criteria: LabCriteria, update: Partial<LabCriteria>) => updatePaletteCriteria(criteria, update).criteria

describe('full palette search intent', () => {
  it('switches single, multiple and unrestricted choices without losing other dimensions', () => {
    const before: LabCriteria = { ...DEFAULT_CRITERIA, material: 'any', pool: { materials: ['glass', 'wood'] } }
    const two = change(before, paletteSelection(before, 'type', ['water', 'keys', 'keys']))
    expect(two).toMatchObject({ type: 'any', pool: { families: ['water', 'keys'], materials: ['glass', 'wood'] }, subtype: 'auto' })
    const single = change(two, paletteSelection(two, 'type', ['keys']))
    expect(single.type).toBe('keys')
    expect(single.pool).toEqual({ materials: ['glass', 'wood'] })
    const any = change(single, paletteSelection(single, 'material', []))
    expect(any.material).toBe('any')
    expect(any.pool).toBeUndefined()
    expect(before.pool).toEqual({ materials: ['glass', 'wood'] })
    for (const criteria of [two, single, any]) expect(() => validateLabCriteria(criteria)).not.toThrow()
  })
  it('keeps all catalog sources and their contextual gestures reachable under strict SDK validation', () => {
    for (const type of SOUND_FAMILIES) {
      const criteria = change(DEFAULT_CRITERIA, { type })
      expect(paletteGestures(criteria).length).toBeGreaterThan(1)
      for (const gesture of paletteGestures(criteria)) expect(() => validateLabCriteria(change(criteria, { gesture: gesture.id, maxMs: 4000 })), `${type}/${gesture.id}`).not.toThrow()
    }
    for (const subtype of labSubtypeCatalog()) {
      const criteria = change(DEFAULT_CRITERIA, { type: subtype.family, subtype: subtype.id, maxMs: 4000 })
      expect(criteria.subtype).toBe(subtype.id)
      expect(() => validateLabCriteria(criteria), subtype.id).not.toThrow()
    }
  })
  it('reports dependent resets when moving from harmony to a non-musical source', () => {
    const before: LabCriteria = { ...DEFAULT_CRITERIA, type: 'pad', subtype: 'organ', chord: 'minor', voicing: 'open', gesture: 'sustain' }
    const { criteria, adjustments } = updatePaletteCriteria(before, { type: 'explosion' })
    expect(criteria).toMatchObject({ type: 'explosion', subtype: 'auto', chord: 'none', gesture: 'auto' })
    expect(criteria.voicing).toBeUndefined()
    expect(adjustments).toHaveLength(3)
    expect(before.chord).toBe('minor')
    expect(() => validateLabCriteria(criteria)).not.toThrow()
  })
  it('filters gestures by family pool and harmony before a request reaches the worker', () => {
    const pooled = change(DEFAULT_CRITERIA, { type: 'any', pool: { families: ['keys', 'explosion'] }, chord: 'major' })
    expect(paletteGestures(pooled)).toEqual(paletteGestures(change(pooled, { type: 'keys', pool: undefined })))
    const reset = updatePaletteCriteria(pooled, { pool: { families: ['explosion', 'water'] } })
    expect(reset.criteria.chord).toBe('none')
    expect(reset.adjustments).toHaveLength(1)
    expect(() => validateLabCriteria(reset.criteria)).not.toThrow()
  })
  it('uses an exact note or a register and retains a too-long gesture for an actionable blocker', () => {
    const pitched = change({ ...DEFAULT_CRITERIA, register: 'low' }, { rootNote: 60 })
    expect(pitched).toMatchObject({ rootNote: 60, register: 'auto' })
    const ranged = change(pitched, { register: 'high' })
    expect(ranged.rootNote).toBeUndefined()
    const brief = change({ ...DEFAULT_CRITERIA, type: 'transformation', gesture: 'assemble-lock' }, { minMs: 100, maxMs: 200 })
    expect(brief.gesture).toBe('assemble-lock')
    expect(() => validateLabCriteria(brief)).toThrow(/at least/)
    expect(() => validateLabCriteria(change(brief, { maxMs: 1600 }))).not.toThrow()
  })
  it('summarizes retained choices and distinguishes complete intents for recipe diversity', () => {
    const before = change(DEFAULT_CRITERIA, { type: 'any', pool: { families: ['keys', 'pad', 'choir'] }, rootNote: 60, chord: 'minor', voicing: 'open' })
    expect(paletteSummary(before)).toMatchObject({ source: 'Keys + Pad +1', pitch: 'C4 · Minor chord · Open voicing' })
    expect(labCriteriaKey(before)).toBe(labCriteriaKey({ ...before, pool: { families: ['choir', 'pad', 'keys'] } }))
    expect(labCriteriaKey(before)).not.toBe(labCriteriaKey({ ...before, rootNote: 61 }))
    expect(labCriteriaKey(before)).not.toBe(labCriteriaKey({ ...before, diversity: 'wild' }))
  })
})
