import { dabWeight, type BrushDab, type BrushTargets } from '@/scene/sculpt/brushes'
import { CHANNELS } from '@/scene/paint/attribute'

/**
 * A dab of paint.
 *
 * The geometry of a brush is already written: which vertices are in range, and how much of the dab
 * each of them gets, are the same questions a sculpt brush asks and are answered by the same
 * `dabWeight`. What is particular to painting is only what happens with that weight — a colour
 * blended into the one that is there — and that is the whole of this module.
 */

/** Blender's vertex-paint blend modes, less the ones that need an alpha to mean anything. */
export type PaintBlend = 'mix' | 'add' | 'multiply' | 'lighten' | 'darken'

export const PAINT_BLENDS: readonly PaintBlend[] = ['mix', 'add', 'multiply', 'lighten', 'darken']

export type Rgb = [number, number, number]

/** One channel of `base` with `paint` laid over it by `amount`, 0 to 1, in the given mode. */
export function blendChannel(mode: PaintBlend, base: number, paint: number, amount: number): number {
  const wanted = mode === 'mix'
    ? paint
    : mode === 'add'
      ? base + paint
      : mode === 'multiply'
        ? base * paint
        : mode === 'lighten'
          ? Math.max(base, paint)
          : Math.min(base, paint)
  return clamp01(base + (wanted - base) * amount)
}

export function blendColour(mode: PaintBlend, base: Rgb, paint: Rgb, amount: number): Rgb {
  return [
    blendChannel(mode, base[0], paint[0], amount),
    blendChannel(mode, base[1], paint[1], amount),
    blendChannel(mode, base[2], paint[2], amount),
  ]
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export type PaintDab = BrushDab & { colour: Rgb; blend: PaintBlend }

/**
 * Where a dab writes: the vertices it covers, and for each of them the values on the domain being
 * painted. A vertex domain gives one value per vertex; a corner domain gives every corner that uses
 * the vertex, which is what lets two faces meeting at a seam hold two colours.
 */
export type PaintTargets = BrushTargets & {
  colours: Float32Array
  /** The values each vertex owns: a flat list with a start and a count each, like the adjacency. */
  slots: { start: Int32Array; count: Int32Array; list: Int32Array }
}

/** One dab, blended into the colours in place. */
export function paintDab(dab: PaintDab, targets: PaintTargets): void {
  const strength = Math.min(2, Math.max(0, dab.strength))
  for (const index of targets.indices) {
    const weight = dabWeight(dab, targets, index)
    if (weight <= 0) continue
    const amount = Math.min(1, weight * strength)
    const start = targets.slots.start[index] ?? 0
    const count = targets.slots.count[index] ?? 0
    for (let step = 0; step < count; step += 1) {
      const value = targets.slots.list[start + step]!
      const at = value * CHANNELS
      targets.colours[at] = blendChannel(dab.blend, targets.colours[at]!, dab.colour[0], amount)
      targets.colours[at + 1] = blendChannel(dab.blend, targets.colours[at + 1]!, dab.colour[1], amount)
      targets.colours[at + 2] = blendChannel(dab.blend, targets.colours[at + 2]!, dab.colour[2], amount)
    }
  }
}

/**
 * A dab of smoothing: every value pulled towards the average of its vertex's neighbours.
 *
 * The averages are read before any of them is written, as a sculpt smooth is: a pass that read what
 * the pass itself had just written would smear in the direction it happened to walk.
 */
export function smoothDab(dab: PaintDab, targets: PaintTargets): void {
  const wanted = new Map<number, Rgb>()
  for (const index of targets.indices) {
    const weight = dabWeight(dab, targets, index)
    if (weight <= 0) continue
    const start = targets.adjacency.start[index] ?? 0
    const count = targets.adjacency.count[index] ?? 0
    if (count === 0) continue
    let r = 0
    let g = 0
    let b = 0
    for (let step = 0; step < count; step += 1) {
      const neighbour = targets.adjacency.list[start + step]!
      const colour = valueOf(targets, neighbour)
      r += colour[0]
      g += colour[1]
      b += colour[2]
    }
    wanted.set(index, [r / count, g / count, b / count])
  }
  for (const [index, average] of wanted) {
    const amount = Math.min(1, dabWeight(dab, targets, index) * Math.min(2, Math.max(0, dab.strength)))
    const start = targets.slots.start[index] ?? 0
    const count = targets.slots.count[index] ?? 0
    for (let step = 0; step < count; step += 1) {
      const value = targets.slots.list[start + step]!
      const at = value * CHANNELS
      for (let channel = 0; channel < CHANNELS; channel += 1) {
        const base = targets.colours[at + channel]!
        targets.colours[at + channel] = clamp01(base + (average[channel]! - base) * amount)
      }
    }
  }
}

/** The colour a vertex reads as: the first of the values it owns, which is all of them on a vertex domain. */
export function valueOf(targets: PaintTargets, index: number): Rgb {
  const start = targets.slots.start[index] ?? 0
  const count = targets.slots.count[index] ?? 0
  if (count === 0) return [1, 1, 1]
  const at = targets.slots.list[start]! * CHANNELS
  return [targets.colours[at] ?? 1, targets.colours[at + 1] ?? 1, targets.colours[at + 2] ?? 1]
}
