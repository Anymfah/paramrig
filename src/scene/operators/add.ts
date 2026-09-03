import { Euler, Matrix4, Vector3 } from 'three'
import type { ParameterDef, ParamValue } from '@/rigs/types'
import { collectionById, rootCollection, uniqueObjectName } from '@/scene/document'
import {
  boxMesh,
  circleMesh,
  coneMesh,
  cylinderMesh,
  gridMesh,
  icoSphereMesh,
  paramRigMarkMesh,
  planeMesh,
  torusMesh,
  uvSphereMesh,
  type CapFill,
} from '@/scene/mesh/primitives'
import { registerOperator } from '@/scene/operators/registry'
import {
  colorParam,
  numberParam,
  selectParam,
  vectorParam,
  type Availability,
  type OperatorContext,
  type OperatorParams,
  type OperatorResult,
} from '@/scene/operators/types'
import type {
  AreaShape,
  CameraData,
  EmptyData,
  EmptyDisplay,
  LightData,
  LightKind,
  MeshData,
  ObjectData,
  SceneDocument,
  SceneObject,
  Vec3,
  ViewState,
} from '@/scene/types'
import { cameraBasis, DEG } from '@/scene/viewport/view'

/**
 * Blender's ⇧A menu, written as operators.
 *
 * Every entry makes exactly one object, puts it where the 3D cursor is, names it the way Blender
 * names things, and hands back a selection with the new object active — so that adding is the same
 * act whether it came from the menu, the palette, a keystroke or a test. The mesh entries are the
 * primitives of `mesh/primitives.ts` with their own parameters exposed, which is what makes the
 * redo panel able to turn a thirty-two-sided cylinder into an eight-sided one after the fact.
 */

/** `mesh/primitives.ts` caps every segment count here; the field says so rather than clamping in silence. */
const MAX_SEGMENTS = 512

const ALIGN_OPTIONS = ['world', 'view', 'cursor'] as const
type Align = (typeof ALIGN_OPTIONS)[number]

const FILL_OPTIONS: readonly CapFill[] = ['none', 'ngon', 'triangle-fan']
const AREA_SHAPES: readonly AreaShape[] = ['square', 'rectangle', 'disk', 'ellipse']
const EMPTY_DISPLAYS: readonly EmptyDisplay[] = [
  'plain-axes', 'arrows', 'single-arrow', 'cube', 'sphere', 'circle', 'cone', 'image',
]

/* --------------------------------------------------------- shared fields */

const ALIGN = selectParam('align', 'Align', [
  { value: 'world', label: 'World' },
  { value: 'view', label: 'View' },
  { value: 'cursor', label: '3D cursor' },
], 'world')

const LOCATION = vectorParam('location', 'Location', { defaultValue: [0, 0, 0], step: 0.1, unit: 'm' })

const ROTATION = vectorParam('rotation', 'Rotation', {
  defaultValue: [0, 0, 0],
  min: -3600,
  max: 3600,
  step: 1,
  unit: '°',
  view: 'rotation',
})

function countParam(id: string, label: string, defaultValue: number, min = 3): ParameterDef {
  return numberParam(id, label, { min, max: MAX_SEGMENTS, step: 1, defaultValue, view: 'stepper' })
}

function lengthParam(id: string, label: string, defaultValue: number): ParameterDef {
  return numberParam(id, label, { min: 0, max: 1000, step: 0.1, defaultValue, unit: 'm' })
}

/** `sanitizeSceneDocument` bounds a light's radius at a hundred metres; the field agrees with it. */
function lightRadiusParam(defaultValue: number): ParameterDef {
  return numberParam('radius', 'Radius', { min: 0, max: 100, step: 0.01, defaultValue, unit: 'm' })
}

function fillParam(defaultValue: CapFill): ParameterDef {
  return selectParam('fill', 'Fill', [
    { value: 'none', label: 'Nothing' },
    { value: 'ngon', label: 'N-gon' },
    { value: 'triangle-fan', label: 'Triangle fan' },
  ], defaultValue)
}

/* ------------------------------------------------------- reading a param */

/** A parameter as a number, or nothing — in which case the primitive falls back to its own default. */
function numberOf(value: ParamValue | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function vectorOf(value: ParamValue | undefined): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const x = Number(value[0])
  const y = Number(value[1])
  const z = Number(value[2])
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [x, y, z]
}

/** One of a closed set, or the fallback: a parameter is data and may say anything at all. */
function optionOf<T extends string>(value: ParamValue | undefined, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

function colourOf(value: ParamValue | undefined, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

/* ------------------------------------------------------ where it lands */

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

/**
 * Blender fills the redo panel's Location with the 3D cursor at the moment the operator is
 * invoked, so it cannot be a constant sitting in `defaults`: a document whose cursor has moved
 * would go on adding objects at the old place for the rest of the session. It is read from the
 * context instead, and a caller that names a location — the redo panel, a script, a test — is
 * taken at its word.
 */
function placedAt(context: OperatorContext, params: OperatorParams): Vec3 {
  return vectorOf(params.location) ?? [...context.cursor.position]
}

/**
 * The alignment decides the frame the object arrives in, and `rotation` is turned inside that
 * frame — so the parameter still does something under all three alignments, and the two common
 * cases come back as the numbers a person typed rather than as a matrix round trip of them.
 */
function aimedAt(context: OperatorContext, params: OperatorParams): Vec3 {
  const align: Align = optionOf(params.align, ALIGN_OPTIONS, 'world')
  const own = vectorOf(params.rotation) ?? [0, 0, 0]
  if (align === 'world') return own
  const base = align === 'view' ? viewRotation(context.view) : ([...context.cursor.rotation] as Vec3)
  if (own[0] === 0 && own[1] === 0 && own[2] === 0) return base
  return eulerFromMatrix(matrixFromEuler(base).multiply(matrixFromEuler(own)))
}

/**
 * The rotation that lays an object flat against the screen: its local Z points back at the viewer
 * and its local Y is the view's up. This is Blender's "Align: View", which is why a plane added
 * from the front view comes in standing up instead of lying on the floor.
 */
function viewRotation(view: ViewState): Vec3 {
  const { right, up, forward } = cameraBasis(view.yaw, view.pitch)
  const matrix = new Matrix4().makeBasis(
    new Vector3(right[0], right[1], right[2]),
    new Vector3(up[0], up[1], up[2]),
    new Vector3(-forward[0], -forward[1], -forward[2]),
  )
  return eulerFromMatrix(matrix)
}

function matrixFromEuler(angles: Vec3): Matrix4 {
  return new Matrix4().makeRotationFromEuler(new Euler(angles[0] * DEG, angles[1] * DEG, angles[2] * DEG, 'XYZ'))
}

function eulerFromMatrix(matrix: Matrix4): Vec3 {
  const euler = new Euler().setFromRotationMatrix(matrix, 'XYZ')
  return [tidy(euler.x / DEG), tidy(euler.y / DEG), tidy(euler.z / DEG)]
}

/** Degrees a person could have typed: the matrix round trip leaves 89.999999999999 where 90 belongs. */
function tidy(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6
  // Negative zero reads as "-0" in a number field, and it is not a different angle from zero.
  return rounded === 0 ? 0 : rounded
}

/** The collection the new object joins: the active object's, or the root when nothing is active. */
function hostCollection(context: OperatorContext): string {
  const active = context.active
  if (active && collectionById(context.document, active.collectionId)) return active.collectionId
  return rootCollection(context.document).id
}

/* ------------------------------------------------------------ the object */

type NewObject =
  | { kind: 'mesh'; name: string; mesh: MeshData }
  | { kind: 'light'; name: string; data: LightData }
  | { kind: 'camera'; name: string; data: CameraData }
  | { kind: 'empty'; name: string; data: EmptyData }

/**
 * A mesh object's geometry goes into `document.meshes` under a fresh id and the object points at
 * it, which is what lets two objects share one mesh later; everything else carries its data block
 * inline and leaves the mesh table exactly as it was.
 */
function withData(document: SceneDocument, made: NewObject): { data: ObjectData; meshes: Record<string, MeshData> } {
  if (made.kind !== 'mesh') return { data: made.data, meshes: document.meshes }
  const meshId = newId('mesh')
  return { data: { kind: 'mesh', meshId }, meshes: { ...document.meshes, [meshId]: made.mesh } }
}

function place(context: OperatorContext, params: OperatorParams, made: NewObject, entry: string): OperatorResult {
  const document = context.document
  const { data, meshes } = withData(document, made)
  const material = document.materials[0]
  const object: SceneObject = {
    id: newId('object'),
    name: uniqueObjectName(document, made.name),
    kind: made.kind,
    collectionId: hostCollection(context),
    transform: {
      position: placedAt(context, params),
      rotation: aimedAt(context, params),
      scale: [1, 1, 1],
    },
    visible: true,
    selectable: true,
    renderable: true,
    data,
    modifiers: [],
    // Only the kinds that can be shaded take a slot; a light with a material would be a lie.
    materialSlots: made.kind === 'mesh' && material ? [material.id] : [],
  }
  return {
    document: { ...document, objects: [...document.objects, object], meshes },
    // A fresh object-mode selection: any edit-mode selection left over belonged to another object.
    selection: { objectIds: [object.id], activeObjectId: object.id },
    label: entry,
  }
}

/**
 * Adding is an object-mode act. In edit mode Blender adds the primitive into the mesh being
 * edited, which is a different operator with different consequences, so this family says so rather
 * than doing something surprising.
 */
function canAdd(context: OperatorContext): Availability {
  if (context.mode === 'object') return true
  if (context.mode === 'edit') return 'Leave edit mode to add an object.'
  return 'Leave sculpt mode to add an object.'
}

type AddDefinition = {
  id: string
  /** What the menu entry says. */
  label: string
  icon: string
  description: string
  /** What the history entry says: "Add cube", "Add point light". */
  entry: string
  params: ParameterDef[]
  defaults: OperatorParams
  make: (params: OperatorParams, document: SceneDocument) => NewObject
}

function addOperator(definition: AddDefinition): void {
  registerOperator({
    id: definition.id,
    label: definition.label,
    section: 'Add',
    icon: definition.icon,
    description: definition.description,
    params: [...definition.params, ALIGN, LOCATION, ROTATION],
    // `location` is deliberately absent: see `placedAt`. Everything else has a constant default.
    defaults: { ...definition.defaults, align: 'world', rotation: [0, 0, 0] },
    available: canAdd,
    run: (context, params) => place(context, params, definition.make(params, context.document), definition.entry),
  })
}

/* -------------------------------------------------------------- the mesh */

addOperator({
  id: 'add.plane',
  label: 'Plane',
  icon: 'mesh',
  description: 'A single quad lying on the ground plane.',
  entry: 'Add plane',
  params: [lengthParam('size', 'Size', 2)],
  defaults: { size: 2 },
  make: (params) => ({ kind: 'mesh', name: 'Plane', mesh: planeMesh(numberOf(params.size)) }),
})

addOperator({
  id: 'add.cube',
  label: 'Cube',
  icon: 'mesh',
  description: 'A box of six quads, two metres across.',
  entry: 'Add cube',
  params: [lengthParam('size', 'Size', 2)],
  defaults: { size: 2 },
  make: (params) => ({ kind: 'mesh', name: 'Cube', mesh: boxMesh(numberOf(params.size) ?? 2) }),
})

addOperator({
  id: 'add.circle',
  label: 'Circle',
  icon: 'mesh',
  description: 'A ring of vertices, filled or left as wire.',
  entry: 'Add circle',
  params: [countParam('vertices', 'Vertices', 32), lengthParam('radius', 'Radius', 1), fillParam('none')],
  defaults: { vertices: 32, radius: 1, fill: 'none' },
  make: (params) => ({
    kind: 'mesh',
    name: 'Circle',
    mesh: circleMesh({
      vertices: numberOf(params.vertices),
      radius: numberOf(params.radius),
      fill: optionOf(params.fill, FILL_OPTIONS, 'none'),
    }),
  }),
})

addOperator({
  id: 'add.uvSphere',
  label: 'UV sphere',
  icon: 'mesh',
  description: 'A sphere of latitude rings and longitude segments.',
  entry: 'Add UV sphere',
  params: [countParam('segments', 'Segments', 32), countParam('rings', 'Rings', 16, 2), lengthParam('radius', 'Radius', 1)],
  defaults: { segments: 32, rings: 16, radius: 1 },
  make: (params) => ({
    kind: 'mesh',
    name: 'Sphere',
    mesh: uvSphereMesh({
      segments: numberOf(params.segments),
      rings: numberOf(params.rings),
      radius: numberOf(params.radius),
    }),
  }),
})

addOperator({
  id: 'add.icoSphere',
  label: 'Ico sphere',
  icon: 'mesh',
  description: 'A sphere of even triangles, subdivided from an icosahedron.',
  entry: 'Add ico sphere',
  params: [
    numberParam('subdivisions', 'Subdivisions', { min: 1, max: 5, step: 1, defaultValue: 2, view: 'stepper' }),
    lengthParam('radius', 'Radius', 1),
  ],
  defaults: { subdivisions: 2, radius: 1 },
  make: (params) => ({
    kind: 'mesh',
    name: 'Icosphere',
    mesh: icoSphereMesh({ subdivisions: numberOf(params.subdivisions), radius: numberOf(params.radius) }),
  }),
})

addOperator({
  id: 'add.cylinder',
  label: 'Cylinder',
  icon: 'mesh',
  description: 'A tube along Z, capped at both ends.',
  entry: 'Add cylinder',
  params: [
    countParam('vertices', 'Vertices', 32),
    lengthParam('radius', 'Radius', 1),
    lengthParam('depth', 'Depth', 2),
    fillParam('ngon'),
  ],
  defaults: { vertices: 32, radius: 1, depth: 2, fill: 'ngon' },
  make: (params) => ({
    kind: 'mesh',
    name: 'Cylinder',
    mesh: cylinderMesh({
      vertices: numberOf(params.vertices),
      radius: numberOf(params.radius),
      depth: numberOf(params.depth),
      fill: optionOf(params.fill, FILL_OPTIONS, 'ngon'),
    }),
  }),
})

addOperator({
  id: 'add.cone',
  label: 'Cone',
  icon: 'mesh',
  description: 'A cone along Z; raise the top radius for a frustum.',
  entry: 'Add cone',
  params: [
    countParam('vertices', 'Vertices', 32),
    lengthParam('radius1', 'Radius 1', 1),
    lengthParam('radius2', 'Radius 2', 0),
    lengthParam('depth', 'Depth', 2),
    fillParam('ngon'),
  ],
  defaults: { vertices: 32, radius1: 1, radius2: 0, depth: 2, fill: 'ngon' },
  make: (params) => ({
    kind: 'mesh',
    name: 'Cone',
    mesh: coneMesh({
      vertices: numberOf(params.vertices),
      radius1: numberOf(params.radius1),
      radius2: numberOf(params.radius2),
      depth: numberOf(params.depth),
      fill: optionOf(params.fill, FILL_OPTIONS, 'ngon'),
    }),
  }),
})

addOperator({
  id: 'add.torus',
  label: 'Torus',
  icon: 'mesh',
  description: 'A ring of quads swept around Z.',
  entry: 'Add torus',
  params: [
    countParam('majorSegments', 'Major segments', 48),
    countParam('minorSegments', 'Minor segments', 12),
    lengthParam('majorRadius', 'Major radius', 1),
    lengthParam('minorRadius', 'Minor radius', 0.25),
  ],
  defaults: { majorSegments: 48, minorSegments: 12, majorRadius: 1, minorRadius: 0.25 },
  make: (params) => ({
    kind: 'mesh',
    name: 'Torus',
    mesh: torusMesh({
      majorSegments: numberOf(params.majorSegments),
      minorSegments: numberOf(params.minorSegments),
      majorRadius: numberOf(params.majorRadius),
      minorRadius: numberOf(params.minorRadius),
    }),
  }),
})

addOperator({
  id: 'add.grid',
  label: 'Grid',
  icon: 'mesh',
  description: 'A subdivided plane; the subdivisions are vertices per side, as in Blender.',
  entry: 'Add grid',
  params: [
    countParam('xSubdivisions', 'X subdivisions', 10, 2),
    countParam('ySubdivisions', 'Y subdivisions', 10, 2),
    lengthParam('size', 'Size', 2),
  ],
  defaults: { xSubdivisions: 10, ySubdivisions: 10, size: 2 },
  make: (params) => ({
    kind: 'mesh',
    name: 'Grid',
    mesh: gridMesh({
      xSubdivisions: numberOf(params.xSubdivisions),
      ySubdivisions: numberOf(params.ySubdivisions),
      size: numberOf(params.size),
    }),
  }),
})

addOperator({
  id: 'add.paramRigMark',
  label: 'ParamRig mark',
  icon: 'mesh',
  description: 'The house mark, where Blender keeps its monkey.',
  entry: 'Add ParamRig mark',
  params: [lengthParam('size', 'Size', 2)],
  defaults: { size: 2 },
  // The mark is modelled at Blender's usual two metres, so the default asks for no scaling at all.
  make: (params) => ({ kind: 'mesh', name: 'Mark', mesh: scaledMesh(paramRigMarkMesh(), (numberOf(params.size) ?? 2) / 2) }),
})

/** The mark is the one primitive with no size of its own, so its size is applied afterwards. */
function scaledMesh(mesh: MeshData, factor: number): MeshData {
  if (factor === 1 || !Number.isFinite(factor)) return mesh
  // The mesh was built a line ago and nothing else holds it, so it is scaled where it lies.
  for (let index = 0; index < mesh.vertices.length; index += 1) mesh.vertices[index] = (mesh.vertices[index] ?? 0) * factor
  return mesh
}

/* ------------------------------------------------------------ the lights */

/** What Blender opens a new light with, kind by kind. */
const LIGHT_DEFAULTS: Record<LightKind, LightData> = {
  point: {
    kind: 'light', light: 'point', color: '#ffffff', power: 1000, radius: 0.1,
    spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true,
  },
  sun: {
    // A sun is an irradiance in watts per square metre, not a bulb's wattage, hence the 1.
    kind: 'light', light: 'sun', color: '#ffffff', power: 1, radius: 0.526,
    spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true,
  },
  spot: {
    kind: 'light', light: 'spot', color: '#ffffff', power: 1000, radius: 0.1,
    spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true,
  },
  area: {
    kind: 'light', light: 'area', color: '#ffffff', power: 100, radius: 0,
    spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true,
  },
}

function lightData(kind: LightKind, params: OperatorParams): LightData {
  const base = LIGHT_DEFAULTS[kind]
  const size = numberOf(params.size) ?? base.areaSize[0]
  return {
    ...base,
    color: colourOf(params.color, base.color),
    power: numberOf(params.power) ?? base.power,
    // A sun has no radius: what softens its shadow is the angle it subtends, and `radius` is where
    // the document keeps that number.
    radius: numberOf(params.radius) ?? numberOf(params.angle) ?? base.radius,
    spotAngle: numberOf(params.spotAngle) ?? base.spotAngle,
    spotBlur: numberOf(params.spotBlur) ?? base.spotBlur,
    areaShape: optionOf(params.shape, AREA_SHAPES, base.areaShape),
    areaSize: [size, size],
  }
}

const LIGHT_COLOUR = colorParam('color', 'Colour', '#ffffff')

addOperator({
  id: 'add.lightPoint',
  label: 'Point',
  icon: 'light-point',
  description: 'A bulb: it shines in every direction from one place.',
  entry: 'Add point light',
  params: [
    LIGHT_COLOUR,
    numberParam('power', 'Power', { min: 0, max: 1e6, step: 10, defaultValue: 1000, unit: 'W' }),
    lightRadiusParam(0.1),
  ],
  defaults: { color: '#ffffff', power: 1000, radius: 0.1 },
  make: (params) => ({ kind: 'light', name: 'Point', data: lightData('point', params) }),
})

addOperator({
  id: 'add.lightSun',
  label: 'Sun',
  icon: 'light-sun',
  description: 'Parallel light from infinitely far away; only its direction matters.',
  entry: 'Add sun light',
  params: [
    LIGHT_COLOUR,
    numberParam('power', 'Strength', { min: 0, max: 1e4, step: 0.1, defaultValue: 1, unit: 'W/m²' }),
    numberParam('angle', 'Angle', { min: 0, max: 90, step: 0.01, defaultValue: 0.526, unit: '°' }),
  ],
  defaults: { color: '#ffffff', power: 1, angle: 0.526 },
  make: (params) => ({ kind: 'light', name: 'Sun', data: lightData('sun', params) }),
})

addOperator({
  id: 'add.lightSpot',
  label: 'Spot',
  icon: 'light-spot',
  description: 'A cone of light down the object’s own -Z.',
  entry: 'Add spot light',
  params: [
    LIGHT_COLOUR,
    numberParam('power', 'Power', { min: 0, max: 1e6, step: 10, defaultValue: 1000, unit: 'W' }),
    lightRadiusParam(0.1),
    numberParam('spotAngle', 'Cone', { min: 1, max: 180, step: 1, defaultValue: 45, unit: '°' }),
    numberParam('spotBlur', 'Blend', { min: 0, max: 1, step: 0.01, defaultValue: 0.15, view: 'bar' }),
  ],
  defaults: { color: '#ffffff', power: 1000, radius: 0.1, spotAngle: 45, spotBlur: 0.15 },
  make: (params) => ({ kind: 'light', name: 'Spot', data: lightData('spot', params) }),
})

addOperator({
  id: 'add.lightArea',
  label: 'Area',
  icon: 'light-area',
  description: 'A lit panel, whose size is what softens its shadows.',
  entry: 'Add area light',
  params: [
    LIGHT_COLOUR,
    numberParam('power', 'Power', { min: 0, max: 1e6, step: 10, defaultValue: 100, unit: 'W' }),
    selectParam('shape', 'Shape', [
      { value: 'square', label: 'Square' },
      { value: 'rectangle', label: 'Rectangle' },
      { value: 'disk', label: 'Disk' },
      { value: 'ellipse', label: 'Ellipse' },
    ], 'square'),
    lengthParam('size', 'Size', 1),
  ],
  defaults: { color: '#ffffff', power: 100, shape: 'square', size: 1 },
  make: (params) => ({ kind: 'light', name: 'Area', data: lightData('area', params) }),
})

/* ------------------------------------------------- the camera and the empty */

addOperator({
  id: 'add.camera',
  label: 'Camera',
  icon: 'camera',
  description: 'A camera looking down its own -Z.',
  entry: 'Add camera',
  params: [
    numberParam('focalLength', 'Focal length', { min: 1, max: 5000, step: 1, defaultValue: 50, unit: 'mm' }),
    numberParam('clipStart', 'Clip start', { min: 1e-4, max: 1000, step: 0.01, defaultValue: 0.1, unit: 'm' }),
    numberParam('clipEnd', 'Clip end', { min: 0.01, max: 1e6, step: 1, defaultValue: 100, unit: 'm' }),
  ],
  defaults: { focalLength: 50, clipStart: 0.1, clipEnd: 100 },
  make: (params, document) => ({ kind: 'camera', name: 'Camera', data: cameraData(params, document) }),
})

function cameraData(params: OperatorParams, document: SceneDocument): CameraData {
  const alreadyActive = document.objects.some((object) => object.data.kind === 'camera' && object.data.active === true)
  return {
    kind: 'camera',
    projection: 'perspective',
    focalLength: numberOf(params.focalLength) ?? 50,
    sensor: 36,
    orthoScale: 6,
    clipStart: numberOf(params.clipStart) ?? 0.1,
    clipEnd: numberOf(params.clipEnd) ?? 100,
    // The first camera in a scene becomes the scene camera; a second one does not steal the job.
    ...(alreadyActive ? {} : { active: true }),
  }
}

addOperator({
  id: 'add.empty',
  label: 'Empty',
  icon: 'empty',
  description: 'A transform with nothing to render: a parent, a target, a handle.',
  entry: 'Add empty',
  params: [
    selectParam('display', 'Display as', [
      { value: 'plain-axes', label: 'Plain axes' },
      { value: 'arrows', label: 'Arrows' },
      { value: 'single-arrow', label: 'Single arrow' },
      { value: 'cube', label: 'Cube' },
      { value: 'sphere', label: 'Sphere' },
      { value: 'circle', label: 'Circle' },
      { value: 'cone', label: 'Cone' },
      { value: 'image', label: 'Image' },
    ], 'plain-axes'),
    // An empty of no size draws nothing at all, which is why the document's own floor is not zero.
    numberParam('size', 'Size', { min: 0.001, max: 1000, step: 0.1, defaultValue: 1, unit: 'm' }),
  ],
  defaults: { display: 'plain-axes', size: 1 },
  make: (params) => ({
    kind: 'empty',
    name: 'Empty',
    data: {
      kind: 'empty',
      display: optionOf(params.display, EMPTY_DISPLAYS, 'plain-axes'),
      size: numberOf(params.size) ?? 1,
    },
  }),
})

/* ---------------------------------------------------------------- the menu */

/**
 * The ⇧A menu, in Blender's order. The header's Add menu, the pie and the search all read this
 * rather than listing the operators again, so a new entry appears everywhere at once — and an
 * operator missing from here is one the registry knows and nobody can reach.
 */
export const ADD_MENU: Array<{ label: string; items: string[] }> = [
  {
    label: 'Mesh',
    items: [
      'add.plane', 'add.cube', 'add.circle', 'add.uvSphere', 'add.icoSphere',
      'add.cylinder', 'add.cone', 'add.torus', 'add.grid', 'add.paramRigMark',
    ],
  },
  { label: 'Light', items: ['add.lightPoint', 'add.lightSun', 'add.lightSpot', 'add.lightArea'] },
  { label: 'Camera', items: ['add.camera'] },
  { label: 'Empty', items: ['add.empty'] },
]
