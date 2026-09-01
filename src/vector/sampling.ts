import { rgbToHex } from '@/ui/color'
import { embedFonts, exportMarkup, rasterSize } from '@/vector/export'
import type { Bounds } from '@/vector/geometry'
import type { VectorDocument, VectorPoint } from '@/vector/types'

/** Just enough of `ImageData` to read a pixel, so the maths can be tested without a canvas. */
export type PixelSource = { width: number; height: number; data: Uint8ClampedArray | number[] }

export type CanvasSample = { image: PixelSource; bounds: Bounds; scale: number }

export const SAMPLE_SCALE = 1

/**
 * Colour of the rendered document under a point in document coordinates, or null when the point
 * falls outside the raster or on a fully transparent pixel.
 */
export function colorAt(sample: CanvasSample, point: VectorPoint): string | null {
  const { image, bounds, scale } = sample
  const x = Math.floor((point.x - bounds.x) * scale)
  const y = Math.floor((point.y - bounds.y) * scale)
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null
  const offset = (y * image.width + x) * 4
  const alpha = image.data[offset + 3] ?? 0
  if (alpha === 0) return null
  return rgbToHex(image.data[offset] ?? 0, image.data[offset + 1] ?? 0, image.data[offset + 2] ?? 0)
}

/** Renders the whole page into an offscreen canvas so colours can be read back from it. */
export async function sampleDocument(document: VectorDocument): Promise<CanvasSample | null> {
  if (typeof globalThis.document === 'undefined' || typeof Image === 'undefined') return null
  const bounds: Bounds = { x: 0, y: 0, width: document.width, height: document.height }
  const markup = exportMarkup(document, { target: 'document', format: 'png', scale: SAMPLE_SCALE, transparent: false }, { frameId: null, selectedIds: [] })
  if (!markup) return null
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await embedFonts(markup))}`
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => resolve(null)
    element.src = source
  })
  if (!image) return null
  const size = rasterSize(bounds, SAMPLE_SCALE)
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, size.width, size.height)
  try {
    return { image: context.getImageData(0, 0, size.width, size.height), bounds, scale: size.width / bounds.width }
  } catch {
    return null
  }
}
