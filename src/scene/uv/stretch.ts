import { loopStarts } from '@/scene/mesh/uv'
import type { MeshData, Vec2, Vec3 } from '@/scene/types'

/**
 * UV distortion: measuring how badly a map treats the surface under it, and easing it.
 *
 * Two measures, the pair Blender draws as its stretch overlays. Area asks whether a face is given
 * its fair share of the image; angle asks whether the corners it is given are the corners it has.
 * Both are relative on purpose — a map has no natural scale, so doubling every UV changes neither,
 * and a map that is uniformly stretched reads as undistorted here exactly as it does in Blender.
 * The way to see a scaling, therefore, is that it is not uniform: it is one part of the map taking
 * the image from another, and both measures are about that.
 *
 * `minimizeStretch` is a Laplacian-style local relaxation, not Blender's own solver (SLIM, with
 * ABF behind Unwrap). Each corner is pulled towards the place its two neighbours' UVs say it
 * belongs if its triangle kept the shape it has in 3D, and the passes carry that around the island.
 * It is a fraction of the work and it settles quickly on a developable surface, but it is worse in
 * ways worth naming before anybody relies on it: it has no global step, so an island laid out
 * wrongly as a whole is nudged rather than re-laid; it neither sees nor repairs an overlap or a
 * fold, because it never looks at more than one triangle at a time; on a surface that cannot be
 * flattened it settles into whichever local minimum it started nearest, so the answer depends on
 * the map it was given; and it optimises shape alone, so area stretch falls only as far as fixing
 * the shapes happens to carry it — on some maps it rises for the first few passes and needs a few
 * dozen before it is better by that measure than it started.
 *
 * Corner angles are compared unsigned, so a map that is mirrored or turned round reads as fitting
 * — which is right, both are isometries — and a reflex corner reads as its explement.
 */

/** Which distortion is being measured: the share of the image a face gets, or the corners it gets. */
export type StretchKind = 'angle' | 'area'

/**
 * Below this a length, an area or a share is nothing, and the answer computed from it would be
 * floating-point noise rather than a measurement.
 */
const NOTHING = 1e-12

/**
 * Per-face distortion, 0 to 1, where 0 is undistorted.
 *
 * 'area': how far the face's share of the UV area is from its share of the surface area.
 * 'angle': how far the corner angles in UV space are from the corner angles in 3D.
 */
export function faceStretch(mesh: MeshData, uv: number[], kind: StretchKind): number[] {
  return kind === 'area' ? areaStretch(mesh, uv) : angleStretch(mesh, uv)
}

/** The whole map in one number, area-weighted: what a status bar would show. */
export function meshStretch(mesh: MeshData, uv: number[], kind: StretchKind): number {
  const perFace = faceStretch(mesh, uv, kind)
  if (perFace.length === 0) return 0
  const areas = mesh.faces.map((face) => surfaceArea(mesh, face))
  const total = areas.reduce((sum, area) => sum + area, 0)
  /*
   * Weighting by surface area is what makes the number mean anything: a map is bad in proportion to
   * how much of the model it spoils, not to how many faces it spoils. A mesh with no area at all
   * has no weights to give, and there the plain mean is the only honest answer.
   */
  if (total <= NOTHING) return perFace.reduce((sum, value) => sum + value, 0) / perFace.length
  let weighted = 0
  for (let face = 0; face < perFace.length; face += 1) weighted += perFace[face]! * areas[face]!
  return weighted / total
}

export type RelaxOptions = {
  /** How many passes. Blender's default is a few dozen; each is cheap. Default 10. */
  iterations?: number
  /** How far a corner moves towards its suggestion each pass, 0 to 1. Default 0.5. */
  step?: number
  /** Corners that must not move: loop indices. Pinned corners are what keeps a map in place. */
  pinned?: Set<number>
}

/**
 * A relaxed copy of the map: corners pulled towards where their edge lengths say they should be.
 *
 * Corners that share a vertex and a UV are one point and move together; corners that share a vertex
 * but not a UV are two points and stay two. That grouping is read once, from the map handed in, so
 * relaxing never welds a seam shut and never tears one open — it only moves what is already there.
 */
export function minimizeStretch(mesh: MeshData, uv: number[], options: RelaxOptions = {}): number[] {
  const starts = loopStarts(mesh)
  const loops = starts[mesh.faces.length] ?? 0
  const data = new Array<number>(loops * 2)
  for (let loop = 0; loop < loops; loop += 1) {
    data[loop * 2] = finite(uv[loop * 2])
    data[loop * 2 + 1] = finite(uv[loop * 2 + 1])
  }
  const iterations = Math.max(0, Math.min(1000, Math.floor(options.iterations ?? 10)))
  const step = Math.max(0, Math.min(1, options.step ?? 0.5))
  if (loops === 0 || iterations === 0 || step === 0) return data

  const points = weldPoints(mesh, starts, data, options.pinned)
  // One tally per UV point, reused pass after pass: every corner of every face votes for where the
  // point it belongs to should be, and the point goes a fraction of the way towards what it heard.
  const tallies = points.members.map(() => ({ x: 0, y: 0, votes: 0 }))

  for (let pass = 0; pass < iterations; pass += 1) {
    for (const tally of tallies) {
      tally.x = 0
      tally.y = 0
      tally.votes = 0
    }
    for (let face = 0; face < mesh.faces.length; face += 1) {
      const slots = mesh.faces[face]!
      if (slots.length < 3) continue
      const start = starts[face]!
      for (let corner = 0; corner < slots.length; corner += 1) {
        const before = (corner + slots.length - 1) % slots.length
        const after = (corner + 1) % slots.length
        const suggestion = fitCorner(
          vertexAt(mesh, slots[before]!), vertexAt(mesh, slots[corner]!), vertexAt(mesh, slots[after]!),
          readUv(data, start + before), readUv(data, start + corner), readUv(data, start + after),
        )
        if (suggestion === null) continue
        const tally = tallies[points.of[start + corner]!]!
        tally.x += suggestion[0]
        tally.y += suggestion[1]
        tally.votes += 1
      }
    }
    for (let point = 0; point < tallies.length; point += 1) {
      const tally = tallies[point]!
      if (tally.votes === 0 || points.pinned[point] === true) continue
      const members = points.members[point]!
      const from = members[0]!
      const wasX = data[from * 2]!
      const wasY = data[from * 2 + 1]!
      const x = wasX + (tally.x / tally.votes - wasX) * step
      const y = wasY + (tally.y / tally.votes - wasY) * step
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      for (const loop of members) {
        data[loop * 2] = x
        data[loop * 2 + 1] = y
      }
    }
  }
  return data
}

/* ------------------------------------------------------------------ measuring */

function areaStretch(mesh: MeshData, uv: number[]): number[] {
  const starts = loopStarts(mesh)
  const surface = mesh.faces.map((face) => surfaceArea(mesh, face))
  const image = mesh.faces.map((face, index) => imageArea(uv, starts[index]!, face.length))
  const totalSurface = surface.reduce((sum, area) => sum + area, 0)
  const totalImage = image.reduce((sum, area) => sum + area, 0)
  // A mesh with no area gives no shares to compare; a map with none has failed everywhere at once.
  if (totalSurface <= NOTHING) return mesh.faces.map(() => 0)
  if (totalImage <= NOTHING) return mesh.faces.map(() => 1)
  return mesh.faces.map((_, index) => {
    const wanted = surface[index]! / totalSurface
    const given = image[index]! / totalImage
    if (wanted <= NOTHING && given <= NOTHING) return 0
    if (wanted <= NOTHING || given <= NOTHING) return 1
    const ratio = given / wanted
    /*
     * Folded so that a face given half the image it wants and a face given twice are equally wrong.
     * The bare ratio is lopsided — a half is 0.5 from one and a double is 1.0 — and an overlay
     * colour that shouted about crowding and whispered about waste would be reporting the arithmetic
     * rather than the fault.
     */
    return 1 - Math.min(ratio, 1 / ratio)
  })
}

function angleStretch(mesh: MeshData, uv: number[]): number[] {
  const starts = loopStarts(mesh)
  return mesh.faces.map((face, index) => {
    const start = starts[index]!
    let total = 0
    let counted = 0
    for (let corner = 0; corner < face.length; corner += 1) {
      const before = (corner + face.length - 1) % face.length
      const after = (corner + 1) % face.length
      const wanted = angleBetween(
        vertexAt(mesh, face[before]!), vertexAt(mesh, face[corner]!), vertexAt(mesh, face[after]!),
      )
      // A corner the mesh itself has collapsed says nothing about the map, so it is left out.
      if (wanted === null) continue
      const given = angleBetween2d(
        readUv(uv, start + before), readUv(uv, start + corner), readUv(uv, start + after),
      )
      // A corner whose UVs sit on top of each other has no angle: the map has lost the face there.
      total += given === null ? Math.PI : Math.abs(given - wanted)
      counted += 1
    }
    // Both angles lie in [0, π], so the mean disagreement over π is already the 0-to-1 the caller wants.
    return counted === 0 ? 0 : total / (counted * Math.PI)
  })
}

/** Newell's area, which is right for an n-gon that is not quite flat. */
function surfaceArea(mesh: MeshData, face: number[]): number {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < face.length; index += 1) {
    const a = vertexAt(mesh, face[index]!)
    const b = vertexAt(mesh, face[(index + 1) % face.length]!)
    x += (a[1] - b[1]) * (a[2] + b[2])
    y += (a[2] - b[2]) * (a[0] + b[0])
    z += (a[0] - b[0]) * (a[1] + b[1])
  }
  return Math.hypot(x, y, z) / 2
}

/** The shoelace area of one face's corners in the map, unsigned so that a mirrored face still counts. */
function imageArea(uv: number[], start: number, length: number): number {
  let twice = 0
  for (let corner = 0; corner < length; corner += 1) {
    const a = readUv(uv, start + corner)
    const b = readUv(uv, start + ((corner + 1) % length))
    twice += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(twice) / 2
}

function angleBetween(before: Vec3, corner: Vec3, after: Vec3): number | null {
  const ax = before[0] - corner[0]
  const ay = before[1] - corner[1]
  const az = before[2] - corner[2]
  const bx = after[0] - corner[0]
  const by = after[1] - corner[1]
  const bz = after[2] - corner[2]
  if (Math.hypot(ax, ay, az) <= NOTHING || Math.hypot(bx, by, bz) <= NOTHING) return null
  const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
  // atan2 of the cross against the dot, rather than acos of the dot, which loses its footing near 0 and π.
  return Math.atan2(cross, ax * bx + ay * by + az * bz)
}

function angleBetween2d(before: Vec2, corner: Vec2, after: Vec2): number | null {
  const ax = before[0] - corner[0]
  const ay = before[1] - corner[1]
  const bx = after[0] - corner[0]
  const by = after[1] - corner[1]
  if (Math.hypot(ax, ay) <= NOTHING || Math.hypot(bx, by) <= NOTHING) return null
  return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by)
}

/* ------------------------------------------------------------------ relaxing */

type UvPoints = {
  /** Which point each loop belongs to. */
  of: number[]
  /** The loops of each point, which all carry its UV. */
  members: number[][]
  /** A point holding any pinned loop is itself pinned: moving it would move the pinned corner. */
  pinned: boolean[]
}

function weldPoints(mesh: MeshData, starts: number[], data: number[], pinned?: Set<number>): UvPoints {
  const index = new Map<string, number>()
  const of: number[] = []
  const members: number[][] = []
  const isPinned: boolean[] = []
  for (let face = 0; face < mesh.faces.length; face += 1) {
    const slots = mesh.faces[face]!
    for (let corner = 0; corner < slots.length; corner += 1) {
      const loop = starts[face]! + corner
      // Welded by vertex and by position to a millionth: a projection writes the same expression
      // for two corners of one vertex, and a seam is exactly where it does not.
      const key = `${slots[corner]}|${Math.round(data[loop * 2]! * 1e6)}|${Math.round(data[loop * 2 + 1]! * 1e6)}`
      let at = index.get(key)
      if (at === undefined) {
        at = members.length
        index.set(key, at)
        members.push([])
        isPinned.push(false)
      }
      of[loop] = at
      members[at]!.push(loop)
      if (pinned?.has(loop) === true) isPinned[at] = true
    }
  }
  return { of, members, pinned: isPinned }
}

/**
 * Where a corner would sit if its triangle in the map had the shape it has on the surface.
 *
 * The two neighbours are taken where they are and the corner is placed against them, so the fit
 * carries the 3D triangle's proportions rather than its size — the map's scale is nobody's business
 * but the person packing it. The side of the base to place it on is read from where the corner
 * already is, so that a mirrored island stays mirrored instead of being flipped back by the solver.
 */
function fitCorner(before: Vec3, corner: Vec3, after: Vec3, a: Vec2, current: Vec2, b: Vec2): Vec2 | null {
  const baseX = after[0] - before[0]
  const baseY = after[1] - before[1]
  const baseZ = after[2] - before[2]
  const base = Math.hypot(baseX, baseY, baseZ)
  if (base <= NOTHING) return null
  const armX = corner[0] - before[0]
  const armY = corner[1] - before[1]
  const armZ = corner[2] - before[2]
  const along = (armX * baseX + armY * baseY + armZ * baseZ) / base
  const across = Math.sqrt(Math.max(0, armX * armX + armY * armY + armZ * armZ - along * along))
  const alongBase = along / base
  const acrossBase = across / base

  const spanX = b[0] - a[0]
  const spanY = b[1] - a[1]
  if (Math.hypot(spanX, spanY) <= NOTHING) return null
  const side = spanX * (current[1] - a[1]) - spanY * (current[0] - a[0]) < 0 ? -1 : 1
  const x = a[0] + alongBase * spanX - side * acrossBase * spanY
  const y = a[1] + alongBase * spanY + side * acrossBase * spanX
  // A fit that does not land on a real number is no suggestion at all, and the corner keeps its place.
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

/* -------------------------------------------------------------------- reading */

function vertexAt(mesh: MeshData, slot: number): Vec3 {
  return [
    finite(mesh.vertices[slot * 3]),
    finite(mesh.vertices[slot * 3 + 1]),
    finite(mesh.vertices[slot * 3 + 2]),
  ]
}

/** A corner's UV, with a missing or unreal one read as the origin so that no measure returns NaN. */
function readUv(uv: number[], loop: number): Vec2 {
  return [finite(uv[loop * 2]), finite(uv[loop * 2 + 1])]
}

function finite(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0
}
