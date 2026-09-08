import type { RadialLayer } from '@/rigs/extended-types'
import { envelopeAt, fitEnvelope } from '@/audio/dsp/envelope'
import type { AudioPatch } from '@/audio/types'

/**
 * The three layers as overlapping profiles on one time axis — which is the one thing about a
 * layered sound the workspace could not show.
 *
 * A column tells you what a layer is set to. It cannot tell you that the transient ends before the
 * body has finished rising, or that the tail is doing all the work after eighty milliseconds, and
 * that relationship is most of what makes a layered effect read as one event rather than three.
 *
 * The shape is `RadialLayer`, the workbench's own multi-layer profile: named, coloured, switchable,
 * points in the unit square. Which means the drawing goes through `radialFillPath` and
 * `radialStrokePath`, the same two functions the radial controller draws with, and the overlay
 * speaks the visual language that control already established.
 */

/** Samples inside each stage. The corners are exact; these fill in the curve between them. */
const PER_STAGE = 8

export const LAYER_COLOURS = ['#9fd9bd', '#93c8ea', '#e3c98f']

function times(start: number, end: number): number[] {
  if (end <= start) return []
  return Array.from({ length: PER_STAGE }, (_, index) => start + ((index + 1) / PER_STAGE) * (end - start))
}

/**
 * A layer's amplitude over the whole patch, not over its own life: a layer that starts late has to
 * appear late, because when it starts is exactly what the overlay exists to show.
 */
export function layerProfiles(patch: AudioPatch): RadialLayer[] {
  const duration = Math.max(0.001, patch.duration)
  return patch.layers.map((layer, index) => {
    const offset = Math.min(duration, Math.max(0, layer.offset))
    const life = Math.max(0.001, duration - offset)
    const fitted = fitEnvelope(layer.amp, life)
    const holdEnd = fitted.attack + fitted.hold
    const decayEnd = holdEnd + fitted.decay
    const releaseStart = life - fitted.release

    // The corners of the envelope, and enough of each stage between them to show its curve.
    const marks = [
      0, ...times(0, fitted.attack),
      ...times(fitted.attack, holdEnd),
      ...times(holdEnd, decayEnd),
      ...times(decayEnd, releaseStart),
      ...times(Math.max(decayEnd, releaseStart), life),
    ]
    const inside = marks
      .filter((at, position) => position === 0 || at > (marks[position - 1] ?? -1))
      .map((at) => ({ x: (offset + at) / duration, y: envelopeAt(layer.amp, fitted, at, life) * layer.gain }))

    const points = offset > 0 ? [{ x: 0, y: 0 }, { x: offset / duration, y: 0 }, ...inside] : inside
    return {
      name: `Layer ${index + 1}`,
      color: LAYER_COLOURS[index] ?? '#d4e7e1',
      enabled: layer.enabled,
      // Two points is the minimum a curve can be drawn through.
      points: points.length > 1 ? points : [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    }
  })
}

/** The tallest a profile gets, so the overlay can normalise without flattening a quiet layer. */
export function profileCeiling(profiles: RadialLayer[]): number {
  const peak = profiles
    .filter((profile) => profile.enabled)
    .flatMap((profile) => profile.points.map((point) => point.y))
    .reduce((most, value) => Math.max(most, value), 0)
  return peak > 0 ? peak : 1
}
