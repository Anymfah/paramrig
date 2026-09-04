import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerOutlineFont, resetOutlineFonts, type OutlineFont } from '@/scene/curve/font'
import { alignShift, contoursFromCommands, layoutText, textCurveData, textMesh } from '@/scene/curve/text'
import { nestContours } from '@/scene/curve/geometry'
import { DEFAULT_TEXT } from '@/scene/curve/data'
import type { TextData } from '@/scene/types'

/**
 * The real font, read off disk.
 *
 * A stub would prove the layout and nothing about the glyphs, and it is the glyphs that carry the
 * hard part — an "A" is two contours and one of them is a hole. Public Sans is the file the app
 * ships, so the test reads exactly what the browser fetches.
 */
let publicSans: OutlineFont

beforeAll(async () => {
  const opentype = await import('opentype.js')
  const bytes = readFileSync('public/fonts/PublicSans.ttf')
  publicSans = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as unknown as OutlineFont
  resetOutlineFonts()
  registerOutlineFont('Public Sans', publicSans)
})

function text(patch: Partial<TextData> = {}): TextData {
  return { ...DEFAULT_TEXT, ...patch }
}

describe('layoutText', () => {
  it('walks the baseline one advance at a time', () => {
    const layout = layoutText(text({ body: 'AV' }), publicSans)
    const starts = layout.advances[0]!
    expect(starts).toHaveLength(3)
    expect(starts[0]).toBe(0)
    expect(starts[1]).toBeGreaterThan(0)
    expect(starts[2]).toBeGreaterThan(starts[1]!)
    expect(layout.lineWidths[0]).toBeCloseTo(starts[2]!, 6)
  })

  it('opens the letters up when spacing is asked for', () => {
    const tight = layoutText(text({ body: 'AV' }), publicSans).lineWidths[0]!
    const loose = layoutText(text({ body: 'AV', spacing: 0.5 }), publicSans).lineWidths[0]!
    expect(loose).toBeCloseTo(tight + 0.5, 6)
  })

  it('puts each line under the last', () => {
    const layout = layoutText(text({ body: 'A\nB' }), publicSans)
    expect(layout.advances).toHaveLength(2)
    expect(layout.lineHeight).toBe(1)
    const lowest = Math.min(...layout.contours.flat().map((point) => point[1]))
    expect(lowest).toBeLessThan(-0.9)
  })

  it('shifts a line by its alignment', () => {
    expect(alignShift(4, 'left')).toBe(0)
    expect(alignShift(4, 'center')).toBe(-2)
    expect(alignShift(4, 'right')).toBe(-4)
  })

  it('draws nothing for a space', () => {
    expect(layoutText(text({ body: ' ' }), publicSans).contours).toHaveLength(0)
    expect(layoutText(text({ body: ' ' }), publicSans).lineWidths[0]).toBeGreaterThan(0)
  })
})

describe('the letter A', () => {
  it('is two contours, one of them a hole', () => {
    const layout = layoutText(text({ body: 'A' }), publicSans)
    expect(layout.contours).toHaveLength(2)
    const shapes = nestContours(layout.contours)
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.holes).toHaveLength(1)
  })

  it('stands above the baseline, and no higher than its size', () => {
    const layout = layoutText(text({ body: 'A' }), publicSans)
    const ys = layout.contours.flat().map((point) => point[1])
    expect(Math.min(...ys)).toBeCloseTo(0, 2)
    expect(Math.max(...ys)).toBeGreaterThan(0.6)
    expect(Math.max(...ys)).toBeLessThan(1)
  })

  it('extrudes into a closed solid', () => {
    const mesh = textMesh(text({ body: 'A', extrude: 0.1 }), publicSans)
    const counts = new Map<string, number>()
    for (const face of mesh.faces) {
      for (let index = 0; index < face.length; index += 1) {
        const a = face[index]!
        const b = face[(index + 1) % face.length]!
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    expect(mesh.faces.length).toBeGreaterThan(0)
    expect([...counts.values()].filter((count) => count !== 2)).toHaveLength(0)
    const zs = Array.from({ length: mesh.vertexIds.length }, (_, index) => mesh.vertices[index * 3 + 2]!)
    expect(Math.min(...zs)).toBeCloseTo(-0.1, 6)
    expect(Math.max(...zs)).toBeCloseTo(0.1, 6)
  })

  it('lies flat when it is not extruded', () => {
    const mesh = textMesh(text({ body: 'A' }), publicSans)
    const zs = Array.from({ length: mesh.vertexIds.length }, (_, index) => mesh.vertices[index * 3 + 2]!)
    expect(Math.max(...zs)).toBe(0)
    expect(Math.min(...zs)).toBe(0)
  })
})

describe('contoursFromCommands', () => {
  it('turns the font’s y-down path into the scene’s y-up ring', () => {
    const contours = contoursFromCommands([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 1, y: 0 },
      { type: 'L', x: 1, y: -1 },
      { type: 'Z' },
    ])
    expect(contours).toHaveLength(1)
    expect(contours[0]).toEqual([[0, 0, 0], [1, 0, 0], [1, 1, 0]])
  })

  it('drops a ring of fewer than three points', () => {
    expect(contoursFromCommands([{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 0 }, { type: 'Z' }])).toHaveLength(0)
  })

  it('flattens a curve into pieces', () => {
    const contours = contoursFromCommands([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x: 2, y: 0, x1: 1, y1: -1 },
      { type: 'L', x: 1, y: 1 },
      { type: 'Z' },
    ])
    expect(contours[0]!.length).toBe(1 + 8 + 1)
  })
})

describe('textCurveData', () => {
  it('gives one closed poly spline per outline', () => {
    const curve = textCurveData(text({ body: 'A', extrude: 0.2 }), publicSans)
    expect(curve).not.toBeNull()
    expect(curve!.splines).toHaveLength(2)
    expect(curve!.splines.every((spline) => spline.kind === 'poly' && spline.cyclic)).toBe(true)
    // The geometry settings come across, so converting does not change what is on screen.
    expect(curve!.extrude).toBe(0.2)
  })

  it('refuses when there is no font to read', () => {
    expect(textCurveData(text({ body: 'A' }), null)).toBeNull()
    expect(textMesh(text({ body: 'A' }), null).faces).toHaveLength(0)
  })
})
