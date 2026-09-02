import { createLruCache } from '@/vector/cache'
import { cornerRadii, rectangleRun, roundCorners } from '@/vector/corners'
import { chains, chainToRun, defaultNetwork, localNetwork, runPathData, worldNetwork, type AbsNetwork, type Run } from '@/vector/network'
import { fillsOf, strokesOf, summaryColor } from '@/vector/paints'
import { computeFaces, faceContainsPoint, holeFaceKeys, loopToRun, type Face } from '@/vector/planar'
import { displayRect, FULL_CROP, isFullCrop } from '@/vector/crop'
import { gradientCircle, gradientLine } from '@/vector/gradient'
import { canvasMeasure, fontStack, layoutText, textProperties } from '@/vector/text'
import { backdropBlur, elementFilter, type FilterDef, type FilterPrimitive } from '@/vector/filters'
import { blendModeCss } from '@/vector/effects'
import { envelopePath } from '@/vector/strokeProfile'
import { brushOutline, resolveBrush } from '@/vector/brushes'
import { resolveSelfIntersections } from '@/vector/booleans'
import type { VectorArrowhead, VectorBrush, VectorElement, VectorGradientStop, VectorPaint, VectorPoint } from '@/vector/types'

export type RenderDef =
  | { type: 'linearGradient'; id: string; x1: number; y1: number; x2: number; y2: number; stops: VectorGradientStop[] }
  | { type: 'radialGradient'; id: string; cx: number; cy: number; r: number; stops: VectorGradientStop[] }
  | { type: 'pattern'; id: string; image: string; mode: 'fill' | 'fit' | 'tile'; x: number; y: number; width: number; height: number; offset?: VectorPoint; scale?: number }
  | { type: 'clipPath'; id: string; d: string }
  | { type: 'textPath'; id: string; d: string }
  | { type: 'mask'; id: string; d: string; x: number; y: number; width: number; height: number }
  | { type: 'marker'; id: string; shape: Exclude<VectorArrowhead, 'none'>; color: string; end: boolean }
  | FilterDef

export type RenderLayer = {
  kind: 'fill' | 'stroke'
  d: string
  /** Fills default to even-odd; a swept or stamped stroke overlaps itself and wants non-zero. */
  fillRule?: 'nonzero' | 'evenodd'
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
  /** Set when the text rides on an outline: the def to hang it on, and where it starts. */
  path?: { id: string; startOffset: string; side: 'left' | 'right' }
}

/** A placed picture: where it lands in world space, and the box that clips it. */
export type ImageRender = {
  href: string
  x: number
  y: number
  width: number
  height: number
  rendering: 'auto' | 'pixelated'
  clipPath: string | null
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
  /** Set for image elements. */
  image?: ImageRender
  /** `url(#…)` of the element's effect filter, when it has one. */
  filter?: string
  /** CSS blend mode, absent when the element mixes normally. */
  blend?: string
  /** Background blur radius: SVG has no backdrop, so this rides on CSS instead. */
  backdropBlur?: number
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
  // A primitive's holes are structural — the middle of a ring is not a face to paint — while an
  // edited network leaves every face on until the bucket says otherwise.
  const off = new Set([...(element.regionsOff ?? []), ...(element.network ? [] : holeFaceKeys(faces))])
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

/** Envelopes are expensive enough to keep: the key is the geometry and the profile together. */
const outlineCache = createLruCache<string>(120)

function profileOutline(runs: Run[], element: VectorElement, brush: VectorBrush | null): string {
  const cap = element.strokeCap ?? 'butt'
  const key = JSON.stringify([runs, element.strokeWidth, element.strokeProfile, cap, element.brush, brush?.id])
  const cached = outlineCache.get(key)
  if (cached !== undefined) return cached
  // A brush leaves hundreds of stamps: they paint correctly under the non-zero rule, and putting
  // them through a boolean union would cost far more than it shows.
  const stamped = brush && element.brush
  const raw = stamped
    ? brushOutline(runs, element, brush, element.brush!)
    : runs.map((run) => envelopePath(run, element.strokeWidth, element.strokeProfile, cap)).filter(Boolean).join(' ')
  const cleaned = raw && !stamped ? resolveSelfIntersections(raw) : raw
  outlineCache.set(key, cleaned)
  return cleaned
}

const MODEL_CACHE_SIZE = 240
const modelCache = createLruCache<RenderModel>(MODEL_CACHE_SIZE)

/**
 * Builds paint layers and the defs they need. `prefix` keeps ids unique per canvas or export.
 *
 * Models are cached by element content, so callers must treat the result as frozen: a shape that
 * has not changed reuses the model from the previous frame instead of re-arranging its faces.
 */
/** Hits and misses on the model cache, so a QA run can tell a repaint from a rebuild. */
export const renderStats = { hits: 0, misses: 0, get size() { return modelCache.size } }

export function renderModel(element: VectorElement, prefix: string): RenderModel {
  const key = `${prefix}\u0000${JSON.stringify(element)}`
  const cached = modelCache.get(key)
  if (cached) {
    renderStats.hits += 1
    return cached
  }
  renderStats.misses += 1
  const model = buildRenderModel(element, prefix)
  modelCache.set(key, model)
  return model
}

function buildRenderModel(element: VectorElement, prefix: string): RenderModel {
  return withEffects(element, `${prefix}-${element.id}`, buildBaseModel(element, prefix))
}

/** Adds the effect filter, the blend mode and the background blur to a freshly built model. */
function withEffects(element: VectorElement, key: string, model: RenderModel): RenderModel {
  const bounds = { x: element.x, y: element.y, width: element.width, height: element.height }
  const filter = elementFilter(element, bounds, `${key}-filter`)
  const blur = backdropBlur(element)
  const blend = element.blendMode && element.blendMode !== 'normal' ? blendModeCss(element.blendMode) : undefined
  if (!filter && !blend && !blur) return model
  return {
    ...model,
    ...(filter ? { defs: [...model.defs, filter], filter: `url(#${filter.id})` } : {}),
    ...(blend ? { blend } : {}),
    ...(blur ? { backdropBlur: blur } : {}),
  }
}

function buildBaseModel(element: VectorElement, prefix: string): RenderModel {
  if (element.kind === 'text') return buildTextModel(element, prefix)
  if (element.kind === 'image') return buildImageModel(element, prefix)
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
  // A profiled stroke is not a stroke at all once it is drawn: it is the shape the pen would
  // sweep, filled with the stroke's own paint. It replaces the stroke layers entirely.
  const brush = resolveBrush(element.brush)
  const profileD = (element.strokeProfile || brush) && element.strokeWidth > 0 && strokes.length
    ? profileOutline(geometry.strokeRuns, element, brush)
    : ''
  if (profileD) {
    strokes.forEach((paint, index) => {
      if (!paint.visible || paint.opacity <= 0) return
      const reference = paintReference(paint, `${key}-profile-${index}`, bounds, defs)
      if (!reference) return
      // Stamps and swept outlines overlap themselves: even-odd would punch holes in them.
      layers.push({ kind: 'fill', d: profileD, paint: reference, opacity: paint.opacity, fillRule: 'nonzero' })
    })
  } else if (element.strokeWidth > 0 && strokes.length && d) {
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

/** The picture scaled so its cropped part fills the box, clipped to the box. */
function buildImageModel(element: VectorElement, prefix: string): RenderModel {
  const defs: RenderDef[] = []
  const key = `${prefix}-${element.id}`
  const box = { x: element.x, y: element.y, width: element.width, height: element.height }
  const outline = `M ${round(box.x)} ${round(box.y)} L ${round(box.x + box.width)} ${round(box.y)} L ${round(box.x + box.width)} ${round(box.y + box.height)} L ${round(box.x)} ${round(box.y + box.height)} Z`
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const display = displayRect(box, element.crop ?? FULL_CROP)
  const cropped = !isFullCrop(element.crop)
  if (cropped) defs.push({ type: 'clipPath', id: `${key}-crop`, d: outline })
  return {
    d: outline,
    fillD: outline,
    transform: `rotate(${element.rotation} ${round(center.x)} ${round(center.y)})`,
    opacity: element.opacity,
    defs,
    layers: [],
    image: {
      href: element.image ?? '',
      x: round(display.x),
      y: round(display.y),
      width: round(display.width),
      height: round(display.height),
      rendering: element.imageRendering === 'pixelated' ? 'pixelated' : 'auto',
      clipPath: cropped ? `url(#${key}-crop)` : null,
    },
  }
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
  const ride = element.textPath?.d ? element.textPath : null
  if (ride?.d) defs.push({ type: 'textPath', id: `${key}-textpath`, d: ride.d })
  const text: TextRender = {
    // On a path the whole text is one run: the browser walks the outline for us.
    lines: ride
      ? [{ text: properties.text.replace(/\n/g, ' '), x: 0, y: 0 }]
      : layout.lines.map((line) => ({ text: line.text, x: round(bounds.x + line.x), y: round(bounds.y + line.y) })),
    anchor: ride ? (ride.align === 'center' ? 'middle' : ride.align === 'right' ? 'end' : 'start') : layout.anchor,
    fontFamily: fontStack(properties.fontFamily),
    fontSize: properties.fontSize,
    fontWeight: properties.fontWeight,
    letterSpacing: properties.letterSpacing,
    fill: fillReference ?? 'none',
    fillOpacity: fill?.opacity ?? 1,
    stroke: strokeReference,
    strokeOpacity: stroke?.opacity ?? 1,
    strokeWidth: element.strokeWidth,
    ...(ride ? { path: { id: `${key}-textpath`, startOffset: `${round(ride.offset * 100)}%`, side: ride.side === 'below' ? 'right' as const : 'left' as const } } : {}),
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
    const line = gradientLine(paint)
    defs.push({ type: 'linearGradient', id, x1: round(line.from.x), y1: round(line.from.y), x2: round(line.to.x), y2: round(line.to.y), stops: paint.stops })
    return `url(#${id})`
  }
  if (paint.type === 'radial') {
    if (!paint.stops || paint.stops.length < 2) return null
    const circle = gradientCircle(paint)
    defs.push({ type: 'radialGradient', id, cx: round(circle.center.x), cy: round(circle.center.y), r: round(circle.radius), stops: paint.stops })
    return `url(#${id})`
  }
  if (!paint.image) return null
  defs.push({
    type: 'pattern', id, image: paint.image, mode: paint.imageMode ?? 'fill', ...bounds,
    ...(paint.imageOffset ? { offset: paint.imageOffset } : {}),
    ...(paint.imageScale ? { scale: paint.imageScale } : {}),
  })
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
        return `<radialGradient id="${def.id}" cx="${def.cx}" cy="${def.cy}" r="${def.r}">${stopsToSvg(def.stops)}</radialGradient>`
      case 'pattern': {
        const placed = patternPlacement(def)
        return `<pattern id="${def.id}" patternUnits="userSpaceOnUse" x="${round(def.x)}" y="${round(def.y)}" width="${round(placed.tileWidth)}" height="${round(placed.tileHeight)}"><image href="${def.image}" x="${round(placed.x)}" y="${round(placed.y)}" width="${round(placed.width)}" height="${round(placed.height)}" preserveAspectRatio="${placed.aspect}"/></pattern>`
      }
      case 'clipPath':
        return `<clipPath id="${def.id}"><path d="${def.d}" clip-rule="evenodd"/></clipPath>`
      case 'textPath':
        return `<path id="${def.id}" d="${def.d}" fill="none"/>`
      case 'mask':
        return `<mask id="${def.id}" maskUnits="userSpaceOnUse" x="${round(def.x)}" y="${round(def.y)}" width="${round(def.width)}" height="${round(def.height)}"><rect x="${round(def.x)}" y="${round(def.y)}" width="${round(def.width)}" height="${round(def.height)}" fill="#fff"/><path d="${def.d}" fill="#000" fill-rule="evenodd"/></mask>`
      case 'filter':
        return `<filter id="${def.id}" filterUnits="userSpaceOnUse" x="${def.x}" y="${def.y}" width="${def.width}" height="${def.height}">${primitivesToSvg(def.primitives)}</filter>`
      case 'marker': {
        const shape = markerShape(def.shape)
        return `<marker id="${def.id}" markerUnits="strokeWidth" markerWidth="${shape.size}" markerHeight="${shape.size}" refX="${shape.refX}" refY="${shape.size / 2}" orient="${def.end ? 'auto' : 'auto-start-reverse'}"><path d="${shape.d}" fill="${shape.fill ? def.color : 'none'}" stroke="${def.color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></marker>`
      }
    }
  }).join('')
}

/** Where the picture sits inside its pattern tile, once offset and scale are applied. */
export function patternPlacement(def: Extract<RenderDef, { type: 'pattern' }>) {
  const tile = def.mode === 'tile'
  const tileWidth = tile ? Math.max(1, Math.min(def.width, def.height) / 2) : def.width
  const tileHeight = tile ? tileWidth : def.height
  const scale = def.mode === 'fill' && def.scale ? def.scale : 1
  const offset = def.mode === 'fill' && def.offset ? def.offset : { x: 0, y: 0 }
  return {
    aspect: def.mode === 'fit' ? 'xMidYMid meet' : def.mode === 'fill' ? 'xMidYMid slice' : 'none',
    tileWidth,
    tileHeight,
    x: offset.x * tileWidth,
    y: offset.y * tileHeight,
    width: tileWidth * scale,
    height: tileHeight * scale,
  }
}

function primitivesToSvg(primitives: FilterPrimitive[]): string {
  return primitives.map((primitive) => {
    const attributes = Object.entries(primitive.attrs).map(([name, value]) => `${name}="${escapeAttribute(String(value))}"`).join(' ')
    const open = `<${primitive.tag}${attributes ? ` ${attributes}` : ''}`
    return primitive.children?.length ? `${open}>${primitivesToSvg(primitive.children)}</${primitive.tag}>` : `${open}/>`
  }).join('')
}

function stopsToSvg(stops: VectorGradientStop[]): string {
  return stops.map((stop) => `<stop offset="${round(stop.t * 100)}%" stop-color="${stop.color}"/>`).join('')
}

/** SVG markup for one element's layers (no group wrapper). */
export function layersToSvg(model: RenderModel, id: string): string {
  if (model.image) return imageToSvg(model, id)
  if (model.text) return textToSvg(model, id)
  return model.layers.map((layer, index) => {
    const attributes = layerAttributes(layer)
    const svgAttributes = Object.entries(attributes).map(([name, value]) => `${camelToKebab(name)}="${String(value)}"`).join(' ')
    return `<path${index === 0 ? ` id="${id}"` : ''} d="${layer.d}" ${svgAttributes} transform="${model.transform}"/>`
  }).join('')
}

function imageToSvg(model: RenderModel, id: string): string {
  const image = model.image!
  const attributes = [
    `id="${escapeAttribute(id)}"`,
    `href="${escapeAttribute(image.href)}"`,
    `x="${image.x}"`,
    `y="${image.y}"`,
    `width="${image.width}"`,
    `height="${image.height}"`,
    'preserveAspectRatio="none"',
    image.rendering === 'pixelated' ? 'image-rendering="pixelated"' : '',
    image.clipPath ? `clip-path="${escapeAttribute(image.clipPath)}"` : '',
    `transform="${model.transform}"`,
  ].filter(Boolean).join(' ')
  return `<image ${attributes}/>`
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
  if (text.path) {
    const content = escapeText(text.lines.map((line) => line.text).join(' '))
    return `<text ${attributes}><textPath href="#${escapeAttribute(text.path.id)}" startOffset="${text.path.startOffset}" side="${text.path.side}">${content}</textPath></text>`
  }
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
    return { fill: layer.paint, fillOpacity: layer.opacity, fillRule: layer.fillRule ?? 'evenodd', stroke: 'none' }
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
