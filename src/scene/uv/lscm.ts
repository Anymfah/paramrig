import { islandVertices, type UvIsland } from '@/scene/uv/islands'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * Least squares conformal maps: the unwrapper behind U.
 *
 * A conformal map is one that keeps angles. No flattening of a curved surface can keep both angles
 * and areas — that is what curvature means — and of the two, angles are what a texture needs: a
 * checker that stays square is worth more than one that stays the same size. LSCM asks for the
 * flattening whose angles are least wrong overall, which turns out to be a linear least-squares
 * problem, and that is why it is fast enough to run while somebody drags a seam about.
 *
 * The method, briefly, because the code below is otherwise unreadable: each triangle is written in
 * its own plane, and the Cauchy-Riemann condition — that the map is angle-preserving there — is
 * written as two linear equations in the unknown u and v of its three corners. Every triangle
 * contributes its two rows; two corners are pinned to fix the one thing the equations cannot say
 * (where the piece is, how big it is, which way up), and the rest is solved in the least-squares
 * sense. The normal equations are symmetric and positive definite, so conjugate gradients solve
 * them without ever building a matrix: only the products A·x and Aᵀ·y are needed, and those are a
 * loop over triangles.
 *
 * What it does not do: it does not stop islands overlapping themselves. A shape that folds over —
 * a surface cut badly, or not cut at all — comes back folded, and Blender's own LSCM does the same.
 * The answer is a better seam, and `seamsFromIslands` is how one is found.
 */

export type LscmOptions = {
  /** How many conjugate-gradient steps at most; it converges long before this on real meshes. */
  iterations?: number
  /** Stop once the residual is this small, relative to the first one. */
  tolerance?: number
}

/**
 * One island flattened: two floats per corner of the island, in the order `islandLoops` gives.
 *
 * Null when the island has nothing to flatten — fewer than one triangle, or a piece so degenerate
 * that every triangle has no area. A caller that gets null leaves the island where it was.
 */
export function lscmUnwrap(mesh: MeshData, island: UvIsland, options: LscmOptions = {}): number[] | null {
  const { slots, cornerVertex } = islandVertices(mesh, island)
  if (slots.length < 3) return null
  const triangles = triangulateIsland(mesh, island, cornerVertex)
  if (triangles.length === 0) return null

  const pinned = choosePins(mesh, slots, triangles)
  if (!pinned) return null

  const count = slots.length
  /*
   * The unknowns are the u and v of every vertex, laid out as [u0, v0, u1, v1, …]. The pinned pair
   * are unknowns too, held in place by rows heavy enough that the solver will not move them; that
   * is simpler than eliminating them from the system, and on a least-squares problem of this size
   * the difference is not measurable.
   */
  const unknowns = count * 2
  const solution = new Float64Array(unknowns)
  seedFromProjection(mesh, slots, triangles, solution)
  solution[pinned.a * 2] = pinned.au
  solution[pinned.a * 2 + 1] = pinned.av
  solution[pinned.b * 2] = pinned.bu
  solution[pinned.b * 2 + 1] = pinned.bv

  const rows = triangles.length * 2 + 4
  /*
   * One triangle's two rows.
   *
   * Writing the map as a complex number per vertex, a triangle is conformal exactly when
   * `Σ W·u = 0`, where the three W come from the triangle's own plane. Splitting that into its real
   * and imaginary parts gives the two rows below; the weight divides by the triangle's area so that
   * a large face and a small one have the same say in the answer.
   */
  const apply = (x: Float64Array, out: Float64Array): void => {
    out.fill(0)
    let row = 0
    for (const triangle of triangles) {
      const [i, j, k] = triangle.corners
      const { wx, wy, weight } = triangle
      let real = 0
      let imaginary = 0
      const corners = [i, j, k] as const
      for (let index = 0; index < 3; index += 1) {
        const vertex = corners[index]!
        const a = x[vertex * 2]!
        const b = x[vertex * 2 + 1]!
        real += wx[index]! * a - wy[index]! * b
        imaginary += wy[index]! * a + wx[index]! * b
      }
      out[row] = real * weight
      out[row + 1] = imaginary * weight
      row += 2
    }
    out[row] = x[pinned.a * 2]! * PIN_WEIGHT
    out[row + 1] = x[pinned.a * 2 + 1]! * PIN_WEIGHT
    out[row + 2] = x[pinned.b * 2]! * PIN_WEIGHT
    out[row + 3] = x[pinned.b * 2 + 1]! * PIN_WEIGHT
  }

  const applyTranspose = (y: Float64Array, out: Float64Array): void => {
    out.fill(0)
    let row = 0
    for (const triangle of triangles) {
      const { wx, wy, weight } = triangle
      const real = y[row]! * weight
      const imaginary = y[row + 1]! * weight
      const corners = triangle.corners
      // The transpose of the two rows above: each unknown collects the coefficient it appeared with.
      for (let index = 0; index < 3; index += 1) {
        const vertex = corners[index]!
        out[vertex * 2] = (out[vertex * 2] ?? 0) + wx[index]! * real + wy[index]! * imaginary
        out[vertex * 2 + 1] = (out[vertex * 2 + 1] ?? 0) - wy[index]! * real + wx[index]! * imaginary
      }
      row += 2
    }
    out[pinned.a * 2] = (out[pinned.a * 2] ?? 0) + y[row]! * PIN_WEIGHT
    out[pinned.a * 2 + 1] = (out[pinned.a * 2 + 1] ?? 0) + y[row + 1]! * PIN_WEIGHT
    out[pinned.b * 2] = (out[pinned.b * 2] ?? 0) + y[row + 2]! * PIN_WEIGHT
    out[pinned.b * 2 + 1] = (out[pinned.b * 2 + 1] ?? 0) + y[row + 3]! * PIN_WEIGHT
  }

  const target = new Float64Array(rows)
  target[rows - 4] = pinned.au * PIN_WEIGHT
  target[rows - 3] = pinned.av * PIN_WEIGHT
  target[rows - 2] = pinned.bu * PIN_WEIGHT
  target[rows - 1] = pinned.bv * PIN_WEIGHT

  solveLeastSquares(solution, target, rows, unknowns, apply, applyTranspose, options)

  if (!solution.every((value) => Number.isFinite(value))) return null
  const uv: number[] = []
  for (const vertex of cornerVertex) uv.push(solution[vertex * 2]!, solution[vertex * 2 + 1]!)
  return uv
}

/** How hard a pin pulls, against a triangle's weight of one. Enough to hold, not enough to blow up. */
const PIN_WEIGHT = 100

type IslandTriangle = {
  /** Vertex indices within the island. */
  corners: [number, number, number]
  /** The real parts of the three complex coefficients, in corner order. */
  wx: [number, number, number]
  /** And the imaginary parts. */
  wy: [number, number, number]
  /** One over the square root of twice the area, so every triangle has the same say. */
  weight: number
}

/** Every face of the island as triangles, in the island's own vertex numbering. */
function triangulateIsland(mesh: MeshData, island: UvIsland, cornerVertex: number[]): IslandTriangle[] {
  const triangles: IslandTriangle[] = []
  let corner = 0
  for (const face of island.faces) {
    const loop = mesh.faces[face]!
    const first = corner
    for (let index = 1; index + 1 < loop.length; index += 1) {
      const a = cornerVertex[first]!
      const b = cornerVertex[first + index]!
      const c = cornerVertex[first + index + 1]!
      const frame = localFrame(
        vertexAt(mesh, loop[0]!),
        vertexAt(mesh, loop[index]!),
        vertexAt(mesh, loop[index + 1]!),
      )
      if (!frame) continue
      const { x1, x2, y2 } = frame
      // The triangle sits at (0, 0), (x1, 0) and (x2, y2); these are its three coefficients.
      triangles.push({
        corners: [a, b, c],
        wx: [x2 - x1, -x2, x1],
        wy: [y2, -y2, 0],
        weight: 1 / Math.sqrt(Math.max(1e-12, x1 * y2)),
      })
    }
    corner += loop.length
  }
  return triangles
}

/**
 * A triangle written in its own plane.
 *
 * The first edge becomes the x axis, and the third corner is placed by its distances to the other
 * two. Null when the three points are in a line: such a triangle has no plane of its own, and
 * nothing to say about angles.
 */
function localFrame(a: Vec3, b: Vec3, c: Vec3): { x1: number; x2: number; y2: number } | null {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const acx = c[0] - a[0]
  const acy = c[1] - a[1]
  const acz = c[2] - a[2]
  const x1 = Math.hypot(abx, aby, abz)
  if (x1 < 1e-12) return null
  const ex = abx / x1
  const ey = aby / x1
  const ez = abz / x1
  const x2 = acx * ex + acy * ey + acz * ez
  const perpX = acx - x2 * ex
  const perpY = acy - x2 * ey
  const perpZ = acz - x2 * ez
  const y2 = Math.hypot(perpX, perpY, perpZ)
  if (y2 < 1e-12) return null
  return { x1, x2, y2 }
}

/**
 * The two corners held in place.
 *
 * They should be as far apart as the island is wide: pinning two neighbours would leave the rest of
 * the piece free to spin about them, which a least-squares solver answers with a very large map.
 * The pair is found by taking the vertex furthest from the island's centre and then the one
 * furthest from that — the standard two-pass diameter, which is close enough and costs two passes.
 */
function choosePins(
  mesh: MeshData,
  slots: number[],
  triangles: IslandTriangle[],
): { a: number; b: number; au: number; av: number; bu: number; bv: number } | null {
  if (slots.length < 2 || triangles.length === 0) return null
  const centre: Vec3 = [0, 0, 0]
  for (const slot of slots) {
    const point = vertexAt(mesh, slot)
    centre[0] += point[0] / slots.length
    centre[1] += point[1] / slots.length
    centre[2] += point[2] / slots.length
  }
  const furthestFrom = (from: Vec3): number => {
    let best = 0
    let bestDistance = -1
    for (let index = 0; index < slots.length; index += 1) {
      const point = vertexAt(mesh, slots[index]!)
      const distance = Math.hypot(point[0] - from[0], point[1] - from[1], point[2] - from[2])
      if (distance > bestDistance) {
        bestDistance = distance
        best = index
      }
    }
    return best
  }
  const a = furthestFrom(centre)
  const b = furthestFrom(vertexAt(mesh, slots[a]!))
  if (a === b) return null
  const pointA = vertexAt(mesh, slots[a]!)
  const pointB = vertexAt(mesh, slots[b]!)
  const span = Math.max(1e-6, Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1], pointB[2] - pointA[2]))
  // The two pins are laid on the u axis a true distance apart, so the map comes out at the scale of
  // the surface rather than at whatever scale the solver finds cheapest.
  return { a, b, au: 0, av: 0, bu: span, bv: 0 }
}

/**
 * A starting guess, so the solver has less to do.
 *
 * The island projected onto the plane it faces most is already close to its flattening for anything
 * that is not deeply curved, and a good guess is worth more here than a clever solver.
 */
function seedFromProjection(mesh: MeshData, slots: number[], triangles: IslandTriangle[], out: Float64Array): void {
  let nx = 0
  let ny = 0
  let nz = 0
  for (const triangle of triangles) {
    const a = vertexAt(mesh, slots[triangle.corners[0]!]!)
    const b = vertexAt(mesh, slots[triangle.corners[1]!]!)
    const c = vertexAt(mesh, slots[triangle.corners[2]!]!)
    nx += (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])
    ny += (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    nz += (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  }
  const axis = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? 0 : Math.abs(ny) >= Math.abs(nz) ? 1 : 2
  const [first, second] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
  for (let index = 0; index < slots.length; index += 1) {
    const point = vertexAt(mesh, slots[index]!)
    out[index * 2] = point[first]!
    out[index * 2 + 1] = point[second]!
  }
}

/**
 * Conjugate gradients on the normal equations, matrix-free.
 *
 * AᵀA is symmetric and positive definite once the pins are in, which is exactly what conjugate
 * gradients want; and because only products are needed, the matrix — two rows per triangle over
 * twice as many unknowns as vertices — is never built. On a twenty thousand face island that is
 * the difference between a few megabytes of arithmetic and a few hundred.
 */
function solveLeastSquares(
  x: Float64Array,
  target: Float64Array,
  rows: number,
  unknowns: number,
  apply: (x: Float64Array, out: Float64Array) => void,
  applyTranspose: (y: Float64Array, out: Float64Array) => void,
  options: LscmOptions,
): void {
  const iterations = options.iterations ?? 200
  const tolerance = options.tolerance ?? 1e-8
  const scratchRows = new Float64Array(rows)
  const residual = new Float64Array(unknowns)
  const direction = new Float64Array(unknowns)
  const product = new Float64Array(unknowns)

  // r = Aᵀ(b − Ax)
  apply(x, scratchRows)
  for (let index = 0; index < rows; index += 1) scratchRows[index] = target[index]! - scratchRows[index]!
  applyTranspose(scratchRows, residual)
  direction.set(residual)
  let residualNorm = dot(residual, residual)
  const first = residualNorm
  if (first === 0) return

  for (let step = 0; step < iterations; step += 1) {
    apply(direction, scratchRows)
    applyTranspose(scratchRows, product)
    const denominator = dot(direction, product)
    if (!Number.isFinite(denominator) || denominator <= 0) return
    const alpha = residualNorm / denominator
    for (let index = 0; index < unknowns; index += 1) {
      x[index] = x[index]! + alpha * direction[index]!
      residual[index] = residual[index]! - alpha * product[index]!
    }
    const next = dot(residual, residual)
    if (next <= first * tolerance) return
    const beta = next / residualNorm
    residualNorm = next
    for (let index = 0; index < unknowns; index += 1) direction[index] = residual[index]! + beta * direction[index]!
  }
}

function dot(a: Float64Array, b: Float64Array): number {
  let total = 0
  for (let index = 0; index < a.length; index += 1) total += a[index]! * b[index]!
  return total
}

function vertexAt(mesh: MeshData, slot: number): Vec3 {
  return [mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0]
}
