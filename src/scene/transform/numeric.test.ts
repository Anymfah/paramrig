import { describe, expect, it } from 'vitest'
import {
  EMPTY_NUMERIC_ENTRY,
  acceptsUnitKey,
  evaluateNumericInput,
  formatLength,
  formatNumber,
  hasNumericInput,
  numericKey,
  numericValue,
  type NumericEntry,
} from '@/scene/transform/numeric'
import type { SceneUnits } from '@/scene/types'

const METRIC: SceneUnits = { system: 'metric', scale: 1 }

/** Types a whole string into one entry, the way the session feeds it key by key. */
function typeInto(entry: NumericEntry, text: string, fieldCount = 1, unit = 'length' as const): NumericEntry {
  return [...text].reduce((current, key) => numericKey(current, key, fieldCount, unit) ?? current, entry)
}

describe('a typed value', () => {
  it('reads a plain number', () => {
    expect(evaluateNumericInput('1.5', 'length')).toBeCloseTo(1.5, 9)
    expect(evaluateNumericInput('-2', 'length')).toBeCloseTo(-2, 9)
    expect(evaluateNumericInput('.5', 'length')).toBeCloseTo(0.5, 9)
  })

  it('reads a fraction, and reads it while it is still being typed', () => {
    expect(evaluateNumericInput('1/3', 'length')).toBeCloseTo(1 / 3, 9)
    expect(evaluateNumericInput('1/', 'length')).toBeCloseTo(1, 9)
    expect(evaluateNumericInput('-1/4', 'length')).toBeCloseTo(-0.25, 9)
  })

  it('reads a length in the unit it was written in', () => {
    expect(evaluateNumericInput('2m', 'length')).toBeCloseTo(2, 9)
    expect(evaluateNumericInput('20cm', 'length')).toBeCloseTo(0.2, 9)
    expect(evaluateNumericInput('5mm', 'length')).toBeCloseTo(0.005, 9)
    expect(evaluateNumericInput('2 m', 'length')).toBeCloseTo(2, 9)
  })

  it('reads a bare number in rotate mode as degrees, and a radian suffix as radians', () => {
    expect(evaluateNumericInput('45', 'angle')).toBeCloseTo(45, 9)
    expect(evaluateNumericInput('90deg', 'angle')).toBeCloseTo(90, 9)
    expect(evaluateNumericInput('3.14159265rad', 'angle')).toBeCloseTo(180, 5)
  })

  it('reads a percentage as a factor', () => {
    expect(evaluateNumericInput('50%', 'factor')).toBeCloseTo(0.5, 9)
  })

  it('is worth nothing until it is worth something', () => {
    expect(evaluateNumericInput('', 'length')).toBeNull()
    expect(evaluateNumericInput('-', 'length')).toBeNull()
    expect(evaluateNumericInput('.', 'length')).toBeNull()
    expect(evaluateNumericInput('abc', 'length')).toBeNull()
    expect(evaluateNumericInput('1/0', 'length')).toBeNull()
    expect(evaluateNumericInput('1/2/3', 'length')).toBeNull()
  })
})

describe('the buffer a person types into', () => {
  it('starts asleep and wakes on the first digit', () => {
    expect(hasNumericInput(EMPTY_NUMERIC_ENTRY)).toBe(false)

    const entry = numericKey(EMPTY_NUMERIC_ENTRY, '2', 1, 'length')

    expect(entry?.active).toBe(true)
    expect(entry?.fields[0]).toBe('2')
  })

  it('toggles the sign rather than piling up minus signs', () => {
    const negative = typeInto(EMPTY_NUMERIC_ENTRY, '-1')
    expect(negative.fields[0]).toBe('-1')

    const positive = numericKey(negative, '-', 1, 'length')
    expect(positive?.fields[0]).toBe('1')
  })

  it('takes one decimal point per term and one slash per field', () => {
    expect(typeInto(EMPTY_NUMERIC_ENTRY, '1.5.5').fields[0]).toBe('1.55')
    expect(typeInto(EMPTY_NUMERIC_ENTRY, '1/2/3').fields[0]).toBe('1/23')
  })

  it('takes the letters of a unit, and only while they still spell one', () => {
    expect(typeInto(EMPTY_NUMERIC_ENTRY, '20cm').fields[0]).toBe('20cm')
    expect(acceptsUnitKey('20', 'c', 'length')).toBe(true)
    expect(acceptsUnitKey('20', 'a', 'length')).toBe(false)
    // Nothing has been typed yet, so the key belongs to whatever else wanted it.
    expect(acceptsUnitKey('', 'm', 'length')).toBe(false)
  })

  it('moves to the next axis on Tab and keeps what was typed for the last one', () => {
    const first = typeInto(EMPTY_NUMERIC_ENTRY, '2', 3)
    const second = numericKey(first, 'Tab', 3, 'length')
    const filled = second ? typeInto(second, '3', 3) : first

    expect(filled.fields[0]).toBe('2')
    expect(filled.fields[1]).toBe('3')
    expect(filled.index).toBe(1)
  })

  it('wraps round the fields it has, and has only one when an axis is constrained', () => {
    const entry = typeInto(EMPTY_NUMERIC_ENTRY, '2', 1)

    expect(numericKey(entry, 'Tab', 1, 'length')?.index).toBe(0)
  })

  it('deletes a character, and on the second empty press hands the pointer back', () => {
    const typed = typeInto(EMPTY_NUMERIC_ENTRY, '25')
    const shorter = numericKey(typed, 'Backspace', 1, 'length')
    const empty = shorter ? numericKey(shorter, 'Backspace', 1, 'length') : null
    const gone = empty ? numericKey(empty, 'Backspace', 1, 'length') : null

    expect(shorter?.fields[0]).toBe('2')
    expect(empty?.fields[0]).toBe('')
    expect(empty?.active).toBe(true)
    expect(gone?.active).toBe(false)
  })

  it('leaves keys it does not want to whoever else wanted them', () => {
    expect(numericKey(EMPTY_NUMERIC_ENTRY, 'Enter', 1, 'length')).toBeNull()
    expect(numericKey(EMPTY_NUMERIC_ENTRY, 'Tab', 1, 'length')).toBeNull()
    expect(numericKey(EMPTY_NUMERIC_ENTRY, 'Backspace', 1, 'length')).toBeNull()
  })

  it('reads a field back in the unit the mode asks for', () => {
    const entry = typeInto(EMPTY_NUMERIC_ENTRY, '20cm')

    expect(numericValue(entry, 0, 'length')).toBeCloseTo(0.2, 9)
    expect(numericValue(entry, 1, 'length')).toBeNull()
  })
})

describe('the way a number is written down', () => {
  it('keeps four decimals at most and no trailing zeros', () => {
    expect(formatNumber(0.5)).toBe('0.5')
    expect(formatNumber(2)).toBe('2')
    expect(formatNumber(1 / 3)).toBe('0.3333')
    expect(formatNumber(-0.00001)).toBe('0')
  })

  it('says the unit except at zero, where it would say nothing worth reading', () => {
    expect(formatLength(0.5, METRIC)).toBe('0.5 m')
    expect(formatLength(0, METRIC)).toBe('0')
    expect(formatLength(0.5, { system: 'none', scale: 1 })).toBe('0.5')
  })
})
