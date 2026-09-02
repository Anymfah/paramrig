import { rotatePoint } from '@/vector/directTransform'
import { networkFromRuns, normalizeWorld, worldNetwork, type Run } from '@/vector/network'
import { computeFaces, holeFaceKeys } from '@/vector/planar'
import { canvasMeasure, faceOf, layoutText, textProperties } from '@/vector/text'
import { pathLength, placeOnPath, runFromPathData } from '@/vector/textPath'
import type { VectorElement, VectorFont, VectorNetwork, VectorPoint } from '@/vector/types'
import { fontBytes } from '@/vector/fontLoader'

type OutlineResult = { x: number; y: number; width: number; height: number; network: VectorNetwork; regionsOff?: string[] }

type GlyphCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x: number; y: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'Q'; x: number; y: number; x1: number; y1: number }
  | { type: 'Z' }

type LoadedFont = {
  getPath: (text: string, x: number, y: number, size: number, options?: Record<string, unknown>) => { commands: GlyphCommand[] }
  getAdvanceWidth: (text: string, size: number, options?: Record<string, unknown>) => number
}

const shipped = new Map<string, Promise<LoadedFont | null>>()

/**
 * The glyph source for a family: the file the app ships, the file the document carries, or the
 * one Google serves. A system family has none of those, and "Outline text" stays out of reach.
 */
export async function loadOutlineFont(family: string, fonts: VectorFont[] = []): Promise<LoadedFont | null> {
  const carried = fonts.find((font) => font.family === family)
  if (carried) {
    // opentype.js reads TrueType and OpenType, not the Brotli-compressed woff2 Google serves.
    if (carried.source !== 'file' || carried.format === 'woff2') return null
    const bytes = await fontBytes(carried, carried.weights[0] ?? 400)
    if (!bytes) return null
    try {
      const opentype = await import('opentype.js')
      return opentype.parse(bytes) as unknown as LoadedFont
    } catch {
      return null
    }
  }
  const url = faceOf(family).outlineUrl
  if (!url) return null
  if (!shipped.has(url)) {
    shipped.set(url, (async () => {
      try {
        const [opentype, response] = await Promise.all([import('opentype.js'), fetch(url)])
        if (!response.ok) return null
        return opentype.parse(await response.arrayBuffer()) as unknown as LoadedFont
      } catch {
        return null
      }
    })())
  }
  return shipped.get(url)!
}

/** Forgets loaded fonts, for tests. */
export function resetOutlineFonts(): void {
  shipped.clear()
}

/**
 * Converts a text element into path geometry by reading the shipped font's glyphs.
 * Returns null when the family has no file the app can read.
 */
export async function outlineText(element: VectorElement, fonts: VectorFont[] = []): Promise<OutlineResult | null> {
  const properties = textProperties(element)
  const font = await loadOutlineFont(properties.fontFamily, fonts)
  if (!font) return null
  const layout = layoutText(properties, element.width, canvasMeasure)
  const runs: Run[] = []
  const ride = element.textPath?.d ? element.textPath : null
  if (ride?.d) {
    // On a path each glyph is placed on its own: the point at that distance along the outline,
    // turned to the local tangent, which is what makes the letters follow a curve rather than
    // sit on a straight baseline.
    const run = runFromPathData(ride.d)
    const total = run ? pathLength(run) : 0
    if (!run || total <= 0) return null
    const content = properties.text.replace(/\n/g, ' ')
    const widths = [...content].map((glyph) => font.getAdvanceWidth(glyph, properties.fontSize, { kerning: true }) + properties.letterSpacing)
    const width = widths.reduce((sum, value) => sum + value, 0)
    const start = ride.offset * total - (ride.align === 'center' ? width / 2 : ride.align === 'right' ? width : 0)
    const lift = ride.side === 'below' ? properties.fontSize * 0.8 : 0
    let travelled = start
    ;[...content].forEach((glyph, index) => {
      const advance = widths[index] ?? 0
      const place = placeOnPath(run, travelled + advance / 2)
      travelled += advance
      if (!place || glyph === ' ') return
      const path = font.getPath(glyph, -advance / 2, lift, properties.fontSize, { kerning: true })
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
  const geometry = normalizeWorld(networkFromRuns(placed))
  // Counters are faces of their own; a letter reads only once they are switched off.
  const probe: VectorElement = { ...element, kind: 'path', rotation: 0, ...geometry }
  const off = holeFaceKeys(computeFaces(worldNetwork(probe)))
  return { ...geometry, ...(off.length ? { regionsOff: off } : {}) }
}

/** Turns opentype path commands into closed anchor runs, quadratics raised to cubics. */
export /** A glyph point drawn at the origin, moved onto the path and turned to it. */
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
