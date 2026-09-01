import { describe, expect, it } from 'vitest'
import { applyCurvePreset, CURVE_PRESETS, matchingCurvePreset } from '@/ui/curve-presets'
import { defaultCurve } from '@/state/values'

describe('curve presets', () => {
  it('matches CSS cubic-bezier handles and leaves a custom curve unmatched', () => {
    const linear = CURVE_PRESETS[0]!
    const applied = applyCurvePreset(linear)
    expect(applied.p0).toEqual([0, 0])
    expect(applied.p3).toEqual([1, 1])
    expect(matchingCurvePreset(applied)?.id).toBe('linear')
    expect(matchingCurvePreset(defaultCurve())).toBeUndefined()
  })
})
