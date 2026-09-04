import { hexToRgb, rgbToHex } from '@/ui/color'
import type { UvGeometry } from '@/scene/uv/geometry'
import { gridStep, screenToUv, uvToScreen, type UvView } from '@/scene/uv/view'

/**
 * The picture the UV editor draws, in the order it is drawn.
 *
 * The ground, then the image the map is read against, then the grid, then the mesh: faces, edges,
 * points. Every one of them is a pass over the same arrays, and every one is skipped whole when it
 * is turned off — a mesh with fifty thousand corners is one path with fifty thousand segments
 * rather than fifty thousand paths, which is the difference between a canvas that follows a drag
 * and one that watches it.
 *
 * The context is a structural type rather than `CanvasRenderingContext2D` so that a test can hand
 * it a recorder and read back what would have been drawn. jsdom has no canvas, and a drawing that
 * can only be checked by eye is a drawing that quietly breaks.
 */

export type UvCanvas = {
  save: () => void
  restore: () => void
  beginPath: () => void
  closePath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  rect: (x: number, y: number, width: number, height: number) => void
  fillRect: (x: number, y: number, width: number, height: number) => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  clip: () => void
  fill: () => void
  stroke: () => void
  drawImage: (image: CanvasImageSource, x: number, y: number, width: number, height: number) => void
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  globalAlpha: number
  lineJoin: CanvasLineJoin
}

export type UvColours = {
  ground: string
  image: string
  checkerLight: string
  checkerDark: string
  grid: string
  gridMajor: string
  edge: string
  edgeSelected: string
  point: string
  pointSelected: string
  /** A corner a person has held in place, which an unwrap solves around. */
  pointPinned: string
  /** The casing an edge and a point wear, so a line reads on a light image and on a dark one. */
  halo: string
  face: string
  stretchLow: string
  stretchMid: string
  stretchHigh: string
}

/** The colours the canvas falls back to when the page has not been styled — a test, or a print. */
export const UV_COLOURS: UvColours = {
  ground: '#141817',
  image: '#2a2f2e',
  checkerLight: '#8d9694',
  checkerDark: '#5c6563',
  grid: '#ffffff21',
  gridMajor: '#ffffff3d',
  edge: '#dfe6e3',
  edgeSelected: '#f0a02e',
  point: '#f2f4f3',
  pointSelected: '#f0a02e',
  pointPinned: '#e05a5a',
  halo: '#0b0e0e',
  face: '#f0a02e4d',
  stretchLow: '#3a6ea5',
  stretchMid: '#77b255',
  stretchHigh: '#d1495b',
}

/** How many squares of the built-in checker cover the image, across and down. */
export const CHECKER_CELLS = 8

export type UvBackground = 'texture' | 'checker' | 'none'

export type UvPaint = {
  view: UvView
  size: { width: number; height: number }
  colours: UvColours
  background: UvBackground
  /** The active material's base-colour image, when it has one and it has decoded. */
  image: CanvasImageSource | null
  grid: boolean
  /** One number per face, 0 to 1, drawn as a ramp over the faces; null leaves the faces unfilled. */
  stretch: number[] | null
  /** Whether the mesh is drawn at all: an object with no UV map has a background and nothing else. */
  geometry: UvGeometry | null
  /** One byte per point, 1 where it is selected; null when nothing is. */
  selected: Uint8Array | null
  /** The same, for the points a person has pinned. */
  pinned: Uint8Array | null
  /** Radius of a point, in pixels. Coarse pointers ask for a larger one. */
  pointRadius: number
}

export function drawUv(ctx: UvCanvas, paint: UvPaint): void {
  const { size, colours } = paint
  ctx.fillStyle = colours.ground
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.fillRect(0, 0, size.width, size.height)
  drawImageSquare(ctx, paint)
  if (paint.grid) drawGrid(ctx, paint)
  drawBorder(ctx, paint)
  if (!paint.geometry) return
  if (paint.stretch) drawStretch(ctx, paint, paint.geometry, paint.stretch)
  else if (paint.selected) drawSelectedFaces(ctx, paint, paint.geometry, paint.selected)
  drawEdges(ctx, paint, paint.geometry)
  drawPoints(ctx, paint, paint.geometry)
}

/** Where the unit square lands on the canvas: the whole image, whatever is drawn inside it. */
export function imageRect(view: UvView): { x: number; y: number; width: number; height: number } {
  const [x, y] = uvToScreen(view, [0, 1])
  return { x, y, width: view.zoom, height: view.zoom }
}

function drawImageSquare(ctx: UvCanvas, paint: UvPaint): void {
  const rect = imageRect(paint.view)
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  ctx.fillStyle = paint.colours.image
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  if (paint.background === 'texture' && paint.image) {
    ctx.drawImage(paint.image, rect.x, rect.y, rect.width, rect.height)
  } else if (paint.background === 'checker') {
    const cell = rect.width / CHECKER_CELLS
    for (let row = 0; row < CHECKER_CELLS; row += 1) {
      for (let column = 0; column < CHECKER_CELLS; column += 1) {
        ctx.fillStyle = (row + column) % 2 === 0 ? paint.colours.checkerLight : paint.colours.checkerDark
        ctx.fillRect(rect.x + column * cell, rect.y + row * cell, cell + 0.5, cell + 0.5)
      }
    }
  }
  ctx.restore()
}

/**
 * The grid, drawn only where it can be seen.
 *
 * The lines are worked back from the canvas rather than forward from the image: the visible range
 * is turned into UV, rounded out to the step, and only those lines are drawn. Zoomed a hundred
 * times into one texel that is four lines rather than four hundred thousand.
 */
function drawGrid(ctx: UvCanvas, paint: UvPaint): void {
  const { view, size } = paint
  const step = gridStep(view.zoom)
  const topLeft = screenToUv(view, [0, 0])
  const bottomRight = screenToUv(view, [size.width, size.height])
  const fromU = Math.floor(topLeft[0] / step) * step
  const toU = Math.ceil(bottomRight[0] / step) * step
  const fromV = Math.floor(bottomRight[1] / step) * step
  const toV = Math.ceil(topLeft[1] / step) * step
  ctx.beginPath()
  for (let u = fromU; u <= toU + step / 2; u += step) {
    const x = Math.round(uvToScreen(view, [u, 0])[0]) + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, size.height)
  }
  for (let v = fromV; v <= toV + step / 2; v += step) {
    const y = Math.round(uvToScreen(view, [0, v])[1]) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(size.width, y)
  }
  ctx.strokeStyle = paint.colours.grid
  ctx.lineWidth = 1
  ctx.stroke()
}

/** The edge of the image itself, which is the one line a person navigates by. */
function drawBorder(ctx: UvCanvas, paint: UvPaint): void {
  const rect = imageRect(paint.view)
  ctx.beginPath()
  ctx.rect(Math.round(rect.x) + 0.5, Math.round(rect.y) + 0.5, Math.round(rect.width), Math.round(rect.height))
  ctx.strokeStyle = paint.colours.gridMajor
  ctx.lineWidth = 1
  ctx.stroke()
}

function drawStretch(ctx: UvCanvas, paint: UvPaint, geometry: UvGeometry, stretch: number[]): void {
  ctx.save()
  ctx.globalAlpha = 0.65
  for (let face = 0; face < geometry.faceStart.length; face += 1) {
    const length = geometry.faceLength[face] ?? 0
    if (length < 3) continue
    // The stretch is measured over the whole mesh, and the geometry may be only part of it.
    ctx.fillStyle = stretchColour(paint.colours, stretch[geometry.faceSlot[face] ?? face] ?? 0)
    ctx.beginPath()
    tracePath(ctx, paint, geometry, face)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * The faces every corner of which is selected, filled.
 *
 * That rule — a face is selected when all of it is — is Blender's, and it is what lets one
 * selection serve four modes: choosing a face selects its corners, and the fill follows.
 */
function drawSelectedFaces(ctx: UvCanvas, paint: UvPaint, geometry: UvGeometry, selected: Uint8Array): void {
  ctx.fillStyle = paint.colours.face
  for (let face = 0; face < geometry.faceStart.length; face += 1) {
    const start = geometry.faceStart[face] ?? 0
    const length = geometry.faceLength[face] ?? 0
    if (length < 3) continue
    let whole = true
    for (let corner = 0; corner < length && whole; corner += 1) {
      whole = selected[geometry.loopPoint[start + corner] ?? 0] === 1
    }
    if (!whole) continue
    ctx.beginPath()
    tracePath(ctx, paint, geometry, face)
    ctx.fill()
  }
}

/**
 * Blender's stretch ramp: blue where the flattening is faithful, red where it is not.
 *
 * The mid stop matters. A straight blue-to-red fade passes through a muddy purple exactly where the
 * interesting values are, and a person reading the overlay cannot tell a fifth of a stretch from a
 * half. Green in the middle spreads the range out where it is being read.
 */
export function stretchColour(colours: UvColours, value: number): string {
  const amount = Math.min(1, Math.max(0, value))
  // The ends are handed back as they arrived, so a token that is not a hex triple still reaches the
  // canvas intact at the two values a person reads most: no distortion at all, and the worst of it.
  if (amount <= 0) return colours.stretchLow
  if (amount >= 1) return colours.stretchHigh
  return amount < 0.5
    ? mixHex(colours.stretchLow, colours.stretchMid, amount * 2)
    : mixHex(colours.stretchMid, colours.stretchHigh, (amount - 0.5) * 2)
}

function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  if (!a || !b) return to
  // Lower case, because that is the case the tokens are written in and a colour that comes back in
  // a different case from the one that went in reads as a different colour when it is compared.
  return rgbToHex(
    Math.round(a.r + (b.r - a.r) * amount),
    Math.round(a.g + (b.g - a.g) * amount),
    Math.round(a.b + (b.b - a.b) * amount),
  ).toLowerCase()
}

function tracePath(ctx: UvCanvas, paint: UvPaint, geometry: UvGeometry, face: number): void {
  const start = geometry.faceStart[face] ?? 0
  const length = geometry.faceLength[face] ?? 0
  for (let corner = 0; corner < length; corner += 1) {
    const point = geometry.loopPoint[start + corner] ?? 0
    const [x, y] = uvToScreen(paint.view, [geometry.points[point * 2] ?? 0, geometry.points[point * 2 + 1] ?? 0])
    if (corner === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/*
 * Every edge in one path, stroked twice: a casing of the opposite tone, then the line.
 *
 * The image underneath is not the interface. A texture can be any colour at all, and the checker is
 * a mid grey in both themes, so no single line colour carries on all of it — which is the same
 * problem the viewport's selection outline has, and gets the same answer.
 */
function drawEdges(ctx: UvCanvas, paint: UvPaint, geometry: UvGeometry): void {
  if (geometry.edges.length === 0) return
  const selected = paint.selected
  ctx.lineJoin = 'round'
  // The whole set is cased in one path, then the two states are stroked in one path each: three
  // paths whatever the mesh, rather than one path per edge.
  path(ctx, paint, geometry, () => true)
  ctx.strokeStyle = paint.colours.halo
  ctx.lineWidth = 3
  ctx.stroke()
  path(ctx, paint, geometry, (a, b) => !selected || selected[a] !== 1 || selected[b] !== 1)
  ctx.strokeStyle = paint.colours.edge
  ctx.lineWidth = 1
  ctx.stroke()
  if (!selected) return
  path(ctx, paint, geometry, (a, b) => selected[a] === 1 && selected[b] === 1)
  ctx.strokeStyle = paint.colours.edgeSelected
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function path(ctx: UvCanvas, paint: UvPaint, geometry: UvGeometry, wanted: (a: number, b: number) => boolean): void {
  ctx.beginPath()
  for (let index = 0; index < geometry.edges.length; index += 2) {
    const a = geometry.edges[index] ?? 0
    const b = geometry.edges[index + 1] ?? 0
    if (!wanted(a, b)) continue
    const from = uvToScreen(paint.view, [geometry.points[a * 2] ?? 0, geometry.points[a * 2 + 1] ?? 0])
    const to = uvToScreen(paint.view, [geometry.points[b * 2] ?? 0, geometry.points[b * 2 + 1] ?? 0])
    ctx.moveTo(from[0], from[1])
    ctx.lineTo(to[0], to[1])
  }
}

/*
 * Points are squares rather than circles, and that is not a shortcut: `arc` on a path of ten
 * thousand points costs several times what `fillRect` does, and at four pixels across the two are
 * the same picture.
 */
function drawPoints(ctx: UvCanvas, paint: UvPaint, geometry: UvGeometry): void {
  const size = Math.max(2, paint.pointRadius * 2)
  // Two passes rather than two rectangles per point: setting the fill once for each is what keeps
  // ten thousand points a pair of loops rather than twenty thousand state changes.
  const selected = paint.selected
  const pinned = paint.pinned
  const isPinned = (point: number): boolean => pinned !== null && pinned[point] === 1
  const passes = [
    { colour: paint.colours.halo, grow: 2, wanted: () => true },
    { colour: paint.colours.point, grow: 0, wanted: (point: number) => !isPinned(point) && (!selected || selected[point] !== 1) },
    { colour: paint.colours.pointSelected, grow: 1, wanted: (point: number) => !isPinned(point) && selected !== null && selected[point] === 1 },
    // Pinned last and largest, because a pin is the one thing on the map that overrides everything
    // else about it: whatever else a corner is, if it is pinned an unwrap will not move it.
    { colour: paint.colours.pointPinned, grow: 2, wanted: isPinned },
  ]
  for (const pass of passes) {
    const side = size + pass.grow
    const half = side / 2
    ctx.fillStyle = pass.colour
    for (let point = 0; point < geometry.points.length / 2; point += 1) {
      if (!pass.wanted(point)) continue
      const [x, y] = uvToScreen(paint.view, [geometry.points[point * 2] ?? 0, geometry.points[point * 2 + 1] ?? 0])
      if (x < -side || y < -side || x > paint.size.width + side || y > paint.size.height + side) continue
      ctx.fillRect(Math.round(x) - half, Math.round(y) - half, side, side)
    }
  }
}
