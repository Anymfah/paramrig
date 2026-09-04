/**
 * Packing UV islands into the unit square: the shelf packer behind Pack islands.
 *
 * An island is a width and a height and nothing else here — the packer never sees a mesh, a corner
 * or a position, which is why the same shelf serves an unwrap, a lightmap and a sprite sheet. Three
 * decisions are worth knowing about.
 *
 * The scale is searched rather than derived. Where a row breaks is a step function of how big the
 * islands are against the square, so no formula gives the scale that packs best; the packer bisects
 * for the largest scale whose shelves still fit. That is what turns sixteen equal squares into four
 * rows of four rather than six rows of three, which is what a formula off the total area gives.
 *
 * The margin is held in the square's own units rather than in the island's, so that it means the
 * same thing whatever the islands are scaled to. That is why the last step re-lays the rows at the
 * chosen scale instead of scaling the finished layout: scaling a layout scales its gutters with it,
 * and a gutter that shrinks with the islands is no longer the margin that was asked for.
 *
 * The pack is by bounding box, and a shelf leaves the room above every island shorter than its row.
 * Those two are what the packing costs: a mixed set of islands fills about three fifths of the
 * square, where sixteen equal squares fill four fifths of it. A packer that read an island's own
 * outline, or one that cut the leftover of a row into free rectangles rather than into a row, would
 * take some of that back; this one is a shelf, and a shelf leaves it.
 */

/** One island as the packer sees it: which island it is, and how big its box is. */
export type IslandBox = { island: number; width: number; height: number }

/** Where the packer put it. `rotated` means the island is laid a quarter turn from how it came. */
export type PackedBox = { island: number; x: number; y: number; width: number; height: number; rotated: boolean }

export type PackOptions = {
  /** Space left between islands and around the square, as a fraction of the square. Default 0.02. */
  margin?: number
  /** Whether an island may be laid a quarter turn to fit better. Default true. */
  rotate?: boolean
  /** Scale every island to fill the square afterwards. Default true. */
  scaleToFit?: boolean
}

/** Below this a difference is a rounding error rather than an overlap. */
const EPS = 1e-9

/** Halvings of the scale. Thirty take it to a part in a billion, far under one texel of any image. */
const SEARCH_STEPS = 30

/** A margin wider than this leaves less of the square for the islands than for the gutters. */
const MAX_MARGIN = 0.25

/** An island with its size cleaned up, and its place in the order the packer works in. */
type Item = { island: number; width: number; height: number }

/** One island on a shelf: which item, and whether it lies a quarter turn from how it came. */
type Placed = { item: number; rotated: boolean }

/** The whole arrangement: rows of islands, bottom row first, in the order they were laid. */
type Shelves = Placed[][]

/**
 * Islands laid in the unit square, largest first.
 */
export function packIslands(boxes: IslandBox[], options: PackOptions = {}): PackedBox[] {
  const items = boxes.map(cleanBox).sort(largestFirst)
  if (items.length === 0) return []

  const rotate = options.rotate ?? true
  const scaleToFit = options.scaleToFit ?? true
  const margin = affordableMargin(options.margin ?? 0.02, items.length)
  const usable = 1 - margin * 2

  const longest = items.reduce((most, item) => Math.max(most, item.width, item.height), 0)
  // No island can be longer than the square, so no scale above this one can ever fit.
  const ceiling = longest > 0 ? usable / longest : 1
  const highest = scaleToFit ? ceiling : Math.min(1, ceiling)

  let arrangement = shelve(items, highest, margin, usable, rotate)
  let scale = fitScale(arrangement, items, margin, usable)
  if (!fits(arrangement, items, highest, margin, usable)) {
    /*
     * Bisection walks towards the largest scale that fits, but what is kept is the arrangement that
     * can be laid the largest — which is not always the last one to fit. An arrangement built too
     * large is still a valid arrangement, and shrinking it to the square can leave it packing
     * better than a smaller one that fitted where it stood.
     */
    let low = 0
    let high = highest
    for (let step = 0; step < SEARCH_STEPS; step += 1) {
      const middle = (low + high) / 2
      const shelves = shelve(items, middle, margin, usable, rotate)
      if (fits(shelves, items, middle, margin, usable)) low = middle
      else high = middle
      const laid = fitScale(shelves, items, margin, usable)
      if (laid > scale) {
        arrangement = shelves
        scale = laid
      }
    }
  }

  const refined = refine(arrangement, items, margin, usable, rotate)
  const grown = fitScale(refined, items, margin, usable)
  return layout(refined, items, scaleToFit ? grown : Math.min(1, grown), margin)
}

/**
 * The transform that takes an island's own UVs into the packed square: what to multiply and
 * what to add, per island, so the caller can apply it to the corners.
 *
 * The UVs it applies to are measured from the island's own lower-left corner, since an `IslandBox`
 * carries a size and no position; a caller subtracts the island's own minimum first.
 *
 *     laid as it came   u' = offsetU + scale * u    v' = offsetV + scale * v
 *     laid turned       u' = offsetU + scale * v    v' = offsetV - scale * u
 *
 * The turned form is a quarter turn and not a transpose: the second row is negated, so the island
 * keeps its handedness and the texture on it is not read back to front.
 */
export type IslandPlacement = { island: number; scale: number; offsetU: number; offsetV: number; rotated: boolean }

export function placementsFor(packed: PackedBox[], boxes: IslandBox[]): IslandPlacement[] {
  const sources = new Map<number, Item>()
  for (const box of boxes) if (!sources.has(box.island)) sources.set(box.island, cleanBox(box))
  return packed.map((box) => {
    const source = sources.get(box.island)
    // An island the packer knew about and the caller did not can only be taken at the size it was
    // packed at; it is a caller's mistake rather than a shape the packer can recover.
    const alongU = source === undefined ? 0 : box.rotated ? source.height : source.width
    const alongV = source === undefined ? 0 : box.rotated ? source.width : source.height
    const scale = alongU > 0 ? box.width / alongU : alongV > 0 ? box.height / alongV : 1
    return {
      island: box.island,
      scale,
      offsetU: box.x,
      offsetV: box.rotated ? box.y + box.height : box.y,
      rotated: box.rotated,
    }
  })
}

/* ------------------------------------------------------------------ shelves */

/**
 * One first-fit pass: every island onto the first shelf that has room for it, or onto a new one.
 *
 * A shelf is as tall as the island that opened it and never grows, which is what keeps the rows
 * above it where they are. So an island that would raise a shelf is turned if that makes it short
 * enough, and starts a new shelf otherwise.
 */
function shelve(items: Item[], scale: number, margin: number, usable: number, rotate: boolean): Shelves {
  const shelves: Shelves = []
  /** Where the next island on that shelf may start, the gutter already counted. */
  const cursor: number[] = []
  const heights: number[] = []

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const width = item.width * scale
    const height = item.height * scale
    let chosen = -1
    let turned = false

    for (let shelf = 0; shelf < shelves.length; shelf += 1) {
      const room = usable - cursor[shelf]!
      const tall = heights[shelf]!
      const flatFits = width <= room + EPS && height <= tall + EPS
      const turnedFits = rotate && height <= room + EPS && width <= tall + EPS
      if (!flatFits && !turnedFits) continue
      chosen = shelf
      // Both ways round fit: take the one that leaves more of the shelf for what comes after.
      turned = turnedFits && (!flatFits || height < width)
      break
    }

    if (chosen < 0) {
      // A new shelf is as tall as what opens it, so an island lies flat unless that will not fit.
      const wantsTurn = rotate && height > width
      const flatFits = width <= usable + EPS
      const turnedFits = rotate && height <= usable + EPS
      turned = wantsTurn ? turnedFits || !flatFits : !flatFits && turnedFits
      shelves.push([])
      cursor.push(0)
      heights.push(turned ? width : height)
      chosen = shelves.length - 1
    }

    shelves[chosen]!.push({ item: index, rotated: turned })
    cursor[chosen] = cursor[chosen]! + (turned ? height : width) + margin
  }

  return shelves
}

/**
 * The pass that gives back what the first one wasted: an island slid into the gap on an earlier
 * shelf, taken from the top down so that the shelves most likely to empty are emptied first.
 *
 * The move is judged by the only thing worth judging it by — whether the whole arrangement can then
 * be laid larger. Asking instead whether the island fits the gap as the placement pass understood
 * one would find nothing at all, since first fit already offered it every earlier shelf; what is
 * new here is that a shelf may rise to take an island, paying a little height on one row for a
 * whole row saved somewhere else.
 */
function refine(shelves: Shelves, items: Item[], margin: number, usable: number, rotate: boolean): Shelves {
  let best: Shelves = shelves.map((shelf) => [...shelf])
  let bestScale = fitScale(best, items, margin, usable)
  for (let from = best.length - 1; from >= 1; from -= 1) {
    for (const placed of [...best[from]!]) {
      let moved: Shelves | null = null
      let movedScale = bestScale
      for (let to = 0; to < from; to += 1) {
        for (const rotated of rotate ? [placed.rotated, !placed.rotated] : [placed.rotated]) {
          const trial = best.map((shelf) => shelf.filter((other) => other !== placed))
          trial[to]!.push({ item: placed.item, rotated })
          const laid = fitScale(trial.filter((shelf) => shelf.length > 0), items, margin, usable)
          if (laid > movedScale + EPS) {
            moved = trial
            movedScale = laid
          }
        }
      }
      if (moved !== null) {
        best = moved
        bestScale = movedScale
      }
    }
  }
  return best.filter((shelf) => shelf.length > 0)
}

/* ---------------------------------------------------------------- measuring */

/** Whether an arrangement at this scale stays inside the square, gutters included. */
function fits(shelves: Shelves, items: Item[], scale: number, margin: number, usable: number): boolean {
  let stack = margin * Math.max(0, shelves.length - 1)
  for (const shelf of shelves) {
    let width = margin * Math.max(0, shelf.length - 1)
    let tall = 0
    for (const placed of shelf) {
      const [w, h] = laidSize(items, placed)
      width += w * scale
      tall = Math.max(tall, h * scale)
    }
    if (width > usable + EPS) return false
    stack += tall
  }
  return stack <= usable + EPS
}

/**
 * The largest scale this arrangement can be laid at and still fit, exactly.
 *
 * The gutters are a fixed cost per row and per shelf, so the scale is a ratio rather than a search:
 * whatever the bisection left on the table, this puts the used extent against the square's edge.
 */
function fitScale(shelves: Shelves, items: Item[], margin: number, usable: number): number {
  let scale = Infinity
  let stack = 0
  for (const shelf of shelves) {
    let width = 0
    let tall = 0
    for (const placed of shelf) {
      const [w, h] = laidSize(items, placed)
      width += w
      tall = Math.max(tall, h)
    }
    const room = usable - margin * Math.max(0, shelf.length - 1)
    if (width > 0) scale = Math.min(scale, room / width)
    stack += tall
  }
  const room = usable - margin * Math.max(0, shelves.length - 1)
  if (stack > 0) scale = Math.min(scale, room / stack)
  // Islands with no size at all leave nothing to scale by, and are laid at the size they came with.
  return Number.isFinite(scale) ? Math.max(0, scale) : 1
}

/** The arrangement turned into rectangles, bottom row first, largest island first. */
function layout(shelves: Shelves, items: Item[], scale: number, margin: number): PackedBox[] {
  const boxes = new Array<PackedBox | undefined>(items.length)
  let y = margin
  for (const shelf of shelves) {
    let x = margin
    let tall = 0
    for (const placed of shelf) {
      const [w, h] = laidSize(items, placed)
      const width = w * scale
      const height = h * scale
      boxes[placed.item] = { island: items[placed.item]!.island, x, y, width, height, rotated: placed.rotated }
      x += width + margin
      tall = Math.max(tall, height)
    }
    y += tall + margin
  }
  return boxes.filter((box): box is PackedBox => box !== undefined)
}

/** An island's size the way round it was laid, before any scaling. */
function laidSize(items: Item[], placed: Placed): [number, number] {
  const item = items[placed.item]!
  return placed.rotated ? [item.height, item.width] : [item.width, item.height]
}

/* ------------------------------------------------------------------ tidying */

function cleanBox(box: IslandBox): Item {
  return { island: box.island, width: measure(box.width), height: measure(box.height) }
}

function measure(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function largestFirst(a: Item, b: Item): number {
  const area = b.width * b.height - a.width * a.height
  if (area !== 0) return area
  // Two islands of the same area still have to be ordered the same way every time, or the same
  // input would not give the same pack.
  const longest = Math.max(b.width, b.height) - Math.max(a.width, a.height)
  if (longest !== 0) return longest
  return a.island - b.island
}

/**
 * The margin the square can actually afford.
 *
 * A gutter is a fixed share of the square, so enough islands would leave no room for the islands
 * themselves — fifty of them at two hundredths apiece is the whole width. Rather than refuse the
 * pack or drop the gutter without saying so, it is narrowed to the widest that still leaves each
 * column at least half to the island.
 */
function affordableMargin(wanted: number, count: number): number {
  const asked = Number.isFinite(wanted) && wanted > 0 ? Math.min(wanted, MAX_MARGIN) : 0
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
  return Math.min(asked, 1 / (columns * 2))
}
