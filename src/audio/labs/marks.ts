import type { LabSpectrum } from './analysis'
import { biteFront, type BiteFront } from './biteFront'
import { bedLine, biteLine, depthOfHz, hzLabel, ribLine, stemLine, type MarkShape } from './markGeometry'
import { macroAmount } from '../macros'
import type { LabSound } from './model'
import { RELIEF_FLOOR_DB, RELIEF_GAMMA, type ReliefLayout } from './reliefLayout'

/**
 * The four controls of a sound, standing on its relief.
 *
 * The relief has three directions and the sound has four controls, so each one takes the direction
 * it works in and stands there, the way Bite stands at the frequency its filters cut:
 * - Bite is a frequency: the line at the depth where the sound cuts, read from the patch in hertz.
 * - Grain fills the space between the peaks, so it is a level: the bed under the sound, lying at
 *   the height it fills to and riding the ridge of the waves where the sound is quieter than that.
 * - Space is the tail, so it is a time: a slice standing across the depths, in the back half of the
 *   sound where a space is heard.
 * - Motion is how much the sound moves, so it is a height: a stem standing where the sound changes
 *   most, as tall as the movement asked for.
 *
 * A mark follows the hand because it is the control itself, not a measurement of the render: the
 * measurements move by tenths on sounds whose macros act on the stereo image or on the timbre
 * rather than on the picture, and a grip that does not follow the hand is a grip that feels broken.
 * What the render answers is the relief itself, which is made again under the hand as it moves.
 */
export type MarkKind = 'bite' | 'grain' | 'space' | 'motion'
export type MarkAxis = 'depth' | 'level' | 'time'

export type Mark = {
  kind: MarkKind
  label: string
  /** The control's index among the sound's four, and where it stands, 0 to 1. */
  control: number
  value: number
  /** What the relief shows of it: a row, a time, a level, or a stem standing on a point. */
  row: number
  time: number
  level: number
  stem: number
  axis: MarkAxis
  /** The measurement in the words of the trade, beside the name. */
  detail: string
  hint: string
}

/** Where the sound moves most: the moment Motion's stem stands on, and the band it stands in. */
export type BusiestMoment = { column: number; row: number; time: number; depth: number }

export function busiestMoment(spectrum: LabSpectrum): BusiestMoment {
  const { columns, rows, values } = spectrum
  const at = (row: number, column: number) => values[row * columns + column] ?? 0
  // How much the picture changes from one column to the next, smoothed over three.
  const flux = new Float32Array(columns)
  for (let c = 1; c < columns; c++) {
    let sum = 0
    for (let r = 0; r < rows; r++) sum += Math.abs(at(r, c) - at(r, c - 1))
    flux[c] = sum / rows
  }
  // A sound that never changes has no busiest moment: its stem stands in the middle of it.
  let busiest = { column: Math.round(columns / 2), amount: 0 }
  for (let c = 3; c < columns - 3; c++) {
    const around = (flux[c - 1]! + flux[c]! + flux[c + 1]!) / 3
    if (around > busiest.amount) busiest = { column: c, amount: around }
  }
  let row = 0, high = 0
  for (let r = 0; r < rows; r++) if (at(r, busiest.column) > high) { high = at(r, busiest.column); row = r }
  return { column: busiest.column, row, time: busiest.column / Math.max(1, columns - 1), depth: row / Math.max(1, rows - 1) }
}

/**
 * The stretch of the relief each control stands on. Grain is given in the height the bed rises
 * through, not in the level behind it, so that it moves evenly under the hand on a relief that
 * stands its levels on a squared scale. Space keeps to the back of the sound, where a space is
 * heard at all, and Motion's stem is never so short that it cannot be taken hold of.
 */
const GRAIN_HEIGHT = { from: 0.03, to: 0.8 }
const SPACE_TIME = { from: 0.36, to: 0.97 }
const MOTION_STEM = { from: 0.08, to: 1 }
const between = (range: { from: number; to: number }, value: number) => range.from + (range.to - range.from) * Math.min(1, Math.max(0, value))
const decibels = (level: number) => `${Math.round(level * RELIEF_FLOOR_DB - RELIEF_FLOOR_DB)} dB`
const milliseconds = (share: number, durationMs: number) => `${Math.round(share * durationMs)} ms`

const HINTS: Record<MarkKind, string> = {
  bite: 'Drag up for more bite',
  grain: 'Drag up for more grain',
  space: 'Drag up for more space',
  motion: 'Drag up for more movement',
}

/**
 * The four marks of a sound on its relief. A sound whose control is missing — an import with its
 * own rig, or a recipe with nothing to move — simply has no mark for it.
 */
export function reliefMarks(sound: LabSound, spectrum: LabSpectrum, durationMs: number, anchor?: BusiestMoment | null): { marks: Mark[]; bite: BiteFront | null; busiest: BusiestMoment } {
  // A hand on any mark remakes the sound under it, and the busiest moment can hop from the tail to
  // the attack between two renders. Held, the stem keeps the moment it was taken at.
  const busiest = anchor ?? busiestMoment(spectrum)
  const bite = biteFront(sound)
  const marks: Mark[] = []
  const control = (label: string) => sound.controls.findIndex((index) => sound.macros[index]?.label === label)
  const amount = (control: number) => {
    const slot = sound.macros[sound.controls[control]!]
    return slot ? Math.min(1, Math.max(0, macroAmount(slot))) : 0.5
  }
  if (bite) {
    marks.push({
      kind: 'bite', label: 'Bite', control: bite.control, value: bite.value, axis: 'depth',
      row: depthOfHz(bite.hz, spectrum), time: -1, level: -1, stem: 0, detail: hzLabel(bite.hz), hint: HINTS.bite,
    })
  }
  const grain = control('Grain')
  if (grain >= 0) {
    // The bed is placed by the height it rises to; the level behind it is that height unsquared.
    const level = Math.pow(between(GRAIN_HEIGHT, amount(grain)), 1 / RELIEF_GAMMA)
    marks.push({
      kind: 'grain', label: 'Grain', control: grain, value: amount(grain), axis: 'level',
      row: -1, time: -1, level, stem: 0, detail: decibels(level), hint: HINTS.grain,
    })
  }
  const space = control('Space')
  if (space >= 0) {
    const time = between(SPACE_TIME, amount(space))
    marks.push({
      kind: 'space', label: 'Space', control: space, value: amount(space), axis: 'time',
      row: -1, time, level: -1, stem: 0, detail: milliseconds(time, durationMs), hint: HINTS.space,
    })
  }
  const motion = control('Motion')
  if (motion >= 0) {
    marks.push({
      kind: 'motion', label: 'Motion', control: motion, value: amount(motion), axis: 'level',
      row: busiest.depth, time: busiest.time, level: -1, stem: between(MOTION_STEM, amount(motion)),
      detail: milliseconds(busiest.time, durationMs), hint: HINTS.motion,
    })
  }
  return { marks, bite, busiest }
}

/** Where a mark lies on the relief drawn at this size: the shape the hand meets and the eye reads. */
export function markShape(mark: Mark, spectrum: LabSpectrum, layout: ReliefLayout): MarkShape {
  if (mark.kind === 'bite') return biteLine(spectrum, layout, mark.row)
  if (mark.kind === 'grain') return bedLine(spectrum, layout, Math.pow(Math.max(0, mark.level), RELIEF_GAMMA))
  if (mark.kind === 'space') return ribLine(spectrum, layout, mark.time)
  return stemLine(spectrum, layout, mark.time, mark.row, mark.stem)
}

/** Light the existing surface only: Bite follows its filter band, Space its tail,
 * Motion its active moment, and Grain a band of spectral energy. No extra ridges or stems. */
export type MarkUniform = { row: number; time: number; level: number; lit: number; rowBand: number; timeBand: number; levelBand: number }
export function markUniform(mark: Mark, lit: number, spectrum: LabSpectrum): MarkUniform {
  const rows = Math.max(2, spectrum.rows), columns = Math.max(2, spectrum.columns)
  const wide = mark.kind === 'motion'
  return {
    row: mark.row, time: mark.time, level: mark.kind === 'grain' ? Math.pow(mark.level, RELIEF_GAMMA) : -1, lit,
    rowBand: (wide ? 2.5 : 2) / (rows - 1),
    timeBand: (wide ? 3 : 2.5) / (columns - 1),
    levelBand: 0.05,
  }
}
