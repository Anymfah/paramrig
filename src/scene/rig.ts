import { applyTransform, sanitizeTransform, type BindingTransform } from '@/rigs/binding'
import { MAX_BINDINGS, MAX_PARAMETERS, rigText as text, sanitizeCategories, sanitizeGroups, sanitizeParameter } from '@/rigs/sanitize'
import type { AnimationDef, AnimTrack, InspectorCategory, ParameterDef, ParamGroup, ParamValue } from '@/rigs/types'
import { getModifier } from '@/scene/modifiers/types'
import type {
  CameraData,
  LightData,
  Material,
  MeshData,
  Modifier,
  SceneDocument,
  SceneObject,
  Vec3,
} from '@/scene/types'

/**
 * A scene document as a rig: the controls it carries, and where they write.
 *
 * The whole idea is one sentence long — the editor always writes to the raw document, and what is
 * *drawn* is that document with the controls applied — but everything depends on it. It is why a
 * rig can be re-tuned without touching the model, why an exported image is the same picture the
 * viewport showed, and why the vector editor's rigs and these ones are the same file format with a
 * different set of properties.
 *
 * Two rules run through the file, both borrowed from `src/vector/rig.ts` because they were right
 * there. A property path is *parsed*, never guessed: anything unrecognised is refused, so a binding
 * to a modifier that has been deleted drops rather than writing somewhere random. And resolution is
 * pure and memoised on a fingerprint of everything it reads, because a control being dragged asks
 * for the same answer sixty times a second.
 */

/** One control writing to one property of one object, material or of the scene itself. */
export type SceneBinding = {
  id: string
  /** The object the property belongs to, for the paths that belong to an object. */
  objectId?: string
  /** Filled in from the path for a material binding, so a panel can index by it. */
  materialId?: string
  property: string
  parameterId: string
  transform?: BindingTransform
}

/** What a scene document adds to become a rig: the controls, and where they write. */
export type SceneRig = {
  groups: ParamGroup[]
  parameters: ParameterDef[]
  inspectorCategories?: InspectorCategory[]
  bindings: SceneBinding[]
  /**
   * The keyframes the scene carries, in the same shape every other rig's animation has.
   *
   * It is here rather than in the session's draft so that an animation travels with the file: a
   * draft belongs to a browser, and a scene that was keyed and then sent to somebody else should
   * arrive animated.
   */
  animation?: AnimationDef
}

export type ScenePropertyType = 'number' | 'boolean' | 'color' | 'option' | 'text' | 'vector'

/** The fields of a material a control may write to, and what each one takes. */
const MATERIAL_FIELDS = {
  baseColor: 'color',
  metallic: 'number',
  roughness: 'number',
  emission: 'color',
  emissionStrength: 'number',
  alpha: 'number',
  transmission: 'number',
} as const

/** The fields of a light. Blender calls the spot's falloff "blend"; the document calls it blur. */
const LIGHT_FIELDS = {
  color: 'color',
  power: 'number',
  radius: 'number',
  spotAngle: 'number',
  spotBlend: 'number',
  spotBlur: 'number',
} as const

const CAMERA_FIELDS = { focalLength: 'number', orthoScale: 'number' } as const

/** What a curve offers a control: the numbers that change its shape, not the knots themselves. */
const CURVE_FIELDS = { extrude: 'number', bevelDepth: 'number', bevelResolution: 'number', resolution: 'number' } as const

/** A text object's, with the body among them: a control can drive what it says. */
const TEXT_FIELDS = { text: 'text', size: 'number', extrude: 'number', bevelDepth: 'number' } as const

const WORLD_FIELDS = { color: 'color', strength: 'number' } as const

type CurveField = keyof typeof CURVE_FIELDS
type TextField = keyof typeof TEXT_FIELDS
type MaterialField = keyof typeof MATERIAL_FIELDS
type LightField = keyof typeof LIGHT_FIELDS

/**
 * A property path, read apart so that applying it costs no string work at render time.
 *
 * A modifier's parameter is the one whose type is not known here: it comes from the module's own
 * declared schema, which is a question about the document rather than about the path.
 */
export type SceneProperty =
  | { kind: 'transform'; channel: 'position' | 'rotation' | 'scale'; axis: 0 | 1 | 2; type: 'number'; scoped: true }
  | { kind: 'uniformScale'; type: 'number'; scoped: true }
  | { kind: 'visible'; type: 'boolean'; scoped: true }
  | { kind: 'modifier'; modifierId: string; param: string; type: null; scoped: true }
  | { kind: 'light'; field: LightField; type: 'number' | 'color'; scoped: true }
  | { kind: 'camera'; field: keyof typeof CAMERA_FIELDS; type: 'number'; scoped: true }
  | { kind: 'curve'; field: CurveField; type: 'number'; scoped: true }
  | { kind: 'text'; field: TextField; type: 'number' | 'text'; scoped: true }
  | { kind: 'vertex'; vertexId: number; axis: 0 | 1 | 2; type: 'number'; scoped: true }
  | { kind: 'shapeKey'; name: string; type: 'number'; scoped: true }
  | { kind: 'material'; materialId: string; field: MaterialField; type: 'number' | 'color'; scoped: false }
  | { kind: 'shaderNode'; materialId: string; nodeId: string; setting: string; type: 'number'; scoped: false }
  | { kind: 'world'; field: keyof typeof WORLD_FIELDS; type: 'number' | 'color'; scoped: false }
  | { kind: 'cursor'; axis: 0 | 1 | 2; type: 'number'; scoped: false }

const AXES = { x: 0, y: 1, z: 2 } as const

/**
 * Reads a property path, or refuses it.
 *
 * A path this does not know is refused rather than guessed at: a binding that writes to something
 * that does not exist is a binding that does nothing while looking as though it works.
 */
export function parseSceneProperty(property: string): SceneProperty | null {
  const transform = /^transform\.(position|rotation|scale)\.(x|y|z)$/.exec(property)
  if (transform) {
    return {
      kind: 'transform',
      channel: transform[1] as 'position' | 'rotation' | 'scale',
      axis: AXES[transform[2] as 'x'],
      type: 'number',
      scoped: true,
    }
  }
  if (property === 'transform.scale') return { kind: 'uniformScale', type: 'number', scoped: true }
  if (property === 'visible') return { kind: 'visible', type: 'boolean', scoped: true }

  const modifier = /^modifiers\[([^\]]+)\]\.([A-Za-z][A-Za-z0-9]*)$/.exec(property)
  if (modifier) return { kind: 'modifier', modifierId: modifier[1]!, param: modifier[2]!, type: null, scoped: true }

  /*
   * A node's own setting, which is how a control reaches inside a shader graph. The node's id may
   * hold anything but a closing bracket, as a material's may: both are made rather than typed.
   */
  const node = /^materials\[([^\]]+)\]\.nodes\[([^\]]+)\]\.([A-Za-z][A-Za-z0-9]*)$/.exec(property)
  if (node) {
    return { kind: 'shaderNode', materialId: node[1]!, nodeId: node[2]!, setting: node[3]!, type: 'number', scoped: false }
  }

  const material = /^materials\[([^\]]+)\]\.([A-Za-z][A-Za-z0-9]*)$/.exec(property)
  if (material && Object.hasOwn(MATERIAL_FIELDS, material[2]!)) {
    const field = material[2] as MaterialField
    return { kind: 'material', materialId: material[1]!, field, type: MATERIAL_FIELDS[field], scoped: false }
  }

  const light = /^light\.([A-Za-z][A-Za-z0-9]*)$/.exec(property)
  if (light && Object.hasOwn(LIGHT_FIELDS, light[1]!)) {
    const field = light[1] as LightField
    return { kind: 'light', field, type: LIGHT_FIELDS[field], scoped: true }
  }

  const camera = /^camera\.([A-Za-z][A-Za-z0-9]*)$/.exec(property)
  if (camera && Object.hasOwn(CAMERA_FIELDS, camera[1]!)) {
    return { kind: 'camera', field: camera[1] as keyof typeof CAMERA_FIELDS, type: 'number', scoped: true }
  }

  const curve = /^curve\.([A-Za-z][A-Za-z0-9]*)$/.exec(property)
  if (curve && Object.hasOwn(CURVE_FIELDS, curve[1]!)) {
    return { kind: 'curve', field: curve[1] as CurveField, type: 'number', scoped: true }
  }

  const textPath = /^text\.([A-Za-z][A-Za-z0-9]*)$/.exec(property)
  if (textPath && Object.hasOwn(TEXT_FIELDS, textPath[1]!)) {
    const field = textPath[1] as TextField
    return { kind: 'text', field, type: TEXT_FIELDS[field], scoped: true }
  }

  /*
   * A shape key by name rather than by index, because a person adds and removes keys and the index
   * of "smile" is not a fact about the rig. The name may hold anything but a closing bracket.
   */
  const shapeKey = /^shapeKeys\[([^\]]+)\]\.value$/.exec(property)
  if (shapeKey) return { kind: 'shapeKey', name: shapeKey[1]!, type: 'number', scoped: true }

  const vertex = /^mesh\.vertices\[(\d+)\]\.(x|y|z)$/.exec(property)
  if (vertex) {
    return { kind: 'vertex', vertexId: Number(vertex[1]), axis: AXES[vertex[2] as 'x'], type: 'number', scoped: true }
  }

  const world = /^world\.([A-Za-z][A-Za-z0-9]*)$/.exec(property)
  if (world && Object.hasOwn(WORLD_FIELDS, world[1]!)) {
    const field = world[1] as keyof typeof WORLD_FIELDS
    return { kind: 'world', field, type: WORLD_FIELDS[field], scoped: false }
  }

  const cursor = /^cursor\.position\.(x|y|z)$/.exec(property)
  if (cursor) return { kind: 'cursor', axis: AXES[cursor[1] as 'x'], type: 'number', scoped: false }

  return null
}

/**
 * Every family of path a binding may name, written once and read by both the docs page and a test.
 *
 * The rows that name a field — a material's, a light's, the world's — are generated from the very
 * maps the parser consults, so a field added to the app is a row in the documentation on the same
 * commit. The rest are written out, and `rig.test.ts` parses every path here to prove that what is
 * documented is what the parser accepts.
 */
export type ScenePathDoc = {
  /** As written in a binding, with `<id>` where an id of the document goes. */
  path: string
  /** What the control feeding it must produce. A modifier's parameter is whatever its schema says. */
  takes: ScenePropertyType | 'its own'
  /** Whether the binding must also name the object it belongs to. */
  scope: 'object' | 'document'
  note: string
}

export const SCENE_PROPERTY_PATHS: ScenePathDoc[] = [
  { path: 'transform.position.x', takes: 'number', scope: 'object', note: 'Also .y and .z. Metres.' },
  { path: 'transform.rotation.x', takes: 'number', scope: 'object', note: 'Also .y and .z. Degrees, Blender’s XYZ order.' },
  { path: 'transform.scale.x', takes: 'number', scope: 'object', note: 'Also .y and .z. A factor, not a size.' },
  { path: 'transform.scale', takes: 'number', scope: 'object', note: 'All three axes at once.' },
  { path: 'visible', takes: 'boolean', scope: 'object', note: 'Whether the viewport draws it.' },
  { path: 'modifiers[<id>].<param>', takes: 'its own', scope: 'object', note: 'Any parameter the modifier’s schema declares, by its own name — levels, thickness, angle.' },
  { path: 'mesh.vertices[<index>].x', takes: 'number', scope: 'object', note: 'Also .y and .z. One vertex of the object’s mesh, by index.' },
  { path: 'shapeKeys[<name>].value', takes: 'number', scope: 'object', note: 'How much of a shape key is mixed in. By name, and only for a key that exists.' },
  ...Object.entries(LIGHT_FIELDS).map(([field, takes]) => ({
    path: `light.${field}`,
    takes: takes as ScenePropertyType,
    scope: 'object' as const,
    note: field === 'power' ? 'Watts, as Blender states them.' : field === 'spotBlur' ? 'Blender calls it blend.' : '',
  })),
  ...Object.entries(CAMERA_FIELDS).map(([field, takes]) => ({
    path: `camera.${field}`,
    takes: takes as ScenePropertyType,
    scope: 'object' as const,
    note: field === 'focalLength' ? 'Millimetres on the sensor the camera declares.' : 'Only used by an orthographic camera.',
  })),
  {
    path: 'materials[<id>].nodes[<nodeId>].<setting>',
    takes: 'number' as ScenePropertyType,
    scope: 'document' as const,
    note: 'Any number a shader node is set to, by the node’s own id and the setting’s own name.',
  },
  ...Object.entries(CURVE_FIELDS).map(([field, takes]) => ({
    path: `curve.${field}`,
    takes: takes as ScenePropertyType,
    scope: 'object' as const,
    note: field === 'resolution' ? 'How many straight pieces each Bézier span is drawn with.' : 'Metres, except the bevel resolution, which is a count.',
  })),
  ...Object.entries(TEXT_FIELDS).map(([field, takes]) => ({
    path: `text.${field}`,
    takes: takes as ScenePropertyType,
    scope: 'object' as const,
    note: field === 'text' ? 'What the object says. A control can drive the words themselves.' : '',
  })),
  ...Object.entries(MATERIAL_FIELDS).map(([field, takes]) => ({
    path: `materials[<id>].${field}`,
    takes: takes as ScenePropertyType,
    scope: 'document' as const,
    note: '',
  })),
  ...Object.entries(WORLD_FIELDS).map(([field, takes]) => ({
    path: `world.${field}`,
    takes: takes as ScenePropertyType,
    scope: 'document' as const,
    note: '',
  })),
  { path: 'cursor.position.x', takes: 'number', scope: 'document', note: 'Also .y and .z. The 3D cursor.' },
]

/** The parameter kinds that can drive a property of that type, best first. */
export const KINDS_FOR_SCENE_TYPE: Record<ScenePropertyType, string[]> = {
  number: ['number', 'vector', 'curve'],
  boolean: ['switch'],
  color: ['color'],
  option: ['select', 'text'],
  text: ['text'],
  vector: ['vector', 'gizmo3d'],
}

/**
 * What a property takes, including a modifier's parameter — which only the document can answer,
 * since the type is declared by the modifier's own module rather than by the path.
 */
export function scenePropertyType(document: SceneDocument, binding: Pick<SceneBinding, 'objectId' | 'property'>): ScenePropertyType | null {
  const path = parseSceneProperty(binding.property)
  if (!path) return null
  if (path.kind !== 'modifier') return path.type
  const parameter = modifierParameter(document, binding.objectId, path.modifierId, path.param)
  if (!parameter) return null
  if (parameter.kind === 'number') return 'number'
  if (parameter.kind === 'switch') return 'boolean'
  if (parameter.kind === 'color') return 'color'
  if (parameter.kind === 'select') return 'option'
  if (parameter.kind === 'text') return 'text'
  if (parameter.kind === 'vector') return 'vector'
  return null
}

/** The schema entry a modifier declares for one of its parameters, or nothing. */
export function modifierParameter(
  document: SceneDocument,
  objectId: string | undefined,
  modifierId: string,
  param: string,
): ParameterDef | null {
  const object = document.objects.find((entry) => entry.id === objectId)
  const modifier = object?.modifiers.find((entry) => entry.id === modifierId)
  if (!modifier) return null
  const module = getModifier(modifier.kind)
  return module?.schema.find((entry) => entry.id === param) ?? null
}

/* ------------------------------------------------------------------- values */

function asNumber(value: ParamValue): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0]
  return null
}

function withAxis(vector: Vec3, axis: 0 | 1 | 2, value: number): Vec3 {
  const next: Vec3 = [...vector]
  next[axis] = value
  return next
}

/** One binding written onto one object. The object comes back unchanged when it cannot apply. */
export function applyObjectBinding(
  object: SceneObject,
  path: SceneProperty,
  binding: SceneBinding,
  value: ParamValue,
  resolve: (id: string) => number,
  schema: ParameterDef | null,
): SceneObject {
  const number = (): number | null => {
    const raw = asNumber(value)
    return raw === null ? null : applyTransform(raw, binding.transform, resolve)
  }

  if (path.kind === 'transform') {
    const amount = number()
    if (amount === null) return object
    return { ...object, transform: { ...object.transform, [path.channel]: withAxis(object.transform[path.channel], path.axis, amount) } }
  }
  if (path.kind === 'uniformScale') {
    const amount = number()
    if (amount === null) return object
    return { ...object, transform: { ...object.transform, scale: [amount, amount, amount] } }
  }
  if (path.kind === 'visible') return { ...object, visible: Boolean(value) }

  if (path.kind === 'shapeKey') {
    const amount = number()
    if (amount === null || !object.shapeKeys) return object
    /*
     * A key nobody has made is not created by binding to it. A controller that spelled the name
     * wrongly would otherwise add a key with no offsets, which does nothing and looks like a key.
     */
    if (!object.shapeKeys.some((key) => key.name === path.name)) return object
    return {
      ...object,
      shapeKeys: object.shapeKeys.map((key) => (key.name === path.name ? { ...key, value: amount } : key)),
    }
  }

  if (path.kind === 'modifier') {
    const modifier = object.modifiers.find((entry) => entry.id === path.modifierId)
    if (!modifier) return object
    const written = modifierValue(value, schema, binding, resolve)
    if (written === undefined) return object
    return {
      ...object,
      modifiers: object.modifiers.map((entry) => (
        entry.id === modifier.id ? { ...entry, params: { ...entry.params, [path.param]: written } } : entry
      )),
    }
  }

  if (path.kind === 'light') {
    if (object.data.kind !== 'light') return object
    if (path.type === 'color') return typeof value === 'string' ? { ...object, data: { ...object.data, color: value } } : object
    const amount = number()
    if (amount === null) return object
    // Blender's "blend" is the document's `spotBlur`; both spellings write the same field.
    const field: keyof LightData = path.field === 'spotBlend' ? 'spotBlur' : (path.field as keyof LightData)
    return { ...object, data: { ...object.data, [field]: amount } }
  }

  if (path.kind === 'camera') {
    if (object.data.kind !== 'camera') return object
    const amount = number()
    if (amount === null) return object
    return { ...object, data: { ...object.data, [path.field satisfies keyof CameraData]: amount } }
  }

  if (path.kind === 'curve') {
    if (object.data.kind !== 'curve') return object
    const amount = number()
    if (amount === null) return object
    // The two counts are whole numbers; a control sweeping through 3.5 spans should read as 4.
    const written = path.field === 'resolution' || path.field === 'bevelResolution' ? Math.round(amount) : amount
    return { ...object, data: { ...object.data, [path.field]: Math.max(0, written) } }
  }

  if (path.kind === 'text') {
    if (object.data.kind !== 'text') return object
    // The path is `text.text`, and the field it writes is the body: Blender's own name for it.
    if (path.field === 'text') return typeof value === 'string' ? { ...object, data: { ...object.data, body: value } } : object
    const amount = number()
    if (amount === null) return object
    return { ...object, data: { ...object.data, [path.field]: Math.max(0, amount) } }
  }

  return object
}

/** What a modifier's parameter is set to, in the shape its own schema declares. */
function modifierValue(
  value: ParamValue,
  schema: ParameterDef | null,
  binding: SceneBinding,
  resolve: (id: string) => number,
): Modifier['params'][string] | undefined {
  const kind = schema?.kind ?? 'number'
  if (kind === 'switch') return Boolean(value)
  if (kind === 'color' || kind === 'text' || kind === 'select') return typeof value === 'string' ? value : undefined
  if (kind === 'vector') {
    if (!Array.isArray(value)) return undefined
    const numbers = value.map((entry) => (typeof entry === 'number' ? entry : 0))
    return numbers.length >= 3 ? ([numbers[0]!, numbers[1]!, numbers[2]!] as Vec3) : undefined
  }
  const raw = asNumber(value)
  if (raw === null) return undefined
  return applyTransform(raw, binding.transform, resolve)
}

/** One binding written onto a mesh: a single vertex moved along one axis. */
function withVertex(mesh: MeshData, vertexId: number, axis: 0 | 1 | 2, value: number): MeshData {
  const slot = mesh.vertexIds.indexOf(vertexId)
  if (slot < 0) return mesh
  const vertices = [...mesh.vertices]
  vertices[slot * 3 + axis] = value
  return { ...mesh, vertices }
}

function withMaterial(material: Material, path: Extract<SceneProperty, { kind: 'material' }>, value: ParamValue, binding: SceneBinding, resolve: (id: string) => number): Material {
  if (path.type === 'color') return typeof value === 'string' ? { ...material, [path.field]: value } : material
  const raw = asNumber(value)
  if (raw === null) return material
  return { ...material, [path.field]: applyTransform(raw, binding.transform, resolve) }
}

/* --------------------------------------------------------------- resolution */

let cacheKey = ''
let cacheValue: SceneDocument | null = null

/**
 * The document as its controls say it should look.
 *
 * Everything that *shows* a scene goes through this — the viewport, the thumbnails, the render, the
 * exports and Tune mode — while everything that *edits* one writes to the raw document. That split
 * is what makes a rig re-tunable without touching the model.
 *
 * The answer is kept for the last set of values, because a control being dragged asks for it many
 * times a second, and the key is everything the answer depends on: which document, when it last
 * changed, and what every control is set to. The modifier and material caches downstream are keyed
 * on the *resolved* mesh and material, so a control that moves one object re-evaluates that object
 * and nothing else.
 */
export function resolveSceneValues(document: SceneDocument, values: Record<string, ParamValue>): SceneDocument {
  const rig = document.rig
  if (!rig || rig.bindings.length === 0) return document
  const key = `${document.id}:${document.updatedAt}:${document.objects.length}:${JSON.stringify(values)}`
  if (key === cacheKey && cacheValue) return cacheValue

  const known = new Set(rig.parameters.map((parameter) => parameter.id))
  const resolve = (id: string): number => {
    const value = values[id]
    if (typeof value !== 'number') throw new Error(`Not a numeric control: ${id}`)
    return value
  }

  const byObject = new Map<string, SceneBinding[]>()
  const materialBindings: SceneBinding[] = []
  const sceneBindings: SceneBinding[] = []
  for (const binding of rig.bindings) {
    if (!known.has(binding.parameterId)) continue
    const path = parseSceneProperty(binding.property)
    if (!path) continue
    if (path.kind === 'material' || path.kind === 'shaderNode') materialBindings.push(binding)
    else if (!path.scoped) sceneBindings.push(binding)
    else if (binding.objectId) byObject.set(binding.objectId, [...(byObject.get(binding.objectId) ?? []), binding])
  }

  let meshes = document.meshes
  const objects = document.objects.map((object) => {
    const bindings = byObject.get(object.id)
    if (!bindings) return object
    // The last binding on a property wins, which is what writing them in order gives.
    return bindings.reduce((current, binding) => {
      const path = parseSceneProperty(binding.property)
      if (!path) return current
      const value = values[binding.parameterId] ?? null
      if (path.kind === 'vertex') {
        if (current.data.kind !== 'mesh') return current
        const mesh = meshes[current.data.meshId]
        const amount = asNumber(value)
        if (!mesh || amount === null) return current
        meshes = { ...meshes, [current.data.meshId]: withVertex(mesh, path.vertexId, path.axis, applyTransform(amount, binding.transform, resolve)) }
        return current
      }
      const schema = path.kind === 'modifier' ? modifierParameter(document, object.id, path.modifierId, path.param) : null
      return applyObjectBinding(current, path, binding, value, resolve, schema)
    }, object)
  })

  let materials = document.materials
  for (const binding of materialBindings) {
    const path = parseSceneProperty(binding.property)
    if (path?.kind === 'shaderNode') {
      const amount = asNumber(values[binding.parameterId] ?? null)
      if (amount === null) continue
      materials = materials.map((material) => (
        material.id === path.materialId
          ? withShaderSetting(material, path.nodeId, path.setting, applyTransform(amount, binding.transform, resolve))
          : material
      ))
      continue
    }
    if (path?.kind !== 'material') continue
    materials = materials.map((material) => (
      material.id === path.materialId ? withMaterial(material, path, values[binding.parameterId] ?? null, binding, resolve) : material
    ))
  }

  let world = document.world
  let cursor = document.cursor
  for (const binding of sceneBindings) {
    const path = parseSceneProperty(binding.property)
    const value = values[binding.parameterId] ?? null
    if (path?.kind === 'world') {
      if (path.type === 'color') {
        if (typeof value === 'string') world = { ...world, color: value }
      } else {
        const amount = asNumber(value)
        if (amount !== null) world = { ...world, strength: applyTransform(amount, binding.transform, resolve) }
      }
    }
    if (path?.kind === 'cursor') {
      const amount = asNumber(value)
      if (amount !== null) cursor = { ...cursor, position: withAxis(cursor.position, path.axis, applyTransform(amount, binding.transform, resolve)) }
    }
  }

  const resolved: SceneDocument = { ...document, objects, meshes, materials, world, cursor }
  cacheKey = key
  cacheValue = resolved
  return resolved
}

/** Drops the memo, so a test can watch the work happen. */
export function clearSceneRigCache(): void {
  cacheKey = ''
  cacheValue = null
}

/** The default value of every control the document defines. */
export function sceneRigDefaults(rig: SceneRig): Record<string, ParamValue> {
  return Object.fromEntries(rig.parameters.map((parameter) => [parameter.id, structuredClone(parameter.defaultValue)]))
}

/* ------------------------------------------------------------ what it reads */

/** What a property is set to right now, so a fresh control starts where the scene already is. */
export function currentSceneValue(document: SceneDocument, binding: Pick<SceneBinding, 'objectId' | 'property'>): ParamValue {
  const path = parseSceneProperty(binding.property)
  if (!path) return null
  if (path.kind === 'world') return path.field === 'color' ? document.world.color : document.world.strength
  if (path.kind === 'cursor') return document.cursor.position[path.axis]
  if (path.kind === 'material') {
    const material = document.materials.find((entry) => entry.id === path.materialId)
    return material ? material[path.field] : null
  }
  if (path.kind === 'shaderNode') {
    const material = document.materials.find((entry) => entry.id === path.materialId)
    return shaderSetting(material?.graph, path.nodeId, path.setting)
  }
  const object = document.objects.find((entry) => entry.id === binding.objectId)
  if (!object) return null
  if (path.kind === 'transform') return object.transform[path.channel][path.axis]
  if (path.kind === 'uniformScale') return object.transform.scale[0]
  if (path.kind === 'visible') return object.visible
  if (path.kind === 'modifier') {
    const modifier = object.modifiers.find((entry) => entry.id === path.modifierId)
    if (!modifier) return null
    const declared = modifierParameter(document, object.id, path.modifierId, path.param)
    const value = modifier.params[path.param]
    return (value ?? declared?.defaultValue ?? null) as ParamValue
  }
  if (path.kind === 'light') {
    if (object.data.kind !== 'light') return null
    const data = object.data
    if (path.field === 'color') return data.color
    if (path.field === 'spotBlend') return data.spotBlur
    return (data[path.field as keyof LightData] ?? 0) as ParamValue
  }
  if (path.kind === 'camera') {
    if (object.data.kind !== 'camera') return null
    return object.data[path.field]
  }
  if (path.kind === 'curve') {
    if (object.data.kind !== 'curve') return null
    return object.data[path.field]
  }
  if (path.kind === 'text') {
    if (object.data.kind !== 'text') return null
    return path.field === 'text' ? object.data.body : object.data[path.field]
  }
  if (path.kind === 'vertex') {
    if (object.data.kind !== 'mesh') return null
    const mesh = document.meshes[object.data.meshId]
    const slot = mesh ? mesh.vertexIds.indexOf(path.vertexId) : -1
    return mesh && slot >= 0 ? mesh.vertices[slot * 3 + path.axis] ?? 0 : null
  }
  if (path.kind === 'shapeKey') {
    return object.shapeKeys?.find((key) => key.name === path.name)?.value ?? null
  }
  return null
}

/**
 * A readable name for a property, with what it belongs to: “Cube · Subdivision levels”. It is what
 * a control is called when it is first exposed, so it has to read as a sentence in a list.
 */
export function scenePropertyLabel(document: SceneDocument, binding: Pick<SceneBinding, 'objectId' | 'property'>): string {
  const path = parseSceneProperty(binding.property)
  if (!path) return binding.property
  const object = document.objects.find((entry) => entry.id === binding.objectId)
  const owner = object ? `${object.name} · ` : ''
  if (path.kind === 'transform') return `${owner}${CHANNEL_LABELS[path.channel]} ${'XYZ'[path.axis]}`
  if (path.kind === 'uniformScale') return `${owner}Scale`
  if (path.kind === 'visible') return `${owner}Visible`
  if (path.kind === 'modifier') {
    const modifier = object?.modifiers.find((entry) => entry.id === path.modifierId)
    const declared = modifierParameter(document, binding.objectId, path.modifierId, path.param)
    return `${owner}${modifier?.name ?? 'Modifier'} ${(declared?.label ?? path.param).toLowerCase()}`
  }
  if (path.kind === 'material') {
    const material = document.materials.find((entry) => entry.id === path.materialId)
    return `${material?.name ?? 'Material'} · ${MATERIAL_LABELS[path.field]}`
  }
  if (path.kind === 'shaderNode') {
    const material = document.materials.find((entry) => entry.id === path.materialId)
    return `${material?.name ?? 'Material'} · ${path.setting}`
  }
  if (path.kind === 'light') return `${owner}${LIGHT_LABELS[path.field]}`
  if (path.kind === 'camera') return `${owner}${path.field === 'focalLength' ? 'Focal length' : 'Orthographic scale'}`
  if (path.kind === 'curve') return `${owner}${CURVE_LABELS[path.field]}`
  if (path.kind === 'text') return `${owner}${TEXT_LABELS[path.field]}`
  if (path.kind === 'vertex') return `${owner}Vertex ${path.vertexId} ${'XYZ'[path.axis]}`
  if (path.kind === 'world') return `World ${path.field === 'color' ? 'colour' : 'strength'}`
  if (path.kind === 'shapeKey') return `${owner}${path.name}`
  return `3D cursor ${'XYZ'[path.axis]}`
}

/**
 * One setting of one node of a material's graph, read and written without the engine.
 *
 * A rig runs on every frame of a scrub and must not fetch a compiler to do it, so the graph is
 * walked as the plain object the document holds. Nothing here interprets it: a setting that means
 * nothing to the compiler is a setting the compiler ignores, and that is its business rather than
 * the rig's.
 */
type GraphShape = { nodes?: Array<{ id?: unknown; settings?: Record<string, unknown> }> }

function shaderSetting(graph: unknown, nodeId: string, setting: string): ParamValue {
  const nodes = (graph as GraphShape | undefined)?.nodes
  if (!Array.isArray(nodes)) return null
  const found = nodes.find((node) => node?.id === nodeId)
  const value = found?.settings?.[setting]
  return typeof value === 'number' ? value : null
}

function withShaderSetting(material: Material, nodeId: string, setting: string, value: number): Material {
  const graph = material.graph as GraphShape | undefined
  if (!Array.isArray(graph?.nodes)) return material
  return {
    ...material,
    graph: {
      ...(material.graph as object),
      nodes: graph.nodes.map((node) => (
        node?.id === nodeId ? { ...node, settings: { ...(node.settings ?? {}), [setting]: value } } : node
      )),
    },
  }
}

const CHANNEL_LABELS = { position: 'Location', rotation: 'Rotation', scale: 'Scale' } as const

const CURVE_LABELS: Record<CurveField, string> = {
  extrude: 'Extrude',
  bevelDepth: 'Bevel depth',
  bevelResolution: 'Bevel resolution',
  resolution: 'Resolution',
}

const TEXT_LABELS: Record<TextField, string> = {
  text: 'Text',
  size: 'Size',
  extrude: 'Extrude',
  bevelDepth: 'Bevel depth',
}

const MATERIAL_LABELS: Record<MaterialField, string> = {
  baseColor: 'Base colour',
  metallic: 'Metallic',
  roughness: 'Roughness',
  emission: 'Emission',
  emissionStrength: 'Emission strength',
  alpha: 'Alpha',
  transmission: 'Transmission',
}

const LIGHT_LABELS: Record<LightField, string> = {
  color: 'Light colour',
  power: 'Power',
  radius: 'Radius',
  spotAngle: 'Spot size',
  spotBlend: 'Spot blend',
  spotBlur: 'Spot blend',
}

/**
 * A control built for a property, taking its default from what the scene says today and its bounds
 * from whatever declared them — a modifier's own schema knows far better than a guess would.
 */
export function parameterForSceneProperty(options: {
  id: string
  label: string
  group: string
  document: SceneDocument
  binding: Pick<SceneBinding, 'objectId' | 'property'>
  min?: number
  max?: number
  step?: number
}): ParameterDef | null {
  const path = parseSceneProperty(options.binding.property)
  if (!path) return null
  const type = scenePropertyType(options.document, options.binding)
  if (!type) return null
  const base = { id: options.id, label: options.label, group: options.group }
  const value = currentSceneValue(options.document, options.binding)
  const declared = path.kind === 'modifier'
    ? modifierParameter(options.document, options.binding.objectId, path.modifierId, path.param)
    : null

  if (type === 'number') {
    const fromSchema = declared?.kind === 'number' ? declared : null
    const min = options.min ?? fromSchema?.min ?? 0
    const suggested = options.max ?? fromSchema?.max ?? Math.max(min + 1, typeof value === 'number' ? Math.abs(value) * 2 : 10)
    const max = suggested > min ? suggested : min + 1
    const step = options.step ?? fromSchema?.step ?? 0.1
    return {
      ...base,
      kind: 'number',
      min,
      max,
      step,
      defaultValue: typeof value === 'number' ? Math.min(max, Math.max(min, value)) : min,
      ...(fromSchema?.unit ? { unit: fromSchema.unit } : {}),
    }
  }
  if (type === 'color') return { ...base, kind: 'color', defaultValue: typeof value === 'string' ? value : '#cccccc' }
  if (type === 'boolean') return { ...base, kind: 'switch', defaultValue: value !== false }
  if (type === 'option') {
    const list = declared?.kind === 'select' ? declared.options : []
    if (list.length === 0) return null
    return { ...base, kind: 'select', options: list, defaultValue: typeof value === 'string' ? value : list[0]!.value }
  }
  if (type === 'text') return { ...base, kind: 'text', defaultValue: typeof value === 'string' ? value : '' }
  if (type === 'vector') {
    const numbers = Array.isArray(value) ? value.map((entry) => (typeof entry === 'number' ? entry : 0)) : [0, 0, 0]
    const fromSchema = declared?.kind === 'vector' ? declared : null
    const min = options.min ?? fromSchema?.min ?? -10
    const max = options.max ?? fromSchema?.max ?? 10
    return {
      ...base,
      kind: 'vector',
      defaultValue: numbers.length >= 3 ? numbers.slice(0, 3) : [0, 0, 0],
      axes: fromSchema?.axes ?? ['X', 'Y', 'Z'],
      min,
      max: max > min ? max : min + 1,
      step: options.step ?? fromSchema?.step ?? 0.1,
    }
  }
  return null
}

/** The kind of control a property asks for when it is first exposed. */
export function kindForSceneProperty(type: ScenePropertyType): string {
  return KINDS_FOR_SCENE_TYPE[type][0]!
}


/* ------------------------------------------------------- what a file may say */

/** Everything a binding can point at, gathered once so a whole rig is read in one pass. */
export type SceneRigTargets = {
  objectIds: Set<string>
  materialIds: Set<string>
  /** Modifier ids, by the object that carries them: a modifier belongs to one object. */
  modifierIds: Map<string, Set<string>>
  /** Vertex ids, by object, for the paths that name one. */
  vertexIds: Map<string, Set<number>>
}

/** What a document offers to bind to, read once from the document itself. */
export function sceneRigTargets(document: Pick<SceneDocument, 'objects' | 'materials' | 'meshes'>): SceneRigTargets {
  const modifierIds = new Map<string, Set<string>>()
  const vertexIds = new Map<string, Set<number>>()
  for (const object of document.objects) {
    modifierIds.set(object.id, new Set(object.modifiers.map((modifier) => modifier.id)))
    if (object.data.kind !== 'mesh') continue
    const mesh = document.meshes[object.data.meshId]
    if (mesh) vertexIds.set(object.id, new Set(mesh.vertexIds))
  }
  return {
    objectIds: new Set(document.objects.map((object) => object.id)),
    materialIds: new Set(document.materials.map((material) => material.id)),
    modifierIds,
    vertexIds,
  }
}

/**
 * One binding, kept only when both ends of it exist.
 *
 * "Both ends" is stricter here than in a drawing, because a scene path names more: the object, and
 * then the modifier, the material or the vertex inside it. A binding to a modifier that has been
 * deleted is dropped on the way in rather than silently doing nothing for the rest of the file's
 * life.
 */
export function sanitizeSceneBinding(value: unknown, targets: SceneRigTargets, parameterIds: Set<string>): SceneBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const property = text(source.property, 120)
  const parameterId = text(source.parameterId, 60)
  if (!property || !parameterId || !parameterIds.has(parameterId)) return null
  const path = parseSceneProperty(property)
  if (!path) return null

  const objectId = text(source.objectId, 80) ?? undefined
  if (path.scoped) {
    if (!objectId || !targets.objectIds.has(objectId)) return null
    if (path.kind === 'modifier' && !targets.modifierIds.get(objectId)?.has(path.modifierId)) return null
    if (path.kind === 'vertex' && !targets.vertexIds.get(objectId)?.has(path.vertexId)) return null
  }
  if (path.kind === 'material' && !targets.materialIds.has(path.materialId)) return null

  return {
    id: text(source.id, 80) ?? `binding-${crypto.randomUUID()}`,
    ...(path.scoped && objectId ? { objectId } : {}),
    ...(path.kind === 'material' ? { materialId: path.materialId } : {}),
    property,
    parameterId,
    ...(sanitizeTransform(source.transform) ? { transform: sanitizeTransform(source.transform) } : {}),
  }
}

/**
 * The rig a document carries, read back from storage or from a file.
 *
 * A rig with no group has nowhere to put a control, so a file that declares none declares no rig —
 * the same rule the drawing editor keeps, and the reason `emptySceneRig` starts with one.
 */
export function sanitizeSceneRig(value: unknown, targets: SceneRigTargets): SceneRig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const groups = sanitizeGroups(source.groups)
  if (groups.length === 0) return undefined
  const groupIds = new Set(groups.map((group) => group.id))
  const seen = new Set<string>()
  const parameters = (Array.isArray(source.parameters) ? source.parameters : [])
    .slice(0, MAX_PARAMETERS)
    .flatMap((parameter) => {
      const clean = sanitizeParameter(parameter, groupIds, { extended: true })
      if (!clean || seen.has(clean.id)) return []
      seen.add(clean.id)
      return [clean]
    })
  const bindings = (Array.isArray(source.bindings) ? source.bindings : [])
    .slice(0, MAX_BINDINGS)
    .flatMap((binding) => {
      const clean = sanitizeSceneBinding(binding, targets, seen)
      return clean ? [clean] : []
    })
  const categories = sanitizeCategories(source.inspectorCategories)
  const animation = sanitizeAnimation(source.animation, seen)
  return {
    groups,
    parameters,
    bindings,
    ...(categories.length ? { inspectorCategories: categories } : {}),
    ...(animation ? { animation } : {}),
  }
}

/**
 * The animation a file carries, kept only where it means something.
 *
 * A track whose control is not in this rig is dropped: it would key nothing, and a file that kept
 * it would grow a track every time a control was renamed. A keyframe with no number is not a
 * keyframe.
 */
function sanitizeAnimation(value: unknown, parameterIds: Set<string>): AnimationDef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<AnimationDef>
  const duration = Number.isFinite(source.duration) ? Math.min(600, Math.max(0.1, Number(source.duration))) : 4
  const fps = Number.isFinite(source.fps) ? Math.min(240, Math.max(1, Math.round(Number(source.fps)))) : 30
  const tracks = (Array.isArray(source.tracks) ? source.tracks : [])
    .slice(0, MAX_PARAMETERS)
    .flatMap((track) => {
      if (!track || typeof track !== 'object') return []
      const entry = track as Partial<AnimTrack>
      if (typeof entry.paramId !== 'string' || !parameterIds.has(entry.paramId)) return []
      const keyframes = (Array.isArray(entry.keyframes) ? entry.keyframes : []).flatMap((frame) => {
        if (!frame || typeof frame !== 'object') return []
        const item = frame as { time?: unknown; value?: unknown; easing?: unknown; id?: unknown }
        if (!Number.isFinite(Number(item.time)) || !Number.isFinite(Number(item.value))) return []
        return [{
          id: typeof item.id === 'string' ? item.id.slice(0, 60) : crypto.randomUUID(),
          time: Math.min(duration, Math.max(0, Number(item.time))),
          value: Number(item.value),
        }]
      }).sort((one, other) => one.time - other.time)
      if (keyframes.length === 0) return []
      return [{ paramId: entry.paramId, interpolation: entry.interpolation === 'step' ? 'step' as const : 'linear' as const, keyframes }]
    })
  if (tracks.length === 0) return undefined
  return { duration, fps, loop: source.loop === true, tracks }
}

/** What a rig looks like before anything has been exposed. */
export const DEFAULT_SCENE_GROUP: ParamGroup = { id: 'main', label: 'Main' }

export function emptySceneRig(): SceneRig {
  return { groups: [DEFAULT_SCENE_GROUP], parameters: [], bindings: [] }
}

/** The bindings that write to one property, in the order they were declared. */
export function bindingsFor(rig: SceneRig | undefined, binding: Pick<SceneBinding, 'objectId' | 'property'>): SceneBinding[] {
  if (!rig) return []
  return rig.bindings.filter((entry) => entry.property === binding.property && (entry.objectId ?? null) === (binding.objectId ?? null))
}
