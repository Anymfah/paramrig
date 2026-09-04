import { readStore, writeStore, type StorageResult } from '@/editor/storage'
import { BUNDLED_SCENES } from '@/rigs/examples/paper-lantern'
import { readSceneSettings } from '@/scene/prefs'
import type { RigManifest } from '@/rigs/types'
import { cloneMesh, meshCounts, validateMeshData } from '@/scene/mesh/data'
import { boxMesh } from '@/scene/mesh/primitives'
import { MAX_PITCH } from '@/scene/viewport/view'
import { MODIFIER_KINDS } from '@/scene/types'
import { DEFAULT_SCULPT_STATE } from '@/scene/sculpt/session'
import { sanitizeSceneRig, sceneRigTargets } from '@/scene/rig'
import type {
  Collection,
  EmptyDisplay,
  Material,
  MeshData,
  Modifier,
  ModifierKind,
  ObjectData,
  SceneDocument,
  SceneObject,
  SceneUnits,
  SceneVersion,
  SculptState,
  TextureSlot,
  Transform,
  UvEditorState,
  Vec2,
  Vec3,
  ViewState,
  World,
} from '@/scene/types'

export { STORAGE_BLOCKED_MESSAGE, STORAGE_FULL_MESSAGE, storageMessage, type StorageResult } from '@/editor/storage'

const STORAGE_KEY = 'paramrig.scene-documents.v1'

export const ROOT_COLLECTION_ID = 'scene-collection'
export const ROOT_COLLECTION_NAME = 'Scene Collection'
export const MAX_VERSIONS = 20

/** Anything larger than this, serialised, is written compactly before it is stored. */
export const COMPACT_THRESHOLD_BYTES = 5_000_000
/** Above this a document does not go into browser storage at all; the user is offered a file. */
export const MAX_STORED_BYTES = 20_000_000

export const DEFAULT_MATERIAL: Material = {
  id: 'material-default',
  name: 'Material',
  baseColor: '#cccccc',
  metallic: 0,
  roughness: 0.5,
  specular: 0.5,
  ior: 1.45,
  transmission: 0,
  emission: '#000000',
  emissionStrength: 0,
  alpha: 1,
  normalStrength: 1,
  backfaceCulling: false,
  blendMode: 'opaque',
}

export const DEFAULT_WORLD: World = { color: '#3b3b3b', strength: 1 }

export const DEFAULT_UNITS: SceneUnits = { system: 'metric', scale: 1 }

/**
 * The UV editor as it opens for the first time.
 *
 * The checker rather than the material's own image, which is where this departs from Blender. A
 * texture only says where a map lands once somebody has painted one; a checker says whether the map
 * is even and square before anything has been painted at all, which is what a person opening this
 * for the first time is looking at it to find out.
 */
export const DEFAULT_UV_EDITOR: UvEditorState = {
  open: false,
  split: 0.55,
  background: 'checker',
  grid: true,
  selectMode: 'vertex',
  sync: false,
  stretch: 'none',
}

export const DEFAULT_VIEW: ViewState = {
  target: [0, 0, 0],
  // Blender's startup view: three quarters from the front left, looking slightly down.
  yaw: 46,
  pitch: 27,
  distance: 17.5,
  projection: 'perspective',
  focalLength: 50,
  clipStart: 0.01,
  clipEnd: 1000,
  shading: 'solid',
  studio: 'default',
  solid: {
    lighting: 'studio',
    matcap: 'basic',
    colour: 'material',
    single: '#b4b4b4',
    background: 'theme',
    backfaceCulling: false,
    cavity: false,
    cavityStrength: 0.5,
    shadow: false,
    outline: true,
    specular: true,
  },
  xray: false,
  xrayAlpha: 0.5,
  wireframeOpacity: 0.5,
  wireframeThreshold: 1,
  overlays: {
    grid: true,
    floor: true,
    axisX: true,
    axisY: true,
    axisZ: false,
    cursor: true,
    outline: true,
    extras: true,
    wireframe: false,
    faceOrientation: false,
    normals: false,
    normalLength: 0.2,
    statistics: false,
    textInfo: true,
    seams: true,
    sharp: true,
    creases: true,
    bevelWeight: false,
    faceCentres: true,
    indices: false,
    edgeLength: false,
    edgeAngle: false,
    faceArea: false,
  },
  gizmos: { navigate: true, move: false, rotate: false, scale: false, object: true },
  mode: 'object',
  selectMode: ['vertex'],
  tool: 'select-box',
  pivot: 'median',
  orientation: 'global',
  snapEnabled: false,
  snapMode: 'increment',
  snapTarget: 'closest',
  symmetry: { x: false, y: false, z: false },
  proportional: false,
  proportionalFalloff: 'smooth',
  proportionalSize: 1,
  panels: { toolbar: true, sidebar: false, sidebarTab: 'item' },
  uv: DEFAULT_UV_EDITOR,
  sculpt: DEFAULT_SCULPT_STATE,
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

/**
 * A new document, laid out like Blender's startup file: one cube on the origin, a point light
 * above and to the side, and a camera looking back at the cube from three quarters.
 */
export function createSceneDocument(name = 'Untitled'): SceneDocument {
  const now = new Date().toISOString()
  const meshId = newId('mesh')
  // The matcap a new scene wears is a preference: it is what this person likes to model against.
  const view: ViewState = structuredClone(DEFAULT_VIEW)
  if (view.solid) view.solid.matcap = readSceneSettings().preferences.matcap
  const document: SceneDocument = {
    version: 1,
    id: newId('scene'),
    name,
    objects: [
      {
        id: newId('object'),
        name: 'Cube',
        kind: 'mesh',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: { kind: 'mesh', meshId },
        modifiers: [],
        materialSlots: [DEFAULT_MATERIAL.id],
      },
      {
        id: newId('object'),
        name: 'Light',
        kind: 'light',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [4.08, 1.01, 5.9], rotation: [37.3, 3.2, 107.0], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: {
          kind: 'light',
          light: 'point',
          color: '#ffffff',
          power: 1000,
          radius: 0.1,
          spotAngle: 45,
          spotBlur: 0.15,
          areaShape: 'square',
          areaSize: [1, 1],
          shadow: true,
        },
        modifiers: [],
        materialSlots: [],
      },
      {
        id: newId('object'),
        name: 'Camera',
        kind: 'camera',
        collectionId: ROOT_COLLECTION_ID,
        transform: { position: [7.36, -6.93, 4.96], rotation: [63.6, 0, 46.7], scale: [1, 1, 1] },
        visible: true,
        selectable: true,
        renderable: true,
        data: {
          kind: 'camera',
          projection: 'perspective',
          focalLength: 50,
          sensor: 36,
          orthoScale: 6,
          clipStart: 0.1,
          clipEnd: 100,
          active: true,
        },
        modifiers: [],
        materialSlots: [],
      },
    ],
    meshes: { [meshId]: boxMesh(2) },
    collections: [{ id: ROOT_COLLECTION_ID, name: ROOT_COLLECTION_NAME }],
    materials: [{ ...DEFAULT_MATERIAL }],
    world: { ...DEFAULT_WORLD },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
    view,
    units: { ...DEFAULT_UNITS },
    createdAt: now,
    updatedAt: now,
  }
  saveSceneDocument(document)
  return document
}

/* ---------------------------------------------------------------- reading */

/** The mesh an object shows, or null for an object that is not a mesh. */
export function meshOf(document: SceneDocument, object: SceneObject): MeshData | null {
  if (object.data.kind !== 'mesh') return null
  return document.meshes[object.data.meshId] ?? null
}

/** The same document with one mesh replaced; every other mesh and object is shared, not copied. */
export function withMesh(document: SceneDocument, meshId: string, mesh: MeshData): SceneDocument {
  return { ...document, meshes: { ...document.meshes, [meshId]: mesh } }
}

/** How many objects use a mesh: one means editing it is safe, more means it is a linked duplicate. */
export function meshUsers(document: SceneDocument, meshId: string): number {
  return document.objects.filter((object) => object.data.kind === 'mesh' && object.data.meshId === meshId).length
}

export function objectById(document: SceneDocument, id: string): SceneObject | null {
  return document.objects.find((object) => object.id === id) ?? null
}

export function collectionById(document: SceneDocument, id: string): Collection | null {
  return document.collections.find((collection) => collection.id === id) ?? null
}

export function rootCollection(document: SceneDocument): Collection {
  return document.collections[0] ?? { id: ROOT_COLLECTION_ID, name: ROOT_COLLECTION_NAME }
}

/** Everything under an object, so deleting or hiding a parent can take its children with it. */
export function descendantObjectIds(document: SceneDocument, id: string): string[] {
  const found: string[] = []
  const walk = (parentId: string) => {
    for (const object of document.objects) {
      if (object.parentId !== parentId || found.includes(object.id)) continue
      found.push(object.id)
      walk(object.id)
    }
  }
  walk(id)
  return found
}

export function collectionAncestors(document: SceneDocument, id: string): string[] {
  const chain: string[] = []
  let current = collectionById(document, id)
  while (current?.parentId) {
    if (chain.includes(current.parentId)) break
    chain.push(current.parentId)
    current = collectionById(document, current.parentId)
  }
  return chain
}

/** Whether anything above an object hides it: its collection, or a collection above that. */
export function collectionHidden(document: SceneDocument, collectionId: string): boolean {
  for (const id of [collectionId, ...collectionAncestors(document, collectionId)]) {
    const collection = collectionById(document, id)
    if (collection?.hidden || collection?.excluded) return true
  }
  return false
}

export type SceneCounts = { objects: number; vertices: number; edges: number; faces: number; triangles: number }

/** The status bar's numbers, over the objects that are actually drawn. */
export function sceneCounts(document: SceneDocument): SceneCounts {
  const counts: SceneCounts = { objects: 0, vertices: 0, edges: 0, faces: 0, triangles: 0 }
  for (const object of document.objects) {
    counts.objects += 1
    const mesh = meshOf(document, object)
    if (!mesh) continue
    const own = meshCounts(mesh)
    counts.vertices += own.vertices
    counts.edges += own.edges
    counts.faces += own.faces
    counts.triangles += own.triangles
  }
  return counts
}

/**
 * Blender's naming: the first is "Cube", the next "Cube.001". A name is unique in a document, so
 * F2 and the outliner never show two objects a person cannot tell apart.
 */
export function uniqueName(taken: Iterable<string>, base: string): string {
  const names = new Set(taken)
  const stem = base.replace(/\.\d{3}$/, '')
  if (!names.has(stem)) return stem
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${stem}.${String(index).padStart(3, '0')}`
    if (!names.has(candidate)) return candidate
  }
  return `${stem}.${Date.now().toString(36)}`
}

export function uniqueObjectName(document: SceneDocument, base: string): string {
  return uniqueName(document.objects.map((object) => object.name), base)
}

/* -------------------------------------------------------------- sanitising */

const OBJECT_KINDS = ['mesh', 'light', 'camera', 'empty', 'curve', 'text'] as const
const EMPTY_DISPLAYS: EmptyDisplay[] = ['plain-axes', 'arrows', 'single-arrow', 'cube', 'sphere', 'circle', 'cone', 'image']

function num(value: unknown, fallback: number, min = -1e9, max = 1e9): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function vec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return [...fallback]
  return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])]
}

function vec2(value: unknown, fallback: Vec2): Vec2 {
  if (!Array.isArray(value) || value.length < 2) return [...fallback]
  return [num(value[0], fallback[0]), num(value[1], fallback[1])]
}

function text(value: unknown, fallback: string, max = 120): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
}

function color(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return /^#[0-9a-f]{3,8}$/i.test(trimmed) ? trimmed : fallback
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

function transform(value: unknown): Transform {
  const source = (value ?? {}) as Partial<Transform>
  const mode = source.rotationMode === 'quaternion'
    ? 'quaternion' as const
    : pick(source.rotationMode, ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'] as const, 'XYZ')
  return {
    position: vec3(source.position, [0, 0, 0]),
    rotation: vec3(source.rotation, [0, 0, 0]),
    scale: vec3(source.scale, [1, 1, 1]),
    rotationMode: mode,
    ...(mode === 'quaternion' && Array.isArray(source.quaternion) && source.quaternion.length === 4
      ? { quaternion: [num(source.quaternion[0], 0), num(source.quaternion[1], 0), num(source.quaternion[2], 0), num(source.quaternion[3], 1)] as [number, number, number, number] }
      : {}),
  }
}

function objectData(value: unknown, kind: string, meshIds: Set<string>): ObjectData | null {
  const source = (value ?? {}) as Record<string, unknown>
  const dataKind = typeof source.kind === 'string' ? source.kind : kind
  if (dataKind === 'mesh') {
    const meshId = typeof source.meshId === 'string' ? source.meshId : null
    if (!meshId || !meshIds.has(meshId)) return null
    return { kind: 'mesh', meshId }
  }
  if (dataKind === 'light') {
    return {
      kind: 'light',
      light: pick(source.light, ['point', 'sun', 'spot', 'area'] as const, 'point'),
      color: color(source.color, '#ffffff'),
      power: num(source.power, 1000, 0, 1e7),
      radius: num(source.radius, 0.1, 0, 100),
      spotAngle: num(source.spotAngle, 45, 1, 180),
      spotBlur: num(source.spotBlur, 0.15, 0, 1),
      areaShape: pick(source.areaShape, ['square', 'rectangle', 'disk', 'ellipse'] as const, 'square'),
      areaSize: vec2(source.areaSize, [1, 1]),
      shadow: source.shadow !== false,
      ...(source.distance === undefined ? {} : { distance: num(source.distance, 0, 0, 1e6) }),
    }
  }
  if (dataKind === 'camera') {
    return {
      kind: 'camera',
      projection: pick(source.projection, ['perspective', 'orthographic'] as const, 'perspective'),
      focalLength: num(source.focalLength, 50, 1, 5000),
      sensor: num(source.sensor, 36, 1, 200),
      orthoScale: num(source.orthoScale, 6, 0.001, 1e5),
      ...(source.shiftX === undefined ? {} : { shiftX: num(source.shiftX, 0, -10, 10) }),
      ...(source.shiftY === undefined ? {} : { shiftY: num(source.shiftY, 0, -10, 10) }),
      clipStart: num(source.clipStart, 0.1, 1e-6, 1e5),
      clipEnd: num(source.clipEnd, 100, 1e-3, 1e7),
      ...(source.depthOfField && typeof source.depthOfField === 'object'
        ? {
          depthOfField: {
            enabled: !!(source.depthOfField as { enabled?: unknown }).enabled,
            focusDistance: num((source.depthOfField as { focusDistance?: unknown }).focusDistance, 10, 0, 1e5),
            fStop: num((source.depthOfField as { fStop?: unknown }).fStop, 2.8, 0.1, 1000),
          },
        }
        : {}),
      ...(source.active ? { active: true } : {}),
    }
  }
  return {
    kind: 'empty',
    display: pick(source.display, EMPTY_DISPLAYS, 'plain-axes'),
    size: num(source.size, 1, 0.001, 1e4),
    ...(typeof source.instanceCollectionId === 'string' ? { instanceCollectionId: source.instanceCollectionId } : {}),
  }
}

function modifiers(value: unknown): Modifier[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): Modifier[] => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as Partial<Modifier>
    if (!MODIFIER_KINDS.includes(source.kind as ModifierKind)) return []
    const enabled = (source.enabled ?? {}) as Partial<Modifier['enabled']>
    return [{
      id: text(source.id, `modifier-${crypto.randomUUID()}`, 80),
      kind: source.kind as Modifier['kind'],
      name: text(source.name, String(source.kind), 80),
      enabled: {
        viewport: enabled.viewport !== false,
        render: enabled.render !== false,
        editMode: !!enabled.editMode,
        onCage: !!enabled.onCage,
      },
      params: source.params && typeof source.params === 'object' && !Array.isArray(source.params) ? { ...source.params } : {},
    }]
  })
}

function material(value: unknown): Material | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<Material>
  if (typeof source.id !== 'string' || !source.id) return null
  return {
    id: source.id.slice(0, 80),
    name: text(source.name, 'Material', 80),
    baseColor: color(source.baseColor, DEFAULT_MATERIAL.baseColor),
    metallic: num(source.metallic, 0, 0, 1),
    roughness: num(source.roughness, 0.5, 0, 1),
    specular: num(source.specular, 0.5, 0, 1),
    ior: num(source.ior, 1.45, 1, 4),
    transmission: num(source.transmission, 0, 0, 1),
    emission: color(source.emission, '#000000'),
    emissionStrength: num(source.emissionStrength, 0, 0, 1000),
    alpha: num(source.alpha, 1, 0, 1),
    normalStrength: num(source.normalStrength, 1, 0, 10),
    backfaceCulling: !!source.backfaceCulling,
    blendMode: pick(source.blendMode, ['opaque', 'blend', 'clip'] as const, 'opaque'),
    ...(source.textures && typeof source.textures === 'object' ? { textures: textureSlots(source.textures) } : {}),
  }
}

/**
 * The image slots of a material, read one field at a time.
 *
 * They used to be passed through as they arrived, which meant a hand-edited file could put a
 * number where a resource id belongs and the renderer would ask the store for it. A slot with no
 * usable id is dropped rather than kept empty: a material carries the maps it has.
 */
function textureSlots(value: object): NonNullable<Material['textures']> {
  const names = ['baseColor', 'roughness', 'metallic', 'normal', 'emission'] as const
  const source = value as Record<string, unknown>
  const slots: Record<string, TextureSlot> = {}
  for (const name of names) {
    const slot = source[name]
    if (!slot || typeof slot !== 'object') continue
    const entry = slot as Partial<TextureSlot>
    if (typeof entry.resourceId !== 'string' || entry.resourceId === '') continue
    slots[name] = {
      resourceId: entry.resourceId.slice(0, 80),
      ...(entry.name === undefined ? {} : { name: text(entry.name, '', 120) }),
      ...(entry.scale === undefined ? {} : { scale: vec2(entry.scale, [1, 1]) }),
      ...(entry.offset === undefined ? {} : { offset: vec2(entry.offset, [0, 0]) }),
    }
  }
  return slots
}

function viewState(value: unknown): ViewState {
  const source = (value ?? {}) as Partial<ViewState>
  const overlays = (source.overlays ?? {}) as Partial<ViewState['overlays']>
  const gizmos = (source.gizmos ?? {}) as Partial<ViewState['gizmos']>
  const panels = (source.panels ?? {}) as Partial<NonNullable<ViewState['panels']>>
  const uv = (source.uv ?? {}) as Partial<UvEditorState>
  const sculpt = (source.sculpt ?? {}) as Partial<SculptState>
  const sculptSymmetry = (sculpt.symmetry ?? {}) as Partial<SculptState['symmetry']>
  const modes = Array.isArray(source.selectMode)
    ? source.selectMode.filter((mode): mode is 'vertex' | 'edge' | 'face' => mode === 'vertex' || mode === 'edge' || mode === 'face')
    : []
  const flag = (given: unknown, fallback: boolean) => (typeof given === 'boolean' ? given : fallback)
  const number = (given: unknown, fallback: number, low: number, high: number) => (
    typeof given === 'number' && Number.isFinite(given) ? Math.min(high, Math.max(low, given)) : fallback
  )
  return {
    target: vec3(source.target, DEFAULT_VIEW.target),
    yaw: num(source.yaw, DEFAULT_VIEW.yaw, -1e5, 1e5),
    pitch: num(source.pitch, DEFAULT_VIEW.pitch, -MAX_PITCH, MAX_PITCH),
    distance: num(source.distance, DEFAULT_VIEW.distance, 1e-4, 1e6),
    projection: pick(source.projection, ['perspective', 'orthographic'] as const, 'perspective'),
    focalLength: num(source.focalLength, 50, 1, 5000),
    clipStart: num(source.clipStart, 0.01, 1e-6, 1e4),
    clipEnd: num(source.clipEnd, 1000, 1e-3, 1e7),
    shading: pick(source.shading, ['wireframe', 'solid', 'material', 'rendered'] as const, 'solid'),
    studio: text(source.studio, 'default', 60),
    solid: readSolid(source.solid),
    xray: !!source.xray,
    xrayAlpha: num(source.xrayAlpha, 0.5, 0, 1),
    wireframeOpacity: num(source.wireframeOpacity, 0.5, 0, 1),
    wireframeThreshold: num(source.wireframeThreshold, 1, 0, 1),
    overlays: {
      grid: flag(overlays.grid, true),
      floor: flag(overlays.floor, true),
      axisX: flag(overlays.axisX, true),
      axisY: flag(overlays.axisY, true),
      axisZ: flag(overlays.axisZ, false),
      cursor: flag(overlays.cursor, true),
      outline: flag(overlays.outline, true),
      extras: flag(overlays.extras, true),
      wireframe: flag(overlays.wireframe, false),
      faceOrientation: flag(overlays.faceOrientation, false),
      normals: flag(overlays.normals, false),
      normalLength: number(overlays.normalLength, 0.2, 0.001, 100),
      statistics: flag(overlays.statistics, false),
      textInfo: flag(overlays.textInfo, true),
      seams: flag(overlays.seams, true),
      sharp: flag(overlays.sharp, true),
      creases: flag(overlays.creases, true),
      bevelWeight: flag(overlays.bevelWeight, false),
      faceCentres: flag(overlays.faceCentres, true),
      indices: flag(overlays.indices, false),
      edgeLength: flag(overlays.edgeLength, false),
      edgeAngle: flag(overlays.edgeAngle, false),
      faceArea: flag(overlays.faceArea, false),
    },
    gizmos: {
      navigate: flag(gizmos.navigate, true),
      move: flag(gizmos.move, false),
      rotate: flag(gizmos.rotate, false),
      scale: flag(gizmos.scale, false),
      object: flag(gizmos.object, true),
    },
    mode: pick(source.mode, ['object', 'edit', 'sculpt'] as const, 'object'),
    selectMode: modes.length ? modes : ['vertex'],
    tool: pick(source.tool, ['select-box', 'select-circle', 'select-lasso', 'cursor', 'move', 'rotate', 'scale', 'transform', 'annotate', 'measure'] as const, 'select-box'),
    pivot: pick(source.pivot, ['bounding-box', 'cursor', 'individual', 'median', 'active'] as const, 'median'),
    orientation: pick(source.orientation, ['global', 'local', 'normal', 'gimbal', 'view', 'cursor'] as const, 'global'),
    snapEnabled: !!source.snapEnabled,
    snapMode: pick(source.snapMode, ['increment', 'vertex', 'edge', 'face', 'volume', 'edge-center', 'edge-perpendicular'] as const, 'increment'),
    snapTarget: pick(source.snapTarget, ['closest', 'center', 'median', 'active'] as const, 'closest'),
    symmetry: {
      x: flag((source.symmetry as Record<string, unknown> | undefined)?.x, false),
      y: flag((source.symmetry as Record<string, unknown> | undefined)?.y, false),
      z: flag((source.symmetry as Record<string, unknown> | undefined)?.z, false),
    },
    proportional: !!source.proportional,
    proportionalFalloff: pick(source.proportionalFalloff, ['smooth', 'sphere', 'root', 'inverse-square', 'sharp', 'linear', 'constant', 'random'] as const, 'smooth'),
    proportionalSize: num(source.proportionalSize, 1, 1e-4, 1e4),
    ...(source.camera === undefined ? {} : {
      camera: {
        looking: !!source.camera.looking,
        ...(source.camera.lock === undefined ? {} : { lock: !!source.camera.lock }),
        ...(source.camera.passepartout === undefined ? {} : { passepartout: num(source.camera.passepartout, 0.5, 0, 1) }),
      },
    }),
    ...(Array.isArray(source.localObjectIds) ? { localObjectIds: source.localObjectIds.filter((id): id is string => typeof id === 'string') } : {}),
    panels: {
      toolbar: panels.toolbar !== false,
      sidebar: !!panels.sidebar,
      sidebarTab: pick(panels.sidebarTab, ['item', 'tool', 'view', 'assets'] as const, 'item'),
    },
    uv: {
      open: !!uv.open,
      split: num(uv.split, DEFAULT_UV_EDITOR.split, 0.2, 0.8),
      background: pick(uv.background, ['texture', 'checker', 'none'] as const, DEFAULT_UV_EDITOR.background),
      grid: flag(uv.grid, DEFAULT_UV_EDITOR.grid),
      selectMode: pick(uv.selectMode, ['vertex', 'edge', 'face', 'island'] as const, DEFAULT_UV_EDITOR.selectMode),
      sync: flag(uv.sync, DEFAULT_UV_EDITOR.sync),
      stretch: pick(uv.stretch, ['none', 'angle', 'area'] as const, DEFAULT_UV_EDITOR.stretch),
    },
    sculpt: {
      brush: pick(sculpt.brush, SCULPT_BRUSHES, DEFAULT_SCULPT_STATE.brush),
      size: num(sculpt.size, DEFAULT_SCULPT_STATE.size, 2, 500),
      strength: num(sculpt.strength, DEFAULT_SCULPT_STATE.strength, 0, 2),
      falloff: pick(sculpt.falloff, FALLOFFS, DEFAULT_SCULPT_STATE.falloff),
      symmetry: {
        x: flag(sculptSymmetry.x, false),
        y: flag(sculptSymmetry.y, false),
        z: flag(sculptSymmetry.z, false),
      },
      autoSmooth: num(sculpt.autoSmooth, DEFAULT_SCULPT_STATE.autoSmooth, 0, 1),
      frontFacesOnly: flag(sculpt.frontFacesOnly, DEFAULT_SCULPT_STATE.frontFacesOnly),
    },
  }
}

/** The brushes a document may name, as a list the sanitiser can read at run time. */
const SCULPT_BRUSHES = [
  'draw', 'draw-sharp', 'clay', 'clay-strips', 'inflate', 'blob', 'crease',
  'smooth', 'flatten', 'fill', 'scrape', 'pinch',
  'grab', 'elastic', 'snake-hook', 'thumb', 'nudge', 'rotate', 'mask',
] as const

const FALLOFFS = ['smooth', 'sphere', 'root', 'inverse-square', 'sharp', 'linear', 'constant', 'random'] as const

/**
 * Reads a document from storage or from a file, keeping only what the editor can draw.
 *
 * Every invariant the rest of the code relies on is established here: ids are unique, a parent and
 * a collection that are named exist, a mesh an object points at exists, a material slot points at a
 * material, and a mesh is valid on its own terms.
 */
/** Solid shading's own settings, each read the way the rest of the view is: a fallback, never a NaN. */
function readSolid(value: unknown): NonNullable<ViewState['solid']> {
  const source = (value ?? {}) as Partial<NonNullable<ViewState['solid']>>
  const fallback = DEFAULT_VIEW.solid!
  const one = <Option extends string>(given: unknown, options: readonly Option[], other: Option): Option => (
    options.includes(given as Option) ? (given as Option) : other
  )
  return {
    lighting: one(source.lighting, ['studio', 'matcap', 'flat'] as const, fallback.lighting),
    matcap: typeof source.matcap === 'string' && source.matcap.length <= 60 ? source.matcap : fallback.matcap,
    colour: one(source.colour, ['material', 'object', 'single', 'random', 'texture'] as const, fallback.colour),
    single: typeof source.single === 'string' && source.single.length <= 32 ? source.single : fallback.single,
    background: one(source.background, ['theme', 'world', 'viewport'] as const, fallback.background),
    backfaceCulling: typeof source.backfaceCulling === 'boolean' ? source.backfaceCulling : fallback.backfaceCulling,
    cavity: typeof source.cavity === 'boolean' ? source.cavity : fallback.cavity,
    cavityStrength: typeof source.cavityStrength === 'number' && Number.isFinite(source.cavityStrength)
      ? Math.min(2, Math.max(0, source.cavityStrength))
      : fallback.cavityStrength,
    shadow: typeof source.shadow === 'boolean' ? source.shadow : fallback.shadow,
    outline: typeof source.outline === 'boolean' ? source.outline : fallback.outline,
    specular: typeof source.specular === 'boolean' ? source.specular : fallback.specular,
  }
}

export function sanitizeSceneDocument(value: unknown): SceneDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<SceneDocument>
  if (typeof source.id !== 'string' || !source.id) return null

  const meshes: Record<string, MeshData> = {}
  if (source.meshes && typeof source.meshes === 'object' && !Array.isArray(source.meshes)) {
    for (const [id, mesh] of Object.entries(source.meshes)) {
      const valid = validateMeshData(mesh)
      if (valid) meshes[id] = valid
    }
  }
  const meshIds = new Set(Object.keys(meshes))

  const collections: Collection[] = []
  const collectionIds = new Set<string>()
  const rawCollections = Array.isArray(source.collections) ? source.collections : []
  for (const entry of rawCollections) {
    if (!entry || typeof entry !== 'object') continue
    const collection = entry as Partial<Collection>
    if (typeof collection.id !== 'string' || !collection.id || collectionIds.has(collection.id)) continue
    collectionIds.add(collection.id)
    collections.push({
      id: collection.id.slice(0, 80),
      name: text(collection.name, 'Collection', 80),
      ...(typeof collection.parentId === 'string' ? { parentId: collection.parentId } : {}),
      ...(collection.excluded ? { excluded: true } : {}),
      ...(collection.hidden ? { hidden: true } : {}),
      ...(collection.selectable === false ? { selectable: false } : {}),
      ...(typeof collection.color === 'string' ? { color: collection.color.slice(0, 40) } : {}),
    })
  }
  if (collections.length === 0) {
    collections.push({ id: ROOT_COLLECTION_ID, name: ROOT_COLLECTION_NAME })
    collectionIds.add(ROOT_COLLECTION_ID)
  }
  const rootId = collections[0]!.id
  // A collection whose parent is missing, or which loops back on itself, hangs off the root.
  for (const collection of collections) {
    if (collection.id === rootId) {
      delete collection.parentId
      continue
    }
    if (!collection.parentId || !collectionIds.has(collection.parentId) || collection.parentId === collection.id) {
      collection.parentId = rootId
    }
  }
  for (const collection of collections) {
    const seen = new Set<string>([collection.id])
    let cursor = collection.parentId
    while (cursor) {
      if (seen.has(cursor)) {
        collection.parentId = rootId
        break
      }
      seen.add(cursor)
      cursor = collections.find((item) => item.id === cursor)?.parentId
    }
  }

  const materials = (Array.isArray(source.materials) ? source.materials : []).flatMap((entry) => {
    const read = material(entry)
    return read ? [read] : []
  })
  const materialIds = new Set(materials.map((entry) => entry.id))
  if (materials.length === 0) {
    materials.push({ ...DEFAULT_MATERIAL })
    materialIds.add(DEFAULT_MATERIAL.id)
  }

  const objects: SceneObject[] = []
  const objectIds = new Set<string>()
  const names = new Set<string>()
  for (const entry of Array.isArray(source.objects) ? source.objects : []) {
    if (!entry || typeof entry !== 'object') continue
    const object = entry as Partial<SceneObject>
    if (typeof object.id !== 'string' || !object.id || objectIds.has(object.id)) continue
    const kind = pick(object.kind, OBJECT_KINDS, 'empty')
    const data = objectData(object.data, kind, meshIds)
    // A mesh object whose mesh is gone is not an object the editor can show, so it is dropped.
    if (!data) continue
    objectIds.add(object.id)
    const name = uniqueName(names, text(object.name, kind === 'mesh' ? 'Object' : kind[0]!.toUpperCase() + kind.slice(1), 120))
    names.add(name)
    objects.push({
      id: object.id.slice(0, 80),
      name,
      kind: data.kind === 'mesh' ? 'mesh' : data.kind,
      ...(typeof object.parentId === 'string' ? { parentId: object.parentId } : {}),
      ...(Array.isArray(object.parentInverse) && object.parentInverse.length === 16
        ? { parentInverse: object.parentInverse.map((item) => num(item, 0)) }
        : {}),
      collectionId: typeof object.collectionId === 'string' && collectionIds.has(object.collectionId) ? object.collectionId : rootId,
      transform: transform(object.transform),
      visible: object.visible !== false,
      selectable: object.selectable !== false,
      renderable: object.renderable !== false,
      ...(object.origin ? { origin: vec3(object.origin, [0, 0, 0]) } : {}),
      data,
      modifiers: modifiers(object.modifiers),
      materialSlots: (Array.isArray(object.materialSlots) ? object.materialSlots : [])
        .filter((id): id is string => typeof id === 'string' && materialIds.has(id))
        .slice(0, 32),
      ...(object.displayAs ? { displayAs: pick(object.displayAs, ['textured', 'solid', 'wire', 'bounds'] as const, 'textured') } : {}),
      ...(object.inFront ? { inFront: true } : {}),
      ...(typeof object.color === 'string' ? { color: object.color.slice(0, 40) } : {}),
    })
  }
  // A parent that does not exist, or a cycle, leaves the object at the top level.
  for (const object of objects) {
    if (!object.parentId) continue
    if (!objectIds.has(object.parentId) || object.parentId === object.id) {
      delete object.parentId
      continue
    }
    const seen = new Set<string>([object.id])
    let cursor: string | undefined = object.parentId
    while (cursor) {
      if (seen.has(cursor)) {
        delete object.parentId
        break
      }
      seen.add(cursor)
      cursor = objects.find((item) => item.id === cursor)?.parentId
    }
  }
  // A mesh with a material slot needs at least one, or its faces have nothing to point at.
  for (const object of objects) {
    if (object.kind !== 'mesh' || object.materialSlots.length > 0) continue
    object.materialSlots = [materials[0]!.id]
  }
  // At most one active camera; the first one wins.
  let seenActiveCamera = false
  for (const object of objects) {
    if (object.data.kind !== 'camera' || !object.data.active) continue
    if (seenActiveCamera) delete object.data.active
    else seenActiveCamera = true
  }
  // An empty that stands in for a collection needs one that exists.
  for (const object of objects) {
    if (object.data.kind !== 'empty' || !object.data.instanceCollectionId) continue
    if (!collectionIds.has(object.data.instanceCollectionId)) delete object.data.instanceCollectionId
  }

  // A mesh nothing points at is dead weight in storage.
  const usedMeshes = new Set(objects.flatMap((object) => (object.data.kind === 'mesh' ? [object.data.meshId] : [])))
  for (const id of Object.keys(meshes)) if (!usedMeshes.has(id)) delete meshes[id]

  const now = new Date().toISOString()
  return {
    version: 1,
    id: source.id.slice(0, 80),
    name: text(source.name, 'Untitled', 120),
    objects,
    meshes,
    collections,
    materials,
    world: {
      color: color(source.world?.color, DEFAULT_WORLD.color),
      strength: num(source.world?.strength, 1, 0, 100),
      ...(source.world?.environmentId === undefined ? {} : { environmentId: typeof source.world.environmentId === 'string' ? source.world.environmentId : null }),
      ...(source.world?.environmentName === undefined ? {} : { environmentName: text(source.world.environmentName, '', 120) }),
      ...(source.world?.environmentStrength === undefined ? {} : { environmentStrength: num(source.world.environmentStrength, 1, 0, 20) }),
      ...(source.world?.environmentRotation === undefined ? {} : { environmentRotation: num(source.world.environmentRotation, 0, -Math.PI * 4, Math.PI * 4) }),
      ...(source.world?.useForLighting === undefined ? {} : { useForLighting: !!source.world.useForLighting }),
      ...(source.world?.visibleAsBackground === undefined ? {} : { visibleAsBackground: !!source.world.visibleAsBackground }),
      ...(source.world?.fog === undefined ? {} : {
        fog: {
          enabled: !!source.world.fog?.enabled,
          density: num(source.world.fog?.density, 0.02, 0, 10),
          color: color(source.world.fog?.color, DEFAULT_WORLD.color),
        },
      }),
    },
    cursor: {
      position: vec3(source.cursor?.position, [0, 0, 0]),
      rotation: vec3(source.cursor?.rotation, [0, 0, 0]),
    },
    view: viewState(source.view),
    units: {
      system: pick(source.units?.system, ['metric', 'imperial', 'none'] as const, 'metric'),
      scale: num(source.units?.scale, 1, 1e-6, 1e6),
    },
    ...(source.output === undefined ? {} : {
      output: {
        width: Math.round(num(source.output?.width, 1920, 4, 16384)),
        height: Math.round(num(source.output?.height, 1080, 4, 16384)),
        percentage: Math.round(num(source.output?.percentage, 100, 1, 400)),
        transparent: !!source.output?.transparent,
      },
    }),
    ...(source.colorManagement === undefined ? {} : {
      colorManagement: {
        exposure: num(source.colorManagement?.exposure, 0, -10, 10),
        gamma: num(source.colorManagement?.gamma, 1, 0.1, 5),
      },
    }),
    ...(Array.isArray(source.annotations) && source.annotations.length
      ? {
        annotations: source.annotations.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const stroke = entry as Record<string, unknown>
          const points = Array.isArray(stroke.points) ? stroke.points.map((point) => vec3(point, [0, 0, 0])) : []
          if (points.length < 2) return []
          return [{ id: text(stroke.id, `annotation-${crypto.randomUUID()}`, 80), color: color(stroke.color, '#ffffff'), width: num(stroke.width, 2, 0.1, 40), points }]
        }),
      }
      : {}),
    ...(Array.isArray(source.measurements) && source.measurements.length
      ? {
        measurements: source.measurements.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const rule = entry as Record<string, unknown>
          return [{
            id: text(rule.id, `measure-${crypto.randomUUID()}`, 80),
            from: vec3(rule.from, [0, 0, 0]),
            to: vec3(rule.to, [0, 0, 0]),
            ...(rule.apex ? { apex: vec3(rule.apex, [0, 0, 0]) } : {}),
          }]
        }),
      }
      : {}),
    ...(source.rig ? { rig: sanitizeSceneRig(source.rig, sceneRigTargets({ objects, materials, meshes })) } : {}),
    ...(Array.isArray(source.versions) && source.versions.length ? { versions: sanitizeVersions(source.versions) } : {}),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
  }
}

function sanitizeVersions(value: unknown[]): SceneVersion[] {
  return value.flatMap((entry): SceneVersion[] => {
    if (!entry || typeof entry !== 'object') return []
    const version = entry as Partial<SceneVersion>
    if (typeof version.id !== 'string' || !Array.isArray(version.objects)) return []
    const meshes: Record<string, MeshData> = {}
    if (version.meshes && typeof version.meshes === 'object') {
      for (const [id, mesh] of Object.entries(version.meshes)) {
        const valid = validateMeshData(mesh)
        if (valid) meshes[id] = valid
      }
    }
    return [{
      id: version.id.slice(0, 80),
      name: text(version.name, 'Version', 80),
      createdAt: typeof version.createdAt === 'string' ? version.createdAt : new Date().toISOString(),
      objects: version.objects as SceneObject[],
      meshes,
      collections: Array.isArray(version.collections) ? version.collections : [],
      materials: Array.isArray(version.materials) ? version.materials : [],
    }]
  }).slice(-MAX_VERSIONS)
}

/* -------------------------------------------------------------- storage */

/**
 * The store as it was last read, so that reading it again costs nothing.
 *
 * Reading meant parsing every stored document and validating every mesh in it — hundreds of
 * milliseconds on a scene of a hundred thousand vertices — and every save reads before it writes.
 * A profile of an orbit over such a scene spent a quarter of its samples inside `validateMeshData`,
 * and a profile of a vertex move nearly two thirds. Nothing of that was needed: what this tab wrote
 * it has already validated.
 *
 * The cache is dropped when this tab writes, and when another tab does — a `storage` event fires
 * only in the tabs that did not make the change, which is exactly when it must be re-read.
 */
let store: Record<string, SceneDocument> | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === STORAGE_KEY) store = null
  })
}

/** Forgets the cache, for a test that writes to storage behind the store's back. */
export function clearSceneDocumentCache(): void {
  store = null
}

function readAll(): Record<string, SceneDocument> {
  if (!store) store = readStore(STORAGE_KEY, sanitizeSceneDocument)
  return store
}

/**
 * Every scene there is: what is stored, then whatever the app ships that has not been opened.
 *
 * A bundled example is a document like any other — the same shape, the same editor, the same rig —
 * so it is served from here rather than from a second registry the library would have to merge. It
 * stops being bundled the moment it is edited: saving writes it to storage under its own id, and
 * the stored one is what the next read finds.
 */
/** Built once, so a bundled document keeps one identity across every read that memoises on it. */
let bundled: SceneDocument[] | null = null

function bundledScenes(): SceneDocument[] {
  if (!bundled) bundled = BUNDLED_SCENES.map((make) => make())
  return bundled
}

export function listSceneDocuments(): SceneDocument[] {
  const stored = readAll()
  const bundled = bundledScenes().filter((document) => !stored[document.id])
  return [...Object.values(stored), ...bundled].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getSceneDocument(id: string): SceneDocument | null {
  return readAll()[id] ?? bundledScenes().find((document) => document.id === id) ?? null
}

/** Whether a document is the copy the app ships, rather than one this browser has written. */
export function isBundledScene(id: string): boolean {
  return bundledScenes().some((document) => document.id === id) && !readAll()[id]
}

/**
 * Writes a document to browser storage. A heavy document is compacted first — positions rounded to
 * a hundredth of a millimetre, no whitespace — and one that is heavy even so is refused rather
 * than silently truncated, so the editor can offer a file on disk instead.
 */
export function saveSceneDocument(document: SceneDocument): StorageResult {
  const documents = readAll()
  const clean = sanitizeSceneDocument(document) ?? document
  /*
   * Opening a bundled example is not editing it. The editor saves whatever it loads, so without
   * this a scene the app ships would be copied into storage by being looked at — and would then
   * be listed as a project of this browser's rather than as the example it still is.
   */
  if (!documents[clean.id] && unchangedBundle(clean)) return { ok: true }
  const size = JSON.stringify(clean).length
  documents[clean.id] = size > COMPACT_THRESHOLD_BYTES ? compactDocument(clean) : clean
  if (JSON.stringify(documents[clean.id]).length > MAX_STORED_BYTES) return { ok: false, reason: 'quota' }
  const result = writeStore(STORAGE_KEY, documents)
  // The cache is what was just written, whether or not the write landed: a refused write leaves
  // storage as it was, and `documents` is that plus the change this tab is holding in memory.
  store = documents
  return result
}

/** Whether a document is a bundled one that nothing has altered, down to the last number. */
function unchangedBundle(document: SceneDocument): boolean {
  const shipped = bundledScenes().find((entry) => entry.id === document.id)
  return !!shipped && JSON.stringify(sanitizeSceneDocument(shipped) ?? shipped) === JSON.stringify(document)
}

export function deleteSceneDocument(id: string): StorageResult {
  const documents = { ...readAll() }
  delete documents[id]
  store = documents
  return writeStore(STORAGE_KEY, documents)
}

/** Positions rounded to 1e-5 — a hundredth of a millimetre, well under what any display shows. */
export function compactDocument(document: SceneDocument): SceneDocument {
  const meshes: Record<string, MeshData> = {}
  for (const [id, mesh] of Object.entries(document.meshes)) {
    const copy = cloneMesh(mesh)
    for (let index = 0; index < copy.vertices.length; index += 1) {
      copy.vertices[index] = Math.round(copy.vertices[index]! * 1e5) / 1e5
    }
    meshes[id] = copy
  }
  return { ...document, meshes }
}

export function serializeSceneDocument(document: SceneDocument): string {
  return JSON.stringify(document)
}

/* ------------------------------------------------------------- manifest */

/** The document as the rest of the workbench sees it: one more rig in the library. */
export function sceneManifest(document: SceneDocument): RigManifest {
  const rig = document.rig
  const controls = rig?.parameters.length ?? 0
  const objects = document.objects.length
  const bundled = isBundledScene(document.id)
  return {
    id: document.id,
    name: document.name,
    summary: controls > 0
      ? `Scene · ${controls} ${controls === 1 ? 'control' : 'controls'}`
      : `Scene · ${objects} ${objects === 1 ? 'object' : 'objects'}`,
    description: '',
    renderer: 'scene',
    rendererLabel: 'Scene',
    collection: bundled ? 'examples' : 'project',
    title: bundled ? 'Examples/Scene' : 'Projects/Scene',
    sourceFile: bundled ? `src/rigs/examples/${document.id.replace(/^example-/, '')}.ts` : 'Local document',
    tags: ['scene', '3d', bundled ? 'example' : 'project', ...(controls > 0 ? ['rig'] : [])],
    groups: rig?.groups ?? [],
    parameters: rig?.parameters ?? [],
    ...(rig?.inspectorCategories ? { inspectorCategories: rig.inspectorCategories } : {}),
  }
}
