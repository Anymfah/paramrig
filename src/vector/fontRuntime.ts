import { fromBase64, toBase64 } from './fonts'
import type { VectorFont } from './types'
import type { FontResolver } from './resources'
import { invalidateFontMetrics } from './fontMetricsStore'

/** Per-view resources; embedded bytes are the only default source. */
export function createFontLoader(resolveFont?: FontResolver) {
  const bytes = new Map<string, Promise<ArrayBuffer | null>>()
  const faces = new Map<string, FontFace>()
  const payloads = new Map<string, number>()
  const abort = new AbortController()
  let destroyed = false
  const fontKey = (font: Pick<VectorFont, 'family' | 'source' | 'data'>, weight: number) => {
    if (font.data && !payloads.has(font.data)) payloads.set(font.data, payloads.size + 1)
    return `${font.source}:${font.family}:${weight}:${font.data ? payloads.get(font.data) : 'external'}`
  }
  const fontBytes = async (font: VectorFont, weight = 400, purpose: 'display' | 'outline' = 'display'): Promise<ArrayBuffer | null> => {
    if (destroyed) return null
    if (font.data) return fromBase64(font.data)
    const key = `${fontKey(font, weight)}:${purpose}`
    if (!bytes.has(key)) bytes.set(key, Promise.resolve(resolveFont?.({ font, weight, purpose, signal: abort.signal }) ?? null)
      .then(value => { if (!value) bytes.delete(key); return destroyed ? null : value }, error => { bytes.delete(key); throw error }))
    return bytes.get(key)!
  }
  const ensureFont = async (font: VectorFont): Promise<boolean> => {
    if (destroyed || typeof globalThis.FontFace !== 'function' || !globalThis.document?.fonts) return false
    const axis = font.axes?.find(axis => axis.tag === 'wght')
    const weights = axis || font.data ? [font.weights[0] ?? 400] : font.weights
    const result = await Promise.all(weights.map(async weight => {
      const key = fontKey(font, weight)
      if (faces.has(key)) return true
      const data = await fontBytes(font, weight)
      if (!data || destroyed) return false
      const face = new FontFace(font.family, data, { weight: axis ? `${axis.min} ${axis.max}` : String(weight) })
      await face.load()
      if (destroyed) return false
      // Concurrent requests may finish together; only retain one registered face per key.
      if (!faces.has(key)) { document.fonts.add(face); faces.set(key, face); invalidateFontMetrics() }
      return true
    }))
    return result.every(Boolean)
  }
  return {
    fontKey, fontBytes, ensureFont,
    async ensureFonts(fonts: VectorFont[] = []): Promise<void> { await Promise.all(fonts.map(ensureFont)) },
    async fontData(font: VectorFont, weight = 400): Promise<string | null> { const data = await fontBytes(font, weight); return data ? toBase64(data) : null },
    destroy(): void {
      destroyed = true; abort.abort()
      const hadFaces = faces.size > 0
      for (const face of faces.values()) globalThis.document?.fonts?.delete(face)
      faces.clear(); bytes.clear(); payloads.clear()
      if (hadFaces) invalidateFontMetrics()
    },
  }
}
