import type { Font } from '@paramrig/core/fonts'
import type { FontResolver } from './resources'
import { fromBase64 } from './bytes'
export type GlyphCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x: number; y: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'Q'; x: number; y: number; x1: number; y1: number }
  | { type: 'Z' }

export type OutlineFont = {
  getPath: (text: string, x: number, y: number, size: number, options?: Record<string, unknown>) => { commands: GlyphCommand[] }
  getAdvanceWidth: (text: string, size: number, options?: Record<string, unknown>) => number
}

/** Read glyphs from caller-provided or embedded bytes. No deployment URL or storage access. */
export async function loadOutlineFont(family: string, fonts: Font[] = [], resolveFont?: FontResolver, signal?: AbortSignal): Promise<OutlineFont | null> {
  const font = fonts.find(font => font.family === family) ?? { family, source: 'system' as const, weights: [400] }
  if (font.data && font.format === 'woff2') return null
  const bytes = font.data ? fromBase64(font.data) : await resolveFont?.({ font, weight: font.weights[0] ?? 400, purpose: 'outline', signal })
  if (!bytes || signal?.aborted) return null
  const opentype = await import('opentype.js')
  return opentype.parse(bytes) as unknown as OutlineFont
}
