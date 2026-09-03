import { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Giving a surface a thickness: Solidify turns a sheet into a shell, Wireframe turns its edges into
 * bars. Both live in Blender's Face menu and both answer the same question — what does this become
 * when it has to be a real object rather than a surface — so they are written together.
 *
 * Solidify is exact. Wireframe is not: Blender mitres the tubes where they meet at a vertex so the
 * frame is one continuous shell, and this builds one closed box per edge instead, set back from
 * each end so the boxes do not grow through each other. The frame reads right and every piece of it
 * is closed and manifold; it is several solids rather than one, and the joints are not filled. That
 * is stated here, in the operator's description, and in the report on this prompt.
 */

const NO_FACES = 'No faces are selected.'
const NO_THICKNESS = 'A thickness of zero has nothing to build.'

/** Below this the shell's own normal and a face's have turned so far apart that evening out explodes. */
const EVEN_FLOOR = 0.2

/* -------------------------------------------------------------------- solidify */

/**
 * The direction a patch vertex is pushed along: the area-weighted average of the selected faces
 * around it, and not the mesh's own vertex normal — the faces that are not part of the selection
 * are not part of the shell, and letting them pull on the average tilts the shell away from the
 * surface it is meant to double.
 */
function patchNormals(target: EditTarget, faces: number[]): Map<number, Vec3> {
  const mesh = target.mesh
  const sums = new Map<number, Vec3>()
  for (const face of faces) {
    const weighted = scale(mesh.faceNormal(face), mesh.faceArea(face))
    for (const slot of mesh.faceVertices(face)) sums.set(slot, add(sums.get(slot) ?? [0, 0, 0], weighted))
  }
  const normals = new Map<number, Vec3>()
  for (const [slot, sum] of sums) normals.set(slot, length(sum) < 1e-12 ? [0, 0, 1] : normalize(sum))
  return normals
}

/**
 * How far to stretch each vertex's push so the shell keeps its thickness where the surface folds.
 * At a fold the averaged normal leans away from both faces, so a push of exactly the thickness
 * leaves the shell thinner than asked for; dividing by the cosine of that lean puts it back.
 */
function evenScales(target: EditTarget, faces: number[], normals: Map<number, Vec3>): Map<number, number> {
  const mesh = target.mesh
  const worst = new Map<number, number>()
  for (const face of faces) {
    const normal = mesh.faceNormal(face)
    for (const slot of mesh.faceVertices(face)) {
      const cosine = dot(normals.get(slot) ?? normal, normal)
      worst.set(slot, Math.min(worst.get(slot) ?? 1, cosine))
    }
  }
  const scales = new Map<number, number>()
  for (const [slot, cosine] of worst) scales.set(slot, 1 / Math.max(cosine, EVEN_FLOOR))
  return scales
}

function solidify(target: EditTarget, thickness: number, offset: number, even: boolean): EditOutcome {
  const mesh = target.mesh
  const faces = [...target.faces].sort((first, second) => first - second)
  if (faces.length === 0) return NO_FACES
  if (thickness === 0) return NO_THICKNESS
  const normals = patchNormals(target, faces)
  const scales = even ? evenScales(target, faces, normals) : new Map<number, number>()
  // Blender's offset says where the original surface sits between the two skins: −1 leaves it as
  // the outer one and grows the shell inwards, +1 does the opposite, 0 splits the difference.
  const outward = (thickness * (Math.min(1, Math.max(-1, offset)) + 1)) / 2
  const inward = outward - thickness
  const inner = new Map<number, number>()
  for (const [slot, normal] of normals) {
    const stretch = scales.get(slot) ?? 1
    const here = mesh.position(slot)
    inner.set(slot, mesh.addVertex(add(here, scale(normal, inward * stretch))))
  }
  for (const [slot, normal] of normals) {
    if (outward === 0) continue
    mesh.setPosition(slot, add(mesh.position(slot), scale(normal, outward * (scales.get(slot) ?? 1))))
  }
  const built: number[] = [...faces]
  for (const face of faces) {
    // The inner skin faces the other way, or the shell would be inside out along the bottom of it.
    const added = mesh.addFace([...mesh.faceVertices(face)].reverse().map((slot) => inner.get(slot)!))
    if (added < 0) continue
    mesh.copyFaceAttributes(face, added)
    built.push(added)
  }
  for (const loop of mesh.boundaryLoops(faces)) {
    for (let corner = 0; corner < loop.length; corner += 1) {
      const from = loop[corner]!
      const to = loop[(corner + 1) % loop.length]!
      // Wound against the rim rather than with it: the second skin went the other way, so a rim
      // quad that followed the first one would face into the shell.
      const added = mesh.addFace([from, inner.get(from)!, inner.get(to)!, to])
      if (added < 0) continue
      const edge = mesh.edgeSlot(from, to)
      const owner = edge < 0 ? -1 : (mesh.edgeFaces(edge).find((face) => target.faces.has(face)) ?? -1)
      if (owner >= 0) mesh.copyFaceAttributes(owner, added)
      built.push(added)
    }
  }
  return { select: { faces: built } }
}

registerOperator<{ thickness: number; offset: number; even: boolean }>({
  id: 'mesh.solidify',
  label: 'Solidify',
  section: 'Face',
  icon: 'modifier-solidify',
  description: 'Give the selected faces a thickness, with a second skin inside and a rim around it.',
  params: [
    numberParam('thickness', 'Thickness', { min: -100, max: 100, step: 0.01, defaultValue: 0.1, unit: 'm' }),
    numberParam('offset', 'Offset', { min: -1, max: 1, step: 0.01, defaultValue: -1, view: 'bar' }),
    switchParam('even', 'Even thickness', true),
  ],
  defaults: { thickness: 0.1, offset: -1, even: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => runOnMeshes(
    context,
    (target) => solidify(target, params.thickness, params.offset, params.even),
    { label: 'Solidify' },
  ),
})

/* ------------------------------------------------------------------- wireframe */

/** Any unit vector square to `along`, for an edge with no face to take its bearings from. */
function anyPerpendicular(along: Vec3): Vec3 {
  const axis: Vec3 = Math.abs(along[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  return normalize(cross(along, axis))
}

/** The two directions a tube's square section is measured along, the first following the surface. */
function section(mesh: EditMesh, edge: number, along: Vec3): [Vec3, Vec3] {
  const faces = mesh.edgeFaces(edge)
  let normal: Vec3 = [0, 0, 0]
  for (const face of faces) normal = add(normal, mesh.faceNormal(face))
  const flattened = subtract(normal, scale(along, dot(normal, along)))
  const up = length(flattened) < 1e-9 ? anyPerpendicular(along) : normalize(flattened)
  return [normalize(cross(along, up)), up]
}

/**
 * How far a tube stops short of the vertex at its end.
 *
 * Half the thickness is enough to keep two tubes meeting at a right angle out of each other. At a
 * sharper corner it is not, so `even` uses the setback a mitre would need — half the thickness over
 * the tangent of half the corner — which is what keeps a wire frame looking the same width all the
 * way round a triangle as it does around a square.
 */
function setback(mesh: EditMesh, vertex: number, along: Vec3, half: number, edges: Set<number>, even: boolean): number {
  let sharpest = Math.PI
  for (const other of mesh.vertexEdges(vertex)) {
    if (!edges.has(other)) continue
    const [a, b] = mesh.edgeVertices(other)
    const far = a === vertex ? b : a
    if (far < 0 || far === vertex) continue
    const away = normalize(subtract(mesh.position(far), mesh.position(vertex)))
    const angle = Math.acos(Math.min(1, Math.max(-1, dot(away, along))))
    if (angle < sharpest && angle > 1e-6) sharpest = angle
  }
  if (sharpest >= Math.PI - 1e-6) return 0
  if (!even) return half
  return half / Math.tan(sharpest / 2)
}

/** One closed box along an edge, wound outwards, and the slots of its six faces. */
function tube(mesh: EditMesh, edge: number, half: number, offset: number, edges: Set<number>, even: boolean): number[] {
  const [first, second] = mesh.edgeVertices(edge)
  const from = mesh.position(first)
  const to = mesh.position(second)
  const span = subtract(to, from)
  const reach = length(span)
  if (reach < 1e-9) return []
  const along = scale(span, 1 / reach)
  const [across, up] = section(mesh, edge, along)
  const start = Math.min(setback(mesh, first, along, half, edges, even), reach / 3)
  const end = Math.min(setback(mesh, second, scale(along, -1), half, edges, even), reach / 3)
  const shift = scale(up, offset * half)
  const rings = [start, reach - end].map((distance) => {
    const middle = add(add(from, scale(along, distance)), shift)
    return [
      add(add(middle, scale(across, half)), scale(up, half)),
      add(subtract(middle, scale(across, half)), scale(up, half)),
      subtract(subtract(middle, scale(across, half)), scale(up, half)),
      subtract(add(middle, scale(across, half)), scale(up, half)),
    ].map((point) => mesh.addVertex(point))
  })
  const [near, far] = rings as [number[], number[]]
  const built: number[] = []
  const centre = mesh.median([...near, ...far])
  const loops = [near, [...far].reverse()]
  for (let corner = 0; corner < 4; corner += 1) {
    loops.push([near[corner]!, near[(corner + 1) % 4]!, far[(corner + 1) % 4]!, far[corner]!])
  }
  for (const loop of loops) {
    const face = mesh.addFace(loop)
    if (face < 0) continue
    // A box is convex, so a face pointing back towards the middle of it is a face wound the wrong
    // way — cheaper and surer than reasoning about the section's handedness.
    if (dot(mesh.faceNormal(face), subtract(mesh.faceCentre(face), centre)) < 0) mesh.flipFace(face)
    built.push(face)
  }
  return built
}

function wireframe(
  target: EditTarget,
  options: { thickness: number; offset: number; replace: boolean; boundary: boolean; even: boolean },
): EditOutcome {
  const mesh = target.mesh
  if (options.thickness === 0) return NO_THICKNESS
  const wanted = new Set<number>()
  if (target.faces.size > 0) {
    for (const face of target.faces) for (const edge of mesh.faceEdges(face)) wanted.add(edge)
  } else if (target.edges.size > 0) {
    for (const edge of target.edges) wanted.add(edge)
  } else {
    const seeds = selectedVertices(target)
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const [a, b] = mesh.edgeVertices(edge)
      if (seeds.has(a) && seeds.has(b)) wanted.add(edge)
    }
  }
  if (wanted.size === 0) return 'Nothing is selected.'
  if (!options.boundary) {
    for (const edge of [...wanted]) if (mesh.edgeFaces(edge).length < 2) wanted.delete(edge)
    if (wanted.size === 0) return 'Every selected edge is on the rim, and Boundary is switched off.'
  }
  const half = Math.abs(options.thickness) / 2
  const minted: number[] = []
  for (const edge of [...wanted].sort((first, second) => first - second)) {
    minted.push(...tube(mesh, edge, half, options.offset, wanted, options.even))
  }
  if (minted.length === 0) return 'The selected edges are too short to make a wire of.'
  const kept = minted.map((face) => mesh.faceId(face))
  if (options.replace) {
    // The faces go first and the geometry nothing uses any more goes with them, so a replaced
    // wireframe leaves the wire and not the sheet it was cut from.
    mesh.remove({ faces: target.faces })
    mesh.dropLoose()
  }
  return { select: { faces: kept.map((id) => mesh.slotOfFace(id)).filter((slot) => slot >= 0) } }
}

registerOperator<{ thickness: number; offset: number; replace: boolean; boundary: boolean; even: boolean }>({
  id: 'mesh.wireframe',
  label: 'Wireframe',
  section: 'Face',
  icon: 'modifier-wireframe',
  description: 'Turn each selected edge into a square bar; the bars are separate solids, not mitred.',
  params: [
    numberParam('thickness', 'Thickness', { min: 0, max: 100, step: 0.01, defaultValue: 0.02, unit: 'm' }),
    numberParam('offset', 'Offset', { min: -1, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    switchParam('replace', 'Replace the faces', true),
    switchParam('boundary', 'Wire the rim too', true),
    switchParam('even', 'Even thickness', true),
  ],
  defaults: { thickness: 0.02, offset: 0, replace: true, boundary: true, even: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => wireframe(target, params), { label: 'Wireframe' }),
})
