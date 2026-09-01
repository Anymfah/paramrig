import type { VectorElement } from '@/vector/types'

export type FramePreset = { value: string; label: string; width: number; height: number }

/** Sizes offered when a frame is created or resized from the inspector. */
export const FRAME_PRESETS: FramePreset[] = [
  { value: 'iphone-15', label: 'iPhone 15', width: 393, height: 852 },
  { value: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { value: 'ipad-11', label: 'iPad 11″', width: 834, height: 1194 },
  { value: 'macbook-air', label: 'MacBook Air', width: 1280, height: 832 },
  { value: 'desktop', label: 'Desktop', width: 1440, height: 1024 },
  { value: 'a4-portrait', label: 'A4 portrait', width: 595, height: 842 },
  { value: 'a4-landscape', label: 'A4 landscape', width: 842, height: 595 },
  { value: 'square-1080', label: 'Square 1080', width: 1080, height: 1080 },
  { value: 'story-1080', label: 'Story 1080 × 1920', width: 1080, height: 1920 },
]

export const FRAME_CUSTOM = 'custom'

/** The preset a box matches exactly, in either orientation-independent sense, or `custom`. */
export function matchFramePreset(width: number, height: number): string {
  const match = FRAME_PRESETS.find((preset) => Math.round(width) === preset.width && Math.round(height) === preset.height)
  return match ? match.value : FRAME_CUSTOM
}

/** Box for a frame resized to a preset, keeping its centre. */
export function framePresetBounds(element: Pick<VectorElement, 'x' | 'y' | 'width' | 'height'>, preset: FramePreset): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(element.x + element.width / 2 - preset.width / 2),
    y: Math.round(element.y + element.height / 2 - preset.height / 2),
    width: preset.width,
    height: preset.height,
  }
}
