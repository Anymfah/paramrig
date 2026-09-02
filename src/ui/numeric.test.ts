import { describe, expect, it } from 'vitest'
import {
  applyScrub,
  clampNumber,
  evaluateExpression,
  evaluateNumberInput,
  fineStep,
  formatNumber,
  isIntegerStep,
  nudgeNumber,
  parseNumberInput,
  snapToStep,
  usesStepper,
} from '@/ui/numeric'

describe('numeric helpers', () => {
  it('formats by step decimals and snaps to the parameter step', () => {
    expect(formatNumber(0.18, 0.01)).toBe('0.18')
    expect(formatNumber(6, 1)).toBe('6')
    expect(formatNumber(2.4, 1 / 30)).toBe('2.400')
    expect(parseNumberInput('Infinity', 0, 1, 0.01)).toBeNull()
    expect(snapToStep(0.184, 0, 0.01)).toBe(0.18)
    expect(clampNumber(12, 3, 8)).toBe(8)
    expect(parseNumberInput('7', 3, 16, 1)).toBe(7)
    expect(parseNumberInput('nope', 0, 1, 0.01)).toBeNull()
  })

  it('evaluates arithmetic, percentages of the range, relative steps and known units', () => {
    expect(evaluateExpression('32*2')).toBe(64)
    expect(evaluateExpression('(100-8)/3')).toBeCloseTo(30.6667, 3)
    expect(evaluateExpression('2^3')).toBe(8)
    expect(evaluateExpression('-4+-2')).toBe(-6)
    expect(evaluateExpression('3/0')).toBeNull()
    expect(evaluateExpression('nope')).toBeNull()
    expect(evaluateExpression('1+')).toBeNull()
    const bounds = { min: 0, max: 200, step: 1 }
    expect(evaluateNumberInput('50%', 32, bounds)).toBe(100)
    expect(evaluateNumberInput('+=10', 32, bounds)).toBe(42)
    expect(evaluateNumberInput('-=50', 32, bounds)).toBe(0)
    expect(evaluateNumberInput(' 12 px ', 32, { ...bounds, unit: 'px' })).toBe(12)
    expect(evaluateNumberInput('2rem', 32, { ...bounds, unit: 'px', units: [{ value: 'px', label: 'Pixels', factor: 1 }, { value: 'rem', label: 'Rem', factor: 16 }] })).toBe(32)
    expect(evaluateNumberInput('2cm', 32, { ...bounds, unit: 'px' })).toBeNull()
    expect(evaluateNumberInput('', 32, bounds)).toBeNull()
  })

  it('uses steppers for unitless integer counts, not for measured sliders', () => {
    expect(usesStepper({ step: 1 })).toBe(true)
    expect(usesStepper({ step: 1, unit: '°' })).toBe(false)
    expect(usesStepper({ step: 0.01 })).toBe(false)
    expect(usesStepper({ step: 1, sliderMin: -60, sliderMax: 60 })).toBe(false)
    expect(isIntegerStep(1)).toBe(true)
    expect(isIntegerStep(0.01)).toBe(false)
  })

  it('scrubs in steps, slower with Shift, and keeps integers whole', () => {
    const integer = { min: 3, max: 16, step: 1, fine: false }
    expect(applyScrub(6, 12, integer)).toBe(8)
    expect(applyScrub(6, 12, { ...integer, fine: true })).toBe(7)
    expect(Number.isInteger(applyScrub(6, 40, { ...integer, fine: true }))).toBe(true)

    const continuous = { min: 0, max: 0.6, step: 0.01, fine: false }
    expect(applyScrub(0.18, 6, continuous)).toBe(0.19)
    expect(applyScrub(0.18, 6, { ...continuous, fine: true })).toBe(0.18)
    const wideContinuous = { min: 0, max: 100, step: 0.01, fine: false }
    expect(applyScrub(40, 24, wideContinuous)).toBe(44)
    expect(applyScrub(40, 24, { ...wideContinuous, fine: true })).toBe(40.01)
    expect(nudgeNumber(6, 1, { min: 3, max: 16, step: 1 })).toBe(7)
    expect(nudgeNumber(16, 1, { min: 3, max: 16, step: 1 })).toBe(16)
    expect(fineStep(1)).toBe(0.1)
    expect(fineStep(0.01)).toBe(0.001)
    expect(nudgeNumber(24, -1, { min: -120, max: 120, step: fineStep(1) })).toBe(23.9)
  })
})
