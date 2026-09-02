import type { VectorElement, VectorPaint, VectorPatternMode, VectorPoint } from '@/vector/types'

export const PATTERN_MODES: VectorPatternMode[] = ['grid', 'brick', 'hex']

/** How tightly a hexagonal arrangement packs its rows: the height of an equilateral triangle. */
const HEX_ROW = Math.sqrt(3) / 2

export type PatternCell = {
  /** The repeating cell, in document units before the pattern transform. */
  width: number
  height: number
  /** Where the tile is stamped inside that cell. A brick or a hex stamps twice. */
  stamps: VectorPoint[]
}

/**
 * The repeating cell for a pattern.
 *
 * A grid repeats one stamp. A brick shifts every other row by half a tile, which SVG cannot say on
 * its own — so the cell is two rows tall and carries both stamps. A hex packs the rows closer, by
 * the height of an equilateral triangle, and is otherwise the same trick.
 */
export function patternCell(mode: VectorPatternMode, tile: { width: number; height: number }, spacing: number): PatternCell {
  const width = Math.max(1, tile.width + spacing)
  const height = Math.max(1, tile.height + spacing)
  if (mode === 'grid') return { width, height, stamps: [{ x: 0, y: 0 }] }
  const rows = mode === 'hex' ? height * HEX_ROW : height
  return { width, height: rows * 2, stamps: [{ x: 0, y: 0 }, { x: width / 2, y: rows }] }
}

/** The `patternTransform`: the offset first, then the turn and the scale about the origin. */
export function patternTransform(paint: Pick<VectorPaint, 'angle' | 'scale' | 'offset'>): string {
  const parts: string[] = []
  const offset = paint.offset
  if (offset && (offset.x || offset.y)) parts.push(`translate(${round(offset.x)} ${round(offset.y)})`)
  if (paint.angle) parts.push(`rotate(${round(paint.angle)})`)
  if (paint.scale && paint.scale !== 1) parts.push(`scale(${round(paint.scale)})`)
  return parts.join(' ')
}

/** A pattern made from an object: the tile is the object's own box. */
export function patternFromElement(element: VectorElement, id: string): VectorPaint {
  return {
    id,
    type: 'pattern',
    opacity: 1,
    visible: true,
    sourceId: element.id,
    tile: { width: round(element.width), height: round(element.height) },
    spacing: 0,
    scale: 1,
    angle: 0,
    offset: { x: 0, y: 0 },
    patternMode: 'grid',
  }
}

/** Where the source object has to move so its box sits at the origin of the cell. */
export function stampOffset(source: Pick<VectorElement, 'x' | 'y'>): VectorPoint {
  return { x: -source.x, y: -source.y }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
