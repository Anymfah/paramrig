import { describe, expect, it } from 'vitest'
import { packIslands, placementsFor } from '@/scene/uv/pack'
import type { IslandBox, IslandPlacement, PackedBox } from '@/scene/uv/pack'

/**
 * The packer.
 *
 * Where any one island lands is the heuristic's business and may change. What a caller is entitled
 * to assume is what is tested here: no two islands ever touch, nothing leaves the square, the same
 * islands pack the same way twice, and the placement handed back really does carry an island onto
 * the rectangle the packer chose for it.
 */

const MARGIN = 0.02

function equalSquares(count: number, side = 1): IslandBox[] {
  return Array.from({ length: count }, (_, island) => ({ island, width: side, height: side }))
}

/** An unwrapped figure, near enough: two or three big charts and a litter of small ones. */
const aFigure: IslandBox[] = [
  { island: 0, width: 0.92, height: 0.61 },
  { island: 1, width: 0.55, height: 0.55 },
  { island: 2, width: 0.48, height: 0.72 },
  { island: 3, width: 0.48, height: 0.72 },
  { island: 4, width: 0.31, height: 0.9 },
  { island: 5, width: 0.31, height: 0.9 },
  { island: 6, width: 0.27, height: 0.27 },
  { island: 7, width: 0.27, height: 0.27 },
  { island: 8, width: 0.7, height: 0.18 },
  { island: 9, width: 0.7, height: 0.18 },
  { island: 10, width: 0.14, height: 0.14 },
  { island: 11, width: 0.14, height: 0.14 },
  { island: 12, width: 0.36, height: 0.12 },
  { island: 13, width: 0.22, height: 0.44 },
]

/** How much of the square the islands cover. */
function fill(packed: PackedBox[]): number {
  return packed.reduce((total, box) => total + box.width * box.height, 0)
}

/** Whether two islands would touch once each is given its half of the margin between them. */
function touch(a: PackedBox, b: PackedBox, margin = MARGIN): boolean {
  const half = margin / 2 - 1e-9
  return a.x - half < b.x + b.width + half && b.x - half < a.x + a.width + half
    && a.y - half < b.y + b.height + half && b.y - half < a.y + a.height + half
}

/** A corner of an island's own box, carried into the square by its placement. */
function carry(placement: IslandPlacement, u: number, v: number): [number, number] {
  return placement.rotated
    ? [placement.offsetU + placement.scale * v, placement.offsetV - placement.scale * u]
    : [placement.offsetU + placement.scale * u, placement.offsetV + placement.scale * v]
}

/** The island's own box, carried corner by corner, counter-clockwise from its lower left. */
function carriedCorners(placement: IslandPlacement, box: IslandBox): Array<[number, number]> {
  return [[0, 0], [box.width, 0], [box.width, box.height], [0, box.height]]
    .map(([u, v]) => carry(placement, u!, v!))
}

describe('a pack of islands', () => {
  const packed = packIslands(aFigure)

  it('leaves every island inside the square, clear of the border', () => {
    for (const box of packed) {
      expect(box.x, `island ${box.island}`).toBeGreaterThanOrEqual(MARGIN - 1e-9)
      expect(box.y, `island ${box.island}`).toBeGreaterThanOrEqual(MARGIN - 1e-9)
      expect(box.x + box.width, `island ${box.island}`).toBeLessThanOrEqual(1 - MARGIN + 1e-9)
      expect(box.y + box.height, `island ${box.island}`).toBeLessThanOrEqual(1 - MARGIN + 1e-9)
    }
  })

  it('never lets two islands come within the margin of each other', () => {
    for (let a = 0; a < packed.length; a += 1) {
      for (let b = a + 1; b < packed.length; b += 1) {
        expect(touch(packed[a]!, packed[b]!), `islands ${packed[a]!.island} and ${packed[b]!.island}`).toBe(false)
      }
    }
  })

  it('hands every island back, largest first, and none twice', () => {
    expect(packed.map((box) => box.island).sort((a, b) => a - b)).toEqual(aFigure.map((box) => box.island))
    const areas = packed.map((box) => box.width * box.height)
    expect(areas.every((area, at) => at === 0 || area <= areas[at - 1]! + 1e-9)).toBe(true)
  })

  it('packs the same islands the same way twice', () => {
    expect(packIslands(aFigure)).toEqual(packed)
    expect(packIslands([...aFigure].reverse()).sort((a, b) => a.island - b.island))
      .toEqual([...packed].sort((a, b) => a.island - b.island))
  })

  it('leaves the margin it was asked for and not the one it likes', () => {
    const wide = packIslands(aFigure, { margin: 0.1 })
    for (const box of wide) {
      expect(box.x).toBeGreaterThanOrEqual(0.1 - 1e-9)
      expect(box.x + box.width).toBeLessThanOrEqual(0.9 + 1e-9)
    }
    for (let a = 0; a < wide.length; a += 1) {
      for (let b = a + 1; b < wide.length; b += 1) expect(touch(wide[a]!, wide[b]!, 0.1)).toBe(false)
    }
  })
})

describe('sixteen equal squares', () => {
  const packed = packIslands(equalSquares(16))

  it('go into four rows of four', () => {
    expect(new Set(packed.map((box) => box.x.toFixed(6))).size).toBe(4)
    expect(new Set(packed.map((box) => box.y.toFixed(6))).size).toBe(4)
    for (const box of packed) expect(box.width).toBeCloseTo(packed[0]!.width, 9)
  })

  it('waste nothing but the margin', () => {
    // Four columns and their five gutters leave 0.9 of the square to the islands, so the whole of
    // what a shelf packer can reach on equal boxes is 0.81 — anything less is waste it has left.
    expect(fill(packed)).toBeCloseTo(0.81, 6)
  })

  it('pack the same whatever size the squares arrive at', () => {
    const large = packIslands(equalSquares(16, 40))
    expect(large.map((box) => box.width)).toEqual(packed.map((box) => box.width))
  })
})

describe('one island on its own', () => {
  it('fills the square, less the margin', () => {
    expect(packIslands([{ island: 7, width: 1, height: 1 }]))
      .toEqual([{ island: 7, x: MARGIN, y: MARGIN, width: 0.96, height: 0.96, rotated: false }])
  })

  it('fills it the long way when it is not square, and keeps its shape', () => {
    const [box] = packIslands([{ island: 0, width: 2, height: 1 }])
    expect(box!.width).toBeCloseTo(0.96, 9)
    expect(box!.height).toBeCloseTo(0.48, 9)
  })
})

describe('turning an island a quarter turn', () => {
  it('leaves a strip lying flat above a square, because standing it up would cost more', () => {
    /*
     * Turning is worth doing only when it lets everything be laid larger. A square and a thin strip
     * are the case where it does not: stood on end the strip is as tall as the square is wide, so
     * the square would have to shrink to share the row with it, while lying flat it fits in the
     * band left above. The packer measures rather than guesses, so what is asserted here is the
     * measurement — the two arrangements are the same, and neither turns the strip.
     */
    const [square, strip] = packIslands([{ island: 0, width: 1, height: 1 }, { island: 1, width: 0.8, height: 0.12 }])
    expect(strip!.rotated).toBe(false)
    expect(strip!.y).toBeGreaterThan(square!.y)
    expect(fill(packIslands([{ island: 0, width: 1, height: 1 }, { island: 1, width: 0.8, height: 0.12 }])))
      .toBeGreaterThanOrEqual(fill(packIslands([{ island: 0, width: 1, height: 1 }, { island: 1, width: 0.8, height: 0.12 }], { rotate: false })))
  })

  it('stands a wide island on end to fill the gap beside a tall one', () => {
    const packed = packIslands(aFigure)
    const stood = packed.filter((box) => {
      const source = aFigure.find((island) => island.island === box.island)!
      return box.rotated && source.width > source.height
    })
    expect(stood.length).toBeGreaterThan(0)
    for (const box of stood) expect(box.height).toBeGreaterThan(box.width)
  })

  it('leaves an island as it came when turning it buys nothing', () => {
    for (const box of packIslands(equalSquares(16))) expect(box.rotated).toBe(false)
    for (const box of packIslands([{ island: 0, width: 2, height: 1 }])) expect(box.rotated).toBe(false)
    // Islands all of one shape stack into rows as they came; a turned one would not fit the row.
    for (const box of packIslands(Array.from({ length: 5 }, (_, island) => ({ island, width: 0.8, height: 0.2 })))) {
      expect(box.rotated).toBe(false)
    }
  })

  it('packs a mixed set tighter than it can without turning', () => {
    // Measured: about 0.64 of the square with turning against about 0.46 without it.
    expect(fill(packIslands(aFigure))).toBeGreaterThan(fill(packIslands(aFigure, { rotate: false })))
  })

  it('turns nothing at all when it is told not to', () => {
    for (const box of packIslands(aFigure, { rotate: false })) expect(box.rotated).toBe(false)
  })
})

describe('islands kept at the size they came with', () => {
  it('does not blow a small island up to fill the square', () => {
    const [box] = packIslands([{ island: 0, width: 0.5, height: 0.25 }], { scaleToFit: false })
    expect(box!.width).toBeCloseTo(0.5, 9)
    expect(box!.height).toBeCloseTo(0.25, 9)
  })

  it('still shrinks islands that would not otherwise fit', () => {
    const packed = packIslands(equalSquares(4), { scaleToFit: false })
    expect(packed[0]!.width).toBeCloseTo(0.47, 9)
    for (const box of packed) expect(box.x + box.width).toBeLessThanOrEqual(1 - MARGIN + 1e-9)
  })
})

describe('islands the packer can make no sense of', () => {
  it('gives nothing back for nothing', () => {
    expect(packIslands([])).toEqual([])
    expect(placementsFor([], [])).toEqual([])
  })

  it('survives islands with no width, and keeps them in the square', () => {
    const packed = packIslands([
      { island: 0, width: 0, height: 0.5 },
      { island: 1, width: 0.5, height: 0 },
      { island: 2, width: 0, height: 0 },
      { island: 3, width: 0.5, height: 0.5 },
    ])
    expect(packed).toHaveLength(4)
    for (const box of packed) {
      expect(Number.isFinite(box.x) && Number.isFinite(box.y)).toBe(true)
      expect(box.x + box.width).toBeLessThanOrEqual(1 + 1e-9)
      expect(box.y + box.height).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('survives sizes that are not numbers at all', () => {
    const packed = packIslands([
      { island: 0, width: Number.NaN, height: 1 },
      { island: 1, width: -3, height: 0.5 },
      { island: 2, width: Infinity, height: Infinity },
      { island: 3, width: 1, height: 1 },
    ])
    expect(packed).toHaveLength(4)
    for (const box of packed) expect(Number.isFinite(box.width) && Number.isFinite(box.height)).toBe(true)
  })

  it('survives a hundred islands, and packs them without an overlap', () => {
    const many: IslandBox[] = Array.from({ length: 100 }, (_, island) => ({
      island,
      width: 0.2 + (island % 7) * 0.1,
      height: 0.15 + (island % 4) * 0.2,
    }))
    const packed = packIslands(many)
    expect(packed).toHaveLength(100)
    for (const box of packed) expect(box.y + box.height).toBeLessThanOrEqual(1 - MARGIN + 1e-9)
    for (let a = 0; a < packed.length; a += 1) {
      for (let b = a + 1; b < packed.length; b += 1) expect(touch(packed[a]!, packed[b]!)).toBe(false)
    }
  })

  it('narrows a margin the square cannot afford rather than refusing the pack', () => {
    // A quarter of the square between every pair of a hundred islands is not a margin, it is the
    // whole square; the pack still comes back, with every island inside it.
    const packed = packIslands(equalSquares(100), { margin: 0.25 })
    expect(packed).toHaveLength(100)
    for (const box of packed) expect(box.x + box.width).toBeLessThanOrEqual(1 + 1e-9)
  })
})

describe('the placement of an island', () => {
  const sources = [...aFigure, { island: 99, width: 0.8, height: 0.12 }]
  const packed = packIslands(sources)
  const placements = placementsFor(packed, sources)

  it('puts the island’s own box exactly where the packed box is', () => {
    expect(placements).toHaveLength(packed.length)
    for (let at = 0; at < packed.length; at += 1) {
      const box = packed[at]!
      const source = sources.find((island) => island.island === box.island)!
      const corners = carriedCorners(placements[at]!, source)
      const us = corners.map(([u]) => u)
      const vs = corners.map(([, v]) => v)
      expect(Math.min(...us), `island ${box.island}`).toBeCloseTo(box.x, 9)
      expect(Math.max(...us), `island ${box.island}`).toBeCloseTo(box.x + box.width, 9)
      expect(Math.min(...vs), `island ${box.island}`).toBeCloseTo(box.y, 9)
      expect(Math.max(...vs), `island ${box.island}`).toBeCloseTo(box.y + box.height, 9)
    }
  })

  it('turns an island rather than mirroring it', () => {
    const turned = packed.filter((box) => box.rotated)
    expect(turned.length).toBeGreaterThan(0)
    for (let at = 0; at < packed.length; at += 1) {
      const box = packed[at]!
      const source = sources.find((island) => island.island === box.island)!
      const corners = carriedCorners(placements[at]!, source)
      // Shoelace: a quarter turn keeps the winding, a mirror would read the texture back to front.
      let twiceTheArea = 0
      for (let corner = 0; corner < corners.length; corner += 1) {
        const [x, y] = corners[corner]!
        const [nx, ny] = corners[(corner + 1) % corners.length]!
        twiceTheArea += x * ny - nx * y
      }
      expect(twiceTheArea / 2, `island ${box.island}`).toBeCloseTo(box.width * box.height, 9)
    }
  })

  it('reads an island the packer never saw as the size it was packed at', () => {
    const [placement] = placementsFor([{ island: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.4, rotated: false }], [])
    expect(placement).toEqual({ island: 4, scale: 1, offsetU: 0.1, offsetV: 0.2, rotated: false })
  })
})
