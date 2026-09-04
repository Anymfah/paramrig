import { CHANNELS, colourDomain, cornerColours, domainSize, strideOf, type PaintDomain } from '@/scene/paint/attribute'
import { paintDab, smoothDab, type PaintBlend, type PaintDab, type PaintTargets, type Rgb } from '@/scene/paint/brush'
import { buildAdjacency, flatten } from '@/scene/sculpt/session'
import { PointGrid, cellSizeFor } from '@/scene/sculpt/grid'
import { loopStarts } from '@/scene/mesh/uv'
import { vertexNormals } from '@/scene/mesh/normals'
import type { MeshData, PaintState, Vec3 } from '@/scene/types'

/**
 * A vertex-paint session: the colours a stroke is written into, kept off the document.
 *
 * It is the sculpt session's twin and for the same reason. A stroke touches thousands of values
 * sixty times a second; writing a document per frame — a new mesh, a history entry, a React render —
 * would cost two orders of magnitude more than the painting. So the colours live here as a
 * `Float32Array`, the drawn geometry is written straight from it, and the document learns about the
 * whole stroke once, when the hand lets go.
 *
 * The geometry does not move, which is the one way this is simpler: the grid, the normals and the
 * adjacency are all built once and never rebuilt.
 */

export const DEFAULT_PAINT_STATE: PaintState = {
  brush: 'paint',
  colour: '#e05a3a',
  secondary: '#ffffff',
  size: 60,
  strength: 1,
  falloff: 'smooth',
  blend: 'mix',
  symmetry: { x: false, y: false, z: false },
  domain: 'corner',
}

export type PaintSettings = {
  colour: Rgb
  radius: number
  strength: number
  falloff: PaintState['falloff']
  blend: PaintBlend
  smoothing: boolean
  symmetry: { x: boolean; y: boolean; z: boolean }
}

export type PaintStep = { point: Vec3; normal: Vec3; pressure?: number }

/** The settings for one dab: what a person set, at the radius the brush has where it touches. */
export function paintSettings(state: PaintState, radius: number, options: { invert?: boolean; smoothing?: boolean } = {}): PaintSettings {
  return {
    colour: rgbOf(options.invert ? state.secondary : state.colour),
    radius,
    strength: state.strength,
    falloff: state.falloff,
    blend: state.blend,
    smoothing: options.smoothing === true || state.brush === 'blur',
    symmetry: state.symmetry,
  }
}

/** A `#rrggbb` as three numbers from nought to one. An unreadable colour paints white. */
export function rgbOf(colour: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(colour.trim())
  if (!match) return [1, 1, 1]
  const value = Number.parseInt(match[1]!, 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

export class PaintSession {
  readonly colours: Float32Array
  readonly domain: PaintDomain
  private base: MeshData
  private readonly positions: Float32Array
  private readonly normals: Float32Array
  private readonly adjacency: { start: Int32Array; count: Int32Array; list: Int32Array }
  private readonly slots: { start: Int32Array; count: Int32Array; list: Int32Array }
  private readonly grid: PointGrid
  private scratch: number[] = []
  private changed = false

  constructor(mesh: MeshData, domain: PaintDomain) {
    this.base = mesh
    this.domain = domain
    const count = mesh.vertexIds.length
    this.positions = new Float32Array(count * 3)
    for (let index = 0; index < count * 3; index += 1) this.positions[index] = mesh.vertices[index] ?? 0
    const normals = vertexNormals(mesh)
    this.normals = new Float32Array(count * 3)
    for (let index = 0; index < count * 3; index += 1) this.normals[index] = normals[index] ?? 0
    this.adjacency = buildAdjacency(mesh, count)
    this.slots = buildSlots(mesh, domain)
    this.colours = readColours(mesh, domain)
    this.grid = new PointGrid(this.positions, cellSizeFor(0.5))
  }

  get mesh(): MeshData {
    return this.base
  }

  rebase(mesh: MeshData): void {
    this.base = mesh
  }

  beginStroke(): void {
    this.changed = false
  }

  /** Whether the stroke changed anything, so an empty one leaves no step of history behind. */
  endStroke(): boolean {
    const changed = this.changed
    this.changed = false
    return changed
  }

  /**
   * One dab, with its mirrors.
   *
   * Symmetry mirrors the dab rather than pairing up values, exactly as sculpting does: a mirrored
   * brush is a brush at the mirrored place, and it needs no partner for a vertex that has none.
   */
  apply(step: PaintStep, settings: PaintSettings): void {
    const axes: Array<[number, number, number]> = [[1, 1, 1]]
    if (settings.symmetry.x) axes.push([-1, 1, 1])
    if (settings.symmetry.y) axes.push([1, -1, 1])
    if (settings.symmetry.z) axes.push([1, 1, -1])
    if (settings.symmetry.x && settings.symmetry.y) axes.push([-1, -1, 1])
    for (const axis of axes) this.dab(step, settings, axis)
  }

  private dab(step: PaintStep, settings: PaintSettings, axis: [number, number, number]): void {
    const centre: Vec3 = [step.point[0] * axis[0], step.point[1] * axis[1], step.point[2] * axis[2]]
    const indices = this.grid.near(this.positions, centre, settings.radius, this.scratch)
    if (indices.length === 0) return
    const targets: PaintTargets = {
      indices,
      positions: this.positions,
      origin: this.positions,
      measure: this.positions,
      normals: this.normals,
      mask: null,
      adjacency: this.adjacency,
      colours: this.colours,
      slots: this.slots,
    }
    const dab: PaintDab = {
      brush: 'draw',
      centre,
      normal: [step.normal[0] * axis[0], step.normal[1] * axis[1], step.normal[2] * axis[2]],
      radius: settings.radius,
      strength: settings.strength,
      falloff: settings.falloff,
      invert: false,
      delta: [0, 0, 0],
      pressure: step.pressure === undefined ? 1 : Math.max(0.05, Math.min(1, step.pressure * 2)),
      colour: settings.colour,
      blend: settings.blend,
    }
    if (settings.smoothing) smoothDab(dab, targets)
    else paintDab(dab, targets)
    this.changed = true
  }

  /** Every value set to one colour: what Fill does, and what a fresh attribute starts as. */
  fill(colour: Rgb): void {
    for (let index = 0; index < this.colours.length; index += CHANNELS) {
      this.colours[index] = colour[0]
      this.colours[index + 1] = colour[1]
      this.colours[index + 2] = colour[2]
    }
    this.changed = true
  }

  /** The mesh with the session's colours written onto the domain it is painting. */
  toMeshData(): MeshData {
    const attributes = {
      ...this.base.attributes,
      vertex: { ...this.base.attributes.vertex },
      loop: { ...this.base.attributes.loop },
    }
    const values = Array.from(this.colours)
    if (this.domain === 'corner') {
      attributes.loop.color = values
      delete attributes.vertex.color
    } else {
      attributes.vertex.color = values
      delete attributes.loop.color
    }
    return { ...this.base, attributes }
  }

  /** What the drawn geometry wants: one colour a corner, whichever domain is being painted. */
  cornerColours(): Float32Array {
    if (this.domain === 'corner') return this.colours
    const corners = domainSize(this.base, 'corner')
    const out = new Float32Array(corners * CHANNELS)
    const starts = loopStarts(this.base)
    this.base.faces.forEach((face, faceSlot) => {
      const start = starts[faceSlot] ?? 0
      face.forEach((slot, corner) => {
        const at = (start + corner) * CHANNELS
        for (let channel = 0; channel < CHANNELS; channel += 1) out[at + channel] = this.colours[slot * CHANNELS + channel] ?? 1
      })
    })
    return out
  }
}

/** Which values on the domain each vertex owns: itself, or every corner that uses it. */
function buildSlots(mesh: MeshData, domain: PaintDomain): { start: Int32Array; count: Int32Array; list: Int32Array } {
  const count = mesh.vertexIds.length
  if (domain === 'vertex') {
    return flatten(Array.from({ length: count }, (_, index) => [index]))
  }
  const lists: number[][] = Array.from({ length: count }, () => [])
  const starts = loopStarts(mesh)
  mesh.faces.forEach((face, faceSlot) => {
    const start = starts[faceSlot] ?? 0
    face.forEach((slot, corner) => {
      if (slot < count) lists[slot]!.push(start + corner)
    })
  })
  return flatten(lists)
}

/** The mesh's colours on the domain asked for, white where it carries none. */
function readColours(mesh: MeshData, domain: PaintDomain): Float32Array {
  if (domain === 'corner') {
    const stored = mesh.attributes.loop.color
    const out = cornerColours(mesh)
    if (stored) for (let index = 0; index < out.length && index < stored.length; index += 1) out[index] = stored[index] ?? 1
    return out
  }
  const count = mesh.vertexIds.length
  const out = new Float32Array(count * CHANNELS)
  out.fill(1)
  const stored = mesh.attributes.vertex.color
  if (stored) {
    const stride = strideOf(stored.length, count)
    for (let slot = 0; slot < count; slot += 1) {
      for (let channel = 0; channel < CHANNELS; channel += 1) out[slot * CHANNELS + channel] = stored[slot * stride + channel] ?? 1
    }
    return out
  }
  // A vertex domain over a mesh painted on its corners keeps what it can: the first corner of each.
  if (mesh.attributes.loop.color) {
    const corners = cornerColours(mesh)
    const starts = loopStarts(mesh)
    mesh.faces.forEach((face, faceSlot) => {
      const start = starts[faceSlot] ?? 0
      face.forEach((slot, corner) => {
        const at = (start + corner) * CHANNELS
        for (let channel = 0; channel < CHANNELS; channel += 1) out[slot * CHANNELS + channel] = corners[at + channel] ?? 1
      })
    })
  }
  return out
}

export { colourDomain }
