import { meshOf } from '@/scene/model'
import { clampNumber } from '@/scene/mesh/data'
import type { SceneDocument, SceneObjectKind, Vec3 } from '@/scene/types'

/**
 * The picture a library card shows of a scene, and the isometric maths behind it.
 *
 * A library page draws many cards at once, so a card cannot open a WebGL context of its own: every
 * object is reduced to its bounding box and projected isometrically, which says how much is in the
 * scene and roughly where, which is what a card is for. `SceneThumb` draws those boxes as React
 * elements; `sceneThumbnail` writes the same picture as a self-contained data URL, for the
 * recent-projects store, which keeps text and has no DOM to render into.
 */

/** A point on the page after projection: x to the right, y downwards. */
export type ThumbPoint = [number, number]

type Eight<Value> = [Value, Value, Value, Value, Value, Value, Value, Value]

/** The eight corners of a box, in the order `boxCorners` builds them. */
export type ThumbCorners = Eight<Vec3>
export type ProjectedCorners = Eight<ThumbPoint>
export type ThumbFace = [ThumbPoint, ThumbPoint, ThumbPoint, ThumbPoint]

/** One object reduced to what the picture draws of it. */
export type SceneThumbBox = {
  id: string
  centre: Vec3
  half: Vec3
  kind: SceneObjectKind
}

/** The padded extent of a set of projected boxes, in the projection's own units. */
export type SceneThumbFrame = {
  minX: number
  minY: number
  width: number
  height: number
  /** The same four numbers, ready for an SVG `viewBox`. */
  view: string
  /** A hairline at this drawing's scale. */
  stroke: number
}

/** A light, a camera or an empty carries no mesh, and is drawn at the size its gizmo has. */
const GIZMO_HALF: Vec3 = [0.35, 0.35, 0.35]

const EMPTY_FRAME: SceneThumbFrame = { minX: -50, minY: -50, width: 100, height: 100, view: '-50 -50 100 100', stroke: 1 }

const DEFAULT_SIZE = 256

/**
 * How many boxes one picture draws.
 *
 * A card is a couple of hundred pixels across and the recent-projects store keeps 40 kB an entry,
 * so a scene of hundreds of objects shows the largest of them rather than a thousand paths nobody
 * could tell apart. The largest are also the ones that would have covered the rest.
 */
const MAX_THUMB_BOXES = 64

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = 0.5

/** A true isometric projection of a Z-up world: x and y go out at 30°, z straight up. */
function projectIsometric(point: Vec3): ThumbPoint {
  return [(point[0] - point[1]) * COS30, (point[0] + point[1]) * SIN30 - point[2]]
}

/** Distance along the view axis, which is (1, 1, 1) for this projection. */
function isometricDepth(point: Vec3): number {
  return point[0] + point[1] + point[2]
}

export function boxCorners(centre: Vec3, half: Vec3): ThumbCorners {
  const [cx, cy, cz] = centre
  const [hx, hy, hz] = half
  return [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ]
}

/** Written out rather than mapped, so the eight stay a tuple and no index needs a check. */
export function projectCorners(corners: ThumbCorners): ProjectedCorners {
  const [a, b, c, d, e, f, g, h] = corners
  return [
    projectIsometric(a), projectIsometric(b), projectIsometric(c), projectIsometric(d),
    projectIsometric(e), projectIsometric(f), projectIsometric(g), projectIsometric(h),
  ]
}

/** The three faces of a projected box that face the viewer, in the order they are drawn. */
export function boxFaces(corners: ProjectedCorners): [ThumbFace, ThumbFace, ThumbFace] {
  const [a, b, c, , e, f, g, h] = corners
  return [[e, f, g, h], [a, b, f, e], [b, c, g, f]]
}

/**
 * Every visible object as a box in world space. An object whose mesh has no extent at all — a
 * single vertex, an empty mesh — is left out rather than drawn as a dot the eye cannot place.
 */
export function sceneThumbBoxes(document: SceneDocument): SceneThumbBox[] {
  return document.objects.flatMap((object) => {
    if (!object.visible) return []
    const mesh = meshOf(document, object)
    const half: Vec3 = mesh ? meshHalfExtent(mesh.vertices) : GIZMO_HALF
    if (half[0] === 0 && half[1] === 0 && half[2] === 0) return []
    const [sx, sy, sz] = object.transform.scale
    const scaled: Vec3 = [Math.abs(half[0] * sx), Math.abs(half[1] * sy), Math.abs(half[2] * sz)]
    return [{ id: object.id, centre: object.transform.position, half: scaled, kind: object.kind }]
  })
}

/**
 * Painter's order, by depth along the view axis, the way the card has always drawn it.
 *
 * The axis is (1, 1, 1) with the viewer on the positive side, so the larger depth is the nearer
 * box and this order paints the nearest first. Reversing it would be the correct painter's
 * algorithm; it is left as it stands so that the card and the data URL are one picture rather than
 * two, and so that a change to it is made once, here, for both.
 */
export function paintOrder(boxes: SceneThumbBox[]): SceneThumbBox[] {
  return [...boxes].sort((a, b) => isometricDepth(b.centre) - isometricDepth(a.centre))
}

/** What a drawing of these boxes has to cover, with a margin so nothing touches the edge. */
export function thumbFrame(boxes: SceneThumbBox[]): SceneThumbFrame {
  const points = boxes.flatMap((box) => projectCorners(boxCorners(box.centre, box.half)))
  if (points.length === 0) return EMPTY_FRAME
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const spread = Math.max(maxX - minX, maxY - minY)
  const pad = spread * 0.12 + 0.5
  const width = maxX - minX + pad * 2
  const height = maxY - minY + pad * 2
  return {
    minX: minX - pad,
    minY: minY - pad,
    width,
    height,
    view: `${minX - pad} ${minY - pad} ${width} ${height}`,
    stroke: spread / 90,
  }
}

/**
 * The scene as a `data:image/svg+xml` URL, square and self-contained.
 *
 * No WebGL context is opened and no DOM is touched, so this runs in a test and in a loop over a
 * library page. The colours are written into the markup because a data URL cannot see the app's
 * tokens; the media query is the closest a standalone picture gets to the theme, and it matches
 * what `tokens.css` does when the reader has expressed no preference of their own.
 */
export function sceneThumbnail(document: SceneDocument, options?: { size?: number }): string {
  const size = Math.round(clampNumber(options?.size ?? DEFAULT_SIZE, 16, 1024, DEFAULT_SIZE))
  const root = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}' fill='none' stroke-linejoin='round'`
  const boxes = largestBoxes(sceneThumbBoxes(document))
  if (boxes.length === 0) return dataUrl(`${root}/>`)

  const frame = thumbFrame(boxes)
  const scale = size / Math.max(frame.width, frame.height)
  const offsetX = (size - frame.width * scale) / 2
  const offsetY = (size - frame.height * scale) / 2
  const onPage = (point: ThumbPoint): ThumbPoint => [
    (point[0] - frame.minX) * scale + offsetX,
    (point[1] - frame.minY) * scale + offsetY,
  ]

  // t, l and r are the card's top, left and right faces, tinted the way `scene.css` tints them.
  const paths = paintOrder(boxes).flatMap((box) => {
    const [top, left, right] = boxFaces(projectCorners(boxCorners(box.centre, box.half)))
    return [
      `<path class='t' d='${facePath(top, onPage)}'/>`,
      `<path class='l' d='${facePath(left, onPage)}'/>`,
      `<path class='r' d='${facePath(right, onPage)}'/>`,
    ]
  })
  return dataUrl(`${root} stroke-width='${round(frame.stroke * scale)}'>${STYLE}${paths.join('')}</svg>`)
}

/* ------------------------------------------------------------------ inside */

/** The same three tints `scene.css` gives the card, against a light ink and a dark one. */
const STYLE = [
  '<style>',
  'path{stroke:#edf2f18c}.t{fill:#edf2f12e}.l{fill:#edf2f11a}.r{fill:#edf2f10d}',
  '@media(prefers-color-scheme:light){',
  'path{stroke:#1c1d1e8c}.t{fill:#1c1d1e2e}.l{fill:#1c1d1e1a}.r{fill:#1c1d1e0d}}',
  '</style>',
].join('')

/** Half the size of a mesh's own bounding box, before the object's scale is applied. */
function meshHalfExtent(vertices: number[]): Vec3 {
  if (vertices.length < 3) return [0, 0, 0]
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const x = vertices[index] ?? 0
    const y = vertices[index + 1] ?? 0
    const z = vertices[index + 2] ?? 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2]
}

/** The boxes that cover the most page, keeping the document's order among equals. */
function largestBoxes(boxes: SceneThumbBox[]): SceneThumbBox[] {
  if (boxes.length <= MAX_THUMB_BOXES) return boxes
  return [...boxes]
    .sort((a, b) => projectedArea(b) - projectedArea(a))
    .slice(0, MAX_THUMB_BOXES)
}

function projectedArea(box: SceneThumbBox): number {
  const corners = projectCorners(boxCorners(box.centre, box.half))
  const xs = corners.map((point) => point[0])
  const ys = corners.map((point) => point[1])
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}

/** Explicit line commands, so no separating space has to be escaped in the URL. */
function facePath(face: ThumbFace, onPage: (point: ThumbPoint) => ThumbPoint): string {
  return face
    .map((point, index) => {
      const [x, y] = onPage(point)
      return `${index === 0 ? 'M' : 'L'}${round(x)},${round(y)}`
    })
    .join('') + 'Z'
}

/** Coordinates are the picture's own pixels, so a tenth of one is below anything a card shows. */
function round(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/**
 * Attributes are single-quoted, and only the characters a URL cannot carry are escaped.
 * `encodeURIComponent` would take every `<`, `/`, `=` and `:` as well, which a picture of hundreds
 * of paths cannot afford against the 40 kB an entry keeps; a single quote needs no escaping, so
 * the URL still drops into a double-quoted attribute as it is.
 */
function dataUrl(markup: string): string {
  const escaped = markup.replace(/[%#<>"{}|\\^`\s]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
  return `data:image/svg+xml,${escaped}`
}
