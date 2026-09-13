import { fromBase64, MAX_FONT_BYTES, toBase64 } from './fonts'
import type { VectorFont } from './types'

/** Parse the file itself, including WOFF2. The reader is outside the initial bundle. */
export async function inspectFont(bytes: ArrayBuffer): Promise<Pick<VectorFont, 'axes' | 'weights'>> {
  const { create } = await import('fontkit')
  const parsed = create(new Uint8Array(bytes))
  const axes = Object.entries(parsed.variationAxes ?? {}).map(([tag, axis]) => ({ tag, ...axis }))
  const weight = axes.find(axis => axis.tag === 'wght')
  return { weights: weight ? [weight.min, weight.max] : [parsed['OS/2']?.usWeightClass ?? 400], ...(axes.length ? { axes } : {}) }
}

const metadata = new Map<string, Promise<VectorFont>>()
export async function enrichFont(font: VectorFont): Promise<VectorFont> {
  if (font.source === 'file' && font.data) return { ...font, ...await inspectFont(fromBase64(font.data)) }
  if (font.source !== 'google' || font.data || font.axes) return font
  if (!metadata.has(font.family)) metadata.set(font.family, loadGoogleMetadata(font))
  const result = await metadata.get(font.family)!
  if (result === font) metadata.delete(font.family)
  return result
}

async function loadGoogleMetadata(font: VectorFont): Promise<VectorFont> {
  // Public source metadata has no API key. If unavailable, retain only the
  // explicitly requested CSS face, never invent a weight range.
  const slug = font.family.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!slug) return font
  try {
    for (const licenseDir of ['ofl', 'apache']) {
      const base = `https://raw.githubusercontent.com/google/fonts/main/${licenseDir}/${slug}/`
      const response = await fetch(`${base}METADATA.pb`)
      if (!response.ok) continue
      const source = await response.text()
      const normal = [...source.matchAll(/fonts\s*\{([^}]+)\}/g)].map(match => match[1]!).filter(block => /style:\s*"normal"/.test(block))
      const file = normal[0]?.match(/filename:\s*"([^"/]+)"/)?.[1]
      const weights = [...new Set(normal.flatMap(block => { const weight = Number(block.match(/weight:\s*(\d+)/)?.[1]); return weight >= 1 && weight <= 1000 ? [weight] : [] }))].sort((a, b) => a - b)
      if (!file || !weights.length) return font
      let license: string | undefined
      const licence = await fetch(`${base}${licenseDir === 'ofl' ? 'OFL.txt' : 'LICENSE.txt'}`)
      if (licence.ok) license = (await licence.text()).slice(0, 20000)
      if (!/axes\s*\{/.test(source)) return { ...font, weights, ...(license ? { license } : {}) }
      const raw = await fetch(`${base}${encodeURIComponent(file)}`)
      if (!raw.ok) return font
      const bytes = await raw.arrayBuffer()
      if (bytes.byteLength > MAX_FONT_BYTES) return font
      return { ...font, ...await inspectFont(bytes), data: toBase64(bytes), format: 'ttf', ...(license ? { license } : {}) }
    }
  } catch { /* The existing CSS loader still supplies its explicitly requested face. */ }
  return font
}
