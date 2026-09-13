import type { ReliefView } from './model'

/** One centred, elevated perspective for the surface, floor, labels and interaction geometry. */
export type ReliefLayout = {
  w: number
  h: number
  /** The front row's time span. */
  x0: number
  x1: number
  /** The front row's floor. */
  y0: number
  /** Vertical extent of the frequency plane, and perspective contraction towards its centre. */
  shiftY: number
  perspective: number
  /** Height of a full-level peak at the front. */
  height: number
  /** The waveform band, when the view shows one. */
  wave: { top: number; bottom: number } | null
  axes: { frequency: boolean; level: boolean; time: boolean }
}

/** The title, the length and the transport sit over the top of the block. */
export const RELIEF_HEADER = 64
export const FREQUENCY_TICKS = [50, 200, 1000, 5000, 20000]
/** The level range the relief stands on: the loudest bin is at the top, 80 dB under it is the floor. */
export const RELIEF_FLOOR_DB = 80
/**
 * How a level in that range becomes a height. Decibels read linearly put every bin of a dense
 * sound in the top third, a flat ribbon of lines; squared, the loud parts stand up as peaks and
 * the quiet ones settle towards the floor, which is what a relief is for. The level scale is
 * drawn with the same curve, so its ticks are where those levels really stand.
 */
export const RELIEF_GAMMA = 2
/** Smoothly magnify the low/mid bands: 50 Hz–1 kHz gets about 75% of the visible depth. */
export const RELIEF_DEPTH_FOCUS = 0.44
export const heightOf = (db: number) => Math.pow(Math.min(1, Math.max(0, 1 + db / RELIEF_FLOOR_DB)), RELIEF_GAMMA)
/** The level ticks that keep a readable distance from each other and from the floor. */
export function levelTicks(height: number, gap = 15): number[] {
  const kept: number[] = []
  let last = -Infinity
  for (const db of [0, -10, -20, -30, -40, -60]) {
    const y = height * heightOf(db)
    if (height - y - last < gap && kept.length) continue
    if (y < gap) break
    kept.push(db)
    last = height - y
  }
  return kept
}

export function reliefLayout(w: number, h: number, view: ReliefView): ReliefLayout {
  const narrow = w < 560
  const left = narrow ? 48 : 64
  const right = left
  // A narrow bench wraps its title and transport above the view controls.
  const header = narrow ? 148 : RELIEF_HEADER
  const bottom = view === 'waveform' ? 40 : 64
  const span = Math.max(40, w - left - right)
  if (view === 'waveform') {
    return {
      w, h, x0: left, x1: left + span, y0: h - bottom, shiftY: 0, height: 0, perspective: 0,
      wave: { top: header + 16, bottom: h - bottom - 10 }, axes: { frequency: false, level: false, time: true },
    }
  }
  const waveHeight = view === 'both' ? Math.round(Math.min(110, Math.max(52, h * 0.24))) : 0
  const y0 = h - bottom - (waveHeight ? waveHeight + 12 : 0)
  const avail = Math.max(24, y0 - header - 8)
  // The floor dominates the view from above; both side edges converge on the same centre.
  const perspective = narrow ? 0.32 : 0.42
  const shiftY = Math.round(avail * 0.8)
  const height = (avail - shiftY) * (1 + perspective)
  return {
    w, h, x0: left, x1: left + span, y0, shiftY, perspective, height,
    wave: waveHeight ? { top: y0 + 32, bottom: h - 60 } : null,
    axes: { frequency: shiftY >= 26, level: height >= 52, time: true },
  }
}

/** A point of the relief: time and depth from 0 to 1, level from 0 (floor) to 1 (loudest). */
const focusedDepth = (depth: number) => depth / (RELIEF_DEPTH_FOCUS + (1 - RELIEF_DEPTH_FOCUS) * depth)
export const reliefScale = (layout: ReliefLayout, depth: number) => 1 / (1 + layout.perspective * focusedDepth(depth))
export const projectedDepth = (layout: ReliefLayout, depth: number) => focusedDepth(depth) * (1 + layout.perspective) * reliefScale(layout, depth)
export const unprojectedDepth = (layout: ReliefLayout, depth: number) => depth <= 0 ? 0 : depth >= 1 ? 1 : RELIEF_DEPTH_FOCUS * depth / (1 + layout.perspective - (1 + layout.perspective - RELIEF_DEPTH_FOCUS) * depth)

export function projectRelief(layout: ReliefLayout, t: number, v: number, level: number): { x: number; y: number } {
  const scale = reliefScale(layout, v)
  return {
    x: (layout.x0 + layout.x1) / 2 + (layout.x1 - layout.x0) * (t - 0.5) * scale,
    y: layout.y0 - layout.shiftY * projectedDepth(layout, v) - layout.height * level * scale,
  }
}

/**
 * Round numbers for the time axis, and the sound's own length at the end — the mockup's
 * 0 · 400 · 800 · 1200 · 1560 ms. A round tick too close to the end gives way to it.
 */
export function timeTicks(ms: number): number[] {
  if (!(ms > 0)) return []
  const raw = ms / 4
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 4, 5, 10].map((n) => n * magnitude).find((s) => s >= raw) ?? 10 * magnitude
  const ticks: number[] = []
  for (let at = 0; at < ms - step * 0.35; at += step) ticks.push(Math.round(at * 1000) / 1000)
  ticks.push(Math.round(ms))
  return ticks
}

export const frequencyLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`)

/**
 * The frequency ticks that fit the depth the layout gives them: the top and the bottom of the
 * range first, then whatever lies between with room to be read.
 */
export function frequencyTicks(span: number, position: (hz: number) => number, gap = 14): number[] {
  const all = FREQUENCY_TICKS.filter((hz) => { const at = position(hz); return at >= 0 && at <= 1 })
  if (all.length < 2) return all
  const kept = [all[0]!, all[all.length - 1]!]
  for (const hz of all.slice(1, -1)) {
    const y = position(hz) * span
    if (kept.every((other) => Math.abs(position(other) * span - y) >= gap)) kept.push(hz)
  }
  if (Math.abs(position(kept[0]!) - position(kept[1]!)) * span < gap) kept.splice(0, 1)
  return kept.sort((a, b) => a - b)
}
