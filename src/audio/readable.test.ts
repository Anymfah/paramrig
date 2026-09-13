import { describe, expect, it } from 'vitest'
import { inUnits, readable, spoken } from '@/audio/readable'
import { boardParameters } from '@/audio/board'
import type { ParameterDef } from '@/rigs/types'

const seconds: Extract<ParameterDef, { kind: 'number' }> = {
  kind: 'number', id: 'decay', label: 'Decay', group: '', min: 0, max: 2, step: 0.001,
  unit: 'ms', units: [{ value: 'ms', label: 'Milliseconds', factor: 0.001, step: 1 }, { value: 's', label: 'Seconds', factor: 1, step: 0.01 }],
  defaultValue: 0.2,
}
const plain: Extract<ParameterDef, { kind: 'number' }> = { kind: 'number', id: 'mix', label: 'Mix', group: '', min: 0, max: 1, step: 0.01, defaultValue: 0.5 }

/**
 * Every time in this instrument is stored in seconds and printed in milliseconds. A control that
 * showed the stored number beside the label said "0.20 ms" for a fifth of a second — a
 * thousandfold lie, and the one it was told out loud, since a dial's own readout carries no unit.
 */
describe('a number as its field means it', () => {
  it('divides by the unit the field declares', () => {
    expect(inUnits(seconds, 0.2)).toBeCloseTo(200, 6)
    expect(inUnits(seconds, 0.0004)).toBeCloseTo(0.4, 6)
  })

  it('leaves a field that is already in its own unit alone', () => {
    expect(inUnits(plain, 0.42)).toBeCloseTo(0.42, 6)
  })

  it('spends its decimals where they are worth something', () => {
    expect(readable(seconds, 0.2)).toBe('200')
    expect(readable(seconds, 0.0125)).toBe('12.5')
    expect(readable(seconds, 0.0004)).toBe('0.40')
    expect(readable(plain, 0.5)).toBe('0.50')
  })

  it('says the unit out loud, where a screen reader is the only thing reading', () => {
    expect(spoken(seconds, 0.2)).toBe('200 ms')
    expect(spoken(plain, 0.5)).toBe('0.50')
  })

  /**
   * The other half of the same bug: a field labelled in milliseconds is handed the seconds-to-
   * milliseconds units by `rig.ts`, so every field carrying that label has to be stored in
   * seconds. A comb's delay was not, and read a thousand times too long on the plate.
   */
  it('finds no field on the board that is labelled in milliseconds and stored otherwise', () => {
    const wrong = boardParameters().filter((parameter) => (
      parameter.kind === 'number' && parameter.unit === 'ms' && parameter.max > 60
    ))
    expect(wrong.map((parameter) => parameter.id)).toEqual([])
  })
})
