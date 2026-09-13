import { describe, expect, it } from 'vitest'
import { compactMark } from '@/audio/marks'
import { PRESET_ORDER } from '@/audio/presets'

/**
 * The forty-eight pixel rail shows a mark and nothing else, so a mark two sounds share is a mark
 * that says nothing. Initials alone are not enough here: the library calls nine of its sounds
 * Coin, Confirm, Crystal, Charge, Chime, Clang, Collapse, Complete and Credit, and Impact Snap,
 * Impact Strike and Impact Slam are all "IS". A test rather than a convention, so a new preset
 * cannot quietly bring a collision back.
 */
describe('the compact rail’s marks', () => {
  it('gives every sound in the library a mark of its own', () => {
    const seen = new Map<string, string[]>()
    for (const preset of PRESET_ORDER) {
      const mark = compactMark(preset.label)
      seen.set(mark, [...(seen.get(mark) ?? []), preset.label])
    }
    const shared = [...seen].filter(([, labels]) => labels.length > 1)
    expect(shared.map(([mark, labels]) => `${mark}: ${labels.join(', ')}`)).toEqual([])
    expect(seen.size).toBe(PRESET_ORDER.length)
  })

  it('keeps a label’s mark the same however often it is asked', () => {
    const once = PRESET_ORDER.map((preset) => compactMark(preset.label))
    const again = PRESET_ORDER.map((preset) => compactMark(preset.label))
    expect(again).toEqual(once)
  })

  it('is one or two characters, so it fits the rail it exists for', () => {
    for (const preset of PRESET_ORDER) {
      const mark = compactMark(preset.label)
      expect(mark.length, preset.label).toBeGreaterThan(0)
      expect(mark.length, preset.label).toBeLessThanOrEqual(2)
    }
  })
})
