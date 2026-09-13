import { spectrumPosition, type LabSpectrum } from './analysis'
import { RELIEF_GAMMA, projectRelief, projectedDepth, unprojectedDepth, type ReliefLayout } from './reliefLayout'

/**
 * Where each mark lies on the relief, and how to take hold of it.
 *
 * Every shape here is read from the same numbers the shader lights, so what is drawn and what is
 * grabbed cannot disagree: a line along time at a depth for Bite, a line along time at a level for
 * Grain, a slice across the depths at a time for Space, and a stem standing on the surface for
 * Motion.
 */
export type MarkPoint = { x: number; y: number; t: number; depth?: number }
export type MarkShape = { points: MarkPoint[]; top: MarkPoint; start: MarkPoint }

/** The relief's height at a point between rows and between columns, as the shader reads it. */
export function reliefLevel(spectrum: LabSpectrum, t: number, depth: number): number {
  const { columns, rows, values } = spectrum
  const at = Math.min(columns - 1, Math.max(0, t * (columns - 1)))
  const row = Math.min(rows - 1, Math.max(0, depth * (rows - 1)))
  const c0 = Math.floor(at), c1 = Math.min(columns - 1, c0 + 1), fc = at - c0
  const r0 = Math.floor(row), r1 = Math.min(rows - 1, r0 + 1), fr = row - r0
  const value = (r: number, c: number) => values[r * columns + c] ?? 0
  const low = value(r0, c0) + (value(r0, c1) - value(r0, c0)) * fc
  const high = value(r1, c0) + (value(r1, c1) - value(r1, c0)) * fc
  return Math.pow(Math.min(1, Math.max(0, low + (high - low) * fr)), RELIEF_GAMMA)
}

/** Every point of the line across the sound, and the one standing highest on screen. */
export function biteLine(spectrum: LabSpectrum, layout: ReliefLayout, depth: number, step = 4): MarkShape {
  const points: MarkShape['points'] = []
  let top = { x: 0, y: Infinity, t: 0 }
  let start = { x: 0, y: 0, t: 0 }
  for (let c = 0; c < spectrum.columns; c += step) {
    const t = c / (spectrum.columns - 1)
    const point = { ...projectRelief(layout, t, depth, reliefLevel(spectrum, t, depth)), t, depth }
    points.push(point)
    // The ends of every line fade out; the label and the keyboard take the line where it is drawn.
    if (t > 0.06 && t < 0.94 && point.y < top.y) top = point
    if (start.t === 0 && t >= 0.06) start = point
  }
  const middle = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0, t: 0.5 }
  return { points, top: top.y === Infinity ? middle : top, start: start.t === 0 ? middle : start }
}


/**
 * The depth a hand has dragged the line to, from where it took it.
 *
 * The hand reads depth vertically through the centred floor. Inverting its perspective keeps
 * a frequency gesture under the pointer near the front and the back alike.
 */
export function depthAlong(layout: ReliefLayout, from: number, _dx: number, dy: number): number {
  if (layout.shiftY < 1) return from
  const projected = Math.min(1, Math.max(0, projectedDepth(layout, from) - dy / layout.shiftY))
  return unprojectedDepth(layout, projected)
}

/** The frequency a depth stands for, and the depth a frequency stands at. */
export const hzAtDepth = (depth: number, spectrum: Pick<LabSpectrum, 'minHz' | 'maxHz'>) => spectrum.minHz * Math.pow(spectrum.maxHz / spectrum.minHz, Math.min(1, Math.max(0, depth)))
export const depthOfHz = (hz: number, spectrum: Pick<LabSpectrum, 'minHz' | 'maxHz'>) => Math.min(1, Math.max(0, spectrumPosition(hz, spectrum)))
export const hzLabel = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`)

/**
 * The bed under the sound: a line running the length of it at a given height, riding the ridge of
 * the waves wherever the sound does not stand that high.
 *
 * The obvious shape for a level is the contour — where the relief crosses that height, the way a
 * contour line lies on a map — and it is the wrong one here. A contour answers a rise in level by
 * moving forward as well as up, and forward on an oblique relief is downward on the screen: raised
 * through the middle of its range it visibly falls. A grip has to go the way the hand goes, so the
 * bed keeps the ridge's depth, where the sound really is, and only its height answers the hand.
 */
export function bedLine(spectrum: LabSpectrum, layout: ReliefLayout, level: number, step = 4): MarkShape {
  const points: MarkPoint[] = []
  const { columns, rows } = spectrum
  for (let c = 0; c < columns; c += step) {
    const t = c / (columns - 1)
    // Searched from the back, so a column with nothing in it leaves the line at the front.
    let ridge = { depth: 0, level: -1 }
    for (let r = rows - 1; r >= 0; r--) {
      const here = reliefLevel(spectrum, t, r / (rows - 1))
      if (here >= ridge.level) ridge = { depth: r / (rows - 1), level: here }
    }
    points.push({ ...projectRelief(layout, t, ridge.depth, Math.min(level, Math.max(0, ridge.level))), t, depth: ridge.depth })
  }
  return withEnds(points)
}

/** The slice across every depth at one time: the sound as it stands at that instant. */
export function ribLine(spectrum: LabSpectrum, layout: ReliefLayout, time: number, step = 2): MarkShape {
  const points: MarkPoint[] = []
  for (let r = 0; r < spectrum.rows; r += step) {
    const depth = r / (spectrum.rows - 1)
    points.push({ ...projectRelief(layout, time, depth, reliefLevel(spectrum, time, depth)), t: time, depth })
  }
  return withEnds(points)
}

/** The share of the relief's height a stem of the full height stands. */
export const STEM_REACH = 0.6

/**
 * A stem standing on the relief: its foot on the surface, its head as high as the value it shows.
 *
 * The head is a height above the foot in the relief's own level, not in pixels, so that the line
 * the hand meets and the line the shader draws are the same line — the shader knows levels.
 */
export function stemLine(spectrum: LabSpectrum, layout: ReliefLayout, time: number, depth: number, height: number): MarkShape {
  const stand = reliefLevel(spectrum, time, depth)
  const foot = { ...projectRelief(layout, time, depth, stand), t: time, depth }
  const head = { ...projectRelief(layout, time, depth, stand + height * STEM_REACH), t: time, depth }
  return { points: [foot, head], top: head, start: head }
}

function withEnds(points: MarkPoint[]): MarkShape {
  if (!points.length) return { points: [], top: { x: 0, y: 0, t: 0 }, start: { x: 0, y: 0, t: 0 } }
  let top = points[0]!
  for (const point of points) if (point.y < top.y) top = point
  const inside = points.filter((point) => point.t > 0.06 && point.t < 0.94)
  return { points, top, start: inside[0] ?? points[0]! }
}
