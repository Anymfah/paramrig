/**
 * The two faces of the face-plate.
 *
 * The wide one is the reference's, measured: the macro band, one row of seven panels, the routing
 * bar, three modulators side by side, the strip of kept sounds. The narrow one deals the same
 * panels again for a room that is taller than it is wide — the macros in two rows of eight, the
 * row cut after the noise, the four panels that stood right of it as a second row stretched to the
 * same width, one modulator at a time — so that nothing has to shrink below the size it was drawn
 * at. Nothing inside a panel moves between the two: every control keeps the coordinates it was
 * measured at, and a panel placed elsewhere carries them with it. The narrow face is the wide one
 * folded, not a second transcription.
 */

export const PLATE = { w: 1250, h: 696 }
export const NARROW = { w: 695, h: 1038.5 }
export type Layout = 'wide' | 'narrow'
/** Where a panel sits on the plate when that is not where it was measured. */
export type Place = { x: number; y: number; w: number }

/** Below this scale the wide face cannot be read, and the plate folds instead. */
export const FOLD = 0.75

/** The top of each band on a face, and the rules between the bands as [top, thickness]. */
export const ROWS: Record<Layout, { band: number; a: number; b: number; routing: number; modulators: number; strip: number; rules: [number, number][] }> = {
  wide: { band: 53, a: 54, b: 54, routing: 343.5, modulators: 384, strip: 673, rules: [[52.5, 1.5], [342, 1.5], [382.5, 1.5], [672, 1]] },
  narrow: { band: 106, a: 107, b: 396.5, routing: 686, modulators: 726.5, strip: 1015.5, rules: [[105.5, 1.5], [395, 1.5], [684.5, 1.5], [725, 1.5], [1014.5, 1]] },
}

/** Body, Filter, Amp and FX where the reference has them, a gap and a half between neighbours. */
const ROW_B = { body: { x: 696.5, w: 159 }, filter: { x: 857, w: 160 }, amp: { x: 1018.5, w: 70.5 }, fx: { x: 1090.5, w: 159.5 } }
const ORDER = ['body', 'filter', 'amp', 'fx'] as const
const GAP = 1.5

/** Row B's four panels on a face: measured on the wide one, stretched in step to fill the narrow one. */
export function rowB(layout: Layout): Record<keyof typeof ROW_B, Place> {
  const y = ROWS[layout].b
  const width = ORDER.reduce((sum, key) => sum + ROW_B[key].w, 0)
  const stretch = layout === 'wide' ? 1 : (NARROW.w - GAP * (ORDER.length - 1)) / width
  const places = {} as Record<keyof typeof ROW_B, Place>
  let x = 0
  for (const key of ORDER) {
    const w = ROW_B[key].w * stretch
    places[key] = { x: layout === 'wide' ? ROW_B[key].x : x, y, w }
    x += w + GAP
  }
  return places
}

/**
 * Which face a room gets, and at what scale. The wide face whenever it can be read: fitted whole,
 * as the plugin's own window zoom fits it. When fitting would shrink it below the fold, the plate
 * keeps its size and the room scrolls instead — a room that is wide but short keeps the wide face;
 * a narrow one gets the fold, at its own size or the room's width, whichever is the smaller.
 */
export function fitPlate(width: number, height: number): { layout: Layout; scale: number } {
  const whole = Math.min(width / PLATE.w, height / PLATE.h)
  if (whole >= FOLD) return { layout: 'wide', scale: whole }
  if (width / PLATE.w >= FOLD) return { layout: 'wide', scale: Math.min(1, width / PLATE.w) }
  return { layout: 'narrow', scale: Math.min(1, width / NARROW.w) }
}
