import { describe, expect, it } from 'vitest'
import { renderPatch } from '@paramrig/audio'
import { analyseSpectrum, type LabSpectrum } from './analysis'
import { generateSound } from './generate'
import { DEFAULT_CRITERIA } from './model'
import { busiestMoment, markShape, markUniform, reliefMarks } from './marks'
import { reliefLayout } from './reliefLayout'

const RATE = 16000
const columns = 96, rows = 48
const relief = (level: (column: number, row: number) => number): LabSpectrum => {
  const values = new Float32Array(columns * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) values[r * columns + c] = Math.min(1, Math.max(0, level(c, r)))
  return { columns, rows, values, minHz: 40, maxHz: 20000 }
}
const layout = reliefLayout(930, 420, 'spectrum')
const sound = () => generateSound({ ...DEFAULT_CRITERIA, minMs: 700, maxMs: 700 }, 11)
const at = <T extends { kind: string }>(marks: T[], kind: string) => marks.find((mark) => mark.kind === kind)!

describe('the four controls standing on the relief', () => {
  it('finds the moment the sound moves most, and the band it moves in', () => {
    // A sound that fades smoothly, then stirs for a dozen columns halfway through.
    const busiest = busiestMoment(relief((c, r) => {
      const band = Math.exp(-((r - 30) ** 2) / 18) * Math.max(0, 1 - c / 40)
      return 0.22 + band * 0.7 + (c > 44 && c < 56 ? 0.2 * Math.abs(Math.sin(c)) : 0)
    }))
    expect(busiest.column).toBeGreaterThan(44)
    expect(busiest.column).toBeLessThan(56)
    expect(busiest.time).toBeCloseTo(busiest.column / (columns - 1), 9)
    expect(busiest.depth).toBeCloseTo(busiest.row / (rows - 1), 9)
    // A sound that never moves still names a moment, in the middle, rather than none at all.
    expect(busiestMoment(relief(() => 0.5)).column).toBe(Math.round(columns / 2))
  })
  it('gives a generated sound one mark per control, each standing on its own direction', () => {
    const bench = sound()
    const spectrum = analyseSpectrum(renderPatch(bench.patch, RATE), RATE)
    const { marks, bite } = reliefMarks(bench, spectrum, 700)
    expect(marks.map((mark) => mark.kind)).toEqual(['bite', 'grain', 'space', 'motion'])
    expect(bite).not.toBeNull()
    for (const mark of marks) {
      expect(bench.macros[bench.controls[mark.control]!]!.label).toBe(mark.label)
      expect(mark.value).toBeGreaterThanOrEqual(0)
      expect(mark.value).toBeLessThanOrEqual(1)
      // The detail says where the mark stands, in the unit of the direction it stands on.
      expect(mark.detail).toMatch(/^-?\d+(\.\d+)? (k?Hz|dB|ms)$/)
      // Every mark can be taken hold of: a real line, inside the picture.
      const shape = markShape(mark, spectrum, layout)
      expect(shape.points.length).toBeGreaterThan(1)
      for (const point of shape.points) {
        expect(point.x).toBeGreaterThanOrEqual(layout.x0 - 1)
        expect(point.x).toBeLessThanOrEqual(layout.x1 + 1)
        expect(point.y).toBeLessThanOrEqual(layout.y0 + 1)
      }
    }
  })
  it('moves each mark the way its control moves, and leaves the others where they were', () => {
    const bench = sound()
    const spectrum = analyseSpectrum(renderPatch(bench.patch, RATE), RATE)
    const marksAt = (values: Partial<Record<string, number>>) => {
      const copy = structuredClone(bench)
      for (const [label, value] of Object.entries(values)) {
        const slot = copy.macros.find((entry) => entry.label === label)!
        slot.value = value!
        slot.destinations = slot.destinations.map((dest) => ({ ...dest }))
      }
      return reliefMarks(copy, spectrum, 700).marks
    }
    const low = marksAt({ Grain: 0.05, Space: 0.05, Motion: 0.05 })
    const high = marksAt({ Grain: 0.95, Space: 0.95, Motion: 0.95 })
    // Grain climbs the relief, Space slides down the sound, Motion's stem grows.
    expect(at(high, 'grain').level).toBeGreaterThan(at(low, 'grain').level + 0.5)
    expect(at(high, 'space').time).toBeGreaterThan(at(low, 'space').time + 0.4)
    expect(at(high, 'motion').stem).toBeGreaterThan(at(low, 'motion').stem + 0.5)
    // Space keeps to the back half of the sound, where a space is heard at all.
    expect(at(low, 'space').time).toBeGreaterThan(0.3)
    expect(at(high, 'space').time).toBeLessThan(1)
    // And each one leaves the marks of the other controls exactly where they were.
    expect(at(high, 'bite').row).toBeCloseTo(at(low, 'bite').row, 9)
    expect(at(high, 'motion').time).toBeCloseTo(at(low, 'motion').time, 9)
    // Higher up the relief, the contour really is drawn higher on the screen.
    const climb = (mark: typeof low[number]) => markShape(mark, spectrum, layout).points
    const rising = climb(at(high, 'grain'))[8]!.y < climb(at(low, 'grain'))[8]!.y
    expect(rising).toBe(true)
  })
  it('lights the spectral surface for each control without generating extra geometry', () => {
    const bench = sound()
    const spectrum = analyseSpectrum(renderPatch(bench.patch, RATE), RATE)
    const { marks } = reliefMarks(bench, spectrum, 700)
    for (const mark of marks) {
      const uniform = markUniform(mark, 0.5, spectrum)
      expect(uniform.lit).toBe(0.5)
      expect(uniform.rowBand).toBeGreaterThan(0)
      expect(uniform.timeBand).toBeGreaterThan(0)
      if (mark.kind === 'grain') expect(uniform.level).toBeCloseTo(mark.level ** 2)
      else expect(uniform.level).toBe(-1)
      if (mark.kind === 'bite') expect([uniform.row >= 0, uniform.time]).toEqual([true, -1])
      if (mark.kind === 'space') expect([uniform.row, uniform.time >= 0]).toEqual([-1, true])
      if (mark.kind === 'motion') expect([uniform.row >= 0, uniform.time >= 0]).toEqual([true, true])
    }
  })
})
