/**
 * The faces of the face-plate.
 *
 * The plate is a column of flex rows — the macro band, the body's rows, the strip — and a row is
 * a flex row of panels, each at the size it was measured at. A face is a deal of the panels into
 * rows and a width for the plate. The plate fills its room: the rows share the room's height in
 * proportion to their own, the panels in a row share its width in proportion to theirs, and each
 * centres what it holds. Nothing inside a panel moves between the faces: every control keeps the
 * coordinates it was measured at, and a panel dealt elsewhere carries them with it. A folded face
 * is the wide one folded, not a second transcription.
 *
 * The wide face is the reference's: one row of seven panels, the routing bar, three modulators
 * side by side. The medium one, for a room a little taller than the reference is wide, cuts the
 * row after the body and deals the filter, the amp, the effects and one modulator across a second
 * row, the routing bar between the two. The narrow one, for a room taller than it is wide, cuts
 * after the noise, deals the four panels that stood right of it across a row of their own, and
 * gives the one modulator a row under the routing bar. The macros wrap into two rows of eight on
 * both, and the strip's slots share whatever width the face has.
 */

export type Layout = 'wide' | 'medium' | 'narrow'
/** Each face's width, and the height its rows come to at that width. */
export const FACES: Record<Layout, { w: number; h: number }> = {
  wide: { w: 1250, h: 744 },
  medium: { w: 856, h: 797 },
  narrow: { w: 695, h: 1086.5 },
}
/** The reference's face, which everything is measured on. */
export const PLATE = FACES.wide

/** The body's items: the seven panels, and the modulators on show — three on the wide face, one on a folded one. */
export type Item = 'pitch' | 'osc' | 'noise' | 'body' | 'filter' | 'amp' | 'fx' | 'modulators'
/** A row of the body: panels side by side, or the routing bar. */
export type Row = Item[] | 'routing'
/**
 * How a face deals the body into rows. Every row of panels is as tall as the reference's, and
 * grows with the room in the same proportion as every other; a rule lies between two rows.
 */
export const DEAL: Record<Layout, Row[]> = {
  wide: [['pitch', 'osc', 'noise', 'body', 'filter', 'amp', 'fx'], 'routing', ['modulators']],
  medium: [['pitch', 'osc', 'noise', 'body'], 'routing', ['filter', 'amp', 'fx', 'modulators']],
  narrow: [['pitch', 'osc', 'noise'], ['body', 'filter', 'amp', 'fx'], 'routing', ['modulators']],
}

/**
 * The box the plate lays itself out in: the room at the face's scale, and never less than the
 * face. The rows and the panels share whatever the room has beyond the face, so the plate fills
 * it; a room too small for the face at that scale leaves the face its size, and the stage scrolls.
 */
export function plateBox(layout: Layout, scale: number, room: { w: number; h: number }): { w: number; h: number } {
  const face = FACES[layout]
  return { w: Math.max(face.w, room.w / scale), h: Math.max(face.h, room.h / scale) }
}

/** Below this scale a face cannot be read; the plate keeps its size and the room scrolls instead. */
export const FOLD = 0.75
/** From this scale the wide face is kept when it fills the room nearly as well as another: it shows the most. */
export const KEEP = 0.9

/** How well a face at a scale fills a room: the share of the room it covers, weighed by how readable it is. */
function fill(layout: Layout, scale: number, width: number, height: number): number {
  const face = FACES[layout]
  return (face.w * scale * face.h * scale) / (width * height) * Math.min(1, scale)
}

/**
 * Which face a room gets, and at what scale. Each face is fitted whole; the one that fills the
 * room best wins, and the wide face — which shows the most — is kept whenever it reads
 * comfortably and fills nearly as well. When no face can be read fitted whole, the plate keeps a
 * readable size and the room scrolls: the wide face where the room is merely short, then the
 * medium, then the narrow fitted to a narrow room's width.
 */
export function fitPlate(width: number, height: number): { layout: Layout; scale: number } {
  const whole = (layout: Layout) => Math.min(width / FACES[layout].w, height / FACES[layout].h)
  const fitted = (['wide', 'medium', 'narrow'] as const)
    .map((layout) => ({ layout, scale: whole(layout), fill: fill(layout, whole(layout), width, height) }))
    .filter((face) => face.scale >= FOLD)
  const best = fitted.reduce<(typeof fitted)[number] | null>((kept, next) => (!kept || next.fill > kept.fill ? next : kept), null)
  const wide = fitted.find((face) => face.layout === 'wide')
  if (best && wide && wide.scale >= KEEP && wide.fill >= best.fill - 0.1) return { layout: 'wide', scale: wide.scale }
  if (best) return { layout: best.layout, scale: best.scale }
  for (const layout of ['wide', 'medium'] as const) {
    if (width / FACES[layout].w >= FOLD) return { layout, scale: Math.min(1, width / FACES[layout].w) }
  }
  return { layout: 'narrow', scale: Math.min(1, width / FACES.narrow.w) }
}
