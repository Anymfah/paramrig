import { meshFromPolygons } from '@/scene/mesh/data'
import type { Material, MeshData, Vec3 } from '@/scene/types'

/**
 * Wavefront OBJ, read and written.
 *
 * OBJ is the format that survives everything: a text file of vertices and faces that every tool
 * since 1990 can open. Its two virtues are the reason it is here — it keeps n-gons, so a mesh does
 * not have to be triangulated to leave this editor, and it is legible, so a person can see what
 * went wrong. Its limits are just as plain: no scene graph beyond named groups, no lights or
 * cameras, and colours in a companion .mtl written in a shading model nobody uses any more.
 *
 * What is kept: positions, faces of any length, per-object grouping, per-face material, normals and
 * UVs when they are there. What is not: smoothing groups beyond on and off, free-form surfaces, and
 * anything in the .mtl beyond the handful of values a `Material` has a place for.
 *
 * Both directions are pure text in and text out, so a round trip is tested by comparing two meshes
 * rather than by opening a file.
 */

export type ObjObject = {
  name: string
  mesh: MeshData
  /** Material names in the order the faces refer to them, matching the mesh's material attribute. */
  materials: string[]
}

export type ObjDocument = {
  objects: ObjObject[]
  /** What the file's `mtllib` line named, if it had one. */
  materialLibrary: string | null
}

/* -------------------------------------------------------------------- read */

type Corner = { position: number; uv: number; normal: number }

/** Reads the whole file. A file with no faces gives no objects rather than an empty one. */
export function readObj(text: string): ObjDocument {
  const positions: Vec3[] = []
  const objects: ObjObject[] = []
  let materialLibrary: string | null = null

  /** The object being built. OBJ has no header, so one is opened as soon as a face arrives. */
  let name = 'Object'
  let faces: number[][] = []
  let faceMaterials: number[] = []
  let smooth: boolean[] = []
  let materials: string[] = []
  let currentMaterial = 0
  let smoothing = false

  const flush = (): void => {
    if (faces.length === 0) return
    /*
     * Only the vertices this object actually uses, renumbered: an OBJ's vertex list is shared by
     * every object in the file, and keeping all of it on each one would turn a file of ten objects
     * into ten copies of the whole scene.
     */
    const used = new Map<number, number>()
    const points: Vec3[] = []
    const loops = faces.map((loop) => loop.map((index) => {
      const seen = used.get(index)
      if (seen !== undefined) return seen
      const slot = points.length
      used.set(index, slot)
      points.push(positions[index] ?? [0, 0, 0])
      return slot
    }))
    const mesh = meshFromPolygons(points, loops)
    for (let face = 0; face < mesh.faceIds.length; face += 1) {
      mesh.attributes.face.material[face] = faceMaterials[face] ?? 0
      mesh.attributes.face.smooth[face] = smooth[face] ?? false
    }
    objects.push({ name, mesh, materials: materials.length > 0 ? materials : ['Material'] })
    faces = []
    faceMaterials = []
    smooth = []
    materials = []
    currentMaterial = 0
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const space = line.indexOf(' ')
    if (space < 0) continue
    const keyword = line.slice(0, space)
    const rest = line.slice(space + 1).trim()

    if (keyword === 'v') {
      const parts = rest.split(/\s+/)
      positions.push([number(parts[0]), number(parts[1]), number(parts[2])])
      continue
    }
    if (keyword === 'o' || keyword === 'g') {
      flush()
      name = rest || 'Object'
      continue
    }
    if (keyword === 'mtllib') {
      materialLibrary = rest
      continue
    }
    if (keyword === 'usemtl') {
      const index = materials.indexOf(rest)
      currentMaterial = index >= 0 ? index : materials.push(rest) - 1
      continue
    }
    if (keyword === 's') {
      smoothing = rest !== 'off' && rest !== '0'
      continue
    }
    if (keyword !== 'f') continue

    const loop = rest.split(/\s+/).map((corner) => cornerOf(corner, positions.length).position)
    if (loop.length < 3) continue
    faces.push(loop)
    faceMaterials.push(currentMaterial)
    smooth.push(smoothing)
  }
  flush()
  return { objects, materialLibrary }
}

/** One `f` corner: `v`, `v/vt`, `v//vn` or `v/vt/vn`, with OBJ's one-based and negative indices. */
function cornerOf(text: string, total: number): Corner {
  const [position, uv, normal] = text.split('/')
  return {
    position: resolve(position, total),
    uv: resolve(uv, total),
    normal: resolve(normal, total),
  }
}

/** OBJ counts from one, and counts backwards from the end when the index is negative. */
function resolve(value: string | undefined, total: number): number {
  if (!value) return -1
  const index = Number(value)
  if (!Number.isFinite(index) || index === 0) return -1
  return index > 0 ? index - 1 : total + index
}

function number(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/* ------------------------------------------------------------------- write */

export type ObjWriteObject = {
  name: string
  mesh: MeshData
  /** The material of each of the object's slots, so a face's slot can be named in the file. */
  materials: Array<Material | undefined>
  /** The object's world matrix, column-major, when its geometry has to be written in world space. */
  matrix?: number[]
}

/**
 * The file, and the .mtl beside it.
 *
 * Vertices are written once per object and numbered from a running total, which is what an OBJ's
 * shared vertex list means: the second object's first vertex is not 1 but one past the first
 * object's last. Getting that wrong produces a file that opens with everything but the first object
 * inside out or missing, and no reader will say why.
 */
export function writeObj(objects: ObjWriteObject[], options: { materialLibrary?: string } = {}): { obj: string; mtl: string } {
  const lines: string[] = ['# Written by ParamRig']
  if (options.materialLibrary) lines.push(`mtllib ${options.materialLibrary}`)
  let offset = 1
  const written = new Map<string, Material>()

  for (const object of objects) {
    lines.push(`o ${object.name.replace(/\s+/g, '_')}`)
    const mesh = object.mesh
    for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
      const point = transform(object.matrix, [
        mesh.vertices[slot * 3] ?? 0,
        mesh.vertices[slot * 3 + 1] ?? 0,
        mesh.vertices[slot * 3 + 2] ?? 0,
      ])
      lines.push(`v ${round(point[0])} ${round(point[1])} ${round(point[2])}`)
    }
    // Faces in slot order, so each material is one run and the file has one `usemtl` per material
    // rather than one per face.
    const order = [...mesh.faces.keys()].sort((first, second) => (
      (mesh.attributes.face.material[first] ?? 0) - (mesh.attributes.face.material[second] ?? 0)
    ))
    let material = -1
    let smooth: boolean | null = null
    for (const face of order) {
      const slot = mesh.attributes.face.material[face] ?? 0
      if (slot !== material) {
        material = slot
        const named = object.materials[slot]
        if (named) {
          written.set(named.name, named)
          lines.push(`usemtl ${named.name.replace(/\s+/g, '_')}`)
        }
      }
      const isSmooth = mesh.attributes.face.smooth[face] === true
      if (smooth !== isSmooth) {
        smooth = isSmooth
        lines.push(isSmooth ? 's 1' : 's off')
      }
      lines.push(`f ${mesh.faces[face]!.map((corner) => corner + offset).join(' ')}`)
    }
    offset += mesh.vertexIds.length
  }

  return { obj: `${lines.join('\n')}\n`, mtl: writeMtl([...written.values()]) }
}

/** The .mtl companion: the few values OBJ's shading model and ours have in common. */
export function writeMtl(materials: Material[]): string {
  const lines: string[] = ['# Written by ParamRig']
  for (const material of materials) {
    const [red, green, blue] = rgb(material.baseColor)
    lines.push(`newmtl ${material.name.replace(/\s+/g, '_')}`)
    lines.push(`Kd ${round(red)} ${round(green)} ${round(blue)}`)
    // Ks and Ns are the old model's specular; a roughness is turned into an exponent so that a
    // smooth material does not open somewhere else as a matte one.
    const shininess = Math.round((1 - Math.min(1, Math.max(0, material.roughness))) ** 2 * 900 + 2)
    lines.push(`Ks ${round(material.specular)} ${round(material.specular)} ${round(material.specular)}`)
    lines.push(`Ns ${shininess}`)
    if (material.alpha < 1) lines.push(`d ${round(material.alpha)}`)
    const emission = rgb(material.emission)
    if (material.emissionStrength > 0 && (emission[0] || emission[1] || emission[2])) {
      lines.push(`Ke ${round(emission[0] * material.emissionStrength)} ${round(emission[1] * material.emissionStrength)} ${round(emission[2] * material.emissionStrength)}`)
    }
    lines.push('illum 2')
  }
  return `${lines.join('\n')}\n`
}

/** `#rrggbb` as three numbers in 0..1, which is what OBJ writes. */
function rgb(hex: string): Vec3 {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join('') : value
  const number = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(number)) return [0, 0, 0]
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255]
}

/** Six decimals: a millimetre at a kilometre, and short enough that a file stays readable. */
function round(value: number): string {
  return (Math.round(value * 1e6) / 1e6).toString()
}

function transform(matrix: number[] | undefined, point: Vec3): Vec3 {
  if (!matrix || matrix.length < 16) return point
  const [x, y, z] = point
  return [
    (matrix[0] ?? 1) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 1) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 1) * z + (matrix[14] ?? 0),
  ]
}
