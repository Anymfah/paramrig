import {
  AnimationClip,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  SpotLight,
  VectorKeyframeTrack,
  Vector3,
  type KeyframeTrack,
  type Material as ThreeMaterial,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DEFAULT_MATERIAL, ROOT_COLLECTION_ID } from '@/scene/document'
import { meshFromPolygons } from '@/scene/mesh/data'
import { cachedTriangulation } from '@/scene/mesh/triangulate'
import { drawnMesh } from '@/scene/modifiers/stack'
import { localMatrix } from '@/scene/objects'
import { resolveSceneValues } from '@/scene/rig'
import { interpolateNumber } from '@/state/values'
import type { ParamValue } from '@/rigs/types'
import { fovFromFocalLength } from '@/scene/viewport/view'
import type { Material, MeshData, SceneDocument, SceneObject, Vec3 } from '@/scene/types'

/**
 * glTF, in and out, through three's own exporter and loader.
 *
 * glTF is the format that keeps the most of what a scene is: a hierarchy, materials in the same
 * physically based terms this editor uses, cameras, and lights through a well-supported extension.
 * It is also the one that everything else opens — which is why the export is the one a person is
 * most likely to hand to somebody.
 *
 * What is written is a three scene assembled for the purpose rather than the viewport's own: the
 * viewport holds picking meshes, overlays, glyphs and outlines that have no business in a file, and
 * an exporter given the live scene would faithfully write all of them out.
 *
 * Two losses are worth knowing about. glTF has no n-gons, so the mesh is triangulated on the way
 * out — an OBJ export is the one that keeps quads. And a mesh comes back with its triangles welded
 * by position, because a glTF's vertices are split per normal and per UV: without the weld a cube
 * arrives as thirty-six corners that no edge loop can walk.
 */

/** Two positions nearer than this are the same vertex on the way in. A hundredth of a millimetre. */
const WELD = 1e-5

export type GltfExportOptions = {
  /** Only these objects, by id; everything visible when it is not given. */
  objectIds?: string[]
  /** Write each mesh with its modifiers applied. Off writes the cage, which is what a person edits. */
  applyModifiers?: boolean
  /** Text glTF instead of the binary container. */
  json?: boolean
}

export async function exportGltf(document: SceneDocument, options: GltfExportOptions = {}): Promise<ArrayBuffer | string> {
  const scene = buildScene(document, options)
  const exporter = new GLTFExporter()
  const animations = animationClips(document)
  const result = await exporter.parseAsync(scene, {
    binary: options.json !== true,
    ...(animations.length ? { animations } : {}),
  })
  disposeScene(scene)
  return options.json === true ? JSON.stringify(result) : (result as ArrayBuffer)
}

/** The scene as three objects. Exported for the tests, which check what is in it before it is written. */
export function buildScene(document: SceneDocument, options: GltfExportOptions = {}): Scene {
  const scene = new Scene()
  scene.name = document.name
  const wanted = options.objectIds ? new Set(options.objectIds) : null
  const built = new Map<string, Object3D>()
  const materials = new Map<string, ThreeMaterial>()

  const materialFor = (id: string | undefined): ThreeMaterial => {
    const source = document.materials.find((entry) => entry.id === id) ?? DEFAULT_MATERIAL
    const kept = materials.get(source.id)
    if (kept) return kept
    const material = new MeshStandardMaterial({
      name: source.name,
      color: new Color(source.baseColor),
      metalness: source.metallic,
      roughness: source.roughness,
      emissive: new Color(source.emission),
      emissiveIntensity: source.emissionStrength,
      transparent: source.alpha < 1,
      opacity: source.alpha,
    })
    materials.set(source.id, material)
    return material
  }

  for (const object of document.objects) {
    if (wanted ? !wanted.has(object.id) : !object.visible) continue
    const node = nodeFor(document, object, options, materialFor)
    if (!node) continue
    node.name = object.name
    node.matrixAutoUpdate = false
    node.matrix.copy(localMatrix(object))
    node.matrix.decompose(node.position, node.quaternion, node.scale)
    built.set(object.id, node)
  }
  // Parents second, so an object that names one written after it still finds it.
  for (const object of document.objects) {
    const node = built.get(object.id)
    if (!node) continue
    const parent = object.parentId ? built.get(object.parentId) : undefined
    ;(parent ?? scene).add(node)
  }
  return scene
}

function nodeFor(
  document: SceneDocument,
  object: SceneObject,
  options: GltfExportOptions,
  materialFor: (id: string | undefined) => ThreeMaterial,
): Object3D | null {
  if (object.data.kind === 'mesh') {
    const mesh = options.applyModifiers === false
      ? document.meshes[object.data.meshId] ?? null
      : drawnMesh(document, object)
    if (!mesh) return null
    const slots = object.materialSlots.length > 0 ? object.materialSlots : [document.materials[0]?.id ?? '']
    const { geometry, groups } = geometryOf(mesh)
    const used = [...new Set(groups.map((group) => group.material))].sort((a, b) => a - b)
    if (used.length <= 1) return new Mesh(geometry, materialFor(slots[used[0] ?? 0]))
    for (const group of groups) geometry.addGroup(group.start, group.count, used.indexOf(group.material))
    return new Mesh(geometry, used.map((slot) => materialFor(slots[slot])))
  }
  if (object.data.kind === 'camera') {
    const data = object.data
    if (data.projection === 'orthographic') {
      const half = data.orthoScale / 2
      return new OrthographicCamera(-half, half, half, -half, data.clipStart, data.clipEnd)
    }
    return new PerspectiveCamera(fovFromFocalLength(data.focalLength, data.sensor), 1, data.clipStart, data.clipEnd)
  }
  if (object.data.kind === 'light') {
    const data = object.data
    const colour = new Color(data.color)
    // Watts to the intensity the extension speaks in, the same conversion the viewport makes.
    const intensity = data.light === 'sun' ? data.power : data.power / 40
    if (data.light === 'sun') return new DirectionalLight(colour, intensity)
    if (data.light === 'spot') {
      const light = new SpotLight(colour, intensity)
      light.angle = ((data.spotAngle ?? 45) * Math.PI) / 360
      light.penumbra = data.spotBlur ?? 0.15
      return light
    }
    // An area light has no place in the extension; a point of the same power is the nearest thing.
    return new PointLight(colour, intensity)
  }
  // An empty is a node with nothing in it, which is exactly what glTF has for it.
  return object.data.kind === 'empty' ? new Group() : null
}

/** A `MeshData` as a triangulated geometry, with a group per material slot in use. */
function geometryOf(mesh: MeshData): { geometry: BufferGeometry; groups: Array<{ material: number; start: number; count: number }> } {
  const triangulation = cachedTriangulation(mesh)
  const order = [...Array(triangulation.triangleCount).keys()].sort((first, second) => (
    (mesh.attributes.face.material[triangulation.triangleFace[first] ?? 0] ?? 0)
    - (mesh.attributes.face.material[triangulation.triangleFace[second] ?? 0] ?? 0)
  ))
  const positions = new Float32Array(order.length * 9)
  const groups: Array<{ material: number; start: number; count: number }> = []
  order.forEach((triangle, index) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const slot = triangulation.indices[triangle * 3 + corner] ?? 0
      positions[index * 9 + corner * 3] = mesh.vertices[slot * 3] ?? 0
      positions[index * 9 + corner * 3 + 1] = mesh.vertices[slot * 3 + 1] ?? 0
      positions[index * 9 + corner * 3 + 2] = mesh.vertices[slot * 3 + 2] ?? 0
    }
    const material = mesh.attributes.face.material[triangulation.triangleFace[triangle] ?? 0] ?? 0
    const last = groups[groups.length - 1]
    if (last && last.material === material) last.count += 3
    else groups.push({ material, start: index * 3, count: 3 })
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return { geometry, groups }
}

function disposeScene(scene: Scene): void {
  scene.traverse((node) => {
    const mesh = node as Mesh
    mesh.geometry?.dispose?.()
    const material = mesh.material as ThreeMaterial | ThreeMaterial[] | undefined
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material?.dispose?.()
  })
}

/* -------------------------------------------------------------------- read */

export type ImportedScene = {
  objects: SceneObject[]
  meshes: Record<string, MeshData>
  materials: Material[]
}

/**
 * A glTF or GLB into the document's own shapes.
 *
 * The loader is asynchronous and works from an `ArrayBuffer`, which is what a dropped file gives.
 * Nodes become objects, their hierarchy is kept, and each geometry is welded back into a mesh with
 * shared vertices — a glTF splits a vertex per normal and per UV, so a cube arrives as thirty-six
 * corners and would be uneditable without it.
 */
export function importGltf(data: ArrayBuffer): Promise<ImportedScene> {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.parse(data, '', (gltf) => resolve(readScene(gltf.scene)), (error) => reject(error instanceof Error ? error : new Error(String(error))))
  })
}

/** The walk itself, which the tests use directly with a scene they built. */
export function readScene(root: Object3D): ImportedScene {
  const objects: SceneObject[] = []
  const meshes: Record<string, MeshData> = {}
  const materials: Material[] = []
  const named = new Map<string, string>()
  let counter = 0

  const materialIdFor = (source: ThreeMaterial | undefined): string => {
    const name = source?.name || 'Material'
    const kept = named.get(name)
    if (kept) return kept
    const id = `material-${crypto.randomUUID()}`
    const standard = source as MeshStandardMaterial | undefined
    materials.push({
      ...DEFAULT_MATERIAL,
      id,
      name,
      baseColor: `#${(standard?.color ?? new Color('#cccccc')).getHexString()}`,
      metallic: typeof standard?.metalness === 'number' ? standard.metalness : 0,
      roughness: typeof standard?.roughness === 'number' ? standard.roughness : 0.5,
      emission: `#${(standard?.emissive ?? new Color('#000000')).getHexString()}`,
      emissionStrength: typeof standard?.emissiveIntensity === 'number' ? standard.emissiveIntensity : 0,
      alpha: typeof standard?.opacity === 'number' ? standard.opacity : 1,
    })
    named.set(name, id)
    return id
  }

  const walk = (node: Object3D, parentId: string | undefined): void => {
    let id: string | undefined
    const mesh = node as Mesh
    if (mesh.isMesh && mesh.geometry) {
      counter += 1
      const meshId = `mesh-${crypto.randomUUID()}`
      meshes[meshId] = weldGeometry(mesh.geometry)
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      id = `object-${crypto.randomUUID()}`
      objects.push({
        id,
        name: node.name || `Mesh ${counter}`,
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        ...(parentId ? { parentId } : {}),
        transform: transformOf(node),
        visible: node.visible,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId },
        modifiers: [],
        materialSlots: list.map((entry) => materialIdFor(entry ?? undefined)),
      })
    } else if (node.children.length > 0 && node.parent) {
      // A node with children and no geometry is an empty, which is how glTF spells a group.
      id = `object-${crypto.randomUUID()}`
      objects.push({
        id,
        name: node.name || 'Empty',
        kind: 'empty',
        collectionId: ROOT_COLLECTION_ID,
        ...(parentId ? { parentId } : {}),
        transform: transformOf(node),
        visible: node.visible,
        selectable: true,
        renderable: true,
        data: { kind: 'empty', display: 'plain-axes', size: 1 },
        modifiers: [],
        materialSlots: [],
      })
    }
    for (const child of node.children) walk(child, id ?? parentId)
  }

  walk(root, undefined)
  return { objects, meshes, materials }
}

function transformOf(node: Object3D): SceneObject['transform'] {
  const euler = node.rotation
  return {
    position: [node.position.x, node.position.y, node.position.z],
    // Three's own Euler order is 'XYZ', which is Blender's 'ZYX' — the document's spelling.
    rotation: [(euler.x * 180) / Math.PI, (euler.y * 180) / Math.PI, (euler.z * 180) / Math.PI],
    scale: [node.scale.x, node.scale.y, node.scale.z],
    rotationMode: 'ZYX',
  }
}

/** Triangles from a geometry, with vertices shared again by position. */
function weldGeometry(geometry: BufferGeometry): MeshData {
  const position = geometry.getAttribute('position')
  if (!position) return meshFromPolygons([], [])
  const index = geometry.getIndex()
  const count = index ? index.count : position.count
  const cells = new Map<string, number>()
  const points: Vec3[] = []
  const slotOf = (at: number): number => {
    const point: Vec3 = [position.getX(at), position.getY(at), position.getZ(at)]
    const key = `${Math.round(point[0] / WELD)}|${Math.round(point[1] / WELD)}|${Math.round(point[2] / WELD)}`
    const seen = cells.get(key)
    if (seen !== undefined) return seen
    const slot = points.length
    cells.set(key, slot)
    points.push(point)
    return slot
  }
  const faces: number[][] = []
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const loop = [0, 1, 2].map((corner) => slotOf(index ? index.getX(triangle + corner) : triangle + corner))
    if (new Set(loop).size === 3) faces.push(loop)
  }
  return meshFromPolygons(points, faces)
}

/* --------------------------------------------------------------- animation */

/**
 * The scene's keyframes as glTF animation, baked frame by frame.
 *
 * A keyframe here is on a *control*, and a control may drive anything through a binding — a
 * transform, a modifier's parameter, a shape key. glTF animates nodes, so the only faithful way
 * across is to evaluate: the rig is resolved at every frame and each object's own transform is
 * written down as it comes out. That covers whatever the controls happen to drive, including the
 * curves and expressions a driver may hold, at the cost of a sample per frame rather than a
 * keyframe per key.
 *
 * What does not cross: anything that is not a node transform. A control driving a modifier or a
 * shape key changes the *shape* of a mesh, and glTF has no way of saying that outside morph targets
 * — so a scene whose animation deforms rather than moves exports still. The bilan says so.
 */
export function animationClips(document: SceneDocument): AnimationClip[] {
  const animation = document.rig?.animation
  if (!animation || animation.tracks.length === 0) return []
  const fps = Math.max(1, animation.fps)
  const frames = Math.max(1, Math.round(animation.duration * fps))
  const times: number[] = []
  const channels = new Map<string, { position: number[]; quaternion: number[]; scale: number[]; moved: boolean }>()
  const at = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()

  for (let frame = 0; frame <= frames; frame += 1) {
    const time = frame / fps
    times.push(time)
    const values: Record<string, ParamValue> = {}
    for (const track of animation.tracks) values[track.paramId] = interpolateNumber(track, time, animation.duration, false)
    const resolved = resolveSceneValues(document, values)
    for (const object of resolved.objects) {
      const entry = channels.get(object.id) ?? { position: [], quaternion: [], scale: [], moved: false }
      localMatrix(object).decompose(at, rotation, scale)
      const first = entry.position.length === 0
      if (!first && !entry.moved) {
        entry.moved = Math.abs(entry.position[0]! - at.x) > 1e-9
          || Math.abs(entry.position[1]! - at.y) > 1e-9
          || Math.abs(entry.position[2]! - at.z) > 1e-9
          || Math.abs(entry.quaternion[0]! - rotation.x) > 1e-9
          || Math.abs(entry.quaternion[1]! - rotation.y) > 1e-9
          || Math.abs(entry.quaternion[2]! - rotation.z) > 1e-9
          || Math.abs(entry.quaternion[3]! - rotation.w) > 1e-9
          || Math.abs(entry.scale[0]! - scale.x) > 1e-9
          || Math.abs(entry.scale[1]! - scale.y) > 1e-9
          || Math.abs(entry.scale[2]! - scale.z) > 1e-9
      }
      entry.position.push(at.x, at.y, at.z)
      entry.quaternion.push(rotation.x, rotation.y, rotation.z, rotation.w)
      entry.scale.push(scale.x, scale.y, scale.z)
      channels.set(object.id, entry)
    }
  }

  const tracks: KeyframeTrack[] = []
  for (const object of document.objects) {
    const entry = channels.get(object.id)
    // Only what actually moves: a file with a still track per object is a file three times too big.
    if (!entry || !entry.moved) continue
    const name = object.name || object.id
    tracks.push(new VectorKeyframeTrack(`${name}.position`, times, entry.position))
    tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, times, entry.quaternion))
    tracks.push(new VectorKeyframeTrack(`${name}.scale`, times, entry.scale))
  }
  if (tracks.length === 0) return []
  return [new AnimationClip('Scene', animation.duration, tracks)]
}
