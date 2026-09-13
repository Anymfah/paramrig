import { serializeVectorMarkup } from '@/vector/serialization'
import { canvasMeasure, layoutText, textProperties } from '@/vector/text'
import type { VectorDocument, VectorElement } from '@/vector/types'

export type BrandApplication = { name: string; width: number; height: number; markup: string }

export function brandElement(document: VectorDocument, id: string): VectorElement {
  const element = document.elements.find(item => item.id === id)
  if (!element) throw new Error(`The brand kit needs the ${id} element. Restore it before exporting.`)
  return element
}

export function symbolMarkup(document: VectorDocument, size: number, color: string, background?: string, inset = 0): string {
  const symbol: VectorElement = { ...brandElement(document, 'cover-mark'), id: 'symbol', parentId: undefined, x: inset, y: inset, width: size - inset * 2, height: size - inset * 2, fill: color, fills: undefined }
  const ground: VectorElement = { ...symbol, id: 'background', kind: 'rectangle', x: 0, y: 0, width: size, height: size, fill: background ?? 'none', network: undefined }
  return serializeVectorMarkup(background ? [ground, symbol] : [symbol], { x: 0, y: 0, width: size, height: size })
}

/** Compose delivery formats from resolved artwork without resizing the authored manual. */
export function brandApplications(document: VectorDocument): BrandApplication[] {
  const get = (id: string) => brandElement(document, id)
  const color = (id: string) => get(`${id}-swatch`).fill
  const symbolScale = get('cover-mark').width / 360
  const headlineScale = (get('social-headline').fontSize ?? 72) / 72
  const applications: BrandApplication[] = [
    { name: 'favicon', width: 32, height: 32, markup: symbolMarkup(document, 32, color('paper'), color('field'), 4) },
    { name: 'avatar', width: 1024, height: 1024, markup: symbolMarkup(document, 1024, color('lime'), color('field'), (1024 - 512 * Math.min(1.2, symbolScale)) / 2) },
  ]
  for (const [name, width, height] of [['social-square', 1080, 1080], ['social-story', 1080, 1920], ['social-landscape', 1200, 630]] as const) {
    const wide = width > height, story = height > width
    const margin = wide ? 64 : 80, top = story ? 240 : margin, bottom = story ? 240 : margin
    const symbolSize = (wide ? 128 : 144) * symbolScale
    const bare = (source: VectorElement, overrides: Partial<VectorElement>): VectorElement => ({ ...source, parentId: undefined, fills: undefined, ...overrides })
    const background = bare(get('social-field'), { id: 'background', x: 0, y: 0, width, height, fill: color('field') })
    const fit = (source: VectorElement, x: number, y: number, boxWidth: number, boxHeight: number, size: number, fill: string) => {
      const ratio = (source.letterSpacing ?? 0) / (source.fontSize ?? 20)
      const element = bare(source, { x, y, width: boxWidth, height: boxHeight, fontSize: size, letterSpacing: ratio * size, fill, textSizing: 'fixed' })
      // Both long copy and wide glyphs must fit. Never silently crop an export.
      for (let count = 0; count < 100; count++) {
        const layout = layoutText(textProperties(element), boxWidth, canvasMeasure)
        if (layout.height <= boxHeight && layout.lines.every(line => line.width <= boxWidth + 0.5)) return element
        element.fontSize! *= 0.95
        element.letterSpacing = ratio * element.fontSize!
      }
      throw new Error(`The ${name} copy is too long. Shorten it before exporting.`)
    }
    const headlineY = wide ? 202 : story ? 700 : 400
    const items = [background,
      fit(get('cover-wordmark'), margin, top, width - margin * 3 - symbolSize, 80, wide ? 42 : 52, color('paper')),
      bare(get('cover-mark'), { id: 'symbol', x: width - margin - symbolSize, y: top, width: symbolSize, height: symbolSize, fill: color('lime') }),
      fit(get('social-headline'), margin, headlineY, width - margin * 2, height - headlineY - bottom - 132, (wide ? 100 : 144) * headlineScale, color('paper')),
      fit(get('social-event'), margin, height - bottom - 64, width - margin * 2, 64, wide ? 20 : 26, color('lime')),
    ]
    applications.push({ name, width, height, markup: serializeVectorMarkup(items, { x: 0, y: 0, width, height }) })
  }
  return applications
}

/** Modern ICO: a directory followed by lossless PNG entries at their native sizes. */
export function faviconIco(entries: Array<{ size: number; bytes: Uint8Array }>): Uint8Array<ArrayBuffer> {
  const headerSize = 6 + entries.length * 16
  const bytes = new Uint8Array(headerSize + entries.reduce((sum, entry) => sum + entry.bytes.length, 0)), view = new DataView(bytes.buffer)
  view.setUint16(2, 1, true); view.setUint16(4, entries.length, true)
  let offset = headerSize
  entries.forEach((entry, index) => {
    const at = 6 + index * 16
    view.setUint8(at, entry.size === 256 ? 0 : entry.size); view.setUint8(at + 1, entry.size === 256 ? 0 : entry.size)
    view.setUint16(at + 4, 1, true); view.setUint16(at + 6, 32, true)
    view.setUint32(at + 8, entry.bytes.length, true); view.setUint32(at + 12, offset, true)
    bytes.set(entry.bytes, offset); offset += entry.bytes.length
  })
  return bytes
}
