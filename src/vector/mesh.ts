import type { VectorMesh, VectorMeshPoint, VectorPoint } from '@/vector/types'

export const MAX_MESH_LINES = 8
const MIN_SUBDIVISIONS = 8
const MAX_SUBDIVISIONS = 32

/** A mesh starts as one patch: four corners of the box, four colours. */
export function defaultMesh(colors: [string, string, string, string] = ['#D4E7E1', '#8CBDA8', '#E0968F', '#1C1D1E']): VectorMesh {
  return {
    rows: 1,
    cols: 1,
    points: [
      { x: 0, y: 0, color: colors[0] },
      { x: 1, y: 0, color: colors[1] },
      { x: 0, y: 1, color: colors[2] },
      { x: 1, y: 1, color: colors[3] },
    ],
  }
}

export function meshIndex(mesh: Pick<VectorMesh, 'cols'>, row: number, col: number): number {
  return row * (mesh.cols + 1) + col
}

export function meshPoint(mesh: VectorMesh, row: number, col: number): VectorMeshPoint {
  return mesh.points[meshIndex(mesh, row, col)]!
}

export function sanitizeMesh(value: unknown): VectorMesh | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<VectorMesh>
  const rows = clampLines(source.rows)
  const cols = clampLines(source.cols)
  if (!Array.isArray(source.points) || source.points.length !== (rows + 1) * (cols + 1)) return undefined
  const points = source.points.map((point) => {
    const item = point as Partial<VectorMeshPoint>
    const x = typeof item?.x === 'number' && Number.isFinite(item.x) ? clamp01(item.x) : 0
    const y = typeof item?.y === 'number' && Number.isFinite(item.y) ? clamp01(item.y) : 0
    const color = typeof item?.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color.toUpperCase() : '#808080'
    return { x: round(x), y: round(y), color }
  })
  return { rows, cols, points }
}

/**
 * How finely a patch is cut up, from how big it lands on screen. Below eight it bands visibly;
 * above thirty-two the polygons are smaller than a pixel and cost without showing.
 */
export function meshSubdivisions(sizeOnScreen: number): number {
  const steps = Math.round(sizeOnScreen / 12)
  return Math.max(MIN_SUBDIVISIONS, Math.min(MAX_SUBDIVISIONS, steps))
}

export type MeshCell = { d: string; color: string }

/**
 * The mesh as flat-coloured cells.
 *
 * SVG has no mesh gradient in any browser, so the patch is cut into a grid of small quads, each
 * filled with the colour interpolated at its middle. Positions and colours are interpolated
 * bilinearly between the four corners of the patch: the edges are straight lines between
 * neighbouring points, which is where this falls short of a true Coons patch.
 */
export function meshCells(mesh: VectorMesh, bounds: { x: number; y: number; width: number; height: number }, subdivisions: number): MeshCell[] {
  const steps = Math.max(2, Math.min(MAX_SUBDIVISIONS, Math.round(subdivisions)))
  const cells: MeshCell[] = []
  for (let row = 0; row < mesh.rows; row += 1) {
    for (let col = 0; col < mesh.cols; col += 1) {
      const corners = [
        meshPoint(mesh, row, col),
        meshPoint(mesh, row, col + 1),
        meshPoint(mesh, row + 1, col),
        meshPoint(mesh, row + 1, col + 1),
      ] as const
      for (let sy = 0; sy < steps; sy += 1) {
        for (let sx = 0; sx < steps; sx += 1) {
          const u0 = sx / steps
          const u1 = (sx + 1) / steps
          const v0 = sy / steps
          const v1 = (sy + 1) / steps
          const quad = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as const
          const points = quad.map(([u, v]) => place(corners, u, v, bounds))
          const color = blend(corners, (u0 + u1) / 2, (v0 + v1) / 2)
          cells.push({
            d: `M ${points.map((point) => `${round2(point.x)} ${round2(point.y)}`).join(' L ')} Z`,
            color,
          })
        }
      }
    }
  }
  return cells
}

/** The colour at a spot inside a patch, bilinear between its four corners. */
export function meshColorAt(mesh: VectorMesh, row: number, col: number, u: number, v: number): string {
  return blend([
    meshPoint(mesh, row, col),
    meshPoint(mesh, row, col + 1),
    meshPoint(mesh, row + 1, col),
    meshPoint(mesh, row + 1, col + 1),
  ] as const, u, v)
}

/** Adds a line through a fraction of the mesh, in both directions, with the colours it lands on. */
export function splitMesh(mesh: VectorMesh, at: VectorPoint): VectorMesh {
  const withRow = mesh.rows < MAX_MESH_LINES ? insert(mesh, 'row', at.y) : mesh
  return withRow.cols < MAX_MESH_LINES ? insert(withRow, 'col', at.x) : withRow
}

function insert(mesh: VectorMesh, axis: 'row' | 'col', fraction: number): VectorMesh {
  const lines = axis === 'row' ? mesh.rows : mesh.cols
  const positions = Array.from({ length: lines + 1 }, (_, index) => (axis === 'row'
    ? meshPoint(mesh, index, 0).y
    : meshPoint(mesh, 0, index).x))
  let before = 0
  for (let index = 0; index < lines; index += 1) {
    if (fraction > positions[index]! && fraction <= positions[index + 1]!) before = index
  }
  const span = positions[before + 1]! - positions[before]!
  const ratio = span <= 0 ? 0.5 : (fraction - positions[before]!) / span
  const rows = axis === 'row' ? mesh.rows + 1 : mesh.rows
  const cols = axis === 'col' ? mesh.cols + 1 : mesh.cols
  const points: VectorMeshPoint[] = []
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      if (axis === 'row' && row === before + 1) {
        const a = meshPoint(mesh, before, col)
        const b = meshPoint(mesh, before + 1, col)
        points.push(mix(a, b, ratio))
        continue
      }
      if (axis === 'col' && col === before + 1) {
        const a = meshPoint(mesh, row, before)
        const b = meshPoint(mesh, row, before + 1)
        points.push(mix(a, b, ratio))
        continue
      }
      const sourceRow = axis === 'row' && row > before + 1 ? row - 1 : row
      const sourceCol = axis === 'col' && col > before + 1 ? col - 1 : col
      points.push({ ...meshPoint(mesh, sourceRow, sourceCol) })
    }
  }
  return { rows, cols, points }
}

function mix(a: VectorMeshPoint, b: VectorMeshPoint, ratio: number): VectorMeshPoint {
  return {
    x: round(a.x + (b.x - a.x) * ratio),
    y: round(a.y + (b.y - a.y) * ratio),
    color: mixColor(a.color, b.color, ratio),
  }
}

function place(corners: readonly VectorMeshPoint[], u: number, v: number, bounds: { x: number; y: number; width: number; height: number }): VectorPoint {
  const [tl, tr, bl, br] = corners as [VectorMeshPoint, VectorMeshPoint, VectorMeshPoint, VectorMeshPoint]
  const x = (1 - v) * (tl.x + (tr.x - tl.x) * u) + v * (bl.x + (br.x - bl.x) * u)
  const y = (1 - v) * (tl.y + (tr.y - tl.y) * u) + v * (bl.y + (br.y - bl.y) * u)
  return { x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height }
}

function blend(corners: readonly VectorMeshPoint[], u: number, v: number): string {
  const [tl, tr, bl, br] = corners as [VectorMeshPoint, VectorMeshPoint, VectorMeshPoint, VectorMeshPoint]
  return mixColor(mixColor(tl.color, tr.color, u), mixColor(bl.color, br.color, u), v)
}

/** Straight-line blend in sRGB: not perceptual, but what every SVG gradient already does. */
export function mixColor(from: string, to: string, ratio: number): string {
  const a = parse(from)
  const b = parse(to)
  const channel = (index: number) => Math.round(a[index]! + (b[index]! - a[index]!) * Math.min(1, Math.max(0, ratio)))
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function parse(color: string): [number, number, number] {
  const hex = color.replace('#', '')
  return [
    Number.parseInt(hex.slice(0, 2), 16) || 0,
    Number.parseInt(hex.slice(2, 4), 16) || 0,
    Number.parseInt(hex.slice(4, 6), 16) || 0,
  ]
}

function clampLines(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(MAX_MESH_LINES, Math.round(value))) : 1
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
