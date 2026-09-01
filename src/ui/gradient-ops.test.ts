import { describe, expect, it } from 'vitest'
import {
  insertGradientStop,
  mixHex,
  removeGradientStop,
  sampleGradient,
} from '@/ui/gradient-ops'
import type { GradientStop } from '@/rigs/types'

const ramp: GradientStop[] = [
  { t: 0, color: '#000000' },
  { t: 1, color: '#FFFFFF' },
]

describe('gradient ops', () => {
  it('samples and inserts a stop with a mixed color', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080')
    expect(sampleGradient(ramp, 0.5)).toBe('#808080')
    const next = insertGradientStop(ramp, 0.5)
    expect(next).toEqual([
      { t: 0, color: '#000000' },
      { t: 0.5, color: '#808080' },
      { t: 1, color: '#FFFFFF' },
    ])
    expect(insertGradientStop(ramp, 0.004)).toBeNull()
  })

  it('keeps at least two stops when removing', () => {
    expect(removeGradientStop(ramp, 0)).toEqual(ramp)
    const three = insertGradientStop(ramp, 0.5)!
    expect(removeGradientStop(three, 1)).toEqual(ramp)
  })
})
