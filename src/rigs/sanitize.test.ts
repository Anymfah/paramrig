import { describe, expect, it } from 'vitest'
import { sanitizeParameter } from '@/rigs/sanitize'

const groups = new Set(['main'])
const base = { id: 'c', label: 'Control', group: 'main' }

describe('sanitizeParameter', () => {
  /**
   * A frequency read on a linear slider is a different control. These were being dropped, which
   * turned a 20 Hz–20 kHz logarithmic cutoff back into a linear one on the way through storage.
   */
  it('keeps the scale of a number', () => {
    expect(sanitizeParameter({ ...base, kind: 'number', min: 20, max: 20000, step: 1, defaultValue: 440, scale: 'log' }, groups))
      .toMatchObject({ scale: 'log' })
    expect(sanitizeParameter({ ...base, kind: 'number', min: 0, max: 1, step: 0.1, defaultValue: 0, scale: 'spiral' }, groups))
      .not.toHaveProperty('scale')
  })

  it('keeps the display units of a number, and refuses a factor that is not one', () => {
    const parameter = sanitizeParameter({
      ...base, kind: 'number', min: 0, max: 2, step: 0.001, defaultValue: 0.1, unit: 'ms',
      units: [
        { value: 'ms', label: 'Milliseconds', factor: 0.001, step: 1 },
        { value: 's', label: 'Seconds', factor: 1 },
        { value: 'broken', label: 'Nope', factor: 0 },
        { value: 'worse', label: 'Nope', factor: 'many' },
      ],
    }, groups)
    expect(parameter && 'units' in parameter ? parameter.units?.map((unit) => unit.value) : []).toEqual(['ms', 's'])
  })

  it('leaves units off entirely when none of them read back', () => {
    expect(sanitizeParameter({ ...base, kind: 'number', min: 0, max: 1, step: 1, defaultValue: 0, units: 'metric' }, groups))
      .not.toHaveProperty('units')
  })

  it('reads a curve control, which a slide and a filter sweep are shaped by', () => {
    const curve = { type: 'cubic-bezier', p0: [0, 0], p1: [0.2, 1], p2: [0.4, 1], p3: [1, 1] }
    expect(sanitizeParameter({ ...base, kind: 'curve', defaultValue: curve }, groups))
      .toMatchObject({ kind: 'curve', defaultValue: curve })
  })

  it('opens a broken curve on a straight line rather than dropping the control', () => {
    for (const bad of [null, { type: 'spiral' }, { type: 'cubic-bezier', p0: [0, 0] }, { type: 'cubic-bezier', p0: ['a', 0], p1: [0, 0], p2: [1, 1], p3: [1, 1] }]) {
      const parameter = sanitizeParameter({ ...base, kind: 'curve', defaultValue: bad }, groups)
      expect(parameter?.kind).toBe('curve')
      expect(parameter && 'defaultValue' in parameter ? (parameter.defaultValue as { type: string }).type : '').toBe('cubic-bezier')
    }
  })

  it('still refuses a control with no group of its own', () => {
    expect(sanitizeParameter({ ...base, group: 'ghost', kind: 'curve', defaultValue: null }, groups)).toBeNull()
  })
})
