import { MAX_IMAGE_BYTES } from '@/vector/paints'

const SCALES = [1, 0.75, 0.5, 0.35, 0.25]
const QUALITIES = [0.82, 0.7, 0.58, 0.45]

/** Decoded byte length of a data URL payload, base64 or percent-encoded. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const payload = dataUrl.slice(comma + 1)
  if (!/;base64/i.test(dataUrl.slice(0, comma))) {
    try {
      return new TextEncoder().encode(decodeURIComponent(payload)).length
    } catch {
      return payload.length
    }
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

/** Longest side a raster needs so that `width × height × scale²` stays under the budget. */
export function scaleLadder(): number[] {
  return SCALES
}

/**
 * Re-encodes an oversized raster as WebP, shrinking it until it fits the budget.
 * Returns the input unchanged when it already fits, when it is vector data, or when
 * no canvas is available (tests, workers).
 */
export async function compressImageDataUrl(dataUrl: string, maxBytes: number = MAX_IMAGE_BYTES): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl
  if (dataUrlBytes(dataUrl) <= maxBytes) return dataUrl
  if (dataUrl.startsWith('data:image/svg+xml')) return dataUrl
  const image = await decode(dataUrl)
  if (!image) return dataUrl
  let best: string | null = null
  for (const scale of SCALES) {
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    for (const quality of QUALITIES) {
      const encoded = encode(image.source, width, height, quality)
      if (!encoded) return dataUrl
      if (!best || dataUrlBytes(encoded) < dataUrlBytes(best)) best = encoded
      if (dataUrlBytes(encoded) <= maxBytes) return encoded
    }
  }
  return best ?? dataUrl
}

/** Reads a picked file as a data URL, compressed to fit the paint budget. */
export async function readImageFile(file: File, maxBytes: number = MAX_IMAGE_BYTES): Promise<string | null> {
  const dataUrl = await new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null
  return compressImageDataUrl(dataUrl, maxBytes)
}

/** Natural pixel size of an encoded picture, or null when it cannot be decoded here. */
export async function imageNaturalSize(dataUrl: string): Promise<{ width: number; height: number } | null> {
  const decoded = await decode(dataUrl)
  return decoded ? { width: decoded.width, height: decoded.height } : null
}

type Decoded = { source: CanvasImageSource; width: number; height: number }

async function decode(dataUrl: string): Promise<Decoded | null> {
  if (typeof Image === 'undefined') return null
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

function encode(source: CanvasImageSource, width: number, height: number, quality: number): string | null {
  if (typeof globalThis.document === 'undefined') return null
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0, width, height)
  const encoded = canvas.toDataURL('image/webp', quality)
  return encoded.startsWith('data:image/webp') ? encoded : null
}
