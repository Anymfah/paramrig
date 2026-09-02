import { fromBase64, googleCssUrl, pickFontFileUrl, toBase64 } from '@/vector/fonts'
import type { VectorFont } from '@/vector/types'

/**
 * Fetches and registers the fonts a document uses.
 *
 * A file font carries its own bytes; a Google family is fetched once and kept in memory for the
 * session, which is what lets the same bytes serve three purposes — drawing on the canvas,
 * embedding in an export, and reading glyph outlines — without asking the network three times.
 */
const bytesCache = new Map<string, Promise<ArrayBuffer | null>>()
const registered = new Set<string>()

export function fontKey(font: Pick<VectorFont, 'family' | 'source'>, weight: number): string {
  return `${font.source}:${font.family}:${weight}`
}

export async function fontBytes(font: VectorFont, weight = 400): Promise<ArrayBuffer | null> {
  const key = fontKey(font, weight)
  if (!bytesCache.has(key)) bytesCache.set(key, load(font, weight))
  return bytesCache.get(key)!
}

async function load(font: VectorFont, weight: number): Promise<ArrayBuffer | null> {
  if (font.source === 'file') return font.data ? fromBase64(font.data) : null
  if (font.source !== 'google') return null
  try {
    const response = await fetch(googleCssUrl(font.family, [weight]))
    if (!response.ok) return null
    const url = pickFontFileUrl(await response.text(), weight)
    if (!url) return null
    const file = await fetch(url)
    return file.ok ? await file.arrayBuffer() : null
  } catch {
    // No network, or the request was refused: the text falls back to the stack's next family.
    return null
  }
}

/** Makes a font available to the page, so the canvas draws with it rather than with a fallback. */
export async function ensureFont(font: VectorFont): Promise<boolean> {
  if (typeof globalThis.FontFace !== 'function' || !globalThis.document?.fonts) return false
  const weight = font.weights[0] ?? 400
  const key = fontKey(font, weight)
  if (registered.has(key)) return true
  const bytes = await fontBytes(font, weight)
  if (!bytes) return false
  try {
    const face = new FontFace(font.family, bytes, { weight: font.weights.length > 1 ? `${Math.min(...font.weights)} ${Math.max(...font.weights)}` : String(weight) })
    await face.load()
    globalThis.document.fonts.add(face)
    registered.add(key)
    return true
  } catch {
    return false
  }
}

/** Registers every font a document carries; failures are silent, the text simply falls back. */
export async function ensureFonts(fonts: VectorFont[] | undefined): Promise<void> {
  await Promise.all((fonts ?? []).map((font) => ensureFont(font)))
}

/** Base64 of a font's file, for embedding in an export. */
export async function fontData(font: VectorFont, weight = 400): Promise<string | null> {
  if (font.data) return font.data
  const bytes = await fontBytes(font, weight)
  return bytes ? toBase64(bytes) : null
}
