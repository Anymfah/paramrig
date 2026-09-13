import { fontCapabilities } from './fontCapabilities'
import { serializeVectorMarkup } from '@/vector/serialization'
import { boundsWithEffects } from '@/vector/effects'
import { fontFaceRule } from '@/vector/fonts'
import { createFontLoader } from './fontRuntime'
import type { FontResolver } from './resources'
import { TEXT_FACES } from '@/vector/text'
import type { Bounds } from '@/vector/geometry'
import { inkSelectionBounds } from '@/vector/ink'
import { descendantIds } from '@/vector/tree'
import type { VectorColorSpace, VectorDocument, VectorElement, VectorFont } from '@/vector/types'

export type ExportTargetKind = 'document' | 'frame' | 'selection'

export type ExportSettings = {
  target: ExportTargetKind
  format: 'svg' | 'png' | 'pdf'
  scale: 1 | 2 | 3
  transparent: boolean
}

export const DEFAULT_EXPORT: ExportSettings = { target: 'document', format: 'svg', scale: 2, transparent: false }
export const EXPORT_SCALES = [1, 2, 3] as const
export const MAX_RASTER_SIDE = 8192

export type ExportSelection = { frameId: string | null; selectedIds: string[] }

/** The elements an export covers, with the roots detached so they serialise at the top level. */
export function exportElements(document: VectorDocument, target: ExportTargetKind, selection: ExportSelection): VectorElement[] {
  if (target === 'document') return document.elements
  const roots = target === 'frame'
    ? (selection.frameId ? [selection.frameId] : [])
    : selection.selectedIds
  if (roots.length === 0) return []
  const wanted = new Set(roots.flatMap((id) => [id, ...descendantIds(document.elements, id)]))
  const rootSet = new Set(roots)
  return document.elements
    .filter((element) => wanted.has(element.id))
    .map((element) => {
      if (!rootSet.has(element.id) || !element.parentId) return element
      const { parentId: _parentId, ...rest } = element
      return rest
    })
}

/** The box an export is framed by: the page, the frame's own box, or the selection's bounds. */
export function exportBounds(document: VectorDocument, target: ExportTargetKind, selection: ExportSelection): Bounds | null {
  if (target === 'document') return { x: 0, y: 0, width: document.width, height: document.height }
  if (target === 'frame') {
    const frame = document.elements.find((element) => element.id === selection.frameId && element.kind === 'frame')
    return frame ? inkSelectionBounds([frame]) : null
  }
  const elements = document.elements.filter((element) => selection.selectedIds.includes(element.id))
  if (elements.length === 0) return null
  const bounds = inkSelectionBounds(elements)
  if (bounds.width <= 0 || bounds.height <= 0) return null
  // A shadow or a blur paints outside the box; the export box grows so nothing is cut off.
  return boundsWithEffects(bounds, elements)
}

/** Self-contained SVG for an export, image fills already inline in the paint model. */
export function exportMarkup(document: VectorDocument, settings: ExportSettings, selection: ExportSelection): string | null {
  const bounds = exportBounds(document, settings.target, selection)
  if (!bounds) return null
  const elements = exportElements(document, settings.target, selection)
  return serializeVectorMarkup(elements, bounds, settings.transparent || document.background === 'none' ? undefined : document.background, document.colorSpace)
}

export function exportFileName(document: VectorDocument, settings: ExportSettings, frameName?: string): string {
  const base = settings.target === 'frame' && frameName ? frameName : document.name
  const suffix = settings.format === 'png' && settings.scale !== 1 ? `@${settings.scale}x` : ''
  return `${slug(base)}${suffix}.${settings.format}`
}

/** Pixel size of a raster export, clamped so a huge frame cannot ask for an impossible canvas. */
export function rasterSize(bounds: Bounds, scale: number): { width: number; height: number } {
  const ratio = Math.min(1, MAX_RASTER_SIDE / Math.max(bounds.width * scale, bounds.height * scale, 1))
  return {
    width: Math.max(1, Math.round(bounds.width * scale * ratio)),
    height: Math.max(1, Math.round(bounds.height * scale * ratio)),
  }
}

/**
 * Inlines the faces the markup actually uses, so text keeps its shape once the SVG is rasterised
 * or reopened somewhere that has never heard of the font. The shipped face comes from the app; a
 * document font comes from its own bytes, or from Google, fetched once and cached for the session.
 */
export async function embedFonts(markup: string, fonts: VectorFont[] = [], strict = false, resolveFont?: FontResolver): Promise<string> {
  if (!markup.includes('<text ')) return markup
  const rules: string[] = []
  const loader = createFontLoader(resolveFont)
  const carried = new Set(fonts.map(font => font.family))
  fonts = [...fonts, ...TEXT_FACES.filter(face => face.webFont && !carried.has(face.value) && markup.includes(face.value)).map(face => ({ family: face.value, source: 'system' as const, weights: face.weights ?? [400], axes: fontCapabilities(face.value).axes }))]
  try {
  for (const font of fonts) {
    if (!markup.includes(`'${font.family}'`) && !markup.includes(font.family)) continue
    const weights = font.source === 'google' && !font.data ? font.weights : [font.weights[0] ?? 400]
    for (const weight of weights) {
      const data = await loader.fontData(font, weight)
      const axis = font.axes?.find(axis => axis.tag === 'wght')
      if (data) rules.push(fontFaceRule(font.family, data, font.format ?? 'woff2', axis ? [axis.min, axis.max] : [weight]))
      else if (strict && (font.source !== 'system' || TEXT_FACES.some(face => face.value === font.family && face.webFont))) throw new Error(`Could not embed ${font.family}. Check your connection or import its font file.`)
    }
  }
  if (rules.length === 0) return markup
  return markup.replace(/(<svg[^>]*>)/, `$1\n  <style>${rules.join('')}</style>`)
  } finally { loader.destroy() }
}

/** Draws an SVG string into a canvas and returns the PNG bytes. */
export async function rasterize(markup: string, bounds: Bounds, scale: number, type: 'image/png' | 'image/jpeg' = 'image/png', space?: VectorColorSpace): Promise<Blob | null> {
  if (typeof globalThis.document === 'undefined' || typeof Image === 'undefined') return null
  const size = rasterSize(bounds, scale)
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => resolve(null)
    element.src = source
  })
  if (!image) return null
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  // A wide-gamut document rasterises into a wide-gamut canvas where the browser has one.
  const context = space === 'display-p3'
    ? (canvas.getContext('2d', { colorSpace: 'display-p3' }) ?? canvas.getContext('2d'))
    : canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, size.width, size.height)
  if (type === 'image/jpeg') {
    // A JPEG goes into a PDF as it is; it needs an opaque ground under it first.
    const flat = globalThis.document.createElement('canvas')
    flat.width = size.width
    flat.height = size.height
    const ground = flat.getContext('2d')
    if (!ground) return null
    ground.fillStyle = '#ffffff'
    ground.fillRect(0, 0, size.width, size.height)
    ground.drawImage(canvas, 0, 0)
    return new Promise<Blob | null>((resolve) => flat.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92))
  }
  return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
}
