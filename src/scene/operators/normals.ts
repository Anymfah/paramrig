import type { EditMesh } from '@/scene/mesh/editMesh'
import { dot, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import {
  numberParam,
  selectParam,
  switchParam,
  vectorParam,
  type OperatorContext,
  type OperatorResult,
} from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Blender’s Mesh → Normals, its shading pair, and the four edge attributes.
 *
 * Everything here changes how a surface is *read* rather than where it is: which way a face is
 * wound, whether its shading blends into its neighbours, and the four flags an edge carries —
 * seam, sharp, crease and bevel weight. Not one of these operators moves a vertex, adds one or
 * removes one, so every one of them leaves the selection exactly as it found it.
 *
 * Two decisions run through the file. A recalculated winding is decided once per connected patch,
 * from the face reaching furthest out along its own normal, and then propagated across the patch by
 * the rule that two neighbours wound the same way traverse their shared edge in opposite
 * directions — a local test, so the answer costs one walk rather than a ray cast per face. And
 * `MeshData` stores no custom split normals: it has a smooth flag per face and a sharp flag per
 * edge, and nothing per corner. So the three operators Blender writes into custom normals — set
 * from faces, point to target, average — are written into the winding and the shading flags
 * instead, which is the part of their effect this mesh can carry. Each says so where it is
 * declared, and the report to the lead says so too.
 */

/* ------------------------------------------------------------- recalculate */

/** The selected faces grouped into the patches that touch edge to edge. */
function facePatches(mesh: EditMesh, faces: Set<number>): number[][] {
  const seen = new Set<number>()
  const patches: number[][] = []
  for (const start of [...faces].sort((a, b) => a - b)) {
    if (seen.has(start)) continue
    const patch = [start]
    seen.add(start)
    for (let index = 0; index < patch.length; index += 1) {
      for (const edge of mesh.faceEdges(patch[index]!)) {
        for (const other of mesh.edgeFaces(edge)) {
          if (!faces.has(other) || seen.has(other)) continue
          seen.add(other)
          patch.push(other)
        }
      }
    }
    patches.push(patch)
  }
  return patches
}

/** Whether a face’s loop runs from `a` to `b` rather than the other way. */
function runsForward(mesh: EditMesh, faceSlot: number, a: number, b: number): boolean {
  return mesh.loopNext(faceSlot, a) === b
}

/**
 * Winds a patch of faces consistently, facing out of the shape it encloses — or into it.
 *
 * The seed is the face whose centre reaches furthest from the patch’s centre *along its own
 * normal*: that is a face on the outside of the shape whose normal is not lying in the surface, so
 * the sign of that same reach says whether it already faces out. Everything else follows from the
 * seed, one neighbour at a time, and never has to look at the shape as a whole again.
 *
 * The centre is the patch’s own rather than the whole mesh’s, so two islands far apart each get the
 * answer their own geometry gives.
 */
function windConsistently(mesh: EditMesh, patch: number[], inside: boolean): number {
  const corners = new Set<number>()
  for (const face of patch) for (const slot of mesh.faceVertices(face)) corners.add(slot)
  const centre = mesh.boundsOf(corners).centre
  const reach = (face: number): number => dot(subtract(mesh.faceCentre(face), centre), mesh.faceNormal(face))

  let seed = patch[0]!
  let furthest = -Infinity
  for (const face of patch) {
    const distance = Math.abs(reach(face))
    if (distance <= furthest) continue
    furthest = distance
    seed = face
  }

  let flipped = 0
  if (reach(seed) > 0 === inside) {
    mesh.flipFace(seed)
    flipped += 1
  }
  const members = new Set(patch)
  const seen = new Set<number>([seed])
  const queue = [seed]
  for (let index = 0; index < queue.length; index += 1) {
    const face = queue[index]!
    for (const edge of mesh.faceEdges(face)) {
      const neighbours = mesh.edgeFaces(edge).filter((slot) => slot !== face && members.has(slot))
      // An edge carrying three faces or more says nothing about which way either of them should go,
      // so the walk stops there rather than picking one of them and calling it the answer.
      if (neighbours.length !== 1) continue
      const other = neighbours[0]!
      if (seen.has(other)) continue
      seen.add(other)
      const [a, b] = mesh.edgeVertices(edge)
      if (runsForward(mesh, face, a, b) === runsForward(mesh, other, a, b)) {
        mesh.flipFace(other)
        flipped += 1
      }
      queue.push(other)
    }
  }
  return flipped
}

registerOperator<{ inside: boolean }>({
  id: 'mesh.normalsRecalculate',
  label: 'Recalculate normals',
  section: 'Mesh',
  shortcut: '⇧N',
  icon: 'mesh',
  description: 'Wind every selected face the same way round, facing out of the shape they enclose.',
  params: [switchParam('inside', 'Inside', false)],
  defaults: { inside: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => {
    const inside = params.inside === true
    return runOnMeshes(context, (target) => {
      if (target.faces.size === 0) return null
      for (const patch of facePatches(target.mesh, target.faces)) windConsistently(target.mesh, patch, inside)
      return {}
    }, { label: inside ? 'Recalculate normals inside' : 'Recalculate normals outside' })
  },
})

/* -------------------------------------------------------------------- flip */

registerOperator({
  id: 'mesh.normalsFlip',
  label: 'Flip normals',
  section: 'Mesh',
  icon: 'mesh',
  description: 'Turn each selected face round, so it faces the other way.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => runOnMeshes(context, (target) => {
    if (target.faces.size === 0) return null
    for (const face of target.faces) target.mesh.flipFace(face)
    return {}
  }, { label: 'Flip normals' }),
})

/* ---------------------------------------------------------- set from faces */

registerOperator({
  id: 'mesh.normalsSetFromFaces',
  label: 'Set from faces',
  section: 'Mesh',
  icon: 'face-mode',
  description: 'Give each selected face the flat shading of its own plane, hard all the way round.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  // Blender writes one custom normal per corner here. Without a corner attribute the same shading
  // comes from the flag pair that produces it: the face flat, and every edge of it sharp so no
  // neighbour blends across.
  run: (context) => runOnMeshes(context, (target) => {
    if (target.faces.size === 0) return null
    for (const face of target.faces) {
      target.mesh.setFaceSmooth(face, false)
      for (const edge of target.mesh.faceEdges(face)) target.mesh.setEdgeFlag(edge, 'sharp', true)
    }
    return {}
  }, { label: 'Set from faces' }),
})

/* ------------------------------------------------------------ point to target */

const POINT_FROM = selectParam('from', 'Away from', [
  { value: 'cursor', label: 'The 3D cursor' },
  { value: 'target', label: 'A point' },
], 'cursor')

registerOperator<{ from: string; target: number[]; invert: boolean }>({
  id: 'mesh.normalsPointToTarget',
  label: 'Point normals to target',
  section: 'Mesh',
  icon: 'cursor',
  description: 'Turn each selected face until it faces away from a point — the 3D cursor unless another is given.',
  params: [
    POINT_FROM,
    vectorParam('target', 'Target', { defaultValue: [0, 0, 0], unit: 'm' }),
    switchParam('invert', 'Point towards it', false),
  ],
  defaults: { from: 'cursor', target: [0, 0, 0], invert: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  // The custom normals Blender aims here are per corner and this mesh has none, so the aim is taken
  // out on the winding: a face already facing away is left alone, and one facing the target is
  // turned round. The direction is right; the fan of a rounded surface is not.
  run: (context, params) => {
    const target = String(params.from) === 'target' ? vec3(params.target) : context.cursor.position
    const wanted = params.invert === true ? -1 : 1
    return runOnMeshes(context, (edited) => {
      if (edited.faces.size === 0) return null
      for (const face of edited.faces) {
        const away = subtract(edited.mesh.faceCentre(face), target)
        if (dot(edited.mesh.faceNormal(face), away) * wanted < 0) edited.mesh.flipFace(face)
      }
      return {}
    }, { label: 'Point normals to target' })
  },
})

function vec3(value: number[]): Vec3 {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]
}

/* ----------------------------------------------------------------- average */

/** The edges with a selected face on both sides: the ones inside the selection rather than round it. */
function interiorEdges(target: EditTarget): number[] {
  const inside: number[] = []
  for (const face of target.faces) {
    for (const edge of target.mesh.faceEdges(face)) {
      const users = target.mesh.edgeFaces(edge)
      if (users.length === 2 && users.every((slot) => target.faces.has(slot))) inside.push(edge)
    }
  }
  return inside
}

registerOperator({
  id: 'mesh.normalsAverage',
  label: 'Average normals',
  section: 'Mesh',
  icon: 'smooth',
  description: 'Blend the normals across the selection, so its faces share one normal at each corner.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  // Averaging custom normals is the same thing, on a mesh that has none, as letting the renderer
  // average them: the faces go smooth and the sharp flags inside the selection come off, and each
  // shared corner is then the one normal `vertexNormal` computes, weighted by corner angle.
  run: (context) => runOnMeshes(context, (target) => {
    if (target.faces.size === 0) return null
    for (const face of target.faces) target.mesh.setFaceSmooth(face, true)
    for (const edge of interiorEdges(target)) target.mesh.setEdgeFlag(edge, 'sharp', false)
    return {}
  }, { label: 'Average normals' }),
})

/* ----------------------------------------------------------------- shading */

function shade(context: OperatorContext, smooth: boolean, label: string): OperatorResult {
  return runOnMeshes(context, (target) => {
    if (target.faces.size === 0) return null
    for (const face of target.faces) target.mesh.setFaceSmooth(face, smooth)
    return {}
  }, { label })
}

registerOperator({
  id: 'mesh.shadeSmooth',
  label: 'Shade smooth',
  section: 'Face',
  icon: 'smooth',
  description: 'Blend the shading across the selected faces.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => shade(context, true, 'Shade smooth'),
})

registerOperator({
  id: 'mesh.shadeFlat',
  label: 'Shade flat',
  section: 'Face',
  icon: 'face-mode',
  description: 'Give each selected face its own flat shading.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => shade(context, false, 'Shade flat'),
})

registerOperator<{ angle: number }>({
  id: 'mesh.autoSmooth',
  label: 'Shade auto smooth',
  section: 'Face',
  icon: 'smooth',
  description: 'Shade the selected faces smooth, and mark every fold sharper than the angle as a hard edge.',
  params: [numberParam('angle', 'Angle', { min: 0, max: 180, step: 1, defaultValue: 30, unit: '°', view: 'angle' })],
  defaults: { angle: 30 },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => {
    const angle = Math.min(180, Math.max(0, Number(params.angle) || 0))
    const limit = (angle * Math.PI) / 180
    const touched = new Set<string>()
    const result = runOnMeshes(context, (target) => {
      if (target.faces.size === 0) return null
      for (const face of target.faces) target.mesh.setFaceSmooth(face, true)
      // Only the folds inside the selection are judged: an edge on its rim has a face outside that
      // this run was never asked about, and its flag is the neighbouring run’s to set.
      for (const edge of interiorEdges(target)) {
        target.mesh.setEdgeFlag(edge, 'sharp', target.mesh.dihedral(edge) > limit)
      }
      touched.add(target.meshId)
      return {}
    }, { label: 'Shade auto smooth' })
    if (!result.document || touched.size === 0) return result
    // The angle itself belongs to the mesh rather than to any edge of it, and `EditMesh` carries no
    // accessor for it — so it is written here, onto the document `runOnMeshes` has handed back.
    const meshes = { ...result.document.meshes }
    for (const meshId of touched) {
      const mesh = meshes[meshId]
      if (mesh) meshes[meshId] = { ...mesh, autoSmooth: { enabled: true, angle } }
    }
    return { ...result, document: { ...result.document, meshes }, label: `Shade auto smooth at ${angle}°` }
  },
})

/* --------------------------------------------------------- edge attributes */

function flagEdges(context: OperatorContext, flag: 'seam' | 'sharp', on: boolean, label: string): OperatorResult {
  return runOnMeshes(context, (target) => {
    if (target.edges.size === 0) return null
    for (const edge of target.edges) target.mesh.setEdgeFlag(edge, flag, on)
    return {}
  }, { label })
}

function numberEdges(context: OperatorContext, flag: 'crease' | 'bevelWeight', value: number, label: string): OperatorResult {
  return runOnMeshes(context, (target) => {
    if (target.edges.size === 0) return null
    for (const edge of target.edges) target.mesh.setEdgeNumber(edge, flag, value)
    return {}
  }, { label })
}

registerOperator({
  id: 'mesh.markSharp',
  label: 'Mark sharp',
  section: 'Edge',
  icon: 'edge-mode',
  description: 'Keep the shading from blending across the selected edges.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context) => flagEdges(context, 'sharp', true, 'Mark sharp'),
})

registerOperator({
  id: 'mesh.clearSharp',
  label: 'Clear sharp',
  section: 'Edge',
  icon: 'edge-mode',
  description: 'Let the shading blend across the selected edges again.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context) => flagEdges(context, 'sharp', false, 'Clear sharp'),
})

registerOperator({
  id: 'mesh.markSeam',
  label: 'Mark seam',
  section: 'Edge',
  icon: 'edge-mode',
  description: 'Cut the UV map along the selected edges when it is unwrapped.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context) => flagEdges(context, 'seam', true, 'Mark seam'),
})

registerOperator({
  id: 'mesh.clearSeam',
  label: 'Clear seam',
  section: 'Edge',
  icon: 'edge-mode',
  description: 'Take the UV seam off the selected edges.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context) => flagEdges(context, 'seam', false, 'Clear seam'),
})

/**
 * ⇧E and ⌃⇧E are numeric sessions in Blender: the key starts a drag that reads out as a number, and
 * the number is all that reaches the mesh. So both are declared modal and both are written as a
 * whole function of their one parameter, which is what the drag confirms with and what the F9 panel
 * replays with.
 */
registerOperator<{ value: number }>({
  id: 'mesh.setCrease',
  label: 'Set crease',
  section: 'Edge',
  shortcut: '⇧E',
  icon: 'edge-mode',
  description: 'Hold the selected edges against a subdivision, from nothing at 0 to a hard corner at 1.',
  params: [numberParam('value', 'Crease', { min: 0, max: 1, step: 0.01, defaultValue: 1, view: 'bar' })],
  defaults: { value: 1 },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context, params) => {
    const value = Math.min(1, Math.max(0, Number(params.value) || 0))
    return numberEdges(context, 'crease', value, `Set crease ${value}`)
  },
})

registerOperator<{ value: number }>({
  id: 'mesh.setBevelWeight',
  label: 'Set bevel weight',
  section: 'Edge',
  shortcut: '⌃⇧E',
  icon: 'bevel',
  description: 'Say how much of a bevel the selected edges take, from none at 0 to all of it at 1.',
  params: [numberParam('value', 'Bevel weight', { min: 0, max: 1, step: 0.01, defaultValue: 1, view: 'bar' })],
  defaults: { value: 1 },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context, params) => {
    const value = Math.min(1, Math.max(0, Number(params.value) || 0))
    return numberEdges(context, 'bevelWeight', value, `Set bevel weight ${value}`)
  },
})
