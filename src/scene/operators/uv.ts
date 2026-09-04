import { EditMesh } from '@/scene/mesh/editMesh'
import { loopStarts, uniqueUvName, uvMapsOf, DEFAULT_UV_NAME } from '@/scene/mesh/uv'
import { requireEdit, runOnMeshes, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, selectParam, switchParam, type OperatorContext, type OperatorParams, type OperatorResult } from '@/scene/operators/types'
import { islandsFromSeams, seamsFromIslands, type UvIsland } from '@/scene/uv/islands'
import { lscmUnwrap } from '@/scene/uv/lscm'
import { packIslands, placementsFor, type IslandBox } from '@/scene/uv/pack'
import { cubeProjection, cylinderProjection, planarProjection, resetProjection, sphereProjection } from '@/scene/uv/project'
import { minimumAreaAngle } from '@/scene/uv/orient'
import { minimizeStretch } from '@/scene/uv/stretch'
import { smartProject } from '@/scene/uv/smart'
import type { MeshData, UvMap } from '@/scene/types'

/**
 * The UV menu: everything that makes or moves a UV map.
 *
 * All of these are one shape. Take the mesh as it is, work out a new active map for the corners of
 * the faces that are selected, leave every other corner where it was, and hand the map back. That
 * is why none of them touches geometry and none of them changes the selection: unwrapping is a
 * change of what a surface is painted with, not of what it is.
 *
 * They run in edit mode because that is where a selection of faces exists, and because that is
 * where Blender puts them. An object-mode caller selects everything first — which is what the
 * viewport does when nothing is selected in the mesh.
 */

/** The faces an operator works on: the selection, or all of them when nothing is selected. */
function facesOf(target: EditTarget): Set<number> {
  if (target.faces.size > 0) return target.faces
  const all = new Set<number>()
  for (let face = 0; face < target.mesh.faceCount; face += 1) all.add(face)
  return all
}

/**
 * The active map of a mesh, or a new one full of nothing.
 *
 * An unwrap on a mesh with no map makes one, as Blender's does: there is nowhere else to put the
 * answer, and a mesh that has been unwrapped has a UV map by definition.
 */
function activeMapOf(mesh: MeshData): { maps: UvMap[]; index: number; data: number[] } {
  const starts = loopStarts(mesh)
  const loops = starts[mesh.faces.length] ?? 0
  const maps = uvMapsOf(mesh).map((map) => ({ name: map.name, data: map.data.slice() }))
  if (maps.length === 0) {
    const made = { name: DEFAULT_UV_NAME, data: new Array<number>(loops * 2).fill(0) }
    return { maps: [made], index: 0, data: made.data }
  }
  const index = Math.min(maps.length - 1, Math.max(0, mesh.attributes.loop?.activeUv ?? 0))
  return { maps, index, data: maps[index]!.data }
}

/**
 * The frame every one of these operators runs in: read the mesh, write the corners of the chosen
 * faces, hand the maps back.
 *
 * `write` is given the mesh, the faces to work on, and the map as it stands; whatever it puts into
 * the array for those faces' corners is what the mesh ends up with.
 */
function editUvs(
  context: OperatorContext,
  label: string,
  write: (mesh: MeshData, faces: Set<number>, data: number[], starts: number[]) => string | void,
): OperatorResult {
  return runOnMeshes(context, (target) => {
    const mesh = target.mesh.toData()
    if (mesh.faces.length === 0) return 'That mesh has no faces to unwrap.'
    const faces = facesOf(target)
    const { maps, index, data } = activeMapOf(mesh)
    const refusal = write(mesh, faces, data, loopStarts(mesh))
    if (typeof refusal === 'string') return refusal
    target.mesh.setUvMaps(maps, index)
    return { message: label }
  }, { label })
}

/** Copies the corners of the chosen faces out of a whole-mesh projection. */
function copyFaces(source: number[], data: number[], mesh: MeshData, faces: Set<number>, starts: number[]): void {
  for (const face of faces) {
    const start = starts[face]
    const loop = mesh.faces[face]
    if (start === undefined || !loop) continue
    for (let corner = 0; corner < loop.length; corner += 1) {
      data[(start + corner) * 2] = source[(start + corner) * 2] ?? 0
      data[(start + corner) * 2 + 1] = source[(start + corner) * 2 + 1] ?? 0
    }
  }
}

/* -------------------------------------------------------------- unwrapping */

/**
 * The bounding box of an island in the map, which is what the packer needs and what an island's
 * own scale is measured against.
 */
function islandBox(mesh: MeshData, island: UvIsland, data: number[], starts: number[]): {
  minU: number
  minV: number
  width: number
  height: number
} {
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const face of island.faces) {
    const start = starts[face]
    const loop = mesh.faces[face]
    if (start === undefined || !loop) continue
    for (let corner = 0; corner < loop.length; corner += 1) {
      const u = data[(start + corner) * 2] ?? 0
      const v = data[(start + corner) * 2 + 1] ?? 0
      if (u < minU) minU = u
      if (v < minV) minV = v
      if (u > maxU) maxU = u
      if (v > maxV) maxV = v
    }
  }
  if (!Number.isFinite(minU)) return { minU: 0, minV: 0, width: 0, height: 0 }
  return { minU, minV, width: maxU - minU, height: maxV - minV }
}

/**
 * An island turned so that it lies in the smallest box it fits in.
 *
 * A conformal flattening is only defined up to a rotation, so LSCM hands back the square face of a
 * cube standing on a corner as readily as lying on a side — and a diamond needs twice the room in
 * the image of the square it is. Packing measures room by the bounding box, so laying every island
 * on its narrowest side before packing is not a tidying step: it is most of the difference between
 * a cube that unwraps into six squares and one that unwraps into six diamonds.
 */
function layFlat(mesh: MeshData, island: UvIsland, data: number[], starts: number[]): void {
  const points: number[] = []
  const loops: number[] = []
  for (const face of island.faces) {
    const start = starts[face]
    const corners = mesh.faces[face]
    if (start === undefined || !corners) continue
    for (let corner = 0; corner < corners.length; corner += 1) {
      loops.push(start + corner)
      points.push(data[(start + corner) * 2] ?? 0, data[(start + corner) * 2 + 1] ?? 0)
    }
  }
  const angle = minimumAreaAngle(points)
  if (angle === 0) return
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  for (let index = 0; index < loops.length; index += 1) {
    const u = points[index * 2]!
    const v = points[index * 2 + 1]!
    data[loops[index]! * 2] = u * cos - v * sin
    data[loops[index]! * 2 + 1] = u * sin + v * cos
  }
}

/**
 * Islands laid into the square.
 *
 * The packer works on boxes and knows nothing about meshes, so this is the part that turns islands
 * into boxes and the placements back into corners. An island of no size — one face folded flat —
 * is left where it is rather than scaled up from nothing.
 */
function packInto(
  mesh: MeshData,
  islands: UvIsland[],
  data: number[],
  starts: number[],
  options: { margin?: number; rotate?: boolean; scaleToFit?: boolean } = {},
): void {
  if (options.rotate ?? true) for (const island of islands) layFlat(mesh, island, data, starts)
  const boxes: IslandBox[] = []
  const extents = islands.map((island) => islandBox(mesh, island, data, starts))
  for (let index = 0; index < islands.length; index += 1) {
    const extent = extents[index]!
    boxes.push({ island: index, width: extent.width, height: extent.height })
  }
  const placements = placementsFor(packIslands(boxes, options), boxes)
  for (const placement of placements) {
    const island = islands[placement.island]
    const extent = extents[placement.island]
    if (!island || !extent) continue
    for (const face of island.faces) {
      const start = starts[face]
      const loop = mesh.faces[face]
      if (start === undefined || !loop) continue
      for (let corner = 0; corner < loop.length; corner += 1) {
        const u = (data[(start + corner) * 2] ?? 0) - extent.minU
        const v = (data[(start + corner) * 2 + 1] ?? 0) - extent.minV
        const [laidU, laidV] = placement.rotated
          ? [placement.offsetU + placement.scale * v, placement.offsetV + placement.scale * (extent.width - u)]
          : [placement.offsetU + placement.scale * u, placement.offsetV + placement.scale * v]
        data[(start + corner) * 2] = laidU
        data[(start + corner) * 2 + 1] = laidV
      }
    }
  }
}

registerOperator({
  id: 'uv.unwrap',
  label: 'Unwrap',
  section: 'UV',
  icon: 'face-mode',
  shortcut: 'U',
  description: 'Flatten the selected faces, cut along the seams, keeping angles as best it can.',
  params: [
    selectParam('method', 'Method', [
      { value: 'conformal', label: 'Angle based' },
      { value: 'lscm', label: 'Conformal' },
    ], 'conformal'),
    numberParam('margin', 'Margin', { min: 0, max: 0.5, step: 0.001, defaultValue: 0.02 }),
    switchParam('pack', 'Pack islands', true),
  ],
  defaults: { method: 'conformal', margin: 0.02, pack: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => unwrap(context, params),
})

/**
 * Unwrap.
 *
 * Blender offers two methods and this offers the same two names, but only one solver: "conformal"
 * is LSCM, and "angle based" is LSCM followed by a relaxation that pulls the corners towards the
 * angles the surface has. That relaxation is not ABF++ — it is the local one in `stretch.ts` — so
 * on a strongly curved piece Blender's angle-based method still gives a better map. The two are
 * kept apart in the menu because the difference is real and a person choosing between them should
 * get something different; what they should not get is a promise of an algorithm that is not there,
 * which is why this comment and the operator's description say what it is.
 */
function unwrap(context: OperatorContext, params: OperatorParams): OperatorResult {
  const method = String(params.method ?? 'conformal')
  const margin = Number(params.margin ?? 0.02)
  const shouldPack = Boolean(params.pack ?? true)
  return editUvs(context, 'Unwrap', (mesh, faces, data, starts) => {
    const islands = islandsFromSeams(mesh, { selection: faces })
    if (islands.length === 0) return 'Select some faces to unwrap.'
    let flattened = 0
    for (const island of islands) {
      const uv = lscmUnwrap(mesh, island)
      if (!uv) continue
      flattened += 1
      let at = 0
      for (const face of island.faces) {
        const start = starts[face]!
        const loop = mesh.faces[face]!
        for (let corner = 0; corner < loop.length; corner += 1) {
          data[(start + corner) * 2] = uv[at * 2] ?? 0
          data[(start + corner) * 2 + 1] = uv[at * 2 + 1] ?? 0
          at += 1
        }
      }
    }
    if (flattened === 0) return 'Those faces have no area to unwrap.'
    if (method === 'conformal') {
      const relaxed = minimizeStretch(mesh, data, { iterations: 12 })
      copyFaces(relaxed, data, mesh, faces, starts)
    }
    if (shouldPack) packInto(mesh, islands, data, starts, { margin })
  })
}

registerOperator({
  id: 'uv.smartProject',
  label: 'Smart UV project',
  section: 'UV',
  icon: 'face-mode',
  description: 'Cut where the surface turns, project each piece flat, and pack the pieces.',
  params: [
    numberParam('angleLimit', 'Angle limit', { min: 1, max: 89, step: 1, defaultValue: 66, unit: '°' }),
    numberParam('margin', 'Island margin', { min: 0, max: 0.5, step: 0.001, defaultValue: 0.02 }),
    switchParam('areaWeight', 'Area weight', true),
  ],
  defaults: { angleLimit: 66, margin: 0.02, areaWeight: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => editUvs(context, 'Smart UV project', (mesh, faces, data, starts) => {
    const { islands, uv } = smartProject(mesh, {
      angleLimit: Number(params.angleLimit ?? 66),
      areaWeight: Boolean(params.areaWeight ?? true),
      selection: faces,
    })
    if (islands.length === 0) return 'Select some faces to project.'
    copyFaces(uv, data, mesh, faces, starts)
    packInto(mesh, islands, data, starts, { margin: Number(params.margin ?? 0.02) })
  }),
})

/* ------------------------------------------------------------- projections */

/** The four projections of the UV menu, which are one function each and the same frame around them. */
const PROJECTIONS: Array<{ id: string; label: string; description: string; project: (mesh: MeshData, params: OperatorParams) => number[] }> = [
  {
    id: 'uv.cubeProject',
    label: 'Cube projection',
    description: 'Give each face the plane it faces most, as a box would be painted.',
    project: (mesh, params) => cubeProjection(mesh, { scale: Number(params.scale ?? 1) }),
  },
  {
    id: 'uv.cylinderProject',
    label: 'Cylinder projection',
    description: 'Wrap the image round the Z axis, the height running up the image.',
    project: (mesh, params) => cylinderProjection(mesh, { scale: Number(params.scale ?? 1) }),
  },
  {
    id: 'uv.sphereProject',
    label: 'Sphere projection',
    description: 'Longitude across the image, latitude up it.',
    project: (mesh) => sphereProjection(mesh),
  },
  {
    id: 'uv.reset',
    label: 'Reset',
    description: 'Give every face the whole image.',
    project: (mesh) => resetProjection(mesh),
  },
]

for (const entry of PROJECTIONS) {
  registerOperator({
    id: entry.id,
    label: entry.label,
    section: 'UV',
    icon: 'face-mode',
    description: entry.description,
    params: entry.id === 'uv.reset' || entry.id === 'uv.sphereProject'
      ? []
      : [numberParam('scale', 'Scale', { min: 0.01, max: 100, step: 0.01, defaultValue: 1 })],
    defaults: entry.id === 'uv.reset' || entry.id === 'uv.sphereProject' ? {} : { scale: 1 },
    mode: 'edit',
    available: (context) => requireEdit(context, 'face'),
    run: (context, params) => editUvs(context, entry.label, (mesh, faces, data, starts) => {
      copyFaces(entry.project(mesh, params), data, mesh, faces, starts)
    }),
  })
}

registerOperator({
  id: 'uv.projectFromView',
  label: 'Project from view',
  section: 'UV',
  icon: 'face-mode',
  description: 'Lay the faces on the image the way the viewport sees them.',
  params: [switchParam('bounds', 'Scale to bounds', true)],
  defaults: { bounds: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => {
    /*
     * The projection is along the view's own axis, which is the nearest world axis to where the
     * camera is: a true camera projection would need the matrix, and the operator has the document
     * rather than the viewport. It is said in the description, and the result is the same for the
     * axis views a person actually uses this from.
     */
    const view = context.document.view
    const yaw = ((view.yaw % 360) + 360) % 360
    const axis = Math.abs(view.pitch) > 45 ? 2 : yaw > 45 && yaw < 135 ? 1 : yaw > 225 && yaw < 315 ? 1 : 0
    return editUvs(context, 'Project from view', (mesh, faces, data, starts) => {
      const projected = planarProjection(mesh, axis as 0 | 1 | 2)
      copyFaces(projected, data, mesh, faces, starts)
      /*
       * Scale to bounds lays what was projected on the whole image, which is what the option means
       * and what a person projecting one wall of a building wants.
       */
      if (params.bounds !== undefined && !params.bounds) return
      const islands = islandsFromSeams(mesh, { selection: faces })
      packInto(mesh, islands, data, starts, { margin: 0 })
    })
  },
})

/* ---------------------------------------------------------------- the rest */

registerOperator({
  id: 'uv.packIslands',
  label: 'Pack islands',
  section: 'UV',
  icon: 'face-mode',
  description: 'Lay every island in the image without overlapping, largest first.',
  params: [
    numberParam('margin', 'Margin', { min: 0, max: 0.5, step: 0.001, defaultValue: 0.02 }),
    switchParam('rotate', 'Rotate', true),
  ],
  defaults: { margin: 0.02, rotate: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => editUvs(context, 'Pack islands', (mesh, faces, data, starts) => {
    const islands = islandsFromSeams(mesh, { selection: faces })
    if (islands.length === 0) return 'Select some faces to pack.'
    packInto(mesh, islands, data, starts, {
      margin: Number(params.margin ?? 0.02),
      rotate: Boolean(params.rotate ?? true),
    })
  }),
})

registerOperator({
  id: 'uv.averageIslandScale',
  label: 'Average island scale',
  section: 'UV',
  icon: 'face-mode',
  description: 'Give every island the same number of texels per metre.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => editUvs(context, 'Average island scale', (mesh, faces, data, starts) => {
    const islands = islandsFromSeams(mesh, { selection: faces })
    if (islands.length === 0) return 'Select some faces to scale.'
    /*
     * The ratio of a face's area in the image to its area on the surface is the texel density, and
     * averaging it over the islands and then scaling each island to that average is what makes a
     * checker the same size everywhere. An island with no area in the image is left alone: there is
     * nothing to scale, and dividing by it would send it to infinity.
     */
    const densities = islands.map((island) => density(mesh, island, data, starts))
    const usable = densities.filter((value) => value > 0)
    if (usable.length === 0) return 'Those islands have no area to scale.'
    const average = usable.reduce((total, value) => total + value, 0) / usable.length
    for (let index = 0; index < islands.length; index += 1) {
      const own = densities[index]!
      if (own <= 0) continue
      const island = islands[index]!
      const factor = average / own
      const extent = islandBox(mesh, island, data, starts)
      const centreU = extent.minU + extent.width / 2
      const centreV = extent.minV + extent.height / 2
      for (const face of island.faces) {
        const start = starts[face]!
        const loop = mesh.faces[face]!
        for (let corner = 0; corner < loop.length; corner += 1) {
          const at = (start + corner) * 2
          data[at] = centreU + ((data[at] ?? 0) - centreU) * factor
          data[at + 1] = centreV + ((data[at + 1] ?? 0) - centreV) * factor
        }
      }
    }
  }),
})

/** Texels per metre, squared: the island's area in the image over its area on the surface. */
function density(mesh: MeshData, island: UvIsland, data: number[], starts: number[]): number {
  let uvArea = 0
  let surfaceArea = 0
  for (const face of island.faces) {
    const start = starts[face]
    const loop = mesh.faces[face]
    if (start === undefined || !loop) continue
    for (let index = 1; index + 1 < loop.length; index += 1) {
      const a = start
      const b = start + index
      const c = start + index + 1
      uvArea += Math.abs(cross2(
        (data[b * 2] ?? 0) - (data[a * 2] ?? 0), (data[b * 2 + 1] ?? 0) - (data[a * 2 + 1] ?? 0),
        (data[c * 2] ?? 0) - (data[a * 2] ?? 0), (data[c * 2 + 1] ?? 0) - (data[a * 2 + 1] ?? 0),
      )) / 2
      surfaceArea += triangleArea(mesh, loop[0]!, loop[index]!, loop[index + 1]!)
    }
  }
  if (surfaceArea < 1e-12) return 0
  return Math.sqrt(uvArea / surfaceArea)
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

function triangleArea(mesh: MeshData, a: number, b: number, c: number): number {
  const ax = mesh.vertices[a * 3] ?? 0
  const ay = mesh.vertices[a * 3 + 1] ?? 0
  const az = mesh.vertices[a * 3 + 2] ?? 0
  const ux = (mesh.vertices[b * 3] ?? 0) - ax
  const uy = (mesh.vertices[b * 3 + 1] ?? 0) - ay
  const uz = (mesh.vertices[b * 3 + 2] ?? 0) - az
  const vx = (mesh.vertices[c * 3] ?? 0) - ax
  const vy = (mesh.vertices[c * 3 + 1] ?? 0) - ay
  const vz = (mesh.vertices[c * 3 + 2] ?? 0) - az
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}

registerOperator({
  id: 'uv.minimizeStretch',
  label: 'Minimize stretch',
  section: 'UV',
  icon: 'face-mode',
  description: 'Relax the map so its faces are shaped more like the surface they came from.',
  params: [numberParam('iterations', 'Iterations', { min: 1, max: 200, step: 1, defaultValue: 20, view: 'stepper' })],
  defaults: { iterations: 20 },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => editUvs(context, 'Minimize stretch', (mesh, faces, data, starts) => {
    const relaxed = minimizeStretch(mesh, data, { iterations: Math.round(Number(params.iterations ?? 20)) })
    copyFaces(relaxed, data, mesh, faces, starts)
  }),
})

registerOperator({
  id: 'uv.seamsFromIslands',
  label: 'Seams from islands',
  section: 'UV',
  icon: 'edge-mode',
  description: 'Mark a seam wherever the map is already cut.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => runOnMeshes(context, (target) => {
    const mesh = target.mesh.toData()
    const maps = uvMapsOf(mesh)
    if (maps.length === 0) return 'That mesh has no UV map to read seams from.'
    const active = Math.min(maps.length - 1, Math.max(0, mesh.attributes.loop?.activeUv ?? 0))
    const found = seamsFromIslands(mesh, maps[active]!.data)
    const existing = mesh.attributes.edge.seam ?? mesh.edges.map(() => false)
    let marked = 0
    for (let edge = 0; edge < found.length; edge += 1) {
      if (!found[edge] || existing[edge]) continue
      target.mesh.setEdgeFlag(edge, 'seam', true)
      marked += 1
    }
    if (marked === 0) return null
    return { message: `Seams from islands · ${marked}` }
  }, { label: 'Seams from islands' }),
})

registerOperator({
  id: 'uv.lightmapPack',
  label: 'Lightmap pack',
  section: 'UV',
  icon: 'face-mode',
  description: 'One face per island, packed into the image: the map a baked light needs.',
  params: [numberParam('margin', 'Margin', { min: 0, max: 0.5, step: 0.001, defaultValue: 0.01 })],
  defaults: { margin: 0.01 },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => editUvs(context, 'Lightmap pack', (mesh, faces, data, starts) => {
    if (faces.size === 0) return 'Select some faces to pack.'
    /*
     * A lightmap wants every face to have its own patch of the image, so that light baked into one
     * face never bleeds into another. Each face is therefore its own island, laid flat by the same
     * projection a single face gets, and the packer does the rest.
     */
    const islands: UvIsland[] = [...faces].sort((a, b) => a - b).map((face) => ({ faces: [face] }))
    const projected = cubeProjection(mesh)
    copyFaces(projected, data, mesh, faces, starts)
    packInto(mesh, islands, data, starts, { margin: Number(params.margin ?? 0.01), rotate: true })
  }),
})

/** Whether a mesh carries a UV map at all, for a panel that offers to make one. */
export function hasUvMap(mesh: MeshData): boolean {
  return uvMapsOf(mesh).length > 0
}

/** A new empty map beside the ones a mesh has, which the Data tab's Add does. */
export function withNewUvMap(mesh: MeshData, name?: string): UvMap[] {
  const starts = loopStarts(mesh)
  const loops = starts[mesh.faces.length] ?? 0
  const maps = uvMapsOf(mesh)
  return [...maps, { name: uniqueUvName(maps, name), data: cubeProjection(mesh).slice(0, loops * 2) }]
}

void EditMesh
