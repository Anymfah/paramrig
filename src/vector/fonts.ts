import { toBase64 } from '@/typography/bytes'
import type { VectorFont } from '@/vector/types'
import { MAX_FONT_BYTES } from '@paramrig/core/fonts'
export { MAX_FONT_BYTES, sanitizeFonts, base64Bytes } from '@paramrig/core/fonts'


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

export { googleCssUrl, pickFontFileUrl } from '@/typography/fontSources'

export type FontFileRead = { font: VectorFont } | { error: string }

/** Reads a dropped font file into the document, or says why it cannot. */
export async function readFontFile(file: File): Promise<FontFileRead> {
  const match = /\.(woff2|ttf|otf)$/i.exec(file.name)
  if (!match) return { error: 'Fonts can be imported as .woff2, .ttf or .otf files.' }
  if (file.size > MAX_FONT_BYTES) {
    return { error: `${file.name} is ${Math.round(file.size / 1024)} KB. A font has to stay under ${Math.round(MAX_FONT_BYTES / 1024)} KB to travel with the document.` }
  }
  const buffer = await file.arrayBuffer()
  let metrics: Pick<VectorFont, 'axes' | 'weights'>
  try { const { inspectFont } = await import('./fontMetadata'); metrics = await inspectFont(buffer) }
  catch { return { error: `${file.name} could not be read as a supported font file.` } }
  const family = file.name.replace(/\.(woff2|ttf|otf)$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 80) || 'Imported font'
  return {
    font: {
      family,
      source: 'file',
      ...metrics,
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

export { toBase64, fromBase64 } from '@/typography/bytes'
