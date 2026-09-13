import { rotatePoint } from '@/vector/directTransform'
import { networkFromRuns, normalizeWorld, worldNetwork, type Run } from '@/vector/network'
import { computeFaces, holeFaceKeys } from '@/vector/planar'
import { canvasMeasure, layoutText, textProperties } from '@/vector/text'
import { pathLength, placeOnPath, runFromPathData } from '@/vector/textPath'
import type { VectorElement, VectorFont, VectorNetwork, VectorPoint } from '@/vector/types'
import type { FontResolver } from './resources'

type OutlineResult = { x: number; y: number; width: number; height: number; network: VectorNetwork; regionsOff?: string[] }

import { loadOutlineFont, type GlyphCommand } from '@/typography/outline'
export { loadOutlineFont } from '@/typography/outline'

export function resetOutlineFonts(): void { /* Resources now belong to each operation. */ }

/**
 * Converts a text element into path geometry by reading the shipped font's glyphs.
 * Returns null when the family has no file the app can read.
 */
export async function textOutlineRuns(element: VectorElement, fonts: VectorFont[] = [], resolveFont?: FontResolver): Promise<Run[] | null> {
  const properties = textProperties(element)
  const font = await loadOutlineFont(properties.fontFamily, fonts, resolveFont)
  if (!font) return null
  const layout = layoutText(properties, element.width, canvasMeasure)
  const runs: Run[] = []
  const variation = { ...properties.fontVariations, wght: properties.fontWeight }
  const ride = element.textPath?.d ? element.textPath : null
  if (ride?.d) {
    // On a path each glyph is placed on its own: the point at that distance along the outline,
    // turned to the local tangent, which is what makes the letters follow a curve rather than
    // sit on a straight baseline.
    const run = runFromPathData(ride.d)
    const total = run ? pathLength(run) : 0
    if (!run || total <= 0) return null
    const content = properties.text.replace(/\n/g, ' ')
    const widths = [...content].map((glyph) => font.getAdvanceWidth(glyph, properties.fontSize, { kerning: true, variation }) + properties.letterSpacing)
    const width = widths.reduce((sum, value) => sum + value, 0)
    const start = ride.offset * total - (ride.align === 'center' ? width / 2 : ride.align === 'right' ? width : 0)
    const lift = ride.side === 'below' ? properties.fontSize * 0.8 : 0
    let travelled = start
    ;[...content].forEach((glyph, index) => {
      const advance = widths[index] ?? 0
      const place = placeOnPath(run, travelled + advance / 2)
      travelled += advance
      if (!place || glyph === ' ') return
      const path = font.getPath(glyph, -advance / 2, lift, properties.fontSize, { kerning: true, variation })
      const turned = commandsToRuns(path.commands).map((item) => ({
        closed: item.closed,
        points: item.points.map((point) => ({
          anchor: offsetPoint(point.anchor, place.point, place.angle),
          ...(point.in ? { in: offsetPoint(point.in, place.point, place.angle) } : {}),
          ...(point.out ? { out: offsetPoint(point.out, place.point, place.angle) } : {}),
        })),
      }))
      runs.push(...turned)
    })
  }
  for (const line of ride ? [] : layout.lines) {
    if (!line.text) continue
    const x = element.x + line.x - (layout.anchor === 'middle' ? line.width / 2 : layout.anchor === 'end' ? line.width : 0)
    const path = font.getPath(line.text, x, element.y + line.y, properties.fontSize, {
      kerning: true,
      variation,
      letterSpacing: properties.letterSpacing / properties.fontSize,
    })
    runs.push(...commandsToRuns(path.commands))
  }
  if (runs.length === 0) return null
  // The glyphs were laid out in the unrotated box, so a rotated element bakes its angle in.
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const placed = element.rotation ? runs.map((run) => ({
    closed: run.closed,
    points: run.points.map((item) => ({
      anchor: rotatePoint(item.anchor, center, element.rotation),
      ...(item.in ? { in: rotatePoint(item.in, center, element.rotation) } : {}),
      ...(item.out ? { out: rotatePoint(item.out, center, element.rotation) } : {}),
    })),
  })) : runs
  return placed
}

/** Editable outlines use the same glyph curves as the export writer. */
export async function outlineText(element: VectorElement, fonts: VectorFont[] = [], resolveFont?: FontResolver): Promise<OutlineResult | null> {
  const runs = await textOutlineRuns(element, fonts, resolveFont)
  if (!runs) return null
  const geometry = normalizeWorld(networkFromRuns(runs))
  // Counters are faces of their own; a letter reads only once they are switched off.
  const probe: VectorElement = { ...element, kind: 'path', rotation: 0, ...geometry }
  const off = holeFaceKeys(computeFaces(worldNetwork(probe)))
  return { ...geometry, ...(off.length ? { regionsOff: off } : {}) }
}

/** A glyph point drawn at the origin, moved onto the path and turned to it. */
function offsetPoint(point: { x: number; y: number }, at: { x: number; y: number }, angle: number) {
  const radians = (angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: at.x + point.x * cos - point.y * sin, y: at.y + point.x * sin + point.y * cos }
}

export function commandsToRuns(commands: GlyphCommand[]): Run[] {
  const runs: Run[] = []
  let points: Run['points'] = []
  let previous: VectorPoint | null = null
  const flush = () => {
    if (points.length >= 2) runs.push({ points, closed: true })
    points = []
  }
  for (const command of commands) {
    if (command.type === 'M') {
      flush()
      previous = { x: command.x, y: command.y }
      points = [{ anchor: previous }]
      continue
    }
    if (command.type === 'Z') {
      flush()
      previous = null
      continue
    }
    if (!previous) continue
    if (command.type === 'L') {
      previous = { x: command.x, y: command.y }
      points.push({ anchor: previous })
      continue
    }
    const last = points[points.length - 1]!
    const control = command.type === 'C'
      ? { out: { x: command.x1, y: command.y1 }, in: { x: command.x2, y: command.y2 } }
      : raiseQuadratic(previous, { x: command.x1, y: command.y1 }, { x: command.x, y: command.y })
    last.out = control.out
    previous = { x: command.x, y: command.y }
    points.push({ anchor: previous, in: control.in })
  }
  flush()
  // A closing curve leaves its handle on the first anchor; opentype always closes with Z.
  return runs
}

function raiseQuadratic(from: VectorPoint, control: VectorPoint, to: VectorPoint): { out: VectorPoint; in: VectorPoint } {
  return {
    out: { x: from.x + (2 / 3) * (control.x - from.x), y: from.y + (2 / 3) * (control.y - from.y) },
    in: { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) },
  }
}
