import type { Bounds } from '@/vector/geometry'
import type { VectorBlendMode, VectorEffect, VectorEffectKind, VectorElement, VectorImageAdjustments } from '@/vector/types'

export const EFFECT_KINDS: VectorEffectKind[] = ['dropShadow', 'innerShadow', 'layerBlur', 'backgroundBlur']

export const BLEND_MODES: VectorBlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'colorDodge', 'colorBurn', 'hardLight', 'softLight',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]

export const ADJUSTMENT_KEYS: Array<keyof VectorImageAdjustments> = ['exposure', 'contrast', 'saturation', 'temperature', 'highlights', 'shadows']

const MAX_EFFECTS = 8
const MAX_BLUR = 200
const MAX_OFFSET = 2000

export function effectLabel(kind: VectorEffectKind): string {
  if (kind === 'dropShadow') return 'Drop shadow'
  if (kind === 'innerShadow') return 'Inner shadow'
  if (kind === 'layerBlur') return 'Layer blur'
  return 'Background blur'
}

/** The CSS name of a blend mode, which is also the SVG one. */
export function blendModeCss(mode: VectorBlendMode): string {
  return mode.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

export function createEffect(kind: VectorEffectKind, id: string = crypto.randomUUID()): VectorEffect {
  if (kind === 'layerBlur' || kind === 'backgroundBlur') return { id, kind, visible: true, blur: 8 }
  return { id, kind, visible: true, dx: 0, dy: kind === 'dropShadow' ? 4 : 2, blur: 8, spread: 0, color: '#000000', opacity: kind === 'dropShadow' ? 0.25 : 0.35 }
}

export function sanitizeEffects(value: unknown): VectorEffect[] | undefined {
  if (!Array.isArray(value)) return undefined
  const effects = value.map(sanitizeEffect).filter((effect): effect is VectorEffect => !!effect).slice(0, MAX_EFFECTS)
  return effects.length ? effects : undefined
}

function sanitizeEffect(value: unknown): VectorEffect | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VectorEffect>
  if (!source.kind || !EFFECT_KINDS.includes(source.kind)) return null
  const id = typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID()
  const blur = clamp(number(source.blur, 0), 0, MAX_BLUR)
  const base = { id, kind: source.kind, visible: source.visible !== false, blur }
  if (source.kind === 'layerBlur' || source.kind === 'backgroundBlur') return base
  return {
    ...base,
    dx: clamp(number(source.dx, 0), -MAX_OFFSET, MAX_OFFSET),
    dy: clamp(number(source.dy, 0), -MAX_OFFSET, MAX_OFFSET),
    spread: clamp(number(source.spread, 0), -MAX_BLUR, MAX_BLUR),
    color: /^#[0-9a-f]{6}$/i.test(source.color ?? '') ? source.color!.toUpperCase() : '#000000',
    opacity: clamp(number(source.opacity, 1), 0, 1),
  }
}

export function sanitizeBlendMode(value: unknown): VectorBlendMode | undefined {
  return typeof value === 'string' && BLEND_MODES.includes(value as VectorBlendMode) && value !== 'normal' ? value as VectorBlendMode : undefined
}

export function sanitizeAdjustments(value: unknown): VectorImageAdjustments | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as VectorImageAdjustments
  const entries = ADJUSTMENT_KEYS
    .map((key) => [key, clamp(number(source[key], 0), -1, 1)] as const)
    .filter(([, amount]) => Math.abs(amount) > 0.001)
  return entries.length ? Object.fromEntries(entries) as VectorImageAdjustments : undefined
}

/** The effects that actually paint something, in the order they apply. */
export function activeEffects(element: Pick<VectorElement, 'effects'>): VectorEffect[] {
  return (element.effects ?? []).filter((effect) => effect.visible && (effect.blur > 0 || (effect.kind !== 'layerBlur' && effect.kind !== 'backgroundBlur' && (effect.dx || effect.dy || effect.spread))))
}

export function hasEffects(element: Pick<VectorElement, 'effects'>): boolean {
  return activeEffects(element).length > 0
}

/**
 * How far outside its own box an element paints once its effects are applied. A filter region
 * that is too small silently crops the blur, so this errs on the generous side: three sigma of
 * the Gaussian, plus the spread and the offset.
 */
export function effectPadding(effects: VectorEffect[]): { left: number; top: number; right: number; bottom: number } {
  const padding = { left: 0, top: 0, right: 0, bottom: 0 }
  for (const effect of effects) {
    if (effect.kind === 'innerShadow' || effect.kind === 'backgroundBlur') continue
    const reach = effect.blur * 1.5 + Math.max(0, effect.spread ?? 0)
    const dx = effect.dx ?? 0
    const dy = effect.dy ?? 0
    padding.left = Math.max(padding.left, reach - dx)
    padding.right = Math.max(padding.right, reach + dx)
    padding.top = Math.max(padding.top, reach - dy)
    padding.bottom = Math.max(padding.bottom, reach + dy)
  }
  return padding
}

/** The `filterUnits="userSpaceOnUse"` region for an element's box. */
export function filterRegion(bounds: Bounds, effects: VectorEffect[]): Bounds {
  const padding = effectPadding(effects)
  return {
    x: bounds.x - padding.left,
    y: bounds.y - padding.top,
    width: bounds.width + padding.left + padding.right,
    height: bounds.height + padding.top + padding.bottom,
  }
}

/**
 * Grows a box so nothing an effect paints falls outside it, for export sizing. The widest
 * padding of any element is applied to the whole box: cheap, and never too small.
 */
export function boundsWithEffects(bounds: Bounds, elements: Array<Pick<VectorElement, 'effects'>>): Bounds {
  const paddings = elements.map((element) => effectPadding(activeEffects(element)))
  const widest = (side: 'left' | 'top' | 'right' | 'bottom') => Math.max(0, ...paddings.map((padding) => padding[side]))
  const left = widest('left')
  const top = widest('top')
  return {
    x: bounds.x - left,
    y: bounds.y - top,
    width: bounds.width + left + widest('right'),
    height: bounds.height + top + widest('bottom'),
  }
}

/** A key that changes whenever anything about the effects or the blend mode changes. */
export function effectFingerprint(element: Pick<VectorElement, 'effects' | 'blendMode' | 'adjustments'>): string {
  if (!element.effects?.length && !element.blendMode && !element.adjustments) return ''
  return JSON.stringify([element.effects ?? [], element.blendMode ?? 'normal', element.adjustments ?? {}])
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
