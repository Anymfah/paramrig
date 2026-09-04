import { cellSizeFor, PointGrid } from '@/scene/sculpt/grid'
import { applyDab, DRAGGING_BRUSHES, MASK_BRUSHES, type BrushDab, type BrushTargets, type SculptBrush } from '@/scene/sculpt/brushes'
import type { FalloffKind } from '@/scene/transform/proportional'
import type { MeshData, SculptState, Vec3 } from '@/scene/types'

/**
 * A mesh, open for sculpting.
 *
 * Everything here is a typed array and an index. Sculpting is the one part of the editor where the
 * document's own shape — vertices as a `number[]`, faces as arrays of arrays — is the wrong one: a
 * stroke touches thousands of vertices sixty times a second, and rebuilding a mesh per frame would
 * be the frame. So the session takes the positions once, works on them in place, and hands back a
 * mesh when the hand lets go.
 *
 * It is deliberately not an `EditMesh`. Sculpting never changes the topology — that is what dynamic
 * topology would be, and this build does not have it — so there is nothing to add or remove, and
 * the whole of the machinery for doing that safely would only be in the way.
 */

/**
 * What one dab is made of, in the object's own units.
 *
 * The radius here is *not* the size a person sets — that one is in pixels, and lives on the view as
 * `SculptState`. The tool converts it where the brush touches the surface, because that is the only
 * place the two can be compared.
 */
export type SculptSettings = {
  brush: SculptBrush
  /** In the object's own units. */
  radius: number
  strength: number
  falloff: FalloffKind
  invert: boolean
  symmetry: { x: boolean; y: boolean; z: boolean }
  /** How much of a smoothing pass follows every dab, 0 to 1. */
  autoSmooth: number
  /** Leave the vertices whose normals point away from the view alone. */
  frontFacesOnly: boolean
}

/** The brush a scene opens with, as Blender's does: Draw, at half strength, fifty pixels across. */
export const DEFAULT_SCULPT_STATE: SculptState = {
  brush: 'draw',
  size: 50,
  strength: 0.5,
  falloff: 'smooth',
  symmetry: { x: false, y: false, z: false },
  autoSmooth: 0,
  frontFacesOnly: false,
}

/** The same, as one dab of it: the radius is the caller's to fill in. */
export const DEFAULT_SCULPT: SculptSettings = {
  brush: 'draw',
  radius: 0.5,
  strength: 0.5,
  falloff: 'smooth',
  invert: false,
  symmetry: { x: false, y: false, z: false },
  autoSmooth: 0,
  frontFacesOnly: false,
}

/** The settings for one dab, from the ones a person set and the keys they are holding. */
export function dabSettings(state: SculptState, radius: number, options: { invert?: boolean; smoothing?: boolean } = {}): SculptSettings {
  return {
    // Shift is a temporary Smooth, which is the one modifier every sculpting application has.
    brush: options.smoothing ? 'smooth' : state.brush,
    radius,
    strength: state.strength,
    falloff: state.falloff,
    invert: options.invert === true,
    symmetry: state.symmetry,
    autoSmooth: state.autoSmooth,
    frontFacesOnly: state.frontFacesOnly,
  }
}

/** One press of the pointer against the surface. */
export type SculptStep = {
  /** Where the pointer is, in the object's own space. */
  point: Vec3
  /** The surface normal there. */
  normal: Vec3
  /** Which way the view is looking, in the object's space, for "front faces only". */
  view?: Vec3
  /** Tablet pressure, 0 to 1; a mouse has none and is treated as a full press. */
  pressure?: number
}

/** What a finished stroke changed: enough to put it back, and no more. */
export type SculptStroke = {
  /** The vertices that moved, by slot. */
  indices: Int32Array
  /** Where they were, three floats each. */
  before: Float32Array
  /** Where they are now. */
  after: Float32Array
  /** The mask as it was and as it is, when the stroke was a mask stroke. */
  maskBefore?: Float32Array
  maskAfter?: Float32Array
}

/** Below this a vertex has not really moved, and recording it would cost more than it says. */
const MOVED = 1e-7

export class SculptSession {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly mask: Float32Array
  private base: MeshData
  private readonly adjacency: { start: Int32Array; count: Int32Array; list: Int32Array }
  private readonly vertexFaces: { start: Int32Array; count: Int32Array; list: Int32Array }
  private grid: PointGrid
  private gridRadius: number
  /** Where every vertex was when the stroke began; the dragging brushes work from it. */
  private origin: Float32Array
  private maskAtStart: Float32Array | null = null
  /** Which vertices this stroke has touched, so the history entry is the stroke and not the mesh. */
  private touched = new Set<number>()
  /**
   * Every vertex this session has ever moved.
   *
   * The positions live in a `Float32Array`, and the document's are doubles: reading a whole mesh
   * through the one and writing it back to the other would round every coordinate of it, so opening
   * sculpt mode and closing it again would change a model nobody had touched. Only what moved is
   * written back, and everything else is handed over exactly as it arrived.
   */
  private moved = new Set<number>()
  private strokeStart: Float32Array | null = null
  private scratch: number[] = []
  private lastPoint: Vec3 | null = null
  /** Where the pointer was when the stroke began, which is what Grab measures against. */
  private strokePoint: Vec3 | null = null

  constructor(mesh: MeshData) {
    this.base = mesh
    const count = mesh.vertexIds.length
    this.positions = new Float32Array(count * 3)
    for (let index = 0; index < count * 3; index += 1) this.positions[index] = mesh.vertices[index] ?? 0
    this.origin = this.positions.slice()
    this.normals = new Float32Array(count * 3)
    this.mask = new Float32Array(count)
    const stored = mesh.attributes.vertex.mask
    if (stored && stored.length === count) for (let index = 0; index < count; index += 1) this.mask[index] = stored[index] ?? 0
    this.adjacency = buildAdjacency(mesh, count)
    this.vertexFaces = buildVertexFaces(mesh, count)
    this.gridRadius = 0.5
    this.grid = new PointGrid(this.positions, cellSizeFor(this.gridRadius))
    this.recomputeNormals(range(count))
  }

  get vertexCount(): number {
    return this.positions.length / 3
  }

  /** The mesh the session was opened on, for a caller that needs its faces. */
  get mesh(): MeshData {
    return this.base
  }

  /**
   * The mesh this session now stands for.
   *
   * After a stroke the document holds a new mesh — the one this session made — and everything that
   * compares the two would otherwise see a session copied from a mesh nobody holds any more, and
   * throw it away. Rebuilding a session is a pass over every vertex and every face of the model, so
   * being told "this is still you" is the difference between a stroke and a stutter between strokes.
   * It is only ever handed a mesh with the same topology, which is what the session guarantees.
   */
  rebase(mesh: MeshData): void {
    this.base = mesh
  }

  /** A stroke begins: everything is measured from here until it ends. */
  beginStroke(): void {
    this.origin.set(this.positions)
    this.strokeStart = this.positions.slice()
    this.maskAtStart = this.mask.slice()
    this.touched.clear()
    this.lastPoint = null
    this.strokePoint = null
  }

  /**
   * One dab, with its mirrors.
   *
   * Symmetry is applied by mirroring the dab rather than by pairing up vertices: a mirrored brush
   * is exactly a brush at the mirrored place, and it costs nothing to find the partner of a vertex
   * that may not have one. That is Blender's own answer, and it is why sculpting with symmetry on a
   * mesh that is not symmetric still does something sensible.
   */
  apply(step: SculptStep, settings: SculptSettings): void {
    if (!this.strokePoint) this.strokePoint = [...step.point]
    const from = DRAGGING_BRUSHES.has(settings.brush) ? this.strokePoint : this.lastPoint
    const delta: Vec3 = from
      ? [step.point[0] - from[0], step.point[1] - from[1], step.point[2] - from[2]]
      : [0, 0, 0]
    this.lastPoint = [...step.point]
    if (settings.radius !== this.gridRadius) this.rebuildGrid(settings.radius)
    const axes: Array<[number, number, number]> = [[1, 1, 1]]
    if (settings.symmetry.x) axes.push([-1, 1, 1])
    if (settings.symmetry.y) axes.push([1, -1, 1])
    if (settings.symmetry.z) axes.push([1, 1, -1])
    if (settings.symmetry.x && settings.symmetry.y) axes.push([-1, -1, 1])
    if (settings.symmetry.x && settings.symmetry.z) axes.push([-1, 1, -1])
    if (settings.symmetry.y && settings.symmetry.z) axes.push([1, -1, -1])
    if (settings.symmetry.x && settings.symmetry.y && settings.symmetry.z) axes.push([-1, -1, -1])
    for (const axis of axes) this.dab(step, settings, delta, axis)
  }

  private dab(step: SculptStep, settings: SculptSettings, delta: Vec3, axis: [number, number, number]): void {
    /*
     * A dragging brush keeps its grip: the sphere it grabbed stays where the stroke began, so the
     * same vertices move by the same share however far the hand travels. Everything else follows
     * the pointer, because painting is what it does.
     */
    const dragging = DRAGGING_BRUSHES.has(settings.brush)
    const anchor = dragging ? this.strokePoint ?? step.point : step.point
    const measure = dragging ? this.origin : this.positions
    const centre: Vec3 = [anchor[0] * axis[0], anchor[1] * axis[1], anchor[2] * axis[2]]
    const normal: Vec3 = [step.normal[0] * axis[0], step.normal[1] * axis[1], step.normal[2] * axis[2]]
    const indices = this.grid.near(measure, centre, settings.radius, this.scratch)
    const wanted = settings.frontFacesOnly && step.view ? this.facingOnly(indices, step.view, axis) : indices
    if (wanted.length === 0) return
    const dab: BrushDab = {
      brush: settings.brush,
      centre,
      normal,
      radius: settings.radius,
      strength: settings.strength,
      falloff: settings.falloff,
      invert: settings.invert,
      delta: [delta[0] * axis[0], delta[1] * axis[1], delta[2] * axis[2]],
      pressure: step.pressure === undefined ? 1 : Math.max(0.05, Math.min(1, step.pressure * 2)),
    }
    const targets: BrushTargets = {
      indices: wanted,
      positions: this.positions,
      origin: this.origin,
      measure,
      normals: this.normals,
      mask: this.mask,
      adjacency: this.adjacency,
    }
    applyDab(dab, targets)
    if (settings.autoSmooth > 0 && !MASK_BRUSHES.has(settings.brush)) {
      applyDab({ ...dab, brush: 'smooth', strength: settings.autoSmooth, invert: false, delta: [0, 0, 0] }, targets)
    }
    for (const index of wanted) {
      this.touched.add(index)
      this.moved.add(index)
    }
    this.recomputeNormals(wanted)
  }

  /** The vertices facing the viewer, for Blender's "front faces only". */
  private facingOnly(indices: number[], view: Vec3, axis: [number, number, number]): number[] {
    const kept: number[] = []
    for (const index of indices) {
      const dot = this.normals[index * 3]! * view[0] * axis[0]
        + this.normals[index * 3 + 1]! * view[1] * axis[1]
        + this.normals[index * 3 + 2]! * view[2] * axis[2]
      if (dot < 0) kept.push(index)
    }
    return kept
  }

  /**
   * The normals of the vertices that moved, and of everyone touching them.
   *
   * A vertex's normal is the average of the faces around it, so moving a vertex changes the normals
   * of its neighbours as well as its own — and a brush that recomputed only what it moved would
   * leave a ring of stale shading around every dab.
   */
  recomputeNormals(indices: Iterable<number>): void {
    const wanted = new Set<number>()
    for (const index of indices) {
      wanted.add(index)
      const start = this.adjacency.start[index] ?? 0
      for (let step = 0; step < (this.adjacency.count[index] ?? 0); step += 1) wanted.add(this.adjacency.list[start + step]!)
    }
    for (const index of wanted) {
      let nx = 0
      let ny = 0
      let nz = 0
      const start = this.vertexFaces.start[index] ?? 0
      for (let step = 0; step < (this.vertexFaces.count[index] ?? 0); step += 1) {
        const face = this.base.faces[this.vertexFaces.list[start + step]!]
        if (!face || face.length < 3) continue
        const [a, b, c] = [face[0]!, face[1]!, face[2]!]
        const ux = this.positions[b * 3]! - this.positions[a * 3]!
        const uy = this.positions[b * 3 + 1]! - this.positions[a * 3 + 1]!
        const uz = this.positions[b * 3 + 2]! - this.positions[a * 3 + 2]!
        const vx = this.positions[c * 3]! - this.positions[a * 3]!
        const vy = this.positions[c * 3 + 1]! - this.positions[a * 3 + 1]!
        const vz = this.positions[c * 3 + 2]! - this.positions[a * 3 + 2]!
        nx += uy * vz - uz * vy
        ny += uz * vx - ux * vz
        nz += ux * vy - uy * vx
      }
      const length = Math.hypot(nx, ny, nz)
      this.normals[index * 3] = length > 1e-12 ? nx / length : 0
      this.normals[index * 3 + 1] = length > 1e-12 ? ny / length : 0
      this.normals[index * 3 + 2] = length > 1e-12 ? nz / length : 1
    }
  }

  private rebuildGrid(radius: number): void {
    this.gridRadius = Math.max(1e-4, radius)
    this.grid = new PointGrid(this.positions, cellSizeFor(this.gridRadius))
  }

  /** The grid is rebuilt at the end of a stroke, when the vertices have finished moving. */
  endStroke(): SculptStroke | null {
    const start = this.strokeStart
    this.strokeStart = null
    if (!start) return null
    const moved: number[] = []
    for (const index of this.touched) {
      const at = index * 3
      if (Math.abs(this.positions[at]! - start[at]!) > MOVED
        || Math.abs(this.positions[at + 1]! - start[at + 1]!) > MOVED
        || Math.abs(this.positions[at + 2]! - start[at + 2]!) > MOVED) {
        moved.push(index)
      }
    }
    const maskChanged = this.maskAtStart !== null && this.mask.some((value, index) => value !== this.maskAtStart![index])
    if (moved.length === 0 && !maskChanged) return null
    this.rebuildGrid(this.gridRadius)
    const before = new Float32Array(moved.length * 3)
    const after = new Float32Array(moved.length * 3)
    for (let index = 0; index < moved.length; index += 1) {
      const at = moved[index]! * 3
      before[index * 3] = start[at]!
      before[index * 3 + 1] = start[at + 1]!
      before[index * 3 + 2] = start[at + 2]!
      after[index * 3] = this.positions[at]!
      after[index * 3 + 1] = this.positions[at + 1]!
      after[index * 3 + 2] = this.positions[at + 2]!
    }
    return {
      indices: Int32Array.from(moved),
      before,
      after,
      ...(maskChanged && this.maskAtStart ? { maskBefore: this.maskAtStart, maskAfter: this.mask.slice() } : {}),
    }
  }

  /** The mesh as it stands: the same faces, the sculpted positions, and the mask it carries. */
  toMeshData(): MeshData {
    const vertices = this.base.vertices.slice()
    for (const index of this.moved) {
      vertices[index * 3] = this.positions[index * 3]!
      vertices[index * 3 + 1] = this.positions[index * 3 + 1]!
      vertices[index * 3 + 2] = this.positions[index * 3 + 2]!
    }
    const masked = this.mask.some((value) => value > 0)
    return {
      ...this.base,
      vertices,
      attributes: {
        ...this.base.attributes,
        vertex: masked
          ? { ...this.base.attributes.vertex, mask: [...this.mask] }
          : Object.fromEntries(Object.entries(this.base.attributes.vertex).filter(([key]) => key !== 'mask')),
      },
    }
  }
}

export { DRAGGING_BRUSHES, MASK_BRUSHES }
export type { SculptBrush }

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
}

/** Vertex to vertex, through the edges: what Smooth averages over. */
function buildAdjacency(mesh: MeshData, count: number): { start: Int32Array; count: Int32Array; list: Int32Array } {
  const lists: number[][] = Array.from({ length: count }, () => [])
  for (const [a, b] of mesh.edges) {
    if (a < count && b < count) {
      lists[a]!.push(b)
      lists[b]!.push(a)
    }
  }
  return flatten(lists)
}

/** Vertex to face, for the normals. */
function buildVertexFaces(mesh: MeshData, count: number): { start: Int32Array; count: Int32Array; list: Int32Array } {
  const lists: number[][] = Array.from({ length: count }, () => [])
  for (let face = 0; face < mesh.faces.length; face += 1) {
    for (const slot of mesh.faces[face]!) if (slot < count) lists[slot]!.push(face)
  }
  return flatten(lists)
}

function flatten(lists: number[][]): { start: Int32Array; count: Int32Array; list: Int32Array } {
  const start = new Int32Array(lists.length)
  const count = new Int32Array(lists.length)
  let total = 0
  for (let index = 0; index < lists.length; index += 1) {
    start[index] = total
    count[index] = lists[index]!.length
    total += lists[index]!.length
  }
  const list = new Int32Array(total)
  for (let index = 0; index < lists.length; index += 1) {
    for (let step = 0; step < lists[index]!.length; step += 1) list[start[index]! + step] = lists[index]![step]!
  }
  return { start, count, list }
}
