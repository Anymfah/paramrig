import type { Font as VectorFont, FontAxis as VectorFontAxis } from '@paramrig/core/fonts'

export type FontCapabilities = { weights: number[]; axes: VectorFontAxis[]; verified: boolean }
const weightAxis = (min: number, max: number, initial = 400): VectorFontAxis => ({ tag: 'wght', name: 'Weight', min, max, default: initial })
const shipped: Record<string, VectorFontAxis[]> = {
  'Public Sans': [weightAxis(100, 900, 100)],
  'Space Grotesk': [weightAxis(300, 700, 300)],
  'Source Serif 4': [weightAxis(200, 900)],
}

export function fontCapabilities(value: unknown): FontCapabilities {
  const font = value && typeof value === 'object' ? value as VectorFont : undefined
  const family = typeof value === 'string' ? value : font?.family ?? ''
  const axes = font?.source === 'file' ? font.axes ?? [] : font?.axes ?? shipped[family] ?? []
  const axis = axes.find(axis => axis.tag === 'wght')
  return { axes, weights: axis ? [axis.min, axis.max] : font?.weights ?? [400], verified: !!shipped[family] || font?.source === 'file' || font?.source === 'google' }
}

export function supportedWeight(value: unknown, weight: number): number {
  const { axes, weights } = fontCapabilities(value)
  const axis = axes.find(axis => axis.tag === 'wght')
  return axis ? Math.max(axis.min, Math.min(axis.max, weight)) : weights.reduce((best, candidate) => Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best, weights[0] ?? 400)
}

export { sanitizeVariations } from '@paramrig/core/fonts'

export function variationSettings(value: Record<string, number> | undefined): string | undefined {
  return value && Object.keys(value).length ? Object.entries(value).map(([tag, number]) => `'${tag}' ${number}`).join(', ') : undefined
}
