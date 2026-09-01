import { createLruCache } from '@/vector/cache'
import { cornerRadii, rectangleRun, roundCorners } from '@/vector/corners'
import { chains, chainToRun, defaultNetwork, localNetwork, runPathData, worldNetwork, type AbsNetwork, type Run } from '@/vector/network'
import { fillsOf, strokesOf, summaryColor } from '@/vector/paints'
import { computeFaces, faceContainsPoint, loopToRun, type Face } from '@/vector/planar'
import { canvasMeasure, fontStack, layoutText, textProperties } from '@/vector/text'
import type { VectorArrowhead, VectorElement, VectorGradientStop, VectorPaint } from '@/vector/types'

export type RenderDef =
  | { type: 'linearGradient'; id: string; x1: number; y1: number; x2: number; y2: number; stops: VectorGradientStop[] }
  | { type: 'radialGradient'; id: string; stops: VectorGradientStop[] }
  | { type: 'pattern'; id: string; image: string; mode: 'fill' | 'fit' | 'tile'; x: number; y: number; width: number; height: number }
  | { type: 'clipPath'; id: string; d: string }
  | { type: 'mask'; id: string; d: string; x: number; y: number; width: number; height: number }
  | { type: 'marker'; id: string; shape: Exclude<VectorArrowhead, 'none'>; color: string; end: boolean }

export type RenderLayer = {
  kind: 'fill' | 'stroke'
  d: string
  paint: string
  opacity: number
  strokeWidth?: number
  cap?: 'butt' | 'round' | 'square'
  join?: 'miter' | 'round' | 'bevel'
  dash?: string
  clipPath?: string
  mask?: string
  markerStart?: string
  markerEnd?: string
}

/** A laid-out text run: `<text>` with one `<tspan>` per line, in element coordinates. */
export type TextRender = {
  lines: Array<{ text: string; x: number; y: number }>
  anchor: 'start' | 'middle' | 'end'
  fontFamily: string
  fontSize: number
  fontWeight: number
  letterSpacing: number
  fill: string
  fillOpacity: number
  stroke: string | null
  strokeOpacity: number
  strokeWidth: number
}

export type RenderModel = {
  /** Stroke outline in local coordinates (every chain), used for hit testing. */
  d: string
  /** Filled region path data (even-odd), empty when nothing is fillable. */
  fillD: string
  transform: string
  opacity: number
  defs: RenderDef[]
  layers: RenderLayer[]
  /** Set for text elements; their paint rides on the `<text>` rather than on paths. */
  text?: TextRender
}

/** Local-space geometry of an element: chains for strokes and faces for fills, corners applied. */
export function localGeometry(element: VectorElement): { network: AbsNetwork; strokeRuns: Run[]; fillRuns: Run[]; faces: Face[] } {
  if (!element.network && element.kind === 'rectangle') {
    const run: Run = { points: rectangleRun(element), closed: true }
    return { network: localNetwork(element, defaultNetwork(element)), strokeRuns: [run], fillRuns: [run], faces: [] }
  }
  const network = localNetwork(element, defaultNetwork(element))
  const smoothing = element.cornerSmoothing ?? 0
  const strokeRuns = chains(network).map((chain) => {
    const run = chainToRun(network, chain)
    return { points: roundCorners(run.points, run.closed, smoothing), closed: run.closed }
  })
  const faces = computeFaces(network)
  const off = new Set(element.regionsOff ?? [])
  const fillRuns = faces.filter((face) => !off.has(face.key)).flatMap((face) => [face.outer, ...face.holes].map((loop) => {
    const run = loopToRun(network, loop)
    return { points: roundCorners(run.points, true, smoothing), closed: true }
  }))
  return { network, strokeRuns, fillRuns, faces }
}

/** Faces of an element in world coordinates with a hit test, for the paint bucket. */
export function worldFaces(element: VectorElement): { network: AbsNetwork; faces: Face[]; hit: (point: { x: number; y: number }) => Face | null } {
  const network = worldNetwork(element)
  const faces = computeFaces(network)
  return {
    network,
    faces,
    hit: (point) => {
      const candidates = faces.filter((face) => faceContainsPoint(network, face, point))
      return candidates.sort((a, b) => a.area - b.area)[0] ?? null
    },
  }
}

export function outlinePathData(element: VectorElement): string {
  return localGeometry(element).strokeRuns.map(runPathData).join(' ')
}

const MODEL_CACHE_SIZE = 240
const modelCache = createLruCache<RenderModel>(MODEL_CACHE_SIZE)

/**
 * Builds paint layers and the defs they need. `prefix` keeps ids unique per canvas or export.
 *
 * Models are cached by element content, so callers must treat the result as frozen: a shape that
 * has not changed reuses the model from the previous frame instead of re-arranging its faces.
 */
export function renderModel(element: VectorElement, prefix: string): RenderModel {
  const key = `${prefix}\u0000${JSON.stringify(element)}`
  const cached = modelCache.get(key)
  if (cached) return cached
  const model = buildRenderModel(element, prefix)
  modelCache.set(key, model)
  return model
}

function buildRenderModel(element: VectorElement, prefix: string): RenderModel {
  if (element.kind === 'text') return buildTextModel(element, prefix)
  const defs: RenderDef[] = []
  const layers: RenderLayer[] = []
  const geometry = localGeometry(element)
  const d = geometry.strokeRuns.map(runPathData).join(' ')
  const fillD = geometry.fillRuns.map(runPathData).join(' ')
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const transform = `rotate(${element.rotation} ${round(center.x)} ${round(center.y)})`
  const key = `${prefix}-${element.id}`
  const bounds = { x: element.x, y: element.y, width: element.width, height: element.height }

  if (fillD) {
    fillsOf(element).forEach((paint, index) => {
      if (!paint.visible || paint.opacity <= 0) return
      const reference = paintReference(paint, `${key}-fill-${index}`, bounds, defs)
      if (!reference) return
      layers.push({ kind: 'fill', d: fillD, paint: reference, opacity: paint.opacity })
    })
  }

  const strokes = strokesOf(element)
  if (element.strokeWidth > 0 && strokes.length && d) {
    const align = element.strokeAlign ?? 'center'
    const width = align === 'center' || !fillD ? element.strokeWidth : element.strokeWidth * 2
    let clipPath: string | undefined
    let mask: string | undefined
    if (align === 'inside' && fillD) {
      const id = `${key}-inside`
      defs.push({ type: 'clipPath', id, d: fillD })
      clipPath = `url(#${id})`
    } else if (align === 'outside' && fillD) {
      const id = `${key}-outside`
      const pad = element.strokeWidth * 2 + 2
      defs.push({ type: 'mask', id, d: fillD, x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 })
      mask = `url(#${id})`
    }
    const dash = element.strokeDash && element.strokeDash[0] > 0 ? `${round(element.strokeDash[0])} ${round(Math.max(0, element.strokeDash[1]))}` : undefined
    const strokeD = element.kind === 'rectangle' && !element.network && element.strokeSides && !cornerRadii(element).some(Boolean)
      ? rectangleSides(element)
      : d
    const hasOpenEnd = geometry.strokeRuns.some((run) => !run.closed)
    strokes.forEach((paint, index) => {
      if (!paint.visible || paint.opacity <= 0) return
      const reference = paintReference(paint, `${key}-stroke-${index}`, bounds, defs)
      if (!reference) return
      const color = paint.type === 'solid' && paint.color ? paint.color : summaryColor([paint])
      const markerStart = hasOpenEnd && element.strokeArrowStart && element.strokeArrowStart !== 'none'
        ? marker(defs, `${key}-arrow-start-${index}`, element.strokeArrowStart, color, false)
        : undefined
      const markerEnd = hasOpenEnd && element.strokeArrowEnd && element.strokeArrowEnd !== 'none'
        ? marker(defs, `${key}-arrow-end-${index}`, element.strokeArrowEnd, color, true)
        : undefined
      layers.push({ kind: 'stroke', d: strokeD, paint: reference, opacity: paint.opacity, strokeWidth: width, cap: element.strokeCap ?? 'butt', join: element.strokeJoin ?? 'miter', dash, clipPath, mask, markerStart, markerEnd })
    })
  }

  return { d, fillD, transform, opacity: element.opacity, defs, layers }
}

/** Box outline plus the laid-out lines; the box carries hit testing, the `<text>` the paint. */
function buildTextModel(element: VectorElement, prefix: string): RenderModel {
  const defs: RenderDef[] = []
  const key = `${prefix}-${element.id}`
  const bounds = { x: element.x, y: element.y, width: element.width, height: element.height }
  const properties = textProperties(element)
  const layout = layoutText(properties, element.width, canvasMeasure)
  const box = `M ${round(bounds.x)} ${round(bounds.y)} L ${round(bounds.x + bounds.width)} ${round(bounds.y)} L ${round(bounds.x + bounds.width)} ${round(bounds.y + bounds.height)} L ${round(bounds.x)} ${round(bounds.y + bounds.height)} Z`
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const fill = fillsOf(element).filter((paint) => paint.visible && paint.opacity > 0).at(-1)
  const stroke = strokesOf(element).filter((paint) => paint.visible && paint.opacity > 0).at(-1)
  const fillReference = fill ? paintReference(fill, `${key}-text-fill`, bounds, defs) : null
  const strokeReference = stroke && element.strokeWidth > 0 ? paintReference(stroke, `${key}-text-stroke`, bounds, defs) : null
  const text: TextRender = {
    lines: layout.lines.map((line) => ({ text: line.text, x: round(bounds.x + line.x), y: round(bounds.y + line.y) })),
    anchor: layout.anchor,
    fontFamily: fontStack(properties.fontFamily),
    fontSize: properties.fontSize,
    fontWeight: properties.fontWeight,
    letterSpacing: properties.letterSpacing,
    fill: fillReference ?? 'none',
    fillOpacity: fill?.opacity ?? 1,
    stroke: strokeReference,
    strokeOpacity: stroke?.opacity ?? 1,
    strokeWidth: element.strokeWidth,
  }
  return {
    d: box,
    fillD: box,
    transform: `rotate(${element.rotation} ${round(center.x)} ${round(center.y)})`,
    opacity: element.opacity,
    defs,
    layers: [],
    text,
  }
}

function marker(defs: RenderDef[], id: string, shape: Exclude<VectorArrowhead, 'none'>, color: string, end: boolean): string {
  defs.push({ type: 'marker', id, shape, color, end })
  return `url(#${id})`
}

function paintReference(paint: VectorPaint, id: string, bounds: { x: number; y: number; width: number; height: number }, defs: RenderDef[]): string | null {
  if (paint.type === 'solid') return paint.color && paint.color !== 'none' ? paint.color : null
  if (paint.type === 'linear') {
    if (!paint.stops || paint.stops.length < 2) return null
    const radians = ((paint.angle ?? 0) * Math.PI) / 180
    const dx = Math.cos(radians) / 2
    const dy = Math.sin(radians) / 2
    defs.push({ type: 'linearGradient', id, x1: round(0.5 - dx), y1: round(0.5 - dy), x2: round(0.5 + dx), y2: round(0.5 + dy), stops: paint.stops })
    return `url(#${id})`
  }
  if (paint.type === 'radial') {
    if (!paint.stops || paint.stops.length < 2) return null
    defs.push({ type: 'radialGradient', id, stops: paint.stops })
    return `url(#${id})`
  }
  if (!paint.image) return null
  defs.push({ type: 'pattern', id, image: paint.image, mode: paint.imageMode ?? 'fill', ...bounds })
  return `url(#${id})`
}

function rectangleSides(element: VectorElement): string {
  const sides = element.strokeSides!
  const left = element.x
  const top = element.y
  const right = element.x + element.width
  const bottom = element.y + element.height
  const parts: string[] = []
  if (sides.top) parts.push(`M ${round(left)} ${round(top)} L ${round(right)} ${round(top)}`)
  if (sides.right) parts.push(`M ${round(right)} ${round(top)} L ${round(right)} ${round(bottom)}`)
  if (sides.bottom) parts.push(`M ${round(right)} ${round(bottom)} L ${round(left)} ${round(bottom)}`)
  if (sides.left) parts.push(`M ${round(left)} ${round(bottom)} L ${round(left)} ${round(top)}`)
  return parts.join(' ')
}

/** Marker geometry in stroke-width units; the tip sits on the path end. */
export function markerShape(shape: Exclude<VectorArrowhead, 'none'>): { size: number; refX: number; d: string; fill: boolean } {
  switch (shape) {
    case 'arrow': return { size: 8, refX: 7, d: 'M 1 1 L 7 4 L 1 7', fill: false }
    case 'triangle': return { size: 8, refX: 7, d: 'M 1 1 L 7 4 L 1 7 Z', fill: true }
    case 'circle': return { size: 6, refX: 3, d: 'M 0.5 3 A 2.5 2.5 0 1 0 5.5 3 A 2.5 2.5 0 1 0 0.5 3 Z', fill: true }
    case 'square': return { size: 6, refX: 3, d: 'M 0.5 0.5 L 5.5 0.5 L 5.5 5.5 L 0.5 5.5 Z', fill: true }
    case 'bar': return { size: 6, refX: 3, d: 'M 3 0.5 L 3 5.5', fill: false }
  }
}

/** SVG markup for defs, shared by export and thumbnails. */
export function defsToSvg(defs: RenderDef[]): string {
  return defs.map((def) => {
    switch (def.type) {
      case 'linearGradient':
        return `<linearGradient id="${def.id}" x1="${def.x1}" y1="${def.y1}" x2="${def.x2}" y2="${def.y2}">${stopsToSvg(def.stops)}</linearGradient>`
      case 'radialGradient':
        return `<radialGradient id="${def.id}">${stopsToSvg(def.stops)}</radialGradient>`
      case 'pattern': {
        const aspect = def.mode === 'fit' ? 'xMidYMid meet' : def.mode === 'fill' ? 'xMidYMid slice' : 'none'
        const tile = def.mode === 'tile'
        const size = tile ? Math.max(1, Math.min(def.width, def.height) / 2) : def.width
        const height = tile ? size : def.height
        return `<pattern id="${def.id}" patternUnits="userSpaceOnUse" x="${round(def.x)}" y="${round(def.y)}" width="${round(size)}" height="${round(height)}"><image href="${def.image}" x="0" y="0" width="${round(size)}" height="${round(height)}" preserveAspectRatio="${aspect}"/></pattern>`
      }
      case 'clipPath':
        return `<clipPath id="${def.id}"><path d="${def.d}" clip-rule="evenodd"/></clipPath>`
      case 'mask':
        return `<mask id="${def.id}" maskUnits="userSpaceOnUse" x="${round(def.x)}" y="${round(def.y)}" width="${round(def.width)}" height="${round(def.height)}"><rect x="${round(def.x)}" y="${round(def.y)}" width="${round(def.width)}" height="${round(def.height)}" fill="#fff"/><path d="${def.d}" fill="#000" fill-rule="evenodd"/></mask>`
      case 'marker': {
        const shape = markerShape(def.shape)
        return `<marker id="${def.id}" markerUnits="strokeWidth" markerWidth="${shape.size}" markerHeight="${shape.size}" refX="${shape.refX}" refY="${shape.size / 2}" orient="${def.end ? 'auto' : 'auto-start-reverse'}"><path d="${shape.d}" fill="${shape.fill ? def.color : 'none'}" stroke="${def.color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></marker>`
      }
    }
  }).join('')
}

function stopsToSvg(stops: VectorGradientStop[]): string {
  return stops.map((stop) => `<stop offset="${round(stop.t * 100)}%" stop-color="${stop.color}"/>`).join('')
}

/** SVG markup for one element's layers (no group wrapper). */
export function layersToSvg(model: RenderModel, id: string): string {
  if (model.text) return textToSvg(model, id)
  return model.layers.map((layer, index) => {
    const attributes = layerAttributes(layer)
    const svgAttributes = Object.entries(attributes).map(([name, value]) => `${camelToKebab(name)}="${String(value)}"`).join(' ')
    return `<path${index === 0 ? ` id="${id}"` : ''} d="${layer.d}" ${svgAttributes} transform="${model.transform}"/>`
  }).join('')
}

function textToSvg(model: RenderModel, id: string): string {
  const text = model.text!
  const attributes = [
    `id="${escapeAttribute(id)}"`,
    `font-family="${escapeAttribute(text.fontFamily)}"`,
    `font-size="${text.fontSize}"`,
    `font-weight="${text.fontWeight}"`,
    text.letterSpacing ? `letter-spacing="${text.letterSpacing}"` : '',
    `text-anchor="${text.anchor}"`,
    `fill="${escapeAttribute(text.fill)}"`,
    `fill-opacity="${text.fillOpacity}"`,
    text.stroke ? `stroke="${escapeAttribute(text.stroke)}" stroke-opacity="${text.strokeOpacity}" stroke-width="${text.strokeWidth}"` : '',
    `xml:space="preserve"`,
    `transform="${model.transform}"`,
  ].filter(Boolean).join(' ')
  const spans = text.lines.map((line) => `<tspan x="${line.x}" y="${line.y}">${escapeText(line.text)}</tspan>`).join('')
  return `<text ${attributes}>${spans}</text>`
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Attribute bag for a layer in React prop names. */
export function layerAttributes(layer: RenderLayer): Record<string, string | number> {
  if (layer.kind === 'fill') {
    return { fill: layer.paint, fillOpacity: layer.opacity, fillRule: 'evenodd', stroke: 'none' }
  }
  return {
    fill: 'none',
    stroke: layer.paint,
    strokeOpacity: layer.opacity,
    strokeWidth: layer.strokeWidth ?? 1,
    strokeLinecap: layer.cap ?? 'butt',
    strokeLinejoin: layer.join ?? 'miter',
    ...(layer.dash ? { strokeDasharray: layer.dash } : {}),
    ...(layer.clipPath ? { clipPath: layer.clipPath } : {}),
    ...(layer.mask ? { mask: layer.mask } : {}),
    ...(layer.markerStart ? { markerStart: layer.markerStart } : {}),
    ...(layer.markerEnd ? { markerEnd: layer.markerEnd } : {}),
  }
}

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
