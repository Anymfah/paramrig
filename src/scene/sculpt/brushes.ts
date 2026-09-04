import { falloff, type FalloffKind } from '@/scene/transform/proportional'
export type { SculptBrush }
import type { SculptBrush, Vec3 } from '@/scene/types'

/**
 * The brushes: what one dab of each does to the vertices under it.
 *
 * Every one of them is the same function — given the vertices in range, their distances, and the
 * dab's own frame, move them — so a brush is a case in one switch rather than a class, and the
 * session that drives them knows nothing about which brush is running.
 *
 * Two families, and the difference matters. Most brushes *accumulate*: each dab moves the vertices
 * from where the last dab left them, which is what makes a slow stroke deeper than a fast one.
 * Grab, Snake hook, Thumb, Rotate and Elastic deform instead work from where the vertices were when
 * the stroke *began*, because they are dragging the surface rather than painting on it — a grab
 * that accumulated would run away from the pointer.
 */


/**
 * Brushes measured from where the stroke began rather than from the last dab.
 *
 * Grab holds the surface: wherever the pointer is, the surface is that far from where it started,
 * and holding still holds it still. Snake hook and Nudge are the other kind — they take the
 * movement of each dab and add it, which is what draws a tentacle out of a lump rather than pulling
 * the lump about.
 */
export const DRAGGING_BRUSHES: ReadonlySet<SculptBrush> = new Set<SculptBrush>([
  'grab', 'elastic', 'thumb', 'rotate',
])

/** Brushes that write the mask rather than the shape. */
export const MASK_BRUSHES: ReadonlySet<SculptBrush> = new Set<SculptBrush>(['mask'])

/**
 * How far a full-strength dab moves a vertex, as a fraction of the brush radius.
 *
 * Blender's dabs are small and many — a stroke is dozens of them — so one dab has to be a small
 * fraction of the radius or a single click would dent a mesh by its whole width. A tenth is the
 * figure that makes a slow stroke feel like Blender's.
 */
export const DAB_SCALE = 0.1

export type BrushDab = {
  brush: SculptBrush
  /** Where the dab is, in the object's own space. */
  centre: Vec3
  /** The surface normal there, which is the direction Draw pushes along. */
  normal: Vec3
  radius: number
  /** 0 to 2; 1 is a full-strength brush. */
  strength: number
  falloff: FalloffKind
  /** Control reverses a brush: Draw digs, Inflate deflates, Mask erases. */
  invert: boolean
  /** How far the pointer moved since the last dab, in the object's own space. */
  delta: Vec3
  /** Tablet pressure, 0 to 1; a mouse reports 0.5 and is treated as full. */
  pressure: number
}

export type BrushTargets = {
  /** The vertices in range, by slot. */
  indices: number[]
  /** Where they are now; written in place. */
  positions: Float32Array
  /** Where they were when the stroke began, for the dragging brushes. */
  origin: Float32Array
  /**
   * The positions distances are measured against.
   *
   * The same as `positions` for a brush that paints, and `origin` for one that drags: a grab whose
   * weights were measured against the surface it is moving would pull harder the further it went,
   * because the vertices it is dragging are getting closer to the middle of its own brush.
   */
  measure: Float32Array
  /** Vertex normals, for Inflate and for the surface-following brushes. */
  normals: Float32Array
  /** 0 to 1 per vertex, where 1 is fully masked and does not move. Null when nothing is masked. */
  mask: Float32Array | null
  /** Neighbour slots per vertex, for Smooth: a flat list with a start and a count each. */
  adjacency: { start: Int32Array; count: Int32Array; list: Int32Array }
}

/** The plane a dab flattens towards: the average place and the average normal under the brush. */
export type SculptPlane = { point: Vec3; normal: Vec3 }

/**
 * The plane under a dab.
 *
 * Blender calls this the area plane, and Flatten, Fill, Scrape and Clay are all defined against it:
 * it is the surface as it is, and they move the surface towards it. Weighted by the falloff, so the
 * plane belongs to the middle of the brush rather than to its rim.
 */
export function areaPlane(dab: BrushDab, targets: BrushTargets): SculptPlane {
  let px = 0
  let py = 0
  let pz = 0
  let nx = 0
  let ny = 0
  let nz = 0
  let total = 0
  for (const index of targets.indices) {
    const weight = dabWeight(dab, targets, index)
    if (weight <= 0) continue
    px += targets.positions[index * 3]! * weight
    py += targets.positions[index * 3 + 1]! * weight
    pz += targets.positions[index * 3 + 2]! * weight
    nx += targets.normals[index * 3]! * weight
    ny += targets.normals[index * 3 + 1]! * weight
    nz += targets.normals[index * 3 + 2]! * weight
    total += weight
  }
  if (total <= 0) return { point: [...dab.centre], normal: [...dab.normal] }
  const length = Math.hypot(nx, ny, nz)
  return {
    point: [px / total, py / total, pz / total],
    normal: length > 1e-9 ? [nx / length, ny / length, nz / length] : [...dab.normal],
  }
}

/** How much of the dab a vertex gets: the falloff, less the mask, times the pressure. */
export function dabWeight(dab: BrushDab, targets: BrushTargets, index: number): number {
  const dx = targets.measure[index * 3]! - dab.centre[0]
  const dy = targets.measure[index * 3 + 1]! - dab.centre[1]
  const dz = targets.measure[index * 3 + 2]! - dab.centre[2]
  const distance = Math.hypot(dx, dy, dz)
  if (distance > dab.radius) return 0
  const shape = falloff(dab.falloff, dab.radius <= 0 ? 1 : distance / dab.radius, index)
  const masked = targets.mask ? 1 - Math.min(1, Math.max(0, targets.mask[index] ?? 0)) : 1
  return shape * masked * dab.pressure
}

/**
 * One dab, applied.
 *
 * The positions are written in place: a brush that returned a new array would allocate six hundred
 * thousand numbers per frame on a heavy mesh, which is the whole frame.
 */
export function applyDab(dab: BrushDab, targets: BrushTargets): void {
  if (dab.brush === 'mask') {
    applyMask(dab, targets)
    return
  }
  const sign = dab.invert ? -1 : 1
  const amount = dab.strength * DAB_SCALE * dab.radius * sign
  const plane = needsPlane(dab.brush) ? areaPlane(dab, targets) : null
  for (const index of targets.indices) {
    const weight = dabWeight(dab, targets, index)
    if (weight <= 0) continue
    moveOne(dab, targets, index, weight, amount, sign, plane)
  }
}

function needsPlane(brush: SculptBrush): boolean {
  return brush === 'flatten' || brush === 'fill' || brush === 'scrape' || brush === 'clay' || brush === 'clay-strips' || brush === 'thumb' || brush === 'nudge'
}

function applyMask(dab: BrushDab, targets: BrushTargets): void {
  const mask = targets.mask
  if (!mask) return
  const step = dab.strength * 0.1 * (dab.invert ? -1 : 1)
  for (const index of targets.indices) {
    const weight = dabWeight({ ...dab, invert: false }, { ...targets, mask: null }, index)
    if (weight <= 0) continue
    mask[index] = Math.min(1, Math.max(0, (mask[index] ?? 0) + step * weight))
  }
}

function moveOne(
  dab: BrushDab,
  targets: BrushTargets,
  index: number,
  weight: number,
  amount: number,
  sign: number,
  plane: SculptPlane | null,
): void {
  const { positions, origin, normals } = targets
  const at = index * 3
  const px = positions[at]!
  const py = positions[at + 1]!
  const pz = positions[at + 2]!
  const write = (x: number, y: number, z: number): void => {
    positions[at] = x
    positions[at + 1] = y
    positions[at + 2] = z
  }
  switch (dab.brush) {
    case 'draw':
    case 'draw-sharp': {
      const shaped = dab.brush === 'draw-sharp' ? weight * weight * weight : weight
      write(px + dab.normal[0] * amount * shaped, py + dab.normal[1] * amount * shaped, pz + dab.normal[2] * amount * shaped)
      return
    }
    case 'inflate': {
      write(px + normals[at]! * amount * weight, py + normals[at + 1]! * amount * weight, pz + normals[at + 2]! * amount * weight)
      return
    }
    case 'blob': {
      // Outwards from the dab's own centre rather than along the surface: a bulge, not a coat.
      const dx = px - dab.centre[0]
      const dy = py - dab.centre[1]
      const dz = pz - dab.centre[2]
      const length = Math.hypot(dx, dy, dz) || 1
      write(px + (dx / length) * amount * weight, py + (dy / length) * amount * weight, pz + (dz / length) * amount * weight)
      return
    }
    case 'crease': {
      // Pinched towards the middle and pushed in: the pair is what makes a crease a crease.
      const pull = weight * 0.5
      const inward = amount * weight
      write(
        px + (dab.centre[0] - px) * pull - dab.normal[0] * inward,
        py + (dab.centre[1] - py) * pull - dab.normal[1] * inward,
        pz + (dab.centre[2] - pz) * pull - dab.normal[2] * inward,
      )
      return
    }
    case 'smooth': {
      const { start, count, list } = targets.adjacency
      const first = start[index] ?? 0
      const many = count[index] ?? 0
      if (many === 0) return
      let ax = 0
      let ay = 0
      let az = 0
      for (let step = 0; step < many; step += 1) {
        const other = list[first + step]!
        ax += positions[other * 3]!
        ay += positions[other * 3 + 1]!
        az += positions[other * 3 + 2]!
      }
      const pull = Math.min(1, Math.abs(dab.strength) * weight)
      write(px + (ax / many - px) * pull, py + (ay / many - py) * pull, pz + (az / many - pz) * pull)
      return
    }
    case 'flatten':
    case 'fill':
    case 'scrape':
    case 'clay':
    case 'clay-strips': {
      if (!plane) return
      const dx = px - plane.point[0]
      const dy = py - plane.point[1]
      const dz = pz - plane.point[2]
      const above = dx * plane.normal[0] + dy * plane.normal[1] + dz * plane.normal[2]
      // Fill only lifts what is below the plane; Scrape only cuts what is above it.
      if (dab.brush === 'fill' && above > 0) return
      if (dab.brush === 'scrape' && above < 0) return
      // Clay works towards a plane raised by the dab, which is what makes it build up rather than
      // level off; the strips variety is the same with a squarer footprint, which the falloff gives.
      const offset = dab.brush === 'clay' || dab.brush === 'clay-strips' ? amount : 0
      const pull = Math.min(1, Math.abs(dab.strength) * weight)
      const target = above - offset
      write(
        px - plane.normal[0] * target * pull,
        py - plane.normal[1] * target * pull,
        pz - plane.normal[2] * target * pull,
      )
      return
    }
    case 'pinch': {
      const pull = weight * Math.abs(dab.strength) * 0.5 * sign
      write(px + (dab.centre[0] - px) * pull, py + (dab.centre[1] - py) * pull, pz + (dab.centre[2] - pz) * pull)
      return
    }
    case 'grab': {
      // From where the stroke found them, so the surface follows the hand rather than running away.
      write(
        origin[at]! + dab.delta[0] * weight,
        origin[at + 1]! + dab.delta[1] * weight,
        origin[at + 2]! + dab.delta[2] * weight,
      )
      return
    }
    case 'snake-hook': {
      // From where they are, by this dab's own movement: the brush walks and the surface follows
      // it, which is what pulls a spike out of a shape rather than sliding the shape along.
      write(px + dab.delta[0] * weight, py + dab.delta[1] * weight, pz + dab.delta[2] * weight)
      return
    }
    case 'elastic': {
      /*
       * An approximation, and a named one: Blender's elastic deform solves a Kelvinlet — a closed
       * form of how an elastic solid answers a poke — which spreads the pull far beyond the brush
       * with a shape no falloff curve has. This uses the falloff squared over three times the
       * radius, which has the same look at the middle and a softer, shorter tail.
       */
      const dx = origin[at]! - dab.centre[0]
      const dy = origin[at + 1]! - dab.centre[1]
      const dz = origin[at + 2]! - dab.centre[2]
      const distance = Math.hypot(dx, dy, dz)
      const reach = dab.radius * 3
      const soft = distance >= reach ? 0 : (1 - distance / reach) ** 2
      write(origin[at]! + dab.delta[0] * soft, origin[at + 1]! + dab.delta[1] * soft, origin[at + 2]! + dab.delta[2] * soft)
      return
    }
    case 'thumb':
    case 'nudge': {
      // Along the surface rather than through it: the movement with its normal component removed.
      const normal = plane?.normal ?? dab.normal
      const through = dab.delta[0] * normal[0] + dab.delta[1] * normal[1] + dab.delta[2] * normal[2]
      const ax = dab.delta[0] - normal[0] * through
      const ay = dab.delta[1] - normal[1] * through
      const az = dab.delta[2] - normal[2] * through
      if (dab.brush === 'thumb') {
        write(origin[at]! + ax * weight, origin[at + 1]! + ay * weight, origin[at + 2]! + az * weight)
      } else {
        write(px + ax * weight, py + ay * weight, pz + az * weight)
      }
      return
    }
    case 'rotate': {
      // Turned about the dab's normal, by an angle the caller has put in the delta's first number.
      const angle = dab.delta[0] * weight
      const [nx, ny, nz] = dab.normal
      const dx = origin[at]! - dab.centre[0]
      const dy = origin[at + 1]! - dab.centre[1]
      const dz = origin[at + 2]! - dab.centre[2]
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const dot = dx * nx + dy * ny + dz * nz
      write(
        dab.centre[0] + dx * cos + (ny * dz - nz * dy) * sin + nx * dot * (1 - cos),
        dab.centre[1] + dy * cos + (nz * dx - nx * dz) * sin + ny * dot * (1 - cos),
        dab.centre[2] + dz * cos + (nx * dy - ny * dx) * sin + nz * dot * (1 - cos),
      )
      return
    }
    default:
      return
  }
}
