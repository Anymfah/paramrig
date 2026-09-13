export type FontSource = 'system' | 'google' | 'file'
export type FontAxis = { tag: string; name: string; min: number; max: number; default: number }

/**
 * A font the document knows about. A file carries its own bytes so it travels with the document;
 * a Google family is fetched on demand and embedded only when the file is exported.
 */
export type Font = {
  family: string
  source: FontSource
  weights: number[]
  axes?: FontAxis[]
  variations?: Record<string, number>
  license?: string
  /** Base64 of the font file, for an imported one. */
  data?: string
  format?: 'woff2' | 'ttf' | 'otf'
}


export const MAX_FONT_BYTES = 2 * 1024 * 1024

export function sanitizeVariations(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter(([tag, number]) => /^[a-zA-Z0-9]{4}$/.test(tag) && typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 10000).slice(0, 16)
  return entries.length ? Object.fromEntries(entries) as Record<string, number> : undefined
}

export function sanitizeFonts(value: unknown): Font[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const fonts = value.slice(0, 24).flatMap((candidate): Font[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const source = candidate as Partial<Font>
    const family = typeof source.family === 'string' ? source.family.trim().slice(0, 80) : ''
    if (!family || seen.has(family)) return []
    const kind: FontSource = source.source === 'google' || source.source === 'file' ? source.source : 'system'
    const weights = Array.isArray(source.weights)
      ? [...new Set(source.weights.filter((weight): weight is number => typeof weight === 'number' && Number.isFinite(weight) && weight >= 1 && weight <= 1000))].sort((a, b) => a - b)
      : []
    const data = kind !== 'system' && typeof source.data === 'string' && source.data.length > 0 && base64Bytes(source.data) <= MAX_FONT_BYTES
      ? source.data
      : undefined
    // An imported font without its file is nothing at all: it cannot be drawn or embedded.
    if (kind === 'file' && !data) return []
    seen.add(family)
    const axes = Array.isArray(source.axes) ? source.axes.filter(axis => axis && /^[a-zA-Z0-9]{4}$/.test(axis.tag) && [axis.min, axis.max, axis.default].every(number => Number.isFinite(number) && Math.abs(number) <= 10000) && axis.min < axis.max && axis.default >= axis.min && axis.default <= axis.max).slice(0, 16).map(axis => ({ tag: axis.tag, name: typeof axis.name === 'string' ? axis.name.slice(0, 60) : axis.tag, min: axis.min, max: axis.max, default: axis.default })) : []
    const variations = sanitizeVariations(source.variations)
    return [{
      family,
      source: kind,
      weights: weights.length ? weights : [400],
      ...(axes.length ? { axes } : {}),
      ...(variations ? { variations: Object.fromEntries(Object.entries(variations).flatMap(([tag, number]) => { const axis = axes.find(axis => axis.tag === tag); return axis ? [[tag, Math.max(axis.min, Math.min(axis.max, number))]] : [] })) } : {}),
      ...(typeof source.license === 'string' ? { license: source.license.slice(0, 20000) } : {}),
      ...(data ? { data, format: source.format === 'ttf' || source.format === 'otf' ? source.format : 'woff2' } : {}),
    }]
  })
  return fonts.length ? fonts : undefined
}

export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}
