import { describe, expect, it } from 'vitest'
import { FRAME_CUSTOM, FRAME_PRESETS, framePresetBounds, matchFramePreset } from '@/vector/frames'

describe('frame presets', () => {
  it('recognises a box that matches a preset exactly', () => {
    expect(matchFramePreset(393, 852)).toBe('iphone-15')
    expect(matchFramePreset(1440, 1024)).toBe('desktop')
  })

  it('calls anything else custom, including a transposed preset', () => {
    expect(matchFramePreset(400, 852)).toBe(FRAME_CUSTOM)
    expect(matchFramePreset(852, 393)).toBe(FRAME_CUSTOM)
  })

  it('resizes around the centre so a frame does not jump across the page', () => {
    const preset = FRAME_PRESETS.find((item) => item.value === 'square-1080')!

    expect(framePresetBounds({ x: 100, y: 100, width: 200, height: 200 }, preset)).toEqual({ x: -340, y: -340, width: 1080, height: 1080 })
  })

  it('offers every preset with a positive box and a distinct value', () => {
    expect(FRAME_PRESETS.every((preset) => preset.width > 0 && preset.height > 0)).toBe(true)
    expect(new Set(FRAME_PRESETS.map((preset) => preset.value)).size).toBe(FRAME_PRESETS.length)
  })
})
