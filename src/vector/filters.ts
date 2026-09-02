import { activeEffects, effectPadding } from '@/vector/effects'
import type { Bounds } from '@/vector/geometry'
import type { VectorEffect, VectorElement, VectorImageAdjustments } from '@/vector/types'

/** One `<fe…>` node: a tag and its attributes, so both renderers can walk the same list. */
export type FilterPrimitive = { tag: string; attrs: Record<string, string | number>; children?: FilterPrimitive[] }

export type FilterDef = {
  type: 'filter'
  id: string
  x: number
  y: number
  width: number
  height: number
  primitives: FilterPrimitive[]
}

/**
 * The filter chain for a set of effects, in the order they are listed.
 *
 * Blurs act on what has been drawn so far. Shadows are built from the shape's own alpha, so they
 * follow the outline rather than the blurred picture: dropped ones are merged underneath, inner
 * ones on top. The spread is a morphology on the alpha, which is what fattens or thins the shape
 * before it is blurred.
 */
export function filterPrimitives(effects: VectorEffect[], adjustments?: VectorImageAdjustments): FilterPrimitive[] {
  const primitives: FilterPrimitive[] = []
  let source = 'SourceGraphic'
  let index = 0
  const drops: string[] = []
  const inners: string[] = []

  if (adjustments) {
    for (const primitive of adjustmentPrimitives(adjustments, source, `adj${index}`)) primitives.push(primitive)
    if (primitives.length) source = `adj${index++}`
  }

  for (const effect of effects) {
    const name = (suffix: string) => `f${index}${suffix}`
    if (effect.kind === 'layerBlur') {
      primitives.push({ tag: 'feGaussianBlur', attrs: { in: source, stdDeviation: sigma(effect.blur), result: name('') } })
      source = name('')
      index += 1
      continue
    }
    if (effect.kind === 'backgroundBlur') continue // Handled outside the filter: SVG has no backdrop.
    const spread = effect.spread ?? 0
    let alpha = 'SourceAlpha'
    if (spread !== 0) {
      primitives.push({ tag: 'feMorphology', attrs: { in: alpha, operator: spreadOperator(effect.kind, spread), radius: Math.abs(spread), result: name('m') } })
      alpha = name('m')
    }
    primitives.push({ tag: 'feOffset', attrs: { in: alpha, dx: effect.dx ?? 0, dy: effect.dy ?? 0, result: name('o') } })
    if (effect.blur > 0) primitives.push({ tag: 'feGaussianBlur', attrs: { in: name('o'), stdDeviation: sigma(effect.blur), result: name('b') } })
    const shape = effect.blur > 0 ? name('b') : name('o')
    if (effect.kind === 'innerShadow') {
      // The part of the shape the shifted, blurred copy leaves uncovered is where the shadow sits.
      primitives.push({ tag: 'feComposite', attrs: { in: 'SourceAlpha', in2: shape, operator: 'out', result: name('r') } })
    }
    primitives.push({ tag: 'feFlood', attrs: { 'flood-color': effect.color ?? '#000000', 'flood-opacity': effect.opacity ?? 1, result: name('c') } })
    primitives.push({ tag: 'feComposite', attrs: { in: name('c'), in2: effect.kind === 'innerShadow' ? name('r') : shape, operator: 'in', result: name('s') } })
    ;(effect.kind === 'innerShadow' ? inners : drops).push(name('s'))
    index += 1
  }

  if (drops.length === 0 && inners.length === 0) return primitives
  // Shadows dropped behind, then the shape itself, then the ones that sit inside it.
  const merged = [...drops, source, ...inners]
  primitives.push({ tag: 'feMerge', attrs: {}, children: merged.map((node) => ({ tag: 'feMergeNode', attrs: { in: node } })) })
  return primitives
}

/** Exposure, contrast, saturation, temperature and the two tone controls, as filter nodes. */
export function adjustmentPrimitives(adjustments: VectorImageAdjustments, source: string, result: string): FilterPrimitive[] {
  const primitives: FilterPrimitive[] = []
  const exposure = adjustments.exposure ?? 0
  const contrast = adjustments.contrast ?? 0
  const highlights = adjustments.highlights ?? 0
  const shadows = adjustments.shadows ?? 0
  const saturation = adjustments.saturation ?? 0
  const temperature = adjustments.temperature ?? 0
  let current = source
  let step = 0
  const next = () => `${result}-${step++}`

  if (exposure || contrast || highlights || shadows) {
    // One curve for the tone controls: exposure lifts, contrast pivots on the middle, and the
    // two tone controls bend the ends of the ramp.
    const table = toneTable(exposure, contrast, highlights, shadows)
    const name = next()
    primitives.push({
      tag: 'feComponentTransfer',
      attrs: { in: current, result: name },
      children: ['feFuncR', 'feFuncG', 'feFuncB'].map((tag) => ({ tag, attrs: { type: 'table', tableValues: table.join(' ') } })),
    })
    current = name
  }
  if (temperature) {
    const warm = temperature * 0.25
    const name = next()
    primitives.push({ tag: 'feColorMatrix', attrs: { in: current, type: 'matrix', values: temperatureMatrix(warm), result: name } })
    current = name
  }
  if (saturation) {
    const name = next()
    primitives.push({ tag: 'feColorMatrix', attrs: { in: current, type: 'saturate', values: round(1 + saturation), result: name } })
    current = name
  }
  if (primitives.length === 0) return []
  // The caller expects the chain to end on `result`.
  const last = [...primitives].reverse().find((primitive) => primitive.attrs.result !== undefined)!
  last.attrs.result = result
  return primitives
}

/** The filter def for an element, or null when it has nothing to filter. */
export function elementFilter(element: VectorElement, bounds: Bounds, id: string): FilterDef | null {
  const effects = activeEffects(element)
  const adjustments = element.kind === 'image' ? element.adjustments : undefined
  const filtered = effects.filter((effect) => effect.kind !== 'backgroundBlur')
  if (filtered.length === 0 && !adjustments) return null
  const primitives = filterPrimitives(filtered, adjustments)
  if (primitives.length === 0) return null
  const padding = effectPadding(filtered)
  return {
    type: 'filter',
    id,
    x: round(bounds.x - padding.left),
    y: round(bounds.y - padding.top),
    width: round(bounds.width + padding.left + padding.right),
    height: round(bounds.height + padding.top + padding.bottom),
    primitives,
  }
}

/** The radius of the background blur on an element, which SVG cannot express as a filter. */
export function backdropBlur(element: Pick<VectorElement, 'effects'>): number {
  const blur = activeEffects(element).find((effect) => effect.kind === 'backgroundBlur')
  return blur ? blur.blur : 0
}

/** CSS blur radius to the standard deviation SVG asks for. */
function sigma(blur: number): number {
  return round(blur / 2)
}

function spreadOperator(kind: VectorEffect['kind'], spread: number): 'dilate' | 'erode' {
  // A positive spread fattens a drop shadow and eats into an inner one.
  const dilate = kind === 'innerShadow' ? spread < 0 : spread > 0
  return dilate ? 'dilate' : 'erode'
}

/** A nine-point ramp: the tone controls bend it, and the renderers hand it to feComponentTransfer. */
function toneTable(exposure: number, contrast: number, highlights: number, shadows: number): number[] {
  const points = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
  return points.map((value) => {
    let output = value + exposure * 0.5
    output = 0.5 + (output - 0.5) * (1 + contrast)
    // Highlights act on the top half of the ramp, shadows on the bottom half.
    output += highlights * 0.35 * Math.max(0, value - 0.5) * 2
    output += shadows * 0.35 * Math.max(0, 0.5 - value) * 2
    return round(Math.min(1, Math.max(0, output)))
  })
}

/** Warms or cools by trading red against blue, leaving the green channel alone. */
function temperatureMatrix(warm: number): string {
  const r = round(1 + warm)
  const b = round(1 - warm)
  return `${r} 0 0 0 0  0 1 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
