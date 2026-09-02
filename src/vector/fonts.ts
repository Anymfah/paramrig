import type { VectorFont, VectorFontSource } from '@/vector/types'

/** Files bigger than this are refused: a document carries its fonts, and it has to stay openable. */
export const MAX_FONT_BYTES = 2 * 1024 * 1024

export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

/** A short, opinionated list rather than the whole Google catalogue, which is thousands long. */
export const GOOGLE_FAMILIES = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3', 'Work Sans',
  'DM Sans', 'Manrope', 'Space Grotesk', 'Rubik', 'Nunito', 'Karla', 'Figtree',
  'Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'Source Serif 4', 'Bitter',
  'IBM Plex Sans', 'IBM Plex Mono', 'JetBrains Mono', 'Space Mono', 'Fira Code',
  'Bebas Neue', 'Oswald', 'Archivo', 'Cormorant Garamond',
] as const

export function searchGoogleFamilies(query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...GOOGLE_FAMILIES]
  return GOOGLE_FAMILIES.filter((family) => family.toLowerCase().includes(needle))
}

export function googleCssUrl(family: string, weights: number[]): string {
  const list = [...new Set(weights.length ? weights : [400])].sort((a, b) => a - b).join(';')
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${list}&display=swap`
}

/**
 * The file URL for one weight out of a Google Fonts stylesheet.
 *
 * The stylesheet carries a block per subset, each preceded by a comment naming it. The latin one
 * is what a drawing tool wants; without it, the first block will do.
 */
export function pickFontFileUrl(css: string, weight?: number): string | null {
  const blocks = [...css.matchAll(/\/\*\s*([^*]+?)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)]
    .map((match) => ({ subset: match[1] ?? '', body: match[2] ?? '' }))
  const candidates = blocks.length ? blocks : [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => ({ subset: '', body: match[1] ?? '' }))
  const weighted = weight
    ? candidates.filter((block) => new RegExp(`font-weight:\\s*${weight}\\b`).test(block.body))
    : candidates
  const pool = weighted.length ? weighted : candidates
  const latin = pool.find((block) => block.subset === 'latin') ?? pool[0]
  return latin?.body.match(/url\(([^)]+)\)/)?.[1] ?? null
}

export function sanitizeFonts(value: unknown): VectorFont[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const fonts = value.slice(0, 24).flatMap((candidate): VectorFont[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const source = candidate as Partial<VectorFont>
    const family = typeof source.family === 'string' ? source.family.trim().slice(0, 80) : ''
    if (!family || seen.has(family)) return []
    const kind: VectorFontSource = source.source === 'google' || source.source === 'file' ? source.source : 'system'
    const weights = Array.isArray(source.weights)
      ? [...new Set(source.weights.filter((weight): weight is number => typeof weight === 'number' && FONT_WEIGHTS.includes(weight as never)))].sort((a, b) => a - b)
      : []
    const data = kind === 'file' && typeof source.data === 'string' && source.data.length > 0 && base64Bytes(source.data) <= MAX_FONT_BYTES
      ? source.data
      : undefined
    // An imported font without its file is nothing at all: it cannot be drawn or embedded.
    if (kind === 'file' && !data) return []
    seen.add(family)
    return [{
      family,
      source: kind,
      weights: weights.length ? weights : [400],
      ...(data ? { data, format: source.format === 'ttf' || source.format === 'otf' ? source.format : 'woff2' } : {}),
    }]
  })
  return fonts.length ? fonts : undefined
}

export type FontFileRead = { font: VectorFont } | { error: string }

/** Reads a dropped font file into the document, or says why it cannot. */
export async function readFontFile(file: File): Promise<FontFileRead> {
  const match = /\.(woff2|ttf|otf)$/i.exec(file.name)
  if (!match) return { error: 'Fonts can be imported as .woff2, .ttf or .otf files.' }
  if (file.size > MAX_FONT_BYTES) {
    return { error: `${file.name} is ${Math.round(file.size / 1024)} KB. A font has to stay under ${Math.round(MAX_FONT_BYTES / 1024)} KB to travel with the document.` }
  }
  const buffer = await file.arrayBuffer()
  const family = file.name.replace(/\.(woff2|ttf|otf)$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 80) || 'Imported font'
  return {
    font: {
      family,
      source: 'file',
      weights: [400],
      data: toBase64(buffer),
      format: match[1]!.toLowerCase() as 'woff2' | 'ttf' | 'otf',
    },
  }
}

/** The `@font-face` rule that carries a font inside an exported file. */
export function fontFaceRule(family: string, data: string, format: 'woff2' | 'ttf' | 'otf', weights: number[] = [400]): string {
  const mime = format === 'woff2' ? 'font/woff2' : format === 'otf' ? 'font/otf' : 'font/ttf'
  const name = format === 'woff2' ? 'woff2' : format === 'otf' ? 'opentype' : 'truetype'
  const range = weights.length > 1 ? `${Math.min(...weights)} ${Math.max(...weights)}` : String(weights[0] ?? 400)
  return `@font-face{font-family:'${family.replace(/'/g, '')}';src:url(data:${mime};base64,${data}) format('${name}');font-weight:${range};font-style:normal;}`
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
  return btoa(binary)
}

export function fromBase64(data: string): ArrayBuffer {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

/** Decoded size of a base64 payload, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}
