/**
 * The faces of the face-plate.
 *
 * The plate is a column of flex rows — the macro band, the body, the strip — and the body's items
 * are the seven panels, the routing bar and the modulators, each at the size it was measured at.
 * A face is an order for those items and a width for the row: the row wraps where the browser
 * finds it must, and a panel that is told to grow shares its line's spare width with its
 * neighbours, in step with their widths, and centres what it holds. Nothing inside a panel moves
 * between the faces: every control keeps the coordinates it was measured at, and a panel placed
 * elsewhere carries them with it. A folded face is the wide one folded, not a second transcription.
 *
 * The wide face is the reference's: one row of seven panels, the routing bar, three modulators
 * side by side. The medium one, for a room a little taller than the reference is wide, wraps the
 * row after the body and deals the filter, the amp, the effects and one modulator across a second
 * line, the routing bar between the two. The narrow one, for a room taller than it is wide, wraps
 * after the noise, deals the four panels that stood right of it across a line of their own, and
 * gives the one modulator a line under the routing bar. The macros wrap into two rows of eight on
 * both, and the strip's slots share whatever width the face has.
 */

export type Layout = 'wide' | 'medium' | 'narrow'
/** Each face's width, and the height its rows come to at that width. */
export const FACES: Record<Layout, { w: number; h: number }> = {
  wide: { w: 1250, h: 696 },
  medium: { w: 856, h: 749 },
  narrow: { w: 695, h: 1038.5 },
}
/** The reference's face, which everything is measured on. */
export const PLATE = FACES.wide

/** The body's items, in the order the reference has them. */
export type Item = 'pitch' | 'osc' | 'noise' | 'body' | 'filter' | 'amp' | 'fx' | 'routing' | 'modulators'
/**
 * How a face deals the body: the order of its items, which of them grow to fill their line, and
 * the orders at which a rule takes a line of its own between two others.
 */
export const DEAL: Record<Layout, { order: Record<Item, number>; grow: Item[]; rules: number[] }> = {
  wide: { order: { pitch: 1, osc: 1, noise: 1, body: 1, filter: 1, amp: 1, fx: 1, routing: 3, modulators: 5 }, grow: [], rules: [2, 4] },
  medium: { order: { pitch: 1, osc: 1, noise: 1, body: 1, routing: 3, filter: 5, amp: 5, fx: 5, modulators: 5 }, grow: ['filter', 'amp', 'fx', 'modulators'], rules: [2, 4] },
  narrow: { order: { pitch: 1, osc: 1, noise: 1, body: 3, filter: 3, amp: 3, fx: 3, routing: 5, modulators: 7 }, grow: ['body', 'filter', 'amp', 'fx', 'modulators'], rules: [2, 4, 6] },
}

/** Below this scale a face cannot be read; the plate keeps its size and the room scrolls instead. */
export const FOLD = 0.75
/** At this scale the wide face is kept whatever another face would gain: it shows the most. */
export const KEEP = 0.9

/**
 * Which face a room gets, and at what scale. The wide face while it can be read comfortably: it
 * shows the most, and fitted whole it is what the plugin's own window zoom gives. Otherwise the
 * face that fits the room whole at the largest scale, if any of them can still be read there.
 * When none can, the plate keeps a readable size and the room scrolls: the wide face where the
 * room is merely short, then the medium, then the narrow fitted to a narrow room's width.
 */
export function fitPlate(width: number, height: number): { layout: Layout; scale: number } {
  const whole = (layout: Layout) => Math.min(width / FACES[layout].w, height / FACES[layout].h)
  const wide = whole('wide')
  if (wide >= KEEP) return { layout: 'wide', scale: wide }
  const best = (['wide', 'medium', 'narrow'] as const)
    .map((layout) => ({ layout, scale: whole(layout) }))
    .reduce((kept, next) => (next.scale > kept.scale ? next : kept))
  if (best.scale >= FOLD) return best
  for (const layout of ['wide', 'medium'] as const) {
    if (width / FACES[layout].w >= FOLD) return { layout, scale: Math.min(1, width / FACES[layout].w) }
  }
  return { layout: 'narrow', scale: Math.min(1, width / FACES.narrow.w) }
}
