import { describe, expect, it } from 'vitest'
import type { LabSpectrum } from './analysis'
import { STEM_REACH, bedLine, biteLine, depthAlong, depthOfHz, hzAtDepth, hzLabel, reliefLevel, ribLine, stemLine } from './markGeometry'
import { RELIEF_GAMMA, projectRelief, projectedDepth, reliefScale, reliefLayout } from './reliefLayout'

const columns = 64, rows = 32
const spectrum = (level: (column: number, row: number) => number): LabSpectrum => {
  const values = new Float32Array(columns * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) values[r * columns + c] = level(c, r)
  return { columns, rows, values, minHz: 40, maxHz: 20000 }
}
const layout = reliefLayout(930, 420, 'spectrum')

describe('where the marks lie on the relief', () => {
  it('lies on the relief, wherever the depth falls between two rows', () => {
    const sound = spectrum((c, r) => 0.2 + r / (rows - 1) * 0.5 + c / (columns - 1) * 0.2)
    const depth = 12.5 / (rows - 1)
    const line = biteLine(sound, layout, depth, 1)
    const middle = line.points[32]!
    const height = reliefLevel(sound, middle.t, depth)
    expect(height).toBeCloseTo(Math.pow((0.2 + 12.5 / (rows - 1) * 0.5 + middle.t * 0.2), RELIEF_GAMMA), 5)
    const point = projectRelief(layout, middle.t, depth, height)
    expect(middle.x).toBeCloseTo(point.x, 9)
    expect(middle.y).toBeCloseTo(point.y, 9)
    // It rides the waves: a taller relief puts the same depth higher on screen.
    const louder = biteLine(spectrum(() => 1), layout, depth, 1)
    expect(louder.points[32]!.y).toBeLessThan(middle.y)
  })
  it('is read along the scale it runs on', () => {
    // The centre's frequency direction is vertical; perspective compresses it towards the back.
    const travel = (from: number, to: number) => -layout.shiftY * (projectedDepth(layout, to) - projectedDepth(layout, from))
    expect(depthAlong(layout, 0.3, 0, -layout.shiftY)).toBe(1)
    expect(depthAlong(layout, 0.3, 0, travel(0.3, 0.8))).toBeCloseTo(0.8, 6)
    expect(depthAlong(layout, 0.3, 0, travel(0.3, 0.05))).toBeCloseTo(0.05, 6)
    expect(depthAlong(layout, 0.3, 0, 0)).toBeCloseTo(0.3, 6)
    expect(depthAlong(layout, 0.3, 200, 0)).toBeCloseTo(0.3, 6)
  })
  it('reads a depth as a frequency and back', () => {
    const range = { minHz: 40, maxHz: 20000 }
    for (const hz of [50, 400, 2500, 12000]) expect(hzAtDepth(depthOfHz(hz, range), range)).toBeCloseTo(hz, 6)
    expect(hzLabel(820)).toBe('820 Hz')
    expect(hzLabel(2450)).toBe('2.5 kHz')
    expect(hzLabel(12000)).toBe('12 kHz')
  })
})

describe('the shapes of the other three marks', () => {
  const layout = reliefLayout(930, 420, 'spectrum')
  it('draws a level as a bed, riding the ridge where the sound does not stand that high', () => {
    // A relief that rises with depth and swells in the middle of the sound: one ridge per column.
    const sound = spectrum((c, r) => (0.1 + (r / (rows - 1)) * 0.8) * (0.3 + 0.7 * Math.sin(Math.PI * c / (columns - 1))))
    const level = Math.pow(0.5, RELIEF_GAMMA)
    const line = bedLine(sound, layout, level, 1)
    expect(line.points).toHaveLength(columns)
    for (const point of line.points) {
      // Every point stands on the ridge of its column, at the bed's height or on the sound itself.
      const ridge = reliefLevel(sound, point.t, 1)
      const where = projectRelief(layout, point.t, 1, Math.min(level, ridge))
      expect(Math.hypot(point.x - where.x, point.y - where.y)).toBeLessThan(0.01)
    }
    // Raised, it only ever goes up the screen — the one thing a contour could not promise.
    const higher = bedLine(sound, layout, Math.pow(0.8, RELIEF_GAMMA), 1)
    for (let i = 0; i < columns; i++) expect(higher.points[i]!.y).toBeLessThanOrEqual(line.points[i]!.y + 1e-9)
    expect(higher.top.y).toBeLessThan(line.top.y)
    // And a bed asked for above the loudest peak still lies on the sound, not in the air.
    const over = bedLine(spectrum(() => 0.1), layout, 0.9, 1)
    expect(over.points).toHaveLength(columns)
    for (const point of over.points) expect(point.y).toBeCloseTo(projectRelief(layout, point.t, 0, Math.pow(0.1, RELIEF_GAMMA)).y, 6)
  })
  it('draws a time as a slice standing across every depth', () => {
    const sound = spectrum((_c, r) => (r === 16 ? 0.9 : 0.2))
    const rib = ribLine(sound, layout, 0.5, 1)
    expect(rib.points).toHaveLength(rows)
    // The slice runs back along the depth axis, and stands up where the sound has its band.
    expect(rib.points[rows - 1]!.x - rib.points[0]!.x).toBeCloseTo(0, 6)
    expect(rib.top.y).toBeLessThan(rib.points[0]!.y)
    expect(rib.top.y).toBe(Math.min(...rib.points.map((point) => point.y)))
    // From above, the back of the floor can sit higher on screen than the loudest band.
    // The band must still rise distinctly above the neighbouring rows.
    expect(rib.points[16]!.y).toBeLessThan(rib.points[15]!.y)
    expect(rib.points[16]!.y).toBeLessThan(rib.points[17]!.y)
    // A slice later in the sound stands further to the right, by the whole of the time it moved.
    const later = ribLine(sound, layout, 0.75, 1)
    expect(later.points[0]!.x - rib.points[0]!.x).toBeCloseTo((layout.x1 - layout.x0) * 0.25, 6)
  })
  it('stands a stem on the surface, as tall as what it shows', () => {
    const sound = spectrum(() => 0.5)
    const foot = projectRelief(layout, 0.4, 0.6, reliefLevel(sound, 0.4, 0.6))
    const small = stemLine(sound, layout, 0.4, 0.6, 0.1)
    const tall = stemLine(sound, layout, 0.4, 0.6, 1)
    for (const stem of [small, tall]) {
      expect(stem.points[0]!.x).toBeCloseTo(foot.x, 6)
      expect(stem.points[0]!.y).toBeCloseTo(foot.y, 6)
      expect(stem.top).toBe(stem.points[1]!)
    }
    // The head is a height in the relief's own level, so a stem further back is drawn shorter.
    const fall = reliefScale(layout, 0.6)
    expect(foot.y - small.points[1]!.y).toBeCloseTo(layout.height * STEM_REACH * 0.1 * fall, 6)
    expect(foot.y - tall.points[1]!.y).toBeCloseTo(layout.height * STEM_REACH * fall, 6)
  })
})
