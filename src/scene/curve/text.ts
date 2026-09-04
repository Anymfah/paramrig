import { nestContours, solidFromContours, type Contour } from '@/scene/curve/geometry'
import { outlineFont, type GlyphCommand, type OutlineFont } from '@/scene/curve/font'
import { emptyMesh } from '@/scene/mesh/data'
import { splineId } from '@/scene/curve/data'
import type { CurveData, CurvePoint, CurveSpline, MeshData, TextData, Vec3 } from '@/scene/types'

/**
 * Text as geometry.
 *
 * A glyph is a set of closed outlines, some of them holes — the bowl of an "A", the two counters of
 * a "B" — which is precisely what a filled 2D curve is, so the letters go through the same builder
 * the curves do and come out with the same walls, caps and bevel. What is particular to text is
 * only the layout: where each glyph is put, and what the alignment does to a line.
 *
 * The origin is Blender's: the baseline of the first line, at its left edge, with the text running
 * up and to the right on the object's own XY plane.
 */

/**
 * How many straight pieces a glyph's curve is drawn with.
 *
 * A letter at reading size covers a few dozen pixels, and eight pieces on a quadratic is already
 * below what a screen can show; the number is fixed rather than offered because a text object with
 * a resolution field is a text object somebody will set to 64 and then wonder about the frame rate.
 */
const GLYPH_STEPS = 8

export type TextLayout = {
  /** Every closed outline of every glyph, in the object's own space. */
  contours: Contour[]
  /** The width of each line before alignment, so a caret can be placed on it. */
  lineWidths: number[]
  /** Where each character starts along its line, one array per line, with the line's end last. */
  advances: number[][]
  lineHeight: number
}

/** How far down the baseline moves between lines. Blender's is one size, plus the spacing asked for. */
export function lineHeightOf(data: TextData): number {
  return data.size * (1 + data.lineSpacing)
}

export function textLines(body: string): string[] {
  return body.split('\n')
}

/**
 * The glyphs laid out and turned into outlines.
 *
 * Every character is placed on its own rather than handed to the font as a string: that is what
 * lets the caret sit between two of them, and what makes the letter spacing a number rather than a
 * font feature. The price is that kerning pairs are not applied, which is stated in the panel.
 */
export function layoutText(data: TextData, font: OutlineFont): TextLayout {
  const lines = textLines(data.body)
  const height = lineHeightOf(data)
  const tracking = data.size * data.spacing
  const advances: number[][] = []
  const lineWidths: number[] = []
  for (const line of lines) {
    const starts: number[] = []
    let cursor = 0
    for (const character of [...line]) {
      starts.push(cursor)
      cursor += font.getAdvanceWidth(character, data.size) + tracking
    }
    starts.push(cursor)
    advances.push(starts)
    lineWidths.push(Math.max(0, cursor - (line.length > 0 ? tracking : 0)))
  }
  const contours: Contour[] = []
  lines.forEach((line, index) => {
    const starts = advances[index]!
    const shift = alignShift(lineWidths[index]!, data.align)
    const baseline = -index * height
    ;[...line].forEach((character, position) => {
      if (character === ' ') return
      const path = font.getPath(character, starts[position]! + shift, 0, data.size)
      for (const contour of contoursFromCommands(path.commands, baseline)) contours.push(contour)
    })
  })
  return { contours, lineWidths, advances, lineHeight: height }
}

/** What alignment does to a line: nothing, half its width, or all of it. */
export function alignShift(width: number, align: TextData['align']): number {
  if (align === 'center') return -width / 2
  if (align === 'right') return -width
  return 0
}

/**
 * A glyph's path commands as closed rings on XY.
 *
 * opentype hands back a path in screen coordinates — y downward from the baseline — and the scene
 * is y upward, so every y is negated on the way in. Curves are flattened here rather than kept:
 * the fill needs polygons, and a glyph is small enough that eight pieces a curve is generous.
 */
export function contoursFromCommands(commands: readonly GlyphCommand[], baseline = 0): Contour[] {
  const contours: Contour[] = []
  let current: Contour = []
  let cursor: [number, number] = [0, 0]
  const push = (x: number, y: number) => { current.push([x, baseline - y, 0]) }
  const flush = () => {
    if (current.length >= 3) contours.push(current)
    current = []
  }
  for (const command of commands) {
    if (command.type === 'M') {
      flush()
      cursor = [command.x, command.y]
      push(command.x, command.y)
      continue
    }
    if (command.type === 'Z') {
      flush()
      continue
    }
    if (command.type === 'L') {
      cursor = [command.x, command.y]
      push(command.x, command.y)
      continue
    }
    for (let step = 1; step <= GLYPH_STEPS; step += 1) {
      const t = step / GLYPH_STEPS
      const point = command.type === 'C'
        ? cubic(cursor, [command.x1, command.y1], [command.x2, command.y2], [command.x, command.y], t)
        : quadratic(cursor, [command.x1, command.y1], [command.x, command.y], t)
      push(point[0], point[1])
    }
    cursor = [command.x, command.y]
  }
  flush()
  return contours
}

function cubic(a: [number, number], b: [number, number], c: [number, number], d: [number, number], t: number): [number, number] {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return [a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3, a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3]
}

function quadratic(a: [number, number], b: [number, number], c: [number, number], t: number): [number, number] {
  const u = 1 - t
  return [a[0] * u * u + 2 * b[0] * u * t + c[0] * t * t, a[1] * u * u + 2 * b[1] * u * t + c[1] * t * t]
}

/**
 * The text as a mesh. Empty until the font lands — a text object drawn before its file arrives has
 * nothing to draw, and the registry tells the viewport to come back when it does.
 */
export function textMesh(data: TextData, font: OutlineFont | null = outlineFont(data.font)): MeshData {
  if (!font) return emptyMesh()
  const { contours } = layoutText(data, font)
  if (contours.length === 0) return emptyMesh()
  return solidFromContours(nestContours(contours), {
    extrude: data.extrude,
    fill: 'both',
    bevelDepth: data.bevelDepth,
    bevelResolution: data.bevelResolution,
  })
}

/**
 * The text as a curve, which is what Object ▸ Convert ▸ Curve gives: every outline becomes a closed
 * poly spline. The knots are the flattened ones rather than the font's own Béziers — the curve a
 * person then edits is the curve they were looking at, which is the point of converting.
 */
export function textCurveData(data: TextData, font: OutlineFont | null = outlineFont(data.font)): CurveData | null {
  if (!font) return null
  const { contours } = layoutText(data, font)
  if (contours.length === 0) return null
  const splines: CurveSpline[] = contours.map((contour) => ({
    id: splineId(),
    kind: 'poly' as const,
    cyclic: true,
    points: contour.map((co): CurvePoint => ({
      co: co as Vec3,
      left: co as Vec3,
      right: co as Vec3,
      leftType: 'vector',
      rightType: 'vector',
    })),
  }))
  return {
    kind: 'curve',
    splines,
    dimensions: '2D',
    resolution: 12,
    fill: 'both',
    extrude: data.extrude,
    bevelDepth: data.bevelDepth,
    bevelResolution: data.bevelResolution,
  }
}
