import type { ParamValue } from './types'
import { sanitizeFonts } from './fonts'
const FONT_FAMILIES = ['Public Sans', 'Space Grotesk', 'Source Serif 4', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Menlo']
import type { Font as VectorFont } from './fonts'

/** Font bytes travel with the parameter, including snapshots, undo and exported values. */
export function normalizeFontValue(value: unknown): ParamValue | null {
  if (typeof value === 'string') return FONT_FAMILIES.includes(value) ? value : null
  const font = sanitizeFonts([value])?.[0]
  return font ? { ...font } : null
}
export function fontValueFamily(value: unknown): string | null {
  if (typeof value === 'string') return value
  return sanitizeFonts([value])?.[0]?.family ?? null
}
export function fontValueFont(value: unknown): VectorFont | null {
  return typeof value === 'object' && value !== null ? sanitizeFonts([value])?.[0] ?? null : null
}
